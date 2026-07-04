---
title: Docker 部署 Spring Boot 项目：镜像构建、容器运行与生产配置
slug: docker-deploy-spring-boot-application
date: 2026-07-04
category: 工具
tags:
  - Docker
  - Spring Boot
  - Java
  - 容器化
  - 部署
description: Spring Boot 项目使用 Docker 部署后，可以把 JDK、应用 Jar、启动参数和运行环境封装进镜像，降低环境差异带来的部署风险。内容围绕 Dockerfile 编写、镜像构建、容器运行、配置挂载、日志处理、JVM 参数、Docker Compose 和生产环境注意事项展开。
cover:
published: true
---

## 引言

Spring Boot 项目部署方式有很多种：直接上传 Jar 包、使用脚本启动、通过 Jenkins 发布、部署到虚拟机，或者运行在 Kubernetes 中。

在中小型项目里，最常见的方式可能还是：

```bash
java -jar app.jar
```

这种方式简单直接，但随着项目数量变多，问题也会越来越明显：

- 服务器 JDK 版本不一致；
- 启动参数散落在不同脚本中；
- 多个项目依赖环境互相影响；
- 部署回滚不够清晰；
- 新机器初始化环境成本高；
- 测试环境和生产环境行为不一致。

Docker 可以把 Spring Boot 应用、JDK 运行时、启动命令和基础配置封装成镜像。部署时只需要拉取镜像并运行容器，环境差异会小很多。

Docker 官网：[Docker](https://www.docker.com/)，镜像仓库 Docker Hub：[Docker Hub](https://hub.docker.com/)。

## 项目准备

假设有一个 Spring Boot 项目，打包后生成：

```text
target/demo-app.jar
```

项目对外暴露 8080 端口：

```yaml
server:
  port: 8080
```

健康检查接口：

```java
@RestController
public class HealthController {

    @GetMapping("/health")
    public String health() {
        return "ok";
    }
}
```

打包命令：

```bash
mvn clean package -DskipTests
```

如果使用 Gradle：

```bash
gradle clean build -x test
```

Spring Boot 官方文档可以查看：[Spring Boot Reference Documentation](https://docs.spring.io/spring-boot/index.html)。

## 最简单的 Dockerfile

先写一个最小可用的 Dockerfile。

```dockerfile
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

COPY target/demo-app.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
```

字段说明：

| 指令 | 说明 |
| --- | --- |
| `FROM` | 指定基础镜像 |
| `WORKDIR` | 设置容器工作目录 |
| `COPY` | 复制 Jar 包到镜像中 |
| `EXPOSE` | 声明应用端口 |
| `ENTRYPOINT` | 设置容器启动命令 |

`eclipse-temurin` 是常用 OpenJDK 镜像之一，镜像页可以查看：[Eclipse Temurin Official Image](https://hub.docker.com/_/eclipse-temurin)。

图：Spring Boot 项目 Dockerfile 截图

![](images/2026/07/04/spring-boot-dockerfile-placeholder.png)

## 构建镜像

在项目根目录执行：

```bash
docker build -t demo-app:1.0.0 .
```

参数说明：

- `-t demo-app:1.0.0`：指定镜像名称和版本；
- `.`：构建上下文目录。

查看本地镜像：

```bash
docker images | grep demo-app
```

输出类似：

```text
demo-app    1.0.0    6f4a7c2b1c9d    10 seconds ago    180MB
```

不要在生产环境只使用 `latest` 标签。更推荐使用明确版本：

```text
demo-app:1.0.0
demo-app:2026.07.04
demo-app:commit-7f3a9c1
```

这样回滚时更清楚。

## 运行容器

启动容器：

```bash
docker run -d \
  --name demo-app \
  -p 8080:8080 \
  demo-app:1.0.0
```

参数说明：

| 参数 | 说明 |
| --- | --- |
| `-d` | 后台运行 |
| `--name demo-app` | 指定容器名称 |
| `-p 8080:8080` | 宿主机 8080 端口映射到容器 8080 端口 |
| `demo-app:1.0.0` | 使用的镜像 |

查看容器：

```bash
docker ps
```

查看日志：

```bash
docker logs -f demo-app
```

访问健康检查：

```bash
curl http://localhost:8080/health
```

如果返回：

```text
ok
```

说明应用已经正常运行。

图：docker ps 与应用健康检查截图

![](images/2026/07/04/docker-ps-health-check-placeholder.png)

## 使用环境变量传递配置

容器镜像应该尽量保持不可变。不同环境的差异，例如数据库地址、Redis 地址、日志级别，不应该写死在镜像里。

Spring Boot 支持通过环境变量覆盖配置。

例如配置文件：

```yaml
spring:
  datasource:
    url: ${DB_URL}
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
```

运行容器时传入：

```bash
docker run -d \
  --name demo-app \
  -p 8080:8080 \
  -e DB_URL=jdbc:mysql://mysql:3306/demo \
  -e DB_USERNAME=root \
  -e DB_PASSWORD=123456 \
  demo-app:1.0.0
```

也可以指定 Spring Profile：

```bash
docker run -d \
  --name demo-app \
  -p 8080:8080 \
  -e SPRING_PROFILES_ACTIVE=prod \
  demo-app:1.0.0
```

Spring Boot 外部化配置文档：[Externalized Configuration](https://docs.spring.io/spring-boot/reference/features/external-config.html)。

## 使用 env 文件管理环境变量

当环境变量较多时，命令行会变得很长。可以使用 `.env` 文件。

创建 `prod.env`：

```text
SPRING_PROFILES_ACTIVE=prod
DB_URL=jdbc:mysql://mysql:3306/demo
DB_USERNAME=root
DB_PASSWORD=123456
REDIS_HOST=redis
REDIS_PORT=6379
```

启动容器：

```bash
docker run -d \
  --name demo-app \
  -p 8080:8080 \
  --env-file prod.env \
  demo-app:1.0.0
```

注意：`prod.env` 中可能包含密码，不建议提交到 Git 仓库。可以在 `.gitignore` 中忽略：

```text
*.env
prod.env
```

生产环境更推荐使用配置中心、Secret 管理工具或容器平台提供的密钥管理能力。

## 挂载外部配置文件

如果希望配置文件由宿主机管理，也可以挂载配置文件。

宿主机目录：

```text
/data/app/demo/config/application-prod.yml
```

启动容器：

```bash
docker run -d \
  --name demo-app \
  -p 8080:8080 \
  -v /data/app/demo/config/application-prod.yml:/app/config/application-prod.yml \
  -e SPRING_PROFILES_ACTIVE=prod \
  demo-app:1.0.0
```

Spring Boot 默认会读取 `config` 目录下的配置文件。

目录结构：

```text
/app
├── app.jar
└── config
    └── application-prod.yml
```

图：容器内 application-prod.yml 挂载路径截图

![](images/2026/07/04/docker-mounted-spring-config-placeholder.png)

## 日志处理

容器中日志处理有两种常见方式。

### 方式一：输出到控制台

这是容器化环境更推荐的方式。

Spring Boot 默认日志输出到控制台，Docker 可以通过下面命令查看：

```bash
docker logs -f demo-app
```

容器平台也能采集 stdout / stderr，例如 Kubernetes、ELK、Loki 等。

### 方式二：挂载日志目录

如果仍然需要应用写文件日志，可以挂载目录。

```bash
docker run -d \
  --name demo-app \
  -p 8080:8080 \
  -v /data/app/demo/logs:/app/logs \
  demo-app:1.0.0
```

Logback 配置示例：

```xml
<property name="LOG_PATH" value="/app/logs" />

<appender name="FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
    <file>${LOG_PATH}/demo-app.log</file>
    <rollingPolicy class="ch.qos.logback.core.rolling.TimeBasedRollingPolicy">
        <fileNamePattern>${LOG_PATH}/demo-app.%d{yyyy-MM-dd}.log</fileNamePattern>
        <maxHistory>30</maxHistory>
    </rollingPolicy>
    <encoder>
        <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] %-5level %logger - %msg%n</pattern>
    </encoder>
</appender>
```

容器环境中不要无限写日志文件，需要设置滚动策略和保留天数。

## JVM 参数配置

直接写死启动命令不够灵活：

```dockerfile
ENTRYPOINT ["java", "-jar", "app.jar"]
```

更推荐支持通过环境变量传入 JVM 参数。

Dockerfile 改成：

```dockerfile
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

COPY target/demo-app.jar app.jar

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

启动时传入：

```bash
docker run -d \
  --name demo-app \
  -p 8080:8080 \
  -e JAVA_OPTS="-Xms512m -Xmx512m -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/app/dump" \
  -v /data/app/demo/dump:/app/dump \
  demo-app:1.0.0
```

容器环境中不要把 `-Xmx` 设置得等于容器内存上限，因为 JVM 还需要堆外内存、线程栈、元空间等空间。

例如容器限制 1GB，可以先设置：

```text
-Xms512m -Xmx512m
```

再结合监控和压测调整。

图：容器内 Java 进程启动参数截图

![](images/2026/07/04/docker-java-process-opts-placeholder.png)

## 健康检查

Docker 支持在 Dockerfile 中配置健康检查。

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1
```

如果基础镜像没有 `wget`，可以改用 `curl`，或者在镜像中安装工具。

也可以使用 Spring Boot Actuator 提供健康检查接口。

引入依赖：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

配置：

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info
  endpoint:
    health:
      show-details: always
```

访问：

```text
/actuator/health
```

Spring Boot Actuator 文档：[Production-ready Features](https://docs.spring.io/spring-boot/reference/actuator/index.html)。

图：Spring Boot Actuator health 接口截图

![](images/2026/07/04/spring-boot-actuator-health-placeholder.png)

## 使用 .dockerignore

构建镜像时，Docker 会把构建上下文发送给 Docker Daemon。如果项目目录里有大量无关文件，会影响构建速度，也可能把敏感文件带进镜像。

创建 `.dockerignore`：

```text
.git
.idea
*.iml
logs
*.log
.env
prod.env
node_modules
.DS_Store
README.md
```

如果是 Maven 项目，不要忽略最终 Jar：

```text
# 不要写 target
# 可以只忽略 target 下的无关文件
```

图：Spring Boot 项目 .dockerignore 截图

![](images/2026/07/04/spring-boot-dockerignore-placeholder.png)

## 多阶段构建

上面的 Dockerfile 依赖本地先执行 `mvn package`。如果希望 Docker 构建时自动完成编译，可以使用多阶段构建。

```dockerfile
FROM maven:3.9.8-eclipse-temurin-17 AS builder

WORKDIR /build

COPY pom.xml .
COPY src ./src

RUN mvn clean package -DskipTests

FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

COPY --from=builder /build/target/demo-app.jar app.jar

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

优点：

- 构建过程更标准；
- 不依赖宿主机 Maven；
- 最终镜像不包含 Maven 和源码；
- 适合 CI/CD 环境。

缺点：

- 首次构建较慢；
- 需要注意 Maven 依赖缓存；
- 国内网络环境可能需要配置 Maven 镜像源。

Maven 官方镜像页：[Maven Official Image](https://hub.docker.com/_/maven)。

## 使用 Docker Compose 启动应用和依赖

如果 Spring Boot 项目依赖 MySQL 和 Redis，可以使用 Docker Compose 统一管理。

Docker Compose 文档：[Docker Compose](https://docs.docker.com/compose/)。

`docker-compose.yml` 示例：

```yaml
services:
  demo-app:
    image: demo-app:1.0.0
    container_name: demo-app
    ports:
      - "8080:8080"
    environment:
      SPRING_PROFILES_ACTIVE: prod
      DB_URL: jdbc:mysql://mysql:3306/demo?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai
      DB_USERNAME: root
      DB_PASSWORD: 123456
      REDIS_HOST: redis
      REDIS_PORT: 6379
      JAVA_OPTS: -Xms512m -Xmx512m
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

启动：

```bash
docker compose up -d
```

查看服务：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f demo-app
```

停止：

```bash
docker compose down
```

图：docker compose ps 服务列表截图

![](images/2026/07/04/docker-compose-ps-placeholder.png)

## depends_on 不等于服务可用

`depends_on` 只能保证容器启动顺序，不能保证 MySQL 已经可以连接。

也就是说：

```text
demo-app 等 mysql 容器启动后再启动
```

不代表：

```text
mysql 已经初始化完成并可接受连接
```

因此应用启动时仍然可能出现数据库连接失败。

解决方案：

1. 应用侧数据库连接池配置重试；
2. MySQL 配置健康检查；
3. 启动脚本等待端口可用；
4. 容器编排平台使用 readiness probe；
5. 应用本身具备失败重试能力。

例如 Compose 中给 MySQL 增加健康检查：

```yaml
mysql:
  image: mysql:8.0
  environment:
    MYSQL_ROOT_PASSWORD: 123456
    MYSQL_DATABASE: demo
  healthcheck:
    test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-p123456"]
    interval: 10s
    timeout: 5s
    retries: 5
```

## 镜像推送到仓库

本地镜像只能在当前机器使用。实际部署通常要推送到镜像仓库。

以 Docker Hub 为例：

```bash
docker login
```

打标签：

```bash
docker tag demo-app:1.0.0 username/demo-app:1.0.0
```

推送：

```bash
docker push username/demo-app:1.0.0
```

服务器拉取：

```bash
docker pull username/demo-app:1.0.0
```

企业环境中也常用 Harbor、阿里云容器镜像服务、GitHub Container Registry。

Harbor 官网：[Harbor](https://goharbor.io/)。

GitHub Container Registry 文档：[Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。

## 生产环境启动脚本

生产环境可以用脚本统一发布。

`deploy.sh` 示例：

```bash
#!/bin/bash

APP_NAME=demo-app
IMAGE_NAME=username/demo-app:1.0.0
PORT=8080

set -e

echo "pull image: ${IMAGE_NAME}"
docker pull ${IMAGE_NAME}

echo "stop old container"
if docker ps -a --format '{{.Names}}' | grep -w ${APP_NAME}; then
  docker stop ${APP_NAME} || true
  docker rm ${APP_NAME} || true
fi

echo "start new container"
docker run -d \
  --name ${APP_NAME} \
  --restart=always \
  -p ${PORT}:8080 \
  --env-file /data/app/demo/prod.env \
  -v /data/app/demo/logs:/app/logs \
  -v /data/app/demo/dump:/app/dump \
  ${IMAGE_NAME}

echo "show logs"
docker logs --tail=100 ${APP_NAME}
```

`--restart=always` 表示容器异常退出后自动重启。

常见重启策略：

| 策略 | 说明 |
| --- | --- |
| `no` | 不自动重启 |
| `always` | 总是重启 |
| `unless-stopped` | 除非手动停止，否则自动重启 |
| `on-failure` | 非 0 退出码时重启 |

## 回滚方案

容器化部署后，回滚可以基于镜像版本完成。

例如当前版本：

```text
username/demo-app:1.0.1
```

回滚到：

```text
username/demo-app:1.0.0
```

只需要重新运行旧版本镜像：

```bash
docker run -d \
  --name demo-app \
  -p 8080:8080 \
  --env-file /data/app/demo/prod.env \
  username/demo-app:1.0.0
```

为了方便回滚，需要保留：

- 上一个稳定镜像版本；
- 对应配置文件；
- 数据库变更记录；
- 发布日志；
- 回滚脚本。

注意：如果新版本涉及数据库结构变更，镜像回滚不一定能解决全部问题。数据库变更要单独设计回滚或兼容方案。

## 常见问题排查

### 1. 容器启动后立刻退出

查看状态：

```bash
docker ps -a
```

查看日志：

```bash
docker logs demo-app
```

常见原因：

- Jar 包路径错误；
- Java 版本不兼容；
- 启动参数错误；
- 配置文件缺失；
- 数据库连接失败；
- 端口被占用。

### 2. 访问不到接口

检查方向：

1. 容器是否运行；
2. 端口映射是否正确；
3. 应用是否监听 8080；
4. 防火墙或安全组是否放行；
5. 宿主机端口是否被其他进程占用。

命令：

```bash
docker ps
curl http://localhost:8080/health
```

进入容器测试：

```bash
docker exec -it demo-app sh
wget -qO- http://localhost:8080/health
```

### 3. 容器内连接不到宿主机服务

Docker Desktop 环境可以使用：

```text
host.docker.internal
```

例如：

```text
jdbc:mysql://host.docker.internal:3306/demo
```

Linux 服务器上可以使用宿主机网关 IP，或者更推荐把依赖服务也放入同一个 Docker 网络。

### 4. 时区不正确

容器内时间可能不是北京时间。

可以设置环境变量：

```bash
-e TZ=Asia/Shanghai
```

Alpine 镜像可能需要安装时区数据：

```dockerfile
RUN apk add --no-cache tzdata
ENV TZ=Asia/Shanghai
```

### 5. 中文乱码

可以增加 JVM 参数：

```bash
-Dfile.encoding=UTF-8
```

启动示例：

```bash
-e JAVA_OPTS="-Dfile.encoding=UTF-8 -Xms512m -Xmx512m"
```

### 6. OOM 或容器被杀

查看容器状态：

```bash
docker inspect demo-app | grep -i oom
```

查看系统日志或容器平台事件。

启动时可以限制内存：

```bash
docker run -d \
  --name demo-app \
  -m 1g \
  -e JAVA_OPTS="-Xms512m -Xmx512m" \
  demo-app:1.0.0
```

Docker 资源限制文档：[Resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)。

## 安全注意事项

### 不要把密码写进镜像

不要在 Dockerfile 中写：

```dockerfile
ENV DB_PASSWORD=123456
```

这样镜像被任何人拉取后，都能看到敏感信息。

密码应该通过环境变量、Secret、配置中心或容器平台注入。

### 尽量不要使用 root 用户

可以在 Dockerfile 中创建普通用户：

```dockerfile
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY target/demo-app.jar app.jar

RUN chown -R app:app /app

USER app

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

这样即使应用被攻击，容器内权限也更低。

图：容器内非 root 用户运行 Java 进程截图

![](images/2026/07/04/docker-non-root-java-process-placeholder.png)

### 控制镜像体积

镜像越大，拉取越慢，攻击面也越大。

建议：

- 使用 JRE 镜像，不使用完整 JDK；
- 使用 alpine 或 slim 镜像；
- 清理无关文件；
- 使用 `.dockerignore`；
- 多阶段构建。

不过 Alpine 使用 musl libc，个别场景可能和 glibc 存在兼容问题。生产环境要结合应用依赖测试。

## 一份推荐 Dockerfile

综合上面的内容，可以使用下面这份 Dockerfile 作为起点：

```dockerfile
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

RUN apk add --no-cache tzdata \
    && addgroup -S app \
    && adduser -S app -G app

ENV TZ=Asia/Shanghai

COPY target/demo-app.jar app.jar

RUN chown -R app:app /app

USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

启动命令：

```bash
docker run -d \
  --name demo-app \
  --restart=always \
  -p 8080:8080 \
  -e SPRING_PROFILES_ACTIVE=prod \
  -e JAVA_OPTS="-Xms512m -Xmx512m -Dfile.encoding=UTF-8" \
  -e TZ=Asia/Shanghai \
  -v /data/app/demo/logs:/app/logs \
  -v /data/app/demo/dump:/app/dump \
  demo-app:1.0.0
```

## 总结

Spring Boot 项目容器化部署的核心不是简单地把 Jar 包放进镜像，而是把运行环境、启动参数、配置注入、日志、健康检查和发布流程一起规范化。

一套比较稳妥的部署方式应该具备：

```text
明确的镜像版本
可配置的 JVM 参数
外部化配置能力
日志采集方案
健康检查接口
容器重启策略
可回滚的发布脚本
敏感信息不进镜像
生产环境资源限制
```

Docker 能减少环境差异，但不能替代运维规范。真正稳定的发布流程，需要镜像构建、配置管理、日志监控、健康检查、资源限制和回滚策略一起配合。

对于普通 Spring Boot 项目，可以先完成下面几个动作：

1. 编写 Dockerfile；
2. 使用明确版本号构建镜像；
3. 使用环境变量或配置文件区分环境；
4. 配置日志、健康检查和 JVM 参数；
5. 使用 Docker Compose 管理本地依赖；
6. 推送镜像到仓库；
7. 使用脚本或 CI/CD 完成部署。

做到这些，项目部署就会比直接 `java -jar` 更可控，也更容易迁移和回滚。
