---
title: Agent 基础入门实战（二）：最小 Agent 实现
slug: agent-basics-practical-guide-02
date: 2026/02/27
category: AI栈
tags:
  - AI
  - Agent
  - Python
  - 工具调用
  - Function Calling
description: 使用 Python 和大模型 API，从一次普通 LLM 调用开始，逐步实现工具定义、Function Calling 和 Agent Loop，手写一个最小可运行的 Agent。
cover:
published: true
---

## 前言

在上一篇 [[posts/Agent 基础入门实战（一）：初识 Agent|Agent 基础入门实战（一）]] 中，我们介绍了 Agent 的基本概念，并把它的核心执行过程概括为 TAO 循环：

```text
Think（思考） -> Act（行动） -> Observe（观察）
```

这一篇将从代码出发，不依赖 LangChain、LangGraph 等 Agent 框架，使用 Python 和大模型 API 手写一个最小可运行的 Agent。

我们会依次完成：

```text
调用一次大模型
-> 编写一个 Python 工具
-> 让模型决定是否调用工具
-> 执行模型请求的工具
-> 把工具结果交还给模型
-> 增加 Agent Loop
```

示例中的天气数据暂时使用固定内容，不接入真实天气 API。这样可以先排除网络、鉴权和第三方接口等干扰，把注意力集中在 Agent 最核心的工具调用流程上。

## 2.1 环境准备

| 环境 | 说明 |
| --- | --- |
| Python | 推荐 Python 3.10 及以上版本 |
| VS Code | 用于打开项目和编辑代码 |
| Jupyter Notebook | 用于分步骤运行 `.ipynb` 文件 |
| Python 虚拟环境 `.venv` | 隔离项目依赖，避免污染全局环境 |
| 大模型 API Key | 调用支持 Chat Completions 和工具调用的模型服务 |

### 创建并激活虚拟环境

在项目根目录执行：

```bash
python -m venv .venv
```

Windows PowerShell：

```powershell
.venv\Scripts\Activate.ps1
```

Windows CMD：

```bat
.venv\Scripts\activate.bat
```

macOS 或 Linux：

```bash
source .venv/bin/activate
```

激活成功后，终端提示符前面通常会出现 `(.venv)`。

### 安装依赖

```bash
python -m pip install --upgrade pip
pip install openai python-dotenv requests notebook jupyterlab ipykernel
```

| 依赖 | 作用 |
| --- | --- |
| `openai` | 创建大模型客户端并发起请求 |
| `python-dotenv` | 从 `.env` 文件读取环境变量 |
| `requests` | 后续调用 HTTP API 时使用 |
| `notebook` / `jupyterlab` | 运行 `.ipynb` 文件 |
| `ipykernel` | 让 Jupyter 使用当前虚拟环境 |

把当前虚拟环境注册为 Jupyter 内核：

```bash
python -m ipykernel install --user --name agent-demo --display-name "Python (.venv)"
```

然后启动 Jupyter Lab：

```bash
jupyter lab
```

打开 Notebook 后，在右上角选择 `Python (.venv)` 内核。

### 配置环境变量

在项目根目录创建 `.env.example`：

```dotenv
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
MODEL_NAME=your_model_name
```

复制一份并命名为 `.env`，再填写真实配置：

```bash
cp .env.example .env
```

Windows PowerShell 可以使用：

```powershell
Copy-Item .env.example .env
```

同时创建 `.gitignore`，避免 API Key 被提交到 Git 仓库：

```gitignore
.venv/
.env
__pycache__/
.ipynb_checkpoints/
```

> `.env.example` 只保留配置示例，不能填写真实 API Key；真实密钥只放在本地 `.env` 中。

### 使用 AI 一键搭建环境

如果使用 Codex 等编码 Agent，也可以在项目目录中输入下面的提示词：

```text
请帮我在当前项目目录搭建 Python + Jupyter Notebook 学习环境：

1. 检查 Python 是否已安装，并确认版本不低于 3.10。
2. 在项目根目录创建名为 .venv 的虚拟环境。
3. 在虚拟环境中安装 openai、python-dotenv、requests、notebook、jupyterlab 和 ipykernel。
4. 将 .venv 注册为 Jupyter 内核，显示名称为 Python (.venv)。
5. 创建 .env.example，包含 OPENAI_API_KEY、OPENAI_BASE_URL 和 MODEL_NAME。
6. 创建 .gitignore，忽略 .venv、.env、__pycache__ 和 .ipynb_checkpoints。
7. 不要创建或填写真实 API Key。
8. 完成后输出 Python、pip 和 Jupyter 版本，并告诉我如何启动 Notebook。
```

## 2.2 第一次调用大模型 API

先完成一次最普通的大模型调用：输入一个问题，然后读取模型返回的答案。

```python
import os

from dotenv import load_dotenv
from openai import OpenAI


# 加载项目根目录下的 .env 文件
load_dotenv(override=True)


# 检查必要配置
required_envs = ["OPENAI_API_KEY", "MODEL_NAME"]
missing_envs = [name for name in required_envs if not os.getenv(name)]

if missing_envs:
    raise ValueError(f"缺少环境变量：{', '.join(missing_envs)}")


# 创建大模型客户端
# 使用兼容 OpenAI API 的其他服务时，可以通过 base_url 指定服务地址
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL") or None,
)


response = client.chat.completions.create(
    model=os.getenv("MODEL_NAME"),
    messages=[
        {"role": "system", "content": "你是一个有用的 AI 助手。"},
        {"role": "user", "content": "请用一句话解释什么是 Agent。"},
    ],
)


answer = response.choices[0].message.content
print(answer)
```

到这里，我们只完成了一次普通 LLM 调用：

```text
用户输入 -> LLM 生成回答 -> 结束
```

这还不是 Agent，因为模型既没有调用外部工具，也没有根据执行结果继续判断下一步。

例如，用户问“北京现在的天气怎么样”，模型本身并不能感知现实世界中的实时天气。要获得可靠结果，必须给它提供天气 API、数据库或搜索服务等外部工具。

## 2.3 给大模型准备第一个工具

对开发者来说，Agent 工具本质上就是一个可以被程序调用的普通函数。

我们先编写一个模拟天气查询工具：

```python
def get_weather(city: str) -> dict:
    """返回指定城市的模拟天气数据。"""
    mock_data = {
        "北京": {"weather": "晴", "temperature": "25℃"},
        "上海": {"weather": "多云", "temperature": "27℃"},
        "深圳": {"weather": "阵雨", "temperature": "29℃"},
    }

    weather = mock_data.get(city)
    if weather is None:
        return {
            "success": False,
            "message": f"暂时没有 {city} 的天气数据",
        }

    return {
        "success": True,
        "city": city,
        **weather,
    }


# 先像普通函数一样手动调用
result = get_weather("北京")
print(result)
```

此时 `get_weather()` 还只是一个普通 Python 函数。模型不知道项目中存在这个函数，更不可能直接执行它。

要让模型使用这个工具，还需要提供一份工具说明书。

## 2.4 把工具交给大模型

工具调用包含两个不同部分：

```text
Python 函数：负责真正执行任务
工具说明书：告诉模型工具名称、用途和参数格式
```

### 定义工具说明书

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "查询指定城市的天气。当用户询问天气时使用这个工具。",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "需要查询天气的城市名称，例如北京、上海或深圳",
                    }
                },
                "required": ["city"],
                "additionalProperties": False,
            },
        },
    }
]
```

这段 JSON Schema 告诉模型：

- 当前有一个名为 `get_weather` 的工具；
- 这个工具适合处理天气查询；
- 调用时必须提供字符串类型的 `city` 参数；
- 不允许传入说明书之外的其他参数。

工具描述是否清晰，会直接影响模型能否正确选择工具和生成参数。

### 建立工具注册表

```python
tool_registry = {
    "get_weather": get_weather,
}
```

工具注册表负责把模型返回的工具名称映射到真正的 Python 函数。

模型只会返回类似下面的调用意图：

```json
{
  "name": "get_weather",
  "arguments": "{\"city\": \"北京\"}"
}
```

模型不会直接运行 `get_weather()`。解析参数、查找函数并执行工具，仍然是我们自己的 Python 代码。

### 完成一次工具调用

```python
import json


messages = [
    {"role": "system", "content": "你是一个有用的 AI 助手。"},
    {"role": "user", "content": "北京今天天气怎么样？"},
]


# 第一次请求：让模型判断是否需要使用工具
response = client.chat.completions.create(
    model=os.getenv("MODEL_NAME"),
    messages=messages,
    tools=tools,
    tool_choice="auto",
)

assistant_message = response.choices[0].message


if assistant_message.tool_calls:
    print("模型决定调用工具")

    # 把模型的工具调用请求加入消息历史
    messages.append(assistant_message.model_dump(exclude_none=True))

    # 一次回复中可能包含多个工具调用，因此使用循环处理
    for tool_call in assistant_message.tool_calls:
        tool_name = tool_call.function.name
        tool_args = json.loads(tool_call.function.arguments or "{}")

        print("工具名称：", tool_name)
        print("工具参数：", tool_args)

        tool_func = tool_registry.get(tool_name)
        if tool_func is None:
            tool_result = {"success": False, "message": "工具不存在"}
        else:
            try:
                tool_result = tool_func(**tool_args)
            except Exception as exc:
                tool_result = {
                    "success": False,
                    "message": f"工具执行失败：{exc}",
                }

        print("工具结果：", tool_result)

        # 使用 tool_call_id 关联工具请求和工具结果
        messages.append(
            {
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(tool_result, ensure_ascii=False),
            }
        )

    # 第二次请求：让模型根据工具结果组织最终回答
    final_response = client.chat.completions.create(
        model=os.getenv("MODEL_NAME"),
        messages=messages,
        tools=tools,
    )

    print("最终回答：")
    print(final_response.choices[0].message.content)
else:
    print("模型没有调用工具：")
    print(assistant_message.content)
```

核心流程可以概括为：

```text
1. 编写 Python 函数 get_weather()
2. 通过 tools 向模型描述这个函数
3. 模型返回 tool_calls，表达工具调用意图
4. Python 解析工具名称和参数
5. Python 执行真正的工具函数
6. 把工具结果以 tool 消息写回 messages
7. 再次调用模型生成自然语言回答
```

完整链路如下：

```text
用户问题
  ↓
模型读取工具说明书
  ↓
模型生成 tool_calls
  ↓
Python 执行真实函数
  ↓
工具结果写回 messages
  ↓
模型读取工具结果
  ↓
生成最终回答
```

这里最重要的一点是：

> 大模型不会直接执行 Python 函数。它只负责选择工具和生成参数，真正执行工具的是我们的程序。

工具调用让模型从“只能根据已有上下文回答”，扩展为“可以借助外部系统获取信息”。相关机制可以参考 OpenAI 官方文档：[Function calling](https://developers.openai.com/api/docs/guides/function-calling)。

## 2.5 实现 Agent Loop

上一节只处理了一轮工具调用：模型选择工具，程序执行工具，然后模型生成最终答案。

但一个完整 Agent 的关键在于，它拿到工具结果后还可以继续思考：任务是否已经完成？是否还需要调用其他工具？是否需要修改参数后重试？

因此，需要在工具调用流程外增加一个循环。

```python
MAX_STEPS = 5


def run_agent(user_input: str) -> str:
    messages = [
        {
            "role": "system",
            "content": (
                "你是一个有用的 AI 助手。"
                "需要外部信息时请调用合适的工具；"
                "信息足够后直接向用户给出简洁、准确的回答。"
            ),
        },
        {"role": "user", "content": user_input},
    ]

    for step in range(1, MAX_STEPS + 1):
        print(f"\n===== 第 {step} 轮 =====")

        # Think：模型根据当前上下文判断下一步
        response = client.chat.completions.create(
            model=os.getenv("MODEL_NAME"),
            messages=messages,
            tools=tools,
            tool_choice="auto",
        )

        assistant_message = response.choices[0].message

        # 没有工具调用，说明模型认为可以给出最终答案
        if not assistant_message.tool_calls:
            return assistant_message.content or "模型没有返回有效内容。"

        messages.append(assistant_message.model_dump(exclude_none=True))

        # Act：执行本轮所有工具调用
        for tool_call in assistant_message.tool_calls:
            tool_name = tool_call.function.name

            try:
                tool_args = json.loads(tool_call.function.arguments or "{}")
            except json.JSONDecodeError:
                tool_args = {}

            print(f"调用工具：{tool_name}")
            print(f"工具参数：{tool_args}")

            tool_func = tool_registry.get(tool_name)

            if tool_func is None:
                tool_result = {
                    "success": False,
                    "message": f"未注册工具：{tool_name}",
                }
            else:
                try:
                    tool_result = tool_func(**tool_args)
                except Exception as exc:
                    tool_result = {
                        "success": False,
                        "message": f"工具执行失败：{exc}",
                    }

            print(f"工具结果：{tool_result}")

            # Observe：把工具结果写回上下文
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(tool_result, ensure_ascii=False),
                }
            )

    return f"任务在 {MAX_STEPS} 轮内没有完成，请缩小问题范围后重试。"
```

运行 Agent：

```python
answer = run_agent("北京今天天气怎么样？适合出门吗？")

print("\n最终回答：")
print(answer)
```

这段代码已经具备一个最小 Agent 的基本结构：

- 模型可以根据问题判断是否调用工具；
- 程序可以执行模型选择的工具；
- 工具结果会重新进入消息上下文；
- 模型可以基于最新结果继续判断；
- 模型不再调用工具时，循环自动终止；
- 超过最大轮数后，程序会强制结束任务。

它与上一篇介绍的 TAO 循环可以一一对应：

| TAO 阶段 | 代码中的实现 |
| --- | --- |
| Think | 调用模型，让模型判断是调用工具还是生成答案 |
| Act | 根据 `tool_calls` 执行对应的 Python 函数 |
| Observe | 把工具结果以 `role: tool` 写回 `messages` |

每次工具结果写回上下文后，循环都会重新进入 Think 阶段。这就是 Agent 能够根据中间结果动态调整下一步动作的原因。

## 2.6 不能忽略的工程细节

这个示例虽然很小，但已经包含几个重要的工程细节。

### 工具名称必须经过注册表校验

不能根据模型返回的字符串动态执行任意函数。工具注册表相当于白名单，只有提前注册的函数才允许调用：

```python
tool_func = tool_registry.get(tool_name)
```

### 工具参数不能盲目信任

模型生成的参数可能缺失、格式错误或不符合业务规则。真实项目中还需要增加：

- JSON Schema 校验；
- 参数类型和长度检查；
- 用户权限校验；
- 敏感字段过滤；
- 业务规则校验。

### 工具失败结果也要写回上下文

工具失败时，不应该直接让整个 Agent 崩溃。可以把结构化错误结果写回 `messages`，让模型判断是否需要修改参数、切换工具或向用户说明问题。

### Agent 必须有终止条件

模型可能重复调用同一个工具，也可能始终认为信息不足。因此必须设置最大执行轮数、工具超时时间、整体任务超时时间和费用限制。本例通过 `MAX_STEPS = 5` 防止无限循环。

### 写操作要比查询操作更谨慎

查询天气属于低风险只读操作。如果工具会删除文件、修改数据库、退款或发布生产服务，就不能让模型直接执行。

高风险工具至少应该增加权限检查、参数白名单、操作日志和人工确认。

## 2.7 常见问题

### Q1：为什么写了 `get_weather()`，模型就能使用它

模型不会自动发现 Python 函数。我们通过 `tools` 把工具名称、用途和参数格式告诉模型，再通过 `tool_registry` 把模型选择的工具映射到真正的函数。

```text
get_weather()：给 Python 执行
tools：给大模型阅读
tool_registry：连接工具名称和 Python 函数
```

### Q2：模型真的执行了 `get_weather()` 吗

没有。模型只返回工具调用请求，例如“调用 `get_weather`，参数是 `{"city":"北京"}`”。真正执行函数的是 Python 程序。

### Q3：为什么工具执行完还要再次调用模型

工具通常只返回原始数据。再次调用模型，是为了让它读取工具结果，结合用户原始问题生成自然语言答案。

```text
用户问题 -> 模型选择工具 -> Python 执行工具 -> 模型整理最终回答
```

### Q4：为什么 `arguments` 需要 `json.loads()`

工具参数通常以 JSON 字符串形式返回。`json.loads()` 会把它转换成 Python 字典，之后才能通过 `tool_func(**tool_args)` 传给真正的函数。

### Q5：为什么天气工具先返回模拟数据

固定数据可以排除网络异常、接口限流和第三方鉴权等因素，帮助我们先看清工具调用主流程。

等流程跑通后，把 `get_weather()` 内部替换为真实天气 API 即可，Agent Loop 和工具调用流程不需要改变。

### Q6：如何查看模型实际返回了什么

学习阶段可以打印完整响应：

```python
print(response.model_dump_json(indent=2))
```

重点观察：

- `choices[0].message.content`；
- `choices[0].message.tool_calls`；
- `tool_call.function.name`；
- `tool_call.function.arguments`；
- `tool_call.id`。

其中 `tool_call.id` 用于关联工具请求和工具结果，写回 `role: tool` 消息时不能遗漏。

## 2.8 可以继续扩展哪些工具

天气查询只是最简单的示例。在真实项目中，可以根据业务场景封装更多工具：

- 搜索工具；
- 数据库查询工具；
- 文件读取工具；
- 订单查询工具；
- 知识库检索工具；
- HTTP API 调用工具；
- 代码执行工具；
- 企业内部工单和通知工具。

不同工具的内部实现各不相同，但 Agent 的调用流程基本不变：

```text
描述工具
-> 模型选择工具
-> 程序校验并执行
-> 结果写回上下文
-> 模型继续判断
```

## 总结

这一篇没有使用任何 Agent 框架，而是通过 Python 手写了一个最小 Agent。

从代码角度看，它主要由四部分组成：

```text
LLM：理解目标并决定下一步动作
Tools：执行天气查询等外部操作
Messages：保存用户输入、工具请求和工具结果
Agent Loop：重复思考、行动和观察，直到任务完成
```

工具调用的关键不在于模型“执行了函数”，而在于模型生成结构化调用意图，程序完成校验和执行，再把结果交还给模型。

理解这条链路后，再去学习 LangChain、LangGraph 或其他 Agent 框架，就能看清框架中的 Tool、Message、Executor 和 Agent Loop 分别解决了什么问题。

下一篇将在这个最小 Agent 的基础上引入 LangChain，看看框架如何封装模型、工具和 Agent Loop。
