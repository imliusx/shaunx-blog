---
title: Java NIO 使用：Buffer、Channel、Selector 的核心用法
slug: java-nio-buffer-channel-selector-practice
date: 2021-02-23
category: 开发
tags:
  - Java
  - NIO
  - Buffer
  - Channel
  - Selector
description: Java NIO 是理解 Netty、Redis 客户端、RPC 框架和高性能网络编程的重要基础。内容通过一个简单的 TCP Echo Server 拆解 Buffer、Channel、Selector、SelectionKey、非阻塞 IO、粘包半包等核心概念，帮助建立对 NIO 编程模型的直观理解。
cover:
published: true
---

## 先看一个问题

如果要用 Java 写一个 TCP 服务，最容易想到的是传统 BIO 写法：

```java
ServerSocket serverSocket = new ServerSocket(9000);

while (true) {
    Socket socket = serverSocket.accept();
    new Thread(() -> handle(socket)).start();
}
```

这种模型很好理解：

```text
一个连接进来
-> 创建一个线程处理
-> 线程阻塞读取数据
-> 读到数据后处理业务
-> 写回响应
```

问题也很明显。如果连接很多，但大部分连接只是偶尔发消息，就会出现大量线程阻塞在 IO 上。线程本身占用内存，线程上下文切换也有成本。

NIO 解决的就是这类问题：用更少的线程管理更多连接。

Java NIO 的核心类在 `java.nio` 和 `java.nio.channels` 包下，JDK API 可以查看：[java.nio](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/package-summary.html) 和 [java.nio.channels](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/package-summary.html)。

## 用一个 Echo Server 理解 NIO

先定一个小目标：实现一个 TCP Echo Server。

客户端发什么，服务端就返回什么。

```text
client: hello
server: echo: hello
```

这个服务足够简单，但能覆盖 NIO 最核心的几个概念：

- `Buffer`
- `Channel`
- `Selector`
- `SelectionKey`
- 非阻塞模式
- 事件循环

最终代码结构大概是：

```text
创建 ServerSocketChannel
设置非阻塞
绑定端口
创建 Selector
注册 OP_ACCEPT
循环 selector.select()
处理 accept 事件
处理 read 事件
写回响应
```

图：Java NIO Echo Server 运行截图

![](images/2026/07/04/java-nio-echo-server-console-placeholder.png)

## Channel：连接和文件的抽象

传统 IO 里常用的是 Stream：

```java
InputStream
OutputStream
```

NIO 里更多使用 Channel。

常见 Channel：

| Channel | 场景 |
| --- | --- |
| `FileChannel` | 文件读写 |
| `SocketChannel` | TCP 客户端连接 |
| `ServerSocketChannel` | TCP 服务端监听 |
| `DatagramChannel` | UDP 通信 |

Channel 可以理解为数据通道，它可以从 Buffer 中读取数据，也可以把数据写入 Buffer。

```text
Channel <-> Buffer
```

和 Stream 不同，Channel 通常支持双向读写。比如 `SocketChannel` 既可以读，也可以写。

## Buffer：一块可读可写的内存区

NIO 读写数据离不开 Buffer。

最常用的是：

```java
ByteBuffer buffer = ByteBuffer.allocate(1024);
```

Buffer 有几个关键属性：

| 属性 | 含义 |
| --- | --- |
| capacity | 容量，Buffer 最大能放多少数据 |
| position | 当前读写位置 |
| limit | 当前可读或可写边界 |
| mark | 标记位置，可用于 reset |

Buffer 最容易让人困惑的是：它有“写模式”和“读模式”。

### 写模式

刚创建 Buffer 时，默认处于写模式。

```java
ByteBuffer buffer = ByteBuffer.allocate(8);
buffer.put((byte) 'a');
buffer.put((byte) 'b');
buffer.put((byte) 'c');
```

此时：

```text
capacity = 8
position = 3
limit = 8
```

### flip 切换读模式

想读取刚写进去的数据，需要调用：

```java
buffer.flip();
```

调用后：

```text
position = 0
limit = 3
capacity = 8
```

也就是说，`flip()` 会把 limit 设置为原来的 position，再把 position 归零。

图：ByteBuffer flip 前后 position 和 limit 截图

![](images/2026/07/04/bytebuffer-flip-position-limit-placeholder.png)

### clear 和 compact

读完数据后，如果想继续写入，可以调用：

```java
buffer.clear();
```

`clear()` 不会真正清空底层数组，只是重置指针：

```text
position = 0
limit = capacity
```

如果 Buffer 中还有未读完的数据，但又想继续写入，可以用：

```java
buffer.compact();
```

`compact()` 会把未读数据移动到 Buffer 开头，然后切回写模式。

### Buffer 常见错误

最常见的错误是忘记 `flip()`。

```java
ByteBuffer buffer = ByteBuffer.allocate(1024);
buffer.put("hello".getBytes(StandardCharsets.UTF_8));
channel.write(buffer); // 错误：position 已经在末尾，可能写不出数据
```

正确写法：

```java
ByteBuffer buffer = ByteBuffer.allocate(1024);
buffer.put("hello".getBytes(StandardCharsets.UTF_8));
buffer.flip();
channel.write(buffer);
```

## 第一个 NIO 服务端

先写一个可以接收连接的服务端。

```java
public class NioEchoServer {

    public static void main(String[] args) throws IOException {
        // 1. 创建服务端 Channel，用来监听客户端连接
        ServerSocketChannel serverChannel = ServerSocketChannel.open();

        // 2. 配合 Selector 使用时，Channel 必须设置为非阻塞模式
        serverChannel.configureBlocking(false);

        // 3. 绑定服务端端口
        serverChannel.bind(new InetSocketAddress(9000));

        // 4. 创建 Selector，负责监听多个 Channel 的就绪事件
        Selector selector = Selector.open();

        // 5. 注册 OP_ACCEPT，表示关注新连接接入事件
        serverChannel.register(selector, SelectionKey.OP_ACCEPT);

        System.out.println("NIO echo server started, port=9000");

        // 6. 事件循环：不断等待 IO 事件就绪
        while (true) {
            selector.select();
            Iterator<SelectionKey> iterator = selector.selectedKeys().iterator();

            while (iterator.hasNext()) {
                SelectionKey key = iterator.next();

                // 7. 已处理的 key 必须移除，避免下次循环重复处理
                iterator.remove();

                // 8. 新连接事件
                if (key.isAcceptable()) {
                    handleAccept(selector, key);
                }

                // 9. 数据可读事件
                if (key.isReadable()) {
                    handleRead(key);
                }
            }
        }
    }
}
```

这段代码里有几个关键点。

### 设置非阻塞

```java
serverChannel.configureBlocking(false);
```

如果要配合 Selector 使用，Channel 必须是非阻塞模式。

### 注册 accept 事件

```java
serverChannel.register(selector, SelectionKey.OP_ACCEPT);
```

这表示：服务端关心“新连接接入”事件。

### 事件循环

```java
selector.select();
```

`select()` 会阻塞，直到有事件就绪。

这就是 NIO 的核心模型：

```text
一个线程阻塞在 selector 上
-> 有连接或数据就绪
-> 取出 SelectionKey
-> 判断事件类型
-> 处理对应事件
```

图：Selector selectedKeys 调试截图

![](images/2026/07/04/selector-selectedkeys-debug-placeholder.png)

## 处理 accept 事件

当有客户端连接进来时，`key.isAcceptable()` 会返回 true。

```java
private static void handleAccept(Selector selector, SelectionKey key) throws IOException {
    ServerSocketChannel serverChannel = (ServerSocketChannel) key.channel();
    SocketChannel clientChannel = serverChannel.accept();

    clientChannel.configureBlocking(false);
    clientChannel.register(selector, SelectionKey.OP_READ, ByteBuffer.allocate(1024));

    System.out.println("client connected: " + clientChannel.getRemoteAddress());
}
```

这里做了几件事：

```text
拿到 ServerSocketChannel
-> accept 得到 SocketChannel
-> 设置客户端 Channel 为非阻塞
-> 注册 OP_READ 事件
-> 附加一个 ByteBuffer
```

注册时的第三个参数：

```java
ByteBuffer.allocate(1024)
```

会作为 attachment 绑定到 SelectionKey 上。后续读数据时，可以直接取出来复用。

```java
ByteBuffer buffer = (ByteBuffer) key.attachment();
```

## 处理 read 事件

客户端发送数据后，`key.isReadable()` 会返回 true。

```java
private static void handleRead(SelectionKey key) throws IOException {
    SocketChannel clientChannel = (SocketChannel) key.channel();
    ByteBuffer buffer = (ByteBuffer) key.attachment();

    int read = clientChannel.read(buffer);

    if (read == -1) {
        System.out.println("client closed: " + clientChannel.getRemoteAddress());
        key.cancel();
        clientChannel.close();
        return;
    }

    if (read == 0) {
        return;
    }

    buffer.flip();
    byte[] bytes = new byte[buffer.remaining()];
    buffer.get(bytes);
    buffer.clear();

    String request = new String(bytes, StandardCharsets.UTF_8).trim();
    System.out.println("receive: " + request);

    String response = "echo: " + request + "\n";
    ByteBuffer responseBuffer = ByteBuffer.wrap(response.getBytes(StandardCharsets.UTF_8));
    clientChannel.write(responseBuffer);
}
```

这里有几个容易踩坑的点。

### read 返回 -1

```java
int read = clientChannel.read(buffer);
```

如果返回 `-1`，表示客户端关闭连接。服务端需要取消 key 并关闭 channel。

### read 返回 0

非阻塞模式下，`read()` 返回 0 很常见，表示当前没有读到数据。

### 读完后要 flip

读取到 Buffer 后，需要切到读模式：

```java
buffer.flip();
```

处理完成后再清理：

```java
buffer.clear();
```

## 用 telnet 测试

启动服务端后，可以用 telnet 测试：

```bash
telnet 127.0.0.1 9000
```

输入：

```text
hello nio
```

服务端返回：

```text
echo: hello nio
```

如果没有 telnet，可以用 nc：

```bash
nc 127.0.0.1 9000
```

图：telnet 测试 NIO Echo Server 截图

![](images/2026/07/04/telnet-test-nio-echo-server-placeholder.png)

## Selector 到底做了什么？

Selector 可以理解为一个事件分发器。

它可以管理多个 Channel，并告诉你哪些 Channel 已经准备好执行某类操作。

常见事件：

| 事件 | 含义 |
| --- | --- |
| `OP_ACCEPT` | 服务端接收到新连接 |
| `OP_CONNECT` | 客户端连接建立完成 |
| `OP_READ` | Channel 中有数据可读 |
| `OP_WRITE` | Channel 可以写数据 |

一个线程可以通过 Selector 管理很多连接：

```text
Selector
├── ServerSocketChannel: OP_ACCEPT
├── SocketChannel-1: OP_READ
├── SocketChannel-2: OP_READ
└── SocketChannel-3: OP_READ
```

传统 BIO 是一个连接一个线程，NIO 则是一个线程监听多个连接的就绪事件。

这背后依赖操作系统的 IO 多路复用机制，例如 Linux 上常见的 epoll。

图：Linux epoll 事件列表截图

![](images/2026/07/04/linux-epoll-events-placeholder.png)

## SelectionKey 有什么用？

Channel 注册到 Selector 后，会返回一个 `SelectionKey`。

它记录了几个信息：

- 关联的 Channel；
- 关联的 Selector；
- 感兴趣的事件；
- 已就绪的事件；
- 附加对象 attachment。

常用方法：

```java
key.channel();
key.selector();
key.interestOps();
key.readyOps();
key.attachment();
key.cancel();
```

判断事件：

```java
key.isAcceptable();
key.isReadable();
key.isWritable();
key.isConnectable();
```

可以把 `SelectionKey` 理解为 Channel 在 Selector 里的注册凭证。

图：SelectionKey interestOps 与 readyOps 调试截图

![](images/2026/07/04/selectionkey-interestops-readyops-placeholder.png)

## 为什么 selectedKeys 要 remove？

事件循环里有一行非常重要：

```java
iterator.remove();
```

如果不移除，已经处理过的 key 会继续留在 selectedKeys 集合中，下次循环可能重复处理。

错误写法：

```java
for (SelectionKey key : selector.selectedKeys()) {
    handle(key);
}
```

推荐写法：

```java
Iterator<SelectionKey> iterator = selector.selectedKeys().iterator();
while (iterator.hasNext()) {
    SelectionKey key = iterator.next();
    iterator.remove();
    handle(key);
}
```

这也是很多 NIO 初学代码中隐藏的小 bug。

## 写事件要不要注册 OP_WRITE？

很多人看到 `OP_WRITE`，会以为写数据前必须注册写事件。

其实不是。

大多数情况下，SocketChannel 都是可写的。如果一直注册 `OP_WRITE`，Selector 可能频繁返回写就绪事件，导致 CPU 空转。

简单响应可以直接写：

```java
clientChannel.write(responseBuffer);
```

只有在数据很大，一次写不完时，才需要注册 `OP_WRITE`，等待下次可写继续写。

例如：

```java
int written = channel.write(buffer);
if (buffer.hasRemaining()) {
    key.interestOps(key.interestOps() | SelectionKey.OP_WRITE);
}
```

写完后要取消写事件：

```java
key.interestOps(key.interestOps() & ~SelectionKey.OP_WRITE);
```

否则可能造成空轮询。

## 粘包半包问题

前面的 Echo Server 只是演示 NIO 用法，还没有处理业务协议。

TCP 是字节流，不保证一次 `read()` 就是一条完整业务消息。

例如客户端发送：

```text
hello\nworld\n
```

服务端可能一次读到：

```text
hello\nworld\n
```

也可能分两次读到：

```text
hel
lo\nworld\n
```

如果业务按行解析，可以用换行符作为分隔符。

处理思路：

```text
读取数据到 Buffer
-> 追加到连接级别缓存
-> 查找 \n
-> 找到完整一行就处理
-> 剩余半包继续保留
```

更通用的方式是长度字段协议：

```text
4 bytes bodyLength + body
```

读取时先判断是否够 4 字节长度，再判断消息体是否完整。

这也是 Netty 中 `LengthFieldBasedFrameDecoder` 的常见应用。Netty 文档可以查看：[Netty](https://netty.io/)。

图：长度字段协议抓包截图

![](images/2026/07/04/nio-length-field-packet-placeholder.png)

## FileChannel 小例子

NIO 不只用于网络，也常用于文件读写。

例如复制文件：

```java
try (FileChannel source = FileChannel.open(Path.of("source.txt"), StandardOpenOption.READ);
     FileChannel target = FileChannel.open(
             Path.of("target.txt"),
             StandardOpenOption.CREATE,
             StandardOpenOption.WRITE,
             StandardOpenOption.TRUNCATE_EXISTING)) {

    ByteBuffer buffer = ByteBuffer.allocate(1024);
    while (source.read(buffer) != -1) {
        buffer.flip();
        while (buffer.hasRemaining()) {
            target.write(buffer);
        }
        buffer.clear();
    }
}
```

这里也能看到同样的 Buffer 模式：

```text
read 写入 Buffer
-> flip 切换读模式
-> write 从 Buffer 读出
-> clear 切换写模式
```

FileChannel 还支持 `transferTo` 和 `transferFrom`。

```java
source.transferTo(0, source.size(), target);
```

这类方法在某些场景下可以利用操作系统能力减少数据拷贝。JDK 文档：[FileChannel](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/FileChannel.html)。

图：FileChannel transferTo 调试截图

![](images/2026/07/04/filechannel-transferto-debug-placeholder.png)

## DirectBuffer 和 HeapBuffer

创建 ByteBuffer 有两种常见方式：

```java
ByteBuffer heapBuffer = ByteBuffer.allocate(1024);
ByteBuffer directBuffer = ByteBuffer.allocateDirect(1024);
```

### HeapBuffer

堆内 Buffer，内存由 JVM 堆管理。

优点：

- 创建和回收相对简单；
- 可以直接访问底层 byte 数组；
- 适合普通业务处理。

### DirectBuffer

直接内存 Buffer，不在 Java 堆中。

优点：

- IO 场景下可能减少一次堆内外拷贝；
- 适合高性能网络或文件 IO。

缺点：

- 分配和释放成本更高；
- 不受普通堆大小直接限制；
- 使用不当可能导致直接内存溢出。

直接内存 OOM 常见报错：

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

可以通过 JVM 参数限制：

```bash
-XX:MaxDirectMemorySize=512m
```

普通应用不需要一上来就使用 DirectBuffer。只有在网络 IO 或文件 IO 压力较大时，再结合压测评估。

## NIO 和 BIO 的对比

| 对比点 | BIO | NIO |
| --- | --- | --- |
| IO 模型 | 阻塞 | 非阻塞 |
| 线程模型 | 通常一个连接一个线程 | 一个线程管理多个连接 |
| 编程复杂度 | 低 | 高 |
| 适合场景 | 连接少、逻辑简单 | 连接多、IO 等待多 |
| 数据处理 | Stream | Buffer + Channel |
| 事件机制 | 无 | Selector |

BIO 不是不能用。如果只是内部工具、低并发服务、短连接场景，BIO 代码更简单。

NIO 更适合长连接、多连接、高并发网络服务。

## NIO 和 Netty 的关系

Netty 可以理解为对 NIO 的高级封装。

原生 NIO 需要自己处理：

- Selector 事件循环；
- Buffer 读写；
- 粘包半包；
- 连接管理；
- 异常关闭；
- 线程模型；
- 编解码；
- 内存池；
- 心跳检测。

Netty 把这些能力封装成：

- EventLoop；
- ChannelPipeline；
- ByteBuf；
- ChannelHandler；
- Codec；
- IdleStateHandler。

所以学习 NIO 的价值不只是为了手写网络框架，更重要的是理解 Netty、RPC 框架、Redis 客户端、MQ 客户端背后的基础模型。

## 几个容易踩的坑

### 1. 忘记 configureBlocking(false)

注册到 Selector 的 Channel 必须是非阻塞模式。

错误：

```java
serverChannel.register(selector, SelectionKey.OP_ACCEPT);
```

如果没有先设置：

```java
serverChannel.configureBlocking(false);
```

会抛异常。

### 2. 忘记 iterator.remove()

selectedKeys 不清理，会导致事件重复处理。

### 3. 忘记 flip()

Buffer 写完后不 `flip()`，读不到预期数据。

### 4. 一直注册 OP_WRITE

`OP_WRITE` 长期保持注册，可能导致 Selector 不断返回写事件，CPU 占用升高。

### 5. 没有处理 read = -1

客户端断开后，如果服务端不关闭 Channel，可能造成连接资源泄漏。

### 6. 用一次 read 当成一条消息

TCP 是字节流，一次 read 不等于一条完整业务消息。必须设计协议或分隔符。

## 一个排查案例

某个内部 TCP 服务上线后，CPU 偶尔会突然升高，但业务流量并不大。

排查后发现，代码里为了响应客户端写数据，注册了 `OP_WRITE`，但写完后没有取消。

问题代码类似：

```java
key.interestOps(key.interestOps() | SelectionKey.OP_WRITE);
```

处理写事件时，写完没有执行：

```java
key.interestOps(key.interestOps() & ~SelectionKey.OP_WRITE);
```

结果是 Selector 一直认为这个 Channel 可写，事件循环持续处理写事件，导致 CPU 空转。

修复后，只在输出缓冲区还有剩余数据时才关注 `OP_WRITE`，写完立即取消写事件。

这个问题说明：NIO 的事件注册要非常谨慎。读事件通常可以长期关注，写事件一般按需注册。

图：OP_WRITE 未取消导致 CPU 升高的 top 截图

![](images/2026/07/04/nio-op-write-high-cpu-top-placeholder.png)

## 最小可用代码汇总

完整服务端代码可以整理成这样：

```java
public class NioEchoServer {

    public static void main(String[] args) throws IOException {
        // 创建服务端 Channel，用来监听客户端连接
        ServerSocketChannel serverChannel = ServerSocketChannel.open();

        // NIO + Selector 必须使用非阻塞模式
        serverChannel.configureBlocking(false);
        serverChannel.bind(new InetSocketAddress(9000));

        // Selector 负责统一监听多个 Channel 的就绪事件
        Selector selector = Selector.open();

        // 服务端 Channel 只关心新连接接入事件
        serverChannel.register(selector, SelectionKey.OP_ACCEPT);

        System.out.println("NIO echo server started, port=9000");

        while (true) {
            // 阻塞等待事件就绪；没有事件时不会空转占 CPU
            selector.select();
            Iterator<SelectionKey> iterator = selector.selectedKeys().iterator();

            while (iterator.hasNext()) {
                SelectionKey key = iterator.next();

                // 处理完必须移除，否则下轮循环会重复处理同一个 key
                iterator.remove();

                try {
                    if (key.isAcceptable()) {
                        // 有新客户端连接
                        handleAccept(selector, key);
                    } else if (key.isReadable()) {
                        // 已连接客户端发送了数据
                        handleRead(key);
                    }
                } catch (IOException e) {
                    // 发生 IO 异常时关闭 Channel，避免连接和 key 泄漏
                    closeKey(key);
                }
            }
        }
    }

    private static void handleAccept(Selector selector, SelectionKey key) throws IOException {
        ServerSocketChannel serverChannel = (ServerSocketChannel) key.channel();

        // accept 返回真正和客户端通信的 SocketChannel
        SocketChannel clientChannel = serverChannel.accept();
        clientChannel.configureBlocking(false);

        // 给客户端 Channel 注册读事件，并绑定一个 Buffer 作为 attachment
        clientChannel.register(selector, SelectionKey.OP_READ, ByteBuffer.allocate(1024));
        System.out.println("client connected: " + clientChannel.getRemoteAddress());
    }

    private static void handleRead(SelectionKey key) throws IOException {
        SocketChannel clientChannel = (SocketChannel) key.channel();

        // 取出注册 OP_READ 时绑定的 Buffer，避免每次读都创建新对象
        ByteBuffer buffer = (ByteBuffer) key.attachment();

        // 非阻塞读取：可能读到数据，也可能返回 0 或 -1
        int read = clientChannel.read(buffer);
        if (read == -1) {
            // -1 表示客户端正常关闭连接
            closeKey(key);
            return;
        }
        if (read == 0) {
            // 非阻塞模式下暂时没有读到数据
            return;
        }

        // 写模式切换为读模式，准备读取 Buffer 中的数据
        buffer.flip();
        byte[] bytes = new byte[buffer.remaining()];
        buffer.get(bytes);

        // 清空指针位置，准备下一次读取客户端数据
        buffer.clear();

        String request = new String(bytes, StandardCharsets.UTF_8).trim();
        String response = "echo: " + request + "\n";

        // 小响应可以直接写；大响应需要处理 write 未写完的情况
        clientChannel.write(ByteBuffer.wrap(response.getBytes(StandardCharsets.UTF_8)));
    }

    private static void closeKey(SelectionKey key) throws IOException {
        // 取消 key，避免 Selector 后续继续监听这个 Channel
        key.cancel();
        key.channel().close();
    }
}
```

这段代码还不适合直接用于生产，但已经能帮助理解 NIO 的基本工作方式。

## 收个尾

Java NIO 的核心不是某个 API，而是一套事件驱动的 IO 思路。

可以用几句话记住：

```text
Channel 负责连接或文件通道
Buffer 负责数据读写缓存
Selector 负责监听多个 Channel 的就绪事件
SelectionKey 表示 Channel 在 Selector 上的注册关系
非阻塞模式下，一个线程可以管理多个连接
```

真正写生产级网络服务时，还要继续处理协议设计、粘包半包、连接管理、写缓冲、心跳、异常关闭、线程模型和内存管理。

如果只是为了业务开发，掌握 NIO 的意义在于：看懂 Netty 这类框架为什么要这样设计，也能在遇到网络连接、CPU 空转、ByteBuffer 读写问题时，有能力往下排查。
