---
title: 开源 OCRmyPDF 实战：扫描 PDF 转可检索文档
slug: ocrmypdf-scanned-pdf-ocr-practice
date: 2026-07-05
category: 工具
tags:
  - OCRmyPDF
  - OCR
  - PDF
  - Tesseract
description: OCRmyPDF 是一个开源 PDF OCR 工具，可以为扫描版 PDF 添加可搜索、可复制的文本层。内容整理安装方式、常用命令、中文识别、批量处理、后端集成和常见问题，适合处理合同、发票、论文扫描件等文档场景。
cover:
published: true
---

## 工具定位

OCRmyPDF 是一个开源命令行工具，主要用途是给扫描版 PDF 添加 OCR 文本层。

很多扫描 PDF 看起来是文字，实际每一页都是图片，常见问题有几个：

- 不能复制文字；
- 不能搜索关键词；
- 无法被知识库检索；
- 上传到文档系统后只能预览，不能做全文索引；
- 后续做 RAG、归档、合同检索时很难利用。

OCRmyPDF 处理后的 PDF 仍然保留原始页面视觉效果，同时增加一层隐藏文本。用户看到的还是原文档，但可以复制、搜索，也可以通过 `pdftotext` 之类的工具提取文字。

可以把它理解成：

```text
扫描 PDF
-> 图像预处理
-> OCR 识别
-> 写入隐藏文本层
-> 输出可检索 PDF
```

OCRmyPDF 官方文档：[OCRmyPDF Documentation](https://ocrmypdf.readthedocs.io/)
源码仓库：[OCRmyPDF GitHub](https://github.com/ocrmypdf/OCRmyPDF)

图：扫描 PDF 处理前无法搜索文字截图

![](images/2026/07/05/ocrmypdf-before-search-placeholder.png)

## 环境准备

macOS 可以使用 Homebrew 安装：

```bash
# 安装 OCRmyPDF 主程序
brew install ocrmypdf

# 安装 Tesseract 语言包，中文识别需要 chi_sim 或 chi_tra
brew install tesseract-lang

# 确认命令是否可用
ocrmypdf --version
```

Ubuntu 可以直接使用 apt：

```bash
# 更新软件源
sudo apt update

# 安装 OCRmyPDF 和中英文语言包
sudo apt install -y ocrmypdf tesseract-ocr-eng tesseract-ocr-chi-sim

# 检查 Tesseract 当前可用语言
tesseract --list-langs
```

如果不想在本机安装依赖，也可以用 Docker。Docker Hub 地址：[ocrmypdf/ocrmypdf](https://hub.docker.com/r/ocrmypdf/ocrmypdf)。

```bash
# 将当前目录挂载到容器中，输入和输出文件都放在当前目录
docker run --rm \
  -v "$PWD:/data" \
  ocrmypdf/ocrmypdf:latest \
  --language chi_sim+eng \
  /data/input.pdf \
  /data/output.pdf
```

Docker 方式更适合服务器或一次性处理环境，依赖隔离比较干净。

## 基础命令

最小可用命令如下：

```bash
ocrmypdf input.pdf output.pdf
```

如果文档包含中文，建议显式指定语言：

```bash
ocrmypdf \
  --language chi_sim+eng \
  input.pdf \
  output.pdf
```

`chi_sim` 表示简体中文，`eng` 表示英文。多语言之间使用 `+` 连接。

处理合同、扫描件、发票这类文件时，常用命令可以写成：

```bash
ocrmypdf \
  --language chi_sim+eng \
  --skip-text \
  --deskew \
  --rotate-pages \
  --jobs 4 \
  input.pdf \
  output.pdf
```

几个参数的含义：

| 参数 | 作用 |
| --- | --- |
| `--language chi_sim+eng` | 使用简体中文和英文识别 |
| `--skip-text` | 遇到已经有文字层的页面就跳过 |
| `--deskew` | 自动纠正文档倾斜 |
| `--rotate-pages` | 自动旋转方向错误的页面 |
| `--jobs 4` | 使用 4 个并发任务处理页面 |

图：OCRmyPDF 命令执行日志截图

![](images/2026/07/05/ocrmypdf-command-log-placeholder.png)

## 参数选择

### 已有文字层

有些 PDF 不是纯扫描件，里面已经带有文字层。直接处理可能会报错或跳过。

常见选择有三个：

```bash
# 保留已有文字层，只处理没有文字层的页面
ocrmypdf --skip-text input.pdf output.pdf

# 强制把每一页都当作图片重新 OCR，可能改变已有文本层
ocrmypdf --force-ocr input.pdf output.pdf

# 删除旧 OCR 层后重新识别，适合旧文本层质量很差的文件
ocrmypdf --redo-ocr input.pdf output.pdf
```

日常处理混合 PDF 时，优先使用 `--skip-text`，风险更低。

### 输出格式

OCRmyPDF 默认倾向输出 PDF/A，适合归档场景。

如果只想输出普通 PDF，可以显式指定：

```bash
ocrmypdf \
  --output-type pdf \
  --language chi_sim+eng \
  input.pdf \
  output.pdf
```

归档系统、合同系统一般可以保留 PDF/A。只做临时识别和内部流转时，普通 PDF 也够用。

### Sidecar 输出

如果还想额外生成纯文本，可以使用 `--sidecar`：

```bash
ocrmypdf \
  --language chi_sim+eng \
  --sidecar output.txt \
  input.pdf \
  output.pdf
```

这样会同时得到两个文件：

```text
output.pdf  可搜索 PDF
output.txt  OCR 识别出的纯文本
```

Sidecar 文本适合后续做 Elasticsearch 索引、向量化入库、关键词检索。

### 文件体积

扫描 PDF 体积通常比较大，可以加上优化参数：

```bash
ocrmypdf \
  --language chi_sim+eng \
  --optimize 2 \
  input.pdf \
  output.pdf
```

`--optimize` 数值越高，压缩越激进，处理时间也可能更长。普通业务场景用 `1` 或 `2` 比较稳妥。

## 批量处理

如果要处理一个目录下的 PDF，可以准备两个目录：

```text
pdf-input/   原始扫描 PDF
pdf-output/  处理后的 PDF
```

批量脚本可以这样写：

```bash
#!/usr/bin/env bash
set -euo pipefail

input_dir="pdf-input"
output_dir="pdf-output"
failed_log="ocr-failed.log"

mkdir -p "$output_dir"
: > "$failed_log"

# 使用 print0 处理文件名中的空格、中文和特殊字符
find "$input_dir" -type f -name "*.pdf" -print0 | while IFS= read -r -d '' file; do
  filename="$(basename "$file")"
  output_file="$output_dir/$filename"

  echo "开始处理：$file"

  if ocrmypdf \
      --language chi_sim+eng \
      --skip-text \
      --deskew \
      --rotate-pages \
      --jobs 4 \
      "$file" \
      "$output_file"; then
    echo "处理完成：$output_file"
  else
    # 单个文件失败时记录日志，不影响后续文件继续处理
    echo "$file" >> "$failed_log"
    echo "处理失败：$file"
  fi
done
```

运行方式：

```bash
chmod +x batch-ocr.sh
./batch-ocr.sh
```

批量处理时不要一上来就把并发开得很大。OCR 对 CPU 和内存都有压力，服务器上可以先用 `--jobs 2` 或 `--jobs 4` 试一下。

## 后端集成

如果要把 OCRmyPDF 接入 Java 后端，可以先把它作为外部命令调用。适合内部系统、文档管理系统、合同归档系统这类场景。

一个简化版 Java 调用示例：

```java
public class OcrMyPdfService {

    public void ocr(Path input, Path output) throws IOException, InterruptedException {
        List<String> command = List.of(
                "ocrmypdf",
                "--language", "chi_sim+eng",
                "--skip-text",
                "--deskew",
                "--rotate-pages",
                input.toAbsolutePath().toString(),
                output.toAbsolutePath().toString()
        );

        ProcessBuilder builder = new ProcessBuilder(command);

        // 合并标准输出和错误输出，方便统一收集 OCRmyPDF 执行日志
        builder.redirectErrorStream(true);

        Process process = builder.start();

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                // 生产环境可以替换成日志框架，例如 log.info(line)
                System.out.println(line);
            }
        }

        int exitCode = process.waitFor();
        if (exitCode != 0) {
            throw new IllegalStateException("OCRmyPDF 执行失败，exitCode = " + exitCode);
        }
    }
}
```

真实项目里不建议在接口线程里同步处理大文件。更稳妥的链路是：

```text
上传 PDF
-> 保存原始文件
-> 创建 OCR 任务
-> 投递到队列
-> 后台 Worker 执行 OCRmyPDF
-> 更新任务状态
-> 保存输出 PDF 和 sidecar 文本
```

任务表可以设计几个核心字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 任务 ID |
| `source_file` | 原始文件地址 |
| `output_file` | OCR 后文件地址 |
| `status` | `PENDING`、`RUNNING`、`SUCCESS`、`FAILED` |
| `error_message` | 失败原因 |
| `created_at` | 创建时间 |
| `finished_at` | 完成时间 |

如果文件量比较大，可以使用 RabbitMQ、Kafka 或 Redis Stream 做异步任务分发。每个 Worker 控制并发数，避免 OCR 任务把机器 CPU 打满。

## 效果验证

处理完成后，可以用三种方式确认结果。

第一种是在 PDF 阅读器里搜索中文关键词。

图：OCR 处理后 PDF 可搜索文字截图

![](images/2026/07/05/ocrmypdf-after-search-placeholder.png)

第二种是用 `pdftotext` 提取文字：

```bash
# macOS 可以通过 brew install poppler 安装 pdftotext
pdftotext output.pdf - | head -n 20
```

第三种是检查 sidecar 文本：

```bash
ocrmypdf \
  --language chi_sim+eng \
  --sidecar output.txt \
  input.pdf \
  output.pdf

# 查看前 20 行 OCR 文本
head -n 20 output.txt
```

如果 PDF 可以搜索，但复制出来的文字质量很差，通常不是 OCRmyPDF 命令问题，而是原始扫描质量、字体、分辨率、页面倾斜、印章遮挡等因素影响了 Tesseract 识别效果。

## 常见问题

### 中文识别失败

先检查语言包是否存在：

```bash
tesseract --list-langs | grep chi
```

如果没有 `chi_sim`，需要安装中文语言包。

macOS：

```bash
brew install tesseract-lang
```

Ubuntu：

```bash
sudo apt install -y tesseract-ocr-chi-sim
```

### 处理速度慢

OCR 本身就是 CPU 密集型任务，尤其是页数多、图片分辨率高的 PDF。

可以尝试：

- 增加 `--jobs`；
- 在低峰期批量处理；
- 对大文件做任务拆分；
- 后端使用异步队列；
- 避免在接口请求线程里直接执行。

### 输出文件变大

OCR 后会新增文本层，文件体积可能变大。可以尝试：

```bash
ocrmypdf \
  --language chi_sim+eng \
  --optimize 2 \
  input.pdf \
  output.pdf
```

如果文档对图片质量要求较高，不建议过度压缩。

### Docker 权限问题

容器生成的文件可能属于 root 用户。可以加上当前用户 ID：

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:/data" \
  ocrmypdf/ocrmypdf:latest \
  --language chi_sim+eng \
  /data/input.pdf \
  /data/output.pdf
```

这样输出文件会归当前宿主机用户所有。

### 版面识别不理想

OCRmyPDF 的重点是给 PDF 添加文本层，不是还原 Word 排版，也不是专门做表格结构化抽取。

如果目标是提取表格数据，需要额外结合表格识别工具或人工校验流程。对于合同、公告、论文扫描件、归档资料这类“可搜索、可复制”需求，OCRmyPDF 更合适。

## 选型边界

适合使用 OCRmyPDF 的场景：

- 扫描合同归档；
- 历史纸质资料电子化；
- 发票、报告、证照 PDF 检索；
- 文档系统全文搜索；
- RAG 知识库入库前的文字提取；
- 内部资料批量 OCR。

不太适合的场景：

- 手写体识别；
- 复杂表格结构化抽取；
- 低清晰度图片识别；
- 强依赖坐标级字段抽取；
- 需要极高准确率的法律或财务自动审核。

OCR 工具可以提高处理效率，但不能替代所有人工校验。涉及合同金额、发票金额、身份证号等关键字段时，最好保留人工复核或规则校验。

## 总结

OCRmyPDF 很适合处理扫描 PDF 的可搜索化问题。它的使用成本不高，安装后通过一条命令就能把普通扫描件转换成带文本层的 PDF。
实际落地时，重点关注几个方面：中文语言包、已有文本层处理、并发参数、输出文件体积、失败重试、后端异步任务。把这些细节处理好后，OCRmyPDF 可以很好地接入文档归档、知识库检索和内部资料数字化流程。
