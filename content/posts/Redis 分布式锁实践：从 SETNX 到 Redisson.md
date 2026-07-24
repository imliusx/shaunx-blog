---
title: Redis 分布式锁实践：从 SETNX 到 Redisson
slug: redis-distributed-lock-setnx-to-redisson
date: 2022-07-20
category: 架构
tags:
  - Redis
  - 分布式锁
  - Redisson
  - 高并发
  - 后端开发
description: 从一次活动库存超卖问题说起，梳理 Redis 分布式锁的完整演进过程，包括 SETNX 加锁、过期时间原子性、唯一标识防误删、Lua 脚本释放锁，以及 Redisson 的看门狗续期和可重入实现，最后讨论主从切换下的锁失效问题和业务兜底方案。
cover:
published: true
---

## 引言

之前整理缓存穿透、击穿、雪崩的时候，在缓存击穿的方案里提到过一句：用互斥锁重建缓存。当时代码里直接写了 `redisLock.tryLock(...)`，把加锁细节一笔带过了。

这篇文章就把这个坑填上，专门讲 Redis 分布式锁。

分布式锁是多实例部署后绕不开的问题。单机时代一个 `synchronized` 能解决的事情，部署两台实例之后就不灵了。而 Redis 因为大部分项目本来就在用，性能也够，通常是分布式锁的第一选择。

相关资料：

- Redis SET 命令文档：[SET | Redis Docs](https://redis.io/docs/latest/commands/set/)；
- Redisson 项目地址：[redisson/redisson](https://github.com/redisson/redisson)。

不过 Redis 分布式锁想真正做对并不容易。从最简单的 SETNX 到能上生产的方案，中间有一连串的坑。这篇文章按演进顺序一个个过，最后落到 Redisson。

## 从一次库存超卖说起

先看一个真实场景。

运营搞了一个活动，某个商品限量 100 件。扣库存的代码大致是这样：

```java
public boolean deductStock(Long productId) {
    Integer stock = stockMapper.selectStockById(productId);
    if (stock == null || stock <= 0) {
        return false;
    }
    stockMapper.updateStock(productId, stock - 1);
    return true;
}
```

先查库存，判断大于 0，再更新。逻辑看起来没问题，测试环境也验证过。

活动开始后，库存扣成了负数，实际卖出去 108 件。

### 为什么会超卖？

问题出在“先查再改”这两步不是原子的。

```text
线程 A 查询库存，stock = 1
线程 B 查询库存，stock = 1
线程 A 判断通过，更新库存为 0
线程 B 判断通过，更新库存为 0
-> 库存只有 1 件，却成交了 2 单
```

并发一高，查询和更新之间的时间窗口就会被别的请求插进来。

### 加 synchronized 有用吗？

第一反应可能是加 JVM 锁：

```java
public synchronized boolean deductStock(Long productId) {
    ...
}
```

如果应用只部署一台实例，这样确实能解决。但生产环境是两台实例挂在 Nginx 后面：

```text
请求 1 -> Nginx -> 实例 A -> synchronized 锁住实例 A 的线程
请求 2 -> Nginx -> 实例 B -> synchronized 锁住实例 B 的线程
-> 两把锁互不相干，A 和 B 还是可以同时扣库存
```

图：两台实例并发扣库存导致超卖的示意图

![](images/2026/07/24/redis-lock-oversell-flow-placeholder.png)

`synchronized` 和 `ReentrantLock` 的作用范围都是当前 JVM 进程。跨进程、跨机器的互斥，需要一个所有实例都能访问到的公共的“锁标记”，这就是分布式锁。

### 分布式锁的常见选型

| 方案 | 原理 | 特点 |
| --- | --- | --- |
| MySQL | 唯一索引或 `SELECT ... FOR UPDATE` | 实现简单，性能差，数据库压力大 |
| Redis | SETNX 抢占 Key | 性能好，实现要处理的细节多 |
| Zookeeper | 临时顺序节点 | 可靠性好，性能一般，需要额外维护 ZK 集群 |

大部分业务系统本来就依赖 Redis，性能也满足要求，所以 Redis 是最常见的选择。下面从最简单的写法开始演进。

## 一把合格的分布式锁要满足什么

先明确目标，后面每个版本都对照检查：

1. 互斥：同一时刻只有一个客户端能持有锁；
2. 防死锁：持有锁的客户端崩溃后，锁最终能被释放；
3. 谁加锁谁解锁：不能释放别人持有的锁；
4. 原子性：加锁、解锁的多个操作步骤不能被并发打断。

在此基础上，更进一步的要求还有可重入、自动续期、高可用，这些后面讲 Redisson 时再展开。

## 版本一：SETNX + DEL

SETNX 是 SET if Not eXists 的缩写：Key 不存在时才能设置成功。多个客户端同时 SETNX 同一个 Key，只有一个会成功，天然适合抢锁。

```text
SETNX lock:stock:1001 1   -> 返回 1，加锁成功
SETNX lock:stock:1001 1   -> 返回 0，加锁失败
DEL lock:stock:1001       -> 释放锁
```

用 `StringRedisTemplate` 实现：

```java
public boolean deductStock(Long productId) {
    String lockKey = "lock:stock:" + productId;

    Boolean locked = stringRedisTemplate.opsForValue().setIfAbsent(lockKey, "1");
    if (!Boolean.TRUE.equals(locked)) {
        return false;
    }

    try {
        Integer stock = stockMapper.selectStockById(productId);
        if (stock == null || stock <= 0) {
            return false;
        }
        stockMapper.updateStock(productId, stock - 1);
        return true;
    } finally {
        stringRedisTemplate.delete(lockKey);
    }
}
```

抢到锁的执行业务，抢不到的直接失败。互斥问题解决了。

### 问题：宕机导致死锁

假设某个实例刚执行完 `setIfAbsent`，还没走到 `finally`，进程被 kill 了，或者机器直接宕机：

```text
实例 A 加锁成功
实例 A 宕机，DEL 永远不会执行
-> lock:stock:1001 永远存在
-> 其他所有请求永远拿不到锁
```

这个 Key 会一直留在 Redis 里，业务彻底卡死，只能人工去删 Key。锁必须有过期时间兜底。

## 版本二：SETNX 后再 EXPIRE

给锁加上过期时间，最直接的想法是加锁后再设置：

```java
Boolean locked = stringRedisTemplate.opsForValue().setIfAbsent(lockKey, "1");
if (Boolean.TRUE.equals(locked)) {
    stringRedisTemplate.expire(lockKey, 10, TimeUnit.SECONDS);
}
```

看起来解决了，但 SETNX 和 EXPIRE 是两条命令。如果在两条命令中间宕机：

```text
实例 A 执行 SETNX 成功
实例 A 在执行 EXPIRE 之前宕机
-> 锁没有过期时间
-> 又变成死锁
```

概率虽然低，但这种“低概率必炸”的写法不能上生产。加锁和设置过期时间必须是一个原子操作。

## 版本三：SET NX EX 一条命令搞定

Redis 从 2.6.12 开始，SET 命令支持同时带上 NX 和 EX 参数：

```text
SET lock:stock:1001 1 NX EX 10
```

一条命令完成“不存在才设置 + 过期时间”，原子性由 Redis 保证。Java 里对应的重载方法：

```java
Boolean locked = stringRedisTemplate.opsForValue()
        .setIfAbsent(lockKey, "1", 10, TimeUnit.SECONDS);
```

到这里，互斥和防死锁都有了。这也是很多项目里实际在用的版本。但它还有一个隐藏问题：锁可能被别人误删。

### 问题：锁提前过期与误删

过期时间设了 10 秒，但业务不保证 10 秒内一定执行完。数据库偶尔抖动一下，一次慢 SQL 就可能超过 10 秒。这时会发生连环问题：

```text
0s   实例 A 加锁成功，过期时间 10 秒
10s  A 的业务还没执行完，锁自动过期
10s  实例 B 加锁成功，开始执行业务
12s  A 的业务执行完，执行 DEL 释放锁
     -> A 删掉的是 B 的锁！
12s  实例 C 加锁成功
     -> B 和 C 同时在执行业务，互斥被破坏
```

图：锁提前过期后被误删的时序示意图

![](images/2026/07/24/redis-lock-mistaken-delete-placeholder.png)

这里其实是两个问题：

1. 锁提前过期，导致两个客户端同时持有锁；
2. A 释放锁时删掉了 B 的锁，让并发进一步扩大。

第 2 个问题先解决：释放锁之前，先确认锁还是不是自己的。

## 版本四：唯一标识 + Lua 脚本释放

加锁时不再写死 value，而是放一个唯一标识，比如 UUID：

```java
String lockValue = UUID.randomUUID().toString();
Boolean locked = stringRedisTemplate.opsForValue()
        .setIfAbsent(lockKey, lockValue, 10, TimeUnit.SECONDS);
```

释放锁时，先判断 value 是不是自己的，是才删除：

```java
String value = stringRedisTemplate.opsForValue().get(lockKey);
if (lockValue.equals(value)) {
    stringRedisTemplate.delete(lockKey);
}
```

### GET 和 DEL 之间还有缝隙

上面的写法还是有并发问题。GET 和 DEL 是两步操作：

```text
实例 A 执行 GET，确认锁是自己的
就在此刻，锁刚好过期，实例 B 加锁成功
实例 A 执行 DEL
-> 还是删掉了 B 的锁
```

判断和删除必须是原子的。Redis 单条命令做不到“先比较再删除”，需要用 Lua 脚本。Redis 执行 Lua 脚本时不会被其他命令打断，天然原子。

```lua
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
else
    return 0
end
```

### 封装成工具类

把加锁、解锁封装起来：

```java
@Component
public class RedisLockUtil {

    private static final DefaultRedisScript<Long> UNLOCK_SCRIPT;

    static {
        UNLOCK_SCRIPT = new DefaultRedisScript<>();
        UNLOCK_SCRIPT.setScriptText(
                "if redis.call('get', KEYS[1]) == ARGV[1] then " +
                "    return redis.call('del', KEYS[1]) " +
                "else " +
                "    return 0 " +
                "end");
        UNLOCK_SCRIPT.setResultType(Long.class);
    }

    @Autowired
    private StringRedisTemplate stringRedisTemplate;

    public boolean tryLock(String lockKey, String lockValue, long expireSeconds) {
        Boolean locked = stringRedisTemplate.opsForValue()
                .setIfAbsent(lockKey, lockValue, expireSeconds, TimeUnit.SECONDS);
        return Boolean.TRUE.equals(locked);
    }

    public boolean unlock(String lockKey, String lockValue) {
        Long result = stringRedisTemplate.execute(
                UNLOCK_SCRIPT,
                Collections.singletonList(lockKey),
                lockValue);
        return Long.valueOf(1L).equals(result);
    }
}
```

业务代码：

```java
public boolean deductStock(Long productId) {
    String lockKey = "lock:stock:" + productId;
    String lockValue = UUID.randomUUID().toString();

    if (!redisLockUtil.tryLock(lockKey, lockValue, 10)) {
        return false;
    }

    try {
        Integer stock = stockMapper.selectStockById(productId);
        if (stock == null || stock <= 0) {
            return false;
        }
        stockMapper.updateStock(productId, stock - 1);
        return true;
    } finally {
        redisLockUtil.unlock(lockKey, lockValue);
    }
}
```

到这个版本，四个基本要求里的互斥、防死锁、谁加锁谁解锁、原子性都满足了。手写 Redis 分布式锁，写到这里才算及格。

## 版本五：锁续期问题，该看门狗出场了

版本四还遗留一个问题没解决：锁提前过期。

误删问题解决后，A 不会再删掉 B 的锁，但“A 还没执行完、B 就拿到锁”这个并发窗口仍然存在。根源在于过期时间不好定：

- 设短了，业务没执行完锁就飞了；
- 设长了，实例真宕机时，其他请求要干等很久才能拿到锁。

理想方案是：过期时间正常设置，比如 30 秒；只要持有锁的客户端还活着，就有一个后台任务定期给锁“续命”；客户端宕机了，续期任务也跟着消失，锁到期自动释放。

这个后台续期任务，一般叫看门狗（Watchdog）。

自己实现看门狗需要处理定时调度、任务取消、异常兜底，再加上可重入的话还要改数据结构，工作量不小。好在 Redisson 把这些都做好了。

## Redisson：生产级的 Redis 分布式锁

[Redisson](https://github.com/redisson/redisson) 是一个 Redis 客户端，和 Jedis、Lettuce 不同，它的定位是分布式服务框架，提供了大量分布式对象和工具，分布式锁只是其中之一。

### 引入依赖

```xml
<dependency>
    <groupId>org.redisson</groupId>
    <artifactId>redisson-spring-boot-starter</artifactId>
    <version>3.17.4</version>
</dependency>
```

starter 会复用 `application.yml` 里的 `spring.redis` 配置，也可以用 Config 单独配置：

```java
@Configuration
public class RedissonConfig {

    @Bean
    public RedissonClient redissonClient() {
        Config config = new Config();
        config.useSingleServer()
                .setAddress("redis://127.0.0.1:6379")
                .setDatabase(0);
        return Redisson.create(config);
    }
}
```

### 基本用法

用 Redisson 改写扣库存：

```java
@Autowired
private RedissonClient redissonClient;

public boolean deductStock(Long productId) {
    RLock lock = redissonClient.getLock("lock:stock:" + productId);

    boolean locked = false;
    try {
        locked = lock.tryLock(3, TimeUnit.SECONDS);
        if (!locked) {
            return false;
        }

        Integer stock = stockMapper.selectStockById(productId);
        if (stock == null || stock <= 0) {
            return false;
        }
        stockMapper.updateStock(productId, stock - 1);
        return true;
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return false;
    } finally {
        if (locked && lock.isHeldByCurrentThread()) {
            lock.unlock();
        }
    }
}
```

几个要点：

1. `tryLock(3, TimeUnit.SECONDS)` 表示最多等 3 秒，等不到就返回 false，不会无限阻塞；
2. 释放锁之前用 `isHeldByCurrentThread()` 判断，避免释放别人的锁时抛 `IllegalMonitorStateException`；
3. 前面手写版本的唯一标识、Lua 脚本释放，Redisson 内部都已经实现了。

### 看门狗机制

上面的 `tryLock` 没有传 leaseTime（锁持有时间），这时看门狗才会生效：

```text
加锁成功，锁过期时间默认 30 秒
-> 客户端启动定时任务，每 10 秒执行一次
-> 检查锁是否还被当前线程持有
-> 持有则把过期时间重置为 30 秒
-> 业务执行完 unlock，取消定时任务
-> 客户端宕机，定时任务消失，锁最多 30 秒后自动过期
```

默认 30 秒由 `lockWatchdogTimeout` 参数控制，续期间隔是它的三分之一。

图：Redisson 看门狗续期的日志截图

![](images/2026/07/24/redisson-watchdog-renew-log-placeholder.png)

有一个容易踩的坑：如果调用 `tryLock(3, 10, TimeUnit.SECONDS)` 这种显式传了 leaseTime 的重载，看门狗不会启动，锁到 10 秒就直接过期。想要自动续期，就不要传 leaseTime。

### 可重入是怎么实现的

RLock 是可重入锁，同一个线程可以重复加锁：

```java
RLock lock = redissonClient.getLock("lock:order:1001");
lock.lock();
try {
    lock.lock();
    try {
        ...
    } finally {
        lock.unlock();
    }
} finally {
    lock.unlock();
}
```

可重入需要记录“持有者是谁”和“重入了几次”，一个 String 结构存不下，所以 Redisson 用的是 Hash 结构：

```text
Key:   lock:order:1001
Field: 6f2c8a1b-...:-1（客户端 UUID + 线程 ID）
Value: 2（重入次数）
```

图：Redisson 可重入锁的 Hash 结构截图

![](images/2026/07/24/redisson-reentrant-hash-structure-placeholder.png)

加锁的逻辑同样是 Lua 脚本，大意是：

1. 锁不存在，创建 Hash，重入次数设为 1，设置过期时间；
2. 锁存在且 Field 是自己，重入次数加 1，刷新过期时间；
3. 锁存在且 Field 不是自己，返回剩余过期时间，表示加锁失败。

解锁时重入次数减 1，减到 0 才真正删除 Key。

### 等锁的线程在做什么

手写版本里，加锁失败后要么直接返回，要么 `Thread.sleep` 之后重试，本质是轮询。轮询的间隔不好定：太短浪费 Redis 资源，太长拿锁不及时。

Redisson 用的是 Redis 的发布订阅：加锁失败的线程订阅解锁频道，然后挂起等待；持有锁的客户端释放锁时会发布一条消息，等待的线程被唤醒后再去抢锁。相比轮询，无效请求少很多，唤醒也及时。

## 实践中的几个建议

### 锁粒度要细

锁的 Key 要带上业务维度，锁具体某个商品，而不是锁整个扣库存操作：

```text
推荐：lock:stock:1001（只有同一个商品的请求互斥）
不推荐：lock:stock（所有商品的扣库存全部串行）
```

粒度粗一档，吞吐可能就差一个数量级。

### 锁内的逻辑越少越好

只把必须互斥的操作放进锁里。查询参数、组装对象、发通知这类动作都应该放在锁外。锁内多一次 RPC，锁的持有时间就多一份不可控。

### 数据库层面留一道兜底

分布式锁不应该是防超卖的唯一防线。扣库存的 SQL 本身可以写成条件更新：

```sql
UPDATE t_stock
SET stock = stock - 1
WHERE product_id = #{productId} AND stock > 0
```

更新影响行数为 0 就代表扣减失败。就算锁出了问题，有两个请求同时进来，数据库这一层也能保证库存不会扣成负数。

Redis 锁负责挡住绝大部分并发，数据库兜底保证最坏情况下数据不出错，两层配合才稳。

## 主从切换下的锁失效问题

还有一个绕不开的话题：Redis 高可用架构下，锁本身可能丢。

生产环境的 Redis 一般是主从加哨兵。主从复制是异步的，于是存在这样的窗口：

```text
客户端 A 在主节点加锁成功
锁还没同步到从节点，主节点宕机
哨兵把从节点提升为新主节点
-> 新主节点上没有 A 的锁
客户端 B 在新主节点加锁成功
-> A 和 B 同时持有锁
```

Redis 官方对此给过一个方案叫 RedLock：部署 5 个独立的 Redis 节点，加锁时向所有节点发请求，超过半数（3 个）成功且总耗时小于锁有效期，才算加锁成功。

不过 RedLock 一直有争议。分布式系统领域的 Martin Kleppmann 专门写文章质疑过它在时钟跳变、进程暂停（比如长时间 GC）场景下的安全性，Redis 作者 antirez 也写了长文回应，两边谁也没说服谁。工程上的实际情况是：部署 5 个独立节点成本不低，大多数团队并没有采用。

我的理解是按业务要求分级：

1. 大部分业务：主从切换本身是低概率事件，切换瞬间恰好有锁冲突的概率更低，用普通 RLock 加数据库兜底已经够用；
2. 库存、账户这类资损敏感场景：必须有数据库唯一索引、条件更新或乐观锁做最终防线，不能把正确性完全押在 Redis 锁上；
3. 对锁的可靠性要求极高的场景：考虑 Zookeeper，用 CP 模型换性能。

## 常见误区

### 误区一：加了分布式锁就万无一失

前面已经看到，锁提前过期、主从切换都可能让互斥短暂失效。分布式锁的定位是把并发冲突降低几个数量级，最终的数据正确性要靠数据库层面的约束兜底。

### 误区二：过期时间设得越长越安全

过期时间太长，实例宕机后锁要等很久才释放，期间业务全部阻塞。用 Redisson 的话，把过期时间交给看门狗管理，比手动拍一个大数字合理得多。

### 误区三：所有场景都用 lock() 死等

`lock()` 拿不到锁会一直阻塞。秒杀、扣库存这类场景，抢不到锁往往意味着别人正在处理，快速失败返回“稍后重试”体验更好，也不会把线程池堆满。优先用带等待时间的 `tryLock`。

### 误区四：unlock 前不判断持有状态

`tryLock` 超时返回 false 后，如果代码路径没控制好还是走到了 `unlock()`，会抛 `IllegalMonitorStateException`。释放锁前先判断 `isHeldByCurrentThread()`，是更稳妥的写法。

## 总结

Redis 分布式锁的演进过程，其实就是不断发现问题、补上问题的过程：

```text
SETNX + DEL           -> 互斥有了，宕机会死锁
SETNX + EXPIRE        -> 两条命令不原子，还是可能死锁
SET NX EX             -> 原子加锁 + 过期时间，但锁会被误删
唯一标识 + Lua 释放    -> 不会误删了，但锁提前过期仍有并发窗口
看门狗自动续期         -> 业务没执行完就自动续命，宕机自动释放
```

Redisson 把这条演进路线的终点直接封装好了：原子加锁、唯一标识、Lua 释放、看门狗续期、可重入、发布订阅唤醒，开箱即用。实际项目里没有特殊理由，不建议手写分布式锁，直接用 Redisson。

最后再强调一次分层的思路：

```text
Redis 分布式锁：挡住绝大部分并发，保护数据库
数据库条件更新 / 唯一索引：最终防线，保证数据不出错
```

锁是手段，数据正确才是目的。设计方案时先想清楚“锁失效了会怎样”，把兜底做好，才敢说这个方案能上生产。
