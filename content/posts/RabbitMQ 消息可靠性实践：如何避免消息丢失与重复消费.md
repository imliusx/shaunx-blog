---
title: RabbitMQ 消息可靠性实践：如何避免消息丢失与重复消费
slug: rabbitmq-message-reliability-and-idempotent-consumption
date: 2022-08-30
category: 架构
tags:
  - RabbitMQ
  - 消息队列
  - 消息可靠性
  - 幂等性
  - 后端架构
description: RabbitMQ 常用于异步解耦、削峰填谷和事件通知，但消息链路中任何一个环节处理不当，都可能出现消息丢失、重复消费或消息堆积。内容围绕生产者确认、交换机路由、队列持久化、消费者确认、重试机制、死信队列和幂等消费，整理一套可落地的可靠性方案。
cover:
published: true
---

## 引言

RabbitMQ 在后端系统中经常用于异步处理和系统解耦。比如订单创建后发送短信、支付成功后通知库存、用户注册后初始化权益、操作日志异步落库，这些场景都很适合使用消息队列。

消息队列能提升系统吞吐，也能降低接口响应时间，但它也带来了新的问题：

- 消息发送失败怎么办？
- 消息发送成功但没有路由到队列怎么办？
- RabbitMQ 重启后消息还在不在？
- 消费者处理业务成功但确认失败怎么办？
- 同一条消息被消费多次怎么办？
- 消息一直消费失败会不会无限重试？

这些问题都属于消息可靠性范畴。

RabbitMQ 官方文档可以查看：[RabbitMQ Documentation](https://www.rabbitmq.com/docs)。如果要在生产环境使用 RabbitMQ，至少要理解生产者确认、消费者确认、持久化、死信队列、重试和幂等这几个关键点。

## 一条消息会经过哪些环节？

RabbitMQ 中一条消息通常会经过下面几个阶段：

```text
业务代码
-> 生产者发送消息
-> Broker 接收消息
-> Exchange 路由消息
-> Queue 存储消息
-> Consumer 拉取或接收消息
-> 执行业务逻辑
-> ACK 确认消费完成
```

图：RabbitMQ Exchange、Queue、Binding 管理后台截图

![](images/2026/07/04/rabbitmq-exchange-queue-binding-console-placeholder.png)

只要其中任意环节处理不当，都可能出现可靠性问题。

常见风险包括：

| 环节 | 可能问题 |
| --- | --- |
| 生产者 | 消息发送失败，业务以为发送成功 |
| Exchange | 交换机不存在，消息无法投递 |
| 路由 | routing key 错误，消息没有进入队列 |
| Queue | 队列未持久化，Broker 重启后消息丢失 |
| Consumer | 消费失败但错误 ACK，消息丢失 |
| 业务逻辑 | 消费成功但重复执行，产生脏数据 |
| 重试机制 | 无限重试，造成消息堆积 |

所以，消息可靠性不能只靠 RabbitMQ 自身能力，还需要业务代码、配置和监控一起配合。

## 消息丢失的常见位置

### 1. 生产者发送阶段丢失

业务代码调用发送方法时，网络可能抖动，Broker 可能不可用，交换机可能不存在。

如果没有确认机制，业务代码可能以为消息发送成功，实际上消息根本没到 RabbitMQ。

### 2. 交换机路由阶段丢失

消息到达 Exchange 后，如果没有任何队列能匹配 routing key，消息可能被丢弃。

例如：

```text
exchange = order.exchange
routingKey = order.pay.success
```

但实际绑定关系中没有 `order.pay.success`，消息就无法进入队列。

### 3. 队列存储阶段丢失

如果 Exchange、Queue 或 Message 没有持久化，RabbitMQ 重启后消息可能丢失。

RabbitMQ 持久化相关说明可以查看：[Message Durability](https://www.rabbitmq.com/docs/publishers#message-properties)。

### 4. 消费者处理阶段丢失

消费者拿到消息后，如果还没处理完业务就自动 ACK，后续业务执行失败时，RabbitMQ 已经认为消息消费成功，不会再次投递。

例如：

```text
消费者收到消息
-> RabbitMQ 自动 ACK
-> 执行业务逻辑
-> 数据库更新失败
-> 消息无法重新消费
```

这种问题在自动确认模式下比较常见。

## 生产者可靠投递

生产者可靠投递主要解决一个问题：确认消息是否成功到达 RabbitMQ。

RabbitMQ 提供 Publisher Confirms 机制，官方说明可以查看：[Publisher Confirms](https://www.rabbitmq.com/docs/confirms)。

### 开启 Publisher Confirm

Spring Boot 配置示例：

```yaml
spring:
  rabbitmq:
    host: localhost
    port: 5672
    username: guest
    password: guest
    publisher-confirm-type: correlated
```

`publisher-confirm-type` 常见取值：

| 配置 | 含义 |
| --- | --- |
| `none` | 不开启确认 |
| `simple` | 简单确认模式 |
| `correlated` | 关联确认模式，可拿到 CorrelationData |

生产环境更常用 `correlated`。

### ConfirmCallback

发送消息时设置回调：

```java
@Configuration
public class RabbitTemplateConfig {

    @Bean
    public RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory) {
        RabbitTemplate rabbitTemplate = new RabbitTemplate(connectionFactory);

        rabbitTemplate.setConfirmCallback((correlationData, ack, cause) -> {
            if (ack) {
                log.info("消息发送到 Exchange 成功, correlationData={}", correlationData);
            } else {
                log.error("消息发送到 Exchange 失败, correlationData={}, cause={}", correlationData, cause);
                // 记录失败消息，后续补偿重发
            }
        });

        return rabbitTemplate;
    }
}
```

`ack = true` 表示消息到达 Exchange。

`ack = false` 表示消息没有成功到达 Exchange，需要记录日志、告警或进入重发流程。

### 业务消息表

如果消息非常关键，例如支付成功通知、订单状态变更，建议增加一张本地消息表。

表结构示例：

```sql
CREATE TABLE t_message_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id VARCHAR(64) NOT NULL,
    exchange_name VARCHAR(128) NOT NULL,
    routing_key VARCHAR(128) NOT NULL,
    message_body TEXT NOT NULL,
    status TINYINT NOT NULL,
    retry_count INT NOT NULL DEFAULT 0,
    next_retry_time DATETIME,
    create_time DATETIME NOT NULL,
    update_time DATETIME NOT NULL,
    UNIQUE KEY uk_message_id (message_id)
);
```

发送流程：

```text
业务操作成功
-> 写本地消息表，状态为待发送
-> 发送 RabbitMQ 消息
-> Confirm 成功，更新消息状态为已发送
-> Confirm 失败，定时任务重试
```

图：t_message_log 表结构截图

![](images/2026/07/04/rabbitmq-message-log-table-placeholder.png)

这样即使发送失败，也能通过定时任务补偿。

## 路由失败处理

Publisher Confirm 只能确认消息是否到达 Exchange，不能保证消息一定进入 Queue。

如果 routing key 错误，Exchange 收到了消息，但没有队列匹配，消息仍然可能丢失。

这时需要使用 ReturnCallback。

### 开启 mandatory

配置：

```yaml
spring:
  rabbitmq:
    publisher-returns: true
    template:
      mandatory: true
```

### ReturnCallback

```java
rabbitTemplate.setReturnsCallback(returned -> {
    log.error("消息路由失败, exchange={}, routingKey={}, replyCode={}, replyText={}, message={}",
            returned.getExchange(),
            returned.getRoutingKey(),
            returned.getReplyCode(),
            returned.getReplyText(),
            new String(returned.getMessage().getBody(), StandardCharsets.UTF_8));

    // 记录失败消息，进入补偿流程
});
```

当消息无法路由到任何队列时，RabbitMQ 会把消息返回给生产者。

可靠投递通常要同时开启：

```text
Publisher Confirm：确认是否到达 Exchange
ReturnCallback：确认是否路由到 Queue
```

## 交换机、队列和消息持久化

RabbitMQ 重启后，想让消息不丢，需要三个层面都考虑持久化。

### Exchange 持久化

```java
@Bean
public DirectExchange orderExchange() {
    return new DirectExchange("order.exchange", true, false);
}
```

第二个参数 `durable = true`，表示交换机持久化。

### Queue 持久化

```java
@Bean
public Queue orderQueue() {
    return QueueBuilder.durable("order.pay.success.queue").build();
}
```

### Message 持久化

发送消息时设置消息持久化：

```java
MessageProperties properties = new MessageProperties();
properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
Message message = new Message(body, properties);

rabbitTemplate.send("order.exchange", "order.pay.success", message);
```

如果使用 `convertAndSend`，可以通过 `MessagePostProcessor` 设置：

```java
rabbitTemplate.convertAndSend(
        "order.exchange",
        "order.pay.success",
        payload,
        message -> {
            message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
            return message;
        }
);
```

完整可靠存储通常要求：

```text
Exchange durable = true
Queue durable = true
Message deliveryMode = PERSISTENT
```

注意：持久化能降低 Broker 重启导致的消息丢失风险，但不能保证任何情况下绝对不丢。极端情况下还需要结合镜像队列、Quorum Queue、磁盘策略和业务补偿。

RabbitMQ Quorum Queues 官方说明：[Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues)。

## 消费者手动 ACK

消费者可靠消费的核心是手动 ACK。

不要在关键业务场景中使用自动确认，因为自动确认容易出现“消息已经确认，但业务实际失败”的问题。

### 开启手动确认

Spring Boot 配置：

```yaml
spring:
  rabbitmq:
    listener:
      simple:
        acknowledge-mode: manual
        prefetch: 10
```

`prefetch` 表示消费者一次最多拉取多少条未确认消息。它可以避免单个消费者一次拿太多消息，导致其他消费者空闲。

RabbitMQ 消费者确认机制可以查看：[Consumer Acknowledgements](https://www.rabbitmq.com/docs/confirms#consumer-acks)。

### 手动 ACK 示例

```java
@RabbitListener(queues = "order.pay.success.queue")
public void handlePaySuccess(Message message, Channel channel) throws IOException {
    long deliveryTag = message.getMessageProperties().getDeliveryTag();

    try {
        String body = new String(message.getBody(), StandardCharsets.UTF_8);
        PaySuccessMessage payMessage = JSON.parseObject(body, PaySuccessMessage.class);

        orderService.handlePaySuccess(payMessage);

        channel.basicAck(deliveryTag, false);
    } catch (BusinessException e) {
        log.warn("业务异常，拒绝消息, deliveryTag={}", deliveryTag, e);
        channel.basicNack(deliveryTag, false, false);
    } catch (Exception e) {
        log.error("系统异常，稍后重试, deliveryTag={}", deliveryTag, e);
        channel.basicNack(deliveryTag, false, true);
    }
}
```

几个关键方法：

| 方法 | 含义 |
| --- | --- |
| `basicAck` | 确认消息消费成功 |
| `basicNack` | 拒绝消息，支持批量和重新入队 |
| `basicReject` | 拒绝单条消息 |

参数说明：

```java
channel.basicNack(deliveryTag, multiple, requeue)
```

- `multiple`：是否批量拒绝；
- `requeue`：是否重新入队。

如果 `requeue = true`，消息会重新回到队列，可能被再次消费。

如果 `requeue = false`，消息会被丢弃，或者进入死信队列。

## 重复消费不可避免

消息队列只能尽量保证消息可靠投递，但很难保证业务层面“只消费一次”。

重复消费可能发生在这些场景：

1. 消费者业务执行成功，但 ACK 失败；
2. 消费者处理超时，连接断开，消息重新投递；
3. 生产者重试发送，产生重复消息；
4. 网络抖动导致确认丢失；
5. 消费者宕机后消息重新分发。

所以，消费者必须做幂等。

图：消息消费记录表唯一索引截图

![](images/2026/07/04/rabbitmq-consume-log-unique-index-placeholder.png)

## 幂等消费方案

幂等的意思是：同一条消息消费一次和消费多次，最终结果一致。

### 方案一：业务唯一键

例如支付成功消息中有支付流水号：

```text
payNo = PAY202607040001
```

可以在业务表中增加唯一索引：

```sql
ALTER TABLE t_payment_record ADD UNIQUE KEY uk_pay_no (pay_no);
```

消费时插入支付记录：

```java
try {
    paymentRecordMapper.insert(record);
} catch (DuplicateKeyException e) {
    log.info("支付消息已处理, payNo={}", record.getPayNo());
    return;
}
```

数据库唯一键是最可靠的幂等手段之一。

### 方案二：消息消费记录表

单独维护消费记录表：

```sql
CREATE TABLE t_message_consume_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id VARCHAR(64) NOT NULL,
    consumer_group VARCHAR(64) NOT NULL,
    status TINYINT NOT NULL,
    create_time DATETIME NOT NULL,
    update_time DATETIME NOT NULL,
    UNIQUE KEY uk_message_consumer (message_id, consumer_group)
);
```

消费流程：

```text
收到消息
-> 插入消费记录
-> 插入成功，执行业务
-> 插入失败，说明已消费，直接 ACK
-> 业务成功，更新消费状态
```

示例：

```java
@Transactional(rollbackFor = Exception.class)
public void consume(OrderMessage message) {
    int inserted = consumeLogMapper.insertIgnore(message.getMessageId(), "order-consumer");
    if (inserted == 0) {
        log.info("消息重复消费, messageId={}", message.getMessageId());
        return;
    }

    orderService.updateOrderStatus(message.getOrderId(), OrderStatus.PAID);
    consumeLogMapper.markSuccess(message.getMessageId(), "order-consumer");
}
```

### 方案三：Redis 去重

对于允许短期去重的业务，可以使用 Redis：

```java
String key = "mq:consume:" + message.getMessageId();
Boolean success = redisTemplate.opsForValue().setIfAbsent(key, "1", 24, TimeUnit.HOURS);

if (Boolean.FALSE.equals(success)) {
    log.info("消息已消费, messageId={}", message.getMessageId());
    return;
}

handleBusiness(message);
```

这种方式性能高，但要注意 Redis 数据丢失、过期时间、业务一致性等问题。关键交易类业务更推荐数据库唯一键或消费记录表。

## 死信队列

如果消息一直消费失败，不能无限重试，否则会造成队列阻塞和日志刷屏。

死信队列用于存放无法正常消费的消息。

消息成为死信的常见原因：

1. 消息被拒绝，并且 `requeue = false`；
2. 消息过期；
3. 队列达到最大长度；
4. Quorum Queue 超过投递限制。

RabbitMQ 死信文档可以查看：[Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx)。

### 配置死信交换机

```java
@Bean
public DirectExchange orderDlxExchange() {
    return new DirectExchange("order.dlx.exchange", true, false);
}

@Bean
public Queue orderDlxQueue() {
    return QueueBuilder.durable("order.dlx.queue").build();
}

@Bean
public Binding orderDlxBinding() {
    return BindingBuilder.bind(orderDlxQueue())
            .to(orderDlxExchange())
            .with("order.dlx");
}
```

### 业务队列绑定死信交换机

```java
@Bean
public Queue orderQueue() {
    return QueueBuilder.durable("order.pay.success.queue")
            .withArgument("x-dead-letter-exchange", "order.dlx.exchange")
            .withArgument("x-dead-letter-routing-key", "order.dlx")
            .build();
}
```

当消费者拒绝消息且不重新入队时：

```java
channel.basicNack(deliveryTag, false, false);
```

消息就会进入死信队列。

图：RabbitMQ 死信队列参数配置截图

![](images/2026/07/04/rabbitmq-dlx-arguments-console-placeholder.png)

## 延迟重试队列

消费失败后，有些场景需要延迟一段时间再重试。

例如第三方接口临时不可用，直接失败不合适，立刻重试也没有意义。

可以使用 TTL + 死信队列实现延迟重试。

### 重试队列

```java
@Bean
public Queue orderRetryQueue() {
    return QueueBuilder.durable("order.retry.queue")
            .withArgument("x-message-ttl", 30000)
            .withArgument("x-dead-letter-exchange", "order.exchange")
            .withArgument("x-dead-letter-routing-key", "order.pay.success")
            .build();
}
```

消息进入重试队列后，等待 30 秒过期，然后通过死信机制重新投递到业务队列。

### 重试次数控制

一定要控制最大重试次数。

可以在消息头中记录重试次数：

```java
Integer retryCount = (Integer) message.getMessageProperties()
        .getHeaders()
        .getOrDefault("retry-count", 0);

if (retryCount >= 3) {
    channel.basicNack(deliveryTag, false, false);
    return;
}

message.getMessageProperties().setHeader("retry-count", retryCount + 1);
rabbitTemplate.send("order.retry.exchange", "order.retry", message);
channel.basicAck(deliveryTag, false);
```

也可以使用业务消息表记录重试次数，更容易查询和人工处理。

## 消息堆积排查

消息堆积是 RabbitMQ 生产环境中非常常见的问题。

典型表现：

- 队列 ready 消息数持续上涨；
- unacked 消息数过高；
- 消费者 CPU 或线程池打满；
- 消费业务出现慢 SQL；
- 下游接口响应变慢；
- 消息延迟越来越大。

RabbitMQ 管理后台可以查看队列状态，管理插件文档：[Management Plugin](https://www.rabbitmq.com/docs/management)。

图：RabbitMQ ready 与 unacked 监控截图

![](images/2026/07/04/rabbitmq-ready-unacked-monitor-placeholder.png)

### ready 和 unacked

| 指标 | 含义 |
| --- | --- |
| ready | 队列中等待投递的消息数量 |
| unacked | 已投递给消费者但还没 ACK 的消息数量 |

如果 `ready` 很高，说明消费速度跟不上生产速度。

如果 `unacked` 很高，说明消费者拿到了消息但处理慢，或者没有正确 ACK。

### 排查方向

1. 消费者是否正常运行；
2. 消费线程数是否过少；
3. prefetch 是否设置过大；
4. 消费逻辑是否有慢 SQL；
5. 下游接口是否变慢；
6. 消费者是否频繁异常重试；
7. 是否有单条毒消息一直阻塞。

### 临时处理方式

消息堆积严重时，可以按业务风险选择：

1. 临时扩容消费者；
2. 提高消费线程数；
3. 暂停非核心生产者；
4. 对失败消息转入死信队列；
5. 对可丢弃消息进行清理；
6. 拆分队列，隔离慢业务。

不要在不了解业务含义的情况下直接 purge 队列，否则可能造成数据丢失。

## 生产可用配置示例

下面是一套相对完整的 Spring Boot RabbitMQ 配置示例。

```yaml
spring:
  rabbitmq:
    host: localhost
    port: 5672
    username: guest
    password: guest
    publisher-confirm-type: correlated
    publisher-returns: true
    template:
      mandatory: true
    listener:
      simple:
        acknowledge-mode: manual
        prefetch: 10
        concurrency: 4
        max-concurrency: 12
        retry:
          enabled: false
```

关键点：

```text
开启生产者 Confirm
开启 ReturnCallback
开启手动 ACK
合理设置 prefetch
关闭盲目自动重试
失败消息进入死信或业务补偿
```

## 可靠性方案汇总

| 问题 | 解决方案 |
| --- | --- |
| 生产者发送失败 | Publisher Confirm、本地消息表、定时补偿 |
| 消息无法路由 | mandatory、ReturnCallback |
| Broker 重启消息丢失 | Exchange、Queue、Message 持久化 |
| 消费者处理失败 | 手动 ACK、异常分类、Nack |
| 重复消费 | 唯一键、消费记录表、Redis 去重 |
| 无限重试 | 重试次数限制、死信队列、人工处理 |
| 消息堆积 | 消费者扩容、慢逻辑优化、队列隔离 |
| Broker 故障 | 集群、Quorum Queue、监控告警 |

## 实际落地建议

### 1. 关键消息必须有 messageId

每条消息都应该有全局唯一 ID。

```java
public class BaseMessage {
    private String messageId;
    private LocalDateTime createTime;
}
```

`messageId` 是后续日志追踪、幂等判断、重试补偿的基础。

### 2. 生产者发送和业务操作要有一致性方案

如果业务操作成功，但消息发送失败，就会出现数据状态和异步事件不一致。

关键业务建议使用本地消息表：

```text
本地事务提交业务数据和消息记录
定时任务扫描待发送消息
发送成功后更新状态
失败后继续重试或告警
```

### 3. 消费者必须幂等

不要假设消息只会消费一次。

即使 RabbitMQ 配置正确，网络抖动、消费者重启、ACK 失败也可能导致重复投递。

### 4. 失败消息要有出口

消费失败不能无限重试。

推荐：

```text
有限次数重试
-> 仍失败，进入死信队列
-> 告警通知
-> 人工或定时补偿
```

### 5. 队列要按业务隔离

不要把不同重要级别、不同耗时的消息放在同一个队列里。

例如：

```text
订单支付队列
短信通知队列
日志采集队列
积分发放队列
```

这样某个慢业务堆积时，不会影响其他业务。

### 6. 监控必须覆盖核心指标

至少监控：

- 队列 ready 数；
- 队列 unacked 数；
- 消费速率；
- 发布速率；
- 消费失败次数；
- 死信队列数量；
- Broker 内存和磁盘；
- 连接数和 Channel 数。

## 总结

RabbitMQ 消息可靠性不是单个配置能解决的问题，而是一整条链路的保障。

可以把可靠性拆成三个阶段：

```text
生产可靠：Confirm + ReturnCallback + 本地消息表
存储可靠：交换机持久化 + 队列持久化 + 消息持久化
消费可靠：手动 ACK + 幂等消费 + 重试控制 + 死信队列
```

消息丢失通常发生在发送、路由、存储、消费确认这些环节；重复消费通常来自重试、消费者重启、ACK 失败和生产者补偿。

真正可落地的方案不是追求“绝对不丢、绝对不重复”，而是做到：

```text
消息可追踪
失败可重试
重复可幂等
异常可告警
死信可处理
链路可观测
```

对于关键业务来说，RabbitMQ 只是可靠性的一部分。业务表、消息表、幂等表、监控告警和补偿任务一起配合，才能让消息链路真正稳定。
