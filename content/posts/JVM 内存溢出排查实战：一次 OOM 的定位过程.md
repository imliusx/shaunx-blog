---
title: JVM 内存溢出排查实战：一次 OOM 的定位过程
slug: jvm-out-of-memory-troubleshooting-practice
date: 2026-07-04
category: 运维
tags:
  - JVM
  - Java
  - OOM
  - 内存溢出
  - 线上排查
description: Java 服务出现 OutOfMemoryError 时，不能只靠重启解决问题。内容围绕一次 JVM 内存溢出排查过程，梳理常见 OOM 类型、堆内存分析、线程栈排查、GC 日志观察、MAT 工具使用和线上应急处理思路。
cover:
published: true
---

## 引言

Java 服务在线上运行久了，偶尔会遇到一些比较棘手的问题：接口越来越慢、Pod 频繁重启、机器内存持续上涨、日志里突然出现 `OutOfMemoryError`。

很多时候，第一反应是重启服务。重启确实能让服务暂时恢复，但如果没有定位根因，问题很可能还会再次出现。

JVM 内存溢出排查的关键，不是看到 OOM 就盲目调大内存，而是要回答几个问题：

- 哪个内存区域溢出了？
- 是瞬时流量导致，还是对象长期无法释放？
- 是堆内存问题，还是线程、元空间、直接内存问题？
- 哪些对象占用了最多内存？
- 代码中是否存在缓存、集合、线程池、连接未释放等问题？

下面用一次比较典型的排查过程，梳理 JVM OOM 的定位思路。

## 问题背景

某个后台服务主要负责订单数据导出。平时运行正常，但在导出大时间范围订单时，服务偶尔会重启。

现象如下：

1. 接口响应越来越慢；
2. 应用内存持续升高；
3. 过一段时间后服务重启；
4. 日志中出现 `java.lang.OutOfMemoryError: Java heap space`；
5. 重启后短时间恢复，继续导出大数据量时再次复现。

日志片段类似：

```text
java.lang.OutOfMemoryError: Java heap space
    at java.base/java.util.Arrays.copyOf(Arrays.java:3512)
    at java.base/java.util.ArrayList.grow(ArrayList.java:237)
    at java.base/java.util.ArrayList.add(ArrayList.java:467)
    at com.example.order.service.OrderExportService.export(OrderExportService.java:88)
```

初步判断：这是一个堆内存溢出问题，并且和订单导出逻辑有关。

图：JVM OOM 排查流程

![](images/2026/07/04/jvm-oom-troubleshooting-flow-placeholder.png)

## 常见 OOM 类型

`OutOfMemoryError` 不是单一问题，不同报错信息对应不同内存区域。

### Java heap space

最常见的堆内存溢出。

```text
java.lang.OutOfMemoryError: Java heap space
```

常见原因：

- 一次性加载过多数据；
- 大集合持续增长；
- 本地缓存没有淘汰；
- 对象被错误引用，无法 GC；
- 大对象频繁创建；
- 堆内存配置过小。

### GC overhead limit exceeded

```text
java.lang.OutOfMemoryError: GC overhead limit exceeded
```

表示 JVM 花了大量时间做 GC，但回收效果很差。通常说明堆内存已经接近耗尽，GC 一直在努力回收但释放不出足够空间。

### Metaspace

```text
java.lang.OutOfMemoryError: Metaspace
```

元空间溢出，常见原因：

- 动态生成大量类；
- 频繁创建 ClassLoader；
- CGLIB、Javassist、Groovy 等动态类过多；
- 热部署或插件化场景中类加载器未释放。

### Direct buffer memory

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

直接内存溢出，常见于 NIO、Netty、文件 IO 等场景。

常见原因：

- 直接内存配置过小；
- ByteBuffer 未及时释放；
- Netty 堆外内存使用不当；
- 大文件读写没有分块处理。

### unable to create native thread

```text
java.lang.OutOfMemoryError: unable to create native thread
```

表示 JVM 无法继续创建新的本地线程。

常见原因：

- 线程池配置过大；
- 代码中不断创建线程；
- 操作系统线程数限制；
- 容器资源限制；
- 单线程栈内存配置过大。

### Requested array size exceeds VM limit

```text
java.lang.OutOfMemoryError: Requested array size exceeds VM limit
```

表示尝试创建的数组过大，超过 JVM 支持范围。常见于一次性读取大文件、大结果集或错误计算集合容量。

## 第一步：确认 OOM 类型

排查时先看完整异常信息。

如果是：

```text
Java heap space
```

优先分析堆内存和对象占用。

如果是：

```text
Metaspace
```

重点关注类加载和动态代理。

如果是：

```text
Direct buffer memory
```

重点关注堆外内存、Netty、NIO。

如果是：

```text
unable to create native thread
```

重点关注线程数量和系统限制。

这次问题明确是：

```text
java.lang.OutOfMemoryError: Java heap space
```

所以排查重点放在堆内存。

## 第二步：保留现场

线上 OOM 最忌讳的是只重启，不保留现场。

至少要保留：

1. 应用日志；
2. GC 日志；
3. 堆转储文件；
4. 线程栈；
5. 监控数据；
6. 当时的请求参数和业务操作记录。

### 开启堆转储

建议 Java 服务默认加上下面几个参数：

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/dump
```

这样发生 OOM 时，JVM 会自动生成 heap dump 文件。

也可以配置退出行为：

```bash
-XX:+ExitOnOutOfMemoryError
```

容器环境中，服务退出后可以由 Kubernetes 或进程管理工具自动拉起。

JDK 工具文档可以在 Oracle 官方文档中查看：[JDK Tools and Utilities](https://docs.oracle.com/en/java/javase/21/docs/specs/man/index.html)。

### 手动导出堆内存

如果服务还没崩，可以手动导出：

```bash
jps -l
jmap -dump:format=b,file=/data/dump/app.hprof <pid>
```

注意：`jmap -dump` 可能造成应用短暂停顿，线上执行前要评估影响。

### 导出线程栈

```bash
jstack <pid> > /data/dump/app.jstack
```

也可以连续导出几次：

```bash
jstack <pid> > jstack-1.log
sleep 3
jstack <pid> > jstack-2.log
sleep 3
jstack <pid> > jstack-3.log
```

连续线程栈更容易看出线程是否卡在同一位置。

## 第三步：观察内存变化

如果服务还在运行，可以先用 `jstat` 观察 GC 和堆内存变化。

```bash
jstat -gcutil <pid> 1000 10
```

输出类似：

```text
  S0     S1     E      O      M     CCS    YGC   YGCT    FGC   FGCT     GCT
  0.00  80.21  95.32  98.76  78.11  70.20  120   2.31     8   12.45   14.76
```

重点关注：

| 指标 | 含义 |
| --- | --- |
| E | Eden 区使用率 |
| O | 老年代使用率 |
| M | Metaspace 使用率 |
| YGC | Young GC 次数 |
| FGC | Full GC 次数 |
| GCT | GC 总耗时 |

如果老年代使用率持续升高，Full GC 后也降不下来，大概率存在对象长期存活或内存泄漏。

图：JVM 堆内存变化趋势

![](images/2026/07/04/jvm-heap-memory-trend-placeholder.png)

## 第四步：分析堆转储

堆转储文件一般比较大，可以下载到本地用 MAT 分析。

MAT 是 Eclipse Memory Analyzer，适合分析 Java heap dump。工具地址：[Eclipse Memory Analyzer](https://eclipse.dev/mat/)。

打开 `.hprof` 文件后，优先看几个视图。

### Leak Suspects

MAT 会自动分析可疑内存泄漏点。

这个报告不一定百分百准确，但很适合作为入口。

重点看：

- 哪些对象占用内存最多；
- 是否有大集合；
- 对象被谁引用；
- GC Roots 引用链；
- 是否存在业务类对象异常堆积。

### Dominator Tree

Dominator Tree 可以看到对象的支配关系和 Retained Heap。

常见字段：

| 字段 | 含义 |
| --- | --- |
| Shallow Heap | 对象自身占用内存 |
| Retained Heap | 对象被回收后能释放的总内存 |
| Percentage | 占总堆比例 |

如果某个 `ArrayList`、`HashMap`、`byte[]`、业务 DTO 占比特别高，就要重点排查。

### Histogram

Histogram 可以按类统计对象数量和内存占用。

例如看到：

```text
com.example.order.dto.OrderExportDTO    2000000 instances
java.util.ArrayList                     10000 instances
byte[]                                  500000 instances
```

就要结合业务逻辑判断是否合理。

图：MAT Dominator Tree 分析结果

![](images/2026/07/04/mat-dominator-tree-placeholder.png)

## 第五步：定位业务代码

这次堆转储中，内存占用最大的对象是：

```text
java.util.ArrayList
com.example.order.dto.OrderExportDTO
```

引用链显示这些对象来自订单导出服务：

```java
public void export(OrderExportRequest request, HttpServletResponse response) {
    List<OrderExportDTO> list = orderMapper.queryExportData(request);

    List<List<String>> rows = new ArrayList<>();
    for (OrderExportDTO order : list) {
        List<String> row = new ArrayList<>();
        row.add(order.getOrderNo());
        row.add(order.getUserName());
        row.add(order.getPhone());
        row.add(order.getAmount().toPlainString());
        row.add(order.getCreateTime().toString());
        rows.add(row);
    }

    excelWriter.write(rows, response.getOutputStream());
}
```

问题很明显：

1. 一次性查询所有订单；
2. 查询结果全部放入 `list`；
3. 又构造了一份 `rows`；
4. 写 Excel 前，所有数据都在内存里；
5. 数据量一大，堆内存很容易被打满。

这不是 JVM 参数问题，而是代码处理大数据量的方式有问题。

## 优化方案：分页查询、分批写入

导出类场景不要一次性把所有数据加载到内存。更合理的方式是分页查询、分批写入。

伪代码：

```java
public void export(OrderExportRequest request, HttpServletResponse response) {
    int pageSize = 1000;
    Long lastId = 0L;

    ExcelWriter writer = createExcelWriter(response.getOutputStream());

    while (true) {
        List<OrderExportDTO> list = orderMapper.queryExportDataByPage(request, lastId, pageSize);
        if (list.isEmpty()) {
            break;
        }

        List<List<String>> rows = convertRows(list);
        writer.write(rows);

        lastId = list.get(list.size() - 1).getId();
        list.clear();
        rows.clear();
    }

    writer.finish();
}
```

SQL 使用基于主键的游标分页：

```sql
SELECT id, order_no, user_name, phone, amount, create_time
FROM t_order
WHERE id > #{lastId}
  AND create_time >= #{startTime}
  AND create_time < #{endTime}
ORDER BY id ASC
LIMIT #{pageSize};
```

不要使用深分页：

```sql
LIMIT 100000, 1000
```

因为偏移量越大，扫描成本越高。

优化后，内存中只保留当前批次数据，堆内存曲线会稳定很多。

## 另一类常见问题：本地缓存无上限

除了大数据量导出，本地缓存无上限也是堆内存溢出的常见原因。

例如：

```java
private static final Map<String, UserInfo> USER_CACHE = new HashMap<>();

public UserInfo getUser(String token) {
    UserInfo user = USER_CACHE.get(token);
    if (user != null) {
        return user;
    }

    user = queryUserByToken(token);
    USER_CACHE.put(token, user);
    return user;
}
```

这个缓存没有容量限制，也没有过期时间。访问量越大，Map 越大，最终可能撑爆堆内存。

更推荐使用 Caffeine 这类本地缓存组件。Caffeine 地址：[Caffeine GitHub](https://github.com/ben-manes/caffeine)。

示例：

```java
Cache<String, UserInfo> cache = Caffeine.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(30, TimeUnit.MINUTES)
        .build();
```

缓存一定要有边界：

```text
容量上限
过期时间
淘汰策略
监控指标
```

## 另一类常见问题：线程创建过多

如果 OOM 是：

```text
java.lang.OutOfMemoryError: unable to create native thread
```

重点就不是堆对象，而是线程数量。

常见错误写法：

```java
for (Task task : tasks) {
    new Thread(() -> handle(task)).start();
}
```

或者线程池配置过大：

```java
Executors.newCachedThreadPool();
```

排查命令：

```bash
ps -eLf | grep java | wc -l
jstack <pid> | grep 'java.lang.Thread.State' | wc -l
```

还要检查系统限制：

```bash
ulimit -u
cat /proc/<pid>/limits
```

优化思路：

1. 使用有界线程池；
2. 控制最大线程数；
3. 设置队列容量；
4. 增加拒绝策略；
5. 避免无限创建线程；
6. 检查容器 PID 和内存限制。

## 另一类常见问题：直接内存溢出

如果 OOM 是：

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

常见于 NIO 或 Netty 场景。

直接内存可以通过参数控制：

```bash
-XX:MaxDirectMemorySize=512m
```

Netty 官方文档可以查看：[Netty Documentation](https://netty.io/wiki/)。

排查时重点看：

- 是否大量创建 DirectByteBuffer；
- Netty ByteBuf 是否释放；
- 是否存在大文件直接内存读写；
- 堆外内存限制是否过小；
- 容器内存是否包含堆外内存预算。

Netty 中如果手动处理引用计数对象，要注意释放：

```java
ReferenceCountUtil.release(msg);
```

否则堆外内存可能无法及时回收。

## GC 日志怎么看？

JVM 内存问题通常要结合 GC 日志一起看。

JDK 9+ 可以使用统一日志参数：

```bash
-Xlog:gc*:file=/data/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=100m
```

JDK 8 常见写法：

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/data/logs/gc.log
```

GC 日志重点关注：

1. Young GC 是否频繁；
2. Full GC 是否频繁；
3. Full GC 后老年代是否明显下降；
4. 单次 GC 停顿时间是否过长；
5. OOM 前是否出现连续 Full GC。

如果 Full GC 后老年代仍然很高，说明大量对象仍然被引用，不能释放。

图：GC 日志分析要点

![](images/2026/07/04/jvm-gc-log-analysis-placeholder.png)

## JVM 参数不是万能解法

很多 OOM 问题出现后，第一反应是调大堆内存：

```bash
-Xms2g -Xmx2g
```

调大内存确实可能缓解问题，但不一定解决根因。

例如订单导出一次性加载 200 万条数据，`-Xmx1g` 会 OOM，调到 `-Xmx4g` 可能暂时不 OOM，但下一次导出 500 万条还是会出问题。

JVM 参数调优应该建立在分析结果之上。

常见参数：

| 参数 | 含义 |
| --- | --- |
| `-Xms` | 初始堆大小 |
| `-Xmx` | 最大堆大小 |
| `-Xss` | 单线程栈大小 |
| `-XX:MetaspaceSize` | 元空间初始阈值 |
| `-XX:MaxMetaspaceSize` | 元空间最大值 |
| `-XX:MaxDirectMemorySize` | 最大直接内存 |
| `-XX:+HeapDumpOnOutOfMemoryError` | OOM 时导出堆转储 |
| `-XX:HeapDumpPath` | 堆转储输出路径 |

生产环境建议至少配置：

```bash
-Xms2g
-Xmx2g
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/dump
-Xlog:gc*:file=/data/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=100m
```

具体数值要结合机器规格、容器限制、业务负载和压测结果确定。

## 容器环境中的内存注意事项

现在很多 Java 服务运行在 Docker 或 Kubernetes 中。容器环境下，内存配置更要注意。

容器内存包括：

```text
Java 堆内存
Metaspace
直接内存
线程栈
JIT Code Cache
GC 额外开销
本地库内存
```

如果容器限制是 2GB，不代表 `-Xmx` 可以直接设置成 2GB。

例如：

```text
容器内存限制：2GB
建议堆内存：1.2GB ~ 1.5GB
剩余空间留给堆外、线程栈、元空间等
```

否则可能不是 JVM 抛 OOM，而是容器被系统 OOM Killer 直接杀掉。

Kubernetes 中可以通过下面命令查看 Pod 事件：

```bash
kubectl describe pod <pod-name>
```

如果看到：

```text
Reason: OOMKilled
```

说明容器超过内存限制后被杀掉了。

Docker 官方文档可以查看：[Docker Resource Constraints](https://docs.docker.com/engine/containers/resource_constraints/)。

Kubernetes 资源管理文档可以查看：[Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)。

## 线上应急处理

OOM 发生在线上时，要先恢复服务，再保留证据。

可以按下面顺序处理：

1. 确认影响范围；
2. 摘掉异常实例流量；
3. 导出 heap dump 和线程栈；
4. 保留 GC 日志和应用日志；
5. 重启或扩容恢复服务；
6. 限制触发问题的入口；
7. 分析 dump，定位代码；
8. 修复后压测验证；
9. 补充监控和告警。

如果问题由某个导出接口触发，可以先做临时限制：

- 限制最大导出时间范围；
- 限制单次导出数量；
- 改成异步导出；
- 增加导出任务排队；
- 对大客户或运营操作加审批。

## 修复后的验证

代码优化后，不要只在本地跑一次就结束。至少要验证：

1. 大数据量导出是否成功；
2. 堆内存是否保持稳定；
3. Full GC 是否明显减少；
4. 接口耗时是否可接受；
5. 数据库压力是否可控；
6. 多人同时导出是否会互相影响；
7. 异常中断后资源是否释放。

可以通过压测模拟：

```text
10 万条导出
50 万条导出
100 万条导出
多个导出任务并发
数据库慢查询场景
客户端中断下载场景
```

只要是导出、批处理、文件生成这类场景，都要特别关注内存曲线，而不是只看功能是否正确。

## 排查清单

遇到 JVM OOM，可以按下面清单排查。

### 基础信息

- OOM 类型是什么？
- 发生时间点是什么？
- 哪个接口或任务触发？
- 是否和流量高峰有关？
- 是否最近刚上线新版本？

### JVM 信息

- `-Xms` / `-Xmx` 配置多少？
- 是否开启 heap dump？
- 是否有 GC 日志？
- Full GC 是否频繁？
- 老年代是否持续上涨？

### 代码信息

- 是否一次性加载大量数据？
- 是否有无上限集合？
- 是否有本地缓存？
- 是否有大文件处理？
- 是否有线程池配置过大？
- 是否有连接、流、Buffer 未释放？

### 环境信息

- 容器内存限制多少？
- 是否被 OOMKilled？
- 系统线程数是否达到上限？
- 磁盘是否有空间保存 dump？
- 监控中内存曲线是否异常？

图：JVM OOM 排查清单

![](images/2026/07/04/jvm-oom-checklist-placeholder.png)

## 总结

JVM OOM 排查不能只看异常名称，更要结合日志、监控、堆转储、线程栈和业务代码一起分析。

常见思路可以概括为：

```text
确认 OOM 类型
-> 保留现场
-> 分析 GC 和内存趋势
-> 查看 heap dump
-> 定位大对象和引用链
-> 回到业务代码
-> 修复并压测验证
```

这次问题的根因并不是 JVM 堆配置太小，而是导出逻辑一次性加载了过多数据。通过分页查询、分批写入、限制导出范围后，内存占用变得稳定，服务也不再频繁重启。

真正有效的 JVM 排查，往往不是单纯调参数，而是找到对象为什么活着、数据为什么堆积、资源为什么没有释放。

最后记住一句话：

> OOM 只是线索。heap dump、GC 日志和业务代码，才是定位问题的关键。
