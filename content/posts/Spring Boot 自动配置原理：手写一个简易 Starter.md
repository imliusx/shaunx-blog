---
title: Spring Boot 自动配置原理：手写一个简易 Starter
slug: spring-boot-auto-configuration-and-bean-loading-process
date: 2026-07-04
category: 原理
tags:
  - Spring Boot
  - Spring
  - 自动装配
  - Bean生命周期
  - Java
description: Spring Boot 启动入口，梳理 @SpringBootApplication、@SpringBootConfiguration、@EnableAutoConfiguration、@ComponentScan 的作用，拆解自动装配的加载流程、条件注解机制、Bean 注册过程，并结合自定义 Starter 示例理解 Spring Boot 如何做到“约定大于配置”。
cover:
published: true
---

## 引言

使用 Spring Boot 开发项目时，我们通常只需要写一个启动类：

```java
@SpringBootApplication
public class DemoApplication {
    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }
}
```

然后引入依赖、写 Controller、Service、Mapper，项目就能启动起来。

这也是 Spring Boot 最吸引人的地方：大量配置被自动完成，开发者不再需要手写一堆 XML 或 Java Config。

但问题是：

- `@SpringBootApplication` 到底做了什么？
- 为什么引入 `spring-boot-starter-web` 后，Tomcat、Spring MVC、Jackson 都能自动生效？
- Spring Boot 是如何判断某个配置类该不该加载的？
- Bean 又是在什么时候被扫描、注册和实例化的？

下面直接梳理 Spring Boot 自动装配背后的核心流程。Spring Boot 官方文档可以查看：[Spring Boot Reference Documentation](https://docs.spring.io/spring-boot/index.html)。

## 自动装配解决了什么问题？

在传统 Spring 项目中，我们经常需要手动配置很多内容。例如配置 Spring MVC：

```xml
<bean class="org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping" />
<bean class="org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter" />
<bean class="org.springframework.web.servlet.view.InternalResourceViewResolver" />
```

配置数据源：

```xml
<bean id="dataSource" class="com.zaxxer.hikari.HikariDataSource">
    <property name="jdbcUrl" value="jdbc:mysql://localhost:3306/demo" />
    <property name="username" value="root" />
    <property name="password" value="123456" />
</bean>
```

这种方式可控，但问题也明显：

1. 配置重复，每个项目都要写一遍；
2. 依赖之间的组合关系复杂；
3. 新人接手项目成本高；
4. 配置写错后排查困难；
5. 框架升级时配置也要跟着调整。

Spring Boot 自动装配的目标就是：

> 根据当前项目引入的依赖、配置文件和运行环境，自动创建一批默认可用的 Bean。

也就是说，Spring Boot 并不是不需要配置，而是把大量通用配置提前写好，并通过条件判断决定是否生效。

## 从启动类开始看

一个标准启动类通常长这样：

```java
@SpringBootApplication
public class DemoApplication {
    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }
}
```

这里有两个关键点：

1. `@SpringBootApplication`：声明这是一个 Spring Boot 应用；
2. `SpringApplication.run()`：启动 Spring 应用上下文。

整体流程可以简单理解为：

```text
main 方法
-> SpringApplication.run()
-> 创建 ApplicationContext
-> 加载 BeanDefinition
-> 执行自动装配
-> 实例化 Bean
-> 启动 Web 容器
-> 应用启动完成
```

图：SpringBootApplication 注解源码截图

![](images/2026/07/04/springbootapplication-source-placeholder.png)

## @SpringBootApplication 做了什么？

点开 `@SpringBootApplication` 源码，会发现它是一个组合注解：

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Inherited
@SpringBootConfiguration
@EnableAutoConfiguration
@ComponentScan
public @interface SpringBootApplication {
}
```

核心就是三个注解：

```text
@SpringBootConfiguration
@EnableAutoConfiguration
@ComponentScan
```

它们分别负责：

| 注解 | 作用 |
| --- | --- |
| `@SpringBootConfiguration` | 声明当前类是配置类 |
| `@EnableAutoConfiguration` | 开启自动装配 |
| `@ComponentScan` | 扫描当前包及子包下的组件 |

下面分别来看。

## @SpringBootConfiguration：标记配置类

`@SpringBootConfiguration` 本质上是对 `@Configuration` 的封装：

```java
@Configuration
public @interface SpringBootConfiguration {
}
```

它表示当前类是一个 Spring 配置类，可以向容器中注册 Bean。

例如：

```java
@SpringBootConfiguration
public class AppConfig {

    @Bean
    public UserService userService() {
        return new UserService();
    }
}
```

等价于传统 Spring 中的 Java Config：

```java
@Configuration
public class AppConfig {

    @Bean
    public UserService userService() {
        return new UserService();
    }
}
```

它本身不是自动装配的核心，只是告诉 Spring：这个启动类也是配置来源之一。

## @ComponentScan：扫描业务组件

`@ComponentScan` 用来扫描组件，例如：

- `@Component`
- `@Service`
- `@Repository`
- `@Controller`
- `@RestController`
- `@Configuration`

默认情况下，Spring Boot 会从启动类所在包开始，扫描当前包及其子包。

例如项目结构如下：

```text
com.example.demo
├── DemoApplication.java
├── controller
│   └── UserController.java
├── service
│   └── UserService.java
└── repository
    └── UserRepository.java
```

启动类在 `com.example.demo` 包下，那么 `controller`、`service`、`repository` 都会被扫描到。

如果某个类放在启动类包路径之外，例如：

```text
com.example.common.UserUtils
com.example.demo.DemoApplication
```

`UserUtils` 默认不会被扫描到，除非手动指定扫描路径：

```java
@SpringBootApplication(scanBasePackages = "com.example")
public class DemoApplication {
}
```

这也是很多项目中 Bean 找不到的常见原因。

## @EnableAutoConfiguration：自动装配入口

`@EnableAutoConfiguration` 是 Spring Boot 自动装配的核心。

它的作用可以理解为：

> 从框架预先定义好的一批自动配置类中，按条件筛选出当前项目需要的配置类，然后注册对应 Bean。

简化后可以理解为：

```text
@EnableAutoConfiguration
-> 导入 AutoConfigurationImportSelector
-> 读取自动配置类清单
-> 根据条件注解筛选配置类
-> 将符合条件的配置类注册到容器
-> 配置类中的 @Bean 生效
```

图：AutoConfiguration.imports 文件内容截图

![](images/2026/07/04/spring-boot-auto-configuration-imports-placeholder.png)

## 自动配置类从哪里来？

不同 Spring Boot 版本中，自动配置类的加载位置略有差异。

### Spring Boot 2.x

在 Spring Boot 2.x 中，自动配置类主要通过 `spring.factories` 文件声明。

位置通常在：

```text
META-INF/spring.factories
```

内容类似：

```properties
org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration,\
org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration,\
org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration
```

### Spring Boot 3.x

在 Spring Boot 3.x 中，自动配置类主要通过下面这个文件声明：

```text
META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

内容类似：

```text
org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration
org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration
org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration
```

Spring Boot 启动时会读取这些自动配置类，然后根据条件决定是否真正加载。

## 条件注解：自动装配不是全部加载

很多人刚接触自动装配时，会误以为 Spring Boot 把所有自动配置类都加载了。其实不是。

Spring Boot 会先读取候选自动配置类，再通过一系列 `@Conditional` 条件注解决定是否生效。自动配置机制的官方说明可以查看：[Auto-configuration](https://docs.spring.io/spring-boot/reference/using/auto-configuration.html)。

常见条件注解如下：

| 注解 | 含义 |
| --- | --- |
| `@ConditionalOnClass` | classpath 中存在某个类时生效 |
| `@ConditionalOnMissingClass` | classpath 中不存在某个类时生效 |
| `@ConditionalOnBean` | 容器中存在某个 Bean 时生效 |
| `@ConditionalOnMissingBean` | 容器中不存在某个 Bean 时生效 |
| `@ConditionalOnProperty` | 配置文件中某个属性满足条件时生效 |
| `@ConditionalOnWebApplication` | 当前是 Web 应用时生效 |
| `@ConditionalOnNotWebApplication` | 当前不是 Web 应用时生效 |
| `@ConditionalOnResource` | 某个资源文件存在时生效 |

这些条件注解决定了 Spring Boot 自动装配的灵活性。

## 以 RedisAutoConfiguration 为例

假设我们引入 Redis Starter：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
```

Spring Boot 会发现 classpath 中存在 Redis 相关类，于是 Redis 自动配置类有机会生效。

简化后的自动配置逻辑可以理解为：

```java
@AutoConfiguration
@ConditionalOnClass(RedisOperations.class)
@EnableConfigurationProperties(RedisProperties.class)
public class RedisAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean(name = "redisTemplate")
    public RedisTemplate<Object, Object> redisTemplate(RedisConnectionFactory factory) {
        RedisTemplate<Object, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(factory);
        return template;
    }
}
```

这里有几个关键点：

1. `@ConditionalOnClass(RedisOperations.class)`：项目中存在 Redis 相关类，配置才生效；
2. `@EnableConfigurationProperties(RedisProperties.class)`：绑定 `spring.data.redis` 等配置；
3. `@ConditionalOnMissingBean`：如果用户没有自定义 `redisTemplate`，Spring Boot 才创建默认 Bean。

这体现了 Spring Boot 的一个重要原则：

> 框架提供默认配置，用户自定义配置优先。

也就是说，如果你自己定义了一个 `RedisTemplate`：

```java
@Bean
public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory factory) {
    RedisTemplate<String, Object> template = new RedisTemplate<>();
    template.setConnectionFactory(factory);
    return template;
}
```

那么 Spring Boot 默认的 `redisTemplate` 就不会再创建。

## 以 WebMvcAutoConfiguration 为例

当我们引入：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

项目中会自动具备：

- 内嵌 Tomcat；
- Spring MVC；
- Jackson JSON 序列化；
- 参数绑定；
- 静态资源处理；
- 默认错误处理。

背后就是一系列自动配置类在生效，例如：

```text
ServletWebServerFactoryAutoConfiguration
DispatcherServletAutoConfiguration
WebMvcAutoConfiguration
HttpMessageConvertersAutoConfiguration
JacksonAutoConfiguration
ErrorMvcAutoConfiguration
```

简单来说：

```text
引入 spring-boot-starter-web
-> classpath 出现 Spring MVC、Tomcat、Jackson 等类
-> Web 相关自动配置条件成立
-> 自动注册 DispatcherServlet、HandlerMapping、MessageConverter 等 Bean
-> Web 应用可以直接启动
```

这就是为什么我们只写一个 `@RestController`，接口就能对外提供服务。

## Bean 加载流程简化理解

自动装配最终还是要落到 Bean 的注册和创建上。

Spring 容器启动过程中，大致会经历下面几个阶段：

```text
读取配置来源
-> 扫描组件和自动配置类
-> 解析 BeanDefinition
-> 注册 BeanDefinition
-> 执行 BeanFactoryPostProcessor
-> 实例化 Bean
-> 属性填充
-> 初始化 Bean
-> 应用启动完成
```

图：BeanPostProcessor 调用位置示意图

![](images/2026/07/04/spring-beanpostprocessor-placeholder.png)

### 1. 读取配置来源

配置来源包括：

- 启动类；
- `@Configuration` 配置类；
- `@ComponentScan` 扫描到的组件；
- 自动配置类；
- `application.yml` / `application.properties`；
- 环境变量和启动参数。

### 2. 解析 BeanDefinition

Spring 并不是一开始就直接创建所有 Bean，而是先把 Bean 的元信息解析成 `BeanDefinition`。

`BeanDefinition` 中包含：

- Bean 的 class；
- scope；
- 是否懒加载；
- 构造参数；
- 属性依赖；
- 初始化方法；
- 销毁方法。

可以把它理解为 Bean 的“设计图纸”。

### 3. 注册 BeanDefinition

解析出来的 `BeanDefinition` 会注册到 `BeanFactory` 中。

此时 Bean 还没有真正实例化，只是告诉容器：未来需要创建哪些 Bean。

### 4. 执行 BeanFactoryPostProcessor

这个阶段可以修改 BeanDefinition。

典型例子是：

- 解析 `@Configuration`；
- 解析 `@Bean` 方法；
- 处理占位符；
- 扫描 Mapper；
- 注册额外 BeanDefinition。

MyBatis、Spring Cloud 中很多扩展点都和这个阶段有关。

### 5. 实例化 Bean

BeanDefinition 准备好后，Spring 开始创建非懒加载的单例 Bean。

实例化一般包括：

```text
构造方法创建对象
-> 属性填充
-> Aware 回调
-> BeanPostProcessor 前置处理
-> 初始化方法
-> BeanPostProcessor 后置处理
-> 放入单例池
```

其中 AOP 代理对象通常会在 BeanPostProcessor 阶段生成。

## 自动装配和 Bean 生命周期的关系

自动装配并不是直接创建 Bean，它更准确地说是：

> 自动导入配置类，并通过配置类向 Spring 容器注册 BeanDefinition。

也就是说，自动装配主要发生在 BeanDefinition 注册阶段，而真正的 Bean 创建仍然遵循 Spring 的 Bean 生命周期。

可以理解为：

```text
自动装配负责“该注册哪些 Bean”
Bean 生命周期负责“这些 Bean 如何被创建和管理”
```

这两个过程衔接起来，才形成了完整的 Spring Boot 启动流程。

## 自定义 Starter 示例

理解自动装配最好的方式，是自己写一个简单 Starter。

假设我们要做一个 `hello-spring-boot-starter`，让项目引入依赖后自动获得一个 `HelloService`。

### 1. 定义属性类

```java
@ConfigurationProperties(prefix = "hello")
public class HelloProperties {

    private String prefix = "Hello";

    public String getPrefix() {
        return prefix;
    }

    public void setPrefix(String prefix) {
        this.prefix = prefix;
    }
}
```

### 2. 定义业务类

```java
public class HelloService {

    private final HelloProperties properties;

    public HelloService(HelloProperties properties) {
        this.properties = properties;
    }

    public String sayHello(String name) {
        return properties.getPrefix() + ", " + name;
    }
}
```

### 3. 定义自动配置类

Spring Boot 3.x 推荐使用 `@AutoConfiguration`：

```java
@AutoConfiguration
@EnableConfigurationProperties(HelloProperties.class)
@ConditionalOnClass(HelloService.class)
public class HelloAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public HelloService helloService(HelloProperties properties) {
        return new HelloService(properties);
    }
}
```

### 4. 声明自动配置类

在 `resources` 下创建文件：

```text
META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

写入：

```text
com.example.hello.HelloAutoConfiguration
```

### 5. 使用 Starter

业务项目引入该 Starter 后，在配置文件中写：

```yaml
hello:
  prefix: Hi
```

然后就可以直接注入：

```java
@RestController
public class HelloController {

    private final HelloService helloService;

    public HelloController(HelloService helloService) {
        this.helloService = helloService;
    }

    @GetMapping("/hello")
    public String hello(String name) {
        return helloService.sayHello(name);
    }
}
```

这就是自动装配的基本思想：

```text
引入依赖
-> Spring Boot 发现自动配置类
-> 条件满足
-> 自动注册 Bean
-> 业务代码直接注入使用
```

## 如何查看哪些自动配置生效了？

排查自动装配问题时，可以开启 debug 模式。

### 方式一：启动参数

```bash
java -jar app.jar --debug
```

### 方式二：配置文件

```yaml
debug: true
```

启动后，控制台会输出 `Condition Evaluation Report`，可以看到哪些自动配置生效、哪些没有生效，以及原因。

也可以在 Spring Boot Actuator 中查看条件匹配情况。

引入依赖：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

开启 endpoint：

```yaml
management:
  endpoints:
    web:
      exposure:
        include: conditions,beans
```

访问：

```text
/actuator/conditions
/actuator/beans
```

这两个接口在排查 Bean 是否加载、自动配置是否生效时很有用。

## 常见问题排查

### 1. 为什么我的 Bean 没有被扫描到？

常见原因：类不在启动类所在包及其子包下。

解决方式：

```java
@SpringBootApplication(scanBasePackages = "com.example")
public class DemoApplication {
}
```

或者调整包结构，让启动类放在项目根包下。

### 2. 为什么我自定义的 Bean 覆盖了默认 Bean？

很多自动配置类使用了：

```java
@ConditionalOnMissingBean
```

这表示：只有容器中不存在同类型 Bean 时，默认 Bean 才会创建。

因此用户自定义 Bean 的优先级通常高于框架默认 Bean。

### 3. 为什么引入 Starter 后配置没有生效？

可以从以下几个方向排查：

1. Starter 是否真的被引入；
2. 自动配置类是否声明在正确位置；
3. 条件注解是否满足；
4. 配置属性前缀是否写错；
5. 是否被 `exclude` 排除了；
6. 是否存在同类型 Bean 导致默认配置不生效。

### 4. 如何排除某个自动配置类？

可以在启动类上排除：

```java
@SpringBootApplication(exclude = DataSourceAutoConfiguration.class)
public class DemoApplication {
}
```

也可以在配置文件中排除：

```yaml
spring:
  autoconfigure:
    exclude:
      - org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration
```

常见场景是：项目引入了数据库相关依赖，但暂时不需要配置数据源。

## Spring Boot 自动装配的核心设计思想

总结下来，Spring Boot 自动装配有几个关键设计思想。

### 1. 约定大于配置

框架提前提供一套默认配置，开发者只需要按约定引入依赖和编写配置文件。

例如：

- 引入 Web Starter，默认配置 Web MVC；
- 引入 Redis Starter，默认配置 Redis；
- 引入 JDBC Starter，默认配置数据源；
- 引入 Actuator Starter，默认提供监控端点。

### 2. 条件化加载

自动配置不是无脑加载，而是根据 classpath、配置属性、Bean 是否存在、应用类型等条件决定是否生效。

### 3. 用户配置优先

Spring Boot 提供默认 Bean，但通常允许用户自定义 Bean 覆盖默认行为。

这让框架既能开箱即用，又不会限制扩展。

### 4. Starter 封装依赖组合

Starter 本质上是一组依赖和自动配置的组合。它把复杂的依赖管理和默认配置封装起来，让使用者只需要引入一个 Starter。

## 总结

Spring Boot 自动装配并不是魔法，它的核心逻辑可以概括为：

```text
@SpringBootApplication
-> @EnableAutoConfiguration
-> AutoConfigurationImportSelector
-> 读取自动配置类清单
-> 条件注解筛选
-> 注册 BeanDefinition
-> 创建和初始化 Bean
```

`@SpringBootApplication` 负责把配置类、组件扫描和自动装配组合起来；`@EnableAutoConfiguration` 负责导入自动配置类；条件注解决定配置是否生效；最终所有配置都会转化为 BeanDefinition，并交给 Spring 容器统一管理。

理解这套流程后，再遇到 Bean 没加载、配置不生效、Starter 不工作等问题，就不再只能靠猜，而是可以顺着启动流程一步步定位。

对于日常后端开发来说，不一定要背下所有源码细节，但至少要知道：

1. Bean 是怎么被扫描到的；
2. 自动配置类是从哪里加载的；
3. 条件注解为什么会影响配置生效；
4. 用户自定义 Bean 为什么可以覆盖默认配置；
5. 如何通过 debug 和 Actuator 排查自动装配问题。
