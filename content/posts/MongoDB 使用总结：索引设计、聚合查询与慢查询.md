---
title: MongoDB 使用总结：索引设计、聚合查询与慢查询
slug: mongodb-index-aggregation-slow-query-practice
date: 2026-07-05
category: 开发
tags:
  - MongoDB
  - NoSQL
  - 索引设计
  - 聚合查询
  - 慢查询
  - 后端开发
description: MongoDB 适合存储结构灵活、读写频繁的文档数据，但集合数据量上来后，索引设计、查询条件、聚合管道和文档结构都会影响性能。内容结合操作日志、订单扩展信息等业务场景，整理 MongoDB 索引设计、聚合查询、分页、慢查询和 Java 后端接入中的常见经验。
cover:
published: true
---

## 什么时候会用到 MongoDB

后端项目里，核心交易数据通常还是放在 MySQL、Oracle、PostgreSQL 这类关系型数据库里。但有些数据结构不太固定，或者字段变化比较频繁，用 MongoDB 会更舒服。

常见场景：

- 操作日志；
- 用户行为记录；
- 订单扩展信息；
- 三方接口原始响应；
- 表单配置；
- 内容草稿；
- 设备上报数据；
- 商品扩展属性。

例如一个操作日志，字段可能长这样：

```json
{
  "userId": 1001,
  "module": "order",
  "action": "create",
  "bizId": "ORD202607050001",
  "requestIp": "10.0.0.12",
  "detail": {
    "amount": 99.90,
    "skuId": 2001,
    "channel": "web"
  },
  "createdAt": "2026-07-05T09:00:00Z"
}
```

`detail` 里的字段不一定固定。如果用关系型数据库，就要不断加字段，或者塞 JSON 字符串。MongoDB 的文档模型更适合这种结构。

MongoDB 官方文档可以查看：[MongoDB Manual](https://www.mongodb.com/docs/manual/)。
Java 后端常用 Spring Data MongoDB，文档地址：[Spring Data MongoDB](https://docs.spring.io/spring-data/mongodb/reference/)。

## 先把文档结构想清楚

MongoDB 是文档数据库，不是把关系型表直接换个地方存。

设计集合时，先问几个问题：

```text
最常见查询条件是什么
数据是否需要按时间范围查询
是否经常根据用户 ID 查询
是否需要按业务 ID 精确定位
文档会不会频繁更新
数组字段会不会无限增长
是否需要聚合统计
是否需要 TTL 自动过期
```

比如操作日志集合，常见查询可能是：

```text
按 userId 查询最近操作
按 bizId 查询某个订单相关日志
按 module + action 筛选
按 createdAt 时间范围分页
```

那文档结构可以这样设计：

```json
{
  "_id": "ObjectId",
  "userId": 1001,
  "module": "order",
  "action": "create",
  "bizId": "ORD202607050001",
  "requestIp": "10.0.0.12",
  "detail": {
    "amount": 99.90,
    "skuId": 2001,
    "channel": "web"
  },
  "createdAt": "ISODate"
}
```

不要把所有业务信息都塞进一个巨大的 `detail`，否则后面想建索引和查询会很难。

图：MongoDB Compass 操作日志文档结构截图

![](images/2026/07/05/mongodb-operation-log-document-placeholder.png)

## 内嵌还是引用

MongoDB 建模时经常纠结：关联数据是内嵌到一个文档里，还是拆成多个集合引用？

### 适合内嵌的场景

```text
数据生命周期一致
经常一起读取
子文档数量有限
子文档不会频繁单独更新
```

例如订单快照里保存收货地址：

```json
{
  "orderNo": "ORD202607050001",
  "amount": 99.90,
  "receiver": {
    "name": "Alice",
    "phone": "13800138000",
    "address": "Shanghai"
  }
}
```

这个地址是下单时的快照，和订单一起读取，内嵌比较合适。

### 适合引用的场景

```text
子数据数量很多
子数据会独立更新
多个文档共享同一份数据
需要单独查询子数据
```

例如用户信息不要完整内嵌到每条日志里，只保存 `userId` 和必要快照即可。

错误倾向是把 MongoDB 当成“无限嵌套 JSON 仓库”。如果数组无限增长，一个文档会越来越大，更新和读取都会变慢。

MongoDB 单文档大小限制是 16MB，官方说明：[BSON Document Size](https://www.mongodb.com/docs/manual/reference/limits/#bson-document-size)。

## 索引不是越多越好

MongoDB 没有合适索引时，查询会变成集合扫描。

例如：

```javascript
db.operation_log.find({ userId: 1001 }).sort({ createdAt: -1 }).limit(20)
```

如果没有索引，数据量上来后会很慢。

可以建立联合索引：

```javascript
db.operation_log.createIndex({ userId: 1, createdAt: -1 })
```

这样支持：

```text
按 userId 过滤
按 createdAt 倒序排序
取最近 20 条
```

索引文档：[Indexes](https://www.mongodb.com/docs/manual/indexes/)。

图：MongoDB Compass 索引列表截图

![](images/2026/07/05/mongodb-index-list-placeholder.png)

## 联合索引的字段顺序

MongoDB 联合索引也要注意字段顺序。

假设常见查询：

```javascript
db.operation_log.find({
  module: "order",
  action: "create",
  createdAt: {
    $gte: ISODate("2026-07-01T00:00:00Z"),
    $lt: ISODate("2026-08-01T00:00:00Z")
  }
}).sort({ createdAt: -1 })
```

可以考虑索引：

```javascript
db.operation_log.createIndex({ module: 1, action: 1, createdAt: -1 })
```

一般思路：

```text
等值过滤字段放前面
范围字段放后面
排序字段尽量和索引顺序匹配
```

但这不是绝对规则。还要看字段区分度和查询频率。

例如 `module` 只有几个值，区分度很低；`userId` 区分度更高。如果查询经常按用户维度查，索引 `{ userId: 1, createdAt: -1 }` 可能更有价值。

索引设计不要只看单条 SQL，要看接口访问频率和数据分布。

## explain 先看有没有 COLLSCAN

MongoDB 排查慢查询，第一步看 `explain()`。

```javascript
db.operation_log.find({
  userId: 1001
}).sort({ createdAt: -1 }).limit(20).explain("executionStats")
```

重点看：

```text
winningPlan.stage
totalDocsExamined
totalKeysExamined
executionTimeMillis
```

如果看到：

```text
stage: COLLSCAN
```

说明发生了集合扫描。

如果看到：

```text
stage: IXSCAN
```

说明使用了索引扫描。

理想情况下，`totalDocsExamined` 不应该远大于返回数量。

例如返回 20 条，却扫描 50 万条，就要检查索引和查询条件。

图：MongoDB explain executionStats 截图

![](images/2026/07/05/mongodb-explain-executionstats-placeholder.png)

## 分页别一直 skip

MongoDB 常见分页写法：

```javascript
db.operation_log.find({ userId: 1001 })
  .sort({ createdAt: -1 })
  .skip(100000)
  .limit(20)
```

深分页时，`skip` 会越来越慢。因为数据库需要跳过前面大量数据。

更推荐游标分页。

第一页：

```javascript
db.operation_log.find({ userId: 1001 })
  .sort({ createdAt: -1, _id: -1 })
  .limit(20)
```

下一页带上上一页最后一条的 `createdAt` 和 `_id`：

```javascript
db.operation_log.find({
  userId: 1001,
  $or: [
    { createdAt: { $lt: ISODate("2026-07-05T09:00:00Z") } },
    {
      createdAt: ISODate("2026-07-05T09:00:00Z"),
      _id: { $lt: ObjectId("6688f0c00000000000000001") }
    }
  ]
}).sort({ createdAt: -1, _id: -1 }).limit(20)
```

配套索引：

```javascript
db.operation_log.createIndex({ userId: 1, createdAt: -1, _id: -1 })
```

这种方式不适合随机跳页，但很适合“加载更多”。

图：MongoDB skip 深分页 explain 截图

![](images/2026/07/05/mongodb-skip-deep-pagination-explain-placeholder.png)

## 只返回需要的字段

MongoDB 文档可能很大，特别是有 `detail`、`requestBody`、`responseBody` 这类字段时。

列表页如果只展示基础信息，不要返回完整文档。

错误写法：

```javascript
db.operation_log.find({ userId: 1001 }).limit(20)
```

推荐写法：

```javascript
db.operation_log.find(
  { userId: 1001 },
  {
    module: 1,
    action: 1,
    bizId: 1,
    requestIp: 1,
    createdAt: 1
  }
).sort({ createdAt: -1 }).limit(20)
```

第二个参数是 projection，用来控制返回字段。

Java 中也要限制字段：

```java
Query query = new Query();
query.addCriteria(Criteria.where("userId").is(userId));
query.with(Sort.by(Sort.Direction.DESC, "createdAt"));
query.limit(20);

// 列表页只返回摘要字段，避免把 detail 大字段查出来
query.fields()
        .include("module")
        .include("action")
        .include("bizId")
        .include("requestIp")
        .include("createdAt");

List<OperationLog> logs = mongoTemplate.find(query, OperationLog.class);
```

这个优化在日志、接口报文、内容草稿这类大文档场景很明显。

## TTL 索引适合临时数据

有些数据不需要永久保存，比如：

- 临时验证码；
- 短期操作日志；
- 设备心跳；
- 临时任务记录；
- 过期会话。

MongoDB 支持 TTL 索引自动删除过期数据。文档：[TTL Indexes](https://www.mongodb.com/docs/manual/core/index-ttl/)。

例如操作日志只保留 90 天：

```javascript
db.operation_log.createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 7776000 }
)
```

`7776000` 秒约等于 90 天。

注意：TTL 删除不是精确到秒立即删除，而是后台线程定期扫描删除。

TTL 字段必须是 date 类型，不能是字符串。

图：MongoDB TTL 索引配置截图

![](images/2026/07/05/mongodb-ttl-index-placeholder.png)

## 聚合查询别一上来就 group

MongoDB 聚合很强大，但也容易写慢。

例如统计每个模块的操作次数：

```javascript
db.operation_log.aggregate([
  {
    $match: {
      createdAt: {
        $gte: ISODate("2026-07-01T00:00:00Z"),
        $lt: ISODate("2026-08-01T00:00:00Z")
      }
    }
  },
  {
    $group: {
      _id: "$module",
      count: { $sum: 1 }
    }
  },
  {
    $sort: { count: -1 }
  }
])
```

关键是 `$match` 要尽量放前面，先过滤数据，再聚合。

配套索引：

```javascript
db.operation_log.createIndex({ createdAt: 1, module: 1 })
```

如果先 `$group` 再 `$match`，会处理大量无关数据。

聚合管道优化原则：

```text
$match 尽量靠前
$project 尽早裁剪字段
$sort 尽量利用索引
$limit 尽量提前
$group 前减少数据量
```

图：MongoDB aggregate pipeline explain 截图

![](images/2026/07/05/mongodb-aggregate-pipeline-explain-placeholder.png)

## 聚合内存限制要注意

聚合查询如果涉及大量 `$sort`、`$group`，可能消耗较多内存。

可以开启磁盘临时文件：

```javascript
db.operation_log.aggregate([
  { $match: { module: "order" } },
  { $group: { _id: "$action", count: { $sum: 1 } } }
], { allowDiskUse: true })
```

`allowDiskUse` 可以避免内存不足导致聚合失败，但不代表查询就快。它只是允许落盘，可能更慢。

如果统计需求很重，可以考虑：

```text
提前离线汇总
写入时增量维护统计表
按天分桶统计
使用 Elasticsearch / ClickHouse 做分析查询
```

不要把 MongoDB 当成无限制的 OLAP 引擎。

## 数组字段索引要谨慎

MongoDB 支持数组字段索引，也就是 multikey index。

例如：

```json
{
  "articleId": 1001,
  "tags": ["Java", "MongoDB", "后端"]
}
```

创建索引：

```javascript
db.article.createIndex({ tags: 1 })
```

查询：

```javascript
db.article.find({ tags: "MongoDB" })
```

这很方便，但数组字段如果很大，索引项也会变多。

需要注意：

```text
数组不要无限增长
多数组字段联合索引要谨慎
频繁更新数组会增加写入成本
```

如果数组非常大，比如一个用户的所有行为 ID，不适合塞在一个文档数组里。更适合拆成独立集合。

## 慢查询日志怎么开

MongoDB 可以通过 profiler 记录慢查询。文档：[Database Profiler](https://www.mongodb.com/docs/manual/tutorial/manage-the-database-profiler/)。

查看当前 profiling 级别：

```javascript
db.getProfilingStatus()
```

设置记录超过 100ms 的慢查询：

```javascript
db.setProfilingLevel(1, { slowms: 100 })
```

查看慢查询：

```javascript
db.system.profile.find().sort({ ts: -1 }).limit(5).pretty()
```

常见字段：

| 字段 | 含义 |
| --- | --- |
| `op` | 操作类型 |
| `ns` | 命名空间，库和集合 |
| `millis` | 执行耗时 |
| `keysExamined` | 扫描索引键数量 |
| `docsExamined` | 扫描文档数量 |
| `nreturned` | 返回文档数量 |
| `planSummary` | 执行计划摘要 |

如果 `docsExamined` 很大但 `nreturned` 很小，通常说明索引不合适。

图：MongoDB system.profile 慢查询记录截图

![](images/2026/07/05/mongodb-system-profile-slow-query-placeholder.png)

## Java 后端里怎么写更稳

Spring Data MongoDB 常见写法：

```java
public List<OperationLog> listRecentLogs(Long userId, Instant before, int size) {
    int safeSize = Math.min(size, 100);

    Query query = new Query();
    query.addCriteria(Criteria.where("userId").is(userId));

    if (before != null) {
        // 游标分页：只查 before 之前的数据，避免深分页 skip
        query.addCriteria(Criteria.where("createdAt").lt(before));
    }

    query.with(Sort.by(Sort.Direction.DESC, "createdAt"));
    query.limit(safeSize);

    // 列表页裁剪大字段，避免返回 detail / requestBody 等内容
    query.fields()
            .include("module")
            .include("action")
            .include("bizId")
            .include("requestIp")
            .include("createdAt");

    return mongoTemplate.find(query, OperationLog.class);
}
```

这段代码有几个实践点：

```text
pageSize 做上限保护
用游标分页替代深分页
按 userId + createdAt 配套索引
列表页只返回必要字段
```

对应索引：

```javascript
db.operation_log.createIndex({ userId: 1, createdAt: -1 })
```

如果查询条件变多，不要盲目给每个字段单独建索引，要结合真实查询组合设计联合索引。

## 写入也会被索引影响

索引可以加快查询，但会拖慢写入。

每次插入或更新文档，MongoDB 都要维护相关索引。

如果一个集合建了很多索引：

```text
userId
bizId
module
action
createdAt
module + action + createdAt
userId + createdAt
bizId + createdAt
```

写入成本会明显增加，磁盘空间也会上涨。

所以索引要定期治理：

```javascript
db.operation_log.getIndexes()
```

查看索引使用情况可以结合 `$indexStats`：

```javascript
db.operation_log.aggregate([
  { $indexStats: {} }
])
```

如果某些索引长期没有使用，可以评估删除。

图：MongoDB indexStats 索引使用统计截图

![](images/2026/07/05/mongodb-indexstats-placeholder.png)

## ObjectId 的时间特性

MongoDB 默认 `_id` 是 ObjectId，它本身包含时间信息。

可以通过 ObjectId 大致判断创建时间，但业务里仍然建议显式保存 `createdAt`。

原因：

```text
业务时间和插入时间可能不同
迁移数据时 ObjectId 时间不一定准确
按业务时间查询更清晰
索引设计更直观
```

不要为了省一个字段就完全依赖 `_id` 表示业务时间。

## 事务要少用但不是不能用

MongoDB 支持事务，但不要把它当关系型数据库那样频繁使用多文档事务。

适合事务的场景：

```text
少量文档一致性更新
后台管理配置变更
状态流转需要强一致
```

不适合：

```text
高频大批量写入
长事务
大量集合跨表操作
```

如果业务强依赖复杂事务，关系型数据库可能更合适。

MongoDB 事务文档：[Transactions](https://www.mongodb.com/docs/manual/core/transactions/)。

## 一份建模和索引检查清单

设计 MongoDB 集合前，可以过一遍：

```text
文档会不会超过 16MB
数组字段是否可能无限增长
常见查询条件是什么
是否需要按时间范围查询
是否需要 TTL 自动删除
是否需要精确匹配字段
是否需要全文搜索
是否有聚合统计需求
是否有深分页风险
索引是否支持排序
写入频率能否接受索引成本
```

上线前检查：

```text
核心查询是否跑过 explain
是否存在 COLLSCAN
docsExamined 是否明显大于 nreturned
分页是否避免大 skip
是否只返回必要字段
慢查询 profiler 是否打开
是否有无用索引
是否需要归档历史数据
```

图：MongoDB 集合索引与查询检查截图

![](images/2026/07/05/mongodb-collection-index-check-placeholder.png)

## 收尾

MongoDB 的优势是文档结构灵活、开发效率高，但并不代表可以随意存、随意查。

几个经验比较重要：

```text
先按查询场景设计文档结构
高频查询必须有合适索引
联合索引字段顺序要结合过滤和排序
深分页少用 skip，多用游标分页
列表页不要返回大字段
聚合前先 match，尽早减少数据量
TTL 适合短生命周期数据
慢查询用 explain 和 profiler 排查
索引要治理，不能只加不删
```

MongoDB 用得好，可以很好地承接日志、扩展属性、灵活文档和半结构化数据。用不好，也很容易变成一个没有边界的大 JSON 仓库。

真正稳定的 MongoDB 使用方式，是在灵活性和查询约束之间找到平衡。
