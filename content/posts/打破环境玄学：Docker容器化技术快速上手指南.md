---
title: 打破环境玄学：Docker容器化技术快速上手指南
slug: docker-containerization-quick-start-guide
date: 2026-06-28
category: 开发
tags:
  - Docker
  - 容器化
  - DevOps
  - Linux
  - 部署
description: Docker 能将应用程序及其依赖打包成轻量、可移植的容器，从而解决“我电脑能跑，服务器不能跑”的环境一致性问题。本文从 Docker 基本概念、安装方式、镜像与容器操作、数据管理、Dockerfile、Docker Compose 到常见实践，帮助你快速掌握容器化技术的核心用法。
cover:
published: true
---

## 引言

深夜 11 点，你咬着牙给同事发消息：

> 你这代码怕不是开过光？为什么在你电脑上能跑，到我这里就开始玄学报错？

你盯着终端里的 `NoSuchMethodError`、`ClassNotFoundException`、`ModuleNotFoundError` 陷入沉思：

- 明明本地 Java 17 跑得好好的，测试环境却还是 Java 8；
- 新同事刚 `git clone` 完项目，发现 Python 版本、Node 版本、数据库版本全都对不上；
- 老服务器上的 CentOS 像考古现场，装个依赖都要先翻三页历史文档；
- 明明只是启动一个项目，却要先安装 JDK、Maven、MySQL、Redis、Nginx，再配置一堆环境变量。

这就是经典的“环境玄学”：

```text
开发环境能跑 ≠ 测试环境能跑 ≠ 生产环境能跑
```

而 Docker 要解决的，正是这个问题。

Docker 可以把应用程序、运行时、系统依赖、配置文件一起打包成镜像，再通过容器运行起来。换句话说，它把“我这里能跑”的环境封装成一个可复制、可迁移、可部署的标准单元。

从此以后，你交付的是一套可以稳定运行的环境。

> Java 一次编译，到处 Debug？不，这次我要到处 Run。

## 概览

![](images/2026/06/29/img-20260629001532429.png)

本文会围绕以下内容展开：

1. Docker 是什么；
2. Docker 解决了什么问题；
3. 镜像、容器、仓库等核心概念；
4. Windows、Linux、macOS 下如何安装 Docker；
5. 如何运行第一个容器；
6. 镜像与容器的常用命令；
7. 数据卷、端口映射、网络等常见用法；
8. 如何编写 Dockerfile；
9. Docker Compose、Docker Machine、Docker Swarm 的定位；
10. 实际开发和部署中的最佳实践。

## Docker 简介

### 什么是 Docker？

Docker 是一个开源的容器化平台，可以将应用程序及其依赖打包成轻量、可移植的容器，并在不同环境中以一致的方式运行。

Docker 官网：

[Docker: Accelerated Container Application Development](https://www.docker.com/)

简单来说，Docker 做了三件事：

1. **打包环境**：把应用、依赖、运行时和配置封装成镜像；
2. **隔离运行**：每个应用运行在独立容器中，互不干扰；
3. **快速交付**：同一个镜像可以在开发、测试、生产环境中运行。

如果把传统部署比作“在每台机器上手动装修房子”，那么 Docker 更像是“把装修好的标准房间整体搬过去”。

### 为什么要使用 Docker？

Docker 的核心价值可以概括为一句话：

> 解决环境一致性问题，提高应用交付效率。

它主要解决以下痛点。

#### 1. 消除“我电脑能跑”的问题

传统部署中，开发机、测试机、生产服务器的系统版本、依赖版本、环境变量都可能不同。Docker 把这些内容封装到镜像中，减少环境差异带来的不确定性。

#### 2. 快速搭建开发环境

以前搭建一个项目可能要安装很多依赖：

- JDK；
- Maven；
- MySQL；
- Redis；
- Nginx；
- Node.js；
- Python。

使用 Docker 后，很多服务只需要一条命令就能启动。

例如启动 Redis：

```bash
docker run -d --name redis -p 6379:6379 redis:7
```

#### 3. 提高部署效率

应用构建成镜像后，可以统一发布到镜像仓库，再由不同环境拉取运行。部署流程更加标准化，也更适合 CI/CD 自动化流水线。

#### 4. 隔离不同项目的依赖

一个项目需要 MySQL 5.7，另一个项目需要 MySQL 8.0；一个项目需要 Node 16，另一个项目需要 Node 20。使用 Docker 后，不同项目可以运行在不同容器中，互不影响。

#### 5. 资源开销比虚拟机更低

Docker 容器共享宿主机内核，不需要像虚拟机那样模拟完整操作系统，因此启动更快、占用资源更少。

## Docker 架构

![](images/2026/06/29/img-20260629001532430.png)

Docker 的整体架构通常包括以下几个部分：

- **Docker Client**：客户端，用户通过 `docker` 命令与 Docker 交互；
- **Docker Daemon**：守护进程，负责构建、运行和管理容器；
- **Docker Image**：镜像，应用运行环境的只读模板；
- **Docker Container**：容器，由镜像创建出来的运行实例；
- **Docker Registry**：镜像仓库，用于存储和分发镜像，例如 Docker Hub。

当我们执行下面这条命令时：

```bash
docker run nginx
```

大致会发生这些事情：

1. Docker Client 把命令发送给 Docker Daemon；
2. Docker Daemon 检查本地是否存在 `nginx` 镜像；
3. 如果本地没有，就从镜像仓库拉取；
4. 使用该镜像创建并启动容器；
5. Nginx 服务在容器中运行。

## Docker 基本概念

### 镜像 Image

镜像可以理解为应用运行环境的“模板”或“安装包”。

它通常包含：

- 操作系统基础层；
- 应用运行时；
- 依赖库；
- 应用代码；
- 默认启动命令。

例如：

```bash
nginx:latest
mysql:8.0
redis:7
openjdk:17
node:20-alpine
```

镜像是只读的，不能直接修改。我们通常通过 Dockerfile 构建新的镜像。

### 容器 Container

容器是镜像运行起来之后的实例。

可以这样理解：

```text
镜像 = 类
容器 = 对象
```

同一个镜像可以启动多个容器。例如，用同一个 `nginx` 镜像可以启动多个互不影响的 Nginx 容器。

查看正在运行的容器：

```bash
docker ps
```

查看所有容器：

```bash
docker ps -a
```

### 仓库 Registry

镜像仓库用于存储和分发 Docker 镜像。

常见仓库包括：

- Docker Hub；
- GitHub Container Registry；
- 阿里云容器镜像服务；
- Harbor 私有镜像仓库。

拉取镜像：

```bash
docker pull nginx
```

推送镜像：

```bash
docker push username/my-app:1.0.0
```

## 安装 Docker

### Windows

Windows 推荐安装 Docker Desktop。安装前建议确认系统满足以下条件：

- Windows 10 / 11 64 位系统；
- 开启虚拟化；
- 推荐使用 WSL 2 后端；
- 已安装或允许 Docker Desktop 自动安装 WSL 相关组件。

安装步骤大致如下：

1. 进入 Docker 官网下载 Docker Desktop；
2. 安装过程中勾选 WSL 2 相关选项；
3. 安装完成后重启系统；
4. 打开 Docker Desktop，等待 Docker Engine 启动；
5. 在终端中执行验证命令。

![](images/2026/06/29/img-20260629001532430-1.png)

![](images/2026/06/29/img-20260629001532430-2.png)

![](images/2026/06/29/img-20260629001532430.bmp)

验证安装是否成功：

```bash
docker version
```

运行测试容器：

```bash
docker run hello-world
```

如果能看到 Docker 的欢迎信息，说明安装成功。

### Linux

以 Ubuntu 为例，可以使用官方仓库安装 Docker Engine。

卸载旧版本：

```bash
sudo apt-get remove docker docker-engine docker.io containerd runc
```

安装依赖：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
```

添加 Docker 官方 GPG key：

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
```

添加 Docker 软件源：

```bash
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

安装 Docker：

```bash
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

启动并设置开机自启：

```bash
sudo systemctl enable docker
sudo systemctl start docker
```

验证：

```bash
sudo docker run hello-world
```

如果不想每次都输入 `sudo`，可以将当前用户加入 `docker` 用户组：

```bash
sudo usermod -aG docker $USER
```

然后重新登录终端。

### macOS

macOS 推荐安装 Docker Desktop。

注意区分芯片架构：

- Intel 芯片：下载 Intel 版本；
- Apple Silicon 芯片：下载 Apple Chip 版本。

安装完成后，在终端中验证：

```bash
docker version
docker run hello-world
```

## 快速开始：运行第一个服务

我们用 Nginx 作为第一个示例。

拉取镜像：

```bash
docker pull nginx
```

启动容器：

```bash
docker run -d --name my-nginx -p 8080:80 nginx
```

参数说明：

- `-d`：后台运行；
- `--name my-nginx`：容器名称；
- `-p 8080:80`：将宿主机 8080 端口映射到容器 80 端口；
- `nginx`：使用的镜像名称。

访问：

```text
http://localhost:8080
```

如果看到 Nginx 欢迎页，说明容器已经正常运行。

停止容器：

```bash
docker stop my-nginx
```

再次启动容器：

```bash
docker start my-nginx
```

删除容器：

```bash
docker rm my-nginx
```

## 使用镜像

### 查看本地镜像

```bash
docker images
```

### 拉取镜像

```bash
docker pull redis:7
```

### 删除镜像

```bash
docker rmi redis:7
```

如果镜像正在被容器使用，需要先删除相关容器。

### 给镜像打标签

```bash
docker tag my-app:latest username/my-app:1.0.0
```

### 构建镜像

假设当前目录下有 Dockerfile，可以执行：

```bash
docker build -t my-app:1.0.0 .
```

其中：

- `-t`：指定镜像名称和标签；
- `.`：构建上下文目录。

## 使用容器

### 创建并启动容器

```bash
docker run -d --name redis-demo -p 6379:6379 redis:7
```

### 查看正在运行的容器

```bash
docker ps
```

### 查看所有容器

```bash
docker ps -a
```

### 查看容器日志

```bash
docker logs redis-demo
```

持续查看日志：

```bash
docker logs -f redis-demo
```

### 进入容器

```bash
docker exec -it redis-demo bash
```

有些轻量镜像不包含 `bash`，可以使用 `sh`：

```bash
docker exec -it redis-demo sh
```

### 停止容器

```bash
docker stop redis-demo
```

### 启动已停止的容器

```bash
docker start redis-demo
```

### 删除容器

```bash
docker rm redis-demo
```

强制删除运行中的容器：

```bash
docker rm -f redis-demo
```

## 数据管理

容器的文件系统是临时的。容器删除后，容器内部新增的数据通常也会随之消失。

因此，对于数据库、上传文件、配置文件等需要长期保存的数据，应该使用数据卷或目录挂载。

### 数据卷 Volume

创建数据卷：

```bash
docker volume create mysql-data
```

查看数据卷：

```bash
docker volume ls
```

使用数据卷启动 MySQL：

```bash
docker run -d \
  --name mysql-demo \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=123456 \
  -v mysql-data:/var/lib/mysql \
  mysql:8.0
```

这里的：

```bash
-v mysql-data:/var/lib/mysql
```

表示将 Docker 数据卷 `mysql-data` 挂载到容器内的 `/var/lib/mysql` 目录。

### 目录挂载 Bind Mount

也可以将宿主机目录挂载到容器中：

```bash
docker run -d \
  --name nginx-demo \
  -p 8080:80 \
  -v $(pwd)/html:/usr/share/nginx/html \
  nginx
```

这种方式适合开发环境，因为本地文件修改后，容器中可以立即看到变化。

### Volume 和 Bind Mount 的区别

| 方式 | 特点 | 适用场景 |
| --- | --- | --- |
| Volume | 由 Docker 管理，跨平台体验更一致 | 数据库数据、生产环境持久化 |
| Bind Mount | 直接挂载宿主机目录，路径更直观 | 本地开发、配置文件挂载 |

## 网络与端口映射

容器默认运行在隔离网络中。外部访问容器服务时，通常需要端口映射。

```bash
docker run -d -p 8080:80 nginx
```

含义是：

```text
宿主机 8080 端口 → 容器 80 端口
```

查看 Docker 网络：

```bash
docker network ls
```

创建自定义网络：

```bash
docker network create app-network
```

让多个容器加入同一个网络：

```bash
docker run -d --name redis --network app-network redis:7
docker run -d --name app --network app-network my-app:1.0.0
```

在同一个 Docker 网络中，容器之间可以通过容器名访问。例如应用容器可以通过 `redis:6379` 访问 Redis。

## 编写 Dockerfile

Dockerfile 是用来构建镜像的脚本文件。它描述了镜像应该基于什么环境、复制哪些文件、安装哪些依赖，以及容器启动时执行什么命令。

下面以一个 Spring Boot 项目为例。

### Java 应用 Dockerfile 示例

```dockerfile
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

COPY target/app.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
```

说明：

- `FROM`：指定基础镜像；
- `WORKDIR`：指定工作目录；
- `COPY`：复制文件到镜像中；
- `EXPOSE`：声明容器内服务端口；
- `ENTRYPOINT`：指定容器启动命令。

构建镜像：

```bash
docker build -t springboot-demo:1.0.0 .
```

运行容器：

```bash
docker run -d --name springboot-demo -p 8080:8080 springboot-demo:1.0.0
```

### Node.js 应用 Dockerfile 示例

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "start"]
```

构建并运行：

```bash
docker build -t node-demo:1.0.0 .
docker run -d --name node-demo -p 3000:3000 node-demo:1.0.0
```

## Docker Compose

当一个项目只需要运行一个容器时，`docker run` 已经足够。但真实项目通常不止一个服务，例如：

- 后端应用；
- MySQL；
- Redis；
- Nginx；
- 消息队列。

如果每个服务都手写一条 `docker run` 命令，会很难维护。Docker Compose 可以用一个 YAML 文件描述多个容器服务，然后一键启动。

### docker-compose.yml 示例

```yaml
services:
  app:
    image: springboot-demo:1.0.0
    container_name: app
    ports:
      - "8080:8080"
    depends_on:
      - mysql
      - redis
    networks:
      - app-network

  mysql:
    image: mysql:8.0
    container_name: mysql
    environment:
      MYSQL_ROOT_PASSWORD: 123456
      MYSQL_DATABASE: demo
    ports:
      - "3306:3306"
    volumes:
      - mysql-data:/var/lib/mysql
    networks:
      - app-network

  redis:
    image: redis:7
    container_name: redis
    ports:
      - "6379:6379"
    networks:
      - app-network

volumes:
  mysql-data:

networks:
  app-network:
```

启动所有服务：

```bash
docker compose up -d
```

查看服务：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

停止并删除服务：

```bash
docker compose down
```

如果需要同时删除数据卷：

```bash
docker compose down -v
```

> 注意：现在推荐使用 `docker compose`，也就是 Compose V2；老版本命令 `docker-compose` 仍然常见，但已经不是首选写法。

## Docker 三剑客

早期 Docker 生态中常说“三剑客”：Docker Compose、Docker Machine、Docker Swarm。它们分别面向不同场景。

### Docker Compose

Docker Compose 主要用于定义和运行多容器应用。

适合场景：

- 本地开发环境；
- 中小型服务编排；
- 快速搭建依赖服务；
- 编写可复现的开发环境。

现在 Compose 依然非常常用，是开发者最应该优先掌握的工具之一。

### Docker Machine

Docker Machine 曾经用于在本地、云服务器或虚拟机中创建和管理 Docker 主机。

不过现在 Docker Desktop、云厂商容器服务、Kubernetes、Terraform 等工具已经更常见，因此 Docker Machine 更多属于历史工具，实际新项目中使用较少。

了解它的定位即可，不建议作为重点学习。

### Docker Swarm

Docker Swarm 是 Docker 原生的集群编排工具，可以把多台机器组织成一个 Docker 集群，并在集群中部署服务。

适合场景：

- 简单容器集群；
- 小规模服务编排；
- 不想引入 Kubernetes 的轻量化部署场景。

不过在大型生产环境中，Kubernetes 已经成为更主流的容器编排方案。Swarm 的优势是简单，Kubernetes 的优势是生态强大。

## 常用命令速查

| 操作 | 命令 |
| --- | --- |
| 查看 Docker 版本 | `docker version` |
| 查看系统信息 | `docker info` |
| 拉取镜像 | `docker pull nginx` |
| 查看镜像 | `docker images` |
| 删除镜像 | `docker rmi nginx` |
| 启动容器 | `docker run -d --name web nginx` |
| 查看运行中容器 | `docker ps` |
| 查看所有容器 | `docker ps -a` |
| 停止容器 | `docker stop web` |
| 启动容器 | `docker start web` |
| 删除容器 | `docker rm web` |
| 查看日志 | `docker logs -f web` |
| 进入容器 | `docker exec -it web sh` |
| 构建镜像 | `docker build -t my-app .` |
| 清理无用资源 | `docker system prune` |

## 常见问题排查

### 1. 端口被占用

如果启动容器时报错端口占用：

```text
Bind for 0.0.0.0:8080 failed: port is already allocated
```

说明宿主机的 8080 端口已经被其他程序占用。可以换一个端口：

```bash
docker run -d -p 8081:80 nginx
```

### 2. 容器启动后马上退出

先查看容器状态：

```bash
docker ps -a
```

再查看日志：

```bash
docker logs 容器名或容器ID
```

通常是启动命令错误、配置文件错误、依赖服务连接失败等原因。

### 3. 容器内访问不到宿主机服务

在 Docker Desktop 中，可以使用：

```text
host.docker.internal
```

例如容器内访问宿主机 MySQL：

```text
host.docker.internal:3306
```

Linux 环境中可以根据网络模式或宿主机网关地址进行配置。

### 4. 镜像拉取太慢

可以配置镜像加速器，或使用国内云厂商提供的镜像服务。企业环境中也可以搭建私有 Harbor 仓库。

## 最佳实践

### 1. 镜像标签不要只用 latest

生产环境中不建议只使用：

```bash
my-app:latest
```

更推荐使用明确版本号：

```bash
my-app:1.0.0
my-app:2026.06.28
```

这样回滚和排查问题会更方便。

### 2. 不要把敏感信息写进镜像

不要把密码、密钥、Token 写进 Dockerfile 或镜像中。应通过环境变量、配置中心、Secret 管理工具等方式注入。

### 3. 使用更小的基础镜像

例如：

```dockerfile
FROM node:20-alpine
FROM eclipse-temurin:17-jre-alpine
```

更小的镜像通常意味着更快的拉取速度和更小的攻击面。

### 4. 合理使用 .dockerignore

`.dockerignore` 可以避免把无关文件复制进镜像，例如：

```text
.git
node_modules
logs
target
*.md
```

这能减少镜像体积，也能加快构建速度。

### 5. 数据要持久化

数据库、上传文件、业务日志等重要数据不要只保存在容器内部，应使用 Volume 或挂载宿主机目录。

### 6. 一个容器尽量只运行一个主进程

Docker 推荐一个容器只负责一个主要职责。例如：

- MySQL 一个容器；
- Redis 一个容器；
- 后端应用一个容器；
- Nginx 一个容器。

这样更容易扩展、替换和排查问题。

## 总结

Docker 的核心价值，不是让部署变得更“酷”，而是让环境变得更可控。

它解决的是软件开发中最常见、也最令人头疼的问题：

```text
环境不一致、依赖难安装、部署不可复现、服务难迁移
```

通过 Docker，我们可以把应用和依赖封装成镜像，再用容器稳定运行。开发环境、测试环境、生产环境都可以围绕同一套镜像展开，从而减少“环境玄学”。

如果你刚开始学习 Docker，建议按下面的顺序掌握：

1. 先理解镜像、容器、仓库三个核心概念；
2. 学会 `docker run`、`docker ps`、`docker logs`、`docker exec` 等常用命令；
3. 掌握端口映射、数据卷和网络；
4. 学会编写 Dockerfile；
5. 使用 Docker Compose 管理多容器项目；
6. 最后再了解 Swarm、Kubernetes 等更高级的编排方案。

当你真正理解 Docker 后，就会发现它并不是一门“玄学”，而是一套把环境标准化、交付流程工程化的工具。

从此以后，少一点“为什么你那里能跑”，多一点“我把镜像发你”。
