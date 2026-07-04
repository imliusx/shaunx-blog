---
title: Netty 入门实战：基于 TCP 实现一个简单的自定义通信协议
slug: netty-tcp-custom-protocol-practice
date: 2026-07-04
category: 项目
tags:
  - Netty
  - TCP
  - Java
  - 网络编程
  - 自定义协议
description: Netty 是 Java 生态中常用的高性能网络通信框架，适合构建 TCP 长连接、网关、即时通信、物联网接入等系统。内容围绕一个简单的自定义 TCP 协议，整理协议设计、编解码器、服务端、客户端、心跳检测、粘包半包处理和基础调试方法。
cover:
published: true
---

## 引言

后端开发平时接触最多的是 HTTP 接口，但在一些业务场景中，HTTP 并不是最合适的选择。

例如：

- 即时通信；
- 游戏服务；
- 物联网设备接入；
- 网关长连接；
- 内部高性能 RPC；
- 金融交易推送；
- 设备状态实时上报。

这些场景往往需要更低延迟、更稳定的长连接、更灵活的协议格式。此时 TCP 长连接会比普通 HTTP 请求更适合。

Java 原生 NIO 可以实现高性能网络通信，但直接写 NIO 代码比较繁琐，需要处理 Selector、Channel、Buffer、连接事件、读写事件、粘包半包等问题。Netty 对这些底层细节做了封装，让开发者可以把重点放在协议设计和业务处理上。

Netty 官方网站：[Netty: Home](https://netty.io/)
源码仓库：[netty/netty](https://github.com/netty/netty)。

下面实现一个简单的 TCP 自定义协议，支持：

- 客户端连接服务端；
- 客户端发送登录消息；
- 客户端发送普通业务消息；
- 服务端解析协议并返回响应；
- 心跳检测；
- 解决 TCP 粘包半包问题。

## 为什么需要自定义协议？

TCP 是面向字节流的协议，它只负责可靠传输字节，不关心业务消息边界。

如果客户端连续发送两条消息：

```text
hello
world
```

服务端读到的数据可能是：

```text
helloworld
```

也可能是：

```text
hel
loworld
```

这就是常说的粘包和半包问题。

图：TCP 粘包半包示意图

![](images/2026/07/04/tcp-sticky-half-packet-placeholder.png)

因此，在 TCP 之上通常需要设计一层应用协议，用来告诉接收方：

```text
一条完整消息从哪里开始
一条完整消息到哪里结束
消息类型是什么
消息体长度是多少
消息内容如何解析
```

常见协议设计方式包括：

| 方式 | 说明 |
| --- | --- |
| 固定长度 | 每条消息长度固定，实现简单但浪费空间 |
| 分隔符 | 使用 `\n`、`\r\n` 等分隔消息，适合文本协议 |
| 长度字段 | 消息头中记录消息体长度，最常用 |
| TLV | Type、Length、Value 结构，扩展性较好 |

业务系统里最常见的是长度字段方案。

## 协议格式设计

这里设计一个简单协议：

```text
+------------+------------+------------+------------+-------------+
| magicCode  | version    | msgType    | bodyLength | body        |
| 4 bytes    | 1 byte     | 1 byte     | 4 bytes    | N bytes     |
+------------+------------+------------+------------+-------------+
```

字段说明：

| 字段 | 长度 | 说明 |
| --- | --- | --- |
| magicCode | 4 字节 | 魔数，用于快速判断是否是合法协议 |
| version | 1 字节 | 协议版本号 |
| msgType | 1 字节 | 消息类型 |
| bodyLength | 4 字节 | 消息体长度 |
| body | N 字节 | JSON 格式消息体 |

协议头固定长度：

```text
4 + 1 + 1 + 4 = 10 bytes
```

消息类型定义：

```java
public final class MessageType {
    public static final byte LOGIN_REQUEST = 1;
    public static final byte LOGIN_RESPONSE = 2;
    public static final byte BUSINESS_REQUEST = 3;
    public static final byte BUSINESS_RESPONSE = 4;
    public static final byte HEARTBEAT_REQUEST = 5;
    public static final byte HEARTBEAT_RESPONSE = 6;
}
```

魔数定义：

```java
public final class ProtocolConstants {
    public static final int MAGIC_CODE = 0x12345678;
    public static final byte VERSION = 1;
    public static final int HEADER_LENGTH = 10;
}
```

魔数的作用是快速过滤非法请求。如果服务端收到的前 4 个字节不是约定魔数，就可以直接关闭连接。

图：自定义 TCP 协议字段结构图

![](images/2026/07/04/netty-custom-protocol-fields-placeholder.png)

## 项目结构

示例项目结构如下：

```text
netty-demo
├── client
│   ├── NettyClient.java
│   └── ClientHandler.java
├── codec
│   ├── ProtocolDecoder.java
│   └── ProtocolEncoder.java
├── common
│   ├── MessageType.java
│   ├── ProtocolConstants.java
│   └── ProtocolMessage.java
└── server
    ├── NettyServer.java
    └── ServerHandler.java
```

Maven 依赖：

```xml
<dependency>
    <groupId>io.netty</groupId>
    <artifactId>netty-all</artifactId>
    <version>4.1.111.Final</version>
</dependency>

<dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
    <version>2.17.1</version>
</dependency>
```

Netty 4.x API 文档：[Netty 4.1 API](https://netty.io/4.1/api/index.html)。

## 消息对象定义

先定义协议消息对象：

```java
public class ProtocolMessage {

    private byte version;
    private byte messageType;
    private byte[] body;

    public ProtocolMessage() {
    }

    public ProtocolMessage(byte version, byte messageType, byte[] body) {
        this.version = version;
        this.messageType = messageType;
        this.body = body;
    }

    public byte getVersion() {
        return version;
    }

    public void setVersion(byte version) {
        this.version = version;
    }

    public byte getMessageType() {
        return messageType;
    }

    public void setMessageType(byte messageType) {
        this.messageType = messageType;
    }

    public byte[] getBody() {
        return body;
    }

    public void setBody(byte[] body) {
        this.body = body;
    }
}
```

业务消息体使用 JSON 编码，例如登录请求：

```json
{
  "userId": 1001,
  "token": "abc123"
}
```

普通业务请求：

```json
{
  "requestId": "REQ202607040001",
  "content": "hello netty"
}
```

## 编码器：对象转字节

编码器负责把 `ProtocolMessage` 转成二进制字节流。

```java
public class ProtocolEncoder extends MessageToByteEncoder<ProtocolMessage> {

    @Override
    protected void encode(ChannelHandlerContext ctx, ProtocolMessage msg, ByteBuf out) {
        byte[] body = msg.getBody();
        int bodyLength = body == null ? 0 : body.length;

        out.writeInt(ProtocolConstants.MAGIC_CODE);
        out.writeByte(msg.getVersion());
        out.writeByte(msg.getMessageType());
        out.writeInt(bodyLength);

        if (bodyLength > 0) {
            out.writeBytes(body);
        }
    }
}
```

编码后的数据结构就是：

```text
magicCode + version + messageType + bodyLength + body
```

## 解码器：字节转对象

解码器负责解决粘包半包，并把字节流解析成 `ProtocolMessage`。

```java
public class ProtocolDecoder extends ByteToMessageDecoder {

    @Override
    protected void decode(ChannelHandlerContext ctx, ByteBuf in, List<Object> out) {
        if (in.readableBytes() < ProtocolConstants.HEADER_LENGTH) {
            return;
        }

        in.markReaderIndex();

        int magicCode = in.readInt();
        if (magicCode != ProtocolConstants.MAGIC_CODE) {
            ctx.close();
            return;
        }

        byte version = in.readByte();
        byte messageType = in.readByte();
        int bodyLength = in.readInt();

        if (bodyLength < 0) {
            ctx.close();
            return;
        }

        if (in.readableBytes() < bodyLength) {
            in.resetReaderIndex();
            return;
        }

        byte[] body = new byte[bodyLength];
        if (bodyLength > 0) {
            in.readBytes(body);
        }

        ProtocolMessage message = new ProtocolMessage(version, messageType, body);
        out.add(message);
    }
}
```

这里有几个关键点。

### 1. 判断协议头长度

```java
if (in.readableBytes() < ProtocolConstants.HEADER_LENGTH) {
    return;
}
```

如果连协议头都不完整，说明出现半包，直接等待下一次数据到达。

### 2. 标记读索引

```java
in.markReaderIndex();
```

当消息体不完整时，需要回退读索引。

### 3. 校验魔数

```java
if (magicCode != ProtocolConstants.MAGIC_CODE) {
    ctx.close();
    return;
}
```

非法协议直接断开连接。

### 4. 判断消息体是否完整

```java
if (in.readableBytes() < bodyLength) {
    in.resetReaderIndex();
    return;
}
```

如果消息体还没接收完整，回退索引，等待后续数据。

图：ByteToMessageDecoder 调试断点截图

![](images/2026/07/04/netty-bytetomessagedecoder-debug-placeholder.png)

## 服务端实现

服务端需要两个线程组：

- bossGroup：负责接收连接；
- workerGroup：负责处理读写事件。

```java
public class NettyServer {

    private final int port;

    public NettyServer(int port) {
        this.port = port;
    }

    public void start() throws InterruptedException {
        EventLoopGroup bossGroup = new NioEventLoopGroup(1);
        EventLoopGroup workerGroup = new NioEventLoopGroup();

        try {
            ServerBootstrap bootstrap = new ServerBootstrap();
            bootstrap.group(bossGroup, workerGroup)
                    .channel(NioServerSocketChannel.class)
                    .option(ChannelOption.SO_BACKLOG, 1024)
                    .childOption(ChannelOption.TCP_NODELAY, true)
                    .childOption(ChannelOption.SO_KEEPALIVE, true)
                    .childHandler(new ChannelInitializer<SocketChannel>() {
                        @Override
                        protected void initChannel(SocketChannel ch) {
                            ChannelPipeline pipeline = ch.pipeline();
                            pipeline.addLast(new IdleStateHandler(60, 0, 0, TimeUnit.SECONDS));
                            pipeline.addLast(new ProtocolDecoder());
                            pipeline.addLast(new ProtocolEncoder());
                            pipeline.addLast(new ServerHandler());
                        }
                    });

            ChannelFuture future = bootstrap.bind(port).sync();
            System.out.println("Netty server started, port=" + port);
            future.channel().closeFuture().sync();
        } finally {
            bossGroup.shutdownGracefully();
            workerGroup.shutdownGracefully();
        }
    }

    public static void main(String[] args) throws InterruptedException {
        new NettyServer(9000).start();
    }
}
```

`ChannelPipeline` 是 Netty 中非常重要的概念，请求数据会按照 Handler 顺序流转。

当前服务端 Pipeline：

```text
IdleStateHandler
-> ProtocolDecoder
-> ProtocolEncoder
-> ServerHandler
```

图：Netty ChannelPipeline 调试截图

![](images/2026/07/04/netty-channelpipeline-debug-placeholder.png)

## 服务端业务处理

```java
public class ServerHandler extends SimpleChannelInboundHandler<ProtocolMessage> {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Override
    public void channelActive(ChannelHandlerContext ctx) {
        System.out.println("client connected: " + ctx.channel().remoteAddress());
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, ProtocolMessage message) throws Exception {
        byte messageType = message.getMessageType();

        if (messageType == MessageType.LOGIN_REQUEST) {
            handleLogin(ctx, message);
            return;
        }

        if (messageType == MessageType.BUSINESS_REQUEST) {
            handleBusiness(ctx, message);
            return;
        }

        if (messageType == MessageType.HEARTBEAT_REQUEST) {
            handleHeartbeat(ctx);
            return;
        }

        System.out.println("unknown message type: " + messageType);
    }

    private void handleLogin(ChannelHandlerContext ctx, ProtocolMessage message) throws Exception {
        String body = new String(message.getBody(), StandardCharsets.UTF_8);
        System.out.println("login request: " + body);

        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("message", "login success");

        byte[] responseBody = OBJECT_MAPPER.writeValueAsBytes(response);
        ProtocolMessage responseMessage = new ProtocolMessage(
                ProtocolConstants.VERSION,
                MessageType.LOGIN_RESPONSE,
                responseBody
        );

        ctx.writeAndFlush(responseMessage);
    }

    private void handleBusiness(ChannelHandlerContext ctx, ProtocolMessage message) throws Exception {
        String body = new String(message.getBody(), StandardCharsets.UTF_8);
        System.out.println("business request: " + body);

        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("data", "server received");

        byte[] responseBody = OBJECT_MAPPER.writeValueAsBytes(response);
        ProtocolMessage responseMessage = new ProtocolMessage(
                ProtocolConstants.VERSION,
                MessageType.BUSINESS_RESPONSE,
                responseBody
        );

        ctx.writeAndFlush(responseMessage);
    }

    private void handleHeartbeat(ChannelHandlerContext ctx) {
        ProtocolMessage pong = new ProtocolMessage(
                ProtocolConstants.VERSION,
                MessageType.HEARTBEAT_RESPONSE,
                new byte[0]
        );
        ctx.writeAndFlush(pong);
    }

    @Override
    public void userEventTriggered(ChannelHandlerContext ctx, Object evt) {
        if (evt instanceof IdleStateEvent event) {
            if (event.state() == IdleState.READER_IDLE) {
                System.out.println("client read idle, close channel: " + ctx.channel().remoteAddress());
                ctx.close();
            }
        }
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        cause.printStackTrace();
        ctx.close();
    }
}
```

服务端处理三类消息：

```text
登录请求 -> 返回登录响应
业务请求 -> 返回业务响应
心跳请求 -> 返回心跳响应
```

`IdleStateHandler` 用于检测连接空闲。如果客户端长时间没有发送任何数据，服务端主动关闭连接，避免无效连接长期占用资源。

## 客户端实现

客户端使用 `Bootstrap`。

```java
public class NettyClient {

    private final String host;
    private final int port;

    public NettyClient(String host, int port) {
        this.host = host;
        this.port = port;
    }

    public void start() throws InterruptedException {
        EventLoopGroup group = new NioEventLoopGroup();

        try {
            Bootstrap bootstrap = new Bootstrap();
            bootstrap.group(group)
                    .channel(NioSocketChannel.class)
                    .option(ChannelOption.TCP_NODELAY, true)
                    .handler(new ChannelInitializer<SocketChannel>() {
                        @Override
                        protected void initChannel(SocketChannel ch) {
                            ChannelPipeline pipeline = ch.pipeline();
                            pipeline.addLast(new IdleStateHandler(0, 20, 0, TimeUnit.SECONDS));
                            pipeline.addLast(new ProtocolDecoder());
                            pipeline.addLast(new ProtocolEncoder());
                            pipeline.addLast(new ClientHandler());
                        }
                    });

            ChannelFuture future = bootstrap.connect(host, port).sync();
            Channel channel = future.channel();

            sendLogin(channel);
            sendBusinessMessage(channel);

            channel.closeFuture().sync();
        } finally {
            group.shutdownGracefully();
        }
    }

    private void sendLogin(Channel channel) throws JsonProcessingException {
        Map<String, Object> login = new HashMap<>();
        login.put("userId", 1001);
        login.put("token", "abc123");

        byte[] body = new ObjectMapper().writeValueAsBytes(login);
        ProtocolMessage message = new ProtocolMessage(
                ProtocolConstants.VERSION,
                MessageType.LOGIN_REQUEST,
                body
        );

        channel.writeAndFlush(message);
    }

    private void sendBusinessMessage(Channel channel) throws JsonProcessingException {
        Map<String, Object> request = new HashMap<>();
        request.put("requestId", "REQ202607040001");
        request.put("content", "hello netty");

        byte[] body = new ObjectMapper().writeValueAsBytes(request);
        ProtocolMessage message = new ProtocolMessage(
                ProtocolConstants.VERSION,
                MessageType.BUSINESS_REQUEST,
                body
        );

        channel.writeAndFlush(message);
    }

    public static void main(String[] args) throws InterruptedException {
        new NettyClient("127.0.0.1", 9000).start();
    }
}
```

## 客户端业务处理

```java
public class ClientHandler extends SimpleChannelInboundHandler<ProtocolMessage> {

    @Override
    public void channelActive(ChannelHandlerContext ctx) {
        System.out.println("connected to server");
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, ProtocolMessage message) {
        byte messageType = message.getMessageType();

        if (messageType == MessageType.LOGIN_RESPONSE) {
            String body = new String(message.getBody(), StandardCharsets.UTF_8);
            System.out.println("login response: " + body);
            return;
        }

        if (messageType == MessageType.BUSINESS_RESPONSE) {
            String body = new String(message.getBody(), StandardCharsets.UTF_8);
            System.out.println("business response: " + body);
            return;
        }

        if (messageType == MessageType.HEARTBEAT_RESPONSE) {
            System.out.println("receive pong");
            return;
        }

        System.out.println("unknown response type: " + messageType);
    }

    @Override
    public void userEventTriggered(ChannelHandlerContext ctx, Object evt) {
        if (evt instanceof IdleStateEvent event) {
            if (event.state() == IdleState.WRITER_IDLE) {
                ProtocolMessage ping = new ProtocolMessage(
                        ProtocolConstants.VERSION,
                        MessageType.HEARTBEAT_REQUEST,
                        new byte[0]
                );
                ctx.writeAndFlush(ping);
                System.out.println("send ping");
            }
        }
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        cause.printStackTrace();
        ctx.close();
    }
}
```

客户端 20 秒没有写数据时，会发送一次心跳。

服务端 60 秒没有读到数据时，会认为连接空闲，主动关闭连接。

图：IdleStateHandler 心跳日志截图

![](images/2026/07/04/netty-idlestatehandler-heartbeat-log-placeholder.png)

## 编解码器顺序为什么重要？

在 Netty 中，入站和出站事件方向不同。

入站数据流向：

```text
Socket -> Decoder -> InboundHandler
```

出站数据流向：

```text
OutboundHandler -> Encoder -> Socket
```

所以 Pipeline 中通常这样配置：

```java
pipeline.addLast(new ProtocolDecoder());
pipeline.addLast(new ProtocolEncoder());
pipeline.addLast(new ServerHandler());
```

入站消息经过 `ProtocolDecoder` 解析成对象，再交给 `ServerHandler`。

出站消息由 `ServerHandler` 写出，再经过 `ProtocolEncoder` 编码成字节。

如果顺序配置错误，可能出现消息无法解析、编码器不生效、Handler 收不到预期对象等问题。

## 粘包半包测试

为了验证解码器是否能处理粘包半包，可以写一个测试客户端，故意拆开发送。

例如一条完整消息分两次写入：

```java
ByteBuf buffer = Unpooled.buffer();
buffer.writeInt(ProtocolConstants.MAGIC_CODE);
buffer.writeByte(ProtocolConstants.VERSION);
buffer.writeByte(MessageType.BUSINESS_REQUEST);
buffer.writeInt(body.length);
buffer.writeBytes(body);

ByteBuf part1 = buffer.readRetainedSlice(5);
ByteBuf part2 = buffer.readRetainedSlice(buffer.readableBytes());

channel.writeAndFlush(part1);
Thread.sleep(100);
channel.writeAndFlush(part2);
```

服务端应该只在第二段数据到达后，才解析出完整消息。

也可以连续发送多条消息，验证粘包场景：

```java
channel.write(message1);
channel.write(message2);
channel.write(message3);
channel.flush();
```

如果解码器实现正确，服务端应该收到三条独立消息。

图：Wireshark 自定义 TCP 协议抓包截图

![](images/2026/07/04/wireshark-netty-custom-protocol-placeholder.png)

## ByteBuf 使用注意事项

Netty 的 `ByteBuf` 比 Java NIO 的 `ByteBuffer` 更灵活，但也要注意内存管理。

### readerIndex 和 writerIndex

`ByteBuf` 有两个重要指针：

```text
readerIndex：读指针
writerIndex：写指针
```

可读字节数：

```java
int readableBytes = byteBuf.readableBytes();
```

可写字节数：

```java
int writableBytes = byteBuf.writableBytes();
```

解码时不能随意移动 `readerIndex`。如果半包时没有回退读指针，就会导致后续数据解析失败。

### 引用计数

Netty 中很多对象实现了引用计数。相关说明可以查看：[Reference counted objects](https://netty.io/wiki/reference-counted-objects.html)。

如果手动保留或传递 `ByteBuf`，要注意释放。

常见释放方式：

```java
ReferenceCountUtil.release(msg);
```

使用 `SimpleChannelInboundHandler` 时，默认会在 `channelRead0` 执行后释放消息。如果业务里要异步使用消息内容，应该先复制必要数据，避免访问已释放对象。

## 连接管理

TCP 长连接系统必须考虑连接管理。

常见问题：

- 客户端异常断网；
- 服务端没有及时释放连接；
- 心跳超时没有处理；
- 单机连接数过高；
- 用户和 Channel 关系没有清理；
- 多端登录挤占问题。

可以维护一个连接管理器：

```java
public class ChannelManager {

    private static final ConcurrentHashMap<Long, Channel> USER_CHANNEL_MAP = new ConcurrentHashMap<>();

    public static void bind(Long userId, Channel channel) {
        USER_CHANNEL_MAP.put(userId, channel);
    }

    public static void unbind(Long userId) {
        USER_CHANNEL_MAP.remove(userId);
    }

    public static Channel getChannel(Long userId) {
        return USER_CHANNEL_MAP.get(userId);
    }
}
```

登录成功后绑定：

```java
ChannelManager.bind(userId, ctx.channel());
```

连接关闭时清理：

```java
@Override
public void channelInactive(ChannelHandlerContext ctx) {
    // 根据 channel 反查 userId 后清理绑定关系
}
```

实际项目中，通常还要处理：

```text
同一个用户多连接
同一个设备重复登录
服务端集群下连接路由
用户离线消息
连接心跳时间
```

## 服务端参数配置

常用配置包括：

```java
.option(ChannelOption.SO_BACKLOG, 1024)
.childOption(ChannelOption.TCP_NODELAY, true)
.childOption(ChannelOption.SO_KEEPALIVE, true)
.childOption(ChannelOption.SO_RCVBUF, 64 * 1024)
.childOption(ChannelOption.SO_SNDBUF, 64 * 1024)
```

说明：

| 参数 | 说明 |
| --- | --- |
| `SO_BACKLOG` | 服务端连接等待队列大小 |
| `TCP_NODELAY` | 是否禁用 Nagle 算法，低延迟场景常设为 true |
| `SO_KEEPALIVE` | TCP 保活机制 |
| `SO_RCVBUF` | 接收缓冲区大小 |
| `SO_SNDBUF` | 发送缓冲区大小 |

这些参数不要盲目调大，应该结合连接数、消息大小、机器资源和压测结果调整。

## 常见问题排查

### 1. 服务端收不到消息

检查方向：

1. 客户端是否连接成功；
2. 端口是否被防火墙拦截；
3. Pipeline 中 Decoder 是否配置；
4. 协议魔数是否一致；
5. bodyLength 是否写错；
6. 解码器是否一直等待半包。

### 2. 解码器报错

常见原因：

- 客户端和服务端协议字段顺序不一致；
- 字节长度计算错误；
- 魔数不一致；
- 消息体长度写错；
- JSON 编码和解码方式不一致。

可以在解码器里临时打印：

```java
System.out.println("readableBytes=" + in.readableBytes());
System.out.println("bodyLength=" + bodyLength);
```

也可以使用 Wireshark 抓包辅助分析。Wireshark 官网：[Wireshark](https://www.wireshark.org/)。

### 3. 连接频繁断开

检查方向：

1. 心跳间隔是否太长；
2. 服务端读空闲时间是否太短；
3. 客户端是否阻塞导致无法发送心跳；
4. 网络是否存在 NAT 超时；
5. 是否有异常被捕获后关闭连接。

### 4. 内存持续上涨

检查方向：

1. ByteBuf 是否泄漏；
2. Channel 是否没有清理；
3. 连接管理 Map 是否无限增长；
4. 业务异步任务是否堆积；
5. 是否开启 Netty 内存泄漏检测。

可以临时开启：

```bash
-Dio.netty.leakDetection.level=paranoid
```

线上环境不要长期使用最高级别，性能开销较大。

图：Netty 内存泄漏检测日志截图

![](images/2026/07/04/netty-leak-detection-log-placeholder.png)

## 生产环境还需要补什么？

这个示例只是一个入门版本，生产环境还需要考虑更多内容。

### 1. 鉴权

登录消息中不能只信任 userId，需要校验 token、设备号、签名等信息。

### 2. 消息序列化

JSON 可读性好，但性能和体积不一定最优。

可选方案：

- JSON；
- Protobuf；
- MessagePack；
- Hessian；
- 自定义二进制。

Protobuf 文档：[Protocol Buffers](https://protobuf.dev/)。

### 3. 消息 ID

每条业务消息最好带 `requestId` 或 `messageId`，方便日志追踪、幂等处理和问题排查。

### 4. 重连机制

客户端断线后需要重连，重连要避免无脑高频重试。

推荐策略：

```text
首次立即重连
失败后 1s
再次失败 2s
再次失败 5s
最大间隔 30s
```

### 5. 限流和保护

服务端要防止恶意连接和大包攻击。

可以限制：

- 单 IP 连接数；
- 单连接 QPS；
- 最大消息体长度；
- 登录超时时间；
- 空闲连接时长。

解码器中可以限制消息体长度：

```java
if (bodyLength > 1024 * 1024) {
    ctx.close();
    return;
}
```

### 6. 集群路由

如果服务端有多台机器，用户连接可能分散在不同节点。

常见方案：

```text
网关层保持长连接
用户连接关系写入 Redis
业务服务通过 MQ 或 RPC 找到对应网关节点
网关节点推送消息给用户
```

这部分已经属于长连接网关架构设计，复杂度会比单机 Netty 服务高很多。

## 完整测试流程

可以按下面顺序测试：

1. 启动服务端；
2. 启动客户端；
3. 观察客户端连接成功日志；
4. 客户端发送登录消息；
5. 服务端返回登录响应；
6. 客户端发送业务消息；
7. 服务端返回业务响应；
8. 等待心跳日志；
9. 断开客户端，观察服务端连接关闭日志；
10. 使用 Wireshark 抓包查看协议字段。

预期日志：

```text
Netty server started, port=9000
client connected: /127.0.0.1:xxxxx
login request: {"userId":1001,"token":"abc123"}
business request: {"requestId":"REQ202607040001","content":"hello netty"}
```

客户端日志：

```text
connected to server
login response: {"success":true,"message":"login success"}
business response: {"success":true,"data":"server received"}
send ping
receive pong
```

## 总结

Netty 的核心不是简单地启动一个 TCP 服务，而是围绕网络事件处理构建一套稳定的通信模型。

一个最小可用的自定义 TCP 协议，至少要包含：

```text
魔数
版本号
消息类型
消息体长度
消息体内容
```

服务端和客户端都需要配置：

```text
Decoder
Encoder
业务 Handler
IdleStateHandler
异常处理
连接关闭清理
```

排查 Netty 问题时，要重点关注：

```text
协议字段是否一致
粘包半包是否正确处理
Pipeline 顺序是否正确
ByteBuf 是否泄漏
心跳是否正常
连接是否及时释放
```

这个示例虽然简单，但已经覆盖了 TCP 自定义协议中最核心的内容。后续如果要做即时通信、设备接入、长连接网关，可以在这个基础上继续补充鉴权、重连、限流、集群路由、消息确认和离线消息等能力。
