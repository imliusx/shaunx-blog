---
title: 「设计模式系列」策略模式应用：消除大量 if-else
slug: design-pattern-strategy-remove-if-else
date: 2024-12-05
category: 架构
tags:
  - 设计模式
  - 策略模式
  - Java
  - Spring Boot
  - 代码重构
description: 策略模式适合处理同一业务动作下的多种算法、规则或渠道差异。内容通过支付渠道、优惠计算和消息发送等后端常见场景，展示如何把大量 if-else 分支重构为可扩展的策略实现，并结合 Spring Boot 自动注入策略集合完成落地。
cover:
published: true
---

## 先看一段很熟悉的代码

业务刚开始不复杂时，很多代码都会写成这样：

```java
public PayResult pay(PayRequest request) {
    String payType = request.getPayType();

    if ("wechat".equals(payType)) {
        return wechatPay(request);
    } else if ("alipay".equals(payType)) {
        return alipayPay(request);
    } else if ("bank_card".equals(payType)) {
        return bankCardPay(request);
    } else {
        throw new BusinessException("不支持的支付方式");
    }
}
```

三种支付方式时，这段代码还能接受。

但业务继续迭代后，可能变成：

```text
微信支付
支付宝支付
银行卡支付
余额支付
积分支付
Apple Pay
线下转账
企业钱包
```

每加一种支付方式，就要改这个方法。

问题会越来越明显：

- `if-else` 越来越长；
- 每个分支逻辑越来越复杂；
- 新增渠道要修改老代码；
- 单元测试越来越难写；
- 某个分支改错可能影响其他分支；
- 代码不符合开闭原则。

策略模式就是专门解决这类问题的设计模式之一。

设计模式最早来自 GoF，《Design Patterns: Elements of Reusable Object-Oriented Software》。策略模式的核心思想很简单：把可变的算法或规则封装成独立策略，让调用方只依赖统一接口。

## 什么场景适合策略模式

策略模式不是为了炫技，也不是看到 `if-else` 就一定要用。

它适合这些场景：

```text
同一个业务动作有多种实现
不同实现之间可以互相替换
新增实现时不希望修改主流程
分支逻辑会持续扩展
每个分支都有一定复杂度
```

后端常见场景：

| 场景 | 策略 |
| --- | --- |
| 支付 | 微信、支付宝、银行卡、余额 |
| 优惠 | 满减、折扣、优惠券、会员价 |
| 消息发送 | 短信、邮件、站内信、企业微信 |
| 文件上传 | 本地、MinIO、阿里云 OSS、S3 |
| 登录 | 密码登录、验证码登录、OAuth 登录 |
| 导出 | Excel、CSV、PDF |
| 风控 | 黑名单、限频、设备校验、地区校验 |

如果只是两个非常简单的分支，而且不会扩展，普通 `if-else` 更直接。

策略模式适合“变化点明确，并且未来会继续扩展”的代码。

图：支付方式 if-else 分支代码截图

![](images/2026/07/05/strategy-pattern-pay-if-else-placeholder.png)

## 第一步：定义策略接口

以支付为例，先定义一个统一接口。

```java
public interface PayStrategy {

    /**
     * 当前策略支持的支付方式。
     * 例如：wechat、alipay、bank_card。
     */
    String supportPayType();

    /**
     * 执行支付。
     * 不同支付渠道内部实现不同，但对外都暴露同一个 pay 方法。
     */
    PayResult pay(PayRequest request);
}
```

这个接口有两个职责：

```text
告诉外部自己支持哪种支付方式
执行具体支付逻辑
```

也可以把 `supportPayType()` 改成枚举：

```java
PayType supportPayType();
```

实际项目里更推荐枚举，避免字符串写错。

```java
public enum PayType {
    WECHAT,
    ALIPAY,
    BANK_CARD
}
```

## 第二步：拆分具体策略

微信支付策略：

```java
@Component
public class WechatPayStrategy implements PayStrategy {

    @Override
    public String supportPayType() {
        return "wechat";
    }

    @Override
    public PayResult pay(PayRequest request) {
        // 1. 校验微信支付必要参数
        validateWechatRequest(request);

        // 2. 组装微信支付请求报文
        WechatPayCommand command = buildWechatCommand(request);

        // 3. 调用微信支付接口
        WechatPayResponse response = callWechatPay(command);

        // 4. 把三方响应转换成统一支付结果
        return convertResult(response);
    }
}
```

支付宝支付策略：

```java
@Component
public class AlipayPayStrategy implements PayStrategy {

    @Override
    public String supportPayType() {
        return "alipay";
    }

    @Override
    public PayResult pay(PayRequest request) {
        // 支付宝渠道有自己的参数校验和签名逻辑
        validateAlipayRequest(request);

        AlipayCommand command = buildAlipayCommand(request);
        AlipayResponse response = callAlipay(command);

        return convertResult(response);
    }
}
```

银行卡支付策略：

```java
@Component
public class BankCardPayStrategy implements PayStrategy {

    @Override
    public String supportPayType() {
        return "bank_card";
    }

    @Override
    public PayResult pay(PayRequest request) {
        // 银行卡支付可能需要风控、绑卡校验、短信确认等流程
        checkBankCard(request);
        checkRisk(request);

        BankPayResponse response = callBankPay(request);
        return convertResult(response);
    }
}
```

拆分后，每个支付方式只关心自己的实现，不再挤在一个大方法里。

图：PayStrategy 及其实现类结构截图

![](images/2026/07/05/strategy-pattern-pay-strategy-classes-placeholder.png)

## 第三步：用 Spring 收集所有策略

Spring Boot 项目里，可以让 Spring 自动注入所有 `PayStrategy` 实现。

```java
@Component
public class PayStrategyFactory {

    private final Map<String, PayStrategy> strategyMap = new HashMap<>();

    public PayStrategyFactory(List<PayStrategy> strategies) {
        for (PayStrategy strategy : strategies) {
            String payType = strategy.supportPayType();

            // 启动时检查重复策略，避免两个策略支持同一种支付方式
            if (strategyMap.containsKey(payType)) {
                throw new IllegalStateException("重复的支付策略：" + payType);
            }

            strategyMap.put(payType, strategy);
        }
    }

    public PayStrategy getStrategy(String payType) {
        PayStrategy strategy = strategyMap.get(payType);
        if (strategy == null) {
            throw new BusinessException("不支持的支付方式：" + payType);
        }
        return strategy;
    }
}
```

这里的关键点是构造方法注入：

```java
public PayStrategyFactory(List<PayStrategy> strategies)
```

Spring 会把容器中所有 `PayStrategy` Bean 注入进来。

启动时组装成 Map：

```text
wechat -> WechatPayStrategy
alipay -> AlipayPayStrategy
bank_card -> BankCardPayStrategy
```

这样后续查找策略就是一次 Map 查询。

## 第四步：主流程只依赖策略接口

重构后的支付服务：

```java
@Service
public class PayService {

    private final PayStrategyFactory payStrategyFactory;

    public PayService(PayStrategyFactory payStrategyFactory) {
        this.payStrategyFactory = payStrategyFactory;
    }

    public PayResult pay(PayRequest request) {
        // 主流程只负责选择策略，不再关心每种支付渠道的细节
        PayStrategy strategy = payStrategyFactory.getStrategy(request.getPayType());

        // 具体支付逻辑交给对应策略实现
        return strategy.pay(request);
    }
}
```

对比原来的 `if-else`：

```java
if ("wechat".equals(payType)) {
    return wechatPay(request);
} else if ("alipay".equals(payType)) {
    return alipayPay(request);
} else if ("bank_card".equals(payType)) {
    return bankCardPay(request);
}
```

现在新增一种支付方式，只需要新增一个策略类：

```java
@Component
public class BalancePayStrategy implements PayStrategy {

    @Override
    public String supportPayType() {
        return "balance";
    }

    @Override
    public PayResult pay(PayRequest request) {
        // 余额支付逻辑
        return doBalancePay(request);
    }
}
```

主流程不用改。

这就是策略模式带来的扩展性。

## 策略模式不是为了完全消灭 if

策略模式不是说代码里不能出现任何 `if`。

它消除的是“主流程里不断扩展的业务分支”。

策略内部仍然可以有必要判断。

例如微信支付策略里：

```java
if (request.getAmount().compareTo(BigDecimal.ZERO) <= 0) {
    throw new BusinessException("支付金额必须大于 0");
}
```

这种判断是渠道内部规则，放在策略里没问题。

真正要避免的是这种主流程：

```java
if (payType == WECHAT) {
    // 微信几十行
} else if (payType == ALIPAY) {
    // 支付宝几十行
} else if (payType == BANK_CARD) {
    // 银行卡几十行
}
```

主流程应该稳定，变化点应该下沉到策略实现中。

## 再看一个优惠计算例子

支付是典型场景，优惠计算也很适合策略模式。

假设有几种优惠：

```text
满减
折扣
优惠券
会员价
```

最开始可能这样写：

```java
public BigDecimal calculateDiscount(Order order, Promotion promotion) {
    if (promotion.getType() == PromotionType.FULL_REDUCTION) {
        return calculateFullReduction(order, promotion);
    }

    if (promotion.getType() == PromotionType.DISCOUNT) {
        return calculateDiscountRate(order, promotion);
    }

    if (promotion.getType() == PromotionType.COUPON) {
        return calculateCoupon(order, promotion);
    }

    return BigDecimal.ZERO;
}
```

重构后定义策略：

```java
public interface PromotionStrategy {

    PromotionType supportType();

    BigDecimal calculate(Order order, Promotion promotion);
}
```

满减策略：

```java
@Component
public class FullReductionPromotionStrategy implements PromotionStrategy {

    @Override
    public PromotionType supportType() {
        return PromotionType.FULL_REDUCTION;
    }

    @Override
    public BigDecimal calculate(Order order, Promotion promotion) {
        BigDecimal totalAmount = order.getTotalAmount();

        // 未达到满减门槛，优惠金额为 0
        if (totalAmount.compareTo(promotion.getThresholdAmount()) < 0) {
            return BigDecimal.ZERO;
        }

        return promotion.getDiscountAmount();
    }
}
```

折扣策略：

```java
@Component
public class DiscountPromotionStrategy implements PromotionStrategy {

    @Override
    public PromotionType supportType() {
        return PromotionType.DISCOUNT;
    }

    @Override
    public BigDecimal calculate(Order order, Promotion promotion) {
        BigDecimal totalAmount = order.getTotalAmount();
        BigDecimal discountRate = promotion.getDiscountRate();

        // 优惠金额 = 原价 - 折后价
        return totalAmount.subtract(totalAmount.multiply(discountRate));
    }
}
```

优惠计算服务只负责选择策略：

```java
@Service
public class PromotionService {

    private final Map<PromotionType, PromotionStrategy> strategyMap;

    public PromotionService(List<PromotionStrategy> strategies) {
        this.strategyMap = strategies.stream()
                // 按优惠类型建立策略映射
                .collect(Collectors.toMap(PromotionStrategy::supportType, Function.identity()));
    }

    public BigDecimal calculate(Order order, Promotion promotion) {
        PromotionStrategy strategy = strategyMap.get(promotion.getType());
        if (strategy == null) {
            throw new BusinessException("不支持的优惠类型");
        }
        return strategy.calculate(order, promotion);
    }
}
```

图：PromotionStrategy 策略映射 Map 调试截图

![](images/2026/07/05/strategy-pattern-promotion-map-debug-placeholder.png)

## 策略模式和工厂模式经常一起用

策略模式解决“不同策略如何封装”。

工厂模式解决“如何获取策略”。

在上面的支付例子里：

```text
PayStrategy 是策略接口
WechatPayStrategy / AlipayPayStrategy 是具体策略
PayStrategyFactory 是策略工厂
```

这两个模式经常配合使用。

如果没有工厂，调用方可能还要自己判断用哪个策略，那 `if-else` 只是换了地方。

比较推荐的结构是：

```text
Controller
-> Service 主流程
-> StrategyFactory 获取策略
-> Strategy 执行业务差异
```

不要让 Controller 直接选择策略，也不要让策略工厂承担业务流程。

## 策略模式和枚举策略

有些简单场景可以用枚举实现策略。

例如根据订单状态返回文案：

```java
public enum OrderStatus {

    CREATED {
        @Override
        public String displayText() {
            return "待支付";
        }
    },

    PAID {
        @Override
        public String displayText() {
            return "已支付";
        }
    },

    CANCELLED {
        @Override
        public String displayText() {
            return "已取消";
        }
    };

    public abstract String displayText();
}
```

这种方式适合：

```text
策略数量少
逻辑很简单
不依赖 Spring Bean
不需要注入外部服务
```

不适合：

```text
策略逻辑复杂
需要调用数据库或远程接口
策略需要配置化
策略数量会持续扩展
```

复杂业务还是更适合“接口 + 实现类 + 工厂”。

## 策略模式的优点

### 1. 消除主流程大量分支

主流程变得更稳定。

```java
PayStrategy strategy = payStrategyFactory.getStrategy(payType);
return strategy.pay(request);
```

### 2. 新增策略更安全

新增支付方式时，只需要新增一个实现类，不必修改老的主流程。

### 3. 单元测试更容易

每个策略都可以单独测试。

```java
class WechatPayStrategyTest {

    @Test
    void shouldPaySuccessWhenWechatResponseSuccess() {
        // 只测试微信支付策略，不需要关心其他支付方式
    }
}
```

### 4. 代码职责更清晰

每个策略聚焦自己的业务规则，不同分支不会混在一起。

## 策略模式的缺点

策略模式不是没有成本。

### 1. 类数量会增加

原来一个大类，现在拆成多个策略类。

如果业务很简单，可能显得过度设计。

### 2. 调用链变长

从主流程跳到工厂，再跳到策略实现。新同事刚看代码时，需要先理解结构。

### 3. 策略选择逻辑要维护好

策略 key 不能重复，不能缺失。

建议在工厂初始化时检查重复策略。

```java
if (strategyMap.containsKey(payType)) {
    throw new IllegalStateException("重复策略：" + payType);
}
```

### 4. 不适合所有 if-else

如果分支不会扩展，或者只是简单判断，没必要强行策略模式。

## 常见误区

### 误区一：只要有 if-else 就上策略模式

两个简单分支没必要拆十几个类。

设计模式要解决复杂度，不要制造复杂度。

### 误区二：策略类里塞完整业务流程

策略应该处理差异点，不应该把主流程复制一份。

例如支付主流程可以是：

```text
参数校验
创建支付单
选择支付策略
调用渠道支付
记录支付流水
返回结果
```

策略只负责“调用渠道支付”这部分差异。

### 误区三：工厂里继续写大量 if-else

如果工厂这样写：

```java
if ("wechat".equals(payType)) {
    return wechatPayStrategy;
} else if ("alipay".equals(payType)) {
    return alipayPayStrategy;
}
```

那只是把 `if-else` 从 Service 挪到了 Factory。

更推荐用 Map。

### 误区四：策略 key 用字符串到处传

字符串容易写错。

更推荐枚举：

```java
public enum PayType {
    WECHAT,
    ALIPAY,
    BANK_CARD
}
```

策略接口也可以改成：

```java
PayType supportPayType();
```

## 一个更完整的支付结构

实际项目里，可以组织成这样：

```text
payment/
├── PayService.java
├── PayRequest.java
├── PayResult.java
├── PayType.java
├── strategy/
│   ├── PayStrategy.java
│   ├── WechatPayStrategy.java
│   ├── AlipayPayStrategy.java
│   ├── BankCardPayStrategy.java
│   └── BalancePayStrategy.java
└── factory/
    └── PayStrategyFactory.java
```

调用关系：

```text
PayService
-> PayStrategyFactory
-> PayStrategy
-> 具体渠道实现
```

图：支付策略模式包结构截图

![](images/2026/07/05/strategy-pattern-payment-package-structure-placeholder.png)

## 什么时候不要用策略模式

这些场景不建议强行使用：

```text
分支很少，而且不会扩展
每个分支只有一两行代码
策略之间强依赖，无法独立封装
主流程本身还没稳定
只是为了消除 if-else 而消除
```

例如：

```java
if (amount.compareTo(BigDecimal.ZERO) > 0) {
    return "有效金额";
}
return "无效金额";
```

这种判断不需要策略模式。

设计模式是为了管理变化，而不是让代码看起来更“高级”。

## 收尾

策略模式的核心是把变化的规则封装起来，让主流程保持稳定。

可以用一句话记住：

```text
主流程不关心具体怎么做，只关心找哪个策略来做。
```

在 Java 后端项目里，策略模式尤其适合这些场景：

```text
支付渠道
优惠计算
消息发送
文件存储
登录方式
导出格式
风控规则
```

落地时推荐使用：

```text
策略接口
具体策略实现
Spring 自动注入策略集合
Map 注册策略
Service 主流程调用策略
```

不要为了消除所有 `if-else` 而过度设计。真正值得重构的，是那些会不断扩展、逻辑不断变复杂、已经影响可维护性的业务分支。

