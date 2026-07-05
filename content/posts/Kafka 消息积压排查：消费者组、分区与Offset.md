---
title: Kafka 消息积压排查：消费者组、分区与Offset
slug: kafka-message-backlog-consumer-group-offset-optimization
date: 2026-07-05
category: 运维
tags:
  - Kafka
  - 消息队列
  - 消息积压
  - 消费者组
  - Offset
description: Kafka 消息积压通常不是单一原因导致的，可能和消费者处理变慢、分区数量不足、消费者组异常、Offset 提交失败、下游数据库变慢或单条毒消息有关。内容通过一次线上积压排查思路，整理消费者组、分区、Lag、Offset、消费线程和性能优化方法。
cover:
published: true
---

## 一次很典型的告警

某天晚上，监控突然告警：

```text
Kafka consumer lag 持续增长
topic: order-event
group: order-statistics-consumer
lag: 350000+
```

业务现象也开始出现：

- 订单统计延迟；
- 后台报表数据不是最新；
- 部分异步任务迟迟没有执行；
- Kafka 队列消息越来越多；
- 消费者服务没有明显报错，但处理速度跟不上。

这种问题在消息系统里很常见。Kafka 本身吞吐很高，但只要消费者处理能力不足，或者某个分区被卡住，Lag 就会持续上涨。

Kafka 官方文档可以查看：[Apache Kafka Documentation](https://kafka.apache.org/documentation/)。排查消息积压时，最先要看的是消费者组状态、分区分配、当前 Offset 和 Lag。

## 先别急着扩容

看到消息积压后，很多人的第一反应是：

```text
多加几个消费者实例
```

这不一定有用。

如果 Topic 只有 3 个分区，而消费者组里已经有 3 个消费者实例，再加到 6 个实例，也只有 3 个实例能分到分区，另外 3 个会空闲。

Kafka 的消费并行度主要受分区数限制：

```text
同一个消费者组内，一个分区同一时刻只能被一个消费者消费
```

所以扩容前要先确认：

```text
Topic 有多少分区
消费者组有多少成员
每个成员分到了哪些分区
Lag 集中在哪些分区
消费者是否真的在消费
```

图：Kafka 消费者组 Lag 告警截图

![](images/2026/07/05/kafka-consumer-lag-alert-placeholder.png)

## 第一步：查看消费者组状态

使用 Kafka 自带命令查看消费者组：

```bash
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --group order-statistics-consumer
```

输出类似：

```text
GROUP                     TOPIC        PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG     CONSUMER-ID       HOST
order-statistics-consumer order-event  0          12000           18000           6000    consumer-1        /10.0.0.1
order-statistics-consumer order-event  1          15000           15010           10      consumer-2        /10.0.0.2
order-statistics-consumer order-event  2          8000            30000           22000   consumer-3        /10.0.0.3
```

几个字段很关键：

| 字段 | 含义 |
| --- | --- |
| `CURRENT-OFFSET` | 当前消费者组已提交的 Offset |
| `LOG-END-OFFSET` | 分区最新消息 Offset |
| `LAG` | 未消费消息数 |
| `CONSUMER-ID` | 当前消费该分区的消费者 |
| `HOST` | 消费者所在机器 |

Lag 的计算大致是：

```text
LAG = LOG-END-OFFSET - CURRENT-OFFSET
```

如果某个分区 Lag 特别高，说明这个分区的消费速度明显跟不上。

图：kafka-consumer-groups 查看 Lag 截图

![](images/2026/07/05/kafka-consumer-groups-lag-placeholder.png)

## 第二步：判断是整体慢还是单分区慢

看 Lag 时不要只看总数，要看分区分布。

### 情况一：所有分区 Lag 都在涨

```text
partition-0 lag 上涨
partition-1 lag 上涨
partition-2 lag 上涨
partition-3 lag 上涨
```

这通常说明整体消费能力不足，可能原因：

- 消费者实例太少；
- 每条消息处理耗时变长；
- 下游数据库或接口变慢；
- 消费线程池打满；
- 消费者频繁重平衡；
- 消费者服务资源不足。

### 情况二：只有某个分区 Lag 特别高

```text
partition-0 lag 正常
partition-1 lag 正常
partition-2 lag 持续上涨
```

这通常说明某个分区被卡住，可能原因：

- 该分区有单条毒消息；
- 分区数据倾斜；
- 消费该分区的消费者实例异常；
- 某个 key 的消息特别多；
- 业务处理某类消息特别慢。

Kafka 的消息在分区内是有序的。如果一个分区里的某条消息一直处理失败，而代码又无限重试，这个分区后面的消息都会被堵住。

## 第三步：看消费者服务是否还活着

先确认消费者进程正常。

```bash
ps -ef | grep order-statistics-consumer
```

如果是 Kubernetes：

```bash
kubectl get pods -l app=order-statistics-consumer
kubectl logs -f <pod-name>
```

查看应用日志中是否有：

```text
poll timeout
rebalance
commit failed
database timeout
deserialize error
```

如果消费者进程还在，但 Lag 持续上涨，说明“活着”不等于“正常消费”。

还要看消费速率：

```text
每秒拉取多少条
每秒处理多少条
每条处理平均耗时
错误重试次数
提交 Offset 是否成功
```

图：消费者服务消费速率监控截图

![](images/2026/07/05/kafka-consumer-throughput-dashboard-placeholder.png)

## 第四步：检查消费逻辑是不是变慢了

Kafka 消息积压最常见的原因，不是 Kafka 出问题，而是消费者处理变慢。

例如消费者逻辑：

```java
@KafkaListener(topics = "order-event", groupId = "order-statistics-consumer")
public void onMessage(OrderEvent event) {
    // 1. 查询订单详情
    Order order = orderMapper.selectById(event.getOrderId());

    // 2. 查询用户信息
    User user = userClient.getUser(order.getUserId());

    // 3. 写统计表
    statisticsMapper.upsert(order, user);
}
```

这段逻辑看起来正常，但每条消息都可能涉及：

```text
1 次数据库查询
1 次远程 HTTP 调用
1 次数据库写入
```

如果下游用户服务变慢，或者统计表写入变慢，Kafka 消费速度就会下降。

排查时要把单条消息耗时拆开：

```java
public void onMessage(OrderEvent event) {
    long start = System.currentTimeMillis();

    try {
        long t1 = System.currentTimeMillis();
        Order order = orderMapper.selectById(event.getOrderId());
        log.debug("query order cost={}ms", System.currentTimeMillis() - t1);

        long t2 = System.currentTimeMillis();
        User user = userClient.getUser(order.getUserId());
        log.debug("query user cost={}ms", System.currentTimeMillis() - t2);

        long t3 = System.currentTimeMillis();
        statisticsMapper.upsert(order, user);
        log.debug("upsert statistics cost={}ms", System.currentTimeMillis() - t3);
    } finally {
        log.info("consume order event cost={}ms, orderId={}",
                System.currentTimeMillis() - start,
                event.getOrderId());
    }
}
```

这类耗时日志不一定长期打开，但排查积压时非常有用。

## 第五步：确认有没有毒消息

毒消息指的是某条消息因为数据格式、业务状态或代码 bug，导致消费者一直处理失败。

典型日志：

```text
consume failed, orderId=10086, retry=1
consume failed, orderId=10086, retry=2
consume failed, orderId=10086, retry=3
...
```

如果代码一直在同一条消息上重试，后续消息就会被卡住。

常见毒消息原因：

- JSON 反序列化失败；
- 必填字段为空；
- 业务数据不存在；
- 数据库唯一键冲突；
- 下游接口一直返回业务失败；
- 代码对某种枚举值没有兼容。

处理毒消息的关键是：不要无限阻塞主消费链路。

更合理的策略：

```text
消费失败
-> 记录失败原因
-> 有限次数重试
-> 超过次数后写入死信 Topic 或失败表
-> 提交 Offset，继续消费后续消息
-> 后续人工或补偿任务处理失败消息
```

图：Kafka 毒消息失败日志截图

![](images/2026/07/05/kafka-poison-message-error-log-placeholder.png)

## 第六步：看 Offset 有没有正常提交

消费者处理完消息后，需要提交 Offset。

如果业务处理成功，但 Offset 没提交，消费者重启后会重复消费。

如果 Offset 提交太早，业务后续失败，就可能丢失消息。

Spring Kafka 默认可以自动提交，也可以手动提交。Spring Kafka 文档：[Spring for Apache Kafka](https://docs.spring.io/spring-kafka/reference/)。

### 自动提交风险

自动提交配置类似：

```yaml
spring:
  kafka:
    consumer:
      enable-auto-commit: true
      auto-commit-interval: 5s
```

自动提交适合对可靠性要求不高的场景。

但关键业务更推荐手动 ACK。

### 手动 ACK 示例

```java
@KafkaListener(topics = "order-event", groupId = "order-statistics-consumer")
public void onMessage(OrderEvent event, Acknowledgment ack) {
    try {
        // 业务处理成功后再提交 Offset
        handleOrderEvent(event);
        ack.acknowledge();
    } catch (Exception e) {
        // 不要在这里盲目 ack，否则消息会被跳过
        log.error("consume order event failed, orderId={}", event.getOrderId(), e);
        throw e;
    }
}
```

配置：

```yaml
spring:
  kafka:
    consumer:
      enable-auto-commit: false
    listener:
      ack-mode: manual
```

手动提交时要注意：失败消息必须有明确处理策略，否则可能造成重复消费或分区阻塞。

图：Spring Kafka 手动 ACK 配置截图

![](images/2026/07/05/spring-kafka-manual-ack-config-placeholder.png)

## 第七步：检查消费者组是否频繁 Rebalance

Kafka 消费者组会进行分区分配，这个过程叫 Rebalance。

适度 Rebalance 是正常的，比如新增消费者、消费者下线、分区变化。

但如果 Rebalance 频繁发生，消费者会不断暂停消费，Lag 就可能上涨。

日志中常见关键字：

```text
Revoking previously assigned partitions
Successfully joined group
Setting newly assigned partitions
Member ... sending LeaveGroup request
```

频繁 Rebalance 的原因：

- 消费者处理太慢，超过 `max.poll.interval.ms`；
- 消费者心跳异常；
- Pod 频繁重启；
- 网络抖动；
- 消费者实例频繁扩缩容；
- 单次 poll 拉太多，处理时间过长。

关键参数：

| 参数 | 说明 |
| --- | --- |
| `max.poll.interval.ms` | 两次 poll 之间允许的最大处理时间 |
| `max.poll.records` | 每次 poll 最多拉取多少条 |
| `session.timeout.ms` | 会话超时时间 |
| `heartbeat.interval.ms` | 心跳间隔 |

如果单批消息处理很慢，可以先降低：

```yaml
spring:
  kafka:
    consumer:
      properties:
        max.poll.records: 100
        max.poll.interval.ms: 300000
```

不要只盲目调大 `max.poll.interval.ms`，还要优化单条消息处理耗时。

图：Kafka Rebalance 日志截图

![](images/2026/07/05/kafka-consumer-rebalance-log-placeholder.png)

## 第八步：分区数够不够

Kafka Topic 的分区数决定了同一个消费者组的最大并行消费能力。

查看 Topic：

```bash
kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --topic order-event
```

输出示例：

```text
Topic: order-event  PartitionCount: 3  ReplicationFactor: 3
```

如果 Topic 只有 3 个分区，那么同一个消费者组最多 3 个消费者实例并行消费。

```text
3 个分区 + 6 个消费者实例
-> 只有 3 个实例能分到分区
-> 另外 3 个实例空闲
```

所以扩容消费者前，要先看分区数。

如果确实需要提高消费并行度，可以增加分区数：

```bash
kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --alter \
  --topic order-event \
  --partitions 12
```

注意：增加分区后，基于 key 的顺序性可能受到影响。Kafka 只能保证同一个分区内有序，不能保证整个 Topic 全局有序。

如果业务依赖同一个订单 ID 的消息有序，就要确保相同 key 仍然进入同一个分区。

图：kafka-topics 查看分区数截图

![](images/2026/07/05/kafka-topic-partition-describe-placeholder.png)

## 第九步：是不是数据倾斜

有时 Topic 分区数量不少，但 Lag 仍然集中在某几个分区。

这可能是消息 key 分布不均匀。

例如所有消息都使用固定 key：

```java
producer.send(new ProducerRecord<>("order-event", "order", message));
```

这样大量消息可能进入同一个分区。

更合理的是根据业务维度选择 key：

```java
producer.send(new ProducerRecord<>("order-event", orderId.toString(), message));
```

如果业务需要同一订单有序，使用 `orderId` 作为 key 比固定 key 更合理。

但也要注意热点订单或热点用户导致倾斜。

排查数据倾斜可以看：

```text
各分区写入速率
各分区 Lag
消息 key 分布
生产者分区策略
```

图：Kafka 各分区 Lag 分布截图

![](images/2026/07/05/kafka-partition-lag-distribution-placeholder.png)

## 第十步：消费线程怎么设计

Spring Kafka 一个消费者实例内部也可以配置并发。

```yaml
spring:
  kafka:
    listener:
      concurrency: 3
```

或者：

```java
@KafkaListener(
        topics = "order-event",
        groupId = "order-statistics-consumer",
        concurrency = "3"
)
public void onMessage(OrderEvent event) {
    handle(event);
}
```

`concurrency = 3` 表示在当前应用实例内创建 3 个消费者线程。

但并发数仍然受分区数限制。

例如：

```text
Topic 3 个分区
一个应用实例 concurrency = 6
实际最多 3 个线程分到分区
```

如果有 12 个分区，可以部署 3 个实例，每个实例 concurrency=4，总共 12 个消费线程。

要注意：不要在 `@KafkaListener` 里再无脑丢到一个很大的业务线程池，否则 Offset 提交、异常处理和顺序性会变复杂。

## 第十一步：批量消费能不能用？

如果单条消息处理很轻，但数量很多，可以考虑批量消费。

配置：

```yaml
spring:
  kafka:
    listener:
      type: batch
    consumer:
      properties:
        max.poll.records: 500
```

监听方法：

```java
@KafkaListener(topics = "order-event", groupId = "order-statistics-consumer")
public void onMessage(List<OrderEvent> events, Acknowledgment ack) {
    try {
        // 批量处理可以减少数据库交互次数，例如批量写入统计表
        statisticsService.batchHandle(events);
        ack.acknowledge();
    } catch (Exception e) {
        log.error("batch consume failed, size={}", events.size(), e);
        throw e;
    }
}
```

批量消费适合：

- 写统计表；
- 批量入库；
- 日志处理；
- 指标汇总；
- 对单条顺序要求不强的场景。

不适合：

- 单条消息业务很复杂；
- 单条失败需要独立处理；
- 对严格顺序要求很高；
- 下游不支持批量接口。

批量消费要处理一个问题：一批中有一条失败怎么办？

常见策略：

```text
整批失败重试
单条捕获失败写入失败表
成功部分提交，失败部分补偿
```

具体取决于业务一致性要求。

## 第十二步：下游数据库是不是瓶颈

Kafka 消费者经常最终写数据库。

如果数据库慢了，Kafka 消费速度一定会下降。

排查方向：

```text
慢 SQL
连接池是否打满
事务是否过大
索引是否失效
批量写入是否太大
锁等待是否严重
```

例如每条消息都单独写统计表：

```java
statisticsMapper.insert(record);
```

可以考虑批量写：

```java
statisticsMapper.batchInsert(records);
```

但批量也不能无限大。可以控制每批 200 ~ 1000 条，再结合压测调整。

如果写入是幂等更新，也要注意唯一键和冲突处理。

MySQL 可以使用：

```sql
INSERT INTO order_statistics(order_id, amount, status)
VALUES (?, ?, ?)
ON DUPLICATE KEY UPDATE
    amount = VALUES(amount),
    status = VALUES(status);
```

这样重复消费时不会插入多条脏数据。

## 第十三步：消费必须幂等

Kafka 默认不能保证业务只处理一次。

重复消费可能发生在：

- 消费成功但 Offset 提交失败；
- 消费者重启；
- Rebalance；
- 手动重置 Offset；
- 业务处理超时后重试。

所以消费者逻辑必须幂等。

常见方案：

| 场景 | 幂等方式 |
| --- | --- |
| 订单事件 | 使用 orderId + eventType 唯一键 |
| 支付事件 | 使用 payNo 唯一键 |
| 消息处理记录 | messageId 建唯一索引 |
| 状态流转 | 判断当前状态后再更新 |
| 统计写入 | upsert |

示例：

```sql
CREATE TABLE message_consume_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id VARCHAR(64) NOT NULL,
    consumer_group VARCHAR(128) NOT NULL,
    create_time DATETIME NOT NULL,
    UNIQUE KEY uk_msg_group (message_id, consumer_group)
);
```

消费时先插入消费记录，插入失败说明已经处理过。

## 临时止血方案

如果线上 Lag 已经很高，需要先恢复消费能力。

可以按风险从低到高处理。

### 1. 扩容消费者

前提：分区数足够。

```bash
kubectl scale deployment order-statistics-consumer --replicas=6
```

### 2. 提高单实例并发

前提：机器资源和分区数允许。

```yaml
spring:
  kafka:
    listener:
      concurrency: 4
```

### 3. 暂停非核心生产者

如果生产速度远高于消费速度，可以临时降低生产流量。

### 4. 跳过毒消息

前提：业务允许，并且已记录失败消息。

处理方式：

```text
失败消息写入死信 Topic
提交 Offset
继续消费后续消息
```

### 5. 重置 Offset

这是高风险操作。

查看命令：

```bash
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --group order-statistics-consumer \
  --topic order-event \
  --reset-offsets \
  --to-latest \
  --dry-run
```

真正执行：

```bash
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --group order-statistics-consumer \
  --topic order-event \
  --reset-offsets \
  --to-latest \
  --execute
```

`--to-latest` 会跳过未消费消息，可能造成数据丢失。只有在确认这些消息可以丢弃，或者已有其他补偿方式时才能执行。

图：Kafka reset-offsets dry-run 截图

![](images/2026/07/05/kafka-reset-offsets-dry-run-placeholder.png)

## 长期优化方案

### 1. 拆分 Topic

不要把所有业务消息都放在一个大 Topic 里。

可以按业务拆分：

```text
order-created-event
order-paid-event
order-cancelled-event
inventory-changed-event
```

这样不同消费链路互不影响。

### 2. 调整分区数

根据峰值流量和消费能力评估分区数。

粗略思路：

```text
单分区消费能力 = 每秒可处理消息数
需要分区数 = 峰值生产速率 / 单分区消费能力
```

例如：

```text
峰值 6000 msg/s
单分区消费者处理 1000 msg/s
至少需要 6 个分区
```

实际还要留余量。

### 3. 优化单条处理耗时

常见优化：

- 批量查数据库；
- 批量写数据库；
- 减少远程调用；
- 本地缓存字典数据；
- 慢 SQL 优化；
- 下游接口设置超时；
- 异常消息快速失败。

### 4. 建立死信 Topic

不要让毒消息阻塞主 Topic。

可以设计：

```text
order-event
order-event-retry
order-event-dlt
```

失败消息经过有限重试后进入 DLT，后续人工或补偿任务处理。

### 5. 监控 Lag 和消费耗时

至少监控：

```text
consumer lag
每秒消费数
单条消费耗时
消费失败次数
Rebalance 次数
poll 间隔
commit 失败次数
下游数据库耗时
```

这些指标比只看应用是否存活更有意义。

## 一份排查清单

遇到 Kafka 积压，可以按这个顺序走：

```text
1. kafka-consumer-groups 查看 Lag
2. 判断是所有分区积压还是单分区积压
3. 查看消费者实例是否存活
4. 查看消费速率和单条处理耗时
5. 检查是否有毒消息
6. 检查 Offset 是否正常提交
7. 检查是否频繁 Rebalance
8. 检查 Topic 分区数和消费者并发
9. 检查是否数据倾斜
10. 检查下游数据库或接口是否变慢
11. 临时扩容或限流止血
12. 长期优化 Topic、分区、批量处理和监控
```

这份清单比直接扩容更可靠。

## 收尾

Kafka 消息积压通常不是 Kafka 本身扛不住，而是生产速度、消费速度、分区并行度和下游处理能力之间失衡。

几个关键判断很重要：

```text
Lag 是总量问题还是单分区问题
消费者是真的在消费还是只是进程存活
分区数是否限制了并行度
下游数据库或接口是否拖慢消费
是否有毒消息卡住分区
Offset 是否按预期提交
```

处理积压时，短期要先恢复消费能力，长期要优化消费链路和监控体系。

真正稳定的 Kafka 消费系统，应该具备：

```text
可观测的 Lag
可控的并发
合理的分区
幂等的消费逻辑
有限重试
死信 Topic
清晰的补偿机制
```

只要这些基础能力到位，Kafka 积压就不再是只能靠重启和扩容解决的问题。
