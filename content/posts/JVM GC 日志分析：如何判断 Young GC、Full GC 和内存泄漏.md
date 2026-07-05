---
title: JVM GC 日志分析：如何判断 Young GC、Full GC 和内存泄漏
slug: jvm-gc-log-analysis-young-gc-full-gc-memory-leak
date: 2023-03-28
category: 原理
tags:
  - JVM
  - GC
  - Java
  - 性能分析
  - 内存调优
description: GC 日志是判断 Java 服务内存是否健康的重要依据。内容围绕 Young GC、Mixed GC、Full GC、老年代增长、晋升失败、Humongous 对象、停顿时间和内存泄漏风险展开，整理一套适合后端开发日常排查的 GC 日志分析思路。
cover:
published: true
---

## 先看一段现象

线上 Java 服务偶尔会出现接口毛刺。

平时接口耗时 50ms 左右，但某些时间点会突然跳到 1 秒甚至 3 秒。应用日志里没有明显异常，数据库也没有慢 SQL，CPU 看起来也不高。

这时很容易忽略一个方向：GC 停顿。

如果 JVM 在某个时刻发生 Stop-The-World，业务线程会暂停，接口自然会抖动。GC 日志就是判断这类问题的关键线索。

JDK GC 日志相关参数可以查看 Oracle 官方文档：[Java Unified Logging](https://docs.oracle.com/en/java/javase/21/docs/specs/man/java.html#enable-logging-with-the-jvm-unified-logging-framework)。JDK 9 以后统一使用 `-Xlog`，JDK 8 还是老参数。

## 先把 GC 日志打开

没有日志就只能猜。

### JDK 17 常用配置

```bash
-Xms2g \
-Xmx2g \
-XX:+UseG1GC \
-Xlog:gc*:file=/data/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=100m
```

这几个参数分别表示：

```text
-Xms2g：初始堆大小
-Xmx2g：最大堆大小
-XX:+UseG1GC：使用 G1 垃圾收集器
-Xlog:gc*：输出 GC 相关日志
filecount=5：最多保留 5 个日志文件
filesize=100m：单个日志文件最大 100MB
```

### JDK 8 常用配置

```bash
-Xms2g \
-Xmx2g \
-XX:+UseG1GC \
-XX:+PrintGCDetails \
-XX:+PrintGCDateStamps \
-XX:+PrintGCTimeStamps \
-Xloggc:/data/logs/gc.log
```

如果是生产环境，建议配置日志滚动，避免 GC 日志无限增长打满磁盘。

图：JDK 17 GC 日志启动参数截图

![](images/2026/07/05/jvm-gc-xlog-startup-params-placeholder.png)

## 一条 Young GC 日志怎么读

先看一条 G1 的 Young GC 日志：

```text
[2026-07-05T10:12:01.123+0800][120.456s][info][gc,start] GC(12) Pause Young (Normal) (G1 Evacuation Pause)
[2026-07-05T10:12:01.130+0800][120.463s][info][gc,heap ] GC(12) Eden regions: 128->0(130)
[2026-07-05T10:12:01.130+0800][120.463s][info][gc,heap ] GC(12) Survivor regions: 8->10(16)
[2026-07-05T10:12:01.130+0800][120.463s][info][gc,heap ] GC(12) Old regions: 64->66
[2026-07-05T10:12:01.130+0800][120.463s][info][gc      ] GC(12) Pause Young (Normal) (G1 Evacuation Pause) 800M->420M(2048M) 7.321ms
```

先看最后一行：

```text
800M->420M(2048M) 7.321ms
```

含义是：

```text
GC 前堆使用 800M
GC 后堆使用 420M
堆总大小 2048M
本次停顿 7.321ms
```

这一条看起来比较健康：回收后堆下降明显，停顿时间也不长。

再看 region 变化：

```text
Eden regions: 128->0
Survivor regions: 8->10
Old regions: 64->66
```

含义是：

```text
Eden 被清空
部分对象进入 Survivor
部分对象晋升到 Old
```

Young GC 主要回收年轻代对象。如果大部分对象朝生夕死，Young GC 后内存应该明显下降。

图：G1 Young GC 日志片段截图

![](images/2026/07/05/g1-young-gc-log-snippet-placeholder.png)

## Young GC 频繁说明什么

Young GC 本身不是问题。Java 服务运行时创建对象，Eden 满了就触发 Young GC，很正常。

需要关注的是频率和停顿时间。

### 正常情况

```text
Young GC 每隔几秒或几十秒发生
单次停顿几毫秒到几十毫秒
GC 后堆使用明显下降
老年代缓慢增长或基本稳定
```

### 异常情况

```text
Young GC 每秒多次
单次停顿时间明显变长
Survivor 放不下，大量对象晋升老年代
老年代持续上涨
```

频繁 Young GC 常见原因：

- 瞬时流量增大；
- 接口创建大量临时对象；
- 大批量 JSON 序列化；
- 一次性查询大量数据；
- 日志拼接过多；
- 缓冲区或集合频繁创建；
- 年轻代太小。

如果 Young GC 很频繁，但每次都能快速回收，而且接口没有明显毛刺，优先观察即可。

如果 Young GC 频繁且老年代也增长，就要警惕对象存活时间过长。

## Full GC 日志最需要警惕

Full GC 通常比 Young GC 更重，停顿时间也更长。

示例：

```text
[2026-07-05T10:20:10.001+0800][609.100s][info][gc,start] GC(45) Pause Full (G1 Compaction Pause)
[2026-07-05T10:20:12.901+0800][612.000s][info][gc      ] GC(45) Pause Full (G1 Compaction Pause) 1900M->1850M(2048M) 2899.521ms
```

这条日志很危险。

重点看：

```text
1900M->1850M
2899.521ms
```

含义是：

```text
Full GC 前使用 1900M
Full GC 后还有 1850M
停顿接近 2.9 秒
```

Full GC 后只回收了 50M，说明堆里大部分对象仍然存活。

如果这种日志连续出现，就要警惕内存泄漏或长期持有大量对象。

图：Full GC 后内存下降不明显的日志截图

![](images/2026/07/05/full-gc-low-reclaim-log-placeholder.png)

## 一眼判断 GC 是否健康

看 GC 日志时，可以先问几个问题。

### 1. GC 后内存有没有下降？

健康：

```text
1200M->400M
```

不健康：

```text
1900M->1850M
```

回收不动说明对象仍然被引用。

### 2. Full GC 是否频繁？

偶发 Full GC 不一定是大问题。

如果几分钟一次，甚至几十秒一次，就要重点排查。

### 3. 停顿时间是否影响接口？

如果业务要求 P99 低于 200ms，但 GC 停顿经常 500ms，就会造成明显毛刺。

### 4. 老年代是否持续上涨？

老年代持续上涨，且 Full GC 后下降不明显，是内存泄漏风险信号。

### 5. 是否出现晋升失败或分配失败？

关键字包括：

```text
to-space exhausted
Promotion failed
Allocation Failure
Evacuation Failure
```

这些通常意味着内存压力已经比较大。

## G1 Mixed GC 怎么看

G1 不只是 Young GC 和 Full GC，它还有 Mixed GC。

Mixed GC 会同时回收年轻代和部分老年代 region。

日志示例：

```text
[info][gc,start] GC(30) Pause Young (Mixed) (G1 Evacuation Pause)
[info][gc,heap ] GC(30) Eden regions: 96->0(100)
[info][gc,heap ] GC(30) Survivor regions: 12->10(16)
[info][gc,heap ] GC(30) Old regions: 420->390
[info][gc      ] GC(30) Pause Young (Mixed) (G1 Evacuation Pause) 1500M->980M(2048M) 45.123ms
```

这里 `Old regions: 420->390` 表示老年代也被回收了一部分。

Mixed GC 是 G1 控制老年代增长的重要手段。

如果 Mixed GC 后老年代能下降，说明 G1 正常工作。

如果 Mixed GC 频繁但老年代仍然持续增长，就要继续排查对象引用。

图：G1 Mixed GC Old regions 变化截图

![](images/2026/07/05/g1-mixed-gc-old-regions-placeholder.png)

## Humongous 对象是什么

G1 中有一种特殊对象叫 Humongous Object。

当对象大小超过一个 region 的 50%，就会被认为是大对象。

日志中可能看到：

```text
Humongous regions: 20->18
```

大对象常见来源：

- 大 byte 数组；
- 大字符串；
- 大 JSON；
- 一次性读取大文件；
- 大集合转数组；
- 图片、Excel、压缩包处理。

如果 Humongous region 很多，可能导致堆空间碎片化，甚至触发 Full GC。

常见优化：

```text
文件分块处理
分页查询数据
流式生成 Excel
限制上传文件大小
避免一次性构造巨大字符串
```

图：G1 Humongous regions 日志截图

![](images/2026/07/05/g1-humongous-regions-log-placeholder.png)

## 老年代持续上涨怎么判断

单看一条 GC 日志不够，要看趋势。

例如多次 GC 后老年代变化：

```text
Old: 600M
Old: 750M
Old: 900M
Old: 1100M
Old: 1300M
Full GC 后 Old: 1280M
```

这种趋势就很危险。

健康的服务通常是：

```text
Old 上涨一段时间
-> Mixed GC 或 Full GC 后下降
-> 在某个区间内波动
```

不健康的趋势是：

```text
Old 持续上涨
-> Full GC 后下降很少
-> 很快再次上涨
-> 最终 OOM
```

可能原因：

- 本地缓存没有上限；
- 静态 Map 持有对象；
- 线程池队列堆积任务；
- ThreadLocal 未清理；
- 大集合长期引用；
- 连接或监听器未释放；
- 类加载器泄漏。

图：老年代使用率持续上涨监控截图

![](images/2026/07/05/jvm-old-gen-continuous-growth-placeholder.png)

## 用 jstat 辅助判断

GC 日志适合事后分析，`jstat` 适合现场观察。

```bash
jstat -gcutil <pid> 1000 10
```

输出示例：

```text
  S0     S1     E      O      M     CCS    YGC   YGCT    FGC   FGCT     GCT
  0.00  80.10  45.32  70.20  78.11  70.20  120   2.31     1    0.80    3.11
  0.00  80.10  88.90  70.20  78.11  70.20  120   2.31     1    0.80    3.11
  0.00  75.30  10.12  72.10  78.11  70.20  121   2.35     1    0.80    3.15
```

重点字段：

| 字段 | 含义 |
| --- | --- |
| E | Eden 使用率 |
| O | 老年代使用率 |
| M | Metaspace 使用率 |
| YGC | Young GC 次数 |
| YGCT | Young GC 总耗时 |
| FGC | Full GC 次数 |
| FGCT | Full GC 总耗时 |
| GCT | GC 总耗时 |

如果 `O` 持续上涨，`FGC` 增加后也降不下来，就要结合 heap dump 分析。

图：jstat -gcutil 老年代上涨截图

![](images/2026/07/05/jstat-gcutil-old-gen-growth-placeholder.png)

## 一个接口毛刺的判断过程

假设监控显示某个时间点接口 P99 抖动到 2 秒。

先找到对应时间点 GC 日志：

```text
[2026-07-05T10:32:15.100+0800][1800.100s][info][gc,start] GC(88) Pause Full (G1 Compaction Pause)
[2026-07-05T10:32:17.350+0800][1802.350s][info][gc      ] GC(88) Pause Full (G1 Compaction Pause) 1800M->1200M(2048M) 2250.000ms
```

这说明 10:32:15 左右发生了一次 2.25 秒的 Full GC。

如果接口毛刺时间和 GC 停顿时间重合，就可以初步判断：接口抖动和 STW 有关。

然后继续看前后几分钟：

```text
是否频繁 Full GC
老年代是否持续上涨
是否有 Humongous 对象增加
是否有 Allocation Failure
是否有业务大流量或定时任务
```

如果只发生一次，可能是某个定时任务或临时大对象。

如果持续发生，就要排查内存泄漏或堆配置不合理。

## Allocation Failure 不一定是坏事

有些 GC 日志里会看到：

```text
Pause Young (Allocation Failure)
```

这并不一定是异常。

它通常表示 Eden 区没有足够空间分配新对象，于是触发 Young GC。

需要看结果：

健康：

```text
Allocation Failure
800M->300M
停顿 10ms
```

不健康：

```text
Allocation Failure
1900M->1850M
随后 Full GC
```

所以不要看到 `Allocation Failure` 就慌，关键是看 GC 后回收效果和停顿时间。

## Metaspace 也要看

如果日志中出现：

```text
java.lang.OutOfMemoryError: Metaspace
```

或者 `jstat` 中 M 持续上涨，就要关注元空间。

常见原因：

- 动态生成大量类；
- CGLIB 代理类过多；
- Groovy 脚本动态加载；
- 自定义 ClassLoader 没释放；
- 热部署工具导致类加载器泄漏。

参数：

```bash
-XX:MetaspaceSize=256m
-XX:MaxMetaspaceSize=512m
```

不要只调大 MaxMetaspaceSize。持续上涨说明类或类加载器可能没有释放。

图：jstat Metaspace 使用率截图

![](images/2026/07/05/jstat-metaspace-usage-placeholder.png)

## GC 日志工具

手工看日志可以训练判断能力，但日志多了之后，建议使用工具。

常见工具：

- [GCeasy](https://gceasy.io/)：在线分析 GC 日志；
- [GCViewer](https://github.com/chewiebug/GCViewer)：本地查看 GC 曲线；
- [JDK Mission Control](https://www.oracle.com/java/technologies/jdk-mission-control.html)：JFR 和运行时分析；
- [VisualVM](https://visualvm.github.io/)：本地分析 JVM 运行状态。

上传 GC 日志后，可以快速看到：

```text
GC 次数
GC 总耗时
吞吐量
最大停顿
平均停顿
堆使用趋势
Full GC 时间点
内存回收效果
```

图：GCeasy GC Pause Time 分析截图

![](images/2026/07/05/gceasy-gc-pause-time-placeholder.png)

## 常见优化方向

### 1. 减少临时对象

例如循环中频繁创建大对象：

```java
for (Order order : orders) {
    // 每次循环都创建一个很大的临时 Map，数据量大时会加重 GC 压力
    Map<String, Object> context = new HashMap<>();
    context.put("order", order);
    context.put("items", order.getItems());
    render(context);
}
```

可以复用对象、缩小作用域、减少不必要的中间集合。

### 2. 大数据分页处理

不要一次性加载几十万条数据。

```java
int pageSize = 1000;
Long lastId = 0L;

while (true) {
    // 每批只处理 1000 条，避免一次性把所有数据放进堆内存
    List<Order> orders = orderMapper.queryAfterId(lastId, pageSize);
    if (orders.isEmpty()) {
        break;
    }

    handleOrders(orders);
    lastId = orders.get(orders.size() - 1).getId();
}
```

### 3. 本地缓存加上限

不要使用无界 Map：

```java
private static final Map<String, Object> CACHE = new ConcurrentHashMap<>();
```

更推荐 Caffeine：

```java
Cache<String, Object> cache = Caffeine.newBuilder()
        // 限制最大缓存数量，避免缓存无限增长
        .maximumSize(10_000)
        // 设置过期时间，避免长期持有冷数据
        .expireAfterWrite(30, TimeUnit.MINUTES)
        .build();
```

Caffeine 项目地址：[Caffeine](https://github.com/ben-manes/caffeine)。

### 4. 控制线程池队列

无界队列会堆积任务对象。

```java
new LinkedBlockingQueue<>()
```

更推荐有界队列：

```java
new ArrayBlockingQueue<>(1000)
```

队列堆积不仅影响任务延迟，也会增加堆内存占用。

### 5. 合理设置堆大小

堆太小，GC 频繁；堆太大，单次 GC 停顿可能变长。

生产环境常见做法：

```bash
-Xms 和 -Xmx 设置相同
```

例如：

```bash
-Xms2g -Xmx2g
```

容器环境不要把堆设置得等于容器内存上限，要给 Metaspace、Direct Memory、线程栈等留空间。

## 什么时候需要 heap dump

如果 GC 日志显示：

```text
老年代持续上涨
Full GC 后下降不明显
GC 越来越频繁
最终接近 OOM
```

就需要 heap dump 分析对象引用。

建议默认配置：

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/dump
```

服务还没 OOM 但内存已经异常时，可以手动导出：

```bash
jmap -dump:format=b,file=/data/dump/app.hprof <pid>
```

注意：导出 heap dump 可能造成应用暂停，线上执行前要评估影响。

分析工具可以用 Eclipse MAT：[Eclipse Memory Analyzer](https://eclipse.dev/mat/)。

图：MAT Dominator Tree 中大对象占用截图

![](images/2026/07/05/mat-dominator-tree-large-object-placeholder.png)

## 一份 GC 日志检查清单

拿到 GC 日志后，可以按这个顺序看：

```text
1. 使用的收集器是什么
2. Young GC 是否频繁
3. 单次 Young GC 停顿多久
4. Full GC 是否出现
5. Full GC 后内存下降是否明显
6. 老年代是否持续上涨
7. 是否有 Mixed GC 回收老年代
8. 是否有 Humongous 对象
9. 是否有 to-space exhausted / Promotion failed
10. GC 时间点是否和接口毛刺重合
11. Metaspace 是否持续上涨
12. 是否需要 heap dump 进一步分析
```

如果只有一两个指标异常，不一定马上调参。先结合业务流量、发布记录、定时任务和接口耗时一起看。

## 收尾

GC 日志分析的重点不是背每个字段，而是建立判断思路。

几个信号尤其重要：

```text
Young GC 频繁但回收好，通常问题不大
Full GC 频繁，需要重点关注
Full GC 后内存下降很少，要警惕内存泄漏
老年代持续上涨，是危险趋势
Humongous 对象多，要排查大对象分配
GC 停顿和接口毛刺重合，说明 STW 影响业务
```

JVM 调优不要一上来就改参数。先看 GC 日志，再看监控趋势，必要时导出 heap dump，最后再决定是改代码、调堆大小，还是调整 GC 参数。

真正稳定的 Java 服务，应该做到：

```text
GC 日志长期保留
接口耗时有监控
老年代趋势可观察
Full GC 有告警
OOM 自动导出 dump
大对象和缓存有边界
```

这样遇到内存问题时，排查才不会只剩“重启试试”。
