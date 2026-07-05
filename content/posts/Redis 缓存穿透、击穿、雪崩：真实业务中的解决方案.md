---
title: Redis 缓存穿透、击穿、雪崩：真实业务中的解决方案
slug: redis-cache-penetration-breakdown-avalanche-solutions
date: 2022-06-15
category: 架构
tags:
  - Redis
  - 缓存
  - 高并发
  - 架构设计
  - 后端开发
description: Redis 是后端系统中最常用的缓存组件之一，但在高并发场景下，缓存穿透、缓存击穿和缓存雪崩很容易把请求压力直接打到数据库。内容结合真实业务场景，整理三类缓存问题的产生原因、典型表现、解决方案和落地注意事项。
cover:
published: true
---

## 引言

Redis 在后端系统中非常常见，登录态、热点数据、排行榜、分布式锁、限流计数、接口结果缓存，都可能用到它。Redis 官方文档可以查看：[Redis Documentation](https://redis.io/docs/latest/)，常用命令可以查看：[Redis Commands](https://redis.io/docs/latest/commands/)。

很多接口刚开始只查数据库也没问题，但数据量和访问量上来后，数据库压力会明显增加。此时加一层 Redis 缓存，通常能把大部分读请求挡在数据库之前。

不过，缓存不是银弹。缓存设计不合理时，反而会把问题放大。最典型的就是三类问题：

- 缓存穿透；
- 缓存击穿；
- 缓存雪崩。

这三个概念名字相似，但触发原因和解决方案并不完全一样。实际工作中，如果能把它们区分清楚，很多线上缓存问题就能更快定位和处理。

## 缓存的基本查询流程

常见的缓存查询逻辑如下：

```text
请求进入
-> 查询 Redis
-> 命中缓存，直接返回
-> 未命中缓存，查询数据库
-> 数据库有数据，写入 Redis
-> 返回结果
```

对应 Java 伪代码：

```java
public UserDTO getUserById(Long userId) {
    String cacheKey = "user:" + userId;

    UserDTO user = redisTemplate.opsForValue().get(cacheKey);
    if (user != null) {
        return user;
    }

    user = userMapper.selectById(userId);
    if (user != null) {
        redisTemplate.opsForValue().set(cacheKey, user, 30, TimeUnit.MINUTES);
    }

    return user;
}
```

图：Redis Key 命中率监控截图

![](images/2026/07/04/redis-cache-hit-rate-monitor-placeholder.png)

这段逻辑在低并发下看起来没什么问题，但到了高并发场景，就可能出现一些边界问题。

## 缓存穿透

### 什么是缓存穿透？

缓存穿透指的是：请求查询一个缓存和数据库中都不存在的数据，导致每次请求都会绕过缓存，直接访问数据库。

典型场景：

```text
查询 userId = -1
-> Redis 不存在
-> MySQL 也不存在
-> 不写缓存
-> 下次同样请求继续查 MySQL
```

如果有人恶意构造大量不存在的 ID，例如：

```text
user:-1
user:-2
user:999999999
user:abcdef
```

这些请求都会落到数据库上。请求量一大，数据库就可能被打满。

### 缓存穿透的典型表现

缓存穿透通常有几个特征：

1. Redis 命中率下降；
2. 数据库 QPS 异常升高；
3. 查询参数中出现大量不存在的值；
4. 慢 SQL 或数据库连接数突然增加；
5. 接口大量返回空结果或 404。

### 解决方案一：缓存空值

最常用的方案是缓存空值。

当数据库中也查不到数据时，不是什么都不做，而是把“空结果”也写入 Redis，并设置较短过期时间。

```java
public UserDTO getUserById(Long userId) {
    String cacheKey = "user:" + userId;

    String json = redisTemplate.opsForValue().get(cacheKey);
    if (json != null) {
        if ("NULL".equals(json)) {
            return null;
        }
        return JSON.parseObject(json, UserDTO.class);
    }

    UserDTO user = userMapper.selectById(userId);
    if (user == null) {
        redisTemplate.opsForValue().set(cacheKey, "NULL", 5, TimeUnit.MINUTES);
        return null;
    }

    redisTemplate.opsForValue().set(cacheKey, JSON.toJSONString(user), 30, TimeUnit.MINUTES);
    return user;
}
```

这样同一个不存在的 ID 在短时间内再次访问时，就不会继续打到数据库。

优点：

- 实现简单；
- 对业务侵入小；
- 适合大部分查询场景。

缺点：

- 会额外占用 Redis 空间；
- 如果攻击参数非常分散，仍可能产生大量空值 Key；
- 数据后来被创建时，需要注意删除对应空缓存。

### 解决方案二：布隆过滤器

布隆过滤器适合判断一个数据“可能存在”或“一定不存在”。

它的特点是：

- 判断不存在时，结果一定可靠；
- 判断存在时，可能存在误判；
- 占用内存较小，适合大规模 ID 判断。

缓存查询流程可以调整为：

```text
请求进入
-> 先查布隆过滤器
-> 一定不存在，直接返回
-> 可能存在，再查 Redis
-> Redis 未命中，再查数据库
```

图：布隆过滤器判断过程示意图

![](images/2026/07/04/redis-bloom-filter-check-placeholder.png)

伪代码：

```java
public ProductDTO getProductById(Long productId) {
    String bloomKey = "product:bloom";

    boolean exists = bloomFilter.mightContain(bloomKey, productId);
    if (!exists) {
        return null;
    }

    String cacheKey = "product:" + productId;
    ProductDTO product = redisCache.get(cacheKey, ProductDTO.class);
    if (product != null) {
        return product;
    }

    product = productMapper.selectById(productId);
    if (product != null) {
        redisCache.set(cacheKey, product, 30, TimeUnit.MINUTES);
    }
    return product;
}
```

布隆过滤器更适合商品、文章、用户这类 ID 集合相对明确的场景。

### 缓存穿透实践建议

实际项目中，通常会组合使用：

1. 参数校验；
2. 缓存空值；
3. 布隆过滤器；
4. 接口限流；
5. 黑名单策略。

例如用户 ID 必须是正整数，手机号必须符合格式，订单号必须满足长度和前缀规则。这类校验越靠前，系统压力越小。

## 缓存击穿

### 什么是缓存击穿？

缓存击穿指的是：某个热点 Key 在过期瞬间，大量并发请求同时访问该 Key，导致这些请求同时打到数据库。

典型场景：

```text
热门商品 product:1001 过期
-> 1 万个请求同时进来
-> Redis 都未命中
-> 1 万个请求同时查数据库
-> 数据库压力瞬间升高
```

缓存击穿的重点是：

> 单个热点 Key 失效，引发大量请求集中访问数据库。

它和缓存穿透不同。穿透查询的是不存在的数据；击穿查询的是存在的热点数据，只是缓存刚好失效。

### 缓存击穿的典型表现

1. 某个热点接口突然变慢；
2. Redis 中某个热点 Key 刚好过期；
3. 数据库某条记录或某类查询 QPS 突增；
4. 过一段时间后接口又自动恢复；
5. 问题容易在秒杀、活动页、首页推荐等场景出现。

### 解决方案一：互斥锁重建缓存

最常见的做法是加互斥锁。缓存失效后，只允许一个线程去查数据库并重建缓存，其他线程等待或稍后重试。

伪代码：

```java
public ProductDTO getHotProduct(Long productId) {
    String cacheKey = "product:" + productId;
    ProductDTO product = redisCache.get(cacheKey, ProductDTO.class);
    if (product != null) {
        return product;
    }

    String lockKey = "lock:product:" + productId;
    boolean locked = redisLock.tryLock(lockKey, 10, TimeUnit.SECONDS);

    try {
        if (locked) {
            product = redisCache.get(cacheKey, ProductDTO.class);
            if (product != null) {
                return product;
            }

            product = productMapper.selectById(productId);
            if (product != null) {
                redisCache.set(cacheKey, product, 30, TimeUnit.MINUTES);
            }
            return product;
        }

        Thread.sleep(50);
        return redisCache.get(cacheKey, ProductDTO.class);
    } finally {
        if (locked) {
            redisLock.unlock(lockKey);
        }
    }
}
```

这里有一个细节：拿到锁后需要再查一次缓存，也就是“双重检查”。因为可能在当前线程拿到锁之前，其他线程已经把缓存重建好了。

优点：

- 数据一致性较好；
- 能明显减少数据库瞬时压力；
- 适合热点 Key 重建。

缺点：

- 实现复杂度比普通缓存高；
- 需要处理锁超时、释放锁、异常情况；
- 等待线程可能短时间内拿不到数据。

### 解决方案二：热点 Key 永不过期

对于特别核心的热点数据，可以设置逻辑过期，而不是依赖 Redis 自动删除。

数据结构示例：

```json
{
  "data": {
    "id": 1001,
    "name": "热门商品"
  },
  "expireTime": "2026-07-04 23:00:00"
}
```

查询逻辑：

```text
读取缓存
-> 缓存不存在，查数据库并写入
-> 缓存存在，判断逻辑过期时间
-> 未过期，直接返回
-> 已过期，先返回旧数据，再异步刷新缓存
```

伪代码：

```java
public ProductDTO getHotProduct(Long productId) {
    String cacheKey = "product:" + productId;
    CacheData<ProductDTO> cacheData = redisCache.get(cacheKey, CacheData.class);

    if (cacheData == null) {
        return rebuildCache(productId);
    }

    ProductDTO product = cacheData.getData();
    if (cacheData.getExpireTime().isAfter(LocalDateTime.now())) {
        return product;
    }

    String lockKey = "lock:product:" + productId;
    if (redisLock.tryLock(lockKey, 10, TimeUnit.SECONDS)) {
        executorService.submit(() -> {
            try {
                rebuildCache(productId);
            } finally {
                redisLock.unlock(lockKey);
            }
        });
    }

    return product;
}
```

这种方式可以让用户请求不阻塞，但可能短时间读到旧数据。

适合场景：

- 首页配置；
- 热门商品；
- 榜单数据；
- 活动页信息；
- 对短暂旧数据容忍度较高的场景。

### 缓存击穿实践建议

如果业务要求强一致，可以用互斥锁重建缓存。

如果业务更关注高可用和低延迟，可以用逻辑过期加异步刷新。

对于热点数据，还可以配合：

1. 服务启动时预热缓存；
2. 定时任务提前刷新；
3. 本地缓存兜底；
4. 降级返回默认数据。

## 缓存雪崩

### 什么是缓存雪崩？

缓存雪崩指的是：大量缓存 Key 在同一时间失效，或者 Redis 整体不可用，导致大量请求直接访问数据库，引发数据库压力暴涨。

典型场景：

```text
大量 Key 设置了相同过期时间
-> 00:00:00 同时过期
-> 请求集中打到数据库
-> 数据库连接池耗尽
-> 接口超时
-> 服务雪崩
```

还有一种情况是 Redis 集群故障：

```text
Redis 不可用
-> 所有缓存请求失败
-> 流量全部落到数据库
-> 数据库被打满
```

缓存雪崩的特点是影响范围大，不是某一个 Key 的问题，而是一批 Key 或整个缓存层的问题。

图：大量 Key 同时过期的监控截图

![](images/2026/07/04/redis-expired-keys-monitor-placeholder.png)

### 缓存雪崩的典型表现

1. 大量接口同时变慢；
2. Redis 命中率突然下降；
3. 数据库 QPS 和连接数快速升高；
4. 应用线程池、连接池出现排队；
5. 多个服务出现级联超时。

### 解决方案一：过期时间加随机值

不要让大量 Key 同一时间过期。

错误示例：

```java
redisTemplate.opsForValue().set(key, value, 30, TimeUnit.MINUTES);
```

如果一批数据同时写入，30 分钟后也会同时过期。

推荐写法：

```java
int baseExpire = 30 * 60;
int randomExpire = ThreadLocalRandom.current().nextInt(0, 300);
redisTemplate.opsForValue().set(key, value, baseExpire + randomExpire, TimeUnit.SECONDS);
```

这样可以把过期时间打散，降低同一时刻集中失效的概率。

### 解决方案二：缓存预热

对于热点数据，不要等用户请求来了才加载缓存。可以在系统启动、活动开始前或定时任务中提前写入 Redis。

适合预热的数据：

- 首页配置；
- 热门商品；
- 活动库存；
- 榜单数据；
- 字典配置；
- 权限菜单。

示例：

```java
@Component
public class CacheWarmUpRunner implements ApplicationRunner {

    @Override
    public void run(ApplicationArguments args) {
        List<ProductDTO> hotProducts = productMapper.selectHotProducts();
        for (ProductDTO product : hotProducts) {
            String key = "product:" + product.getId();
            redisCache.set(key, product, randomExpireSeconds());
        }
    }

    private long randomExpireSeconds() {
        return 1800 + ThreadLocalRandom.current().nextInt(300);
    }
}
```

### 解决方案三：多级缓存

对于读多写少、访问频率高的数据，可以设计多级缓存：

```text
本地缓存 Caffeine
-> Redis 分布式缓存
-> MySQL 数据库
```

图：Caffeine 本地缓存配置示例截图

![](images/2026/07/04/caffeine-local-cache-config-placeholder.png)

本地缓存可以减少 Redis 压力，Redis 可以减少数据库压力。即使 Redis 短暂抖动，本地缓存也能承接一部分流量。

不过多级缓存会带来一致性问题，需要根据业务场景决定是否使用。

适合场景：

- 字典数据；
- 配置数据；
- 热点商品信息；
- 用户权限信息；
- 更新频率低的数据。

### 解决方案四：限流、降级和熔断

缓存雪崩时，如果所有请求都继续打数据库，很容易造成数据库被拖垮。

因此系统需要保护机制：

1. 限流：控制进入系统的请求量；
2. 降级：返回默认值、兜底数据或友好提示；
3. 熔断：依赖持续失败时，短时间内快速失败；
4. 超时控制：避免线程长时间阻塞；
5. 连接池隔离：避免某个依赖拖垮整个应用。

常见工具包括：

- [Sentinel](https://github.com/alibaba/Sentinel/wiki)；
- [Resilience4j](https://resilience4j.readme.io/docs)；
- Hystrix（维护模式，不建议新项目优先使用）。

### 解决方案五：Redis 高可用

如果 Redis 本身不可用，业务缓存层就会失效。因此生产环境通常需要 Redis 高可用方案。

Redis 集群相关能力可以查看官方文档：[Redis Clustering](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)。

常见方案：

| 方案 | 特点 |
| --- | --- |
| 主从复制 | 读写分离基础能力，主节点故障需要切换 |
| Sentinel | 支持故障检测和自动主从切换 |
| Cluster | 数据分片，支持更大容量和更高吞吐 |
| 云 Redis | 运维成本低，依赖云厂商能力 |

Redis 高可用不能解决所有缓存问题，但可以降低缓存层整体不可用的概率。

## 三类问题对比

| 问题 | 核心原因 | 影响范围 | 典型解决方案 |
| --- | --- | --- | --- |
| 缓存穿透 | 查询不存在的数据 | 单个或大量无效参数 | 参数校验、缓存空值、布隆过滤器 |
| 缓存击穿 | 热点 Key 过期 | 单个热点 Key | 互斥锁、逻辑过期、缓存预热 |
| 缓存雪崩 | 大量 Key 同时过期或 Redis 故障 | 大面积缓存失效 | 随机过期、预热、多级缓存、限流降级、高可用 |

图：Redis 慢查询与命中率监控面板

![](images/2026/07/04/redis-slowlog-hit-rate-dashboard-placeholder.png)

## 业务落地方案

在真实项目中，很少只使用一种方案。更常见的是按数据类型分层治理。

### 普通详情数据

例如普通商品详情、文章详情、用户基础信息。

建议方案：

1. 缓存正常数据；
2. 缓存空值，过期时间设置短一些；
3. 过期时间增加随机值；
4. 更新数据时删除缓存；
5. 查询参数做基础校验。

示例策略：

```text
正常数据 TTL：30 分钟 + 0~5 分钟随机值
空值数据 TTL：3~5 分钟
更新策略：先更新数据库，再删除缓存
```

### 热点数据

例如首页商品、活动商品、排行榜。

建议方案：

1. 提前预热缓存；
2. 使用逻辑过期；
3. 后台线程异步刷新；
4. 必要时增加本地缓存；
5. 配合限流和降级。

示例策略：

```text
Redis 不设置物理过期，业务字段控制逻辑过期
逻辑过期后先返回旧数据，再异步刷新缓存
刷新失败时保留旧数据并告警
```

### 安全风险较高的查询

例如根据手机号、邀请码、订单号查询。

建议方案：

1. 严格参数格式校验；
2. 非法请求直接拦截；
3. 对不存在数据缓存空值；
4. 高频异常参数加入黑名单；
5. 接口层增加限流。

## 缓存更新策略

缓存问题不只发生在读取阶段，更新策略也很重要。

常见策略有三种。

### 先更新数据库，再删除缓存

这是业务中比较常用的方案。

```text
更新数据库
-> 删除缓存
-> 下次查询重新加载缓存
```

优点：

- 实现简单；
- 一致性相对较好；
- 避免直接更新缓存带来的复杂性。

缺点：

- 短时间内可能有旧数据；
- 删除缓存失败需要补偿机制。

### 先删除缓存，再更新数据库

这种方式容易出现并发问题。

```text
线程 A 删除缓存
线程 B 查询数据库旧值并写入缓存
线程 A 更新数据库
```

最终缓存中可能还是旧值。因此不建议作为默认方案。

### 延迟双删

延迟双删是对“先更新数据库，再删除缓存”的补充。

```text
更新数据库
-> 删除缓存
-> 等待一小段时间
-> 再删除一次缓存
```

示例：

```java
public void updateProduct(ProductUpdateRequest request) {
    productMapper.updateById(request);

    String cacheKey = "product:" + request.getId();
    redisTemplate.delete(cacheKey);

    executorService.schedule(() -> {
        redisTemplate.delete(cacheKey);
    }, 500, TimeUnit.MILLISECONDS);
}
```

延迟时间需要结合业务接口耗时和数据库主从延迟评估，不能固定套用。

## 常见误区

### 误区一：所有数据都应该加缓存

缓存适合读多写少、查询成本高、可接受短暂不一致的数据。

如果数据本身访问频率很低，或者更新非常频繁，加缓存可能收益不大，反而增加复杂度。

### 误区二：缓存时间越长越好

TTL 太长会带来数据不一致风险；TTL 太短又可能导致缓存频繁失效。

建议根据业务类型设置：

| 数据类型 | 建议 TTL |
| --- | --- |
| 字典配置 | 较长，配合主动刷新 |
| 商品详情 | 中等，配合随机值 |
| 空值缓存 | 较短 |
| 热点数据 | 逻辑过期或主动刷新 |
| 强一致数据 | 谨慎使用缓存 |

### 误区三：Redis 很快，不需要监控

Redis 快不代表不会出问题。

至少要关注：

- QPS；
- 命中率；
- 内存使用；
- Key 过期数量；
- 慢查询；
- 网络延迟；
- 连接数；
- 主从同步状态。

### 误区四：加锁就能解决所有击穿问题

加锁会带来额外复杂度。如果锁粒度过大，可能影响吞吐；如果锁过期时间设置不合理，可能出现并发重建；如果释放锁不安全，可能误删别人的锁。

分布式锁需要注意：

1. 加锁要设置过期时间；
2. 解锁要校验锁持有者；
3. 锁粒度尽量细；
4. 锁超时时间要覆盖缓存重建时间；
5. 异常时要保证释放锁。

## 线上排查思路

遇到缓存相关故障时，可以按下面思路排查。

### 1. 看 Redis 命中率

命中率突然下降，通常说明缓存层出现异常：

- 大量 Key 过期；
- 查询参数异常；
- Redis 连接异常；
- 缓存 Key 生成规则变更。

### 2. 看数据库 QPS

数据库 QPS 突然升高，说明缓存没有挡住请求。

需要进一步确认：

- 是某个 SQL 突增；
- 还是整体查询都升高；
- 是否集中在某个接口；
- 是否存在异常参数攻击。

### 3. 看热点 Key

可以通过监控或采样查看是否存在热点 Key。

如果是单个 Key 请求特别高，更像缓存击穿或热点 Key 问题。

如果是一批 Key 同时失效，更像缓存雪崩。

### 4. 看接口错误和超时

缓存问题往往会引起连锁反应：

```text
缓存未命中增加
-> 数据库查询增加
-> 数据库变慢
-> 应用线程阻塞
-> 接口超时
-> 网关重试
-> 压力继续放大
```

所以排查时不能只看 Redis，还要同时看应用、数据库、网关和调用链。

## 总结

Redis 缓存能显著提升系统读性能，但缓存层设计不合理时，也会把风险集中放大。

缓存穿透、击穿、雪崩可以这样区分：

```text
穿透：查不存在的数据，请求绕过缓存打数据库
击穿：热点 Key 过期，大量请求瞬间打数据库
雪崩：大量 Key 同时失效或 Redis 故障，大面积请求打数据库
```

对应治理思路是：

```text
穿透：参数校验 + 缓存空值 + 布隆过滤器
击穿：互斥锁 + 逻辑过期 + 热点预热
雪崩：随机 TTL + 多级缓存 + 限流降级 + Redis 高可用
```

实际项目中要结合业务场景选择方案。普通详情页、热点活动页、后台查询接口、强一致交易数据，适合的缓存策略并不一样。

缓存的目标不是让所有请求都不查数据库，而是让系统在高并发下更稳定、更可控。设计缓存时，既要考虑性能，也要考虑一致性、可用性和故障兜底。
