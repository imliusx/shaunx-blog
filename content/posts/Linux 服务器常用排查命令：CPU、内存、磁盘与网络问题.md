---
title: Linux 服务器常用排查命令：CPU、内存、磁盘与网络问题
slug: linux-server-troubleshooting-commands
date: 2026-07-04
category: 运维
tags:
  - Linux
  - 运维
  - 服务器排查
  - 性能分析
  - Shell
description: Linux 服务器出现接口变慢、CPU 飙高、内存不足、磁盘打满、网络异常时，掌握常用排查命令可以快速缩小问题范围。内容整理 top、vmstat、free、df、du、iostat、netstat、ss、lsof、journalctl、dmesg 等命令在实际排查中的使用方式。
cover:
published: true
---

## 引言

后端服务上线后，很多问题最终都会落到服务器上排查。

常见现象包括：

- 接口突然变慢；
- CPU 使用率飙高；
- 内存持续上涨；
- 磁盘空间被打满；
- 日志无法写入；
- 数据库连接异常；
- 服务端口无法访问；
- 网络延迟变高；
- 进程莫名退出。

如果只看应用日志，很多时候只能看到表象。真正定位问题，还需要结合 Linux 系统层面的信息。

很多命令的参数都可以通过 `man` 查询，例如：

```bash
man top
man ps
man ss
```

## 排查问题的基本顺序

遇到服务器异常时，不建议一上来就重启服务。更稳妥的顺序是：

```text
确认现象
-> 查看系统负载
-> 查看 CPU
-> 查看内存
-> 查看磁盘
-> 查看网络
-> 查看进程
-> 查看日志
-> 定位应用或系统原因
```

常用的第一组命令：

```bash
uptime
top
free -h
df -h
ps -ef | grep java
ss -lntp
dmesg | tail -100
```

这些命令可以快速判断服务器当前大概出了什么问题。

## 查看系统负载：uptime

```bash
uptime
```

输出示例：

```text
23:10:01 up 12 days,  4:31,  2 users,  load average: 1.25, 0.98, 0.76
```

后面三个数字分别表示：

| 字段 | 含义 |
| --- | --- |
| 1.25 | 最近 1 分钟平均负载 |
| 0.98 | 最近 5 分钟平均负载 |
| 0.76 | 最近 15 分钟平均负载 |

Load Average 表示系统中正在运行或等待运行的任务数量。

如果机器是 4 核 CPU，负载长期接近或超过 4，就说明系统比较繁忙。

查看 CPU 核心数：

```bash
nproc
```

或者：

```bash
cat /proc/cpuinfo | grep processor | wc -l
```

图：uptime 与 CPU 核心数截图

![](images/2026/07/04/linux-uptime-cpu-core-placeholder.png)

## 查看 CPU：top

`top` 是最常用的实时监控命令。

```bash
top
```

重点看顶部几行：

```text
%Cpu(s): 80.0 us, 10.0 sy, 0.0 ni, 5.0 id, 3.0 wa, 0.0 hi, 2.0 si, 0.0 st
```

字段说明：

| 字段 | 含义 |
| --- | --- |
| us | 用户态 CPU 使用率 |
| sy | 内核态 CPU 使用率 |
| id | 空闲 CPU |
| wa | 等待 IO 的 CPU 时间 |
| hi | 硬中断 |
| si | 软中断 |
| st | 虚拟化环境中被宿主机偷走的 CPU 时间 |

常见判断：

- `us` 高：应用代码消耗 CPU 多；
- `sy` 高：系统调用频繁，可能和 IO、网络、上下文切换有关；
- `wa` 高：磁盘 IO 慢或大量等待磁盘；
- `si` 高：网络包处理压力可能较大；
- `st` 高：云主机宿主机资源争用明显。

### top 常用操作

进入 `top` 后：

| 操作 | 作用 |
| --- | --- |
| `P` | 按 CPU 使用率排序 |
| `M` | 按内存使用率排序 |
| `1` | 显示每个 CPU 核心使用情况 |
| `c` | 显示完整命令行 |
| `H` | 显示线程 |
| `q` | 退出 |

图：top CPU 使用率截图

![](images/2026/07/04/linux-top-cpu-usage-placeholder.png)

## 查看进程：ps

查看 Java 进程：

```bash
ps -ef | grep java
```

查看进程资源占用：

```bash
ps aux --sort=-%cpu | head
```

按内存排序：

```bash
ps aux --sort=-%mem | head
```

输出中常见字段：

| 字段 | 含义 |
| --- | --- |
| USER | 进程所属用户 |
| PID | 进程 ID |
| %CPU | CPU 使用率 |
| %MEM | 内存使用率 |
| VSZ | 虚拟内存大小 |
| RSS | 实际物理内存占用 |
| STAT | 进程状态 |
| COMMAND | 启动命令 |

查看某个进程启动参数：

```bash
ps -fp <pid>
```

查看完整启动命令：

```bash
cat /proc/<pid>/cmdline | tr '\0' ' '
```

## Java 进程 CPU 飙高排查

如果 Java 进程 CPU 很高，可以定位具体线程。

### 1. 找到 Java 进程 PID

```bash
jps -l
```

或者：

```bash
ps -ef | grep java
```

### 2. 查看进程下线程 CPU

```bash
top -Hp <pid>
```

找到 CPU 使用率最高的线程 ID。

### 3. 转成十六进制

```bash
printf "%x\n" <tid>
```

### 4. 查看线程栈

```bash
jstack <pid> | grep -A 40 <nid>
```

例如：

```bash
jstack 12345 | grep -A 40 2f3a
```

如果栈中一直停留在某个业务方法，就可以继续排查代码逻辑。

图：top -Hp 与 jstack 定位 Java 高 CPU 线程截图

![](images/2026/07/04/linux-java-high-cpu-top-jstack-placeholder.png)

JDK 工具文档可以查看：[JDK Tools and Utilities](https://docs.oracle.com/en/java/javase/21/docs/specs/man/index.html)。

## 查看内存：free

```bash
free -h
```

输出示例：

```text
              total        used        free      shared  buff/cache   available
Mem:           7.6Gi       4.1Gi       500Mi       120Mi       3.0Gi       3.1Gi
Swap:          2.0Gi       100Mi       1.9Gi
```

重点看 `available`，它表示系统还可以给新进程使用的内存。

不要只看 `free`。Linux 会把空闲内存用于缓存文件系统，所以 `free` 低不一定代表内存不足。

常见判断：

- `available` 很低：内存紧张；
- `swap` 使用很多：可能内存不足；
- `buff/cache` 高：可能是文件缓存，不一定有问题；
- Java RSS 很高：需要结合 JVM 堆、堆外、线程栈分析。

图：free -h 内存使用情况截图

![](images/2026/07/04/linux-free-memory-placeholder.png)

## 查看进程内存

按内存排序：

```bash
ps aux --sort=-rss | head
```

查看某个进程内存详情：

```bash
cat /proc/<pid>/status | grep -E 'VmRSS|VmSize|Threads'
```

输出示例：

```text
VmSize:  3568120 kB
VmRSS:   1289340 kB
Threads: 250
```

字段说明：

| 字段 | 含义 |
| --- | --- |
| VmSize | 虚拟内存大小 |
| VmRSS | 实际物理内存占用 |
| Threads | 线程数量 |

查看进程内存映射：

```bash
pmap -x <pid> | tail -20
```

如果是 Java 服务内存持续上涨，还要结合：

```bash
jstat -gcutil <pid> 1000
jmap -histo <pid> | head
```

必要时导出 heap dump：

```bash
jmap -dump:format=b,file=/tmp/app.hprof <pid>
```

## 查看磁盘空间：df

```bash
df -h
```

输出示例：

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1        40G   38G  2.0G  95% /
```

如果磁盘使用率接近 100%，可能导致：

- 日志无法写入；
- MySQL 写入失败；
- 应用启动失败；
- Docker 构建失败；
- 临时文件创建失败。

查看 inode：

```bash
df -i
```

有时候磁盘空间没满，但 inode 用完了，也会导致无法创建新文件。

图：df -h 与 df -i 磁盘使用截图

![](images/2026/07/04/linux-df-disk-inode-placeholder.png)

## 查找大文件：du 和 find

查看当前目录下各文件夹大小：

```bash
du -h --max-depth=1
```

按大小排序：

```bash
du -h --max-depth=1 | sort -hr
```

查找大于 1GB 的文件：

```bash
find / -type f -size +1G 2>/dev/null
```

查找最近 1 天修改的大文件：

```bash
find / -type f -mtime -1 -size +100M 2>/dev/null
```

常见大文件位置：

```text
/var/log
/tmp
/data/logs
/data/app
/var/lib/docker
```

如果 Docker 占用空间过大：

```bash
docker system df
```

谨慎清理：

```bash
docker system prune
```

清理前一定要确认不会删除仍需使用的镜像、容器、网络或缓存。

## 文件已删除但空间没释放

Linux 中，如果一个大日志文件被删除，但仍被进程打开，磁盘空间不会立刻释放。

查看已删除但仍被占用的文件：

```bash
lsof | grep deleted
```

如果看到类似：

```text
java  12345  app  10w  REG  253,1  10G  /data/logs/app.log (deleted)
```

说明文件虽然删除了，但 Java 进程还持有文件句柄。

处理方式：

1. 重启对应进程；
2. 或清空文件描述符；
3. 更推荐配置日志滚动，避免直接删除正在写入的日志文件。

图：lsof deleted 文件占用截图

![](images/2026/07/04/linux-lsof-deleted-file-placeholder.png)

## 查看磁盘 IO：iostat

`iostat` 属于 `sysstat` 工具包。

安装：

```bash
sudo apt-get install sysstat
```

或：

```bash
sudo yum install sysstat
```

查看磁盘 IO：

```bash
iostat -x 1
```

重点字段：

| 字段 | 含义 |
| --- | --- |
| r/s | 每秒读请求数 |
| w/s | 每秒写请求数 |
| rkB/s | 每秒读取 KB |
| wkB/s | 每秒写入 KB |
| await | IO 平均等待时间 |
| %util | 设备繁忙程度 |

如果 `%util` 长期接近 100%，说明磁盘非常繁忙。

如果 `await` 很高，说明 IO 响应慢。

图：iostat -x 磁盘 IO 截图

![](images/2026/07/04/linux-iostat-disk-io-placeholder.png)

sysstat 项目地址：[sysstat](https://github.com/sysstat/sysstat)。

## 查看网络端口：ss

`ss` 是现在更推荐使用的网络连接查看工具。

查看监听端口：

```bash
ss -lntp
```

查看 8080 端口：

```bash
ss -lntp | grep 8080
```

查看 TCP 连接状态统计：

```bash
ss -s
```

查看某个端口的连接：

```bash
ss -antp | grep 8080
```

常见 TCP 状态：

| 状态 | 含义 |
| --- | --- |
| LISTEN | 正在监听 |
| ESTAB | 连接已建立 |
| TIME-WAIT | 主动关闭后等待 |
| CLOSE-WAIT | 对端关闭，本端未关闭 |
| SYN-SENT | 正在发起连接 |
| SYN-RECV | 收到连接请求，等待确认 |

图：ss -lntp 端口监听截图

![](images/2026/07/04/linux-ss-listen-port-placeholder.png)

## netstat 命令

一些老系统仍然习惯使用 `netstat`。

查看监听端口：

```bash
netstat -lntp
```

查看连接数：

```bash
netstat -ant | awk '{print $6}' | sort | uniq -c | sort -nr
```

如果没有 `netstat`，可以安装 `net-tools`。

```bash
sudo apt-get install net-tools
```

不过新环境中更推荐使用 `ss`。

## 网络连通性排查

### ping

检查主机是否可达：

```bash
ping 8.8.8.8
```

注意：有些服务器禁用了 ICMP，ping 不通不一定代表 TCP 不通。

### curl

测试 HTTP 接口：

```bash
curl -v http://localhost:8080/health
```

查看响应耗时：

```bash
curl -o /dev/null -s -w 'time_connect=%{time_connect}\ntime_starttransfer=%{time_starttransfer}\ntime_total=%{time_total}\n' http://example.com
```

### telnet / nc

测试 TCP 端口：

```bash
telnet 127.0.0.1 3306
```

或：

```bash
nc -vz 127.0.0.1 3306
```

### traceroute

查看网络路径：

```bash
traceroute example.com
```

如果没有命令，需要安装：

```bash
sudo apt-get install traceroute
```

## 查看连接数异常

如果服务连接数过高，可以统计：

```bash
ss -ant | awk '{print $1}' | sort | uniq -c | sort -nr
```

查看某个端口连接来源：

```bash
ss -ant | grep ':8080' | awk '{print $5}' | cut -d: -f1 | sort | uniq -c | sort -nr | head
```

如果某个 IP 连接数异常高，可能是：

- 正常流量高峰；
- 客户端没有复用连接；
- 爬虫或攻击；
- 负载均衡健康检查异常；
- 程序连接泄漏。

## CLOSE-WAIT 过多

`CLOSE-WAIT` 表示对端已经关闭连接，但本端应用还没有关闭 socket。

查看：

```bash
ss -ant | grep CLOSE-WAIT | wc -l
```

如果数量持续增长，常见原因是应用代码没有正确关闭连接。

例如 HTTP 客户端响应流未关闭，数据库连接未释放，Socket 未关闭等。

排查方向：

1. 查看对应进程；
2. 查看连接的远端地址；
3. 检查 HTTP 客户端连接池；
4. 检查代码是否关闭 response body；
5. 检查第三方接口是否异常断开。

## TIME-WAIT 过多

`TIME-WAIT` 通常出现在主动关闭连接的一方。

查看：

```bash
ss -ant | grep TIME-WAIT | wc -l
```

少量 TIME-WAIT 是正常现象。如果特别多，可能是短连接过多。

优化方向：

1. 使用连接池；
2. 开启 HTTP keep-alive；
3. 减少频繁创建短连接；
4. 调整系统 TCP 参数时要谨慎。

不要一看到 TIME-WAIT 多就直接改内核参数，先确认是否是应用连接使用方式不合理。

## 查看打开文件：lsof

查看某个端口被哪个进程占用：

```bash
lsof -i:8080
```

查看某个进程打开的文件数量：

```bash
lsof -p <pid> | wc -l
```

查看进程打开文件限制：

```bash
cat /proc/<pid>/limits | grep 'open files'
```

如果日志中出现：

```text
Too many open files
```

说明文件描述符不够。

查看系统限制：

```bash
ulimit -n
```

临时修改：

```bash
ulimit -n 65535
```

长期修改需要调整系统配置，例如 `/etc/security/limits.conf`，具体方式要结合发行版和进程管理方式。

图：lsof 端口占用截图

![](images/2026/07/04/linux-lsof-port-usage-placeholder.png)

## 查看系统日志：journalctl

systemd 系统中，可以用 `journalctl` 查看服务日志。

查看某个服务日志：

```bash
journalctl -u nginx -f
```

查看最近 100 行：

```bash
journalctl -u nginx -n 100
```

查看今天的日志：

```bash
journalctl --since today
```

查看某个时间段：

```bash
journalctl --since "2026-07-04 10:00:00" --until "2026-07-04 11:00:00"
```

systemd 文档：[systemd](https://systemd.io/)。

## 查看内核日志：dmesg

`dmesg` 可以查看内核日志。

```bash
dmesg | tail -100
```

常用于排查：

- OOM Killer；
- 磁盘错误；
- 网卡异常；
- 文件系统错误；
- 容器被杀；
- 内核级别错误。

查看 OOM 相关日志：

```bash
dmesg | grep -i 'killed process'
```

如果看到：

```text
Out of memory: Killed process 12345 (java)
```

说明进程被系统 OOM Killer 杀掉了。

图：dmesg OOM Killer 日志截图

![](images/2026/07/04/linux-dmesg-oom-killer-placeholder.png)

## 查看定时任务

有些线上问题和定时任务有关，例如凌晨 CPU 飙高、磁盘写满、批处理拖慢数据库。

查看当前用户 crontab：

```bash
crontab -l
```

查看系统级任务：

```bash
ls /etc/cron.*
cat /etc/crontab
```

查看 crontab 日志，不同系统位置不同：

```bash
grep CRON /var/log/syslog
```

或：

```bash
grep CRON /var/log/cron
```

## 查看 Docker 容器资源

如果服务运行在 Docker 中，可以查看容器资源：

```bash
docker stats
```

查看容器日志：

```bash
docker logs -f <container>
```

查看容器配置：

```bash
docker inspect <container>
```

进入容器：

```bash
docker exec -it <container> sh
```

Docker 文档：[Docker CLI reference](https://docs.docker.com/reference/cli/docker/)。

图：docker stats 容器资源截图

![](images/2026/07/04/docker-stats-resource-placeholder.png)

## 常见场景排查示例

### 场景一：接口突然变慢

排查顺序：

```bash
uptime
top
free -h
df -h
iostat -x 1
ss -s
```

判断方向：

- CPU 是否打满；
- Load 是否过高；
- 内存是否不足；
- 磁盘 IO 是否高；
- 网络连接数是否异常；
- 应用日志是否有慢 SQL 或超时。

如果是 Java 应用，再配合：

```bash
jstack <pid>
jstat -gcutil <pid> 1000
```

### 场景二：磁盘突然满了

排查命令：

```bash
df -h
du -h --max-depth=1 / | sort -hr
find / -type f -size +1G 2>/dev/null
lsof | grep deleted
```

常见原因：

- 应用日志未滚动；
- 临时文件未清理；
- Docker 镜像和容器堆积；
- 数据库 binlog 太多；
- 删除大文件后进程仍占用。

### 场景三：端口无法访问

排查命令：

```bash
ss -lntp | grep 8080
curl -v http://localhost:8080/health
iptables -L -n
```

还要检查：

- 服务是否启动；
- 端口是否监听；
- 应用是否绑定 `127.0.0.1`；
- 防火墙是否拦截；
- 云服务器安全组是否放行；
- 容器端口映射是否正确。

### 场景四：Java 服务被杀

排查命令：

```bash
dmesg | grep -i 'killed process'
journalctl --since "1 hour ago"
free -h
ps aux --sort=-rss | head
```

如果是 Docker：

```bash
docker inspect <container> | grep -i oom
```

常见原因：

- JVM 堆设置过大；
- 容器内存限制太小；
- 堆外内存过高；
- 线程数过多；
- 大对象或内存泄漏。

## 常用命令速查

| 目标 | 命令 |
| --- | --- |
| 查看负载 | `uptime` |
| 查看 CPU | `top` |
| 查看内存 | `free -h` |
| 查看磁盘 | `df -h` |
| 查看 inode | `df -i` |
| 查看目录大小 | `du -h --max-depth=1` |
| 查找大文件 | `find / -type f -size +1G` |
| 查看磁盘 IO | `iostat -x 1` |
| 查看监听端口 | `ss -lntp` |
| 查看连接状态 | `ss -s` |
| 查看端口占用 | `lsof -i:8080` |
| 查看系统日志 | `journalctl` |
| 查看内核日志 | `dmesg` |
| 查看 Java 进程 | `jps -l` |
| 查看 Java 栈 | `jstack <pid>` |
| 查看 GC | `jstat -gcutil <pid> 1000` |
| 查看容器资源 | `docker stats` |

## 总结

Linux 排查问题时，最重要的是先判断瓶颈在哪一层。

可以按下面思路快速缩小范围：

```text
负载高不高
CPU 忙不忙
内存够不够
磁盘满没满
IO 是否很慢
端口是否监听
网络是否连通
进程是否还活着
日志有没有异常
```

很多线上问题看起来是应用异常，背后可能是磁盘满、连接数耗尽、文件描述符不足、系统 OOM、IO 等待过高或网络连接异常。

熟悉这些命令后，排查问题会更有方向：

```text
top 看 CPU
free 看内存
df/du 看磁盘
iostat 看 IO
ss/lsof 看网络和文件句柄
journalctl/dmesg 看系统日志
jstack/jstat 看 Java 运行状态
```

排查时不要只看单个指标，要把应用日志、系统指标、进程状态和业务时间点结合起来，才能更快找到真正原因。
