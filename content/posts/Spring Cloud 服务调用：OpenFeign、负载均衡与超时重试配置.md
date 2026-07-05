---
title: Spring Cloud 服务调用：OpenFeign、负载均衡与超时重试配置
slug: spring-cloud-openfeign-loadbalancer-timeout-retry
date: 2026-07-04
category: 架构
tags:
  - Spring Cloud
  - OpenFeign
  - 微服务
  - 负载均衡
  - 后端架构
description: 微服务拆分后，服务之间的 HTTP 调用会成为系统稳定性的关键点。内容通过订单服务调用库存服务的场景，整理 Spring Cloud OpenFeign 的接口声明、服务发现、负载均衡、超时配置、重试策略、异常处理、日志排查和降级设计。
cover:
published: true
---

## 一个很常见的调用场景

电商系统里，订单服务创建订单前通常要检查库存。

最开始可能是一个单体应用：

```text
OrderService
-> InventoryService
-> MySQL
```

服务拆分后，订单和库存变成两个独立服务：

```text
order-service
-> inventory-service
```

于是原来的本地方法调用变成了远程 HTTP 调用。

远程调用看起来只是多了一层网络，但问题会明显变多：

- 库存服务实例有多个，订单服务该调用哪一个；
- 某个库存实例挂了，流量能不能自动切走；
- 调用多久算超时；
- 超时后要不要重试；
- 重试会不会导致重复扣库存；
- 库存服务慢了，会不会拖垮订单服务；
- 调用失败后订单服务应该怎么返回。

Spring Cloud OpenFeign 正是用来简化服务间 HTTP 调用的工具。OpenFeign 项目地址：[OpenFeign](https://github.com/OpenFeign/feign)，Spring Cloud OpenFeign 文档：[Spring Cloud OpenFeign](https://docs.spring.io/spring-cloud-openfeign/reference/)。

## 先把服务调用跑起来

假设有两个服务：

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| `order-service` | 8081 | 订单服务 |
| `inventory-service` | 8082 / 8083 | 库存服务，多实例 |

库存服务提供接口：

```http
GET /api/inventory/check?skuId=1001&count=2
```

返回：

```json
{
  "skuId": "1001",
  "available": true,
  "stock": 20
}
```

订单服务在创建订单时调用库存服务：

```text
创建订单请求
-> 校验参数
-> 调用库存服务检查库存
-> 库存充足，创建订单
-> 库存不足，返回失败
```

图：order-service 调用 inventory-service 的链路截图

![](images/2026/07/04/spring-cloud-order-inventory-call-placeholder.png)

## 引入 OpenFeign

订单服务引入依赖：

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-openfeign</artifactId>
</dependency>
```

如果使用服务发现，还需要引入注册中心相关依赖，例如 Nacos、Eureka、Consul 等。

Nacos 文档：[Nacos](https://nacos.io/)，Eureka 是 Spring Cloud 早期常见方案，新项目中 Nacos、Consul、Kubernetes Service 更常见。

启动类开启 Feign：

```java
@SpringBootApplication
@EnableFeignClients
public class OrderApplication {

    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }
}
```

`@EnableFeignClients` 会扫描 `@FeignClient` 接口，并为它们生成代理对象。

## 声明库存服务客户端

OpenFeign 的好处是：把 HTTP 调用写成 Java 接口。

```java
@FeignClient(name = "inventory-service")
public interface InventoryClient {

    @GetMapping("/api/inventory/check")
    InventoryCheckResponse checkInventory(
            @RequestParam("skuId") Long skuId,
            @RequestParam("count") Integer count
    );
}
```

订单服务中直接注入：

```java
@Service
public class OrderService {

    private final InventoryClient inventoryClient;

    public OrderService(InventoryClient inventoryClient) {
        this.inventoryClient = inventoryClient;
    }

    public Long createOrder(CreateOrderRequest request) {
        InventoryCheckResponse response = inventoryClient.checkInventory(
                request.getSkuId(),
                request.getCount()
        );

        if (!response.isAvailable()) {
            throw new BusinessException("库存不足");
        }

        // 库存充足后创建订单
        return saveOrder(request);
    }
}
```

这样业务代码不用手写 `RestTemplate` 或 `HttpClient`，可读性更好。

但要注意：接口写起来像本地方法，实际仍然是远程调用。远程调用一定会有超时、失败、重试、网络抖动和下游异常。

## 服务名是怎么变成具体 IP 的？

`@FeignClient(name = "inventory-service")` 里写的是服务名，不是具体 IP。

真正调用时，流程大致是：

```text
Feign 代理发起调用
-> 根据服务名 inventory-service 查询实例列表
-> Spring Cloud LoadBalancer 选择一个实例
-> 拼接真实请求地址
-> 发起 HTTP 请求
```

Spring Cloud LoadBalancer 文档：[Spring Cloud LoadBalancer](https://docs.spring.io/spring-cloud-commons/reference/spring-cloud-commons/loadbalancer.html)。

例如注册中心里有两个库存服务实例：

```text
inventory-service 192.168.1.10:8082
inventory-service 192.168.1.11:8083
```

订单服务可能本次调用 8082，下次调用 8083。

图：Nacos 中 inventory-service 实例列表截图

![](images/2026/07/04/nacos-inventory-service-instances-placeholder.png)

## 负载均衡默认怎么选？

Spring Cloud LoadBalancer 默认会从可用实例中选择一个实例，常见策略是轮询。

例如：

```text
第 1 次 -> 192.168.1.10:8082
第 2 次 -> 192.168.1.11:8083
第 3 次 -> 192.168.1.10:8082
第 4 次 -> 192.168.1.11:8083
```

如果某个实例下线，注册中心会更新实例列表，调用方后续就不会再选到这个实例。

不过这里有两个实际问题：

1. 注册中心感知下线有延迟；
2. 实例还活着，不代表接口一定正常。

所以服务调用不能只依赖注册中心，还要配置合理的超时、重试和降级。

## 超时必须显式配置

远程调用最怕没有超时，或者超时时间过长。

假设订单服务 Tomcat 线程数是 200，库存服务接口卡住 30 秒。如果大量请求都阻塞在库存调用上，很快会把订单服务线程池占满。

OpenFeign 超时可以这样配置：

```yaml
spring:
  cloud:
    openfeign:
      client:
        config:
          inventory-service:
            connectTimeout: 1000
            readTimeout: 3000
```

含义：

| 配置 | 说明 |
| --- | --- |
| `connectTimeout` | 建立连接超时时间 |
| `readTimeout` | 读取响应超时时间 |

也可以设置默认配置：

```yaml
spring:
  cloud:
    openfeign:
      client:
        config:
          default:
            connectTimeout: 1000
            readTimeout: 3000
```

更推荐按服务配置。因为不同下游接口耗时差异很大，不能所有服务用同一套超时。

图：OpenFeign 超时配置截图

![](images/2026/07/04/openfeign-timeout-config-placeholder.png)

## 超时时间怎么定？

超时时间不要随便拍脑袋。

可以参考几个因素：

```text
下游接口 P95 / P99 耗时
业务可接受等待时间
网关超时时间
线程池容量
重试次数
调用链层级
```

例如：

```text
网关超时：10s
订单接口目标响应：2s 内
库存接口 P99：300ms
```

可以先设置：

```text
connectTimeout = 500ms
readTimeout = 1000ms
```

如果库存服务偶发慢查询，订单服务应该尽快失败，而不是一直等到网关超时。

一个常见错误是：

```text
网关超时 10s
订单调用库存 8s
订单又调用优惠券 8s
订单又调用用户服务 8s
```

最终请求还没走完，网关早就超时了。

服务链路越长，每一层的超时越要谨慎。

## 重试不是越多越好

重试能缓解瞬时网络抖动，但也可能放大故障。

例如库存服务已经很慢，订单服务每次失败都重试 3 次：

```text
原本 1000 QPS
重试 3 次后可能变成 3000 QPS
```

这会让已经变慢的库存服务压力更大。

更麻烦的是，重试可能造成重复业务操作。比如扣库存接口如果不是幂等的，重试可能多扣库存。

所以要区分接口类型：

| 接口类型 | 是否适合重试 |
| --- | --- |
| 查询库存 | 可以谨慎重试 |
| 创建订单 | 不建议盲目重试 |
| 扣减库存 | 必须保证幂等后才考虑重试 |
| 支付扣款 | 不允许简单重试，需要幂等和对账 |
| 发送通知 | 可以异步重试 |

OpenFeign 底层使用 Feign，Feign Retryer 文档可查看：[Feign Retryer](https://github.com/OpenFeign/feign)。在 Spring Cloud 项目中，更常见的是结合 Spring Retry、Resilience4j 或 Sentinel 做重试、限流和熔断。

## 一个谨慎的重试配置

如果只是查询类接口，可以配置有限次数重试。

示例：

```java
@Configuration
public class InventoryFeignConfig {

    @Bean
    public Retryer feignRetryer() {
        // period：首次重试间隔
        // maxPeriod：最大重试间隔
        // maxAttempts：最大尝试次数，包含首次请求
        return new Retryer.Default(100, 500, 2);
    }
}
```

绑定到指定 Feign Client：

```java
@FeignClient(
        name = "inventory-service",
        configuration = InventoryFeignConfig.class
)
public interface InventoryClient {

    @GetMapping("/api/inventory/check")
    InventoryCheckResponse checkInventory(
            @RequestParam("skuId") Long skuId,
            @RequestParam("count") Integer count
    );
}
```

这段配置的意思是最多尝试 2 次，也就是首次请求失败后最多重试 1 次。

不要给所有 Feign Client 全局开启多次重试。更合理的做法是：按接口重要性、幂等性和下游承压能力单独配置。

## Feign 日志怎么开？

排查服务调用问题时，经常需要看 Feign 请求日志。

定义日志级别：

```java
@Configuration
public class FeignLogConfig {

    @Bean
    public Logger.Level feignLoggerLevel() {
        // BASIC：记录请求方法、URL、响应状态和耗时
        // FULL：记录请求和响应的 header、body，排查时有用但日志量很大
        return Logger.Level.BASIC;
    }
}
```

配置日志输出：

```yaml
logging:
  level:
    com.example.order.client.InventoryClient: DEBUG
```

Feign 日志级别：

| 级别 | 说明 |
| --- | --- |
| `NONE` | 不记录日志 |
| `BASIC` | 记录方法、URL、状态码、耗时 |
| `HEADERS` | 额外记录请求和响应头 |
| `FULL` | 记录 header、body 和元数据 |

生产环境慎用 `FULL`，可能打印敏感信息，也可能造成日志量暴涨。

图：OpenFeign BASIC 调用日志截图

![](images/2026/07/04/openfeign-basic-log-placeholder.png)

## 接口返回值不要裸奔

库存服务不要直接返回各种不统一结构。

推荐统一响应外壳：

```json
{
  "data": {
    "skuId": "1001",
    "available": true,
    "stock": 20
  },
  "error": null
}
```

对应 Java 对象：

```java
public class ApiResponse<T> {
    private T data;
    private ApiError error;

    public boolean success() {
        return error == null;
    }
}
```

Feign Client：

```java
@FeignClient(name = "inventory-service")
public interface InventoryClient {

    @GetMapping("/api/inventory/check")
    ApiResponse<InventoryCheckResponse> checkInventory(
            @RequestParam("skuId") Long skuId,
            @RequestParam("count") Integer count
    );
}
```

业务处理：

```java
ApiResponse<InventoryCheckResponse> response = inventoryClient.checkInventory(skuId, count);

if (!response.success()) {
    throw new BusinessException("库存服务返回异常：" + response.getError().getMessage());
}

InventoryCheckResponse data = response.getData();
if (!data.isAvailable()) {
    throw new BusinessException("库存不足");
}
```

这样可以区分：

```text
HTTP 调用失败
业务返回失败
库存不足
参数错误
系统异常
```

不要把所有异常都变成一个 “调用失败”。

## 异常解码：ErrorDecoder

下游服务可能返回 400、404、500、502 等状态码。

可以自定义 Feign `ErrorDecoder`，把 HTTP 错误转换成业务异常。

```java
public class InventoryErrorDecoder implements ErrorDecoder {

    private final ErrorDecoder defaultDecoder = new Default();

    @Override
    public Exception decode(String methodKey, Response response) {
        int status = response.status();

        if (status == 404) {
            return new BusinessException("库存资源不存在");
        }

        if (status >= 500) {
            return new RemoteServiceException("库存服务异常，status=" + status);
        }

        return defaultDecoder.decode(methodKey, response);
    }
}
```

配置：

```java
@Configuration
public class InventoryFeignConfig {

    @Bean
    public ErrorDecoder inventoryErrorDecoder() {
        return new InventoryErrorDecoder();
    }
}
```

这样订单服务能根据异常类型做不同处理。

## 降级不是简单返回 null

服务调用失败后，有些接口可以降级，有些不能降级。

库存检查就是一个比较敏感的场景。如果库存服务不可用，订单服务不能简单返回“库存充足”，否则可能超卖。

更合理的处理是：

```text
库存服务不可用
-> 创建订单失败
-> 提示用户稍后重试
-> 记录调用失败日志
-> 触发告警
```

适合降级的场景：

- 商品推荐；
- 首页推荐位；
- 非核心统计数据；
- 用户等级展示；
- 营销文案。

不适合随意降级的场景：

- 支付；
- 扣库存；
- 创建订单；
- 权限校验；
- 资金账户。

如果要用熔断降级，可以考虑 [Resilience4j](https://resilience4j.readme.io/docs) 或 [Sentinel](https://github.com/alibaba/Sentinel/wiki)。

## Sentinel 降级示例

如果项目使用 Sentinel，可以给 Feign 开启 Sentinel 支持。

```yaml
feign:
  sentinel:
    enabled: true
```

定义 fallback：

```java
@Component
public class InventoryClientFallback implements InventoryClient {

    @Override
    public ApiResponse<InventoryCheckResponse> checkInventory(Long skuId, Integer count) {
        // 库存检查属于核心链路，降级时不要返回库存充足
        ApiError error = new ApiError("inventory_unavailable", "库存服务暂时不可用");
        return ApiResponse.fail(error);
    }
}
```

绑定 fallback：

```java
@FeignClient(
        name = "inventory-service",
        fallback = InventoryClientFallback.class
)
public interface InventoryClient {

    @GetMapping("/api/inventory/check")
    ApiResponse<InventoryCheckResponse> checkInventory(
            @RequestParam("skuId") Long skuId,
            @RequestParam("count") Integer count
    );
}
```

关键点不是“有没有 fallback”，而是 fallback 的业务含义是否安全。

## 连接池也要关注

Feign 最终还是通过 HTTP 客户端发请求。不同版本和配置下，底层可能使用 JDK 默认、Apache HttpClient、OkHttp 等。

如果使用 Apache HttpClient 或 OkHttp，可以配置连接池。

例如开启 OkHttp：

```yaml
spring:
  cloud:
    openfeign:
      okhttp:
        enabled: true
```

加入依赖：

```xml
<dependency>
    <groupId>io.github.openfeign</groupId>
    <artifactId>feign-okhttp</artifactId>
</dependency>
```

OkHttp 项目地址：[OkHttp](https://square.github.io/okhttp/)。

连接池配置需要结合 QPS、下游实例数和超时时间评估。连接池太小会排队，太大可能压垮下游。

## 调用链超时要整体算账

一个订单创建接口可能调用多个服务：

```text
用户服务
库存服务
优惠券服务
积分服务
支付预下单
```

如果每个 Feign 调用都设置 3 秒超时，最坏情况下接口可能拖很久。

更合理的方式是给整个业务链路设定预算：

```text
订单创建接口目标 2 秒内返回
用户服务最多 200ms
库存服务最多 500ms
优惠券服务最多 300ms
积分服务最多 200ms
预留业务处理和数据库时间
```

如果某个非核心调用超时，可以降级；核心调用超时，则快速失败。

这比所有服务统一配置 5 秒超时更可控。

## 排查一次 Feign 超时

假设订单服务日志里出现：

```text
feign.RetryableException: Read timed out executing GET http://inventory-service/api/inventory/check
```

排查时不要只盯订单服务。

可以按这个顺序看：

```text
订单服务 Feign 日志
-> 库存服务接口日志
-> 注册中心实例状态
-> 库存服务慢 SQL
-> JVM GC 日志
-> 容器 CPU / 内存
-> 网络连接状态
```

常用命令：

```bash
curl http://inventory-service/api/inventory/check?skuId=1001\&count=1
```

查看库存服务实例：

```bash
kubectl get pods -l app=inventory-service
```

或者在 Nacos 控制台查看实例是否健康。

如果库存服务本身响应慢，再看慢 SQL、线程池和 GC。

图：Feign Read timed out 异常日志截图

![](images/2026/07/04/openfeign-read-timeout-log-placeholder.png)

## 一个配置示例

订单服务可以先使用下面这套配置作为起点：

```yaml
spring:
  cloud:
    openfeign:
      client:
        config:
          # 默认配置，适合大多数普通下游服务
          default:
            connectTimeout: 1000
            readTimeout: 3000
            loggerLevel: basic
          # 库存服务是订单核心链路，超时设置更短，避免拖垮订单接口
          inventory-service:
            connectTimeout: 500
            readTimeout: 1000
            loggerLevel: basic
      okhttp:
        enabled: true

logging:
  level:
    # 只打开指定 Feign Client 的 DEBUG 日志，避免全局日志过多
    com.example.order.client.InventoryClient: DEBUG
```

配合 Feign Client：

```java
@FeignClient(
        name = "inventory-service",
        configuration = InventoryFeignConfig.class,
        fallback = InventoryClientFallback.class
)
public interface InventoryClient {

    @GetMapping("/api/inventory/check")
    ApiResponse<InventoryCheckResponse> checkInventory(
            @RequestParam("skuId") Long skuId,
            @RequestParam("count") Integer count
    );
}
```

长代码块里最关键的是三个点：

```text
按服务单独设置超时
只给必要 Client 开日志
fallback 不能破坏业务正确性
```

## 最容易踩的几个坑

### 1. 把远程调用当本地调用

Feign 接口看起来像普通 Java 方法，但它背后是网络调用。

一定要考虑：

```text
超时
失败
重试
幂等
降级
日志
监控
```

### 2. 全局重试导致故障放大

重试要按接口判断。非幂等接口不要随意重试。

### 3. fallback 返回了错误的成功值

比如库存服务失败时返回库存充足，这会直接引发超卖风险。

### 4. 超时时间比网关还长

下游还没返回，网关已经超时，用户已经看到失败，但后端线程还在等，资源被浪费。

### 5. 日志级别开 FULL 后忘记关

`FULL` 会打印请求和响应 body，排查问题时有用，但生产环境长期打开风险很高。

### 6. 没有区分业务失败和调用失败

库存不足是业务失败；库存服务超时是调用失败。这两类问题前端提示、日志级别和告警策略都应该不同。

## 服务调用上线检查清单

新增一个 Feign 调用前，可以检查这些内容：

```text
是否配置超时
是否需要重试
接口是否幂等
失败是否可降级
fallback 是否安全
是否打开必要日志
是否有调用耗时监控
是否有错误率告警
是否会造成循环调用
是否需要透传 traceId
是否会打印敏感参数
```

服务调用不是写完接口就结束。真正上线后，最重要的是可观测和可控。

图：服务调用耗时监控面板截图

![](images/2026/07/04/spring-cloud-feign-latency-dashboard-placeholder.png)

## 结尾

OpenFeign 能让服务间 HTTP 调用变得很简单，但它只能简化编码方式，不能消除远程调用本身的不确定性。

一个稳定的服务调用链路，至少要考虑：

```text
服务发现
负载均衡
连接池
超时
重试
幂等
降级
日志
监控
告警
```

订单服务调用库存服务这个例子里，真正关键的不是 `@FeignClient` 怎么写，而是库存服务异常时订单服务怎么保护自己。

微服务系统里，每一次远程调用都可能失败。默认失败、快速失败、可观测失败，通常比长时间阻塞后把整个链路拖垮更安全。
