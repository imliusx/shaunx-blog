---
title: Elasticsearch 查询优化实践：倒排索引、分页、排序与高亮检索
slug: elasticsearch-query-optimization-inverted-index-pagination-sort-highlight
date: 2026-07-05
category: 开发
tags:
  - Elasticsearch
  - 搜索引擎
  - 倒排索引
  - 查询优化
  - 后端开发
description: Elasticsearch 适合全文检索、日志搜索、商品搜索和复杂筛选，但查询写法、字段类型、分页方式和排序策略都会影响性能。内容通过一个搜索接口变慢的场景，整理倒排索引、text/keyword、bool 查询、分页、排序、高亮、mapping 和慢查询排查思路。
cover:
published: true
---

## 搜索接口为什么会越来越慢

很多业务刚接入 Elasticsearch 时，体验都很好。

例如商品搜索、文章搜索、日志检索，数据量不大时，随便写一个 `match` 查询就能快速返回结果。

但随着数据量增长，问题开始出现：

- 搜索耗时从几十毫秒变成几百毫秒；
- 深分页越来越慢；
- 按时间或价格排序后明显变慢；
- 高亮打开后 CPU 升高；
- 聚合查询拖慢整个接口；
- 搜索结果不符合预期；
- 同一个字段有时能精确匹配，有时又分词匹配。

这些问题通常不是 Elasticsearch “不行”，而是索引设计和查询写法没有跟业务增长一起调整。

Elasticsearch 官方文档可以查看：[Elasticsearch Guide](https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html)。如果要做搜索接口，最少要理解 mapping、倒排索引、分页、排序和慢查询分析。

## 业务场景：文章搜索接口

假设有一个博客或内容系统，需要支持文章搜索。

用户可以按这些条件查询：

```text
关键词
分类
标签
发布时间范围
是否发布
按发布时间排序
标题和正文高亮
分页返回
```

索引名：

```text
blog_article
```

文档示例：

```json
{
  "id": "1001",
  "title": "Redis 缓存穿透、击穿、雪崩：真实业务中的解决方案总结",
  "content": "Redis 是后端系统中最常用的缓存组件之一...",
  "category": "架构",
  "tags": ["Redis", "缓存", "高并发"],
  "published": true,
  "publishedAt": "2026-07-04T10:00:00Z",
  "viewCount": 1024
}
```

搜索接口最开始可能这样写：

```json
{
  "query": {
    "match": {
      "content": "Redis 缓存穿透"
    }
  },
  "from": 0,
  "size": 10
}
```

数据量小的时候没问题，但真正要上线给用户使用，还需要更完整的查询结构。

图：Kibana Dev Tools 查询 blog_article 索引截图

![](images/2026/07/05/elasticsearch-kibana-blog-article-query-placeholder.png)

## 先分清 text 和 keyword

Elasticsearch 查询问题里，很多都来自字段类型没设计好。

最常见的是 `text` 和 `keyword` 混用。

### text 字段

`text` 会被分词，适合全文检索。

例如标题：

```text
Redis 缓存穿透解决方案
```

可能被分成：

```text
redis
缓存
穿透
解决
方案
```

适合：

```text
标题搜索
正文搜索
描述搜索
```

### keyword 字段

`keyword` 不分词，适合精确匹配、排序和聚合。

适合：

```text
分类
标签
状态
订单号
用户 ID
精确编码
```

如果把分类定义成 `text`，再做精确过滤或聚合，就容易出现结果异常或性能问题。

推荐 mapping：

```json
{
  "mappings": {
    "properties": {
      "id": {
        "type": "keyword"
      },
      "title": {
        "type": "text",
        "fields": {
          "keyword": {
            "type": "keyword",
            "ignore_above": 256
          }
        }
      },
      "content": {
        "type": "text"
      },
      "category": {
        "type": "keyword"
      },
      "tags": {
        "type": "keyword"
      },
      "published": {
        "type": "boolean"
      },
      "publishedAt": {
        "type": "date"
      },
      "viewCount": {
        "type": "long"
      }
    }
  }
}
```

这里 `title` 既有 `text`，也有 `title.keyword` 子字段。

用法区分：

```text
title 用于全文搜索
title.keyword 用于精确匹配、排序、聚合
```

图：blog_article mapping 中 text 与 keyword 字段截图

![](images/2026/07/05/elasticsearch-text-keyword-mapping-placeholder.png)

## 倒排索引怎么影响查询

Elasticsearch 的全文检索基于倒排索引。

简单理解：

```text
正排索引：文档 -> 包含哪些词
倒排索引：词 -> 出现在哪些文档中
```

例如有三篇文章：

```text
doc1: Redis 缓存穿透
doc2: Redis 持久化机制
doc3: MySQL 索引优化
```

倒排索引大概是：

```text
Redis -> doc1, doc2
缓存 -> doc1
穿透 -> doc1
持久化 -> doc2
MySQL -> doc3
索引 -> doc3
优化 -> doc3
```

用户搜索 “Redis 缓存” 时，Elasticsearch 可以快速找到包含这些词的文档。

这也解释了为什么分词器很重要。中文如果不使用合适分词器，搜索结果可能很奇怪。

常见中文分词方案：

- IK 分词器；
- smartcn；
- 自定义词典；
- 业务侧预处理关键词。

IK 分词器项目地址：[elasticsearch-analysis-ik](https://github.com/infinilabs/analysis-ik)。

图：IK 分词器 analyze 结果截图

![](images/2026/07/05/elasticsearch-ik-analyze-result-placeholder.png)

## 用 bool 查询组织条件

真实搜索接口不会只有一个关键词，通常还有很多过滤条件。

推荐使用 `bool` 查询组织：

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "Redis 缓存穿透",
            "fields": ["title^3", "content"]
          }
        }
      ],
      "filter": [
        { "term": { "published": true } },
        { "term": { "category": "架构" } },
        {
          "range": {
            "publishedAt": {
              "gte": "2026-01-01T00:00:00Z",
              "lt": "2027-01-01T00:00:00Z"
            }
          }
        }
      ]
    }
  },
  "from": 0,
  "size": 10
}
```

这里有几个关键点。

### must

`must` 参与相关性评分，适合全文检索。

例如：

```json
{
  "multi_match": {
    "query": "Redis 缓存穿透",
    "fields": ["title^3", "content"]
  }
}
```

`title^3` 表示标题命中权重更高。

### filter

`filter` 不参与评分，适合精确过滤。

例如：

```json
{ "term": { "published": true } }
```

过滤条件通常可以被缓存，性能比放在 `must` 中更合适。

常见经验：

```text
全文检索放 must
精确条件放 filter
排除条件放 must_not
可选加分条件放 should
```

图：bool 查询 must 与 filter 执行结果截图

![](images/2026/07/05/elasticsearch-bool-query-must-filter-placeholder.png)

## term 和 match 不要混用

`term` 和 `match` 也很容易用错。

### term

`term` 不会分析查询词，适合 keyword、boolean、number、date 等精确字段。

```json
{
  "term": {
    "category": "架构"
  }
}
```

### match

`match` 会对查询文本做分析，适合 text 字段。

```json
{
  "match": {
    "content": "Redis 缓存穿透"
  }
}
```

错误示例：

```json
{
  "term": {
    "content": "Redis 缓存穿透"
  }
}
```

如果 `content` 是 `text` 字段，索引时已经被分词，直接用完整字符串做 `term` 精确匹配，很可能查不到。

另一个错误示例：

```json
{
  "match": {
    "category": "架构"
  }
}
```

如果 `category` 是 keyword 字段，虽然可能能查，但语义上不如 `term` 清晰。

## 分页：from + size 的问题

普通分页最常见：

```json
{
  "from": 0,
  "size": 10
}
```

第 100 页：

```json
{
  "from": 990,
  "size": 10
}
```

问题出现在深分页。

例如：

```json
{
  "from": 100000,
  "size": 10
}
```

Elasticsearch 需要在每个分片上取出大量候选结果，再在协调节点合并排序，最后丢弃前 100000 条，只返回 10 条。

这会造成明显开销。

默认情况下，Elasticsearch 有 `index.max_result_window` 限制，通常是 10000。官方分页文档：[Paginate search results](https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html)。

后台管理系统如果只是简单翻页，可以限制最大页数。

面向用户的搜索结果，更推荐使用 `search_after`。

## search_after 适合滚动翻页

`search_after` 不依赖偏移量，而是基于上一页最后一条记录的排序值继续查。

第一页：

```json
{
  "size": 10,
  "query": {
    "bool": {
      "filter": [
        { "term": { "published": true } }
      ]
    }
  },
  "sort": [
    { "publishedAt": "desc" },
    { "id": "desc" }
  ]
}
```

返回结果中每条都有 sort 值：

```json
{
  "_source": {
    "id": "1001",
    "title": "Redis 缓存穿透..."
  },
  "sort": ["2026-07-04T10:00:00.000Z", "1001"]
}
```

下一页带上上一页最后一条的 sort 值：

```json
{
  "size": 10,
  "query": {
    "bool": {
      "filter": [
        { "term": { "published": true } }
      ]
    }
  },
  "sort": [
    { "publishedAt": "desc" },
    { "id": "desc" }
  ],
  "search_after": ["2026-07-04T10:00:00.000Z", "1001"]
}
```

注意：`search_after` 必须配合稳定排序字段。通常要加一个唯一字段作为兜底排序，比如 `id`。

适合：

```text
下拉加载更多
无限滚动
大结果集翻页
```

不适合：

```text
随机跳到第 100 页
传统页码组件
```

图：search_after 返回 sort 值截图

![](images/2026/07/05/elasticsearch-search-after-sort-values-placeholder.png)

## 排序字段要小心

排序是搜索性能的重要影响因素。

常见排序：

```json
{
  "sort": [
    { "publishedAt": "desc" },
    { "id": "desc" }
  ]
}
```

适合排序的字段一般是：

```text
keyword
number
date
boolean
```

不要直接对 `text` 字段排序。

如果要按标题排序，用：

```json
{
  "sort": [
    { "title.keyword": "asc" }
  ]
}
```

而不是：

```json
{
  "sort": [
    { "title": "asc" }
  ]
}
```

排序字段还要注意 doc_values。keyword、number、date 默认支持 doc_values，适合排序和聚合。

如果关闭了 doc_values，排序和聚合可能会受影响。

图：Elasticsearch sort on text field 报错截图

![](images/2026/07/05/elasticsearch-sort-text-field-error-placeholder.png)

## 高亮检索不要滥用

搜索页面经常需要高亮关键词。

示例：

```json
{
  "query": {
    "multi_match": {
      "query": "Redis 缓存穿透",
      "fields": ["title", "content"]
    }
  },
  "highlight": {
    "fields": {
      "title": {},
      "content": {
        "fragment_size": 120,
        "number_of_fragments": 2
      }
    },
    "pre_tags": ["<em>"],
    "post_tags": ["</em>"]
  }
}
```

高亮会增加额外开销，尤其是长正文高亮。

优化建议：

1. 只对需要展示的字段高亮；
2. 控制 `fragment_size`；
3. 控制 `number_of_fragments`；
4. 不要对特别长的大字段无脑高亮；
5. 搜索列表只高亮摘要，详情页再展示完整内容。

如果文章正文很长，可以额外存一个摘要字段：

```json
{
  "summary": "Redis 缓存穿透可以通过缓存空值和布隆过滤器解决..."
}
```

列表页优先高亮 `title` 和 `summary`，不要直接高亮完整 `content`。

图：Elasticsearch highlight 返回结果截图

![](images/2026/07/05/elasticsearch-highlight-result-placeholder.png)

## 控制 _source 返回字段

搜索接口不一定要返回完整文档。

错误习惯：

```json
{
  "query": { ... },
  "from": 0,
  "size": 10
}
```

默认会返回完整 `_source`。

如果 `content` 很大，列表接口会传输大量无用数据。

推荐指定字段：

```json
{
  "_source": ["id", "title", "category", "tags", "publishedAt", "viewCount"],
  "query": {
    "bool": {
      "filter": [
        { "term": { "published": true } }
      ]
    }
  },
  "from": 0,
  "size": 10
}
```

这样可以减少：

```text
磁盘读取
网络传输
JSON 序列化
后端对象反序列化
```

对于高频搜索接口，这个优化很实用。

## 查询前先看 explain 和 profile

Elasticsearch 提供了 `explain` 和 `profile` 帮助分析查询。

### explain

`explain` 可以查看某个文档为什么命中，以及评分如何计算。

```bash
GET /blog_article/_explain/1001
{
  "query": {
    "match": {
      "content": "Redis 缓存穿透"
    }
  }
}
```

适合排查：

```text
为什么这条文档排在前面
为什么某条文档没有命中
评分是怎么来的
```

### profile

`profile` 可以分析查询耗时。

```json
{
  "profile": true,
  "query": {
    "bool": {
      "must": [
        {
          "match": {
            "content": "Redis 缓存穿透"
          }
        }
      ],
      "filter": [
        {
          "term": {
            "published": true
          }
        }
      ]
    }
  }
}
```

`profile` 结果会比较长，适合开发和测试环境排查，不建议生产常态开启。

图：Elasticsearch profile 查询耗时截图

![](images/2026/07/05/elasticsearch-profile-query-time-placeholder.png)

## 慢查询日志要打开

Elasticsearch 支持搜索慢日志。官方文档：[Search slow log](https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-slowlog.html)。

可以按索引配置：

```bash
PUT /blog_article/_settings
{
  "index.search.slowlog.threshold.query.warn": "1s",
  "index.search.slowlog.threshold.query.info": "500ms",
  "index.search.slowlog.threshold.fetch.warn": "1s",
  "index.search.slowlog.threshold.fetch.info": "500ms"
}
```

慢日志可以帮助发现：

- 哪些查询特别慢；
- 慢在 query 阶段还是 fetch 阶段；
- 是否因为返回字段太大；
- 是否因为排序或高亮；
- 是否有异常深分页。

图：Elasticsearch search slow log 截图

![](images/2026/07/05/elasticsearch-search-slowlog-placeholder.png)

## Java 客户端查询示例

后端使用 Java 调 Elasticsearch 时，可以把查询条件组装清楚。

下面是一个简化示例，使用 Elasticsearch Java API Client。客户端文档：[Elasticsearch Java API Client](https://www.elastic.co/guide/en/elasticsearch/client/java-api-client/current/index.html)。

```java
public SearchResponse<ArticleDocument> searchArticles(ArticleSearchRequest request) throws IOException {
    return elasticsearchClient.search(s -> s
            // 指定索引
            .index("blog_article")

            // 列表页只取必要字段，避免返回大字段 content
            .source(src -> src.filter(f -> f.includes(
                    "id", "title", "category", "tags", "publishedAt", "viewCount"
            )))

            // 查询条件使用 bool 组合，全文检索和过滤条件分开
            .query(q -> q.bool(b -> {
                if (StringUtils.hasText(request.getKeyword())) {
                    b.must(m -> m.multiMatch(mm -> mm
                            .query(request.getKeyword())
                            .fields("title^3", "content")
                    ));
                }

                b.filter(f -> f.term(t -> t
                        .field("published")
                        .value(true)
                ));

                if (StringUtils.hasText(request.getCategory())) {
                    b.filter(f -> f.term(t -> t
                            .field("category")
                            .value(request.getCategory())
                    ));
                }

                return b;
            }))

            // 避免 pageSize 被前端传得过大
            .from(Math.max(request.getPageNo() - 1, 0) * request.safePageSize())
            .size(request.safePageSize())

            // 使用 date + id 做稳定排序
            .sort(sort -> sort.field(f -> f.field("publishedAt").order(SortOrder.Desc)))
            .sort(sort -> sort.field(f -> f.field("id").order(SortOrder.Desc)))

            // 列表页只高亮标题和摘要，避免大字段高亮拖慢查询
            .highlight(h -> h
                    .fields("title", hf -> hf)
                    .fields("summary", hf -> hf.fragmentSize(120).numberOfFragments(2))
                    .preTags("<em>")
                    .postTags("</em>")
            ),
            ArticleDocument.class
    );
}
```

这段代码里有几个重点：

```text
_source 控制返回字段
must 做全文检索
filter 做精确过滤
pageSize 做上限保护
排序字段使用 date 和 keyword
高亮字段控制范围
```

## 常见错误清单

### 1. keyword 字段用了 match

不是完全不能用，但语义不清晰。精确过滤用 `term` 更合适。

### 2. text 字段用了 term

全文字段已经被分词，完整字符串 `term` 往往查不到。

### 3. 深分页还在用 from + size

超过一定深度后，性能会明显变差。搜索列表更适合 `search_after`。

### 4. 对 text 字段排序

排序应该使用 keyword、date、number 等字段。

### 5. 高亮完整正文

长字段高亮非常容易拖慢查询。列表页尽量高亮标题和摘要。

### 6. 返回完整 _source

搜索列表不需要返回正文大字段。用 `_source` includes 控制字段。

### 7. mapping 后期频繁改

mapping 不是随便改的。字段类型设计错了，很多时候需要重建索引。

### 8. 查询和写入都打到同一个大索引

日志、事件这类时间序列数据更适合按时间滚动索引。

## 重建索引要提前设计

Elasticsearch 字段类型一旦确定，很多修改不能直接完成。

例如把 `category` 从 `text` 改成 `keyword`，通常需要新建索引并重建数据。

常见做法是使用别名。

```text
blog_article_v1
blog_article_v2
blog_article_alias
```

读写都访问别名：

```text
blog_article_alias
```

重建流程：

```text
创建 blog_article_v2
-> 全量同步数据到 v2
-> 增量同步变更
-> 校验文档数量和查询结果
-> 切换 alias 到 v2
-> 保留 v1 一段时间用于回滚
```

别名文档：[Aliases](https://www.elastic.co/guide/en/elasticsearch/reference/current/aliases.html)。

图：Elasticsearch alias 指向新旧索引截图

![](images/2026/07/05/elasticsearch-index-alias-switch-placeholder.png)

## 搜索接口上线前检查

上线前可以按下面清单过一遍：

```text
mapping 是否区分 text 和 keyword
过滤条件是否放在 filter
排序字段是否支持 doc_values
分页是否限制最大 from
是否需要 search_after
_source 是否只返回必要字段
高亮字段是否可控
是否打开慢查询日志
是否看过 profile 结果
是否有重建索引方案
是否有查询耗时监控
```

如果搜索接口是核心入口，还要监控：

```text
查询 QPS
P95 / P99 耗时
慢查询数量
高亮耗时
聚合耗时
集群 CPU
JVM heap
segment 数量
磁盘使用率
```

图：Elasticsearch 查询耗时监控面板截图

![](images/2026/07/05/elasticsearch-query-latency-dashboard-placeholder.png)

## 收尾

Elasticsearch 查询优化的核心不是记住某个参数，而是理解查询背后的数据结构和执行成本。

几个原则很实用：

```text
全文检索字段用 text
精确过滤字段用 keyword
全文条件放 must
过滤条件放 filter
深分页避免 from + size
排序字段不要用 text
高亮只做必要字段
列表页控制 _source
慢查询用 slowlog 和 profile 查
mapping 设计错了就准备重建索引
```

搜索系统最怕“刚开始能用，后来不敢改”。字段类型、分页方式、排序策略和索引别名最好一开始就设计好。

如果只是普通业务搜索，先把 mapping、bool 查询、分页、高亮和慢查询日志做好，就已经能避开大部分性能坑。
