---
title: Shadraw Studio 项目复盘：AI 生图工作台的架构设计与部署实践
slug: shadraw-studio-ai-image-workbench-architecture
date: 2025-05-24
category: 项目
tags:
  - Shadraw Studio
  - AI 生图
  - Go
  - React
  - Docker
  - 项目复盘
description: Shadraw Studio 是一个面向设计师、内容创作者和 AI 图片爱好者的在线 AI 生图工作台，提供提示词编排、模型参数控制、图片社区、历史记录、收藏管理、系统设置和管理后台。内容围绕项目功能、技术选型、前后端架构、鉴权设计、对象存储、生图任务、数据库迁移和生产部署展开。
cover:
published: true
---

## 项目背景

AI 生图工具越来越多，但很多工具要么偏向单次体验，要么缺少作品管理和社区展示能力。对于经常使用 AI 图片能力的人来说，只能生成图片还不够，还需要一套完整的工作台来管理提示词、参数、历史记录、收藏和公开作品。

[Shadraw Studio](https://github.com/imliusx/shadraw-studio) 就是围绕这个需求做的一个在线 AI 生图工作台。它面向设计师、内容创作者和 AI 图片爱好者，核心目标是把“生图参数配置、任务执行、图片保存、社区展示、账号权限、后台配置”这些能力整合到一个项目里。

![](images/2026/07/04/img-20260704231503239.png)


![](images/2026/07/04/img-20260704231518326.png)

![](images/2026/07/04/img-20260704231528916.png)


![](images/2026/07/04/img-20260704231537792.png)


![](images/2026/07/04/img-20260704231600109.png)

项目功能包括：

- AI 生图控制台；
- 提示词和模型参数配置；
- 图片生成记录；
- 图片社区；
- 图片收藏；
- 用户登录注册；
- JWT 鉴权和 Refresh Token 轮换；
- 管理后台；
- 上游 AI 服务配置；
- 本地文件或 S3 兼容对象存储；
- binary + systemd 生产部署。

项目仓库采用前后端一体化 monorepo 结构，前端放在 `web/`，后端 Go module 放在仓库根目录，生产环境最终发布为一个 Go 二进制文件。

## 项目定位

Shadraw Studio 不是一个简单的 AI 生图 Demo，而是更接近一个可部署、可管理、可持续迭代的小型产品。

它解决几个实际问题：

### 1. 生图参数可控

用户可以配置提示词、模型、风格、尺寸比例、生成数量等参数。生成失败时，也能看到上游错误详情，方便调整参数。

### 2. 结果可管理

生成图片后，不只是临时展示，而是会保存为记录。用户可以回看历史生成结果，也可以收藏喜欢的图片。

### 3. 作品可公开

用户可以把生成记录公开到社区画廊。公开时还可以控制提示词是否公开，兼顾展示和隐私。

### 4. 站点可运营

管理员可以进入后台配置上游 AI 服务、站点标题、注册开关、用户状态等内容。

### 5. 部署足够简单

生产环境采用单进程、单端口模式。前端构建产物通过 Go `//go:embed` 嵌入二进制，线上没有 Node 进程，nginx 只需要反代一个后端端口。

图：Shadraw Studio 控制台页面截图

![](images/2026/07/04/shadraw-studio-console-page-placeholder.png)

## 技术选型

项目技术栈比较清晰，后端负责业务接口、鉴权、存储和上游调用，前端负责交互体验和图片工作台。

| 模块 | 技术 |
| --- | --- |
| 后端语言 | Go |
| HTTP 框架 | Gin |
| ORM | GORM v2 |
| 数据库 | PostgreSQL |
| 数据库迁移 | golang-migrate |
| 对象存储 | 本地文件系统 / MinIO / S3 |
| 鉴权 | JWT + HttpOnly Refresh Cookie |
| 日志 | log/slog JSON handler |
| 参数校验 | go-playground/validator |
| 前端框架 | React 19 |
| 构建工具 | Vite |
| 路由 | React Router v7 |
| 样式 | Tailwind CSS v4 |
| UI | shadcn/ui、Radix UI |
| 动效 | Motion |
| 部署 | systemd、nginx、Docker Compose 依赖服务 |


这套选型的特点是：后端足够轻、部署简单，前端交互能力强，适合一个独立开发者维护的完整产品。

## 目录结构

项目目录结构如下：

```text
shadraw-studio/
├── cmd/                Go 入口，包含 server 和迁移工具
├── internal/           Go 业务模块
├── migrations/         SQL 迁移文件
├── web/                Vite + React 前端工程
├── docs/               API、DB、后端和部署文档
├── deploy/             binary + systemd 生产部署脚本
├── go.mod              Go module 根
├── Dockerfile          容器镜像构建文件
└── docker-compose.yml  本地依赖 stack
```

后端 `internal/` 下按业务模块拆分：

```text
internal/
├── app/        启动引导、迁移、管理员初始化
├── auth/       登录注册、JWT、Refresh Token、密码处理
├── user/       用户模型和仓储
├── config/     环境变量配置读取
├── crypto/     AES-GCM 加密上游 API Key
├── httpx/      响应外壳、错误码、中间件、限流、校验
├── record/     生图记录、项目、收藏、公开状态
├── admin/      管理员配置、用户管理、站点设置
├── upstream/   上游 AI 服务调用
├── worker/     异步生图 worker pool
├── blob/       本地文件和 S3 对象存储
├── store/      GORM PostgreSQL 连接
└── web/        嵌入式前端资源和 SPA fallback
```

这种拆分方式的优点是边界清晰。鉴权、记录、上游调用、存储、管理后台都放在独立包中，后续扩展时不容易互相污染。

图：Shadraw Studio 后端 internal 目录截图

![](images/2026/07/04/shadraw-internal-package-structure-placeholder.png)

## 前后端一体化设计

项目的一个重要设计点是：生产环境只运行一个 Go 进程。

开发环境中，前端和后端分开运行：

```bash
# 后端
cp .env.example .env
go run ./cmd/server

# 前端
cd web
npm install
npm run dev
```

前端 dev server 默认运行在：

```text
http://localhost:3001
```

后端默认监听：

```text
http://localhost:8088
```

开发模式下，Vite proxy 会把 `/api/*` 请求转发到后端，避免手动配置 CORS。

生产环境则不同。前端执行 `vite build` 后，构建产物复制到：

```text
internal/web/dist/
```

Go 通过 `//go:embed` 把这些静态资源打进二进制。

最终线上只有一个服务：

```text
nginx
-> 127.0.0.1:8088
-> Go server 同时处理 API、静态资源和 SPA fallback
```

这样带来几个好处：

1. 线上不需要 Node 进程；
2. nginx 只需要配置一个 upstream；
3. 前端使用相对路径访问 API；
4. 减少 CORS 和多服务部署差异；
5. 发布物就是一个二进制文件。

图：internal/web/embed.go 源码截图

![](images/2026/07/04/shadraw-go-embed-web-dist-placeholder.png)

## API 设计规范

项目 API 统一挂在：

```text
/api/v1
```

响应格式统一为：

```json
{
  "data": {},
  "error": null,
  "meta": {}
}
```

错误响应：

```json
{
  "data": null,
  "error": {
    "code": "validation_failed",
    "message": "参数校验失败",
    "fields": {
      "email": "邮箱格式不合法"
    }
  }
}
```

错误码白名单包括：

| code | 含义 |
| --- | --- |
| `validation_failed` | 请求参数不合法 |
| `unauthorized` | 未登录或凭证无效 |
| `forbidden` | 无权访问 |
| `account_disabled` | 账号被禁用 |
| `not_found` | 资源不存在 |
| `conflict` | 资源冲突 |
| `rate_limited` | 命中限流 |
| `internal_error` | 服务端异常 |
| `upstream_error` | 上游接口异常 |

这里有一个细节：JSON 中的 ID 永远使用字符串。

例如：

```json
{
  "id": "12",
  "email": "alice@example.com",
  "displayName": "Alice"
}
```

这样可以避免前端 JavaScript Number 精度问题，尤其是数据库使用 `BIGSERIAL` 时更安全。

图：Shadraw Studio API 响应结构截图

![](images/2026/07/04/shadraw-api-response-wrapper-placeholder.png)

## 鉴权设计

Shadraw Studio 使用 Access Token + Refresh Token 的组合。

### Access Token

Access Token 使用 JWT，签名算法是 HS256，有效期 15 分钟。

特点：

- 放在 `Authorization: Bearer <accessToken>` 请求头；
- 用于访问受保护接口；
- 过期时间短，即使泄露风险也相对可控。

JWT 相关库使用：[golang-jwt/jwt](https://github.com/golang-jwt/jwt)。

### Refresh Token

Refresh Token 通过 HttpOnly Cookie 下发：

```http
Set-Cookie: shadraw_refresh=<opaque>; Path=/api/v1/auth; Max-Age=604800; HttpOnly; SameSite=Lax
```

它有几个关键设计：

1. 浏览器 JavaScript 不读取 Refresh Token；
2. 数据库存储的是 `sha256(rawRefreshToken)`，原值不入库；
3. Refresh Token 有效期 7 天；
4. 每次刷新 Access Token 时会轮换 Refresh Token；
5. 旧 Refresh Token 会立即失效；
6. 修改密码后撤销所有 Refresh Token。

刷新流程：

```text
Access Token 过期
-> 前端请求 /auth/refresh
-> 后端读取 HttpOnly Cookie
-> 校验 refresh token hash
-> 签发新的 access token
-> 轮换新的 refresh cookie
-> 撤销旧 refresh token
```

这种设计比把长期 token 存在 localStorage 更安全。

### 密码处理

用户密码使用 bcrypt 存储，cost=12。

Go 相关库来自 `golang.org/x/crypto/bcrypt`，文档地址：[bcrypt package](https://pkg.go.dev/golang.org/x/crypto/bcrypt)。

数据库中只保存密码 hash，不保存明文密码。

图：refresh_tokens 表 token_hash 字段截图

![](images/2026/07/04/shadraw-refresh-token-hash-placeholder.png)

## 用户与管理员体系

项目内置了用户角色：

```text
admin
user
```

数据库中使用 `CHECK` 约束限制角色取值，而不是 PostgreSQL ENUM。

```sql
role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('admin','user'))
```

这样迁移和回滚更灵活。

管理员能力包括：

- 用户管理；
- 禁用账号；
- 站点标题配置；
- 注册开关；
- 上游 AI 服务配置；
- API Key 管理；
- 生图运行限制配置。

首次启动时，应用层会执行管理员引导逻辑，根据 `ADMIN_EMAIL` 创建首位管理员，并输出临时密码。这样迁移文件里不需要写 seed 数据，避免环境差异。

## 生图记录设计

生图记录是项目核心业务之一。

一条记录通常会包含：

- 用户 ID；
- 提示词；
- 模型参数；
- 图片路径；
- 生成状态；
- 上游错误信息；
- 是否公开；
- 是否公开提示词；
- 发布时间。

后续迁移中增加了社区相关字段：

```sql
ALTER TABLE records
    ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN published_at TIMESTAMPTZ;
```

并为公开画廊增加部分索引：

```sql
CREATE INDEX idx_records_public_gallery
ON records (published_at DESC, id DESC)
WHERE is_public = TRUE AND status = 'completed' AND image_path IS NOT NULL;
```

这个索引很有针对性。社区画廊只需要查询公开、已完成、有图片的记录，所以使用 partial index 可以减少索引体积，提高分页查询效率。

提示词公开状态单独建字段：

```sql
ALTER TABLE records
    ADD COLUMN prompt_public BOOLEAN NOT NULL DEFAULT TRUE;
```

这样用户可以公开图片，但选择不公开提示词。

图：records 公开画廊 partial index 截图

![](images/2026/07/04/shadraw-records-public-gallery-index-placeholder.png)

## 收藏功能设计

收藏功能使用单独表维护用户与公开记录之间的关系。

```sql
CREATE TABLE record_favorites (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    record_id   BIGINT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

这里需要注意幂等问题。

用户连续点击收藏按钮，或者网络重试时，可能重复提交收藏请求。更稳妥的设计是增加唯一索引：

```sql
CREATE UNIQUE INDEX uq_record_favorites_user_record
ON record_favorites (user_id, record_id);
```

如果已有业务逻辑保证幂等，也要在 service 层处理重复收藏和取消收藏。

收藏功能看起来简单，但它连接了用户系统、社区公开状态和记录权限判断。比如用户不能收藏未公开的私密记录，管理员查看时也要区分普通用户视角和管理视角。

## 对象存储设计

图片文件不适合直接存数据库。Shadraw Studio 通过 `blob` 模块抽象了两种存储方式：

```text
local 文件系统
S3 兼容对象存储
```

本地存储路径类似：

```text
DATA_DIR/images/user-<id>/<record-uuid>.<ext>
```

数据库只保存相对路径。

使用 MinIO / S3 时，配置如下：

```bash
BLOB_DRIVER=s3
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=shadraw
S3_ACCESS_KEY_ID=shadraw
S3_SECRET_ACCESS_KEY=shadrawsecret
S3_USE_PATH_STYLE=true
```

MinIO 控制台默认访问：

```text
http://localhost:9001
```

S3 相关能力基于 AWS SDK for Go v2，文档地址：[AWS SDK for Go v2](https://aws.github.io/aws-sdk-go-v2/docs/)。

项目还提供了本地图片迁移到 S3 的工具：

```bash
S3_ENDPOINT=http://localhost:9000 \
S3_BUCKET=shadraw \
S3_ACCESS_KEY_ID=shadraw \
S3_SECRET_ACCESS_KEY=shadrawsecret \
go run ./cmd/migrate-blobs -data-dir ./data
```

支持预览：

```bash
go run ./cmd/migrate-blobs -dry-run -data-dir ./data
```

支持校验：

```bash
go run ./cmd/migrate-blobs -verify-only -data-dir ./data
```

这一点很实用。很多项目一开始用本地文件，后面再切对象存储，如果没有迁移工具，会非常麻烦。

图：MinIO bucket 中 images 目录截图

![](images/2026/07/04/shadraw-minio-images-bucket-placeholder.png)

## 上游 AI 服务配置

AI 生图能力通常依赖上游模型服务。Shadraw Studio 把上游配置放到管理后台，由管理员维护。

上游配置中可能包含敏感信息，例如 API Key。项目使用 `MASTER_KEY` 做 AES-GCM 加密，避免明文 API Key 直接落库。

环境变量要求：

```bash
MASTER_KEY=<32 bytes base64>
```

这类设计非常关键。因为上游 API Key 一旦泄露，可能造成额度损失或安全风险。

需要注意：如果做数据迁移，源环境和目标环境的 `MASTER_KEY` 必须一致，否则旧数据无法解密。

部署文档中也专门提到：

```text
admin 上游配置解密失败：确认 MASTER_KEY 和导出数据的源环境一致。
```

图：upstream_configs 表加密字段截图

![](images/2026/07/04/shadraw-upstream-config-encrypted-key-placeholder.png)

## 异步生图 Worker

AI 生图通常不是一个毫秒级请求。上游调用可能耗时较长，也可能失败、超时或返回错误。

如果在 HTTP 请求线程里直接阻塞等待，用户体验和服务稳定性都会变差。

项目中通过 `worker` 模块实现异步生图 worker pool。

比较合理的任务流是：

```text
用户提交生图请求
-> 创建 records 记录，状态为 pending
-> 投递到 worker pool
-> worker 调用上游 AI 服务
-> 成功后保存图片到 blob store
-> 更新 records 状态为 completed
-> 失败后记录 upstream_error
```

这样做的好处：

1. HTTP 接口可以快速返回；
2. 生成状态可追踪；
3. 上游失败能落库；
4. 后续可以扩展队列、重试和限流；
5. 管理后台可以配置运行限制。

如果未来用户量增加，可以把内存 worker pool 替换成 Redis Stream、RabbitMQ 或其他消息队列，实现更强的异步任务能力。

图：worker pool 生图任务状态日志截图

![](images/2026/07/04/shadraw-worker-pool-generation-log-placeholder.png)

## 数据库迁移规范

项目使用 `golang-migrate/migrate` 管理 SQL 迁移，官方仓库：[golang-migrate/migrate](https://github.com/golang-migrate/migrate)。

迁移文件命名方式：

```text
001_common.up.sql
001_common.down.sql
002_users.up.sql
002_users.down.sql
```

规则比较明确：

- 每条迁移可独立回滚；
- `migrate-down 1` 撤销最近一条；
- 合并到主分支后不再修改既有迁移；
- 修正问题通过新增迁移完成；
- 不在迁移中写 seed；
- 管理员引导由应用层完成。

表结构中有几个值得注意的点：

### 1. 邮箱使用 CITEXT

```sql
CREATE EXTENSION IF NOT EXISTS citext;
```

`CITEXT` 可以让邮箱大小写不敏感地唯一。

例如下面两个邮箱应该被视为同一个账号：

```text
Alice@example.com
alice@example.com
```

### 2. 时间使用 TIMESTAMPTZ

统一使用带时区时间，避免跨环境时间混乱。

### 3. 使用触发器维护 updated_at

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

每张需要更新时间的表都可以挂触发器，避免业务代码漏更新。

图：migrations 目录 SQL 迁移文件截图

![](images/2026/07/04/shadraw-migrations-directory-placeholder.png)

## 前端设计

前端使用 Vite + React 19 + React Router v7，UI 体系基于 Tailwind CSS v4、shadcn/ui、Radix UI 和 Lucide React。

前端主要页面包括：

- 登录页；
- AI 生图控制台；
- 图片社区；
- 设置页；
- 管理后台。

项目中的 UI 依赖包括：

```json
{
  "react": "^19.2.6",
  "react-router": "^7.9.5",
  "tailwindcss": "^4.3.0",
  "radix-ui": "^1.4.3",
  "lucide-react": "^1.14.0",
  "motion": "^12.38.0",
  "react-photo-album": "^3.6.0",
  "react-resizable-panels": "^4.11.0"
}
```

`react-photo-album` 适合做图片瀑布流或相册展示，项目里的社区画廊可以基于它实现更好的图片浏览体验。

前端构建命令：

```bash
cd web
npm run build
```

类型检查：

```bash
npm run typecheck
```

Lint：

```bash
npm run lint
```

图：Shadraw Studio 社区画廊页面截图

![](images/2026/07/04/shadraw-community-gallery-page-placeholder.png)

## 生产部署设计

项目生产部署采用 binary + systemd 模式。

部署结构：

```text
host nginx (TLS, 80/443)
  -> 127.0.0.1:8088 (shadraw-api systemd service)
       -> localhost:5432 (Postgres docker dependency)
       -> localhost:9000 (MinIO docker dependency)
```

也就是说：

- API 不跑在 Docker 容器里；
- API 由 systemd 管理；
- Postgres 和 MinIO 由 Docker Compose 管理；
- nginx 对外提供 HTTPS；
- Go server 同时处理 API 和前端静态资源。

systemd 官方文档：[systemd](https://systemd.io/)。

这种部署方式适合个人 VPS 或轻量服务器：依赖服务容器化，主应用用 systemd 管理，定位问题也比较直观。

### 本地构建二进制

```bash
./deploy/build-binary.sh
```

输出：

```text
bin/server-linux-amd64
```

### 上传到 VPS

```bash
./deploy/deploy-binary.sh user@vps /opt/shadraw-studio
```

上传内容包括：

- Go 二进制；
- migrations；
- systemd unit；
- Docker Compose 依赖文件；
- `.env.prod.example`；
- 数据恢复脚本；
- 停服脚本。

### 启动依赖服务

```bash
docker compose -f docker-compose.deps.yml --env-file .env up -d
```

### 启动 API

```bash
sudo cp shadraw-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable shadraw-api
sudo systemctl restart shadraw-api
```

查看日志：

```bash
sudo journalctl -u shadraw-api -f
```

健康检查：

```bash
curl http://127.0.0.1:8088/healthz
```

图：systemctl status shadraw-api 截图

![](images/2026/07/04/shadraw-systemd-status-placeholder.png)

## nginx 单 upstream

因为前端资源和后端 API 都由同一个 Go server 提供，所以 nginx 配置非常简单：

```nginx
location / {
    proxy_pass         http://127.0.0.1:8088;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
}
```

这比“前端一个 location、后端一个 location、还要处理 CORS 和 API_BASE_URL”的方式更简单。

线上路径由 Go server 统一处理：

```text
/api/v1/*   业务接口
/healthz    健康检查
/assets/*   前端静态资源
/*          SPA fallback
```

图：nginx 反代 shadraw-api 配置截图

![](images/2026/07/04/shadraw-nginx-upstream-config-placeholder.png)

## 配置管理

项目配置主要来自环境变量。

关键配置包括：

| 变量 | 说明 |
| --- | --- |
| `PORT` | 服务监听端口 |
| `LOG_LEVEL` | 日志级别 |
| `DB_DSN` | PostgreSQL 连接串 |
| `JWT_SECRET` | JWT 签名密钥 |
| `ADMIN_EMAIL` | 首位管理员邮箱 |
| `MASTER_KEY` | 加密上游 API Key |
| `BLOB_DRIVER` | `local` 或 `s3` |
| `DATA_DIR` | 本地数据目录 |
| `S3_ENDPOINT` | S3 / MinIO endpoint |
| `S3_BUCKET` | 图片 bucket |
| `S3_ACCESS_KEY_ID` | S3 access key |
| `S3_SECRET_ACCESS_KEY` | S3 secret key |

配置读取集中在 `internal/config` 包里，并做必填校验。

这比在业务代码里到处读取环境变量更好维护，也更容易在启动阶段快速失败。

生产环境中需要重点保护：

```text
JWT_SECRET
MASTER_KEY
DB_DSN
S3_SECRET_ACCESS_KEY
上游 API Key
```

这些信息不要提交到 Git，也不要写进前端构建产物。

## 日志与排查

项目后端使用 Go 标准库 `log/slog` JSON handler。

结构化日志适合后续接入日志系统，例如 Loki、ELK 或云厂商日志服务。

常见排查命令：

```bash
sudo journalctl -u shadraw-api -f
sudo journalctl -u shadraw-api -n 100 --no-pager
curl http://127.0.0.1:8088/healthz
docker compose -f docker-compose.deps.yml --env-file .env ps
```

部署文档里列出的故障方向也比较实用：

| 问题 | 排查方向 |
| --- | --- |
| API 起不来 | 查看 `journalctl` 日志 |
| 数据库连不上 | 检查 Postgres 容器状态和 `DB_DSN` |
| 图片加载失败 | 检查 `S3_ENDPOINT`、bucket 和数据库路径 |
| API Key 解密失败 | 检查 `MASTER_KEY` 是否一致 |
| nginx 502 | 本机访问 `/healthz` 验证 API 是否正常 |

图：journalctl shadraw-api JSON 日志截图

![](images/2026/07/04/shadraw-journalctl-json-log-placeholder.png)

## 测试与质量控制

项目 Makefile 中提供了常用开发命令：

```bash
make run
make test
make lint
make migrate-up
make migrate-down
make migrate-new NAME=add_xxx
```

后端测试覆盖多个模块：

```text
auth
blob
record
worker
admin
web embed
```

测试类型包括：

- service mock 单测；
- handler 集成测试；
- JWT 测试；
- bcrypt 密码测试；
- S3 / blob 存储测试；
- worker pool 测试。

`make test` 包含 race 和 cover，这对于 Go 并发任务尤其重要。

前端则有：

```bash
npm run typecheck
npm run lint
npm run build
```

图：make test 测试结果截图

![](images/2026/07/04/shadraw-make-test-result-placeholder.png)

## 架构亮点

### 1. 单进程单端口部署

前端构建产物嵌入 Go 二进制，生产环境只暴露一个服务端口。部署、回滚、反代配置都更简单。

### 2. 同源 API 调用

前端使用相对路径访问 API，减少环境变量和 CORS 配置问题。

### 3. Refresh Token 使用 HttpOnly Cookie

长期凭证不暴露给前端 JavaScript，安全性更好。

### 4. API Key 加密落库

上游 API Key 不是明文保存，而是通过 `MASTER_KEY` 做 AES-GCM 加密。

### 5. 存储驱动可切换

本地文件系统和 S3 兼容对象存储都支持，并提供迁移工具。

### 6. 数据库迁移可回滚

迁移文件一一对应 up/down，生产环境变更更可控。

### 7. 社区查询使用部分索引

公开画廊只查询公开、完成、有图记录，partial index 能减少无效扫描。

## 可以继续优化的方向

### 1. 生图任务持久化队列

当前 worker pool 适合单机轻量场景。如果后续用户量增加，可以引入 RabbitMQ、Redis Stream 或 PostgreSQL 任务表，实现更强的任务恢复能力。

### 2. 图片处理链路增强

可以增加：

- 图片压缩；
- 缩略图；
- WebP 转换；
- 内容审核；
- 图片元数据提取。

### 3. 社区推荐能力

社区画廊可以增加排序维度：

```text
最新
最热
最多收藏
编辑推荐
按模型筛选
按风格筛选
```

### 4. 账号安全增强

可以增加：

- 登录失败次数限制；
- 邮箱验证；
- 两步验证；
- 登录设备管理；
- Refresh Token 设备维度管理。

### 5. 可观测性增强

可以增加 Prometheus 指标：

```text
接口耗时
生图任务耗时
上游调用失败率
worker 队列长度
图片上传失败次数
数据库连接池状态
```


图：Shadraw Studio 生图任务监控面板截图

![](images/2026/07/04/shadraw-generation-task-monitor-placeholder.png)

## 总结

Shadraw Studio 是一个比较完整的 AI 生图工作台项目，不只是前端页面或接口 Demo，而是覆盖了用户体系、鉴权、记录管理、社区展示、对象存储、上游配置、数据库迁移和生产部署。

项目最值得借鉴的地方有几个：

```text
前后端 monorepo 管理
Go embed 前端资源
单进程单端口部署
JWT + HttpOnly Refresh Cookie
上游 API Key 加密存储
local / S3 存储驱动切换
SQL 迁移可回滚
systemd 管理主服务
Docker Compose 管理依赖服务
```

对于个人项目来说，这种架构的平衡点不错：既不像纯 Demo 那样缺少工程化，也没有引入过多复杂基础设施。

如果后续继续演进，可以重点加强任务队列、监控指标、图片处理、社区推荐和账号安全。这样 Shadraw Studio 会更接近一个真正可运营、可扩展、可长期维护的 AI 图片产品。
