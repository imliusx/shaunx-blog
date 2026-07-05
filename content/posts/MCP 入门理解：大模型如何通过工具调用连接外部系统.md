---
title: MCP 入门理解：大模型如何通过工具调用连接外部系统
slug: mcp-tool-calling-external-system-introduction
date: 2026-07-05
category: AI栈
tags:
  - MCP
  - AI
  - 大模型
  - 工具调用
  - Agent
description: MCP 是一种让大模型应用连接外部工具、数据源和业务系统的协议。内容围绕 MCP Client、MCP Server、Tool、Resource、Prompt 的关系展开，结合一个查询订单状态的示例，梳理大模型如何发现工具、选择工具、调用工具并基于结果生成回答。
cover:
published: true
---

## 为什么大模型需要工具

大模型擅长理解语言、总结内容、生成文本和推理步骤，但它本身并不能直接访问业务系统。

用户问：

```text
帮我查一下订单 ORD202607050001 现在是什么状态？
```

如果没有工具，大模型只能根据已有上下文回答。它不知道订单系统里实时数据是什么，也不能直接访问数据库。

要让大模型真正处理业务问题，就需要给它接入外部能力：

- 查询数据库；
- 调用订单接口；
- 读取文档；
- 搜索知识库；
- 操作 Git 仓库；
- 创建工单；
- 发送通知；
- 调用内部管理系统。

这类能力通常被称为工具调用。

MCP，也就是 Model Context Protocol，就是为了解决“大模型应用如何标准化连接外部工具和上下文”的问题。MCP 官方网站：[Model Context Protocol](https://modelcontextprotocol.io/)。

## 先用一个场景理解 MCP

假设要做一个内部 AI 助手，支持查询订单状态。

用户输入：

```text
查一下订单 ORD202607050001 的状态
```

理想流程是：

```text
用户提问
-> AI 助手识别出需要查订单
-> 调用订单查询工具
-> 工具返回订单状态、支付状态、物流状态
-> AI 助手组织成自然语言回答
```

如果没有 MCP，也可以直接在代码里写死 HTTP 调用逻辑。但当工具越来越多时，会遇到问题：

```text
每个工具接入方式不同
工具描述散落在代码里
权限和参数校验难统一
不同 AI 客户端不能复用同一套工具
上下文资源接入方式不统一
```

MCP 的价值是把这些外部能力抽象成统一协议。

图：MCP Client、MCP Server 与外部系统关系图

![](images/2026/07/05/mcp-client-server-tool-relationship-placeholder.png)

## MCP 里有哪些角色

MCP 里最核心的几个概念是：

```text
Host
Client
Server
Tool
Resource
Prompt
```

这些名字刚看有点绕，可以先按职责理解。

### Host

Host 是用户实际使用的 AI 应用。

例如：

```text
Claude Desktop
IDE 中的 AI 编码助手
企业内部 AI 助手
桌面 Agent 应用
```

Host 负责和用户交互，也负责管理多个 MCP Client。

### Client

Client 是 Host 内部和某个 MCP Server 建立连接的组件。

一个 Host 可以连接多个 MCP Server。

例如：

```text
订单 MCP Server
知识库 MCP Server
Git MCP Server
文件系统 MCP Server
数据库 MCP Server
```

每个连接对应一个 MCP Client。

### Server

MCP Server 是工具和上下文的提供方。

它负责暴露：

```text
Tools
Resources
Prompts
```

也可以理解为：MCP Server 把某个外部系统包装成大模型可理解、可调用的能力。

### Tool

Tool 是模型可以主动调用的函数。

例如：

```text
get_order_status
search_documents
create_ticket
query_user_profile
send_notification
```

Tool 通常有名称、描述、参数 schema 和返回结果。

### Resource

Resource 是可以读取的上下文资源。

例如：

```text
某篇文档
某个配置文件
某个数据库表结构
某个项目 README
```

Resource 更偏“给模型看资料”，Tool 更偏“让模型执行动作”。

### Prompt

Prompt 是 MCP Server 提供的提示词模板。

例如：

```text
代码审查模板
SQL 优化分析模板
故障排查模板
订单客服回复模板
```

Prompt 可以让某类任务的提示词标准化。

## 工具调用的基本流程

MCP 工具调用大致可以理解为五步：

```text
连接 MCP Server
-> 获取工具列表
-> 模型根据用户问题选择工具
-> Client 请求 Server 执行工具
-> Server 返回结果，模型生成最终回答
```

例如订单查询：

```text
用户：查一下订单 ORD202607050001 的状态
模型：需要调用 get_order_status
Client：向订单 MCP Server 发起 tools/call
Server：调用订单系统接口
Server：返回订单状态
模型：订单当前为已支付，正在出库
```

图：MCP tools/list 与 tools/call 调用截图

![](images/2026/07/05/mcp-tools-list-call-placeholder.png)

## MCP 和普通 HTTP API 有什么区别

MCP Server 最终可能也是调用 HTTP API、数据库或文件系统。那它和普通 HTTP API 有什么区别？

可以这样理解：

```text
HTTP API 是给程序调用的接口
MCP Tool 是给 AI 应用发现和调用的能力描述
```

普通 HTTP API 通常只提供接口地址和参数。

MCP Tool 还会提供：

- 工具名称；
- 工具描述；
- 参数 JSON Schema；
- 返回结构；
- 错误信息；
- 可发现能力；
- 和模型上下文集成的方式。

普通 API：

```http
GET /api/orders/{orderNo}
```

MCP Tool：

```json
{
  "name": "get_order_status",
  "description": "根据订单号查询订单状态、支付状态和物流状态",
  "inputSchema": {
    "type": "object",
    "properties": {
      "orderNo": {
        "type": "string",
        "description": "订单号，例如 ORD202607050001"
      }
    },
    "required": ["orderNo"]
  }
}
```

MCP 更关注“模型怎么理解和使用这个能力”。

## 一个订单查询工具的设计

先设计一个工具：`get_order_status`。

它的职责很简单：根据订单号查询订单状态。

输入：

```json
{
  "orderNo": "ORD202607050001"
}
```

输出：

```json
{
  "orderNo": "ORD202607050001",
  "orderStatus": "PAID",
  "payStatus": "SUCCESS",
  "deliveryStatus": "WAREHOUSE_PROCESSING",
  "createdAt": "2026-07-05T09:30:00Z"
}
```

工具描述要写清楚，不能只写：

```text
查询订单
```

更好的描述：

```text
根据订单号查询订单当前状态，包括订单状态、支付状态、物流状态和创建时间。适用于用户询问订单进度、支付结果或发货状态的场景。
```

工具描述越清楚，模型越容易在合适的时候选择它。

图：get_order_status 工具 schema 截图

![](images/2026/07/05/mcp-get-order-status-schema-placeholder.png)

## 用 TypeScript 写一个简单 MCP Server

MCP 官方 SDK 支持多种语言生态。TypeScript SDK 仓库：[modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)。

下面用 TypeScript 写一个简化版订单 MCP Server。

先安装依赖：

```bash
npm install @modelcontextprotocol/sdk zod
```

示例代码：

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 创建 MCP Server，声明服务名称和版本
const server = new McpServer({
  name: "order-mcp-server",
  version: "1.0.0",
});

// 注册一个订单状态查询工具
server.tool(
  "get_order_status",
  {
    // 使用 zod 定义参数结构，SDK 会转换为工具 schema
    orderNo: z.string().describe("订单号，例如 ORD202607050001"),
  },
  async ({ orderNo }) => {
    // 这里模拟调用内部订单系统，真实项目中可以改成 HTTP 或数据库查询
    const order = await queryOrderStatus(orderNo);

    if (!order) {
      return {
        content: [
          {
            type: "text",
            text: `没有查询到订单：${orderNo}`,
          },
        ],
      };
    }

    // 工具返回结果建议结构清晰，方便模型继续组织回答
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(order, null, 2),
        },
      ],
    };
  }
);

async function queryOrderStatus(orderNo: string) {
  // 示例数据：生产环境中这里应调用真实订单系统
  if (orderNo !== "ORD202607050001") {
    return null;
  }

  return {
    orderNo,
    orderStatus: "PAID",
    payStatus: "SUCCESS",
    deliveryStatus: "WAREHOUSE_PROCESSING",
    createdAt: "2026-07-05T09:30:00Z",
  };
}

// 使用 stdio 作为传输方式，适合本地客户端启动 MCP Server
const transport = new StdioServerTransport();
await server.connect(transport);
```

这段代码做了几件事：

```text
创建 MCP Server
注册 get_order_status 工具
定义工具参数
执行订单查询逻辑
返回工具结果
通过 stdio 和客户端通信
```

真实项目里，`queryOrderStatus` 可以改成调用内部 HTTP 接口：

```text
GET http://order-service/api/orders/{orderNo}
```

或者查询数据库，但要注意权限和只读边界。

## 用 Java 后端封装工具逻辑

如果业务系统主要是 Java，也可以把具体业务能力封装在 Java 后端，然后 MCP Server 只做协议适配。

例如订单服务本身提供：

```java
@RestController
@RequestMapping("/internal/orders")
public class InternalOrderController {

    private final OrderQueryService orderQueryService;

    public InternalOrderController(OrderQueryService orderQueryService) {
        this.orderQueryService = orderQueryService;
    }

    @GetMapping("/{orderNo}/status")
    public OrderStatusDTO getOrderStatus(@PathVariable String orderNo) {
        // 内部接口仍然要做参数校验和权限控制，不要因为给 MCP 用就跳过安全逻辑
        if (!orderNo.matches("^ORD\\d{12}$")) {
            throw new IllegalArgumentException("订单号格式不合法");
        }

        return orderQueryService.getOrderStatus(orderNo);
    }
}
```

MCP Server 调这个 Java 接口：

```ts
async function queryOrderStatus(orderNo: string) {
  const response = await fetch(`http://order-service/internal/orders/${orderNo}/status`, {
    headers: {
      // 内部系统调用也要有鉴权凭证，避免 MCP Server 成为无权限入口
      "Authorization": `Bearer ${process.env.INTERNAL_API_TOKEN}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`order service error: ${response.status}`);
  }

  return await response.json();
}
```

这种方式比较适合已有后端系统：

```text
Java 后端负责业务和权限
MCP Server 负责工具协议适配
AI 应用通过 MCP 调用工具
```

不要为了接 MCP 直接让工具连生产数据库，除非权限、审计和只读限制都已经设计好。

## Tool、Resource、Prompt 怎么区分

刚接触 MCP 时，容易把 Tool、Resource、Prompt 混在一起。

可以用一个内部知识助手举例。

### Tool

适合执行动作或动态查询。

```text
查询订单状态
创建工单
查询用户信息
搜索日志
触发部署
```

用户问：

```text
帮我查一下订单状态
```

这需要 Tool。

### Resource

适合提供上下文材料。

```text
接口文档
数据库表结构
项目 README
配置文件
业务规则文档
```

用户问：

```text
订单状态有哪些枚举？
```

如果枚举写在文档里，可以作为 Resource 暴露给模型读取。

### Prompt

适合复用任务模板。

```text
故障排查模板
代码审查模板
SQL 优化模板
客服回复模板
```

用户想让 AI 按固定格式分析慢 SQL，就可以用 Prompt 模板。

图：MCP Tool、Resource、Prompt 区别示意图

![](images/2026/07/05/mcp-tool-resource-prompt-difference-placeholder.png)

## 工具描述决定模型会不会用对

工具不是注册上去就完事。

模型是否能正确选择工具，很大程度取决于工具描述。

不好的描述：

```text
订单工具
```

更好的描述：

```text
根据订单号查询订单当前状态，包括订单状态、支付状态、物流状态和创建时间。适用于用户询问订单进度、支付结果、发货状态时使用。
```

参数也要描述清楚。

不好的参数：

```json
{
  "id": "string"
}
```

更好的参数：

```json
{
  "orderNo": {
    "type": "string",
    "description": "订单号，格式通常为 ORD 开头加 12 位数字，例如 ORD202607050001"
  }
}
```

工具设计的目标不是给人看懂，而是让模型也能判断：

```text
什么时候该调用
参数怎么填
返回结果代表什么
调用失败怎么办
```

## 工具返回结果要结构化

工具返回不要只写一句自然语言。

不推荐：

```text
订单已支付，正在出库
```

更推荐：

```json
{
  "orderNo": "ORD202607050001",
  "orderStatus": "PAID",
  "orderStatusText": "已支付",
  "payStatus": "SUCCESS",
  "deliveryStatus": "WAREHOUSE_PROCESSING",
  "deliveryStatusText": "仓库处理中",
  "createdAt": "2026-07-05T09:30:00Z"
}
```

结构化结果更利于模型组织回答，也方便调试。

模型可以基于结果回答：

```text
订单 ORD202607050001 当前已支付，支付状态成功，物流状态为仓库处理中，创建时间是 2026-07-05 09:30。
```

如果工具返回的是错误，也要结构化：

```json
{
  "errorCode": "ORDER_NOT_FOUND",
  "message": "订单不存在或当前账号无权查看"
}
```

不要把内部异常栈直接返回给模型。

## MCP Server 的权限边界

工具调用最大的风险是：模型可以调用外部系统。

如果权限边界没设计好，AI 助手可能变成越权入口。

几个原则很重要。

### 1. 默认只读

刚开始接入 MCP 时，优先做只读工具。

例如：

```text
查询订单状态
查询用户基础信息
读取文档
查询日志摘要
```

谨慎开放写操作：

```text
退款
删除数据
修改配置
触发部署
发送消息
```

### 2. 工具内部继续做权限校验

不要因为请求来自 MCP Server，就默认可信。

工具调用仍然要校验：

```text
用户身份
角色权限
数据范围
操作频率
参数合法性
```

### 3. 高风险操作需要二次确认

例如：

```text
关闭用户账号
删除文件
触发生产部署
批量修改订单状态
```

这类操作不应该让模型一次调用直接执行。

更安全的流程：

```text
模型生成操作计划
-> 用户确认
-> 后端校验权限
-> 执行操作
-> 记录审计日志
```

### 4. 所有工具调用要审计

至少记录：

```text
用户 ID
工具名称
调用参数摘要
调用时间
调用结果
错误信息
requestId
```

图：MCP 工具调用审计日志截图

![](images/2026/07/05/mcp-tool-audit-log-placeholder.png)

## 参数校验不能交给模型

模型可能生成错误参数。

例如：

```json
{
  "orderNo": "帮我查一下昨天那个订单"
}
```

工具必须自己校验参数。

TypeScript 里用 zod：

```ts
server.tool(
  "get_order_status",
  {
    orderNo: z
      .string()
      .regex(/^ORD\d{12}$/, "订单号格式不合法")
      .describe("订单号，例如 ORD202607050001"),
  },
  async ({ orderNo }) => {
    // 能进入这里，说明参数已经通过基础格式校验
    return await queryOrderStatus(orderNo);
  }
);
```

Java 后端也要再校验一遍，不要只依赖 MCP 层。

```java
if (!orderNo.matches("^ORD\\d{12}$")) {
    throw new IllegalArgumentException("订单号格式不合法");
}
```

多层校验看起来重复，但能防止工具被绕过调用。

## 和 Function Calling 的关系

很多大模型 API 本身支持 Function Calling 或 Tool Calling。

MCP 和 Function Calling 的关系可以这样理解：

```text
Function Calling 是模型接口层面的工具调用能力
MCP 是外部工具和上下文的标准接入协议
```

Function Calling 更像：

```text
这次请求里告诉模型有哪些函数
模型决定调用哪个函数
应用代码执行函数
```

MCP 更像：

```text
AI 应用连接 MCP Server
动态发现工具、资源和提示词
不同客户端可以复用同一个 MCP Server
```

两者并不冲突。

一个 AI Host 可以通过 MCP 获取工具列表，再把这些工具能力转成模型支持的 Tool Calling 格式，最后由模型选择调用。

## MCP 适合哪些场景

比较适合：

```text
企业内部 AI 助手
IDE 编码助手连接代码仓库
知识库问答读取文档
数据库只读查询助手
运维助手读取监控和日志
客服助手查询订单和用户信息
多工具 Agent 平台
```

暂时不太适合直接开放的场景：

```text
高风险生产写操作
权限模型还没设计好的系统
缺少审计日志的内部接口
参数校验薄弱的老系统
需要强事务保证的核心交易动作
```

MCP 能让工具接入更标准，但不会自动解决安全、权限和业务一致性问题。

## 一个后端接入落地顺序

如果要在公司内部落地 MCP，不建议一开始就接很多工具。

可以按这个顺序推进。

### 第一阶段：只读工具

先接低风险工具：

```text
查询订单状态
查询用户基础信息
读取接口文档
搜索知识库
查询系统配置
```

目标是验证工具发现、调用和回答效果。

### 第二阶段：增加权限和审计

补齐：

```text
用户身份透传
角色权限校验
工具调用审计
参数脱敏
调用频率限制
```

### 第三阶段：接入低风险写操作

例如：

```text
创建工单
添加备注
生成草稿
发送测试通知
```

这些操作即使失败，也不会直接影响核心交易。

### 第四阶段：高风险操作加审批

例如：

```text
触发发布
修改配置
批量处理数据
关闭账号
```

必须增加二次确认、审批流或人工介入。

## 常见坑

### 1. 工具太多但描述很差

模型不知道什么时候该用哪个工具，调用准确率会很低。

优先保证少量高质量工具，而不是一次暴露几十个模糊工具。

### 2. 工具返回结果太随意

返回自然语言不利于模型稳定处理。结构化 JSON 更适合工具结果。

### 3. 忽略权限

MCP Server 一旦能访问内部系统，就必须按真实业务接口的安全标准设计。

### 4. 没有审计

工具调用没有日志，出问题很难追踪。

### 5. 让模型直接决定高风险操作

模型可以辅助判断，但高风险动作应该有用户确认和后端校验。

### 6. 参数 schema 写得太宽

参数越模糊，模型越容易传错。

例如：

```json
{ "query": "string" }
```

不如拆成更明确的参数：

```json
{
  "orderNo": "string",
  "includeLogistics": "boolean"
}
```

## 一份 MCP 工具设计检查清单

设计一个 MCP Tool 前，可以检查：

```text
工具名称是否清晰
描述是否说明适用场景
参数 schema 是否足够明确
参数是否有格式约束
返回结果是否结构化
错误是否可理解
是否需要用户身份
是否做了权限校验
是否记录审计日志
是否限制调用频率
是否存在高风险写操作
是否需要二次确认
```

如果这些问题都没想清楚，不要急着把工具暴露给 AI 应用。

图：MCP Tool 设计检查清单截图

![](images/2026/07/05/mcp-tool-design-checklist-placeholder.png)

## 收尾

MCP 的核心价值是把外部系统能力标准化地提供给大模型应用。

它解决的不是“模型会不会回答”，而是：

```text
模型如何发现工具
模型如何理解工具参数
工具如何被安全调用
外部结果如何进入上下文
不同 AI 客户端如何复用同一套能力
```

可以用一句话理解：

```text
MCP Server 把业务系统包装成模型可发现、可调用、可审计的工具和资源。
```

真正落地时，技术实现并不复杂，难点在工具边界、权限控制、参数校验、审计日志和高风险操作保护。

如果只是入门，可以先做一个只读工具，例如订单状态查询、文档搜索或配置读取。等工具调用链路跑通后，再逐步扩展到更复杂的业务场景。
