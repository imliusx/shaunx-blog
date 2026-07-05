---
title: Redis 缓存使用入门：String、Hash、List 的常见业务场景
slug: redis-cache-basic-string-hash-list-use-cases
date: 2020-03-18
category: 开发
tags:
  - Redis
  - 缓存
  - 后端开发
  - 中间件
description: Redis 是后端开发中最常见的缓存组件之一。内容从 String、Hash、List 三种基础数据结构出发，结合验证码、用户信息缓存、计数器、购物车、消息列表等业务场景，整理 Redis 入门阶段最常用的使用方式和注意事项。
cover:
published: true
---

## 刚开始用 Redis，先别急着学太多命令

Redis 的数据结构很多：

```text
String
Hash
List
Set
ZSet
Stream
Bitmap
HyperLogLog
```

刚开始做业务开发，不需要一口气全部掌握。大多数普通接口缓存场景，先把 `String`、`Hash`、`List` 用熟，就能覆盖不少需求。

Redis 官方文档可以查看：[Redis Documentation](https://redis.io/docs/latest/)

常用命令可以查看：[Redis Commands](https://redis.io/docs/latest/commands/)。

这篇只讲三个最常用的结构：

```text
String：适合简单 key-value
Hash：适合对象字段缓存
List：适合有顺序的数据列表
```

## String：最常用的 key-value

String 是 Redis 中最基础的数据结构。

可以理解为：

```text
key -> value
```

常见命令：

```bash
SET user:name Shaunx
GET user:name
DEL user:name
EXPIRE user:name 60
```

带过期时间写入：

```bash
SET verify:code:13800138000 9527 EX 300
```

表示验证码 300 秒后过期。

图：Redis CLI SET 和 GET 验证码截图

![](images/2026/07/05/redis-string-set-get-code-placeholder.png)

## 场景一：验证码缓存

短信验证码、邮箱验证码都很适合用 String。

Key 设计：

```text
verify:code:{phone}
```

示例：

```text
verify:code:13800138000 -> 9527
```

Java 示例：

```java
public void saveVerifyCode(String phone, String code) {
    String key = "verify:code:" + phone;

    // 验证码通常只需要保存几分钟，必须设置过期时间
    redisTemplate.opsForValue().set(key, code, 5, TimeUnit.MINUTES);
}

public boolean checkVerifyCode(String phone, String inputCode) {
    String key = "verify:code:" + phone;
    String cachedCode = redisTemplate.opsForValue().get(key);

    if (!Objects.equals(cachedCode, inputCode)) {
        return false;
    }

    // 验证成功后删除，避免验证码被重复使用
    redisTemplate.delete(key);
    return true;
}
```

注意点：

```text
验证码必须设置过期时间
校验成功后删除
发送验证码要做限流
不要把验证码长期保存
```

## 场景二：接口结果缓存

有些查询接口比较频繁，但数据变化不快，比如商品详情、文章详情、配置项。

Key 设计：

```text
article:detail:{articleId}
```

示例：

```java
public ArticleDTO getArticleDetail(Long articleId) {
    String key = "article:detail:" + articleId;

    ArticleDTO cached = redisCache.get(key, ArticleDTO.class);
    if (cached != null) {
        return cached;
    }

    ArticleDTO article = articleMapper.selectById(articleId);
    if (article == null) {
        return null;
    }

    // 缓存 30 分钟，减少数据库查询压力
    redisCache.set(key, article, 30, TimeUnit.MINUTES);
    return article;
}
```

这种缓存适合读多写少。

如果文章被修改，要删除缓存：

```java
public void updateArticle(ArticleUpdateRequest request) {
    articleMapper.updateById(request);

    // 更新数据库后删除缓存，下次查询重新加载
    redisTemplate.delete("article:detail:" + request.getId());
}
```

不要只写缓存不处理更新，否则用户可能一直看到旧数据。

## 场景三：计数器

String 也可以用来做计数。

常见命令：

```bash
INCR article:view:1001
INCRBY article:view:1001 10
DECR stock:sku:2001
```

例如文章浏览量：

```java
public Long increaseViewCount(Long articleId) {
    String key = "article:view:" + articleId;

    // Redis 的 INCR 是原子操作，适合简单计数
    return redisTemplate.opsForValue().increment(key);
}
```

但要注意：Redis 计数和数据库最终要同步。

常见方式：

```text
Redis 实时累加
定时任务批量落库
落库后清理或保留 Redis 计数
```

如果是库存扣减这类强一致场景，不要只靠简单 `DECR` 就结束，还要考虑超卖、回滚和数据库一致性。

## Hash：适合缓存对象字段

Hash 可以理解为：

```text
key -> field -> value
```

例如用户信息：

```text
user:profile:1001
  name -> Shaunx
  age -> 25
  city -> Shanghai
```

常见命令：

```bash
HSET user:profile:1001 name Shaunx
HGET user:profile:1001 name
HGETALL user:profile:1001
HDEL user:profile:1001 city
```

图：Redis Hash HGETALL 用户信息截图

![](images/2026/07/05/redis-hash-user-profile-placeholder.png)

## 场景四：用户信息缓存

如果用户对象字段比较多，可以用 Hash。

```java
public void cacheUserProfile(UserDTO user) {
    String key = "user:profile:" + user.getId();

    Map<String, String> map = new HashMap<>();
    map.put("id", String.valueOf(user.getId()));
    map.put("username", user.getUsername());
    map.put("email", user.getEmail());
    map.put("avatar", user.getAvatarUrl());

    // 用 Hash 保存对象字段，适合读取部分字段
    redisTemplate.opsForHash().putAll(key, map);
    redisTemplate.expire(key, 30, TimeUnit.MINUTES);
}
```

读取单个字段：

```java
public String getUsername(Long userId) {
    String key = "user:profile:" + userId;

    // 只读取 username 字段，不必反序列化整个对象
    Object username = redisTemplate.opsForHash().get(key, "username");
    return username == null ? null : username.toString();
}
```

Hash 的好处：

```text
适合对象字段缓存
可以单独读取某个字段
可以单独修改某个字段
```

但如果对象很复杂、嵌套很多，直接存 JSON String 可能更简单。

## 场景五：购物车

购物车也常用 Hash。

Key：

```text
cart:{userId}
```

Field：

```text
skuId
```

Value：

```text
购买数量
```

示例：

```text
cart:1001
  20001 -> 2
  20002 -> 1
```

添加商品：

```java
public void addCartItem(Long userId, Long skuId, Integer count) {
    String key = "cart:" + userId;

    // 对某个商品数量做增量修改
    redisTemplate.opsForHash().increment(key, skuId.toString(), count);

    // 购物车可以设置较长过期时间，比如 30 天
    redisTemplate.expire(key, 30, TimeUnit.DAYS);
}
```

获取购物车：

```java
public Map<Object, Object> getCart(Long userId) {
    String key = "cart:" + userId;
    return redisTemplate.opsForHash().entries(key);
}
```

购物车是否适合完全放 Redis，要看业务要求。如果订单结算依赖购物车数据，最终仍然要和数据库或订单系统做好一致性处理。

## List：适合有顺序的数据

List 是有序列表，可以从两端插入和弹出。

常见命令：

```bash
LPUSH message:list:1001 hello
RPUSH message:list:1001 world
LRANGE message:list:1001 0 10
LPOP message:list:1001
RPOP message:list:1001
```

List 适合：

```text
最近消息
操作记录
简单队列
时间线列表
```

但如果要做可靠消息队列，Redis List 不是最完整方案。更复杂场景可以考虑 Redis Stream、RabbitMQ、Kafka。

## 场景六：最近操作记录

例如保存用户最近 20 条操作记录。

Key：

```text
user:recent:actions:{userId}
```

写入：

```java
public void addRecentAction(Long userId, String action) {
    String key = "user:recent:actions:" + userId;

    // 从左侧插入，最新记录排在最前面
    redisTemplate.opsForList().leftPush(key, action);

    // 只保留最近 20 条，避免列表无限增长
    redisTemplate.opsForList().trim(key, 0, 19);

    redisTemplate.expire(key, 7, TimeUnit.DAYS);
}
```

读取：

```java
public List<String> listRecentActions(Long userId) {
    String key = "user:recent:actions:" + userId;

    // 读取最近 20 条操作记录
    return redisTemplate.opsForList().range(key, 0, 19);
}
```

这里最重要的是 `trim`。

如果不裁剪，List 会越长越大。

## 场景七：简单异步队列

List 可以实现一个简单队列。

生产者：

```java
public void pushTask(String taskJson) {
    // 从右侧写入任务
    redisTemplate.opsForList().rightPush("task:queue", taskJson);
}
```

消费者：

```java
public String popTask() {
    // 从左侧弹出任务，实现先进先出
    return redisTemplate.opsForList().leftPop("task:queue", 5, TimeUnit.SECONDS);
}
```

这种方式适合低要求场景，比如本地小工具、简单异步任务。

不适合强可靠场景，因为你还要考虑：

```text
消费者取出任务后宕机怎么办
任务失败怎么重试
消息有没有死信
消息是否需要确认
是否需要延迟消息
```

如果是核心业务异步任务，优先考虑 RabbitMQ、Kafka 或 Redis Stream。

## Key 命名要有规范

Redis 用久了，如果 Key 命名混乱，会非常难维护。

推荐格式：

```text
业务:类型:标识
```

例如：

```text
verify:code:13800138000
article:detail:1001
article:view:1001
user:profile:1001
cart:1001
user:recent:actions:1001
```

不要写成：

```text
code13800138000
user1001
abc:1
```

清晰的 Key 命名有几个好处：

```text
方便排查
方便批量定位
方便设置不同过期策略
方便团队协作
```

生产环境不要随便使用 `KEYS *`，数据多时可能阻塞 Redis。排查时可以用 `SCAN`。

```bash
SCAN 0 MATCH user:profile:* COUNT 100
```

## 过期时间不要忘

很多缓存都应该有 TTL。

常见 TTL：

| 数据 | 建议 |
| --- | --- |
| 验证码 | 3~5 分钟 |
| 登录态 | 根据业务，一般数小时到数天 |
| 用户信息缓存 | 10~60 分钟 |
| 文章详情 | 10~60 分钟 |
| 空值缓存 | 1~5 分钟 |
| 最近操作 | 数天 |

如果缓存不设置过期时间，Redis 内存会越来越大。

查看 TTL：

```bash
TTL article:detail:1001
```

设置 TTL：

```bash
EXPIRE article:detail:1001 1800
```

## 入门阶段最容易踩的坑

### 1. 只写缓存，不处理更新

数据库改了，缓存没删，用户看到旧数据。

更新数据后至少要删除对应缓存。

### 2. Key 没有过期时间

临时数据长期留在 Redis，内存慢慢被打满。

### 3. 使用 KEYS 查生产数据

`KEYS` 会扫描所有 Key，生产环境慎用。

### 4. List 不裁剪

最近记录、消息列表不做 `LTRIM`，会无限增长。

### 5. 把 Redis 当数据库用

Redis 很快，但它不是所有数据的最终归属。核心数据仍然要落到可靠存储里。

## 收尾

Redis 入门阶段，先把三个结构用熟就够了：

```text
String：验证码、接口缓存、计数器
Hash：用户信息、购物车、对象字段
List：最近记录、简单队列、有序列表
```

同时记住几个基本原则：

```text
Key 命名要清晰
缓存要设置 TTL
更新数据要处理缓存
集合类数据要控制长度
生产环境少用 KEYS
核心业务不要只依赖 Redis
```

