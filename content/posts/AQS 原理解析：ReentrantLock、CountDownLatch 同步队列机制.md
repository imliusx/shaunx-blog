---
title: AQS 原理解析：ReentrantLock、CountDownLatch 同步队列
slug: java-aqs-reentrantlock-countdownlatch-principle
date: 2023-05-21
category: 原理
tags:
  - Java
  - AQS
  - 并发编程
  - ReentrantLock
  - CountDownLatch
description: AQS 是 Java 并发包中非常核心的同步器框架，ReentrantLock、CountDownLatch、Semaphore、ReentrantReadWriteLock 等工具都基于它实现。内容围绕 state 状态变量、CLH 同步队列、独占模式、共享模式、线程阻塞唤醒和常见同步器实现思路展开。
cover:
published: true
---

## 引言

Java 并发编程里有几个非常常用的工具：

- `ReentrantLock`
- `CountDownLatch`
- `Semaphore`
- `ReentrantReadWriteLock`
- `CyclicBarrier`

这些工具用法不同，但底层有一个非常核心的基础组件：`AbstractQueuedSynchronizer`，简称 AQS。

AQS 位于 `java.util.concurrent.locks` 包下，是 JDK 并发包的基础同步框架。JDK API 可以查看：[AbstractQueuedSynchronizer](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.html)。

理解 AQS，有助于理解很多并发工具背后的实现逻辑：

```text
为什么 ReentrantLock 能阻塞和唤醒线程
为什么 CountDownLatch 能等待多个任务完成
为什么 Semaphore 能控制并发许可数量
为什么公平锁和非公平锁表现不同
为什么线程会进入 WAITING 状态
```

AQS 不是一个直接给业务代码使用的工具，而是一个“同步器构建框架”。它把线程排队、阻塞、唤醒这些通用逻辑封装好，把具体的加锁、释放、共享许可判断交给子类实现。

## AQS 解决了什么问题？

实现一个锁并不只是写一个 `boolean locked` 这么简单。

一个可用的同步器至少要解决这些问题：

1. 如何表示当前锁状态；
2. 多个线程竞争时如何保证原子性；
3. 抢不到锁的线程放在哪里；
4. 线程应该如何阻塞；
5. 锁释放后唤醒哪个线程；
6. 如何支持可重入；
7. 如何支持公平和非公平；
8. 如何支持共享模式；
9. 如何处理中断和超时。

AQS 把这些通用能力抽象成一套模板。

它的核心可以概括为三部分：

```text
state 状态变量
CLH 同步队列
CAS + LockSupport 阻塞唤醒
```

图：AQS state 与 CLH 同步队列结构图

![](images/2026/07/04/aqs-state-clh-queue-structure-placeholder.png)

## 核心字段：state

AQS 内部有一个非常重要的变量：

```java
private volatile int state;
```

`state` 表示同步状态。不同同步器对它的解释不同。

| 同步器 | state 含义 |
| --- | --- |
| ReentrantLock | 锁重入次数 |
| CountDownLatch | 还需要等待的计数 |
| Semaphore | 剩余许可数量 |
| ReentrantReadWriteLock | 高 16 位读锁数量，低 16 位写锁数量 |

AQS 提供了几个操作 `state` 的方法：

```java
protected final int getState()
protected final void setState(int newState)
protected final boolean compareAndSetState(int expect, int update)
```

其中 `compareAndSetState` 是核心，它通过 CAS 保证多线程竞争时的原子修改。

例如锁竞争时：

```text
线程 A 看到 state = 0
线程 B 也看到 state = 0
两个线程同时尝试 CAS 0 -> 1
只有一个线程能成功
成功线程获得锁
失败线程进入同步队列
```

这就是 AQS 能在多线程环境中维护同步状态的基础。

## 同步队列：抢不到锁的线程去哪了？

当一个线程抢不到锁时，不能一直空转消耗 CPU。AQS 会把线程包装成 Node，加入同步队列，然后挂起线程。

同步队列是一个变体 CLH 队列，内部通过 `head` 和 `tail` 维护双向链表。

简化结构：

```text
head <-> node1 <-> node2 <-> node3(tail)
```

每个 Node 大致包含：

```text
当前线程 thread
前驱节点 prev
后继节点 next
等待状态 status
模式 mode：独占 / 共享
```

当线程竞争失败时，流程大致是：

```text
尝试获取锁失败
-> 创建 Node
-> CAS 入队到 tail
-> 判断前驱是否是 head
-> 如果不能获取锁，LockSupport.park 阻塞
-> 等待前驱释放锁后唤醒
```

图：AQS Node 入队后的链表截图

![](images/2026/07/04/aqs-node-queue-debug-placeholder.png)

## 独占模式与共享模式

AQS 支持两种模式。

### 独占模式

同一时刻只有一个线程能获取同步状态。

典型工具：

- `ReentrantLock`
- `ReentrantReadWriteLock.WriteLock`

独占模式核心方法：

```java
protected boolean tryAcquire(int arg)
protected boolean tryRelease(int arg)
```

AQS 负责排队、阻塞和唤醒，子类负责实现 `tryAcquire` 和 `tryRelease`。

### 共享模式

同一时刻可以有多个线程获取同步状态。

典型工具：

- `CountDownLatch`
- `Semaphore`
- `ReentrantReadWriteLock.ReadLock`

共享模式核心方法：

```java
protected int tryAcquireShared(int arg)
protected boolean tryReleaseShared(int arg)
```

共享模式下，一个线程释放成功后，可能需要继续唤醒后续多个共享节点。

## ReentrantLock 加锁流程

`ReentrantLock` 是理解 AQS 独占模式最好的入口。JDK 文档可以查看：[ReentrantLock](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html)。

基本用法：

```java
private final ReentrantLock lock = new ReentrantLock();

public void update() {
    lock.lock();
    try {
        // 临界区
    } finally {
        lock.unlock();
    }
}
```

加锁时，调用链大致是：

```text
ReentrantLock.lock()
-> Sync.lock()
-> AQS.acquire(1)
-> tryAcquire(1)
-> 成功：当前线程获得锁
-> 失败：加入同步队列并阻塞
```

独占锁获取逻辑可以简化成：

```java
protected final boolean tryAcquire(int acquires) {
    Thread current = Thread.currentThread();
    int c = getState();

    if (c == 0) {
        if (compareAndSetState(0, acquires)) {
            setExclusiveOwnerThread(current);
            return true;
        }
    } else if (current == getExclusiveOwnerThread()) {
        int nextc = c + acquires;
        setState(nextc);
        return true;
    }

    return false;
}
```

逻辑分两种情况。

### 锁未被占用

```text
state = 0
-> CAS 修改 state 为 1
-> 设置当前线程为 owner
-> 获取锁成功
```

### 当前线程已经持有锁

```text
owner 是当前线程
-> state + 1
-> 获取锁成功
```

这就是可重入的实现方式。

图：ReentrantLock 加锁时 state 变化截图

![](images/2026/07/04/reentrantlock-state-change-debug-placeholder.png)

## ReentrantLock 释放锁流程

释放锁时调用：

```java
lock.unlock();
```

调用链大致是：

```text
ReentrantLock.unlock()
-> AQS.release(1)
-> tryRelease(1)
-> state 减 1
-> state 为 0 时清空 owner
-> 唤醒同步队列中的后继节点
```

释放逻辑简化：

```java
protected final boolean tryRelease(int releases) {
    int c = getState() - releases;

    if (Thread.currentThread() != getExclusiveOwnerThread()) {
        throw new IllegalMonitorStateException();
    }

    boolean free = false;
    if (c == 0) {
        free = true;
        setExclusiveOwnerThread(null);
    }

    setState(c);
    return free;
}
```

如果当前线程重入了多次，必须释放相同次数，锁才真正释放。

例如：

```java
lock.lock(); // state = 1
lock.lock(); // state = 2
lock.unlock(); // state = 1，还没真正释放
lock.unlock(); // state = 0，真正释放
```

只有 `state` 减到 0，AQS 才会唤醒后继节点。

## 公平锁和非公平锁

`ReentrantLock` 支持公平锁和非公平锁。

```java
ReentrantLock unfairLock = new ReentrantLock();
ReentrantLock fairLock = new ReentrantLock(true);
```

### 非公平锁

非公平锁允许线程直接尝试抢锁，不一定排队。

```text
新线程进来
-> 先 CAS 抢 state
-> 抢成功直接获得锁
-> 抢失败再入队
```

优点：吞吐量通常更高。

缺点：队列中的老线程可能等待更久。

### 公平锁

公平锁会先判断队列中是否有前驱节点。

```text
新线程进来
-> 判断同步队列中是否有人排队
-> 有人排队就不插队
-> 按队列顺序获取锁
```

核心判断类似：

```java
hasQueuedPredecessors()
```

公平锁更符合先来先服务，但吞吐量可能低一些。

实际业务中，如果没有严格公平要求，默认非公平锁通常更合适。

图：公平锁 hasQueuedPredecessors 调试截图

![](images/2026/07/04/reentrantlock-fair-has-queued-predecessors-placeholder.png)

## CountDownLatch 的实现思路

`CountDownLatch` 是 AQS 共享模式的典型应用。JDK 文档可以查看：[CountDownLatch](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CountDownLatch.html)。

基本用法：

```java
CountDownLatch latch = new CountDownLatch(3);

for (int i = 0; i < 3; i++) {
    new Thread(() -> {
        try {
            doWork();
        } finally {
            latch.countDown();
        }
    }).start();
}

latch.await();
System.out.println("all tasks finished");
```

`CountDownLatch` 中的 `state` 表示计数。

```text
new CountDownLatch(3)
-> state = 3
```

每次调用 `countDown()`：

```text
state = state - 1
```

调用 `await()` 的线程会判断：

```text
state 是否为 0
```

如果不是 0，就进入 AQS 同步队列等待。

图：CountDownLatch countDown 后 state 变化截图

![](images/2026/07/04/countdownlatch-state-change-debug-placeholder.png)

## CountDownLatch await 流程

`await()` 调用共享模式获取：

```text
CountDownLatch.await()
-> AQS.acquireSharedInterruptibly(1)
-> tryAcquireShared(1)
-> state == 0，获取成功
-> state != 0，加入同步队列并阻塞
```

核心逻辑非常简单：

```java
protected int tryAcquireShared(int acquires) {
    return (getState() == 0) ? 1 : -1;
}
```

返回值含义：

| 返回值 | 含义 |
| --- | --- |
| 大于等于 0 | 获取共享锁成功 |
| 小于 0 | 获取共享锁失败，需要排队等待 |

也就是说，`CountDownLatch` 的等待条件就是 `state == 0`。

## CountDownLatch countDown 流程

`countDown()` 调用共享模式释放：

```text
CountDownLatch.countDown()
-> AQS.releaseShared(1)
-> tryReleaseShared(1)
-> CAS state - 1
-> state 变为 0 时唤醒等待线程
```

核心逻辑类似：

```java
protected boolean tryReleaseShared(int releases) {
    for (;;) {
        int c = getState();
        if (c == 0) {
            return false;
        }
        int nextc = c - 1;
        if (compareAndSetState(c, nextc)) {
            return nextc == 0;
        }
    }
}
```

当最后一个任务执行 `countDown()`，`state` 从 1 变成 0，AQS 会唤醒 `await()` 中阻塞的线程。

需要注意：`CountDownLatch` 是一次性的，计数归零后不能重置。如果需要可重复使用的屏障，可以考虑 `CyclicBarrier` 或 `Phaser`。

## Semaphore 的实现思路

`Semaphore` 也是共享模式，文档可以查看：[Semaphore](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Semaphore.html)。

基本用法：

```java
Semaphore semaphore = new Semaphore(5);

public void handle() throws InterruptedException {
    semaphore.acquire();
    try {
        // 同时最多 5 个线程执行
    } finally {
        semaphore.release();
    }
}
```

`Semaphore` 中的 `state` 表示剩余许可数。

```text
new Semaphore(5)
-> state = 5
```

线程获取许可：

```text
acquire()
-> state - 1
```

线程释放许可：

```text
release()
-> state + 1
```

当 `state` 不足时，线程进入 AQS 同步队列等待。

所以 `CountDownLatch` 和 `Semaphore` 虽然用法不同，但底层都使用 AQS 共享模式，只是 `state` 的业务含义不同。

## 线程是怎么阻塞和唤醒的？

AQS 阻塞线程主要依赖 `LockSupport`。

JDK 文档：[LockSupport](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/LockSupport.html)。

常用方法：

```java
LockSupport.park();
LockSupport.unpark(thread);
```

当线程获取锁失败后，会进入同步队列，然后执行：

```java
LockSupport.park(this);
```

线程状态通常会变成 `WAITING`。

释放锁时，AQS 会找到后继节点对应的线程，然后：

```java
LockSupport.unpark(nextThread);
```

被唤醒的线程不会立刻一定获得锁，它会重新进入获取锁逻辑。如果此时能获取锁，就成为新的 owner；如果不能，可能继续阻塞。

图：jstack 中 LockSupport.park 线程栈截图

![](images/2026/07/04/aqs-locksupport-park-jstack-placeholder.png)

## AQS 为什么用模板方法？

AQS 的设计很像模板方法模式。

它负责通用流程：

```text
获取失败后入队
线程阻塞
释放后唤醒
处理中断
处理超时
维护同步队列
```

子类只需要实现状态判断：

```java
tryAcquire
tryRelease
tryAcquireShared
tryReleaseShared
isHeldExclusively
```

这样不同同步器就可以复用同一套排队和阻塞机制。

例如：

| 工具 | 模式 | 子类关注点 |
| --- | --- | --- |
| ReentrantLock | 独占 | state 是否为 0，是否当前线程重入 |
| CountDownLatch | 共享 | state 是否为 0 |
| Semaphore | 共享 | state 是否还有许可 |
| ReadWriteLock | 独占 + 共享 | 读写状态拆分和互斥关系 |

这种设计减少了重复代码，也让 JDK 并发工具保持一致的行为基础。

## 自定义一个简单锁

为了理解 AQS，可以实现一个不可重入独占锁。

```java
public class SimpleLock implements Lock {

    private static class Sync extends AbstractQueuedSynchronizer {

        @Override
        protected boolean tryAcquire(int arg) {
            if (compareAndSetState(0, 1)) {
                setExclusiveOwnerThread(Thread.currentThread());
                return true;
            }
            return false;
        }

        @Override
        protected boolean tryRelease(int arg) {
            if (getState() == 0) {
                throw new IllegalMonitorStateException();
            }
            setExclusiveOwnerThread(null);
            setState(0);
            return true;
        }

        @Override
        protected boolean isHeldExclusively() {
            return getState() == 1 && getExclusiveOwnerThread() == Thread.currentThread();
        }
    }

    private final Sync sync = new Sync();

    @Override
    public void lock() {
        sync.acquire(1);
    }

    @Override
    public void unlock() {
        sync.release(1);
    }

    @Override
    public boolean tryLock() {
        return sync.tryAcquire(1);
    }

    @Override
    public void lockInterruptibly() throws InterruptedException {
        sync.acquireInterruptibly(1);
    }

    @Override
    public boolean tryLock(long time, TimeUnit unit) throws InterruptedException {
        return sync.tryAcquireNanos(1, unit.toNanos(time));
    }

    @Override
    public Condition newCondition() {
        throw new UnsupportedOperationException();
    }
}
```

这个锁只实现了最基础的独占能力：

```text
state = 0 表示未加锁
state = 1 表示已加锁
CAS 0 -> 1 成功表示获取锁
释放时 state 置回 0
```

它不能重入，也没有实现 `Condition`，但已经具备 AQS 独占锁的基本形态。

图：SimpleLock 多线程竞争测试截图

![](images/2026/07/04/aqs-simplelock-concurrent-test-placeholder.png)

## Condition 条件队列

`ReentrantLock` 可以创建 `Condition`：

```java
Condition condition = lock.newCondition();
```

用法类似 `Object.wait()` 和 `Object.notify()`：

```java
lock.lock();
try {
    while (!ready) {
        condition.await();
    }
    doWork();
} finally {
    lock.unlock();
}
```

唤醒：

```java
lock.lock();
try {
    ready = true;
    condition.signal();
} finally {
    lock.unlock();
}
```

AQS 中除了同步队列，还有条件队列。

区别：

| 队列 | 作用 |
| --- | --- |
| 同步队列 | 获取锁失败的线程排队 |
| 条件队列 | 调用 `await()` 后等待条件满足的线程排队 |

`await()` 大致流程：

```text
当前线程必须持有锁
-> 加入 Condition 条件队列
-> 释放当前持有的锁
-> park 阻塞
```

`signal()` 大致流程：

```text
从条件队列取出等待节点
-> 转移到 AQS 同步队列
-> 等待重新竞争锁
```

注意：`signal()` 不是让线程立刻执行，而是把线程从条件队列转移到同步队列，后续还要重新竞争锁。

图：Condition 条件队列与 AQS 同步队列示意图

![](images/2026/07/04/aqs-condition-queue-sync-queue-placeholder.png)

## 常见误区

### 误区一：AQS 是一种锁

AQS 不是具体的锁，而是构建锁和同步器的框架。

`ReentrantLock`、`CountDownLatch`、`Semaphore` 才是面向业务使用的同步工具。

### 误区二：state 只表示锁状态

`state` 只是一个整数状态，不同同步器含义不同。

在 `ReentrantLock` 中它表示重入次数；在 `CountDownLatch` 中表示计数；在 `Semaphore` 中表示许可数量。

### 误区三：公平锁一定更好

公平锁减少插队，但吞吐量通常低于非公平锁。大部分业务场景默认非公平锁就够了。

只有在明确需要避免饥饿或强调顺序时，才考虑公平锁。

### 误区四：线程被 unpark 后立刻获得锁

`unpark` 只是唤醒线程。线程醒来后还要重新尝试获取锁，成功后才能继续执行。

### 误区五：CountDownLatch 可以复用

`CountDownLatch` 计数归零后不能重置。需要复用屏障时，可以考虑 `CyclicBarrier` 或 `Phaser`。

## 线上排查中怎么看 AQS 问题？

AQS 相关问题在线上通常表现为线程阻塞、接口卡住或任务一直不执行。

可以用 `jstack` 查看线程栈。

常见栈信息：

```text
java.lang.Thread.State: WAITING (parking)
    at jdk.internal.misc.Unsafe.park(Native Method)
    at java.util.concurrent.locks.LockSupport.park(LockSupport.java:221)
    at java.util.concurrent.locks.AbstractQueuedSynchronizer.acquire(AbstractQueuedSynchronizer.java:754)
    at java.util.concurrent.locks.ReentrantLock.lock(ReentrantLock.java:322)
```

这说明线程正在等待某个 AQS 同步器。

排查方向：

1. 哪个线程持有锁；
2. 持锁线程在执行什么；
3. 是否出现死锁；
4. 是否锁粒度过大；
5. 是否忘记 unlock；
6. 是否等待 CountDownLatch 但 countDown 没执行；
7. 是否 Semaphore 许可没有释放。

对于 `ReentrantLock`，务必使用：

```java
lock.lock();
try {
    // business
} finally {
    lock.unlock();
}
```

不要把 `unlock()` 写在普通流程末尾，否则异常时可能无法释放锁。

## AQS 和 synchronized 的区别

`synchronized` 是 JVM 层面的内置锁，AQS 是 Java 层面的同步器框架。

| 对比 | synchronized | AQS / ReentrantLock |
| --- | --- | --- |
| 实现层级 | JVM | Java 代码 + Unsafe / VarHandle |
| 加锁方式 | 关键字 | 显式 lock/unlock |
| 释放方式 | 自动释放 | 需要手动 unlock |
| 可中断获取 | 不支持普通进入中断 | 支持 lockInterruptibly |
| 超时获取 | 不支持 | 支持 tryLock(timeout) |
| 多条件队列 | 一个 wait set | 多个 Condition |
| 公平性 | 不支持直接配置 | 支持公平 / 非公平 |

如果只是简单同步，`synchronized` 更简洁。需要可中断、超时、公平锁、多条件队列时，`ReentrantLock` 更灵活。

## 总结

AQS 是 Java 并发包的核心基础设施。它通过一个 `volatile int state` 表示同步状态，通过 CLH 同步队列管理等待线程，通过 CAS 保证状态修改原子性，通过 `LockSupport` 完成线程阻塞和唤醒。

可以用一句话理解 AQS：

```text
AQS 负责排队和唤醒，子类负责判断能不能获取或释放同步状态。
```

`ReentrantLock` 使用 AQS 独占模式，`state` 表示锁重入次数；`CountDownLatch` 使用 AQS 共享模式，`state` 表示剩余计数；`Semaphore` 也使用共享模式，`state` 表示剩余许可。

掌握 AQS 后，再看 Java 并发工具会清晰很多。很多看似不同的工具，本质上都是围绕 `state`、同步队列、独占模式和共享模式构建出来的。
