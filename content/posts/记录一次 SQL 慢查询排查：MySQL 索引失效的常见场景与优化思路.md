---
title: 记录一次 SQL 慢查询排查：MySQL 索引失效的常见场景与优化思路
slug: mysql-slow-query-index-failure-optimization
date: 2026-07-04
category: 开发
tags:
  - MySQL
  - SQL优化
  - 索引
  - 慢查询
  - 后端开发
description: 记录一次慢 SQL 排查过程，梳理 MySQL 索引失效的常见场景，包括函数计算、隐式类型转换、like 前缀模糊查询、联合索引使用不当、范围查询、OR 条件等，并总结后端开发中常用的 SQL 优化思路。
cover:
published: true
---

## 引言

后端开发做久了，基本都会遇到这样的问题：

> 测试环境跑得挺快，上线后数据量一大，接口突然变慢。

这类问题表面上看是接口超时，实际往下查，经常会落到数据库层面。尤其是 MySQL 查询，如果索引用得不好，数据量从几千涨到几十万、几百万之后，性能差异会非常明显。

这篇文章从一次慢 SQL 排查过程说起，整理 MySQL 中常见的索引失效场景，以及日常开发中比较实用的优化思路。

## 一次慢 SQL 问题背景

业务中有一个订单列表查询接口，主要用于后台管理系统。刚开始数据量不大，接口响应基本在 200ms 以内。后来订单表数据增长到几百万后，接口偶尔会超过 3 秒，甚至出现网关超时。

接口大致查询条件如下：

- 根据用户手机号查询订单；
- 根据订单状态筛选；
- 根据创建时间范围筛选；
- 按创建时间倒序分页。

简化后的表结构如下：

```sql
CREATE TABLE t_order (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_no VARCHAR(64) NOT NULL,
    user_id BIGINT NOT NULL,
    phone VARCHAR(20) NOT NULL,
    status TINYINT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    create_time DATETIME NOT NULL,
    update_time DATETIME NOT NULL,
    KEY idx_phone (phone),
    KEY idx_status_create_time (status, create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

问题 SQL 类似这样：

```sql
SELECT id, order_no, user_id, phone, status, amount, create_time
FROM t_order
WHERE status = 1
  AND DATE(create_time) >= '2026-06-01'
  AND DATE(create_time) <= '2026-06-30'
ORDER BY create_time DESC
LIMIT 0, 20;
```

看起来字段上已经有索引：

```sql
KEY idx_status_create_time (status, create_time)
```

但实际执行却很慢。

## 第一步：先看执行计划

排查 SQL 性能问题，不要凭感觉猜，第一步应该先看执行计划。

```sql
EXPLAIN
SELECT id, order_no, user_id, phone, status, amount, create_time
FROM t_order
WHERE status = 1
  AND DATE(create_time) >= '2026-06-01'
  AND DATE(create_time) <= '2026-06-30'
ORDER BY create_time DESC
LIMIT 0, 20;
```

重点关注几个字段：

图：MySQL EXPLAIN 执行计划

![](images/2026/07/04/mysql-explain-plan-placeholder.png)

| 字段 | 含义 |
| --- | --- |
| type | 访问类型，常见有 const、ref、range、index、ALL |
| possible_keys | 理论上可能使用的索引 |
| key | 实际使用的索引 |
| rows | 预估扫描行数 |
| Extra | 额外信息，例如 Using where、Using filesort |

如果看到 `type = ALL`，说明走了全表扫描；如果 `rows` 很大，说明扫描数据量比较多；如果 `Extra` 中出现 `Using filesort`，说明排序可能额外消耗较大。

这次问题的核心是：虽然有联合索引 `(status, create_time)`，但是 SQL 对 `create_time` 使用了 `DATE()` 函数，导致 `create_time` 这一列无法正常利用索引范围查询。

## 问题一：在索引列上使用函数

原 SQL：

```sql
WHERE DATE(create_time) >= '2026-06-01'
  AND DATE(create_time) <= '2026-06-30'
```

这种写法可读性还不错，但对索引并不友好。

因为索引中保存的是 `create_time` 原始值，而不是 `DATE(create_time)` 计算后的结果。MySQL 需要对每一行数据执行函数计算后再判断条件，自然就很难高效利用索引。

更好的写法是把函数计算放到条件值上，而不是字段上：

```sql
WHERE create_time >= '2026-06-01 00:00:00'
  AND create_time < '2026-07-01 00:00:00'
```

优化后的 SQL：

```sql
SELECT id, order_no, user_id, phone, status, amount, create_time
FROM t_order
WHERE status = 1
  AND create_time >= '2026-06-01 00:00:00'
  AND create_time < '2026-07-01 00:00:00'
ORDER BY create_time DESC
LIMIT 0, 20;
```

这样联合索引 `(status, create_time)` 就可以更好地发挥作用。

### 小结

索引列上尽量不要直接使用函数，例如：

```sql
DATE(create_time)
YEAR(create_time)
SUBSTR(phone, 1, 3)
LOWER(username)
```

如果必须按计算结果查询，可以考虑：

1. 改写 SQL 条件；
2. 增加冗余字段；
3. 使用 MySQL 8.0 的函数索引；
4. 根据业务场景提前计算并存储结果。

## 问题二：隐式类型转换导致索引失效

这个问题在工作中也很常见，尤其是手机号、订单号这类字段。

假设 `phone` 字段是字符串类型：

```sql
phone VARCHAR(20)
```

但查询时写成了数字：

```sql
SELECT * FROM t_order WHERE phone = 13800138000;
```

这时 MySQL 可能会发生隐式类型转换，把字段值转换成数字再比较。字段参与了转换，索引就可能无法正常使用。

正确写法应该是：

```sql
SELECT * FROM t_order WHERE phone = '13800138000';
```

### 常见隐式转换场景

| 字段类型 | 错误写法 | 推荐写法 |
| --- | --- | --- |
| VARCHAR | `phone = 13800138000` | `phone = '13800138000'` |
| VARCHAR | `order_no = 202607040001` | `order_no = '202607040001'` |
| DATETIME | `create_time = 20260704` | `create_time = '2026-07-04 00:00:00'` |

后端代码中也要注意参数类型。例如 MyBatis 中，如果数据库字段是 `VARCHAR`，就不要随手把参数定义成 `Long` 或 `Integer`。

## 问题三：like 前缀模糊查询

`LIKE` 查询是否能走索引，主要看通配符 `%` 放在哪里。

可以使用索引的写法：

```sql
SELECT * FROM t_order WHERE order_no LIKE 'NO202607%';
```

不容易使用索引的写法：

```sql
SELECT * FROM t_order WHERE order_no LIKE '%202607%';
```

原因很简单：B+ 树索引是有序的。如果从左侧开始匹配，MySQL 可以根据前缀定位范围；如果一开始就是 `%`，就不知道从哪里开始查，只能扫描更多数据。

### 怎么优化 `%xxx%` 这种需求？

如果业务必须支持包含查询，可以考虑：

1. 数据量小，直接接受全表扫描；
2. 限制查询条件，避免大范围模糊查询；
3. 使用 Elasticsearch；
4. 使用倒排索引方案；
5. 针对固定格式字段做拆分或冗余字段。

例如订单号、手机号这类字段，后台管理系统中通常可以要求用户输入完整值或前缀值，而不是任意模糊搜索。

## 问题四：联合索引不满足最左前缀原则

联合索引是日常优化中最常用的手段之一，但也最容易用错。

例如有一个联合索引：

```sql
KEY idx_status_create_time (status, create_time)
```

下面这个查询可以较好利用索引：

```sql
WHERE status = 1
  AND create_time >= '2026-06-01 00:00:00'
```

但如果只查 `create_time`：

```sql
WHERE create_time >= '2026-06-01 00:00:00'
```

这个联合索引就不一定能高效使用，因为缺少最左侧的 `status` 条件。

### 最左前缀原则怎么理解？

联合索引 `(a, b, c)` 可以支持：

```text
a
a, b
a, b, c
```

但通常不适合直接支持：

```text
b
c
b, c
```

因此设计联合索引时，要结合实际查询条件，而不是把字段随意堆在一起。

## 问题五：范围查询后的字段利用受限

假设有联合索引：

```sql
KEY idx_user_time_status (user_id, create_time, status)
```

SQL 如下：

```sql
SELECT *
FROM t_order
WHERE user_id = 1001
  AND create_time >= '2026-06-01 00:00:00'
  AND status = 1;
```

这里 `user_id` 是等值查询，`create_time` 是范围查询，`status` 在范围字段之后。很多情况下，范围查询后面的字段很难继续充分利用索引进行精确定位。

更合适的索引顺序可能是：

```sql
KEY idx_user_status_time (user_id, status, create_time)
```

对应 SQL：

```sql
WHERE user_id = 1001
  AND status = 1
  AND create_time >= '2026-06-01 00:00:00'
```

一般来说，联合索引设计可以参考这个顺序：

```text
等值查询字段 -> 范围查询字段 -> 排序字段
```

但这不是绝对规则，还要结合字段区分度、查询频率和排序需求判断。

## 问题六：OR 条件使用不当

`OR` 条件也可能导致索引使用效果变差。

例如：

```sql
SELECT *
FROM t_order
WHERE phone = '13800138000'
   OR status = 1;
```

如果 `phone` 有索引，但 `status` 没有合适索引，MySQL 可能会放弃部分索引，选择扫描更多数据。

可以考虑改成 `UNION ALL`：

```sql
SELECT * FROM t_order WHERE phone = '13800138000'
UNION ALL
SELECT * FROM t_order WHERE status = 1;
```

当然，是否改写要看业务是否允许重复数据。如果两部分结果可能重复，需要使用 `UNION` 或在业务层去重。

### OR 优化建议

1. `OR` 两边尽量都有合适索引；
2. 复杂 `OR` 可以考虑拆成多个 SQL；
3. 注意结果去重问题；
4. 不要为了优化而牺牲业务正确性。

## 问题七：使用 `!=`、`NOT IN`、`IS NOT NULL`

这类条件并不是一定不能走索引，但通常选择性较差，优化效果有限。

例如：

```sql
SELECT * FROM t_order WHERE status != 1;
```

如果大部分订单状态都不是 1，那么这个条件过滤效果很差，即使有索引也可能不划算。

类似的还有：

```sql
WHERE status NOT IN (1, 2)
WHERE phone IS NOT NULL
```

MySQL 优化器会根据成本评估是否使用索引。如果它认为走索引再回表不如直接扫描，就可能选择全表扫描。

优化思路包括：

1. 尽量使用正向条件；
2. 提高条件区分度；
3. 结合其他过滤条件；
4. 必要时调整业务查询方式。

## 问题八：查询字段过多导致大量回表

很多人写 SQL 喜欢直接：

```sql
SELECT * FROM t_order WHERE status = 1;
```

这在数据量小的时候问题不大，但在大表中可能会增加很多不必要的 IO。

InnoDB 的二级索引叶子节点中存储的是主键值。如果查询字段不在索引中，就需要根据主键再回到聚簇索引中查完整数据，这个过程叫回表。

如果查询字段都在索引里，就可以使用覆盖索引。

例如有索引：

```sql
KEY idx_status_create_time (status, create_time)
```

下面 SQL 可能使用覆盖索引：

```sql
SELECT status, create_time
FROM t_order
WHERE status = 1
ORDER BY create_time DESC
LIMIT 20;
```

如果业务只需要列表展示的部分字段，可以考虑建立更合适的联合索引，减少回表次数。

不过也不要盲目为了覆盖索引把所有字段都塞进索引。索引太多、太宽，会影响写入性能，占用更多磁盘空间。

## 问题九：深分页导致扫描大量数据

后台列表经常会有分页查询：

```sql
SELECT id, order_no, create_time
FROM t_order
WHERE status = 1
ORDER BY create_time DESC
LIMIT 100000, 20;
```

这类深分页会越来越慢。因为 MySQL 需要先扫描并跳过前面 100000 条，再返回 20 条。

优化方式之一是基于上一页最后一条记录做游标分页。

例如第一页：

```sql
SELECT id, order_no, create_time
FROM t_order
WHERE status = 1
ORDER BY create_time DESC, id DESC
LIMIT 20;
```

下一页带上上一页最后一条的 `create_time` 和 `id`：

```sql
SELECT id, order_no, create_time
FROM t_order
WHERE status = 1
  AND (
      create_time < '2026-07-04 10:00:00'
      OR (create_time = '2026-07-04 10:00:00' AND id < 10086)
  )
ORDER BY create_time DESC, id DESC
LIMIT 20;
```

如果是后台管理系统，也可以限制最大翻页深度，避免用户随意跳到特别靠后的页码。

## 如何系统排查一条慢 SQL？

实际工作中，我一般会按下面顺序排查。

### 1. 确认慢 SQL 本身

先通过日志、APM 或慢查询日志确认到底是哪条 SQL 慢。

开启慢查询日志可以参考：

```sql
SHOW VARIABLES LIKE 'slow_query_log';
SHOW VARIABLES LIKE 'long_query_time';
```

查看当前会话执行 SQL 的耗时，也可以临时使用：

```sql
SET profiling = 1;
SHOW PROFILES;
```

不过线上环境更推荐使用慢查询日志、监控平台或链路追踪工具。

### 2. 查看执行计划

```sql
EXPLAIN SELECT ...
```

重点看：

- 是否使用了预期索引；
- 扫描行数是否过大；
- 是否出现 `Using filesort`；
- 是否出现 `Using temporary`；
- 查询类型是否是 `ALL`。

MySQL 8.0 还可以使用：

```sql
EXPLAIN ANALYZE SELECT ...
```

它能看到更接近真实执行过程的信息。

### 3. 检查 SQL 写法

重点检查：

- 索引列是否被函数包裹；
- 是否存在隐式类型转换；
- `LIKE` 是否以 `%` 开头；
- 联合索引是否符合最左前缀原则；
- 是否有不合理的 `OR`；
- 是否查询了过多字段；
- 是否存在深分页。

### 4. 检查索引设计

索引不是越多越好。

设计索引时需要考虑：

- 查询频率；
- 字段区分度；
- 等值查询、范围查询、排序字段顺序；
- 是否能形成覆盖索引；
- 是否影响写入性能。

可以通过下面命令查看表索引：

```sql
SHOW INDEX FROM t_order;
```

### 5. 检查数据分布

有时候索引明明存在，但 MySQL 还是不用，可能是因为数据分布导致优化器判断走索引不划算。

例如 `status` 字段只有几个值，而且某个状态占比特别高，那么单独给 `status` 建索引意义就不大。

这类低区分度字段更适合作为联合索引的一部分，而不是单独建索引。

## 常见索引失效场景总结

图：MySQL 索引失效常见场景

![](images/2026/07/04/mysql-index-failure-summary-placeholder.png)

| 场景 | 示例 | 优化建议 |
| --- | --- | --- |
| 索引列使用函数 | `DATE(create_time)` | 改为时间范围查询 |
| 隐式类型转换 | `phone = 13800138000` | 保持字段和参数类型一致 |
| 前缀模糊查询 | `LIKE '%abc'` | 改前缀查询或使用搜索引擎 |
| 不满足最左前缀 | 联合索引 `(a,b)` 只查 `b` | 调整索引顺序或新增索引 |
| 范围查询后字段受限 | `(a,b,c)` 中 `b > 1` 后查 `c` | 等值字段尽量放前面 |
| OR 条件复杂 | `a = 1 OR b = 2` | 两边建索引或拆 SQL |
| 低区分度字段 | `status` | 放入联合索引，不建议单独滥建 |
| 查询字段过多 | `SELECT *` | 只查必要字段，考虑覆盖索引 |
| 深分页 | `LIMIT 100000,20` | 游标分页或限制翻页深度 |

## 后端开发中的 SQL 优化习惯

除了具体 SQL 技巧，更重要的是养成一些开发习惯。

### 1. 写 SQL 前先想数据量

同样一条 SQL，在 1 千条数据和 1 千万条数据下完全不是一个概念。开发时不能只看当前测试库数据量，而要估算未来业务增长后的情况。

### 2. 不要默认 `SELECT *`

接口需要什么字段就查什么字段，减少网络传输和回表成本。

### 3. 查询条件尽量稳定

如果一个接口支持十几个可选条件，SQL 很容易变得复杂，索引也很难设计。可以根据实际使用频率拆分查询场景，而不是把所有条件堆在一个万能接口里。

### 4. 上线前检查核心 SQL 执行计划

对于高频接口、定时任务、大数据量查询，上线前最好看一下 `EXPLAIN`。很多问题在开发阶段就能发现。

### 5. 慢查询要持续治理

慢 SQL 不是一次性问题。随着数据量变化、业务变化、查询条件变化，原本没问题的 SQL 也可能变慢。因此要结合慢查询日志和监控持续优化。

## 最后回到这次问题

文章开头的慢 SQL，最终主要做了三处优化：

1. 去掉 `DATE(create_time)`，改成标准时间范围查询；
2. 保留并确认联合索引 `(status, create_time)` 能正常使用；
3. 列表接口只查询必要字段，避免 `SELECT *`。

优化后 SQL 如下：

```sql
SELECT id, order_no, user_id, phone, status, amount, create_time
FROM t_order
WHERE status = 1
  AND create_time >= '2026-06-01 00:00:00'
  AND create_time < '2026-07-01 00:00:00'
ORDER BY create_time DESC
LIMIT 0, 20;
```

接口响应时间从秒级下降到几十毫秒级。虽然这不是多复杂的问题，但很典型：索引已经建了，不代表 SQL 一定会正确使用索引。

## 总结

MySQL 优化并不是简单地“加索引”。真正有效的优化，需要同时理解：

- 表结构；
- 数据量；
- 数据分布；
- SQL 写法；
- 索引结构；
- 业务查询场景。

对于后端开发来说，掌握常见索引失效场景非常重要。很多线上慢查询，并不是数据库本身扛不住，而是 SQL 写法没有和索引设计配合好。

最后记住一个原则：

> 不要猜 SQL 会怎么执行，要用 `EXPLAIN` 看它实际怎么执行。

只有基于执行计划和真实数据去分析，SQL 优化才不是玄学。
