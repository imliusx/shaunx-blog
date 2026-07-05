---
title: MyBatis 常见坑：动态 SQL、批量操作与 N+1 查询问题
slug: mybatis-common-pitfalls-dynamic-sql-batch-n-plus-one
date: 2021-07-08
category: 开发
tags:
  - MyBatis
  - SQL
  - Java
  - 后端开发
  - 性能优化
description: MyBatis 灵活但也容易踩坑，尤其是动态 SQL、参数绑定、批量操作、N+1 查询、分页和结果映射这些场景。内容结合后端开发中常见问题，整理错误写法、推荐写法、排查方式和上线前检查点。
cover:
published: true
---

## 先说一个常见感受

MyBatis 用起来很顺手。

相比全自动 ORM，它更接近手写 SQL：

```text
SQL 怎么写
执行计划怎么走
返回字段怎么映射
开发者基本都能控制
```

但也正因为它灵活，很多问题不会在编译期暴露，而是在线上数据量变大、参数变复杂、接口调用频繁后才出现。

常见问题包括：

- 动态 SQL 拼错；
- 空参数导致全表查询；
- `#{}` 和 `${}` 混用；
- 批量插入太大；
- `foreach` 参数名写错；
- 一次查询触发 N+1；
- 分页查询和 count 慢；
- 字段映射出现 null；
- 日志看不到真实 SQL。

MyBatis 官方文档可以查看：[MyBatis 3](https://mybatis.org/mybatis-3/)，动态 SQL 文档：[Dynamic SQL](https://mybatis.org/mybatis-3/dynamic-sql.html)。

## 坑一：动态 SQL 条件没兜住，直接查全表

后台列表接口经常支持多个可选查询条件。

例如订单查询：

```xml
<select id="listOrders" resultType="OrderDTO">
    SELECT id, order_no, user_id, status, create_time
    FROM t_order
    <where>
        <if test="status != null">
            AND status = #{status}
        </if>
        <if test="startTime != null">
            AND create_time &gt;= #{startTime}
        </if>
        <if test="endTime != null">
            AND create_time &lt; #{endTime}
        </if>
    </where>
    ORDER BY create_time DESC
</select>
```

这段 SQL 看起来没问题，但如果调用方什么条件都不传，就会变成：

```sql
SELECT id, order_no, user_id, status, create_time
FROM t_order
ORDER BY create_time DESC
```

数据量一大，这就是一个危险的全表查询。

更稳妥的做法是在接口层或 Service 层限制查询条件：

```java
public List<OrderDTO> listOrders(OrderQuery query) {
    // 至少要求传入一个有效查询条件，避免后台误操作扫全表
    if (query.getStatus() == null
            && query.getStartTime() == null
            && query.getEndTime() == null
            && query.getOrderNo() == null) {
        throw new BusinessException("至少选择一个查询条件");
    }

    return orderMapper.listOrders(query);
}
```

如果业务允许无条件查询，也要限制分页：

```text
默认 pageSize 不超过 20
最大 pageSize 不超过 100
禁止导出接口无限制扫全表
```

图：MyBatis 动态 SQL 生成的无条件查询日志截图

![](images/2026/07/05/mybatis-dynamic-sql-full-scan-log-placeholder.png)

## 坑二：if 判断空字符串不完整

很多查询参数是字符串，比如订单号、手机号、用户名。

错误写法：

```xml
<if test="phone != null">
    AND phone = #{phone}
</if>
```

如果前端传的是空字符串：

```json
{
  "phone": ""
}
```

SQL 会变成：

```sql
AND phone = ''
```

这通常不是想要的结果。

推荐写法：

```xml
<if test="phone != null and phone != ''">
    AND phone = #{phone}
</if>
```

多个字符串条件都要注意这个问题：

```xml
<where>
    <if test="orderNo != null and orderNo != ''">
        AND order_no = #{orderNo}
    </if>
    <if test="phone != null and phone != ''">
        AND phone = #{phone}
    </if>
    <if test="username != null and username != ''">
        AND username LIKE CONCAT('%', #{username}, '%')
    </if>
</where>
```

当然，更推荐在入参对象里先做 trim：

```java
public void normalize() {
    // 进入 Mapper 前先把空白字符串处理掉，避免 XML 中到处写复杂判断
    this.orderNo = StringUtils.hasText(orderNo) ? orderNo.trim() : null;
    this.phone = StringUtils.hasText(phone) ? phone.trim() : null;
    this.username = StringUtils.hasText(username) ? username.trim() : null;
}
```

XML 负责 SQL 拼接，参数清洗尽量放在 Java 代码里，这样更容易测试。

## 坑三：`${}` 被当成普通参数用

MyBatis 里有两个很容易混淆的写法：

```xml
#{param}
${param}
```

区别非常大。

### `#{}` 是预编译参数

```xml
WHERE id = #{id}
```

最终会变成：

```sql
WHERE id = ?
```

由 JDBC PreparedStatement 设置参数，可以防止 SQL 注入。

### `${}` 是字符串拼接

```xml
ORDER BY ${sortField}
```

它会直接把参数拼到 SQL 里。

如果用户传入：

```text
id desc; drop table t_order;
```

就会非常危险。

MyBatis 文档也明确区分了两者：[Mapper XML Files](https://mybatis.org/mybatis-3/sqlmap-xml.html)。

### 排序字段怎么安全处理？

有些场景确实需要动态字段，比如排序。

不要直接相信前端参数：

```xml
ORDER BY ${sortField} ${sortDirection}
```

推荐在 Java 层做白名单映射：

```java
public class OrderSortHelper {

    private static final Map<String, String> SORT_FIELD_MAP = Map.of(
            "createTime", "create_time",
            "amount", "amount",
            "status", "status"
    );

    public static String safeSortField(String input) {
        // 只允许映射表中的字段参与 SQL 拼接
        return SORT_FIELD_MAP.getOrDefault(input, "create_time");
    }

    public static String safeSortDirection(String input) {
        // 排序方向只允许 ASC / DESC
        if ("asc".equalsIgnoreCase(input)) {
            return "ASC";
        }
        return "DESC";
    }
}
```

然后 Mapper 只接收后端处理过的安全字段：

```xml
ORDER BY ${sortField} ${sortDirection}
```

这里仍然使用 `${}`，但参数已经经过白名单控制。

图：MyBatis 中 #{} 和 ${} 的 SQL 日志对比截图

![](images/2026/07/05/mybatis-placeholder-vs-dollar-sql-log-placeholder.png)

## 坑四：foreach 参数名写错

批量查询常用 `foreach`。

Mapper 接口：

```java
List<UserDTO> selectByIds(@Param("ids") List<Long> ids);
```

XML：

```xml
<select id="selectByIds" resultType="UserDTO">
    SELECT id, username, email
    FROM t_user
    WHERE id IN
    <foreach collection="ids" item="id" open="(" separator="," close=")">
        #{id}
    </foreach>
</select>
```

如果没有写 `@Param("ids")`，XML 中还写 `collection="ids"`，就容易报参数找不到。

常见错误：

```text
Parameter 'ids' not found. Available parameters are [collection, list]
```

如果 Mapper 方法只有一个 List 参数，MyBatis 默认可用名称可能是 `list` 或 `collection`。

所以更推荐统一写 `@Param`：

```java
List<UserDTO> selectByIds(@Param("ids") List<Long> ids);
```

这样 XML 可读性更好，也不容易受编译参数名影响。

## 坑五：空集合生成非法 SQL

批量查询还有一个坑：空集合。

```java
List<UserDTO> users = userMapper.selectByIds(Collections.emptyList());
```

XML 如果直接写：

```xml
WHERE id IN
<foreach collection="ids" item="id" open="(" separator="," close=")">
    #{id}
</foreach>
```

可能生成：

```sql
WHERE id IN ()
```

这在很多数据库中是非法 SQL。

最简单的处理是在 Service 层提前返回：

```java
public List<UserDTO> selectUsers(List<Long> ids) {
    if (ids == null || ids.isEmpty()) {
        return Collections.emptyList();
    }
    return userMapper.selectByIds(ids);
}
```

也可以在 XML 中兜底，但可读性会差一些。

对于批量更新、批量删除，也要特别注意空集合。不要让空集合变成没有 where 条件的危险 SQL。

## 坑六：批量插入一次塞太多

批量插入常见写法：

```xml
<insert id="batchInsert">
    INSERT INTO t_user (username, email, create_time)
    VALUES
    <foreach collection="users" item="user" separator=",">
        (#{user.username}, #{user.email}, #{user.createTime})
    </foreach>
</insert>
```

小批量没问题，但如果一次传几万条，会出现问题：

- SQL 太长；
- JDBC 参数过多；
- 数据库解析压力大；
- 网络包过大；
- 单事务太大；
- 锁持有时间变长。

更推荐分批处理：

```java
public void batchInsertUsers(List<UserCreateCommand> users) {
    if (users == null || users.isEmpty()) {
        return;
    }

    int batchSize = 500;
    for (int i = 0; i < users.size(); i += batchSize) {
        // 每 500 条拆成一批，避免单条 SQL 过大
        int end = Math.min(i + batchSize, users.size());
        List<UserCreateCommand> subList = users.subList(i, end);
        userMapper.batchInsert(subList);
    }
}
```

`batchSize` 没有固定标准，要结合字段数量、数据库配置、网络环境和压测结果调整。

如果是 MySQL，还要注意连接参数：

```text
rewriteBatchedStatements=true
```

但 MyBatis XML 拼接多 values 和 JDBC batch 是两种不同方式，不要混为一谈。

图：MyBatis 批量插入 SQL 长度截图

![](images/2026/07/05/mybatis-batch-insert-sql-length-placeholder.png)

## 坑七：批量更新写成循环单条 SQL

有些代码会这样写：

```java
for (UserUpdateCommand user : users) {
    userMapper.updateUser(user);
}
```

如果有 1000 条数据，就执行 1000 次 SQL。

这不一定错，但要知道它的成本：

```text
1000 次网络往返
1000 次 SQL 解析
1000 次执行
```

如果数据量不大，可以接受。如果接口频繁调用或批量数据很大，就要优化。

### 方式一：CASE WHEN 批量更新

```xml
<update id="batchUpdateStatus">
    UPDATE t_user
    SET status = CASE id
    <foreach collection="users" item="user">
        WHEN #{user.id} THEN #{user.status}
    </foreach>
    END
    WHERE id IN
    <foreach collection="users" item="user" open="(" separator="," close=")">
        #{user.id}
    </foreach>
</update>
```

这种方式适合不同记录更新不同值。

### 方式二：同值批量更新

如果所有记录更新成同一个状态：

```xml
<update id="batchDisable">
    UPDATE t_user
    SET status = 'disabled'
    WHERE id IN
    <foreach collection="ids" item="id" open="(" separator="," close=")">
        #{id}
    </foreach>
</update>
```

更简单，也更高效。

### 方式三：ExecutorType.BATCH

MyBatis 支持 batch executor。

```java
try (SqlSession sqlSession = sqlSessionFactory.openSession(ExecutorType.BATCH)) {
    UserMapper mapper = sqlSession.getMapper(UserMapper.class);

    for (UserUpdateCommand user : users) {
        // 多次 update 会被批量提交，减少数据库交互成本
        mapper.updateUser(user);
    }

    sqlSession.commit();
}
```

这种方式适合保留单条 update 语义，同时利用 JDBC batch。

## 坑八：N+1 查询悄悄拖慢接口

N+1 是 MyBatis 项目里很常见的性能问题。

例如查询订单列表：

```java
List<OrderDTO> orders = orderMapper.listOrders(query);

for (OrderDTO order : orders) {
    UserDTO user = userMapper.selectById(order.getUserId());
    order.setUser(user);
}
```

如果订单列表有 20 条：

```text
1 次查询订单列表
20 次查询用户信息
```

这就是 N+1。

数据少时没感觉，数据量和并发上来后，数据库 QPS 会被放大。

### 解决方式一：批量查询再组装

```java
public List<OrderDTO> listOrders(OrderQuery query) {
    List<OrderDTO> orders = orderMapper.listOrders(query);
    if (orders.isEmpty()) {
        return orders;
    }

    // 提取订单中的 userId，去重后批量查询用户
    List<Long> userIds = orders.stream()
            .map(OrderDTO::getUserId)
            .filter(Objects::nonNull)
            .distinct()
            .toList();

    List<UserDTO> users = userMapper.selectByIds(userIds);
    Map<Long, UserDTO> userMap = users.stream()
            .collect(Collectors.toMap(UserDTO::getId, Function.identity()));

    // 在内存中完成订单和用户的关联
    for (OrderDTO order : orders) {
        order.setUser(userMap.get(order.getUserId()));
    }

    return orders;
}
```

这样 SQL 数量变成：

```text
1 次订单查询
1 次用户批量查询
```

### 解决方式二：JOIN 查询

```sql
SELECT
    o.id,
    o.order_no,
    o.user_id,
    u.username,
    u.email
FROM t_order o
LEFT JOIN t_user u ON o.user_id = u.id
WHERE o.status = #{status}
ORDER BY o.create_time DESC
LIMIT #{offset}, #{pageSize}
```

JOIN 更适合强关联、字段不多的场景。

批量查询再组装更适合复杂对象、多个关联表、需要控制查询字段的场景。

图：N+1 查询的 SQL 日志截图

![](images/2026/07/05/mybatis-n-plus-one-sql-log-placeholder.png)

## 坑九：resultMap 映射字段对不上

数据库字段是下划线：

```text
user_id
create_time
```

Java 字段是驼峰：

```java
private Long userId;
private LocalDateTime createTime;
```

如果没有开启自动驼峰映射，可能出现字段为 null。

配置：

```yaml
mybatis:
  configuration:
    map-underscore-to-camel-case: true
```

或者手写 resultMap：

```xml
<resultMap id="OrderResultMap" type="OrderDTO">
    <id column="id" property="id" />
    <result column="order_no" property="orderNo" />
    <result column="user_id" property="userId" />
    <result column="create_time" property="createTime" />
</resultMap>
```

复杂对象建议手写 `resultMap`，可控性更强。

尤其是 JOIN 查询时，多个表都有 `id`、`name`、`create_time` 字段，最好使用别名：

```sql
SELECT
    o.id AS order_id,
    o.order_no AS order_no,
    u.id AS user_id,
    u.username AS user_name
FROM t_order o
LEFT JOIN t_user u ON o.user_id = u.id
```

然后在 `resultMap` 中明确映射，避免字段覆盖。

## 坑十：分页插件 count 很慢

分页接口通常会查两条 SQL：

```text
查询总数 count
查询当前页 list
```

有些复杂查询的 count 可能比列表本身还慢。

例如：

```sql
SELECT COUNT(*)
FROM t_order o
LEFT JOIN t_user u ON o.user_id = u.id
LEFT JOIN t_payment p ON o.id = p.order_id
WHERE ...
```

如果只是后台列表，并不一定每个场景都需要精确总数。

可以考虑：

1. 首页需要 count，后续翻页不需要；
2. 大数据量查询只返回是否有下一页；
3. 复杂列表单独优化 count SQL；
4. 限制最大翻页深度；
5. 使用游标分页替代深分页。

例如返回：

```json
{
  "list": [],
  "hasNext": true
}
```

而不是每次都返回：

```json
{
  "list": [],
  "total": 12345678
}
```

业务上如果不需要总数，就不要为了分页组件默认行为强行查 count。

## 坑十一：日志里看不到完整 SQL

排查 SQL 问题时，最怕日志里只有：

```text
Preparing: SELECT * FROM t_order WHERE id = ?
Parameters: 1001(Long)
```

这已经比没有日志好，但复制到数据库执行还要手动替换参数。

开发环境可以开启 MyBatis 日志：

```yaml
mybatis:
  configuration:
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl
```

或者使用日志框架：

```yaml
logging:
  level:
    com.example.mapper: DEBUG
```

如果想看到完整 SQL，可以使用 p6spy 这类工具。项目地址：[p6spy](https://github.com/p6spy/p6spy)。

不过生产环境要谨慎开启完整 SQL 日志：

- 日志量大；
- 可能包含敏感信息；
- 影响性能；
- 容易打满磁盘。

更推荐在开发、测试、问题排查环境中使用。

图：p6spy 打印完整 SQL 截图

![](images/2026/07/05/p6spy-full-sql-log-placeholder.png)

## 坑十二：Mapper XML 和接口不一致

MyBatis 的 Mapper 接口和 XML 是通过 namespace、id、参数、返回值关联的。

常见错误：

```text
Invalid bound statement not found
```

通常是这些原因：

- XML namespace 和 Mapper 接口全限定名不一致；
- XML 中 statement id 和接口方法名不一致；
- Mapper XML 没有被扫描到；
- resource 路径配置错误；
- 多模块项目中 XML 没有打进包里。

例如接口：

```java
package com.example.order.mapper;

public interface OrderMapper {
    OrderDTO selectById(Long id);
}
```

XML 应该是：

```xml
<mapper namespace="com.example.order.mapper.OrderMapper">
    <select id="selectById" resultType="OrderDTO">
        SELECT id, order_no
        FROM t_order
        WHERE id = #{id}
    </select>
</mapper>
```

Spring Boot 中通常配置：

```yaml
mybatis:
  mapper-locations: classpath*:mapper/**/*.xml
```

图：Mapper XML namespace 配置截图

![](images/2026/07/05/mybatis-mapper-namespace-placeholder.png)

## 一个比较舒服的开发习惯

MyBatis 项目里，可以把 SQL 分成几类来管理。

### 简单 CRUD

可以使用注解或 XML，保持简洁。

```java
@Select("SELECT id, username FROM t_user WHERE id = #{id}")
UserDTO selectById(@Param("id") Long id);
```

### 动态 SQL

推荐放 XML，方便维护。

```xml
<select id="listUsers" resultMap="UserResultMap">
    SELECT id, username, email, status
    FROM t_user
    <where>
        <if test="email != null and email != ''">
            AND email = #{email}
        </if>
        <if test="status != null">
            AND status = #{status}
        </if>
    </where>
</select>
```

### 复杂报表 SQL

建议单独写清楚字段别名和 resultMap，不要 `SELECT *`。

```sql
SELECT
    o.id AS order_id,
    o.order_no AS order_no,
    u.username AS user_name,
    p.pay_time AS pay_time
FROM t_order o
LEFT JOIN t_user u ON o.user_id = u.id
LEFT JOIN t_payment p ON o.id = p.order_id
```

### 批处理 SQL

统一封装 Service 方法，控制批次大小和事务范围。

这样团队里写出来的 SQL 风格会比较一致，也方便排查问题。

## 上线前检查一遍

MyBatis 相关接口上线前，建议检查这些点：

```text
是否可能无条件查全表
字符串参数是否处理空字符串
是否误用 ${}
foreach 是否处理空集合
批量操作是否限制批次大小
列表查询是否存在 N+1
分页 count 是否过慢
是否需要索引支持
resultMap 是否字段明确
是否开启必要 SQL 日志
慢 SQL 是否看过执行计划
```

这些检查不复杂，但能避免很多线上问题。

## 收尾

MyBatis 的优势是灵活，SQL 可控；风险也来自灵活，很多错误不会提前暴露。

写 MyBatis 时，可以记住几条原则：

```text
动态 SQL 要防止无条件查询
参数默认用 #{}
必须用 ${} 时先做白名单
批量操作要控制批次大小
列表关联要警惕 N+1
复杂映射要写 resultMap
分页 count 不要默认相信
SQL 日志和执行计划要能看见
```

真正稳定的 MyBatis 项目，不是 XML 写得越复杂越好，而是 SQL 边界清晰、参数安全、批量可控、查询可观测。
