---
title: Agent 基础入门实战（三）：初识 LangChain
slug: agent-basics-practical-guide-03-langchain
date: 2026-07-10
category: AI栈
tags:
  - AI
  - Agent
  - LangChain
  - Python
  - 工具调用
description: 从模型调用、Message、Prompt、Runnable、结构化输出和流式输出入手，理解 LangChain 的核心组件，并使用 create_agent 创建第一个 LangChain Agent。
cover:
published: true
---

## 前言

在前两篇中，我们先理解了 Agent 的核心概念，又使用 Python 和模型 SDK 手写了一个最小 Agent：

- [[posts/Agent 基础入门实战（一）：初始 Agent|Agent 基础入门实战（一）]]
- [[posts/Agent 基础入门实战（二）：最小 Agent 实现|Agent 基础入门实战（二）]]

手写 Agent 的过程让我们看清了工具调用的完整链路：

```text
用户提出问题
-> 模型判断是否调用工具
-> Python 执行工具
-> 工具结果写回上下文
-> 模型继续判断或生成答案
```

这一篇开始接触 LangChain，看看它如何封装模型调用、消息、提示词、工具以及 Agent Loop。

学习时不要只记 LangChain 的 API。更重要的是把每个组件和上一篇的原生 Python 实现对应起来，理解框架帮我们省略了哪些重复代码。只有这样，后续遇到版本升级、调用失败或复杂业务需求时，才能知道应该从哪里排查。

## 3.1 环境准备

如果已经完成上一篇的环境搭建，可以继续使用原来的 `.venv` 虚拟环境。

本篇需要以下依赖：

| 依赖 | 说明 |
| --- | --- |
| `langchain` | 提供 Agent、模型初始化等高层入口 |
| `langchain-core` | 提供 Message、Prompt、Runnable、输出解析器等核心抽象，由 `langchain` 自动安装 |
| `langchain-openai` | 提供 `ChatOpenAI`、`OpenAIEmbeddings` 等 OpenAI 模型集成 |
| `python-dotenv` | 从 `.env` 文件读取 API Key 等配置 |
| `pydantic` | 定义和校验结构化输出模型 |

安装依赖：

```bash
pip install -U langchain langchain-openai python-dotenv pydantic
```

查看安装版本：

```bash
python -c "import langchain; print(langchain.__version__)"
```

本文使用 LangChain 1.x 的 API 整理，写作时 PyPI 最新版本为 `1.3.12`。LangChain 仍在快速迭代，如果运行代码时出现导入或参数错误，应先检查本地版本，并对照 [LangChain 官方文档](https://docs.langchain.com/oss/python/langchain/overview)。

项目根目录中的 `.env` 可以继续使用上一篇的配置：

```dotenv
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
MODEL_NAME=your_model_name
```

如果使用兼容 OpenAI API 格式的第三方模型服务，需要把 `OPENAI_BASE_URL` 和 `MODEL_NAME` 修改为对应服务提供的值。

> 并不是所有兼容接口都完整支持工具调用、流式输出和结构化输出。如果普通对话可以运行，但 Agent 或结构化输出失败，需要确认当前模型和服务端是否支持对应能力。

## 3.2 LangChain 是什么

LangChain 是一个用于开发大模型应用的框架。它不是大模型本身，也不会让模型凭空获得更强的推理能力。

它的主要作用，是把大模型应用中经常出现的能力抽象成相对统一的组件，例如：

- 模型调用；
- 消息管理；
- Prompt 模板；
- 输出解析；
- 结构化输出；
- 工具定义与调用；
- 流式输出；
- Agent 执行循环；
- 与 LangGraph、LangSmith 等组件集成。

如果不使用 LangChain，这些功能也可以通过模型 SDK 和普通 Python 代码实现。上一篇就是一个例子。

LangChain 的价值不是“实现了原本做不到的能力”，而是统一常见接口、减少重复代码，并帮助我们更快组合大模型应用。

可以对比理解：

| 原生 Python / SDK | LangChain |
| --- | --- |
| 手动组织 `messages` 字典 | 使用 `SystemMessage`、`HumanMessage`、`AIMessage` |
| 手写字符串替换和 Prompt 拼接 | 使用 `PromptTemplate`、`ChatPromptTemplate` |
| 手动处理模型输出 | 使用 Output Parser 或结构化输出 |
| 手写 JSON Schema 描述工具 | 使用 `@tool` 从函数签名和文档生成工具定义 |
| 手动解析 `tool_calls` 并执行函数 | 使用 `create_agent` 管理工具调用循环 |
| 手写多轮循环和终止判断 | 由 Agent 运行时管理状态和执行流程 |

使用 `langchain-openai` 后，我们不再直接编写 OpenAI SDK 的请求代码，但底层仍然需要调用模型服务。LangChain 是应用层封装，不是模型服务的替代品。

## 3.3 第一次调用大模型

先使用 `ChatOpenAI` 初始化一个聊天模型：

```python
import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI


load_dotenv(override=True)


required_envs = ["OPENAI_API_KEY", "MODEL_NAME"]
missing_envs = [name for name in required_envs if not os.getenv(name)]

if missing_envs:
    raise ValueError(f"缺少环境变量：{', '.join(missing_envs)}")


llm = ChatOpenAI(
    model=os.environ["MODEL_NAME"],
    temperature=0,
    api_key=os.environ["OPENAI_API_KEY"],
    base_url=os.getenv("OPENAI_BASE_URL") or None,
)
```

调用模型：

```python
response = llm.invoke("请用一句话介绍 LangChain。")

print(response.content)
```

`invoke()` 表示执行一次调用。与上一篇直接使用模型 SDK 相比，LangChain 隐藏了客户端创建、接口参数组织和响应对象转换等细节。

需要注意，`llm.invoke()` 返回的不是普通字符串，而是一个 `AIMessage` 对象。回答正文保存在 `response.content` 中，响应元数据、工具调用和 Token 使用量等信息也可以保存在这个消息对象里。

调试时可以打印完整对象：

```python
print(response)
print(response.response_metadata)
print(response.usage_metadata)
```

不同模型服务返回的元数据字段可能有所不同，因此业务代码不要过度依赖某个服务商的私有字段。

## 3.4 Message 消息机制

真实对话不是一个简单字符串，而是一组具有不同角色的消息。

LangChain 中常见的消息类型包括：

| 消息类型 | 作用 |
| --- | --- |
| `SystemMessage` | 设置模型角色、规则和回答方式 |
| `HumanMessage` | 表示用户输入 |
| `AIMessage` | 表示模型回复，也可能包含工具调用请求 |
| `ToolMessage` | 表示工具执行结果 |

先完成一次带系统提示词的对话：

```python
from langchain.messages import HumanMessage, SystemMessage


messages = [
    SystemMessage("你是一名耐心的 Python 老师，回答要适合新手。"),
    HumanMessage("什么是函数？"),
]

response = llm.invoke(messages)
print(response.content)
```

模拟第二轮对话：

```python
# 把上一轮真实返回的 AIMessage 加入历史
messages.append(response)
messages.append(HumanMessage("能不能再举一个例子？"))

second_response = llm.invoke(messages)
print(second_response.content)
```

多轮对话的关键并不是模型自动记住了历史，而是程序把之前的消息重新传给了模型：

```text
SystemMessage
-> HumanMessage：什么是函数？
-> AIMessage：模型第一次回答
-> HumanMessage：再举一个例子
-> 模型生成第二次回答
```

LangChain 帮我们统一了消息对象，但是否保存历史、保存多少历史、什么时候压缩或删除，仍然需要应用自己设计。

## 3.5 Prompt 模板

如果提示词中包含动态变量，直接拼接字符串会越来越难维护。LangChain 提供 Prompt 模板来统一管理固定指令和动态内容。

### PromptTemplate

`PromptTemplate` 适合生成普通文本提示词：

```python
from langchain_core.prompts import PromptTemplate


prompt = PromptTemplate.from_template(
    "请用新手能听懂的方式解释：{topic}"
)

formatted_prompt = prompt.invoke({"topic": "LangChain"})

print(formatted_prompt.text)

response = llm.invoke(formatted_prompt.text)
print(response.content)
```

### ChatPromptTemplate

聊天模型更推荐使用 `ChatPromptTemplate`，因为它可以保留 system、human、ai 等消息角色：

```python
from langchain_core.prompts import ChatPromptTemplate


chat_prompt = ChatPromptTemplate.from_messages(
    [
        ("system", "你是一名 AI 应用开发老师，回答要清晰、简洁。"),
        ("human", "请解释这个概念：{topic}"),
    ]
)

prompt_value = chat_prompt.invoke({"topic": "Prompt 模板"})
response = llm.invoke(prompt_value)

print(response.content)
```

`from_messages()` 中的 `system` 和 `human` 会被转换为对应的消息对象。使用模板的主要好处是把提示词结构和输入数据分离，便于复用、测试和维护。

## 3.6 Runnable 与链式组合

LangChain 中许多组件都遵循 Runnable 接口，例如：

- Prompt；
- Model；
- Output Parser；
- Tool；
- Retriever；
- 自定义 Runnable。

Runnable 通常提供这些调用方式：

| 方法 | 说明 |
| --- | --- |
| `invoke()` | 同步执行一次 |
| `ainvoke()` | 异步执行一次 |
| `stream()` | 同步流式执行 |
| `astream()` | 异步流式执行 |
| `batch()` | 批量执行多个输入 |

LangChain Expression Language（LCEL）可以使用 `|` 把多个 Runnable 串起来：

```python
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate


prompt = ChatPromptTemplate.from_messages(
    [
        ("system", "你是一名新手教程作者。"),
        ("human", "请用三句话解释：{topic}"),
    ]
)

parser = StrOutputParser()

chain = prompt | llm | parser

result = chain.invoke({"topic": "LangChain 的 Runnable"})
print(result)
```

执行流程如下：

```text
输入字典
-> Prompt 生成消息
-> Model 生成 AIMessage
-> StrOutputParser 提取字符串
-> 返回最终结果
```

`|` 不只是简单的语法糖。每个组件都约定了输入和输出格式，因此可以像流水线一样组合，同时复用 LangChain 的同步、异步、批处理和流式能力。

不过，组合时必须关注相邻组件的类型是否匹配。上一步的输出必须是下一步能够接收的输入，否则运行时仍然会报错。

## 3.7 结构化输出

很多业务场景不希望模型只返回一段自然语言，而是希望获得程序可以直接处理的数据。

例如，从一句话中提取姓名、年龄和城市：

```python
from pydantic import BaseModel, Field


class Person(BaseModel):
    """从文本中提取的人员信息。"""

    name: str = Field(description="姓名")
    age: int = Field(description="年龄")
    city: str = Field(description="所在城市")


structured_llm = llm.with_structured_output(Person)

person = structured_llm.invoke("张三今年 18 岁，住在北京。")

print(person)
print(person.name)
print(person.age)
print(person.city)
```

理想情况下，返回值是经过 Pydantic 校验的 `Person` 对象，而不是需要自己解析的字符串：

```text
Person(name='张三', age=18, city='北京')
```

结构化输出适合这些场景：

- 信息抽取；
- 意图识别；
- 工单分类；
- 表单填充；
- API 参数生成；
- 把自然语言转换为业务对象。

需要注意，结构化输出的具体实现依赖模型和服务端能力。部分模型使用原生结构化输出，部分模型通过工具调用实现。如果兼容接口不支持对应能力，可能需要改用 JSON Schema、手动解析或更换模型。

## 3.8 流式输出

`invoke()` 会等待模型生成完整结果后一次性返回，而 `stream()` 可以逐块读取模型输出，获得类似“打字机”的效果：

```python
for chunk in llm.stream("请用 100 字介绍 LangChain。"):
    if chunk.content:
        print(chunk.content, end="", flush=True)
```

这里的 `chunk` 通常是 `AIMessageChunk`。将多个 chunk 依次处理，就可以在 Web 页面、命令行或聊天窗口中实时展示生成过程。

流式输出主要改善用户体验，并不会降低模型实际生成内容所需的时间。真实项目中还需要处理连接中断、取消生成、异常事件和最终消息落库等问题。

## 3.9 使用 LangChain 创建 Agent

前面的示例主要是在调用模型。接下来定义一个工具，并使用 LangChain 创建 Agent。

### 使用 `@tool` 定义工具

```python
from langchain.tools import tool


@tool
def get_weather(city: str) -> str:
    """查询指定城市的模拟天气，输入完整的中文城市名称。"""
    weather_map = {
        "北京": "晴，25 摄氏度",
        "上海": "多云，27 摄氏度",
        "广州": "小雨，29 摄氏度",
    }

    return weather_map.get(city, f"暂未查询到 {city} 的天气")
```

`@tool` 会把普通 Python 函数转换为 LangChain Tool。函数名、类型标注和文档字符串会参与生成工具描述，因此要做到：

- 函数名能够表达具体能力；
- 参数必须有明确的类型标注；
- 文档字符串说明工具用途和使用条件；
- 返回结果尽量清晰、稳定、结构化。

这与上一篇手写的 `tools` JSON Schema 和 `tool_registry` 解决的是同一类问题，只是 LangChain 帮我们进行了封装。

可以查看生成后的工具信息：

```python
print(get_weather.name)
print(get_weather.description)
print(get_weather.args_schema.model_json_schema())
```

### 使用 `create_agent` 创建 Agent

```python
from langchain.agents import create_agent


agent = create_agent(
    model=llm,
    tools=[get_weather],
    system_prompt=(
        "你是一个会使用工具解决问题的助手。"
        "需要天气信息时调用天气工具，拿到结果后再回答用户。"
    ),
)
```

执行 Agent：

```python
result = agent.invoke(
    {
        "messages": [
            {"role": "user", "content": "上海的天气如何？"}
        ]
    }
)

print(result["messages"][-1].content)
```

Agent 内部完成了这些步骤：

```text
用户提出问题
-> 模型判断是否需要工具
-> 生成 get_weather 工具调用
-> LangChain 执行工具
-> 工具结果加入消息状态
-> 模型读取结果
-> 生成最终回答
```

这就是上一篇手写 Agent Loop 的框架版本。

### 查看 Agent 的完整执行消息

只打印最后一条消息会隐藏中间过程。学习和调试时，建议遍历完整消息列表：

```python
for index, message in enumerate(result["messages"], start=1):
    print(f"\n--- 消息 {index}：{type(message).__name__} ---")
    print("content:", message.content)

    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls:
        print("tool_calls:", tool_calls)
```

一次典型的执行轨迹包含：

```text
1. HumanMessage：用户询问上海天气
2. AIMessage：模型生成 get_weather 工具调用
3. ToolMessage：工具返回“多云，27 摄氏度”
4. AIMessage：模型生成最终自然语言回答
```

对照上一篇的原生实现：

| 原生 Agent 代码 | LangChain Agent |
| --- | --- |
| `tools` JSON Schema | `@tool` 根据函数生成工具描述 |
| `tool_registry` | `create_agent` 接收工具列表并管理调用 |
| 手动解析 `tool_calls` | Agent 运行时读取并执行工具调用 |
| 手动写入 `role: tool` 消息 | 自动创建 `ToolMessage` |
| 手写 `for` 循环 | Agent 运行时管理循环和状态 |
| 手动判断何时结束 | 模型不再调用工具时返回最终结果 |

LangChain 1.x 的 `create_agent` 底层使用 LangGraph 运行时，但我们仍然要理解工具边界、参数校验、循环终止和异常处理，不能因为框架完成了封装就忽略这些工程问题。

## 3.10 常见问题

### Q1：什么时候传字符串，什么时候传 messages

简单、单轮、没有角色设置的任务可以直接传字符串：

```python
llm.invoke("解释一下 Python 变量。")
```

需要系统提示词、多轮历史或多模态内容时，应该传消息列表：

```python
llm.invoke(
    [
        SystemMessage("你是一名 Python 老师。"),
        HumanMessage("什么是变量？"),
    ]
)
```

### Q2：什么时候需要 Agent

如果任务只是问答、总结、分类或改写，通常直接调用模型或使用一条 Chain 就够了。

当任务需要模型根据当前状态判断是否搜索、计算、查询数据库或调用业务 API，并可能多次使用工具时，才适合考虑 Agent。

### Q3：LangChain 和 LangGraph 是什么关系

可以简单理解为：

```text
LangChain：提供模型、消息、Prompt、Tool、Agent 等高层开发组件
LangGraph：提供状态图、持久化、分支、循环和人工介入等底层编排能力
```

在 Agent 场景中，LangChain 的 `create_agent()` 是更容易上手的高层入口，底层运行时由 LangGraph 提供支持。

如果只是创建常见的工具调用 Agent，可以先使用 LangChain；如果需要复杂分支、固定工作流、状态持久化、失败恢复或人工审批，再深入学习 LangGraph。

### Q4：简单模型调用还需要 LangChain 吗

不一定。

如果项目只有一次模型请求，直接使用模型官方 SDK 往往更轻量，依赖更少，排查也更直接。

如果项目需要组合 Prompt、模型、解析器、工具、RAG 和 Agent，并希望使用统一接口管理这些组件，LangChain 会更有价值。

### Q5：学习 LangChain 应该记住多少 API

入门阶段先掌握以下内容即可：

```text
Chat Model
Message
Prompt Template
Runnable / LCEL
Structured Output
Tool
create_agent
```

不必一次性学习所有模块。先理解每个组件的输入、输出和对应的原生实现，再通过小项目逐步扩展。

### Q6：为什么同一段代码在不同模型上表现不同

LangChain 统一了调用接口，但不能消除模型和服务商之间的能力差异。

不同模型对工具调用、JSON Schema、结构化输出、流式输出和多模态消息的支持程度可能不同。遇到问题时，要同时检查 LangChain 版本、集成包版本、模型能力和服务端兼容性。

## 总结

LangChain 的核心价值，是把大模型应用中的常见能力抽象成可以组合的组件。

这一篇接触了几个重要概念：

```text
ChatOpenAI：统一模型调用
Message：表示系统、用户、模型和工具消息
Prompt：管理固定指令和动态变量
Runnable：统一组件的调用和组合方式
Structured Output：把自然语言转换为结构化对象
Stream：逐块读取模型输出
Tool：把 Python 函数暴露给模型
create_agent：管理工具调用、消息状态和 Agent Loop
```

学习 LangChain 时，始终要记住它封装的底层过程。框架可以减少样板代码，但工具仍然由程序执行，历史消息仍然需要管理，高风险操作仍然需要权限和人工确认。

下一篇可以继续深入 LangChain Agent：增加多个工具、维护多轮会话状态，并观察 Agent 如何根据任务动态选择不同工具。