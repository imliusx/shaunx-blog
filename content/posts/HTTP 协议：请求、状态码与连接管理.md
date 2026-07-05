---
title: HTTP 协议：请求、状态码与连接管理
slug: http-protocol-core-mechanisms
date: 2026-07-06
category: 原理
tags:
  - HTTP
  - 网络协议
  - 后端开发
  - Web
description: HTTP 是 Web 系统中最常用的应用层协议。内容按照基础概念、URL 结构、请求响应报文、方法语义、状态码、Header、Cookie、缓存、连接复用、HTTPS、HTTP/2、HTTP/3 和后端排查思路展开，帮助后端开发建立完整的协议认知。
cover:
published: true
---

## HTTP 是什么

HTTP，全称 HyperText Transfer Protocol，中文通常叫超文本传输协议。

它是一个应用层协议，主要用于客户端和服务端之间传输资源。浏览器打开网页、前端调用接口、App 请求后端、服务之间调用 REST API，大多都离不开 HTTP。

一次典型交互可以理解为：

```text
客户端发起请求
-> 服务端解析请求
-> 服务端处理业务
-> 服务端返回响应
-> 客户端解析响应
```

HTTP 不关心服务端内部如何处理业务。服务端可以查询 MySQL、访问 Redis、调用第三方接口，也可以直接返回静态文件。HTTP 只负责规定客户端和服务端之间如何表达请求与响应。

HTTP 官方语义规范可以查看：[RFC 9110 HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)。日常查字段、状态码和 Header，MDN 的资料更容易阅读：[HTTP - MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP)。

## 协议分层

HTTP 位于应用层，底层通常依赖 TCP 传输。

常见访问链路可以简化成：

```text
HTTP 应用层协议
-> TLS 加密层，HTTPS 场景存在
-> TCP 传输层
-> IP 网络层
-> 以太网、Wi-Fi 等链路层
```

HTTP 负责表达业务请求，TCP 负责可靠传输，IP 负责寻址和路由。

举个例子，请求接口：

```http
GET https://api.example.com/api/v1/orders/1001
```

背后会经历 DNS 解析、TCP 连接、TLS 握手、HTTP 请求发送、服务端响应返回等步骤。

图：HTTP 在网络协议分层中的位置


## URL 结构

一个 URL 不只是接口地址，它包含了访问资源所需的多个部分。

```text
https://api.example.com:443/api/v1/orders/1001?status=PAID&pageNo=1#detail
```

可以拆成：

| 部分 | 示例 | 说明 |
| --- | --- | --- |
| Scheme | `https` | 协议类型 |
| Host | `api.example.com` | 主机名 |
| Port | `443` | 端口号 |
| Path | `/api/v1/orders/1001` | 资源路径 |
| Query | `status=PAID&pageNo=1` | 查询参数 |
| Fragment | `detail` | 页面片段，通常不发送给服务端 |

HTTP 默认端口是 `80`，HTTPS 默认端口是 `443`。

后端接口设计中，Path 通常表示资源，Query 通常表示筛选条件：

```http
GET /api/v1/orders/1001
GET /api/v1/orders?status=PAID&pageNo=1&pageSize=20
```

第一个接口查询单个订单，第二个接口查询订单列表。

## 请求报文结构

HTTP 请求由三部分组成：请求行、请求头、请求体。

```http
POST /api/v1/orders HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9
X-Request-Id: 7f8f0c9d4c5c4d71

{
  "skuId": 1001,
  "quantity": 2
}
```

结构拆开看：

```text
请求行：POST /api/v1/orders HTTP/1.1
请求头：Host、Content-Type、Authorization、X-Request-Id
空行：用于分隔 Header 和 Body
请求体：JSON 业务数据
```

请求行又包含三部分：

| 部分 | 示例 | 说明 |
| --- | --- | --- |
| Method | `POST` | 请求方法 |
| Request Target | `/api/v1/orders` | 请求目标 |
| Version | `HTTP/1.1` | 协议版本 |

请求头用于传递元数据，例如内容类型、鉴权信息、客户端信息、追踪 ID。请求体用于传递业务数据，常见于 `POST`、`PUT`、`PATCH`。

`GET` 请求通常不携带 Body。虽然协议并没有绝对禁止，但实际工程中不推荐这么用，因为很多代理、网关、框架对 `GET Body` 支持并不一致。

## 响应报文结构

HTTP 响应也由三部分组成：状态行、响应头、响应体。

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store
X-Request-Id: 7f8f0c9d4c5c4d71

{
  "code": "0",
  "message": "success",
  "data": {
    "orderId": 9001,
    "status": "UNPAID"
  }
}
```

结构拆开看：

```text
状态行：HTTP/1.1 200 OK
响应头：Content-Type、Cache-Control、X-Request-Id
空行：用于分隔 Header 和 Body
响应体：JSON 响应数据
```

状态行包含协议版本、状态码和原因短语：

| 部分 | 示例 | 说明 |
| --- | --- | --- |
| Version | `HTTP/1.1` | 协议版本 |
| Status Code | `200` | 状态码 |
| Reason Phrase | `OK` | 原因短语 |

图：HTTP 请求报文与响应报文结构


## 请求方法

HTTP 方法用于表达客户端想对资源执行什么操作。

| 方法 | 常见用途 | 是否安全 | 是否幂等 |
| --- | --- | --- | --- |
| `GET` | 查询资源 | 是 | 是 |
| `POST` | 创建资源、提交动作 | 否 | 不一定 |
| `PUT` | 全量更新资源 | 否 | 是 |
| `PATCH` | 局部更新资源 | 否 | 不一定 |
| `DELETE` | 删除资源 | 否 | 是 |
| `HEAD` | 只获取响应头 | 是 | 是 |
| `OPTIONS` | 查询服务支持的能力 | 是 | 是 |

安全方法表示不会修改服务端资源，例如 `GET`。幂等表示同一个请求执行一次和执行多次，对资源最终状态的影响一致。

几个常见接口可以这样设计：

```http
GET    /api/v1/orders/1001
POST   /api/v1/orders
PATCH  /api/v1/orders/1001/remark
DELETE /api/v1/order-drafts/1001
POST   /api/v1/orders/1001/cancel
```

`cancel` 这种动作型接口，使用 `POST` 更容易表达业务语义。即使重复取消后订单仍然是取消状态，也要在后端做好幂等，避免重复释放库存或重复发送通知。

## 状态码

状态码表示 HTTP 请求在协议层面的处理结果。

| 范围 | 含义 |
| --- | --- |
| `1xx` | 信息提示 |
| `2xx` | 请求成功 |
| `3xx` | 重定向 |
| `4xx` | 客户端错误 |
| `5xx` | 服务端错误 |

后端开发最常见的状态码：

| 状态码 | 含义 | 典型场景 |
| --- | --- | --- |
| `200` | 成功 | 查询成功、业务正常返回 |
| `201` | 已创建 | 创建资源成功 |
| `204` | 无响应体 | 删除成功但不返回内容 |
| `301` | 永久重定向 | 域名迁移、HTTP 跳 HTTPS |
| `302` | 临时重定向 | 登录跳转、临时地址跳转 |
| `304` | 资源未修改 | 协商缓存命中 |
| `400` | 请求错误 | JSON 格式错误、参数类型错误 |
| `401` | 未认证 | 未登录、Token 失效 |
| `403` | 无权限 | 已登录但没有操作权限 |
| `404` | 资源不存在 | 路由不存在、数据不存在 |
| `409` | 冲突 | 重复提交、版本冲突 |
| `429` | 请求过多 | 触发限流 |
| `500` | 服务端异常 | 未捕获异常 |
| `502` | 网关错误 | Nginx 访问上游失败 |
| `503` | 服务不可用 | 服务维护、熔断降级 |
| `504` | 网关超时 | 上游接口响应超时 |

业务系统里通常还会有业务错误码。例如 HTTP 状态码是 `200`，但业务结果是库存不足：

```json
{
  "code": "STOCK_NOT_ENOUGH",
  "message": "商品库存不足",
  "data": null,
  "traceId": "7f8f0c9d4c5c4d71"
}
```

HTTP 状态码和业务错误码不要混在一起理解。HTTP 状态码描述请求在协议层是否成功到达并被处理，业务错误码描述业务规则是否通过。

图：浏览器 Network 面板中的 HTTP 状态码截图

![](images/2026/07/06/http-status-code-network-panel-placeholder.png)

## Header 的作用

Header 用来描述请求或响应的元信息。很多 HTTP 能力并不写在 Body 里，而是靠 Header 协商。

常见请求头：

| Header | 作用 |
| --- | --- |
| `Host` | 目标主机名 |
| `User-Agent` | 客户端信息 |
| `Accept` | 客户端能接收的响应类型 |
| `Content-Type` | 请求体格式 |
| `Authorization` | 鉴权信息 |
| `Cookie` | 浏览器携带的 Cookie |
| `X-Request-Id` | 请求追踪 ID |
| `Idempotency-Key` | 幂等 Key |

常见响应头：

| Header | 作用 |
| --- | --- |
| `Content-Type` | 响应体格式 |
| `Content-Length` | 响应体长度 |
| `Set-Cookie` | 服务端写入 Cookie |
| `Cache-Control` | 缓存策略 |
| `ETag` | 资源版本标识 |
| `Location` | 重定向地址 |
| `Content-Disposition` | 文件下载行为 |
| `Access-Control-Allow-Origin` | 跨域控制 |

接口联调中，`Content-Type` 很常见。

前端传 JSON：

```http
Content-Type: application/json
```

后端用 Spring Boot 接收：

```java
@PostMapping("/api/v1/orders")
public ApiResponse<CreateOrderResponse> createOrder(@RequestBody CreateOrderRequest request) {
    // @RequestBody 会把 JSON 请求体反序列化成 Java 对象
    CreateOrderResponse response = orderService.createOrder(request);
    return ApiResponse.success(response);
}
```

前端传表单：

```http
Content-Type: application/x-www-form-urlencoded
```

文件上传：

```http
Content-Type: multipart/form-data
```

参数明明传了，后端却接收不到，很多时候就是请求头和参数格式没有匹配。

## 无状态与登录态

HTTP 本身是无状态协议。服务端不会因为上一次请求登录成功，就天然记得下一次请求是谁。

所以 Web 系统需要额外机制维护登录态。

### Cookie + Session

传统 Web 系统常用 Cookie + Session。

```text
用户登录成功
-> 服务端创建 Session
-> 响应头 Set-Cookie 返回 sessionId
-> 浏览器后续请求自动携带 Cookie
-> 服务端根据 sessionId 找到用户信息
```

响应头：

```http
Set-Cookie: JSESSIONID=abc123; Path=/; HttpOnly; Secure; SameSite=Lax
```

后续请求：

```http
Cookie: JSESSIONID=abc123
```

常见 Cookie 属性：

| 属性 | 作用 |
| --- | --- |
| `HttpOnly` | 禁止 JavaScript 读取，降低 XSS 窃取风险 |
| `Secure` | 只允许 HTTPS 传输 |
| `SameSite` | 限制跨站请求携带 Cookie，降低 CSRF 风险 |
| `Max-Age` | 设置存活时间 |

### Token

前后端分离项目更常见 Token 方案。

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9
```

Token 可以放在 Header 里，由服务端解析用户身份。JWT、随机 Token、网关 Token 都属于常见实现。

Cookie + Session 和 Token 没有绝对好坏。选择时要考虑系统形态、跨域、退出登录、服务端存储、安全策略和客户端类型。

## 缓存机制

HTTP 缓存可以减少重复请求，提高页面加载速度，也能降低服务端压力。

缓存主要分两类：强缓存和协商缓存。

### 强缓存

强缓存命中时，客户端直接使用本地缓存，不请求服务端。

```http
Cache-Control: max-age=3600
```

表示 3600 秒内可以直接使用缓存。

如果接口涉及用户隐私或实时数据，可以禁止缓存：

```http
Cache-Control: no-store
```

### 协商缓存

协商缓存会请求服务端确认资源是否变化。

第一次响应：

```http
ETag: "a1b2c3"
Last-Modified: Mon, 06 Jul 2026 10:00:00 GMT
```

后续请求：

```http
If-None-Match: "a1b2c3"
If-Modified-Since: Mon, 06 Jul 2026 10:00:00 GMT
```

如果资源没变化，服务端返回：

```http
HTTP/1.1 304 Not Modified
```

浏览器继续使用本地缓存。

静态资源适合较长缓存，例如 JS、CSS、图片。订单、账户余额、权限菜单这类接口要谨慎缓存。

图：浏览器 Network 面板中的缓存命中截图

![](images/2026/07/06/http-cache-network-panel-placeholder.png)

## 连接管理

HTTP 基于传输层协议发送数据。HTTP/1.1 最常见的底层传输是 TCP。

早期短连接模式下，每次请求都要建立 TCP 连接，请求结束后关闭连接：

```text
建立 TCP 连接
-> 发送 HTTP 请求
-> 接收 HTTP 响应
-> 关闭 TCP 连接
```

这样成本很高，因为 TCP 建连需要三次握手，HTTPS 还要进行 TLS 握手。

HTTP/1.1 默认支持持久连接，也就是 Keep-Alive：

```http
Connection: keep-alive
```

同一个 TCP 连接可以复用多次：

```text
建立 TCP 连接
-> 发送第 1 个 HTTP 请求
-> 接收第 1 个 HTTP 响应
-> 发送第 2 个 HTTP 请求
-> 接收第 2 个 HTTP 响应
-> 空闲超时后关闭连接
```

连接复用能减少握手开销，但也要关注连接池配置。

Java 服务调用外部 HTTP 接口时，至少要设置：

- 连接超时；
- 读取超时；
- 连接池大小；
- 空闲连接存活时间；
- 请求整体超时时间。

以 OkHttp 为例：

```java
OkHttpClient client = new OkHttpClient.Builder()
        // 建立连接的最长等待时间
        .connectTimeout(Duration.ofSeconds(3))
        // 等待服务端返回数据的最长时间
        .readTimeout(Duration.ofSeconds(5))
        // 控制空闲连接数量和存活时间，避免频繁创建连接
        .connectionPool(new ConnectionPool(50, 5, TimeUnit.MINUTES))
        .build();
```

没有超时的 HTTP 调用很危险。一个下游接口卡住，可能占满调用方线程池，最终拖垮整个服务。

## HTTPS

HTTPS 可以理解为 HTTP + TLS。

```text
HTTP：明文传输
HTTPS：HTTP 数据经过 TLS 加密后传输
```

HTTPS 主要解决三个问题：

| 能力 | 说明 |
| --- | --- |
| 加密 | 防止传输内容被直接读取 |
| 认证 | 通过证书确认服务端身份 |
| 完整性 | 防止数据在传输过程中被篡改 |

浏览器访问 HTTPS 网站时，会先进行 TLS 握手，验证证书，协商密钥，然后再传输 HTTP 数据。

常见 HTTPS 问题：

- 证书过期；
- 证书域名不匹配；
- 本地环境使用自签证书；
- Nginx 终止 TLS 后转发到后端 HTTP；
- 反向代理没有正确传递 `X-Forwarded-Proto`；
- HTTPS 页面加载 HTTP 资源，被浏览器拦截。

生产环境对外接口尽量全部使用 HTTPS。

图：HTTPS TLS 握手示意图

![](images/2026/07/06/https-tls-handshake-placeholder.png)

## HTTP 版本演进

### HTTP/1.0

HTTP/1.0 以短连接为主，每次请求都建立和关闭连接。它简单直观，但连接成本高。

### HTTP/1.1

HTTP/1.1 引入了默认持久连接，支持 Host Header，也支持分块传输等机制。

它解决了很多 HTTP/1.0 的问题，但仍然存在队头阻塞：同一个连接上的请求响应顺序会互相影响。

### HTTP/2

HTTP/2 使用二进制分帧，支持多路复用和 Header 压缩。一个连接上可以并发多个请求，减少了 HTTP/1.1 下多个请求排队的问题。

HTTP/2 规范可以查看：[RFC 9113 HTTP/2](https://www.rfc-editor.org/rfc/rfc9113.html)。

### HTTP/3

HTTP/3 基于 QUIC，底层使用 UDP。它的目标是降低连接建立延迟，改善弱网环境下的传输体验。

HTTP/3 规范可以查看：[RFC 9114 HTTP/3](https://www.rfc-editor.org/rfc/rfc9114.html)。

可以简单记：

```text
HTTP/1.0：短连接为主
HTTP/1.1：Keep-Alive 持久连接
HTTP/2：二进制分帧、多路复用、Header 压缩
HTTP/3：基于 QUIC，改善连接延迟和弱网体验
```

图：HTTP/1.1、HTTP/2、HTTP/3 连接模型对比图

![](images/2026/07/06/http-version-connection-model-placeholder.png)

## 跨域

前后端分离项目经常遇到 CORS。浏览器出于安全考虑，会限制跨域请求。

只要协议、域名、端口有一个不同，就属于跨域：

```text
http://localhost:3000
http://localhost:8080
```

端口不同，也算跨域。

复杂请求发送前，浏览器会先发预检请求：

```http
OPTIONS /api/v1/orders HTTP/1.1
Origin: http://localhost:3000
Access-Control-Request-Method: POST
Access-Control-Request-Headers: Content-Type, Authorization
```

服务端返回允许跨域的 Header：

```http
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
Access-Control-Allow-Headers: Content-Type,Authorization
Access-Control-Allow-Credentials: true
```

Spring Boot 可以统一配置：

```java
@Configuration
public class WebCorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                // 生产环境不要直接放开为 *，应该配置明确域名
                .allowedOrigins("https://www.example.com")
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("Content-Type", "Authorization", "X-Request-Id")
                .allowCredentials(true)
                .maxAge(3600);
    }
}
```

CORS 是浏览器安全策略。Postman 或 curl 能正常访问，不代表浏览器不会报跨域错误。

## 后端开发注意点

### 统一响应结构

业务接口最好保持统一响应格式：

```json
{
  "code": "0",
  "message": "success",
  "data": {},
  "traceId": "7f8f0c9d4c5c4d71"
}
```

这样前端、测试、日志和监控都更容易处理。

### TraceId

每个请求最好都有 TraceId。可以由网关生成，也可以由后端入口生成。

```http
X-Request-Id: 7f8f0c9d4c5c4d71
```

日志里打印 TraceId 后，可以把网关日志、应用日志、数据库慢日志串起来。

### 超时和重试

服务之间的 HTTP 调用必须设置超时。重试要谨慎，查询接口可以适当重试，写接口必须配合幂等 Key。

例如创建订单接口，如果没有幂等控制，自动重试可能创建多笔订单。

### 文件上传

文件上传一般使用 `multipart/form-data`。

除了后端接口限制文件大小，还要检查 Nginx 的 `client_max_body_size`。否则可能出现后端允许 100MB，Nginx 只允许 1MB，最终请求在网关层就被拒绝。

## 排查命令

`curl -v` 可以看到请求和响应细节：

```bash
curl -v \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer token" \
  -d '{"skuId":1001,"quantity":2}' \
  https://api.example.com/api/v1/orders
```

只查看响应头：

```bash
curl -I https://www.example.com
```

查看 HTTP 各阶段耗时：

```bash
curl -o /dev/null -s -w \
  'dns=%{time_namelookup}\nconnect=%{time_connect}\ntls=%{time_appconnect}\nstart_transfer=%{time_starttransfer}\ntotal=%{time_total}\n' \
  https://www.example.com
```

这些指标可以帮助判断耗时发生在哪个阶段：

| 指标 | 含义 |
| --- | --- |
| `time_namelookup` | DNS 解析耗时 |
| `time_connect` | TCP 连接耗时 |
| `time_appconnect` | TLS 握手耗时 |
| `time_starttransfer` | 服务端开始返回数据耗时 |
| `time_total` | 整体请求耗时 |

图：curl 输出 HTTP 耗时指标截图

![](images/2026/07/06/curl-http-timing-output-placeholder.png)

## 总结

HTTP 是后端开发必须掌握的基础协议。先理解 URL、请求报文、响应报文，再理解方法语义、状态码、Header、Cookie、缓存和连接复用，最后再看 HTTPS、HTTP/2、HTTP/3、跨域和线上排查，会更容易形成完整体系。

接口能跑通只是第一步。真正稳定的 HTTP 接口，还需要清晰的协议语义、合理的状态码、正确的 Header、可控的超时、统一的错误格式、可追踪的日志和必要的安全策略。
