---
title: 深入理解 Java 并发：J.U.C 核心组件源码解析
slug: java-juc-core-components-source-code-analysis
date: 2023-07-16
category: 原理
tags:
  - Java
  - JUC
  - 并发编程
  - 源码解析
  - 多线程
  - AQS
description: J.U.C 是 Java 并发编程的核心工具包，包含锁、原子类、线程池、阻塞队列、并发容器、同步器和异步编排等能力。内容围绕 AQS、ReentrantLock、ThreadPoolExecutor、BlockingQueue、ConcurrentHashMap、Atomic、LongAdder 和 CompletableFuture 的源码设计展开，梳理 Java 并发工具的底层实现思路。
cover:
published: true
---

## 从一个包开始看 Java 并发

Java 并发工具大多集中在这个包下：

```text
java.util.concurrent
```

通常也简称 J.U.C。

这个包里有很多熟悉的类：

```text
ConcurrentHashMap
ThreadPoolExecutor
LinkedBlockingQueue
ArrayBlockingQueue
ReentrantLock
CountDownLatch
Semaphore
CyclicBarrier
AtomicInteger
LongAdder
CompletableFuture
```

这些工具表面上用法不同，底层却有一些共同设计：

```text
CAS
volatile
AQS
LockSupport
阻塞队列
分段或分桶竞争
任务状态机
线程安全容器
```

JDK API 可以查看：[java.util.concurrent](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/package-summary.html)

如果想真正理解 Java 并发，不能只停留在 API 用法，还要知道这些组件为什么这样设计。

## 一张源码阅读地图

J.U.C 可以按能力拆成几组。

```text
锁与同步器
-> AQS、ReentrantLock、CountDownLatch、Semaphore

线程池
-> Executor、ThreadPoolExecutor、ScheduledThreadPoolExecutor

阻塞队列
-> BlockingQueue、ArrayBlockingQueue、LinkedBlockingQueue、SynchronousQueue

并发容器
-> ConcurrentHashMap、CopyOnWriteArrayList、ConcurrentLinkedQueue

原子类
-> AtomicInteger、AtomicReference、AtomicStampedReference

高并发计数
-> LongAdder、LongAccumulator

异步编排
-> CompletableFuture
```

图：J.U.C 核心组件源码关系图

![](images/2026/07/05/juc-core-components-relationship-placeholder.png)

这篇会挑最核心的几个组件看源码设计，不追求把每一行源码都展开，而是抓住它们背后的实现思路。

## AQS：很多同步器的骨架

AQS，全称 `AbstractQueuedSynchronizer`，是 J.U.C 里非常核心的基础类。文档地址：[AbstractQueuedSynchronizer](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.html)。

它做了三件大事：

```text
用 state 表示同步状态
用 CLH 队列管理等待线程
用 LockSupport 阻塞和唤醒线程
```

AQS 内部有一个核心字段：

```java
private volatile int state;
```

不同同步器对 `state` 的解释不同：

| 组件 | state 含义 |
| --- | --- |
| ReentrantLock | 锁重入次数 |
| CountDownLatch | 剩余计数 |
| Semaphore | 剩余许可 |
| ReentrantReadWriteLock | 读写锁状态 |

AQS 不直接关心业务语义，它只提供通用流程：

```text
尝试获取同步状态
-> 获取失败，线程入队
-> 挂起线程
-> 释放同步状态
-> 唤醒后继线程
```

子类只需要实现几个模板方法：

```java
protected boolean tryAcquire(int arg)
protected boolean tryRelease(int arg)
protected int tryAcquireShared(int arg)
protected boolean tryReleaseShared(int arg)
```

这个设计非常典型：AQS 负责“排队和唤醒”，具体同步器负责“能不能获取锁”。

图：AQS state 和等待队列源码截图

![](images/2026/07/05/aqs-state-wait-queue-source-placeholder.png)

## ReentrantLock：AQS 独占模式

`ReentrantLock` 是 AQS 独占模式的代表。文档地址：[ReentrantLock](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html)。

基本用法：

```java
private final ReentrantLock lock = new ReentrantLock();

public void update() {
    lock.lock();
    try {
        // 临界区代码必须放在 try 内，避免异常导致锁不释放
        doUpdate();
    } finally {
        // unlock 必须放在 finally，保证任何异常路径都能释放锁
        lock.unlock();
    }
}
```

源码里，`ReentrantLock` 内部有一个 `Sync`，继承 AQS。

加锁逻辑可以简化成：

```java
protected final boolean tryAcquire(int acquires) {
    Thread current = Thread.currentThread();
    int c = getState();

    if (c == 0) {
        // state 为 0 表示当前没有线程持有锁，CAS 成功则当前线程获得锁
        if (compareAndSetState(0, acquires)) {
            setExclusiveOwnerThread(current);
            return true;
        }
    } else if (current == getExclusiveOwnerThread()) {
        // 如果当前线程已经持有锁，state 递增，实现可重入
        int nextc = c + acquires;
        setState(nextc);
        return true;
    }

    // 其他线程已经持有锁，获取失败，后续会进入 AQS 队列等待
    return false;
}
```

这里可以看到可重入锁的本质：

```text
同一个线程重复加锁
-> state 递增
-> unlock 时 state 递减
-> state 减到 0 才真正释放锁
```

公平锁和非公平锁的区别主要在获取锁前是否判断队列中已有等待线程。

非公平锁更激进：

```text
先抢锁
抢不到再排队
```

公平锁更守规矩：

```text
先看队列前面有没有人
没人再抢锁
```

这也是为什么非公平锁吞吐量通常更好，但等待时间更不稳定。

## CountDownLatch：AQS 共享模式

`CountDownLatch` 的代码比 `ReentrantLock` 更容易理解。文档地址：[CountDownLatch](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CountDownLatch.html)。

使用方式：

```java
CountDownLatch latch = new CountDownLatch(3);

for (int i = 0; i < 3; i++) {
    new Thread(() -> {
        try {
            doWork();
        } finally {
            // 每个任务完成后计数减 1
            latch.countDown();
        }
    }).start();
}

// 主线程等待 state 变为 0
latch.await();
```

`CountDownLatch` 的 `state` 就是初始计数。

```text
new CountDownLatch(3)
-> state = 3
```

`await()` 的判断非常直接：

```java
protected int tryAcquireShared(int acquires) {
    // state 为 0 表示所有任务都完成，等待线程可以继续执行
    return (getState() == 0) ? 1 : -1;
}
```

`countDown()` 则是 CAS 减计数：

```java
protected boolean tryReleaseShared(int releases) {
    for (;;) {
        int c = getState();
        if (c == 0) {
            return false;
        }

        int nextc = c - 1;
        // CAS 保证多个线程同时 countDown 时计数安全
        if (compareAndSetState(c, nextc)) {
            return nextc == 0;
        }
    }
}
```

`nextc == 0` 时，AQS 会唤醒等待队列中的线程。

这就是 CountDownLatch 的全部核心逻辑：

```text
await 看 state 是否为 0
countDown 把 state 减到 0
AQS 负责阻塞和唤醒
```

图：CountDownLatch tryAcquireShared 源码截图

![](images/2026/07/05/countdownlatch-tryacquireshared-source-placeholder.png)

## ThreadPoolExecutor：把线程创建变成资源管理

线程池不是只为了少写几行 `new Thread()`。它真正解决的是线程资源管理。

`ThreadPoolExecutor` 文档：[ThreadPoolExecutor](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html)。

构造方法：

```java
public ThreadPoolExecutor(
        int corePoolSize,
        int maximumPoolSize,
        long keepAliveTime,
        TimeUnit unit,
        BlockingQueue<Runnable> workQueue,
        ThreadFactory threadFactory,
        RejectedExecutionHandler handler) {
}
```

它内部最关键的是一个 `ctl` 字段。

`ctl` 同时保存两类信息：

```text
线程池运行状态
工作线程数量
```

源码中大概是这样设计的：

```java
private final AtomicInteger ctl = new AtomicInteger(ctlOf(RUNNING, 0));
```

高 3 位表示线程池状态，低 29 位表示 worker 数量。

状态包括：

```text
RUNNING
SHUTDOWN
STOP
TIDYING
TERMINATED
```

这种设计把两个变量压到一个 int 里，便于通过 CAS 同时判断和更新。

图：ThreadPoolExecutor ctl 高低位结构截图

![](images/2026/07/05/threadpoolexecutor-ctl-bit-structure-placeholder.png)

## execute 方法的核心流程

`execute()` 是线程池提交任务的入口。

简化逻辑：

```java
public void execute(Runnable command) {
    if (command == null) {
        throw new NullPointerException();
    }

    int c = ctl.get();

    if (workerCountOf(c) < corePoolSize) {
        // 当前工作线程数小于核心线程数，优先创建核心线程执行任务
        if (addWorker(command, true)) {
            return;
        }
        c = ctl.get();
    }

    if (isRunning(c) && workQueue.offer(command)) {
        // 核心线程已满，线程池仍在运行，任务进入阻塞队列
        int recheck = ctl.get();
        if (!isRunning(recheck) && remove(command)) {
            // 二次检查：入队后线程池可能已经关闭，需要移除任务并拒绝
            reject(command);
        } else if (workerCountOf(recheck) == 0) {
            // 队列里有任务但没有工作线程，需要补一个空 worker
            addWorker(null, false);
        }
    } else if (!addWorker(command, false)) {
        // 队列放不进去，尝试创建非核心线程；失败则触发拒绝策略
        reject(command);
    }
}
```

任务提交流程可以记成：

```text
核心线程未满 -> 创建核心线程
核心线程已满 -> 放入队列
队列已满 -> 创建非核心线程
线程数也满 -> 拒绝任务
```

源码里最容易忽略的是“二次检查”。任务入队后，线程池状态可能变化，所以需要再次判断线程池是否还在运行。

## BlockingQueue：线程池背后的缓冲区

线程池能不能抗住压力，很大程度取决于队列设计。

常见队列：

| 队列 | 特点 |
| --- | --- |
| ArrayBlockingQueue | 有界数组队列 |
| LinkedBlockingQueue | 链表队列，可有界也可无界 |
| SynchronousQueue | 不存储任务，直接交付 |
| PriorityBlockingQueue | 优先级队列，无界 |
| DelayQueue | 延迟队列 |

`ArrayBlockingQueue` 使用一把锁和两个条件队列：

```text
notEmpty：队列非空，可以取
notFull：队列未满，可以放
```

典型入队逻辑：

```java
public void put(E e) throws InterruptedException {
    final ReentrantLock lock = this.lock;
    lock.lockInterruptibly();
    try {
        while (count == items.length) {
            // 队列满了，生产者等待 notFull 条件
            notFull.await();
        }
        enqueue(e);
    } finally {
        lock.unlock();
    }
}
```

出队逻辑类似：

```java
public E take() throws InterruptedException {
    final ReentrantLock lock = this.lock;
    lock.lockInterruptibly();
    try {
        while (count == 0) {
            // 队列空了，消费者等待 notEmpty 条件
            notEmpty.await();
        }
        return dequeue();
    } finally {
        lock.unlock();
    }
}
```

这就是阻塞队列的基本模式：

```text
队列满 -> 生产者等待
队列空 -> 消费者等待
状态变化 -> signal 唤醒对方
```

图：ArrayBlockingQueue notEmpty 和 notFull 条件队列截图

![](images/2026/07/05/arrayblockingqueue-condition-source-placeholder.png)

## ConcurrentHashMap：高并发容器的取舍

`ConcurrentHashMap` 是最常用的并发 Map。文档地址：[ConcurrentHashMap](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html)。

JDK 8 之后，它不再使用 Segment 分段锁，而是采用：

```text
数组 + 链表 + 红黑树
CAS + synchronized
```

核心结构类似：

```text
table 数组
-> Node 链表
-> TreeBin 红黑树
```

### put 大概怎么做

简化流程：

```text
计算 hash
-> 定位 table 下标
-> 如果桶为空，CAS 放入 Node
-> 如果桶不为空，锁住桶头节点
-> 链表或红黑树中插入节点
-> 必要时扩容
```

为什么桶为空时用 CAS？

因为这是最快路径，不需要加锁。

```java
if (tabAt(tab, i) == null) {
    // 桶为空时，直接 CAS 放入新节点，避免加锁
    if (casTabAt(tab, i, null, new Node<K,V>(hash, key, value))) {
        break;
    }
}
```

桶不为空时，才对桶头加锁：

```java
synchronized (f) {
    // 只锁当前桶，不影响其他桶上的并发读写
    // 链表或红黑树插入逻辑
}
```

这种设计避免了整个 Map 全局加锁。

图：ConcurrentHashMap putVal 桶级锁源码截图

![](images/2026/07/05/concurrenthashmap-putval-bin-lock-placeholder.png)

## size 为什么不简单

在并发环境下，`ConcurrentHashMap.size()` 不是简单维护一个 int。

因为多个线程同时 put/remove，如果所有更新都争抢同一个计数器，会形成热点。

`ConcurrentHashMap` 借鉴了 LongAdder 的思路，使用 baseCount + CounterCell 分散计数压力。

大致思想：

```text
竞争不激烈 -> 更新 baseCount
竞争激烈 -> 分散到多个 CounterCell
统计 size -> baseCount + 所有 CounterCell
```

这也是很多高并发组件的共同思路：

```text
不要让所有线程抢一个变量
把热点拆散
最后再汇总
```

## AtomicInteger：CAS 的基础用法

原子类位于 `java.util.concurrent.atomic` 包下。文档地址：[java.util.concurrent.atomic](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/atomic/package-summary.html)。

`AtomicInteger` 最常见：

```java
AtomicInteger counter = new AtomicInteger(0);

int value = counter.incrementAndGet();
```

`incrementAndGet()` 的核心是 CAS 循环。

简化逻辑：

```java
public final int incrementAndGet() {
    for (;;) {
        int current = get();
        int next = current + 1;

        // 如果 current 期间没有被其他线程改过，CAS 成功
        if (compareAndSet(current, next)) {
            return next;
        }

        // CAS 失败说明有竞争，继续重试
    }
}
```

CAS 的优点是无锁，线程不需要阻塞。

缺点也明显：

```text
竞争激烈时会不断自旋
只能保证单个变量原子更新
存在 ABA 问题
复杂逻辑可读性差
```

ABA 可以用 `AtomicStampedReference` 这类带版本号的原子类解决。

图：AtomicInteger compareAndSet 调试截图

![](images/2026/07/05/atomicinteger-compareandset-debug-placeholder.png)

## LongAdder：高并发计数更适合它

如果只是低并发计数，`AtomicLong` 很好用。

但在高并发计数场景下，所有线程都 CAS 同一个 value，竞争会非常激烈。

`LongAdder` 的思路是分散热点。

```java
LongAdder adder = new LongAdder();

adder.increment();
long value = adder.sum();
```

它内部大致有：

```text
base
Cell[] cells
```

竞争不激烈时更新 base。

竞争激烈时，不同线程根据 hash 分散更新不同 Cell。

最后 `sum()` 时汇总：

```text
base + cell1 + cell2 + cell3 ...
```

适合场景：

```text
接口 QPS 统计
请求计数
监控指标
热点访问次数
```

不适合场景：

```text
需要强一致立即读取计数
需要基于计数做严格判断
```

因为 `sum()` 期间其他线程可能还在更新，结果更偏向统计意义，不适合作为严格条件判断。

图：LongAdder base 与 Cell 分散计数示意图

![](images/2026/07/05/longadder-base-cells-placeholder.png)

## CopyOnWriteArrayList：读多写少的选择

`CopyOnWriteArrayList` 的思路非常直接：写时复制。

读操作不加锁，写操作复制一份新数组。

```java
CopyOnWriteArrayList<String> listeners = new CopyOnWriteArrayList<>();

listeners.add("listener-1");

for (String listener : listeners) {
    notify(listener);
}
```

适合：

```text
配置监听器列表
事件订阅者列表
读远多于写的小集合
```

不适合：

```text
频繁写入
大集合
需要强实时可见最新写入的迭代场景
```

写入简化逻辑：

```java
public boolean add(E e) {
    synchronized (lock) {
        Object[] es = getArray();
        int len = es.length;

        // 写入时复制一个新数组
        es = Arrays.copyOf(es, len + 1);
        es[len] = e;

        // 替换底层数组，读线程后续看到新数组
        setArray(es);
        return true;
    }
}
```

它牺牲写性能，换取读操作无锁和迭代安全。

## CompletableFuture：异步任务编排

`CompletableFuture` 是 JDK 8 引入的异步编排工具。文档地址：[CompletableFuture](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CompletableFuture.html)。

常见用法：

```java
CompletableFuture<UserDTO> userFuture = CompletableFuture.supplyAsync(() -> {
    // 异步查询用户信息
    return userService.getUser(userId);
}, executor);

CompletableFuture<OrderDTO> orderFuture = CompletableFuture.supplyAsync(() -> {
    // 异步查询订单信息
    return orderService.getOrder(orderId);
}, executor);

CompletableFuture<ResultDTO> resultFuture = userFuture.thenCombine(orderFuture, (user, order) -> {
    // 两个异步结果都完成后再合并
    return buildResult(user, order);
});

ResultDTO result = resultFuture.join();
```

它解决的问题是：

```text
异步任务提交
异步结果回调
多个任务组合
异常处理
任务依赖编排
```

但有一个坑：不要默认使用公共 ForkJoinPool 执行业务 IO 任务。

```java
CompletableFuture.supplyAsync(() -> remoteCall());
```

如果不传 executor，会使用公共线程池。业务远程调用、数据库查询这类阻塞任务，最好传入自定义线程池。

```java
CompletableFuture.supplyAsync(() -> remoteCall(), businessExecutor);
```

否则公共线程池被阻塞后，可能影响其他异步任务。

图：CompletableFuture thenCombine 异步编排调试截图

![](images/2026/07/05/completablefuture-thencombine-debug-placeholder.png)

## J.U.C 组件背后的共同设计

看完这些组件，会发现 J.U.C 有一些共同思想。

### 1. 用 CAS 降低锁竞争

例如：

```text
AtomicInteger
ConcurrentHashMap 空桶插入
ThreadPoolExecutor ctl 更新
AQS state 修改
```

CAS 适合短小、简单、低阻塞的状态更新。

### 2. 竞争激烈时拆分热点

例如：

```text
LongAdder Cell
ConcurrentHashMap CounterCell
ConcurrentHashMap 桶级锁
```

不要让所有线程抢同一个变量。

### 3. 阻塞必须有队列

例如：

```text
AQS 同步队列
BlockingQueue 条件队列
ThreadPoolExecutor 工作队列
```

线程不能拿不到资源就一直空转，必须有等待、唤醒和取消机制。

### 4. 状态机比 boolean 更可靠

例如 ThreadPoolExecutor：

```text
RUNNING
SHUTDOWN
STOP
TIDYING
TERMINATED
```

复杂生命周期不要用一个 boolean 表示。

### 5. API 简单，内部复杂

业务代码看到的是：

```java
lock.lock();
executor.execute(task);
map.put(key, value);
future.thenApply(fn);
```

源码内部处理的是：

```text
并发竞争
内存可见性
线程阻塞
任务取消
状态转换
异常路径
资源释放
```

## 读源码时最容易误解的点

### 1. 不要一上来抠每一行

先看字段，再看核心方法，再看状态流转。

比如看线程池，先理解：

```text
ctl
Worker
workQueue
execute
addWorker
runWorker
```

比从第一行看到最后一行更有效。

### 2. 不要只看正常路径

并发源码里，异常路径很重要。

例如：

```text
任务入队后线程池关闭怎么办
线程执行任务抛异常怎么办
消费者等待时被中断怎么办
CAS 失败后怎么重试
```

### 3. 不要忽略注释

JDK 源码注释信息量很大，很多设计取舍都写在注释里。

### 4. 不要脱离使用场景

源码是为了解释行为。

例如 LongAdder 为什么比 AtomicLong 更适合高并发计数，必须结合“多个线程抢同一个计数器”的场景理解。

## 线上排查时怎么看 J.U.C 问题

J.U.C 问题在线上通常表现为：

```text
线程大量 WAITING
线程池队列堆积
CPU 自旋升高
锁等待严重
异步任务不执行
内存中 Runnable 对象堆积
```

常用排查命令：

```bash
jstack <pid> > jstack.log
jstat -gcutil <pid> 1000
jmap -histo <pid> | head
```

如果看到大量线程卡在：

```text
java.util.concurrent.locks.LockSupport.park
```

可能是在等待 AQS 锁、线程池任务、阻塞队列、CompletableFuture 等。

如果线程池队列堆积，要看：

```text
核心线程数
最大线程数
队列长度
拒绝策略
任务平均耗时
下游接口是否慢
```

如果 ConcurrentHashMap 占用内存很大，要看是否存在无上限缓存。

图：jstack 中 LockSupport.park 线程堆栈截图

![](images/2026/07/05/juc-locksupport-park-jstack-placeholder.png)

## 一份源码阅读顺序

如果想系统读 J.U.C，建议按这个顺序：

```text
AtomicInteger
-> LongAdder
-> ReentrantLock
-> CountDownLatch
-> ArrayBlockingQueue
-> ThreadPoolExecutor
-> ConcurrentHashMap
-> CompletableFuture
```

原因是：

```text
先理解 CAS
再理解热点拆分
再理解 AQS
再理解阻塞队列
再看线程池
再看并发容器
最后看异步编排
```

每读一个组件，都问几个问题：

```text
核心状态字段是什么
如何保证线程安全
竞争失败怎么办
线程是否会阻塞
阻塞后如何唤醒
异常路径如何处理
适合什么场景
不适合什么场景
```

这样读源码不会散。

## 收尾

J.U.C 的核心不是某一个类，而是一整套并发设计思想。

可以用几句话概括：

```text
AQS 负责同步器的排队和唤醒
ThreadPoolExecutor 负责线程资源和任务队列管理
BlockingQueue 负责生产者消费者之间的阻塞协调
ConcurrentHashMap 通过 CAS 和桶级锁提升并发能力
Atomic 类用 CAS 做无锁更新
LongAdder 通过分散热点提升高并发计数性能
CompletableFuture 负责异步任务组合和结果编排
```

真正理解 J.U.C 后，写并发代码时会更关注这些问题：

```text
线程会不会无限创建
队列会不会无限堆积
锁粒度是不是太大
缓存有没有上限
任务失败有没有处理
异步线程池是不是隔离
共享变量是否有可见性保证
```

并发问题通常不是 API 不会用，而是资源边界、状态流转和异常路径没有想清楚。J.U.C 源码最值得学习的地方，也正是这些细节。
