---
title: 豆腐块的七种解决方案：Windows 下 Java 中文乱码问题
slug: java-chinese-encoding-windows
date: 2026-06-28
category: 运维
tags:
  - Java
  - 编码
  - Windows
  - UTF-8
  - 解决方案
description: 在 Windows 系统运行 Java 程序时，控制台输出/文件读写常出现中文乱码。这是由于 Windows 默认使用 GBK 编码，而现代 Java 项目多采用 UTF-8 编码所致。本文提供 7 种解决方案，覆盖命令行程序、IDE 开发、服务部署等场景，适用于 Windows 7/10/11 全系版本。
cover:
published: true
---

## 问题摘要

在 Windows 系统中运行 Java 程序时，中文内容有时会显示成乱码，甚至变成一个个“豆腐块”。这类问题通常出现在控制台输出、文件读写、IDE 运行或服务部署场景中。

根本原因通常是：**程序、文件、控制台或系统默认编码不一致**。例如，现代 Java 项目大多使用 **UTF-8**，而 Windows 中文环境中仍可能使用 **GBK / ANSI 代码页**。一旦写入和读取时使用的编码不一致，中文字符就可能无法被正确解析。

本文整理了 7 种常见解决方案，覆盖命令行运行、IDE 开发、构建工具、系统环境变量和 Windows 系统级设置，适用于 Windows 7 / 10 / 11 等环境。

## 问题现象

运行 Java 程序时，控制台中的中文无法正常显示，可能出现乱码、问号或方块字符：

![](images/2026/06/28/img-20260628160635419.png)

## 问题原因

中文乱码的本质是**编码和解码不一致**。

举个例子：

- Java 源码或文本文件使用 UTF-8 保存；
- Windows 控制台或系统默认编码使用 GBK；
- JVM、控制台、文件读写或 IDE 配置之间没有统一编码。

此时，同一段中文在写入时按 UTF-8 编码，但读取或显示时却按 GBK 解码，就会得到错误字符，也就是常见的乱码。

可以简单理解为：

```text
Java 程序 / 文件（UTF-8） → Windows 控制台 / 系统（GBK） → 编解码不匹配 → 中文乱码
```

## 快速解决方式：添加系统环境变量

如果希望对本机上的 Java 程序统一生效，可以通过配置系统环境变量来指定 JVM 默认编码。

### 1. 打开环境变量设置

右键 `此电脑` / `我的电脑` → `属性` → `高级系统设置` → `环境变量`。

![](images/2026/06/28/img-20260628160635420.png)

### 2. 新建系统环境变量

新增一个系统环境变量：

- 变量名：`JAVA_TOOL_OPTIONS`
- 变量值：`-Dfile.encoding=UTF-8`

![](images/2026/06/28/img-20260628160635421.png)

配置完成后，重新打开终端、IDE 或相关服务，再次运行 Java 程序。

## 处理结果

重新运行后，可以看到中文内容已经能够正常显示：

![](images/2026/06/28/img-20260628160635422.png)

## 核心问题分析

### 编码冲突示意

```text
程序编码：UTF-8
系统 / 控制台编码：GBK
结果：编码不一致，中文解析失败
```

### Windows 为什么长期使用 GBK？

Windows 中文环境长期保留 GBK / ANSI 代码页，主要是出于兼容性考虑：

1. **向下兼容**：大量早期 Windows 软件依赖 GBK 或 ANSI 编码；
2. **中文支持完整**：GBK 能覆盖 GB2312 以及大量扩展汉字；
3. **历史包袱较重**：许多旧 API、旧程序和脚本仍依赖系统默认代码页。

因此，即使 UTF-8 已经成为现代开发中的主流编码，在 Windows 平台上仍然容易遇到编码不一致的问题。

## 七种解决方案

### 方案 1：启动参数强制指定编码

运行 Java 程序时，通过 JVM 参数指定默认编码：

```bash
java -Dfile.encoding=UTF-8 MainClass
```

如果是运行 JAR 包：

```bash
java -Dfile.encoding=UTF-8 -jar app.jar
```

**适用场景：**

- 命令行程序；
- 服务端应用；
- 批处理脚本；
- JAR 包直接运行。

这是最直接、最清晰的方式，推荐优先使用。

### 方案 2：切换控制台编码（CMD / PowerShell）

在 Windows 控制台中，可以先切换当前终端代码页为 UTF-8，再运行 Java 程序：

```bash
chcp 65001
java MainClass
```

也可以写成一行：

```bash
chcp 65001 && java MainClass
```

**版本兼容性：**

| Windows 版本 | 支持情况 |
| --- | --- |
| Windows 7 | 可能需要补丁或额外配置 |
| Windows 10 / 11 | 原生支持较好 |

需要注意的是，`chcp 65001` 只影响当前控制台窗口，不一定会影响 IDE、后台服务或其他终端环境。

### 方案 3：配置 IDE 编码（以 IntelliJ IDEA 为例）

如果问题出现在开发调试阶段，应先检查 IDE 的编码配置。

IntelliJ IDEA 中可以按以下路径设置：

```text
File → Settings → Editor → File Encodings
```

建议配置为：

- `Global Encoding`：UTF-8；
- `Project Encoding`：UTF-8；
- `Default encoding for properties files`：UTF-8；
- 如有需要，可勾选 `Transparent native-to-ascii conversion`。

此外，还可以在运行配置中添加 JVM 参数：

```text
-Dfile.encoding=UTF-8
```

### 方案 4：配置系统环境变量（推荐）

通过环境变量让 JVM 自动带上编码参数：

```bash
setx JAVA_TOOL_OPTIONS "-Dfile.encoding=UTF-8"
```

设置后，新启动的 Java 进程会自动读取该参数。

**优点：**

- 对多个 Java 程序统一生效；
- 不需要逐个修改启动脚本；
- 适合本地开发环境或固定部署环境。

**注意：**

`JAVA_TOOL_OPTIONS` 会影响当前系统中所有使用该环境变量的 Java 程序。如果某些旧项目依赖 GBK，需要谨慎使用。

### 方案 5：在源码中显式指定编码

在少数场景下，也可以通过代码指定编码。例如读取 GBK 文件时，应明确告诉 Java 使用 GBK 解码：

```java
try (BufferedReader br = new BufferedReader(
        new InputStreamReader(new FileInputStream("data.txt"), "GBK"))) {
    // 处理 GBK 编码文件
}
```

不太推荐使用下面这种方式：

```java
System.setProperty("file.encoding", "UTF-8");
```

因为 JVM 默认编码通常在启动时就已经确定，运行时修改 `file.encoding` 并不一定能影响所有已初始化的组件。

### 方案 6：配置构建工具编码

如果项目使用 Maven，应在 `pom.xml` 中指定源码编码：

```xml
<project>
    <properties>
			<project.build.sourceEncoding>UTF8</project.build.sourceEncoding><project.reporting.outputEncoding>UTF8</project.reporting.outputEncoding>
    </properties>
</project>
```

如果使用 Gradle，可以添加：

```groovy
tasks.withType(JavaCompile).configureEach {
    options.encoding = 'UTF-8'
}
```

这样可以避免编译阶段因为源码编码不一致导致中文注释、字符串或资源文件出现问题。

### 方案 7：Windows 系统级改造

如果希望系统层面尽可能统一为 UTF-8，可以在 Windows 10 / 11 中启用 UTF-8 Beta 支持：

```text
控制面板 → 区域 → 管理 → 更改系统区域设置 → 勾选「使用 Unicode UTF-8 提供全球语言支持」
```

也可以通过系统区域相关命令进行调整：

```powershell
Set-WinSystemLocale -SystemLocale zh-CN
Set-WinHomeLocation -GeoId 45
Set-Culture zh-CN
```

不过，系统级设置可能影响旧软件兼容性，建议仅在充分测试后使用。

## 编码知识扩展

### 常见编码对照表

| 编码标准 | 支持字符 | 字节长度 | 典型场景 |
| --- | --- | --- | --- |
| ASCII | 英文、数字、基础符号 | 1 byte | 早期英文系统 |
| GBK | 简体中文及扩展汉字 | 通常 2 bytes | 中文 Windows、旧系统 |
| UTF-8 | Unicode 字符集 | 1 - 4 bytes | 现代跨平台应用 |

简单来说：

- **GBK** 更常见于旧版中文 Windows 环境；
- **UTF-8** 更适合现代 Web、Java、Linux、跨平台项目；
- 项目中最好统一使用 UTF-8，减少跨平台问题。

## 故障排查指南

遇到乱码时，可以按照下面四步排查：

1. **查看控制台编码**

   ```bash
   chcp
   ```

2. **查看 JVM 默认编码**

   ```java
   System.out.println(System.getProperty("file.encoding"));
   ```

3. **确认文件实际编码**

   使用 VS Code、Notepad++ 等工具查看文件是否为 UTF-8、GBK 或其他编码。

4. **检查 IDE 和启动参数**

   确认 IDE 的项目编码、运行配置、Maven / Gradle 编译编码是否一致。

## 进阶场景处理

### 文件读写乱码

读取文本文件时，不要依赖系统默认编码，建议显式指定编码：

```java
try (BufferedReader br = new BufferedReader(
        new InputStreamReader(new FileInputStream("data.txt"), "UTF-8"))) {
    // 按 UTF-8 读取文件
}
```

如果文件本身是 GBK，则应使用：

```java
try (BufferedReader br = new BufferedReader(
        new InputStreamReader(new FileInputStream("data.txt"), "GBK"))) {
    // 按 GBK 读取文件
}
```

### 网络传输编码

URL 参数中包含中文时，应显式使用 UTF-8 编码和解码：

```java
String encoded = URLEncoder.encode(str, "UTF-8");
String decoded = URLDecoder.decode(encoded, "UTF-8");
```

### 数据库连接编码

以 MySQL 为例，可以在 JDBC 连接串中指定字符编码：

```text
jdbc:mysql://localhost:3306/db?useUnicode=true&characterEncoding=UTF-8
```

对于较新的 MySQL 驱动，也建议确认数据库、表、字段和连接参数都统一使用 `utf8mb4`。

## 特别提示

如果只是解决 Java 程序中文乱码，建议优先使用以下组合：

1. 项目文件统一保存为 UTF-8；
2. IDE 编码统一设置为 UTF-8；
3. 启动参数添加 `-Dfile.encoding=UTF-8`；
4. 控制台必要时执行 `chcp 65001`；
5. 文件读写、网络传输、数据库连接中显式指定编码。

不建议一上来就修改系统全局编码，因为这可能影响其他旧软件或脚本。

## 总结

Windows 下 Java 中文乱码，本质上是编码链路不统一导致的。解决思路不是盲目修改某一个配置，而是检查完整链路：

```text
源码编码 → 编译编码 → JVM 默认编码 → 文件读写编码 → 控制台显示编码 → 数据库 / 网络编码
```

只要让这些环节尽可能统一为 UTF-8，就能大幅减少中文乱码问题。对于大多数场景，推荐优先使用 `-Dfile.encoding=UTF-8`，并配合 IDE、构建工具和文件读写编码配置一起处理。
