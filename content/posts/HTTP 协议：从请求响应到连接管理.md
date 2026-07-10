---
title: HTTP 协议：从请求响应到连接管理
slug: http-protocol-request-response-connection-troubleshooting
date: 2025-05-11
category: 原理
tags:
  - HTTP
  - 网络协议
  - 后端开发
  - Web
description: 从请求响应、URL、Method、状态码、Header、缓存、Cookie、HTTPS、HTTP/2、连接复用到线上排查，系统梳理 HTTP 协议在实际开发中的常见知识点。
cover:
published: true
---

## 写在前面

做后端开发时，HTTP 基本每天都在用：写 Controller、调接口、看网关日志、排查 404/500、处理跨域、配置 Nginx、对接第三方回调。

但很多时候我们对 HTTP 的理解还停留在：

```text
GET 用来查询
POST 用来提交
200 表示成功
404 表示找不到
500 表示服务异常
```

这些当然没错，但真正到项目里，问题往往会更细：

- 为什么前端请求发出去了，后端接口却没有收到？
- 为什么接口返回 200，业务上还是失败？
- 为什么浏览器会先发一个 OPTIONS 请求？
- 为什么登录态有时丢失，Cookie 没带上？
- 为什么接口偶发超时，是代码慢、网络慢，还是连接池不够？
- 为什么静态资源命中了缓存，接口数据却不能随便缓存？
- HTTP/1.1、HTTP/2、HTTPS 到底解决了什么问题？

这篇文章把 HTTP 协议中最常用、最容易在日常开发中遇到的内容串起来。

## HTTP 是什么

HTTP，全称 HyperText Transfer Protocol，超文本传输协议。

它本质上是一套客户端和服务端之间通信的规则：

```text
客户端按照 HTTP 格式发送请求
服务端按照 HTTP 格式返回响应
双方都遵守同一套语义和报文结构
```

在实际开发中，客户端不一定是浏览器，也可能是：

- 前端页面；
- 移动 App；
- 小程序；
- 后端服务；
- 第三方平台；
- curl、Postman、Apifox 这类调试工具。

服务端也不一定只是业务服务，中间可能经过很多组件：

```text
Browser / App
    -> CDN
    -> WAF
    -> Nginx / Gateway
    -> Load Balancer
    -> Spring Boot / Node.js / Go Service
    -> DB / Redis / MQ
```

所以排查 HTTP 问题时，不能只盯着 Controller。请求可能在 CDN、网关、Nginx、鉴权过滤器、限流组件里就已经被拦截了。

## 一次 HTTP 请求的完整链路

以访问一个接口为例：

```http
GET https://api.example.com/api/v1/orders/1001
```

大致流程如下：

```text
1. 解析 URL
2. DNS 解析域名，获取服务器 IP
3. 建立 TCP 连接
4. 如果是 HTTPS，进行 TLS 握手
5. 客户端发送 HTTP Request
6. 中间代理、网关、服务端处理请求
7. 服务端返回 HTTP Response
8. 客户端解析响应，处理数据或渲染页面
9. 根据协议和配置决定连接是否复用
```

后端开发最常接触的是第 5、6、7 步，但排查超时、证书、连接数、网关问题时，前面的 DNS、TCP、TLS 也要有基本概念。

可以简单理解为：

```text
HTTP 负责“说什么”
TCP 负责“可靠地传过去”
TLS 负责“加密后再传”
IP 负责“找到对方机器”
```

## URL：定位资源

URL 用来定位资源。一个完整 URL 可以拆成几部分：

```text
https://api.example.com:443/api/v1/orders/1001?source=app#detail
```

| 部分       | 示例                    | 说明                         |
| -------- | --------------------- | -------------------------- |
| Scheme   | `https`               | 使用的协议                      |
| Host     | `api.example.com`     | 域名或 IP                     |
| Port     | `443`                 | 端口，HTTPS 默认 443，HTTP 默认 80 |
| Path     | `/api/v1/orders/1001` | 资源路径                       |
| Query    | `source=app`          | 查询参数                       |
| Fragment | `detail`              | 页面片段，不会发送给服务端              |

这里要注意一个细节：`#detail` 这类 Fragment 只在浏览器端使用，不会被发送到服务端。所以如果后端发现怎么也拿不到 `#` 后面的参数，不是代码问题，而是协议设计如此。

接口设计时常见写法：

```http
GET  /api/v1/orders/1001
GET  /api/v1/orders?status=PAID&pageNo=1&pageSize=20
POST /api/v1/orders
POST /api/v1/orders/1001/cancel
```

比较推荐的原则是：

- Path 表示资源；
- Query 表示筛选、分页、排序；
- Body 表示复杂业务数据；
- Header 放认证、链路追踪、客户端版本等元信息。

## HTTP 请求报文

一个 HTTP 请求通常由四部分组成：

```http
POST /api/v1/orders HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer xxx
X-Request-Id: 8f7c9e1a

{
  "skuId": 1001,
  "quantity": 2
}
```

拆开看：

```text
请求行：POST /api/v1/orders HTTP/1.1
请求头：Host、Content-Type、Authorization、X-Request-Id
空行：用于分隔 Header 和 Body
请求体：JSON、表单、文件等业务数据
```

请求行包含三个信息：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| Method | `POST` | 请求方法 |
| Request Target | `/api/v1/orders` | 请求目标 |
| Version | `HTTP/1.1` | 协议版本 |

请求头是 HTTP 里非常重要的一部分。很多线上问题不是 Body 传错，而是 Header 没传、传错或被代理层改掉了。

## HTTP 响应报文

响应报文也可以分成四部分：

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store
Set-Cookie: SESSION=abc; Path=/; HttpOnly

{
  "code": "0",
  "message": "success",
  "data": {
    "orderId": 1001,
    "status": "UNPAID"
  }
}
```

拆开看：

```text
状态行：HTTP/1.1 200 OK
响应头：Content-Type、Cache-Control、Set-Cookie
空行：用于分隔 Header 和 Body
响应体：JSON、HTML、图片、文件等内容
```

状态行里的 `200` 是 HTTP 状态码，只能说明协议层面请求被成功处理，不一定代表业务成功。

比如很多后端项目会这样返回：

```json
{
  "code": "ORDER_STOCK_NOT_ENOUGH",
  "message": "库存不足",
  "data": null
}
```

HTTP 状态码仍然是 `200`，但业务已经失败了。因此前端和后端要约定清楚：

- HTTP 状态码表达协议层和基础错误；
- 业务 code 表达业务成功或失败；
- traceId 用于排查日志链路。

## 请求方法：不只是 GET 和 POST

HTTP 方法描述客户端想对资源做什么。

| 方法 | 常见用途 | 是否安全 | 是否幂等 |
| --- | --- | --- | --- |
| GET | 查询资源 | 是 | 是 |
| POST | 创建资源、提交动作 | 否 | 通常否 |
| PUT | 全量更新资源 | 否 | 是 |
| PATCH | 局部更新资源 | 否 | 通常否 |
| DELETE | 删除资源 | 否 | 是 |
| HEAD | 只获取响应头 | 是 | 是 |
| OPTIONS | 查询服务支持的方法、跨域预检 | 是 | 是 |

这里有两个概念很重要。

### 安全性

安全方法指的是不会修改服务端资源，例如 `GET`、`HEAD`。

所以不要用 GET 做删除、扣库存、发券这类操作：

```http
GET /api/v1/orders/1001/cancel
```

看起来方便，但会带来风险。浏览器预加载、爬虫、缓存代理都可能触发 GET 请求，一旦 GET 改了数据，问题会很隐蔽。

### 幂等性

幂等指的是同一个请求执行一次和执行多次，对资源状态的影响一致。

例如：

```http
DELETE /api/v1/orders/1001
```

删除一次和删除多次，最终结果都是订单不存在，所以可以认为是幂等的。

但创建订单通常不是幂等的：

```http
POST /api/v1/orders
```

用户连续点击两次，可能创建出两笔订单。因此真实项目里要加幂等控制，例如：

```http
POST /api/v1/orders
Idempotency-Key: 7f8c9d0e
```

服务端根据幂等 Key、用户 ID、业务类型等维度判断是否重复提交。

## 状态码：先分大类再记细节

HTTP 状态码不需要死记所有，先按大类理解。

| 范围 | 含义 | 说明 |
| --- | --- | --- |
| 1xx | 信息响应 | 请求已收到，继续处理 |
| 2xx | 成功 | 请求成功处理 |
| 3xx | 重定向 | 需要客户端进一步操作 |
| 4xx | 客户端错误 | 请求本身有问题 |
| 5xx | 服务端错误 | 服务端处理失败 |

常见状态码：

| 状态码 | 含义 | 项目中的常见场景 |
| --- | --- | --- |
| 200 | OK | 请求成功 |
| 201 | Created | 创建资源成功 |
| 204 | No Content | 删除成功但无响应体 |
| 301 | Moved Permanently | 永久重定向 |
| 302 | Found | 临时重定向 |
| 304 | Not Modified | 缓存未过期，可继续使用本地缓存 |
| 400 | Bad Request | 参数格式错误、JSON 解析失败 |
| 401 | Unauthorized | 未登录、Token 无效 |
| 403 | Forbidden | 已登录但无权限 |
| 404 | Not Found | 路由不存在或资源不存在 |
| 405 | Method Not Allowed | 请求方法不支持 |
| 409 | Conflict | 资源冲突，例如重复提交 |
| 415 | Unsupported Media Type | Content-Type 不支持 |
| 429 | Too Many Requests | 被限流 |
| 500 | Internal Server Error | 服务端未知异常 |
| 502 | Bad Gateway | 网关访问上游服务失败 |
| 503 | Service Unavailable | 服务不可用、发布中、熔断 |
| 504 | Gateway Timeout | 网关等待上游服务超时 |

排查时要特别区分：

- `500`：请求已经到达应用，应用内部异常可能性较大；
- `502`：网关和上游服务之间有问题，例如服务没启动、端口不通；
- `504`：上游服务处理太慢或网络超时；
- `401`：认证失败；
- `403`：认证成功但权限不足。

## Header：HTTP 的元信息

Header 用来描述请求或响应的附加信息。后端开发常见 Header 如下。

### Content-Type

表示请求体或响应体的数据格式。

```http
Content-Type: application/json
Content-Type: application/x-www-form-urlencoded
Content-Type: multipart/form-data
```

常见问题：前端传的是 JSON，但 Header 没写 `application/json`，后端 `@RequestBody` 解析失败。

### Accept

表示客户端希望接收什么格式的数据。

```http
Accept: application/json
```

### Authorization

用于传递认证信息。

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

后端通常在过滤器或拦截器里解析 Token，再把用户信息放入上下文。

### Cookie 和 Set-Cookie

服务端通过 `Set-Cookie` 让浏览器保存 Cookie：

```http
Set-Cookie: SESSION=abc123; Path=/; HttpOnly; Secure; SameSite=Lax
```

浏览器后续请求会自动带上：

```http
Cookie: SESSION=abc123
```

关键属性：

| 属性 | 说明 |
| --- | --- |
| HttpOnly | JS 无法读取，降低 XSS 窃取风险 |
| Secure | 只在 HTTPS 下发送 |
| SameSite | 控制跨站请求是否携带 Cookie |
| Domain | Cookie 生效域名 |
| Path | Cookie 生效路径 |
| Max-Age / Expires | 过期时间 |

如果前后端分离项目中 Cookie 没带上，通常要检查：

- 前端请求是否开启 `withCredentials`；
- 服务端 CORS 是否允许凭证；
- Cookie 的 Domain、Path 是否匹配；
- SameSite 是否阻止了跨站携带；
- 是否 HTTPS 环境但 Secure 配置不正确。

### User-Agent

标识客户端类型，例如浏览器、App、爬虫、HTTP 客户端库。

实际项目里可以用于灰度、统计、兼容处理，但不要把核心安全逻辑完全建立在 User-Agent 上，因为它可以伪造。

### X-Request-Id / Trace-Id

用于链路追踪。

```http
X-Request-Id: 8f7c9e1a
```

建议每个请求都生成 traceId，并在网关、应用日志、RPC 调用、SQL 日志中透传。否则线上排查时只能按时间和用户 ID 大海捞针。

## 缓存：提升性能，也可能制造脏数据

HTTP 缓存主要用于减少重复请求、降低服务端压力、提升页面加载速度。

常见响应头：

```http
Cache-Control: max-age=3600
ETag: "abc123"
Last-Modified: Wed, 08 Jul 2026 10:00:00 GMT
```

### 强缓存

如果响应里有：

```http
Cache-Control: max-age=3600
```

表示 3600 秒内可以直接使用本地缓存，不需要再请求服务端。

适合：

- JS、CSS、图片等带 hash 的静态资源；
- 不经常变化的公开资源。

不适合：

- 用户订单；
- 账户余额；
- 权限菜单；
- 个人资料这类强实时数据。

### 协商缓存

客户端带着缓存标识问服务端：资源有没有变化？

```http
If-None-Match: "abc123"
If-Modified-Since: Wed, 08 Jul 2026 10:00:00 GMT
```

如果没变化，服务端返回：

```http
HTTP/1.1 304 Not Modified
```

这样可以省掉响应体传输。

### 项目实践建议

常见策略：

```text
静态资源：Cache-Control: max-age=31536000，文件名带 hash
接口数据：默认 no-store 或短缓存，按业务决定
敏感数据：Cache-Control: no-store
```

比如登录接口、订单详情、支付结果，不要随便让浏览器或代理缓存。

## Cookie、Session 和 Token

HTTP 本身是无状态的。也就是说，服务端单看一次请求，并不知道它和上一次请求是不是同一个用户发的。

为了解决登录态问题，常见方案有三种。

### Cookie + Session

```text
用户登录成功
-> 服务端创建 Session
-> 返回 Set-Cookie: SESSION=xxx
-> 浏览器保存 Cookie
-> 后续请求自动带 Cookie
-> 服务端根据 SESSION 找到用户
```

优点：浏览器支持好，开发简单。

缺点：服务端需要存 Session，分布式场景要解决 Session 共享，例如 Redis Session。

### Token / JWT

```text
用户登录成功
-> 服务端签发 Token
-> 客户端保存 Token
-> 请求时放到 Authorization Header
-> 服务端校验 Token
```

优点：适合前后端分离、App、小程序、开放 API。

缺点：Token 泄露后风险较大；JWT 一旦签发，失效控制要额外设计，比如黑名单、短 Token + Refresh Token。

### 不要混淆认证和授权

- 认证：你是谁？例如登录、Token 校验；
- 授权：你能做什么？例如是否能访问某个菜单、接口、数据范围。

HTTP 里的 `401` 更偏认证失败，`403` 更偏授权失败。

## HTTPS：HTTP + TLS

HTTPS 不是一套全新的应用层协议，可以简单理解为：

```text
HTTPS = HTTP + TLS
```

它主要解决三个问题：

| 问题 | HTTPS 的作用 |
| --- | --- |
| 窃听 | 数据加密，第三方看不到明文 |
| 篡改 | 消息完整性校验，防止被中间人修改 |
| 冒充 | 证书校验，确认访问的确实是目标站点 |

一次 HTTPS 请求在发送 HTTP 报文前，会先进行 TLS 握手。握手过程中会协商加密算法、验证证书、生成会话密钥。

实际项目中常见问题：

- 证书过期导致接口不可访问；
- 证书域名和访问域名不匹配；
- 本地测试环境使用自签证书，客户端不信任；
- Nginx 终止 TLS 后，应用层拿到的是 HTTP，需要通过 `X-Forwarded-Proto` 判断原始协议；
- HTTP 跳 HTTPS 的 301/302 配置不正确，造成重定向循环。

## 连接管理：短连接、长连接和连接池

HTTP 基于 TCP。TCP 建连是有成本的，如果每个请求都新建连接，性能会比较差。

### HTTP/1.0 短连接

早期 HTTP/1.0 常见模式是：

```text
建立 TCP 连接
发送一个 HTTP 请求
返回一个 HTTP 响应
关闭 TCP 连接
```

问题是每次请求都要建连，延迟和资源消耗都高。

### HTTP/1.1 长连接

HTTP/1.1 默认支持持久连接：

```http
Connection: keep-alive
```

同一个 TCP 连接可以复用来发送多个 HTTP 请求。

好处：

- 减少 TCP 建连成本；
- 减少 TLS 握手成本；
- 提高吞吐量。

但长连接也需要合理配置：

- 客户端连接池最大连接数；
- 每个 host 的最大连接数；
- 连接空闲超时时间；
- 读取超时时间；
- 网关和服务端 keep-alive 时间是否匹配。

如果配置不合理，可能出现：

- 连接池耗尽；
- 大量 CLOSE_WAIT；
- 偶发 SocketTimeout；
- 网关提前断开连接，客户端复用旧连接失败。

### HTTP/2 多路复用

HTTP/1.1 虽然能复用连接，但同一个连接上的请求仍然容易受队头阻塞影响。HTTP/2 引入了二进制分帧和多路复用，一个连接上可以并发多个请求和响应。

HTTP/2 常见优势：

- 多路复用；
- Header 压缩；
- 更适合大量小请求；
- 减少连接数量。

但对后端开发来说，重点不是死记协议细节，而是知道：浏览器、网关、服务端之间可能使用不同 HTTP 版本。比如浏览器到 Nginx 是 HTTP/2，Nginx 到后端应用仍然可能是 HTTP/1.1。

## 跨域 CORS：为什么会有 OPTIONS

跨域是浏览器的安全策略，不是 HTTP 服务端天然不允许。

当页面地址和接口地址的协议、域名、端口任意一个不同，就算跨域：

```text
https://www.example.com
https://api.example.com
```

这两个域名不同，所以跨域。

对于复杂请求，浏览器会先发一个预检请求：

```http
OPTIONS /api/v1/orders HTTP/1.1
Origin: https://www.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: Content-Type, Authorization
```

服务端需要返回允许策略：

```http
Access-Control-Allow-Origin: https://www.example.com
Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
Access-Control-Allow-Headers: Content-Type,Authorization
Access-Control-Allow-Credentials: true
```

常见坑：

- 只配置了业务接口，没有放行 OPTIONS；
- `Access-Control-Allow-Origin: *` 和 `Allow-Credentials: true` 同时使用导致浏览器拒绝；
- 前端带了自定义 Header，但服务端没有允许；
- 网关和应用重复配置 CORS，响应头冲突。

## 常见接口设计实践

HTTP 协议最终还是要落到接口设计和系统联调中。

### 统一响应结构

建议团队统一响应格式：

```json
{
  "code": "0",
  "message": "success",
  "data": {},
  "traceId": "8f7c9e1a"
}
```

业务异常示例：

```json
{
  "code": "ORDER_STOCK_NOT_ENOUGH",
  "message": "库存不足",
  "data": null,
  "traceId": "8f7c9e1a"
}
```

这样前端、测试、后端日志排查都更统一。

### 正确使用状态码

常见约定可以是：

- 参数格式错误：`400`；
- 未登录：`401`；
- 无权限：`403`；
- 资源不存在：`404`；
- 请求方法错误：`405`；
- 触发限流：`429`；
- 未预期服务端异常：`500`。

业务失败是否返回 `200`，不同团队有不同规范。关键不是争论哪种绝对正确，而是团队内部要统一，并写进接口规范。

### 写接口要考虑幂等

以下场景一定要考虑重复提交：

- 创建订单；
- 支付回调；
- 退款申请；
- 发放优惠券；
- MQ 消费后回调外部接口；
- 第三方平台重试通知。

常见方案：

```text
前端按钮防重复点击
+ 后端幂等 Key
+ 唯一索引
+ 状态机校验
+ 分布式锁或去重表
```

前端防重只能提升体验，不能作为最终保障。真正的幂等必须在后端做。

### 超时时间要明确

调用外部 HTTP 接口时，不要不设超时。

至少要区分：

- 连接超时：连不上对方；
- 读取超时：连接建立了，但对方迟迟不返回；
- 连接池获取超时：没有可用连接。

没有超时控制的 HTTP 调用，可能把 Tomcat 线程、业务线程池、连接池全部拖死。

## 线上排查思路

HTTP 问题排查可以按这条链路看：

```text
客户端是否真的发出请求
-> DNS 是否解析正确
-> TCP/TLS 是否建立成功
-> 请求是否到达网关
-> 请求是否被网关拦截
-> 请求是否到达应用
-> 应用是否正常处理
-> 响应是否被网关或浏览器改写/拦截
```

### curl 看完整请求响应

```bash
curl -v 'https://api.example.com/api/v1/orders/1001' \
  -H 'Authorization: Bearer xxx' \
  -H 'X-Request-Id: test-001'
```

`-v` 可以看到连接过程、请求头、响应头。

只看响应头：

```bash
curl -I 'https://api.example.com'
```

发送 JSON：

```bash
curl -X POST 'https://api.example.com/api/v1/orders' \
  -H 'Content-Type: application/json' \
  -d '{"skuId":1001,"quantity":2}'
```

### 浏览器 DevTools 看什么

Network 面板重点看：

- Request URL 是否正确；
- Method 是否正确；
- Status Code 是多少；
- Request Headers 是否带了 Token、Cookie、Content-Type；
- Response Headers 是否有 CORS、Cache-Control、Set-Cookie；
- Payload 是否符合后端要求；
- Timing 中是 DNS 慢、连接慢、等待响应慢，还是下载慢。

### 服务端日志看什么

日志里最好有这些字段：

```text
traceId
userId
method
path
status
costMs
clientIp
userAgent
errorCode
```

有 traceId 后，可以从网关日志一路查到应用日志、RPC 日志、SQL 日志。

## 核心知识点回顾

理解 HTTP 时，可以按下面这条主线梳理：

```text
1. HTTP 是应用层协议，采用请求-响应模型
2. 请求由请求行、请求头、空行、请求体组成
3. 响应由状态行、响应头、空行、响应体组成
4. 常用方法有 GET、POST、PUT、DELETE，要理解安全性和幂等性
5. 状态码分 1xx、2xx、3xx、4xx、5xx，项目中重点关注 200、301、302、304、400、401、403、404、429、500、502、504
6. Header 里常见 Content-Type、Authorization、Cookie、Cache-Control、TraceId
7. HTTP 是无状态的，登录态通常通过 Cookie + Session 或 Token 实现
8. HTTPS 在 HTTP 基础上加入 TLS，解决加密、防篡改、身份认证问题
9. HTTP/1.1 支持长连接，HTTP/2 支持多路复用和 Header 压缩
10. 实际项目中还要关注跨域、缓存、幂等、超时、连接池和日志追踪
```

结合真实项目再看这些知识点，比如“订单创建接口如何设计幂等”“支付回调为什么要重复通知”“接口 504 怎么排查”，会更容易理解 HTTP 在工程实践中的价值。

## 总结

HTTP 看起来简单，因为我们每天都在用。但真正掌握它，需要从协议格式走到工程实践：

- URL 用来定位资源；
- Method 表达操作语义；
- Header 承载认证、格式、缓存、追踪等元信息；
- Body 承载业务数据；
- 状态码表达协议层结果；
- 业务 code 表达业务层结果；
- Cookie、Session、Token 解决无状态下的身份问题；
- HTTPS 解决安全传输问题；
- 长连接、连接池、HTTP/2 解决性能问题；
- CORS、缓存、超时、幂等、日志追踪决定项目是否稳定好排查。

HTTP 不应该只停留在“会调接口”，还要能在接口设计、联调和线上排查中讲清楚它背后的原理和取舍。
