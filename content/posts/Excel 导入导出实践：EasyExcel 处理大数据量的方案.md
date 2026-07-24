---
title: Excel 导入导出实践：EasyExcel 处理大数据量的方案
slug: easyexcel-large-data-import-export
date: 2021-10-24
category: 开发
tags:
  - Java
  - EasyExcel
  - Excel
  - POI
  - 后端开发
description: 整理后台管理系统 Excel 导入导出的完整实践，分析 POI 用户模式容易 OOM 的原因，基于 EasyExcel 实现分页导出、多 Sheet 写入和监听器分批导入，包括导入数据校验、错误报告生成、版本冲突排查，以及大数据量场景下的异步导出思路。
cover:
published: true
---

## 引言

只要做后台管理系统，Excel 导入导出就是绕不开的需求：要导出订单报表、要批量导入商品、要对账单。这类需求看起来简单，第一版代码往往十分钟就写完了，然后在某天数据量上来之后突然爆雷。

我就碰到过一次：大概 5 万多行，接口直接把服务搞挂了，日志里是熟悉的：

```text
java.lang.OutOfMemoryError: Java heap space
	at org.apache.xmlbeans.impl.store.Cur$CurLoadContext.attr
	at org.apache.poi.xssf.usermodel.XSSFRow.<init>
	...
```

图：导出接口 OOM 的报错日志截图

![](images/2026/07/24/easyexcel-export-oom-log-placeholder.png)

当时用的是 POI 的 `XSSFWorkbook`，也就是最常见的用户模式写法。这篇文章从这个问题说起，整理 Excel 导入导出的实践方案，主要基于阿里开源的 EasyExcel。

相关资料：

- EasyExcel 项目地址：[alibaba/easyexcel](https://github.com/alibaba/easyexcel)；
- Apache POI 官网：[Apache POI](https://poi.apache.org/)。

## POI 为什么容易 OOM

先搞清楚 OOM 的原因，才能理解 EasyExcel 解决了什么。

xlsx 文件本质是一个 zip 包，里面是一堆 XML。POI 的用户模式（usermodel）读写 Excel 时，会把整个文件解析成 DOM 对象树完整放在内存里。一个单元格对应的不只是那点字符串，还有样式、坐标、类型等一堆包装对象，内存占用会放大几十倍。

粗略算一笔账：5 万行、20 列的表格是 100 万个单元格，每个单元格按放大后 1KB 算，就是接近 1GB 内存。而服务的堆内存一共才 2GB，还要同时服务别的请求，不挂才怪。

POI 家族处理 Excel 有三种模式：

| 模式 | 读/写 | 原理 | 特点 |
| --- | --- | --- | --- |
| usermodel（XSSF） | 读写 | 全量 DOM | API 友好，内存占用大 |
| eventmodel（SAX） | 读 | 事件流逐行解析 | 内存小，API 原始，开发繁琐 |
| SXSSF | 写 | 滑动窗口，超出部分刷到磁盘 | 解决写内存问题，不管读 |

SAX 模式内存表现很好，但要自己处理 XML 事件、共享字符串表这些细节，写起来非常繁琐。

EasyExcel 做的事情，就是把 SAX 模式封装成注解加监听器的易用 API：读取时逐行解析、逐行回调，不在内存里堆积整个文件；写入时也按批次写出。官方给的数据是 64M 内存 20 秒能读完 75M 的文件（46 万行 25 列）。对业务开发来说，用起来和 usermodel 一样简单，内存表现却是 SAX 级别的。

## 引入依赖

```xml
<dependency>
    <groupId>com.alibaba</groupId>
    <artifactId>easyexcel</artifactId>
    <version>2.2.11</version>
</dependency>
```

### 版本冲突：第一个坑在依赖里

EasyExcel 2.x 内部依赖 POI 3.17。如果项目里已经直接或间接引入了其他版本的 POI（比如 4.x），两个版本的类混在 classpath 里，运行时就会出各种诡异的错误：

```text
java.lang.NoSuchMethodError: org.apache.poi.ss.usermodel.Workbook.close()V
java.lang.ClassNotFoundException: org.apache.poi.sl.usermodel.SlideShow
```

处理方式是先用 Maven 命令看依赖树：

```bash
mvn dependency:tree -Dincludes=org.apache.poi
```

找到冲突来源后，把旧的 POI 依赖排除掉，让版本统一：

```xml
<dependency>
    <groupId>com.example</groupId>
    <artifactId>some-report-sdk</artifactId>
    <exclusions>
        <exclusion>
            <groupId>org.apache.poi</groupId>
            <artifactId>poi</artifactId>
        </exclusion>
        <exclusion>
            <groupId>org.apache.poi</groupId>
            <artifactId>poi-ooxml</artifactId>
        </exclusion>
    </exclusions>
</dependency>
```

遇到 `NoSuchMethodError` 不要慌，这类错误九成是依赖版本冲突，和代码逻辑没关系。

## 导出：从简单写法到大数据量

### 定义导出对象

EasyExcel 用注解把实体类字段映射到 Excel 列：

```java
@Data
public class OrderExportDTO {

    @ExcelProperty(value = "订单号", index = 0)
    @ColumnWidth(25)
    private String orderNo;

    @ExcelProperty(value = "用户手机号", index = 1)
    @ColumnWidth(15)
    private String phone;

    @ExcelProperty(value = "订单金额", index = 2)
    private BigDecimal amount;

    @ExcelProperty(value = "订单状态", index = 3)
    private String statusDesc;

    @ExcelProperty(value = "创建时间", index = 4)
    @ColumnWidth(20)
    @DateTimeFormat("yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    @ExcelIgnore
    private Integer status;
}
```

几个常用注解：

1. `@ExcelProperty`：列名和列顺序；
2. `@ColumnWidth`：列宽，默认宽度经常显示不全；
3. `@DateTimeFormat`：日期格式化；
4. `@ExcelIgnore`：不导出的字段。

### 简单导出

数据量不大（几千行以内）时，一次查出来直接写：

```java
@GetMapping("/export")
public void export(HttpServletResponse response) throws IOException {
    response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setCharacterEncoding("utf-8");
    String fileName = URLEncoder.encode("订单导出", "UTF-8").replaceAll("\\+", "%20");
    response.setHeader("Content-disposition",
            "attachment;filename*=utf-8''" + fileName + ".xlsx");

    List<OrderExportDTO> data = orderService.listExportData();
    EasyExcel.write(response.getOutputStream(), OrderExportDTO.class)
            .sheet("订单")
            .doWrite(data);
}
```

注意文件名要用 `URLEncoder` 编码，否则中文文件名在浏览器里会变成乱码。

### 大数据量导出：分页查询 + 分批写入

数据量到了几万、几十万，上面的写法有两个问题：

1. `listExportData()` 一次把所有数据查进内存，List 本身就可能把堆撑爆；
2. 没有 LIMIT 的全量查询对数据库也是一次冲击。

正确的做法是分页查、分批写，让内存里同一时刻只有一页数据：

```java
@GetMapping("/exportLarge")
public void exportLarge(HttpServletResponse response) throws IOException {
    response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setCharacterEncoding("utf-8");
    String fileName = URLEncoder.encode("订单导出", "UTF-8").replaceAll("\\+", "%20");
    response.setHeader("Content-disposition",
            "attachment;filename*=utf-8''" + fileName + ".xlsx");

    ExcelWriter excelWriter = null;
    try {
        excelWriter = EasyExcel.write(response.getOutputStream(), OrderExportDTO.class).build();
        WriteSheet writeSheet = EasyExcel.writerSheet("订单").build();

        int pageSize = 5000;
        Long lastId = 0L;
        while (true) {
            List<OrderExportDTO> page = orderService.listByIdCursor(lastId, pageSize);
            if (page.isEmpty()) {
                break;
            }
            excelWriter.write(page, writeSheet);
            lastId = page.get(page.size() - 1).getId();
        }
    } finally {
        if (excelWriter != null) {
            excelWriter.finish();
        }
    }
}
```

两个细节：

1. 分页方式用的是 `WHERE id > #{lastId} ORDER BY id LIMIT 5000` 这种游标翻页，而不是 `LIMIT offset, size`。翻到几十万行之后，offset 分页会越来越慢，游标方式每页都走主键索引，速度稳定；
2. `excelWriter.finish()` 必须调用，它负责收尾和释放资源，放在 finally 里。

用 JVisualVM 观察改造前后的堆内存曲线，区别非常明显：改造前一路爬升直到 OOM，改造后稳定在一个低水位小幅波动。

图：JVisualVM 观察导出时堆内存变化截图

![](images/2026/07/24/easyexcel-heap-monitor-placeholder.png)

### 超过单 Sheet 上限：分 Sheet 写入

xlsx 单个 Sheet 最多 1048576 行，超过会直接报错。数据量可能超过百万行时，按数量切分 Sheet：

```java
int sheetDataLimit = 1000000;
int sheetNo = 0;
int writtenInSheet = 0;
WriteSheet writeSheet = EasyExcel.writerSheet(sheetNo, "订单-" + (sheetNo + 1)).build();

while (true) {
    List<OrderExportDTO> page = orderService.listByIdCursor(lastId, pageSize);
    if (page.isEmpty()) {
        break;
    }
    if (writtenInSheet + page.size() > sheetDataLimit) {
        sheetNo++;
        writtenInSheet = 0;
        writeSheet = EasyExcel.writerSheet(sheetNo, "订单-" + (sheetNo + 1)).build();
    }
    excelWriter.write(page, writeSheet);
    writtenInSheet += page.size();
    lastId = page.get(page.size() - 1).getId();
}
```

不过实话说，单文件百万行的导出需求，先和产品确认一下是不是真的有人会打开这个文件，很多时候换成按月份拆分任务更合理。

## 导入：监听器逐行处理

### 简单导入

数据量小的场景可以用 `doReadSync` 一次读成 List：

```java
List<ProductImportDTO> list = EasyExcel.read(file.getInputStream())
        .head(ProductImportDTO.class)
        .sheet()
        .doReadSync();
```

写起来最省事，但和导出的道理一样：List 全量在内存里，只适合几千行以内的小文件。

### 大数据量导入：AnalysisEventListener

EasyExcel 推荐的方式是注册一个监听器，每解析一行回调一次。在监听器里攒批，攒够一批就批量入库，入库后清空缓存，内存里始终只有一批数据：

```java
public class ProductImportListener extends AnalysisEventListener<ProductImportDTO> {

    private static final int BATCH_SIZE = 3000;

    private final List<ProductImportDTO> cachedList = new ArrayList<>(BATCH_SIZE);
    private final ProductService productService;
    private int total = 0;

    public ProductImportListener(ProductService productService) {
        this.productService = productService;
    }

    @Override
    public void invoke(ProductImportDTO data, AnalysisContext context) {
        cachedList.add(data);
        total++;
        if (cachedList.size() >= BATCH_SIZE) {
            productService.batchInsert(cachedList);
            cachedList.clear();
        }
    }

    @Override
    public void doAfterAllAnalysed(AnalysisContext context) {
        if (!cachedList.isEmpty()) {
            productService.batchInsert(cachedList);
            cachedList.clear();
        }
    }
}
```

Controller 里触发：

```java
@PostMapping("/import")
public Result<Void> importExcel(@RequestParam("file") MultipartFile file) throws IOException {
    EasyExcel.read(file.getInputStream(),
                    ProductImportDTO.class,
                    new ProductImportListener(productService))
            .sheet()
            .doRead();
    return Result.success();
}
```

两个容易踩的点：

1. 监听器是有状态的（里面有 cachedList），不能注册成 Spring 单例 Bean，每次导入都要 new 一个新的。需要用到 Service 时通过构造器传进去；
2. `doAfterAllAnalysed` 里要把最后不满一批的数据落库，漏了这一步会丢掉尾部数据，而且这种 Bug 测试时用整批数据量还测不出来。

批量入库用 MyBatis 的 foreach 批量插入即可，注意单条 SQL 不要拼太大，之前整理 MyBatis 批量操作的坑时提过，3000 条一批是比较稳妥的量级。

### 导入校验与错误报告

真实的导入需求，校验往往比解析更花功夫。用户上传的 Excel 什么内容都可能有：必填列空着、手机号少一位、分类填了个不存在的名字。

处理原则是：解析阶段只收集错误，不中断；全部解析完，把错误汇总反馈给用户。

在监听器里加校验逻辑：

```java
@Override
public void invoke(ProductImportDTO data, AnalysisContext context) {
    int rowIndex = context.readRowHolder().getRowIndex() + 1;

    List<String> rowErrors = new ArrayList<>();
    if (StringUtils.isBlank(data.getProductName())) {
        rowErrors.add("商品名称不能为空");
    }
    if (data.getPrice() == null || data.getPrice().compareTo(BigDecimal.ZERO) <= 0) {
        rowErrors.add("价格必须大于 0");
    }
    if (!categoryService.existsByName(data.getCategoryName())) {
        rowErrors.add("商品分类不存在：" + data.getCategoryName());
    }

    if (!rowErrors.isEmpty()) {
        errorList.add(new ImportErrorDTO(rowIndex, String.join("；", rowErrors)));
        return;
    }

    cachedList.add(data);
    if (cachedList.size() >= BATCH_SIZE) {
        productService.batchInsert(cachedList);
        cachedList.clear();
    }
}
```

错误信息的反馈方式，比返回一段 JSON 更友好的做法是：把错误行号和原因写成一个新的 Excel 返回给用户下载，用户改完直接重新上传。错误报告本身也用 EasyExcel 写，几行代码的事。

图：导入错误报告 Excel 效果截图

![](images/2026/07/24/easyexcel-error-report-placeholder.png)

另外要注意入库策略的选择：

1. 全部校验通过才入库：适合对完整性要求高的场景，比如财务数据。实现上要么先全量校验再统一入库，要么用事务包住整个导入；
2. 跳过错误行，正确的先入库：适合商品、名单这类互相独立的数据，配合错误报告让用户补传。

这个选择要在做需求时和产品对齐，别自己拍。

## 简单压一下：三种方式的对比

本地用 10 万行、15 列的数据做了个简单对比，堆内存限制 `-Xmx512m`，结果仅供参考：

| 方式 | 导出耗时 | 内存表现 |
| --- | --- | --- |
| POI usermodel（XSSF） | 直接 OOM | 全量 DOM 在堆里 |
| POI SXSSF | 约 11 秒 | 正常完成，窗口外数据刷磁盘 |
| EasyExcel 分页写 | 约 13 秒 | 正常完成，曲线平稳 |

SXSSF 和 EasyExcel 都能完成任务，耗时也在一个量级。选 EasyExcel 主要是两点：读写 API 统一（SXSSF 只管写，读还得另找方案），注解映射比手动操作 Cell 的代码好维护得多。

## 数据量再大：转异步导出

分页导出解决了内存问题，但同步接口还有一个绕不过去的限制：HTTP 请求超时。几十万行的导出跑两三分钟很正常，网关、Nginx、浏览器任何一层超时，用户就白等了。

这种量级的需求，方向是把导出从同步接口改成异步任务：

```text
用户点击导出
-> 创建导出任务记录，状态为处理中，接口立即返回
-> 后台线程执行分页导出，文件写到本地或对象存储
-> 更新任务状态为已完成，记录文件地址
-> 用户在“导出记录”页面查看进度，完成后点击下载
```

图：异步导出流程示意图

![](images/2026/07/24/easyexcel-async-export-flow-placeholder.png)

这套方案要配套任务表、文件存储、可能还有失败重试，复杂度上了一个台阶。我们目前的项目里数据量还没到必须异步的程度，先记下这个方向，等真到了再展开。

## 踩坑清单

最后汇总几个实际遇到过的坑，都不复杂，但第一次碰到都要花时间。

### 长数字变成科学计数法

订单号、身份证号、手机号这类长数字，导出时如果字段是 Long 或者用户在 Excel 里看数值列，超过 15 位就会变成 `1.23457E+17`，末尾数字直接丢失精度。

处理方式：这类字段在导出 DTO 里一律声明成 String。它们本质是编号不是数字，本来也不该参与计算。

### 日期读出来对不上

导入时 Excel 里显示 `2021-10-24`，读到 Java 里变成 `44493` 之类的数字，或者格式解析失败。原因是 Excel 内部用数字存储日期，单元格格式又五花八门。

处理方式：导入 DTO 的日期字段用 String 接收，自己解析；或者字段用 Date 加 `@DateTimeFormat` 注解，并且在导入模板里把日期列设置成文本格式。给用户提供固定模板下载，比兼容各种随手填的格式省心得多。

### value 和 index 混用导致列错位

`@ExcelProperty` 支持按列名（value）或按列下标（index）映射。同一个类里两种方式混着用，列顺序会和预期不一致。规范是全类统一用一种，个人习惯导出用 index 固定顺序，导入用 value 按表头匹配。

### 空行读出 null 对象

用户经常会在数据末尾留几个空行，或者中间删过数据留下空行。监听器里收到的对象可能整个字段全是 null，校验前先判断整行是否为空，否则批量插入时报一堆莫名其妙的非空约束错误。

### 表头和模板对不上没有任何提示

用户上传了一个完全不相干的 Excel，按 value 匹配不到列，所有字段都是 null，程序还“正常”跑完了。稳妥的做法是重写监听器的 `invokeHeadMap` 方法，先校验表头和模板一致，不一致直接返回“请使用标准模板”。

## 总结

Excel 导入导出的核心问题就一个：内存。

```text
POI usermodel：整个文件解析成 DOM 放内存，数据量大必 OOM
EasyExcel：SAX 逐行解析 + 逐行回调，内存只保留当前批次
```

落到实践上：

```text
导出：分页查询（游标方式）+ ExcelWriter 分批写入 + 超百万行分 Sheet
导入：AnalysisEventListener 攒批入库 + doAfterAllAnalysed 处理尾批
校验：解析时收集错误，生成错误报告 Excel 返回给用户
更大量级：转异步任务 + 文件存储 + 导出记录页面
```

另外记住两个和代码无关的经验：给用户提供标准模板下载，能省掉一半的格式兼容工作；导入的入库策略（全部成功还是部分成功）提前和产品对齐，这是业务决策不是技术决策。

导入导出是典型的“做出来容易做稳难”的需求，希望这篇整理能让你少踩几个坑。
