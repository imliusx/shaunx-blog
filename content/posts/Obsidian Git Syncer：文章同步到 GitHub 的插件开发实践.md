---
title: Obsidian Git Syncer：文章同步到 GitHub 的插件开发实践
slug: obsidian-git-syncer-project-introduction
date: 2026-07-13
category: 项目
tags:
  - Obsidian
  - GitHub
  - TypeScript
  - 插件开发
  - 开源项目
description: Obsidian Git Syncer 是一个将 Obsidian Vault 中的 Markdown、图片和资源文件同步到 GitHub 仓库 content 目录的插件。本文介绍项目背景、核心功能、同步架构、文件状态判断和 GitHub API 实现。
cover:
published: true
---

## 前言

使用 Obsidian 写博客时，经常会遇到一个衔接问题：文章在 Vault 中完成后，怎样方便地发布到博客内容仓库？

最直接的做法是在本地克隆博客仓库，把文章复制到指定目录，再执行 `git add`、`git commit` 和 `git push`。这种方式很可靠，但写作目录和项目目录通常是分开的，每次发布都要在 Obsidian、文件管理器和终端之间切换。

如果还需要同步文章图片、检查哪些文件发生了变化，或者清理远端残留文件，整个过程会变得更加繁琐。

为了解决这个问题，我开发了 [Obsidian Git Syncer](https://github.com/imliusx/obsidian-git-syncer)：一个直接运行在 Obsidian 中的 GitHub 内容同步插件。

先看一下最终的效果：

![](images/2026/07/24/img-20260724163159459.png)


插件同步中心：

![](images/2026/07/24/img-20260724162835441.png)

插件侧边栏入口：

![](images/2026/07/24/img-20260724162835441%201.png)

它允许我们继续在熟悉的 Vault 中写作，文章完成后打开同步中心，选择文件或目录，就可以把内容发布到 GitHub 仓库固定的 `content/` 目录。

## 项目解决什么问题

Obsidian Git Syncer 面向的是“Obsidian 写作 + GitHub 内容仓库 + 静态博客构建”这一类工作流。

整个链路可以简化为：

```text
Obsidian Vault
    ↓
Obsidian Git Syncer
    ↓
GitHub 仓库 content/
    ↓
Next.js、Hugo、Hexo 等博客构建系统
    ↓
自动构建并发布博客
```

插件不负责博客页面渲染，也不替代 Next.js、Hugo 等框架。它只处理写作端到内容仓库之间的同步，让文章发布不再依赖手动复制文件和执行 Git 命令。

项目目前支持：

- 配置 GitHub 仓库、用户名、Token、分支和本地同步目录；
- 同步 Markdown、图片以及其他普通资源文件；
- 将本地相对路径映射到远端 `content/` 目录；
- 自动识别未发布、已修改、已发布和本地已删除状态；
- 按文件或目录批量选择；
- 将本地文件同步到 GitHub；
- 将远端独有文件拉取到 Vault；
- 删除 GitHub 上的远端文件；
- 为当前文章插入博客 Frontmatter 模板；
- 展示批量操作中的失败文件和具体原因。

项目地址：[imliusx/obsidian-git-syncer](https://github.com/imliusx/obsidian-git-syncer)

## 插件界面

### 同步中心

同步中心会同时扫描本地同步目录和 GitHub 仓库中的 `content/` 目录，再按照文件状态分类展示。

![](images/2026/07/24/img-20260724162835441%202.png)


顶部汇总区域展示四类状态：

```text
未发布：本地存在，远端不存在
已修改：本地与远端都存在，但文件内容不同
已发布：本地与远端内容一致
已删除：远端存在，本地不存在
```

目录可以折叠、展开和批量选择。根据当前选择的文件状态，可以执行三类操作：

- **同步本地**：把本地新增或修改的文件写入 GitHub；
- **拉取远端**：把远端独有文件下载到本地；
- **删除远端**：清理选中的 GitHub 文件。

### 插件设置

插件设置页分为通用设置、GitHub 配置、同步控制、附件处理和调试等区域，并提供搜索功能。

![](images/2026/07/24/img-20260724162835441%203.png)

GitHub 配置主要包括：

| 配置项 | 说明 |
| --- | --- |
| Repository URL | 目标 GitHub 仓库，支持 HTTPS、SSH 和 `owner/repo` |
| GitHub Username | Token 所属 GitHub 用户名 |
| GitHub Token | 具有目标仓库 `Contents: Read and write` 权限的 Token |
| Branch | 同步写入的目标分支，默认为 `main` |
| Local Root Path | Vault 中允许同步的本地根目录 |

配置完成后可以执行“测试连接”。插件会检查 Token 对应用户、目标仓库、分支以及仓库写入权限，避免真正同步时才发现配置错误。

## 技术栈与项目结构

项目使用 TypeScript 开发，通过 Obsidian Plugin API 操作 Vault 和界面，通过 GitHub REST API 管理远端文件。

主要技术栈如下：

```text
TypeScript 5
Obsidian Plugin API
GitHub REST API
esbuild
CSS
```

项目结构比较精简：

```text
obsidian-git-syncer/
├── src/
│   └── main.ts          插件核心逻辑
├── docs/images/         README 截图
├── main.js              构建后的插件代码
├── manifest.json        Obsidian 插件清单
├── styles.css           设置页和同步中心样式
├── versions.json        插件版本与最低 Obsidian 版本映射
├── esbuild.config.mjs   构建配置
└── package.json         依赖和脚本
```

当前版本为 `0.1.21`，最低支持 Obsidian `1.5.0`。构建工具使用 esbuild，将 `src/main.ts` 打包为 Obsidian 可以加载的 CommonJS 文件：

```javascript
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2020",
  outfile: "main.js"
});
```

## 整体架构

插件内部可以划分为四个主要部分：

```text
Obsidian 交互层
  - Ribbon 菜单
  - 编辑器右键菜单
  - 同步中心 Modal
  - 设置页面

本地文件层
  - 扫描 Vault 文件
  - 读取 Markdown 和二进制资源
  - 创建目录与写入远端文件
  - 管理本地同步状态

同步判断层
  - 路径映射
  - Git Blob SHA 计算
  - 本地与远端状态比较
  - 冲突检测与失败处理

GitHub API 层
  - Repository / Branch 校验
  - Contents API 读写文件
  - Git Trees API 扫描远端目录
  - 远端文件删除与拉取
```

数据流如下：

```text
Local Root Path 下的本地文件
              ↓
      计算相对路径和内容 SHA
              ↓
读取 GitHub content/ 目录树和 Blob SHA
              ↓
   判断文件状态并展示到同步中心
              ↓
用户选择同步、拉取或删除操作
              ↓
       调用 GitHub REST API
              ↓
       更新本地状态与界面
```

## 为什么固定操作 `content/` 目录

插件最重要的边界之一，是只读写远端仓库的 `content/` 目录。

例如，本地同步目录设置为 `posts`：

```text
posts/java/JVM.md
```

同步到 GitHub 后会变成：

```text
content/java/JVM.md
```

如果 Local Root Path 设置为 Vault 根目录 `/`：

```text
demo.md       -> content/demo.md
images/a.png  -> content/images/a.png
```

这样设计有几个好处：

1. **降低误操作范围**：插件不会修改博客项目的源码、配置和构建脚本；
2. **保持路径清晰**：所有同步文件都集中在一个内容根目录；
3. **方便博客构建**：静态站点只需要监听或读取 `content/`；
4. **便于权限和逻辑校验**：每次远端操作前都可以验证路径边界。

项目中通过 `isSafeContentPath()` 检查远端路径：

```typescript
function isSafeContentPath(path: string): boolean {
  const normalized = normalizePath(path).replace(/^\/+/, "");
  const segments = normalized.split("/");

  return normalized.startsWith("content/")
    && !segments.some((segment) => segment === ".." || segment === "");
}
```

除了要求路径以 `content/` 开头，还会拒绝 `..` 和空路径片段，避免路径逃逸或错误写入。

## 不依赖本地 Git，直接调用 GitHub API

Obsidian Git Syncer 没有要求用户在本机安装 Git，也不需要把目标博客仓库克隆到 Vault 中。

插件使用 Obsidian 提供的 `requestUrl()` 调用 GitHub REST API：

```typescript
const response = await requestUrl({
  url: this.buildGitHubApiUrl(path, params),
  method,
  headers: {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${this.settings.githubToken.trim()}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28"
  },
  body: payload ? JSON.stringify(payload) : undefined
});
```

主要使用两类 GitHub API：

### Contents API

Contents API 用于读取、创建、更新和删除具体文件：

```text
GET    /repos/{owner}/{repo}/contents/{path}
PUT    /repos/{owner}/{repo}/contents/{path}
DELETE /repos/{owner}/{repo}/contents/{path}
```

新增或更新文件时，插件把内容编码为 Base64，并生成对应的提交信息：

```text
sync: add content/java/demo.md
sync: update content/java/demo.md
sync: delete content/java/demo.md
```

### Git Trees API

如果对每个文件分别请求 Contents API，同步中心加载时会产生大量网络请求。因此，插件使用 Git Trees API 递归读取目标分支的目录树：

```text
GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1
```

拿到完整目录树后，只保留 `content/` 下的普通文件，再与本地文件进行比较。这种方式更适合一次性构建同步中心的文件状态列表。

## 文件状态是怎样判断的

同步工具的难点不只是上传文件，更重要的是准确回答：本地和远端到底是否一致？

插件为同步中心定义了四种状态：

| 本地文件 | 远端文件 | 内容关系 | 状态 |
| --- | --- | --- | --- |
| 存在 | 不存在 | — | 未发布 |
| 存在 | 存在 | 内容不同 | 已修改 |
| 存在 | 存在 | 内容一致 | 已发布 |
| 不存在 | 存在 | — | 本地已删除 |

GitHub 目录树中的文件 `sha` 不是普通文件内容的 SHA-1，而是 Git Blob SHA。它的计算方式是：

```text
SHA-1("blob " + 文件字节长度 + "\0" + 文件原始字节)
```

项目中使用 Web Crypto API 计算本地文件的 Git Blob SHA：

```typescript
async function gitBlobSha(input: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(input);
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const payload = new Uint8Array(header.byteLength + bytes.byteLength);

  payload.set(header, 0);
  payload.set(bytes, header.byteLength);

  const digest = await crypto.subtle.digest("SHA-1", payload);
  return toHex(new Uint8Array(digest));
}
```

这样可以直接比较：

```text
本地计算出的 Git Blob SHA === GitHub Tree 返回的 SHA
```

如果相同，就说明本地和远端文件字节完全一致，不需要依赖文件修改时间，也不需要下载远端文件内容再比较。

插件还会保存最近一次同步时间、本地内容哈希、远端 SHA 和 GitHub 页面地址。这些缓存可以提升单篇文章状态判断和界面交互体验，但同步中心仍会以本地文件和远端目录树的真实状态为基础进行比较。

## 同时支持 Markdown 和二进制资源

博客内容不只有 Markdown，通常还会包含 PNG、JPEG、WebP、PDF 等附件。

插件针对文本和二进制文件使用不同的 Obsidian Vault API：

```text
Markdown：vault.read() / vault.modify()
二进制：vault.readBinary() / vault.modifyBinary()
```

上传时：

```typescript
const isMarkdown = file.extension === "md";
const content = isMarkdown ? await this.app.vault.read(file) : "";
const binaryContent = isMarkdown
  ? new TextEncoder().encode(content).buffer
  : await this.app.vault.readBinary(file);
```

随后统一转换为 Base64，交给 GitHub Contents API。

拉取远端文件时也会根据扩展名选择文本或二进制写入方式，并在本地父目录不存在时逐级创建目录。因此，文章和图片可以保持原有相对路径一起同步。

## 更新冲突与自动重试

通过 GitHub Contents API 更新已有文件时，需要提交当前远端文件的 SHA。如果远端文件已经被其他操作修改，本地缓存的 SHA 就可能过期，GitHub 会返回 `409` 或 `422`。

插件的处理方式是：

```text
使用缓存 SHA 尝试写入
-> GitHub 返回 409 / 422
-> 重新查询远端文件
-> 获取最新 SHA
-> 再次提交更新
```

对应逻辑如下：

```typescript
try {
  result = await putContent(cachedSha);
} catch (error) {
  if (
    error instanceof GitHubRequestError
    && (error.status === 409 || error.status === 422)
  ) {
    const remote = await this.getRemoteContent(remotePath);
    result = await putContent(remote?.sha);
  } else {
    throw error;
  }
}
```

这不是完整的多人协作合并机制，但可以处理远端 SHA 缓存失效等常见情况，减少用户手动刷新后重试的次数。

## 同步中心的批量处理

同步中心不是简单地遍历文件并调用上传接口，还需要管理选择状态、目录折叠、操作状态和失败结果。

目录节点采用树形结构组织：

```typescript
interface SyncTreeNode {
  name: string;
  path: string;
  children: Map<string, SyncTreeNode>;
  items: SyncCenterItem[];
}
```

选择一个目录时，会递归选择该目录下的所有文件。目录复选框同时支持选中、未选中和部分选中的状态。

批量同步采用逐文件处理方式。一个文件失败不会中断整批任务，最终会汇总成功数量、失败数量以及第一条失败原因：

```text
同步完成：成功 8，失败 2
失败原因：images/demo.png：GitHub HTTP 403；另有 1 个失败
```

逐文件处理的速度不如并发上传快，但更容易控制 GitHub API 请求频率，也能降低多个文件同时失败时的排查难度。对于个人博客的常见文件规模，这种实现更稳妥。

## 文章 Frontmatter 模板

除了同步功能，插件还提供“插入文章属性”操作，可以为当前 Markdown 文件生成博客 Frontmatter：

```yaml
---
title: 文章标题
slug: article-slug
date: 2026-07-13
category: 开发
tags:
  - Java
  - NextJS
description: 文章摘要
cover:
published: true
---
```

标题默认使用 Obsidian 文件名，`slug` 会根据标题自动生成。如果文章已经存在 Frontmatter，插件不会重复插入。

这项功能虽然简单，但可以让“新建文章—补充元数据—发布到 GitHub”的流程都留在 Obsidian 中完成。

## 权限与安全边界

GitHub Token 建议使用 Fine-grained personal access token，只授权目标博客仓库，并把 Repository permissions 中的 `Contents` 设置为 `Read and write`。

插件还增加了几层限制：

- 仓库地址只接受 GitHub HTTPS、SSH 或 `owner/repo` 格式；
- 测试连接时校验 Token 用户与配置用户名；
- 检查 Token 是否具有目标仓库写权限；
- 检查目标分支是否存在；
- 所有远端文件操作都限制在 `content/`；
- 隐藏文件、`.DS_Store`、`Thumbs.db` 等系统文件不会同步；
- GitHub Token 输入框使用密码类型显示。

需要注意，Token 会通过 Obsidian 插件数据保存在本地配置中，并不是硬件级密钥存储。不要把包含插件配置的目录公开上传，也不要为 Token 授予超出实际需要的仓库权限。如果 Token 泄漏，应立即在 GitHub 中撤销并重新生成。

## 安装与使用

### 使用 BRAT 安装

1. 在 Obsidian 中安装并启用 BRAT；
2. 打开 BRAT 设置，选择添加 Beta plugin；
3. 输入项目地址：

```text
https://github.com/imliusx/obsidian-git-syncer
```

4. 安装完成后，在第三方插件列表中启用 Obsidian Git Syncer。

### 手动安装

从项目的 GitHub Release 下载：

```text
main.js
manifest.json
styles.css
```

放入 Vault 的插件目录：

```text
.obsidian/plugins/obsidian-git-syncer/
```

重新加载 Obsidian 后启用插件。

### 基本使用流程

```text
1. 创建 GitHub Fine-grained Token
2. 配置目标仓库、用户名、Token 和分支
3. 选择 Vault 中的 Local Root Path
4. 点击“测试连接”
5. 打开同步中心
6. 检查未发布和已修改文件
7. 选择文件或目录并点击“同步本地”
```

同步成功后，文件会出现在目标仓库的 `content/` 目录，并产生对应的 Git 提交。

## 本地开发与构建

克隆项目：

```bash
git clone https://github.com/imliusx/obsidian-git-syncer.git
cd obsidian-git-syncer
```

安装依赖：

```bash
npm install
```

开发监听：

```bash
npm run dev
```

正式构建：

```bash
npm run build
```

发布 BRAT Release 时，需要确保以下文件中的版本号保持一致：

```text
package.json
package-lock.json
manifest.json
versions.json
```

Release 中还需要包含 `main.js`、`manifest.json` 和 `styles.css`，BRAT 才能正常安装插件。

## 当前限制与后续计划

项目目前聚焦于 GitHub `content/` 目录的文件级同步，因此仍有一些可以继续完善的方向：

- 增加更完整的同步日志和请求调试界面；
- 支持附件路径重写和更灵活的图片处理策略；
- 增加同步前预览和危险操作二次确认；
- 优化大量文件场景下的分页、并发和 API 限流处理；
- 处理更复杂的本地与远端同时修改冲突；
- 增加自动化测试和多平台兼容性验证；
- 进一步完善移动端交互体验。

插件的目标并不是实现一个完整的 Git 客户端，而是把个人博客最常用的内容同步操作做好：看得见状态、选得准文件、控制住目录、失败后知道原因。

## 总结

Obsidian Git Syncer 打通了 Obsidian Vault 与 GitHub 内容仓库之间的发布链路。

从使用角度看，它提供了可视化同步中心，让文章、图片和资源文件可以按状态批量同步、拉取或删除。

从技术实现看，项目主要解决了这些问题：

```text
Vault 本地路径到 GitHub content/ 的安全映射
GitHub Contents API 与 Git Trees API 的组合使用
Markdown 和二进制文件的统一同步
基于 Git Blob SHA 的文件状态判断
远端 SHA 变化后的冲突重试
本地、远端双向文件操作
批量任务中的独立错误处理
Obsidian 原生设置页、菜单和 Modal 交互
```

如果你的博客同样采用“Markdown 内容仓库 + 自动构建”的模式，希望在 Obsidian 中完成从写作到发布的主要流程，可以尝试这个插件。

项目地址：[https://github.com/imliusx/obsidian-git-syncer](https://github.com/imliusx/obsidian-git-syncer)
