---
title: Spark 作业性能优化：Shuffle、分区策略与资源参数
slug: spark-job-performance-optimization-shuffle-partition-resource
date: 2024-05-31
category: 开发
tags:
  - Spark
  - 大数据
  - Shuffle
  - 性能优化
  - Scala
description: Spark 作业变慢通常不是单个参数的问题，更多和 Shuffle、分区数、数据倾斜、缓存策略、Executor 资源配置和慢任务有关。内容通过一次离线统计任务变慢的排查过程，整理 Spark UI 分析、Shuffle 优化、分区调整、缓存使用和资源参数配置思路。
cover:
published: true
---

## 一个离线任务突然跑不动了

有个统计任务，平时每天凌晨跑一次，主要做几件事：

```text
读取订单明细
关联用户维表
按店铺、日期、渠道聚合
写入 Hive 结果表
```

刚上线时，数据量不大，任务 20 分钟左右就能跑完。过了几个月，数据量涨上来后，耗时变成 2 小时，偶尔甚至超过 3 小时。

任务没有报错，只是慢。

这类问题在 Spark 里很常见。代码还能跑，不代表代码写得合理；集群能跑完，不代表资源用得高效。

Spark 官方文档可以查看：[Apache Spark Documentation](https://spark.apache.org/docs/latest/)。

排查 Spark 慢任务，最重要的入口不是直接改参数，而是先看 Spark UI。

## 先看 Spark UI，而不是先改参数

Spark 任务慢，一上来就调大 Executor 或加机器，往往只是把问题掩盖掉。

先打开 Spark UI，看几个页面：

```text
Jobs
Stages
SQL / DataFrame
Executors
Storage
Environment
```

重点关注：

- 哪个 Stage 最慢；
- 是否有大量 Shuffle Read / Shuffle Write；
- Task 时间是否差异很大；
- 是否有数据倾斜；
- 是否有频繁 GC；
- Executor 是否有失败或丢失；
- 缓存是否真的生效。

图：Spark UI Stages 页面 Shuffle Read/Write 截图

![](images/2026/07/05/spark-ui-stages-shuffle-placeholder.png)

这次慢任务里，Spark UI 上最明显的问题是：某个聚合 Stage 耗时特别长，而且 Task 时间差异很大。

有些 Task 几十秒完成，有一个 Task 跑了 40 多分钟。

这基本可以怀疑：数据倾斜或分区不合理。

## 先把任务逻辑简化出来

原始逻辑大概是这样：

```scala
val orders = spark.table("dwd_order_detail")
  .where("dt = '2026-07-04'")

val users = spark.table("dim_user")

val result = orders
  .join(users, Seq("user_id"), "left")
  .groupBy("shop_id", "dt", "channel")
  .agg(
    count("order_id").as("order_count"),
    sum("amount").as("total_amount")
  )

result.write.mode("overwrite").insertInto("ads_shop_order_summary")
```

看起来很普通：过滤、join、groupBy、写结果。

但 Spark 里最容易慢的地方，恰好就在：

```text
join
groupBy
orderBy
distinct
repartition
```

这些操作大概率会触发 Shuffle。

## Shuffle 为什么贵

Shuffle 可以简单理解为：数据需要按 key 重新分布到不同节点上。

例如 `groupBy("shop_id")`，同一个 `shop_id` 的数据必须被送到同一个 reduce 任务里，才能完成聚合。

这个过程会产生：

```text
磁盘写
网络传输
磁盘读
序列化和反序列化
大量小文件
排序或哈希聚合
```

所以 Shuffle 往往是 Spark 作业最贵的部分。

图：Spark Shuffle Read Size 异常偏高截图

![](images/2026/07/05/spark-shuffle-read-size-high-placeholder.png)

如果一个任务慢，Spark UI 里又看到 Shuffle Read / Write 很大，基本就要围绕 Shuffle 排查。

## 分区数太少，会让单个 Task 很重

Spark SQL 默认 Shuffle 分区数由这个参数控制：

```text
spark.sql.shuffle.partitions
```

默认值通常是 200。

这个值不一定适合所有任务。

如果数据量很大，200 个分区可能太少，导致每个 Task 处理的数据过多。

查看当前配置：

```scala
spark.conf.get("spark.sql.shuffle.partitions")
```

调整示例：

```scala
spark.conf.set("spark.sql.shuffle.partitions", "800")
```

但分区数也不是越大越好。

分区太多会导致：

```text
Task 数量过多
调度开销变大
小文件变多
Driver 压力增加
```

一个粗略判断方式：

```text
每个 Shuffle 分区数据量控制在 128MB ~ 256MB 左右
```

实际要结合集群资源和任务类型压测。

## 分区数怎么估算

假设某个 Shuffle Stage 的输入数据大约 200GB，希望每个分区 256MB。

估算：

```text
200GB = 204800MB
204800 / 256 = 800
```

可以先把 `spark.sql.shuffle.partitions` 设置为 800。

```bash
--conf spark.sql.shuffle.partitions=800
```

如果是 2TB 数据，200 个分区就明显太少。

不要只用默认值，也不要所有任务都统一一个值。

更好的方式是根据任务数据量分级：

| 数据量 | Shuffle 分区参考 |
| --- | --- |
| 几 GB | 100 ~ 200 |
| 几十 GB | 200 ~ 500 |
| 几百 GB | 500 ~ 1500 |
| TB 级 | 1500+，结合集群资源调整 |

这只是初始值，最终还是看 Spark UI。

图：spark.sql.shuffle.partitions 配置截图

![](images/2026/07/05/spark-sql-shuffle-partitions-config-placeholder.png)

## 分区数太多，也会写出大量小文件

调大 Shuffle 分区后，可能出现另一个问题：输出文件特别多。

例如写 Hive 表时，每个分区任务都可能生成一个文件。

如果结果表每天生成几千个小文件，后续查询会变慢，NameNode 压力也会增加。

写结果前可以适当合并分区：

```scala
result
  // 输出结果数据量不大时，写表前减少分区，避免小文件过多
  .coalesce(50)
  .write
  .mode("overwrite")
  .insertInto("ads_shop_order_summary")
```

`coalesce` 和 `repartition` 区别：

| 方法 | 是否 Shuffle | 场景 |
| --- | --- | --- |
| `coalesce` | 通常不触发 Shuffle | 减少分区 |
| `repartition` | 触发 Shuffle | 增加分区或按字段重分区 |

如果只是写出结果前减少文件数，优先考虑 `coalesce`。

## 数据倾斜比参数更麻烦

这次任务真正的问题不是单纯分区数，而是数据倾斜。

Spark UI 里某个 Stage 的 Task 分布类似：

```text
Task 1   30s
Task 2   35s
Task 3   28s
Task 4   41min
```

这种情况说明部分 key 的数据量远大于其他 key。

常见倾斜来源：

```text
某个 shop_id 订单量特别大
某个 user_id 是默认值 0
某个 channel 大量为空
join key 存在热点
脏数据导致 key 过于集中
```

先用 SQL 看一下 key 分布：

```sql
SELECT shop_id, COUNT(*) AS cnt
FROM dwd_order_detail
WHERE dt = '2026-07-04'
GROUP BY shop_id
ORDER BY cnt DESC
LIMIT 20;
```

如果第一名比其他 key 高几个数量级，就说明倾斜明显。

图：Spark UI Task Duration 数据倾斜截图

![](images/2026/07/05/spark-ui-task-duration-skew-placeholder.png)

## 处理 groupBy 倾斜：加盐聚合

如果是 `groupBy` 倾斜，可以用加盐方式拆散热点 key。

原始聚合：

```scala
val result = orders
  .groupBy("shop_id")
  .agg(sum("amount").as("total_amount"))
```

如果某个 `shop_id` 特别大，可以先加一个随机盐：

```scala
import org.apache.spark.sql.functions._

val salted = orders
  // 给每条数据增加 0~19 的随机盐，把热点 shop_id 拆成 20 份
  .withColumn("salt", floor(rand() * 20))

val partial = salted
  // 第一阶段：按 shop_id + salt 局部聚合，降低单个 key 的压力
  .groupBy("shop_id", "salt")
  .agg(sum("amount").as("partial_amount"))

val result = partial
  // 第二阶段：去掉 salt，再按 shop_id 汇总
  .groupBy("shop_id")
  .agg(sum("partial_amount").as("total_amount"))
```

这种方式适合热点 key 聚合。

缺点是会增加一次聚合步骤，但可以把一个超大 Task 拆成多个较小 Task。

盐值数量不是越大越好。可以根据热点 key 数据量选择，比如 10、20、50。

## 处理 join 倾斜：热点 key 单独处理

如果倾斜发生在 join 上，问题会更复杂。

例如：

```scala
orders.join(users, Seq("user_id"), "left")
```

如果大量订单的 `user_id = 0`，join 时这个 key 的数据会集中到一个分区。

可以把热点 key 和普通 key 分开处理。

```scala
val hotUserIds = Seq(0L)

val hotOrders = orders.filter(col("user_id").isin(hotUserIds: _*))
val normalOrders = orders.filter(!col("user_id").isin(hotUserIds: _*))

val normalJoined = normalOrders.join(users, Seq("user_id"), "left")

val hotJoined = hotOrders
  // 热点数据如果没有实际用户含义，可以直接补默认字段，避免参与大 join
  .withColumn("user_name", lit("unknown"))

val result = normalJoined.unionByName(hotJoined)
```

如果热点 key 仍然需要 join 维表，可以对热点部分做加盐 join。

思路是：

```text
大表热点 key 加随机 salt
小表热点 key 复制多份 salt
按 key + salt join
```

这种写法复杂一些，但对严重倾斜非常有效。

## 小表 join 用广播

如果维表很小，比如用户等级、渠道配置、城市字典，不要让它参与普通 Shuffle join。

可以使用广播 join。

```scala
import org.apache.spark.sql.functions.broadcast

val result = orders
  // users 是小表时，广播到各个 Executor，避免大规模 Shuffle
  .join(broadcast(users), Seq("user_id"), "left")
```

也可以通过参数控制自动广播阈值：

```bash
--conf spark.sql.autoBroadcastJoinThreshold=104857600
```

这里 104857600 表示 100MB。

广播表不能太大，否则会造成 Executor 内存压力。

判断是否用了广播，可以看 Spark SQL 执行计划：

```scala
result.explain(true)
```

如果看到：

```text
BroadcastHashJoin
```

说明使用了广播 join。

图：Spark SQL BroadcastHashJoin 执行计划截图

![](images/2026/07/05/spark-broadcast-hash-join-plan-placeholder.png)

## cache 不是越多越好

Spark 中经常看到这样的代码：

```scala
val orders = spark.table("dwd_order_detail").where("dt = '2026-07-04'").cache()
```

缓存可以减少重复计算，但不是所有 DataFrame 都应该 cache。

适合缓存的情况：

```text
同一个 DataFrame 被多次复用
计算成本较高
数据量能放进内存或可接受落盘
```

不适合缓存的情况：

```text
只使用一次
数据量特别大
缓存后挤掉其他重要数据
没有触发 action，cache 根本没生效
```

注意：`cache()` 是懒执行的，需要 action 触发。

```scala
val orders = spark.table("dwd_order_detail")
  .where("dt = '2026-07-04'")
  .cache()

// 触发一次 count，让缓存真正加载
orders.count()
```

用完后释放：

```scala
orders.unpersist()
```

图：Spark UI Storage 页面缓存命中截图

![](images/2026/07/05/spark-ui-storage-cache-placeholder.png)

## persist 可以选择存储级别

`cache()` 本质上是默认存储级别。

如果数据太大，内存放不下，可以用 `persist`：

```scala
import org.apache.spark.storage.StorageLevel

val orders = spark.table("dwd_order_detail")
  .where("dt = '2026-07-04'")
  // 内存放不下时落盘，避免反复重新计算
  .persist(StorageLevel.MEMORY_AND_DISK)

orders.count()
```

常见存储级别：

| 级别 | 说明 |
| --- | --- |
| `MEMORY_ONLY` | 只放内存，放不下就重算 |
| `MEMORY_AND_DISK` | 内存放不下就落盘 |
| `DISK_ONLY` | 只放磁盘 |
| `MEMORY_ONLY_SER` | 序列化后放内存，省空间但 CPU 开销更高 |

缓存不是万能优化。缓存前先确认是否复用，缓存后看 Spark UI Storage 页面确认是否生效。

## Executor 参数怎么配

Spark 资源参数常见有：

```text
--num-executors
--executor-cores
--executor-memory
--driver-memory
--conf spark.executor.memoryOverhead
```

很多人喜欢把单个 Executor 配得特别大，比如：

```bash
--executor-cores 16
--executor-memory 64g
```

这不一定好。

单个 Executor cores 太多，可能导致：

```text
单个 JVM 内同时运行太多 Task
GC 压力增大
单 Executor 失败影响更大
CPU 资源争用明显
```

一个常见起点：

```bash
--num-executors 20
--executor-cores 4
--executor-memory 8g
--conf spark.executor.memoryOverhead=2g
```

这不是固定答案，只是比“一个 Executor 塞满整台机器”更容易调。

## 资源配置要和分区数匹配

假设配置：

```text
num-executors = 20
executor-cores = 4
```

总并发 Task 数大约是：

```text
20 * 4 = 80
```

如果 Shuffle 分区只有 40 个，那么最多同时跑 40 个 Task，资源可能用不满。

如果 Shuffle 分区有 800 个，那么会分多轮执行。

比较合理的是：

```text
Shuffle 分区数明显大于总并发 Task 数
但不要大到调度开销过高
```

例如总并发 80，Shuffle 分区可以先从 400、800 这类值试。

图：Spark Executors 页面 cores 与 task 数截图

![](images/2026/07/05/spark-ui-executors-cores-tasks-placeholder.png)

## GC 时间也会拖慢任务

Spark 作业慢，有时不是 CPU 算不动，而是 Executor 在频繁 GC。

Spark UI Executors 页面可以看到 GC Time。

如果某些 Executor 的 GC Time 很高，可能是：

```text
单个 Task 处理数据太大
缓存太多
广播变量太大
对象创建过多
executor-memory 不合理
数据倾斜导致某个 Executor 压力过大
```

优化方向：

- 增加分区数，降低单 Task 数据量；
- 减少不必要 cache；
- 使用广播 join 时控制小表大小；
- 避免 collect 大数据到 Driver；
- 检查是否有 UDF 创建大量对象。

图：Spark UI Executors GC Time 截图

![](images/2026/07/05/spark-ui-executors-gc-time-placeholder.png)

## 不要轻易 collect

Spark 里一个危险操作是：

```scala
val list = df.collect()
```

`collect()` 会把所有数据拉到 Driver。

如果数据量大，Driver 很容易 OOM。

更危险的是：开发环境数据少时没问题，上生产后数据量变大才炸。

替代方式：

```scala
// 只查看少量样例
val sample = df.limit(100).collect()

// 写到外部存储，而不是拉回 Driver
 df.write.mode("overwrite").parquet("/tmp/result")
```

如果确实要收集小表作为广播变量，也要明确限制数据量。

```scala
val dim = spark.table("dim_channel")
  .limit(10000)
  .collect()
```

## UDF 可能让优化器失效

Spark SQL 的 Catalyst 优化器能优化很多内置表达式，但对 UDF 的理解有限。

例如：

```scala
val parseChannel = udf((channel: String) => {
  if (channel == null) "unknown" else channel.toLowerCase
})

val result = orders.withColumn("channel_norm", parseChannel(col("channel")))
```

如果能用内置函数，就优先用内置函数：

```scala
val result = orders.withColumn(
  "channel_norm",
  // 使用 Spark 内置函数，优化器更容易处理
  lower(coalesce(col("channel"), lit("unknown")))
)
```

UDF 不是不能用，但不要把简单表达式都写成 UDF。

## 文件格式也会影响性能

如果数据源是 CSV 或 JSON，读取和解析成本会比 Parquet / ORC 高很多。

分析型任务更推荐列式存储：

```text
Parquet
ORC
```

优势：

```text
列裁剪
压缩率高
读取更快
适合聚合分析
```

例如只查询 `shop_id`、`amount`、`dt` 三列，Parquet 可以只读相关列，不需要扫描完整行。

如果上游数据长期以 JSON 存储，后续统计任务会比较吃亏。可以在 ODS 到 DWD 阶段转换成 Parquet 或 ORC。

## 写表前处理小文件

Spark 结果写入 Hive 后，小文件太多会拖慢后续查询。

可以在写表前控制分区数：

```scala
result
  // 结果表每天数据量不大，写出前合并为 20 个文件左右
  .coalesce(20)
  .write
  .mode("overwrite")
  .insertInto("ads_shop_order_summary")
```

如果结果数据量很大，可以按业务字段重分区：

```scala
result
  // 按 dt 分区写入，适合后续按日期查询
  .repartition(col("dt"))
  .write
  .mode("overwrite")
  .insertInto("ads_shop_order_summary")
```

要注意：`repartition` 会触发 Shuffle，不要随便加。

## 这次任务怎么优化的

回到开头那个任务，最后主要做了几件事。

### 1. 调整 Shuffle 分区数

原来使用默认 200，数据量已经不适合。

调整为：

```bash
--conf spark.sql.shuffle.partitions=800
```

单个 Task 处理数据量下降，整体并行度更合理。

### 2. 处理 shop_id 倾斜

发现某些大店铺订单量远高于其他店铺，对 `shop_id` 聚合做了加盐。

```scala
val salted = orders.withColumn("salt", floor(rand() * 20))

val partial = salted
  // 先把热点 shop_id 拆散，减少单个 reduce task 压力
  .groupBy("shop_id", "dt", "channel", "salt")
  .agg(
    count("order_id").as("partial_order_count"),
    sum("amount").as("partial_amount")
  )

val result = partial
  // 再汇总回原始维度，得到最终指标
  .groupBy("shop_id", "dt", "channel")
  .agg(
    sum("partial_order_count").as("order_count"),
    sum("partial_amount").as("total_amount")
  )
```

### 3. 小维表改成广播 join

用户等级维表不大，改成广播：

```scala
val result = orders.join(broadcast(userLevel), Seq("user_id"), "left")
```

避免一次不必要的大 Shuffle。

### 4. 缓存复用的中间结果

订单基础过滤结果被后面多个指标复用，因此使用 `persist`：

```scala
val baseOrders = spark.table("dwd_order_detail")
  .where("dt = '2026-07-04'")
  // 后续多个指标都会复用这份数据，使用 MEMORY_AND_DISK 更稳
  .persist(StorageLevel.MEMORY_AND_DISK)

baseOrders.count()
```

任务结束后释放：

```scala
baseOrders.unpersist()
```

### 5. 写出前合并小文件

结果表数据量不大，写出前使用：

```scala
result.coalesce(50)
```

减少小文件数量。

优化后，任务耗时从 2 小时以上降到 30 分钟左右。

图：优化前后 Spark Stage 耗时对比截图

![](images/2026/07/05/spark-stage-duration-before-after-placeholder.png)

## 一份排查清单

Spark 作业慢，可以按这个顺序看：

```text
1. Spark UI 里哪个 Stage 最慢
2. 是否有大量 Shuffle Read / Write
3. Task 时间是否明显不均匀
4. 是否存在数据倾斜
5. Shuffle 分区数是否合理
6. 是否有不必要的 join / groupBy / distinct
7. 小表是否可以广播
8. cache 是否真的复用并生效
9. Executor GC Time 是否过高
10. 是否有 collect 拉爆 Driver
11. 输出是否产生大量小文件
12. 资源参数和分区数是否匹配
```

不要只看总耗时。真正的问题通常藏在最慢的 Stage 和最慢的几个 Task 里。

## 收尾

Spark 调优的核心不是背参数，而是理解数据怎么流动。

几个判断很实用：

```text
慢 Stage 多半和 Shuffle 有关
Task 时间差异大，多半有倾斜
分区太少会让单个 Task 过重
分区太多会增加调度和小文件成本
小表 join 优先考虑 broadcast
cache 只给复用且成本高的数据
Executor 资源要和分区数匹配
```

如果只能记住一个原则，那就是：先看 Spark UI，再改代码和参数。

很多任务跑得慢，不是集群资源不够，而是 Shuffle 太重、分区不合理、热点 key 拖慢了整个 Stage。把这些问题处理掉，比单纯加机器更有效。
