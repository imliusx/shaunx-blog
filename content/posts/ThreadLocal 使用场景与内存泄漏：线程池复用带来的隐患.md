---
title: ThreadLocal 使用场景与内存泄漏：线程池复用带来的隐患
slug: threadlocal-usage-and-memory-leak
date: 2022-03-27
category: 原理
tags:
  - Java
  - ThreadLocal
  - 并发编程
  - 内存泄漏
  - 线程池
description: 整理 ThreadLocal 的典型使用场景，包括登录用户上下文、SimpleDateFormat 线程安全和日志 traceId 传递，深入 ThreadLocalMap 的结构和弱引用设计，分析内存泄漏和线程池复用导致脏数据的成因，最后给出正确使用姿势和跨线程传递方案。
cover:
published: true
---

## 引言

前段时间测试同学提了一个很诡异的 Bug：

> 用 A 账号登录，偶尔会看到 B 账号的数据。刷新一下又正常了，复现不稳定。

看到“偶尔”“复现不稳定”这几个字，第一反应就是并发问题。最后查下来，原因是登录用户信息放在 ThreadLocal 里，请求结束后没有清理，被 Tomcat 复用的线程带给了下一个请求。

ThreadLocal 是 Java 里一个存在感很微妙的类：平时业务代码里直接用得不多，但用户上下文、日志链路、Spring 事务这些地方全靠它撑着。一旦用错，出的都是“数据串了”“内存慢慢涨”这类不好查的问题。

这篇文章整理 ThreadLocal 的典型使用场景、底层结构，重点讲清楚两件事：内存泄漏是怎么发生的，以及比内存泄漏更常见的脏数据问题。

JDK 文档可以查看：[ThreadLocal (Java Platform SE 8)](https://docs.oracle.com/javase/8/docs/api/java/lang/ThreadLocal.html)。

## ThreadLocal 是什么

一句话：ThreadLocal 为每个线程提供一份独立的变量副本，线程之间互不可见。

```java
public class ThreadLocalDemo {

    private static final ThreadLocal<String> CONTEXT = new ThreadLocal<>();

    public static void main(String[] args) {
        new Thread(() -> {
            CONTEXT.set("线程 1 的数据");
            System.out.println(Thread.currentThread().getName() + " -> " + CONTEXT.get());
        }, "t1").start();

        new Thread(() -> {
            CONTEXT.set("线程 2 的数据");
            System.out.println(Thread.currentThread().getName() + " -> " + CONTEXT.get());
        }, "t2").start();
    }
}
```

输出：

```text
t1 -> 线程 1 的数据
t2 -> 线程 2 的数据
```

两个线程操作的是同一个 `CONTEXT` 对象，但各自 set 的值只有自己能 get 到。

### 和加锁是两种思路

同样是解决多线程访问共享数据的问题，锁和 ThreadLocal 的方向完全相反：

| | 加锁 | ThreadLocal |
| --- | --- | --- |
| 思路 | 共享数据，排队访问 | 每个线程一份副本，不共享 |
| 代价 | 时间：线程阻塞等待 | 空间：每个线程存一份 |
| 适用 | 需要修改同一份数据 | 数据只在线程内部使用 |

锁解决的是“多个线程要改同一个东西”，ThreadLocal 解决的是“这个东西本来就该线程私有，只是不想在方法之间层层传参”。

## 典型使用场景

### 场景一：登录用户上下文

最常见的场景。请求进来时在拦截器里解析出登录用户，业务代码随取随用，不用把 `userId` 一路从 Controller 传到 DAO。

先封装一个 Holder：

```java
public class UserContextHolder {

    private static final ThreadLocal<UserInfo> USER_CONTEXT = new ThreadLocal<>();

    public static void set(UserInfo userInfo) {
        USER_CONTEXT.set(userInfo);
    }

    public static UserInfo get() {
        return USER_CONTEXT.get();
    }

    public static void remove() {
        USER_CONTEXT.remove();
    }
}
```

拦截器里设置和清理：

```java
public class LoginInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) {
        String token = request.getHeader("Authorization");
        UserInfo userInfo = tokenService.parseToken(token);
        if (userInfo == null) {
            response.setStatus(401);
            return false;
        }
        UserContextHolder.set(userInfo);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request,
                                HttpServletResponse response,
                                Object handler, Exception ex) {
        UserContextHolder.remove();
    }
}
```

业务代码里直接取：

```java
public OrderDTO createOrder(OrderCreateRequest request) {
    Long userId = UserContextHolder.get().getUserId();
    ...
}
```

注意 `afterCompletion` 里的 `remove()`，它就是引言里那个串号 Bug 的答案，后面详细讲。

### 场景二：SimpleDateFormat 的线程安全问题

老项目里很常见的坑。`SimpleDateFormat` 不是线程安全的，但很多人把它定义成了共享的常量：

```java
public class DateUtil {

    private static final SimpleDateFormat SDF = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");

    public static Date parse(String dateStr) throws ParseException {
        return SDF.parse(dateStr);
    }
}
```

单线程没问题，并发一上来就会出事。写个测试：

```java
ExecutorService executor = Executors.newFixedThreadPool(10);
for (int i = 0; i < 100; i++) {
    executor.execute(() -> {
        try {
            System.out.println(DateUtil.parse("2022-03-27 10:00:00"));
        } catch (Exception e) {
            System.out.println("解析异常：" + e.getMessage());
        }
    });
}
```

运行结果里会混着解析异常，甚至解析出 2200 年这种错误时间：

```text
Sun Mar 27 10:00:00 CST 2022
解析异常：multiple points
Wed Mar 27 10:00:00 CST 2202
```

原因是 `SimpleDateFormat` 内部持有一个 `Calendar` 对象，parse 过程会先 clear 再逐段填充，多个线程同时操作同一个 `Calendar`，中间状态互相覆盖。

用 ThreadLocal 让每个线程持有自己的实例：

```java
public class DateUtil {

    private static final ThreadLocal<SimpleDateFormat> SDF_HOLDER =
            ThreadLocal.withInitial(() -> new SimpleDateFormat("yyyy-MM-dd HH:mm:ss"));

    public static Date parse(String dateStr) throws ParseException {
        return SDF_HOLDER.get().parse(dateStr);
    }

    public static String format(Date date) {
        return SDF_HOLDER.get().format(date);
    }
}
```

`withInitial` 提供初始值：线程第一次调用 `get()` 时才创建实例，之后一直复用自己那份。既线程安全，又避免了每次调用都 new 一个的开销。

顺带一提，如果项目已经用上 Java 8 的时间 API，`DateTimeFormatter` 本身就是不可变、线程安全的，新代码建议直接用它，不需要再绕 ThreadLocal。

### 场景三：日志 traceId 传递

排查问题时，希望一次请求打印的所有日志都带上同一个标识，方便 grep。日志框架的 MDC 就是干这个的，底层同样基于 ThreadLocal。

过滤器里生成 traceId：

```java
public class TraceIdFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        try {
            MDC.put("traceId", UUID.randomUUID().toString().replace("-", ""));
            chain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }
}
```

logback 的 pattern 里引用：

```text
%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%X{traceId}] %-5level %logger{36} - %msg%n
```

之后这次请求的每一行日志都会带上 traceId：

```text
2022-03-27 14:32:01.482 [http-nio-8080-exec-3] [e3a1f...] INFO  c.e.order.OrderService - 创建订单开始
2022-03-27 14:32:01.573 [http-nio-8080-exec-3] [e3a1f...] INFO  c.e.order.OrderService - 库存校验通过
```

图：MDC traceId 日志输出效果截图

![](images/2026/07/24/threadlocal-mdc-traceid-log-placeholder.png)

### 场景四：框架里的 ThreadLocal

很多框架的“线程绑定”能力都是 ThreadLocal 实现的，平时感知不到，但排查问题时知道这一层很有用：

1. Spring 的 `RequestContextHolder`：任意位置拿到当前请求的 `HttpServletRequest`；
2. Spring 事务的 `TransactionSynchronizationManager`：把数据库连接绑定到当前线程，保证同一个事务里的多次数据库操作用的是同一个连接；
3. MyBatis-Spring 的 `SqlSessionHolder`：配合 Spring 事务管理 SqlSession 的生命周期。

所以“事务方法里开新线程执行数据库操作，事务不生效”这类问题，根源就是新线程拿不到绑定在原线程上的连接。

## 底层结构：ThreadLocalMap

用好 ThreadLocal，需要知道数据到底存在哪。

很多人的第一直觉是：ThreadLocal 内部维护一个 `Map<Thread, Object>`。实际设计恰好相反，Map 挂在线程上，而不是挂在 ThreadLocal 上：

```java
public class Thread implements Runnable {
    ThreadLocal.ThreadLocalMap threadLocals = null;
}
```

每个 Thread 对象里有一个 `threadLocals` 字段，类型是 `ThreadLocal.ThreadLocalMap`。这个 Map 的 key 是 ThreadLocal 对象本身，value 是存的值。

`set` 和 `get` 的流程：

```text
threadLocal.set(value)
-> 拿到当前线程 Thread.currentThread()
-> 取出线程自己的 threadLocals
-> 以 threadLocal 对象为 key，存入 value

threadLocal.get()
-> 拿到当前线程的 threadLocals
-> 以 threadLocal 对象为 key 查找 Entry
-> 返回 Entry 里的 value
```

数据存在线程自己身上，天然隔离，读写全程不需要加锁。一个线程可以有多个 ThreadLocal 变量，它们都存在这一个 ThreadLocalMap 里，互相以各自的 ThreadLocal 对象作为 key 区分。

ThreadLocalMap 是一个定制的哈希表，和 HashMap 有两个明显区别：

1. 哈希冲突不用链表，而是开放寻址，冲突了就顺着数组往后找空位；
2. Entry 的 key 是弱引用。

第二点是理解内存泄漏的关键。

## 为什么 key 是弱引用

Entry 的定义：

```java
static class Entry extends WeakReference<ThreadLocal<?>> {
    Object value;

    Entry(ThreadLocal<?> k, Object v) {
        super(k);
        value = v;
    }
}
```

Entry 继承了 `WeakReference<ThreadLocal<?>>`，也就是说 Entry 对 key（ThreadLocal 对象）是弱引用，对 value 是强引用。

弱引用的特点：垃圾回收时，只被弱引用指向的对象会被直接回收。

设计成弱引用是为了处理这种情况：某个 ThreadLocal 变量在业务上已经没人用了（比如它所属的对象被回收了），如果 Entry 强引用着它，只要线程活着，这个 ThreadLocal 对象就永远无法回收。改成弱引用后，外部强引用断掉，下次 GC 就能把 ThreadLocal 对象本身回收掉。

但这里只解决了 key 的回收，value 的麻烦才刚开始。

## 内存泄漏是怎么发生的

key 被 GC 回收后，Entry 变成了 key 为 null 的“脏 Entry”，但 value 还被 Entry 强引用着。整条引用链是：

```text
Thread（线程还活着）
-> threadLocals（ThreadLocalMap）
-> Entry 数组
-> Entry（key 已被回收，变成 null）
-> value（依然被强引用，无法回收）
```

图：Thread、ThreadLocalMap、Entry 的引用关系图

![](images/2026/07/24/threadlocal-reference-chain-placeholder.png)

只要线程不死，value 就一直挂在引用链上，GC 拿它没办法。这就是 ThreadLocal 内存泄漏的完整成因。

两个条件缺一不可：

1. 线程长期存活。这正是线程池的默认行为，核心线程执行完任务不销毁，回池子里等下一个任务；
2. 用完没有调用 remove。脏 Entry 和 value 一直留在线程的 ThreadLocalMap 里。

JDK 其实做了补救：`set`、`get`、`remove` 的过程中探测到 key 为 null 的脏 Entry 时，会顺手清理掉（`expungeStaleEntry`）。但这个清理是“碰到才清”，如果这个线程后续再也没碰过 ThreadLocal，或者哈希位置刚好错开，脏 Entry 就一直留着。被动清理只能算兜底，不能依赖。

单个 value 不大的话，泄漏很难被察觉。怕的是 value 是个大对象，比如一次导出的数据列表。线程池 200 个线程每个挂一份，内存就这么被慢慢吃掉，最后 OOM。用 MAT 分析堆转储时，如果看到大量内存被 `ThreadLocalMap$Entry` 持有，基本就是这个问题。

图：MAT 分析 ThreadLocalMap 占用内存的截图

![](images/2026/07/24/threadlocal-mat-analysis-placeholder.png)

## 比内存泄漏更常见的问题：脏数据

实际工作中，ThreadLocal 出问题的第一现场往往不是 OOM，而是引言里那种“数据串了”。

回到那个 Bug。项目早期的拦截器是这么写的，只有 set，没有 remove：

```java
@Override
public boolean preHandle(HttpServletRequest request,
                         HttpServletResponse response,
                         Object handler) {
    String token = request.getHeader("Authorization");
    UserInfo userInfo = tokenService.parseToken(token);
    if (userInfo != null) {
        UserContextHolder.set(userInfo);
    }
    return true;
}
```

Tomcat 的工作线程是线程池，请求结束后线程回收复用。于是：

```text
请求 1（用户 A）分配到线程 exec-3
-> 拦截器 set 了 A 的用户信息
-> 请求结束，线程 exec-3 回到线程池，ThreadLocal 里还留着 A

请求 2（用户 B，token 过期）分配到线程 exec-3
-> parseToken 返回 null，没有走 set
-> 业务代码 UserContextHolder.get() 拿到的是 A 的信息
-> B 看到了 A 的数据
```

图：线程复用导致用户信息串号的时序示意图

![](images/2026/07/24/threadlocal-dirty-data-log-placeholder.png)

为什么“复现不稳定”也解释得通：只有“上一个请求写入过、当前请求恰好没覆盖、还刚好复用到同一个线程”三个条件同时满足才会出现。测试环境请求少、线程复用频繁，反而偶尔能撞上。

脏数据和内存泄漏是同一个根源的两种表现：

```text
用完不 remove + 线程复用
-> value 一直留在线程上          -> 内存泄漏
-> 下一个任务读到上一个任务的值   -> 脏数据
```

严格来说脏数据更危险，内存泄漏是慢性病，脏数据是越权事故。

## 正确使用姿势

### 用完必须 remove，放在 finally 里

这是最重要的一条。凡是 set 过，就要保证请求或任务结束时 remove：

```java
public void handle(Task task) {
    TASK_CONTEXT.set(task.getContext());
    try {
        doHandle(task);
    } finally {
        TASK_CONTEXT.remove();
    }
}
```

Web 场景下，set 和 remove 分散在拦截器的两个方法里，要选对清理位置：

1. 拦截器：`afterCompletion` 里 remove，这个方法在请求完成后一定会执行，包括抛异常的情况；
2. 过滤器：`finally` 里 remove；
3. 自己提交到线程池的任务：任务代码里 `try/finally`。

### 声明成 private static final

```java
private static final ThreadLocal<UserInfo> USER_CONTEXT = new ThreadLocal<>();
```

ThreadLocal 实例本身就该是全局唯一的“坑位”，声明成静态常量，避免重复创建，也减少 key 被回收产生脏 Entry 的机会。注意 static 修饰的是 ThreadLocal 对象这个“钥匙”，每个线程的 value 副本依然是隔离的，不会因为 static 变成共享。

### 别往里放大对象

ThreadLocal 适合放用户身份、traceId、日期格式化器这类小对象。放大列表、大 Map 之前想一下：这个线程池有多少个线程，每个线程挂一份是多少内存。

## 父子线程传递：InheritableThreadLocal 和它的坑

ThreadLocal 只在当前线程内可见，业务里却经常有这种需求：主线程接了请求，异步开线程发通知，异步逻辑里也想拿到用户信息。

JDK 提供了 `InheritableThreadLocal`：创建子线程时，父线程的值会拷贝给子线程。

```java
private static final InheritableThreadLocal<String> CONTEXT = new InheritableThreadLocal<>();

public static void main(String[] args) {
    CONTEXT.set("主线程的数据");
    new Thread(() -> System.out.println("子线程读到：" + CONTEXT.get())).start();
}
```

```text
子线程读到：主线程的数据
```

但它有个致命限制：值的拷贝发生在 `new Thread()` 的时刻，仅此一次。配合线程池时，线程是提前创建、反复复用的，后续提交任务时根本不会有新线程创建，拷贝也就不会发生：

```text
线程池线程在启动时创建，拷贝了当时主线程的值（可能是空）
之后提交的任务复用这些线程
-> 拿到的要么是空，要么是线程创建那一刻的旧值
-> InheritableThreadLocal 在线程池下基本不可用
```

线程池场景要用阿里开源的 [TransmittableThreadLocal](https://github.com/alibaba/transmittable-thread-local)，它把值的传递时机从“线程创建时”改成了“任务提交时”：

```xml
<dependency>
    <groupId>com.alibaba</groupId>
    <artifactId>transmittable-thread-local</artifactId>
    <version>2.12.6</version>
</dependency>
```

```java
private static final TransmittableThreadLocal<String> CONTEXT = new TransmittableThreadLocal<>();

ExecutorService executor = TtlExecutors.getTtlExecutorService(
        Executors.newFixedThreadPool(4));

CONTEXT.set("用户 A 的上下文");
executor.execute(() -> {
    System.out.println("线程池任务读到：" + CONTEXT.get());
});
```

用 `TtlExecutors` 包装线程池后，每次提交任务都会捕获提交时刻的上下文，在任务执行时回放，执行完再恢复。跨线程传 traceId、用户信息，这是目前比较标准的做法。

## 常见误区

### 误区一：用了 ThreadLocal 就会内存泄漏

不准确。泄漏需要“线程长活 + 用完不 remove”两个条件同时成立。普通 new 出来的线程执行完就销毁，ThreadLocalMap 跟着整个线程对象一起回收，谈不上泄漏。规范地在 finally 里 remove，线程池场景也不会有问题。

### 误区二：弱引用是为了防止 value 泄漏

方向反了。弱引用防的是 ThreadLocal 对象（key）本身无法回收，value 恰恰因为 Entry 的强引用而成为泄漏的主角。弱引用只是把“ThreadLocal 对象泄漏”降级成了“value 泄漏 + 可被动清理”，最终的清理责任还是在使用者的 remove 上。

### 误区三：用 ThreadLocal 在线程之间共享数据

ThreadLocal 的设计目标是线程隔离，恰好和共享相反。需要多线程共享可变数据，该用的是并发容器或者锁；需要父子线程、线程池传递上下文，用 TransmittableThreadLocal。拿着隔离工具做共享的事，方向就错了。

### 误区四：remove 了会影响其他线程

不会。remove 只删除当前线程 ThreadLocalMap 里的那个 Entry，其他线程的副本互不影响。可以放心在任务结束时清理。

## 总结

ThreadLocal 的核心逻辑串起来其实不长：

```text
数据存在 Thread 自己的 ThreadLocalMap 里，key 是 ThreadLocal 对象
-> 天然线程隔离，不需要加锁
-> Entry 对 key 是弱引用，对 value 是强引用
-> key 可以被 GC，value 必须靠 remove 清理
-> 线程池线程长期存活
-> 不 remove：轻则内存泄漏，重则脏数据串号
```

使用上记住四条：

1. 声明成 `private static final`；
2. set 过就要 remove，放在 finally 或 afterCompletion 里；
3. 不放大对象；
4. 线程池间传递上下文用 TransmittableThreadLocal，别用 InheritableThreadLocal。

ThreadLocal 本身设计得很精巧，出问题的从来不是它，而是“线程会被复用”这件事没有进入使用者的心智。写代码时默认自己的代码跑在线程池里，很多坑自然就绕开了。
