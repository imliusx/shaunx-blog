---
title: Statly for Mac：如何开发一款轻量的原生 macOS 系统监控工具
slug: statly-lightweight-native-macos-system-monitor
date: 2026-07-15
category: 项目
tags:
  - Swift
  - macOS
  - AppKit
  - SwiftUI
  - 性能优化
description: Statly 是一款使用 Swift、AppKit 与 SwiftUI 开发的轻量 macOS 菜单栏系统监控工具。本文从需求背景、架构设计、系统指标采集、状态栏渲染、性能优化到 DMG 发布，复盘它的完整开发过程。
cover:
published: true
---

## 前言

开发项目时，我经常需要在编辑器、浏览器、Docker 和本地服务之间来回切换。机器一旦变慢，第一反应通常是打开「活动监视器」，再判断究竟是 CPU、内存、磁盘还是网络出了问题。

有一次运行全栈项目时，前端页面长时间空白，却没有明显报错。排查后才发现，异常的打包过程一直占用大量系统资源。如果当时能直接从菜单栏看到负载变化，定位问题会快很多。

网上已经有 iStat Menus、Stats 等成熟工具，但我真正高频查看的指标并不多。相比堆叠更多功能，我更想要一个原生、克制、随时可见，并且不会为了监控系统反而持续消耗太多系统资源的工具。

于是我开发了 [Statly](https://github.com/imliusx/statly)。它使用 Swift 编写，常驻 macOS 菜单栏，实时展示 CPU、内存、温度、网络与磁盘五类指标。目前发布的 `v0.4.1` 没有第三方依赖，DMG 不足 1M。

![](images/2026/08/12/img-20260812223934573.png)

状态栏与详情面板：

![](images/2026/08/12/img-20260812222039287.png)

设置窗口：

![](images/2026/08/12/img-20260812222039287%201.png)

## Statly 目前能做什么

Statly 将每项指标做成一个独立的菜单栏模块。模块可以单独开关，也可以按住 `Command` 拖动调整顺序。

| 模块 | 菜单栏信息 | 点击后的详情 |
|---|---|---|
| CPU | 总占用率 | 历史曲线、CPU 占用最高的 5 个进程 |
| 内存 | 已用内存比例 | 历史曲线、App/联动/压缩内存、内存占用最高的 5 个进程 |
| 温度 | CPU 或电池温度 | 历史曲线、平均温度、传感器数量 |
| 网络 | 实时上下行速率 | 速率曲线、本机 IP、网关、DNS、公网 IP 与归属地 |
| 磁盘 | 已用容量比例 | 容量、可用空间、实时读写速率 |

占用类指标可以使用「圆环 + 数值」或纯文本样式，标签则可以选择图标、横排文字、竖排文字或隐藏。圆环模式下，将鼠标悬停在模块上还能看到更精确的数据。

此外，应用还支持 1、2、5 秒三档刷新间隔、开机自启、深浅色自动适配和手动检查更新。它以 `LSUIElement` 应用运行，不显示 Dock 图标，也不启动额外的守护进程。

## 先确定边界，再选择技术

Statly 的目标不是取代完整的硬件监控套件，而是用尽可能低的常驻成本提供最常用的信息。因此，我先给项目定下几条约束：

- 单进程运行，不增加后台 helper；
- 不申请系统权限，不要求 root；
- 所有模块共用一次定时唤醒；
- 弹窗关闭时，不继续采集进程榜单等高成本数据；
- 零第三方依赖，尽量缩小包体积；
- 最低支持 macOS 13，使用系统原生能力完成界面与登录项管理。

技术栈最终选择了 **AppKit + SwiftUI 混合方案**：

- AppKit 负责菜单栏、应用生命周期和高频渲染路径；
- SwiftUI 负责详情面板与设置窗口；
- Swift Charts 绘制指标历史曲线；
- Mach、Darwin、IOKit、SystemConfiguration 和 libproc 负责底层数据采集；
- Combine 连接设置、指标仓库与界面状态。

这里没有直接使用 SwiftUI 的 `MenuBarExtra`。Statly 需要为每个指标单独控制宽度、点击行为、顺序持久化和高频刷新，`NSStatusItem` 在这些场景下更直接，也更容易对实际渲染成本做精细控制。

## 项目结构与数据流

核心代码集中在 `Sources/StatlyKit`：

```text
Sources/StatlyKit/
├── App/          应用入口与 AppCoordinator
├── Core/         调度器、指标仓库、历史缓冲、设置和格式化
├── Samplers/     CPU、内存、温度、网络、磁盘采样器
└── UI/
    ├── StatusBar/  菜单栏控制与离屏渲染
    ├── Popover/    指标详情面板
    └── Settings/   设置窗口
```

一次完整的数据流如下：

```text
DispatchSourceTimer
        ↓
SamplerSet 在后台队列采集已启用模块
        ↓
SystemSnapshot 汇总本次结果
        ↓
MetricStore 保存最新值与定长历史
        ↓
StatusRenderer 更新 NSStatusItem
        ↓
用户点击后，SwiftUI 详情面板读取 MetricStore
```

`AppCoordinator` 是这条链路的总协调器。它持有设置、采样器、调度器、状态栏控制器和弹窗，并保证采样在后台队列执行，界面更新回到主线程。

## 用一次定时唤醒采集所有指标

如果每个模块各自创建一个 Timer，五个模块就会产生五套调度和唤醒。即使每次任务都很短，长期常驻也会带来没有必要的能耗。

Statly 只维护一个 `DispatchSourceTimer`：

```swift
final class Scheduler {
    private let queue = DispatchQueue(
        label: "statly.sampling",
        qos: .utility
    )
    private var timer: DispatchSourceTimer?
    var handler: (() -> Void)?

    func start(interval: TimeInterval) {
        stop()

        let timer = DispatchSource.makeTimerSource(queue: queue)
        let leeway = DispatchTimeInterval.milliseconds(
            max(100, Int(interval * 250))
        )
        timer.schedule(
            deadline: .now(),
            repeating: interval,
            leeway: leeway
        )
        timer.setEventHandler { [weak self] in
            self?.handler?()
        }
        timer.resume()
        self.timer = timer
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }
}
```

`leeway` 允许系统在一定范围内合并唤醒。定时器触发后，`SamplerSet` 在同一个后台任务中依次采集当前启用的模块：

```swift
func sample(
    enabled: Set<ModuleID>,
    temperatureSource: TemperatureSource
) -> SystemSnapshot {
    SystemSnapshot(
        cpu: enabled.contains(.cpu) ? cpu.sample() : nil,
        memory: enabled.contains(.memory) ? memory.sample() : nil,
        temperature: enabled.contains(.temperature)
            ? temperature.sample(source: temperatureSource) : nil,
        network: enabled.contains(.network) ? network.sample() : nil,
        disk: enabled.contains(.disk) ? disk.sample() : nil
    )
}
```

屏幕休眠时，协调器会停止调度；屏幕唤醒后，则先重置 CPU、网络和磁盘 I/O 的差值基线，再恢复采样。否则把整个休眠时段累计的数据除以一个普通刷新周期，很容易在唤醒瞬间得到错误尖峰。

## 五类系统指标如何采集

macOS 没有一个统一 API 能返回 Statly 所需的全部数据，每类指标都要选择合适的数据源。

| 指标 | 数据来源 | 计算方式 |
|---|---|---|
| CPU | `host_processor_info` | 比较相邻两次每核 tick，计算 user、system 和 idle 的差值 |
| 内存 | `host_statistics64` | 使用 `internal - purgeable + wired + compressed` 逼近活动监视器口径 |
| 内存压力 | `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE` | 由系统事件驱动，不额外轮询 |
| 网络速率 | `getifaddrs` | 按网络接口计算累计收发字节差，再除以时间间隔 |
| 磁盘容量 | `URL.resourceValues` | 读取总容量与 `volumeAvailableCapacityForImportantUsage` |
| 磁盘 I/O | IOKit `IOBlockStorageDriver` | 对累计读写字节做差值计算 |
| Top 进程 | libproc | 读取进程 CPU 时间和物理内存占用 |
| 网络环境 | `SCDynamicStore`、`getifaddrs` | 读取本机 IP、网关和 DNS |

### CPU：累计值必须做差

`host_processor_info` 返回的不是“当前 CPU 百分比”，而是各核心从启动至今累计的 tick。采样器要保存上一次结果，再按下面的方式计算当前周期占用：

```text
usage = 1 - Δidle / Δtotal
```

第一次采样只有基线，不能直接产生可信百分比。系统休眠恢复、计数器回绕等情况也要重新建立基线。

### 网络：按接口保存计数器

网络采样同样依赖累计字节差。Statly 按接口保存上次的接收和发送计数，并排除回环及常见虚拟接口，避免重复统计。同时，它还处理了 32 位计数器回绕与接口重置，异常大的单周期差值会被丢弃。

### 磁盘：快数据和慢数据分开采

磁盘读写速度需要按刷新周期更新，但总容量和可用空间不会每两秒发生有意义的变化。因此，容量读取使用 30 秒缓存，I/O 计数则按正常周期采集。将不同变化速度的数据分层，是减少常驻开销很有效的方法。

### 温度：最棘手，也最需要说明边界

macOS 没有面向普通应用开放统一的温度读取 API。Statly 通过 `dlsym` 动态解析 `IOHIDEventSystemClient` 相关私有符号，读取 CPU 晶粒或电池温度。

这里做了三层保护：

1. 任一私有符号或传感器不可用时，温度模块直接降级为不可用，不影响其他模块；
2. CPU 最多抽取 4 个传感器，电池最多抽取 2 个，避免遍历全部传感器；
3. 温度是慢变量，真实读取固定节流到 5 秒，其余周期直接返回缓存。

在开发机上，全量读取 16 个传感器约需 16.7 ms；抽取 4 个后约为 3.6 ms，与全量最高温的平均差约 0.01°C。这个取舍明显降低了成本，也足以满足菜单栏观察需求。

但私有 API 可能随系统版本改变，也不适合提交到 Mac App Store。因此，Statly 目前只通过 GitHub 直接分发。这个限制需要对用户明确说明，而不能只写“原生 API”。

## 状态栏渲染为什么使用 AppKit

每个启用模块对应一个 `NSStatusItem`。占用圆环、图标和文本先通过 AppKit 离屏绘制为 `NSImage`，再设置 `isTemplate = true`，由系统自动适配浅色和深色菜单栏。

状态栏是应用最常运行的界面，优化重点不是让单次绘制快一点，而是尽可能避免无意义的绘制和布局。

### 数值不变就不更新

`StatusRenderer` 会同时返回渲染内容和一个稳定的 `key`。CPU、内存和磁盘先量化到整数百分比，温度量化到整数摄氏度；只要菜单栏中最终显示的内容没变，就跳过图像和宽度更新。悬停提示单独比较，只有提示内容变化时才更新：

```swift
func update(_ output: RenderOutput) {
    if output.tooltip != lastTooltip {
        lastTooltip = output.tooltip
        item.button?.toolTip = output.tooltip
    }

    guard output.key != lastKey else { return }
    lastKey = output.key

    guard let button = item.button else { return }
    switch output.content {
    case .text(let text):
        button.image = nil
        button.title = text
    case .image(let image):
        button.title = ""
        button.image = image
    }
}
```

这里比较的是“最终渲染结果”，而不是原始浮点数。比如 CPU 从 10.21% 变化到 10.34%，菜单栏仍然显示 10%，就没有重画图像的必要。

### 固定宽度，避免整条菜单栏抖动

数字使用等宽字体，百分比、温度和网速也分别预留固定宽度。`NSStatusItem.length` 只有在实际宽度变化时才重新设置，因为一次宽度赋值可能触发整条菜单栏重新布局。

这一点看似只是视觉细节，实际同时改善了观感和性能：数字变化时，旁边的系统图标不会反复左右移动。

## SwiftUI 只在需要时出现

SwiftUI 很适合快速构建详情面板和设置表单，但 Statly 没有让复杂视图长期驻留在常驻路径中。

用户点击菜单栏模块时，应用才创建对应的 `NSHostingController`：

- CPU 或内存面板打开时，才启动 Top 进程采样；
- 网络面板打开时，才读取网络环境并按需查询公网 IP；
- 面板关闭后，停止这些任务并释放 `contentViewController`；
- 设置窗口关闭后，同样释放窗口控制器。

指标曲线使用一个容量为 120 的环形缓冲区，只保留有限数量的 `Double`，不会随着运行时间增长而持续占用内存。

这种设计可以概括为：**常驻路径只做必要的事，详情数据等用户真正打开时再算。**

## 轻量化不是一个开关

Statly 的资源占用并不是依赖某一个“神奇优化”，而是由一组小约束共同实现：

1. **合并唤醒**：所有模块共享一个 `DispatchSourceTimer`；
2. **按显示精度量化**：原始数值变化但显示内容不变时，不重画；
3. **避免重复布局**：状态栏数字定宽，宽度不变就不设置 `length`；
4. **冷热数据分层**：温度 5 秒读取一次，磁盘容量 30 秒读取一次；
5. **按需采集**：Top 进程和网络详情只在相应面板打开时运行；
6. **不可见时暂停**：屏幕休眠后停止采样，唤醒后重置差值基线；
7. **及时释放界面**：详情与设置关闭后销毁 SwiftUI Hosting Controller；
8. **控制依赖**：使用系统框架，项目不引入第三方库。

在 Apple Silicon 开发机、五个模块全部开启、2 秒采样间隔下，我得到的实测结果如下：

| 指标 | 实测结果 |
|---|---:|
| DMG 大小 | 约 0.71 MB |
| 面板关闭时常驻内存（RSS） | 约 32 MB |
| 平均 CPU 占用 | 约 0.42% |
| 每个采样周期的 Timer 唤醒 | 1 次 |
| 后台进程、系统权限、root | 0 |

这些结果会受芯片、系统版本、刷新间隔和启用模块影响，因此更适合作为当前版本的开发机基准，而不是对所有设备的绝对承诺。

项目早期曾把平均 CPU 目标定在 0.3% 以下，但对 `NSStatusItem` 做最小对照测试后发现，仅每两秒替换两个菜单栏图像，AppKit 本身就会产生约 0.21%～0.25% 的占用。最终我将 2 秒刷新下的目标修订为 0.5% 以内。

这也是开发轻量工具时很重要的一点：**性能目标必须以测量为依据。遇到框架的固定成本时，应先建立基线，再优化自己真正能控制的部分。**

## 设置持久化与开机自启

所有设置通过 `UserDefaults` 保存，包括启用模块、刷新间隔、显示样式、温度来源和公网 IP 开关。应用还维护配置版本，新模块加入后可以对旧配置做兼容迁移。

开机自启使用 macOS 13 提供的 `SMAppService.mainApp`，不需要额外放置登录项 helper。由于这项能力依赖完整的 App Bundle，通过 Swift Package Manager 直接运行裸二进制时会自动禁用，打包为 `.app` 后才可使用。

## 从开发到发布

项目同时保留了 Swift Package Manager 和 Xcode 工程两条路径：

- `Package.swift` 用于快速构建、运行和测试；
- `project.yml` 是 XcodeGen 的工程描述，也是 Xcode 工程的事实来源；
- Xcode Release 构建负责生成正式的 `.app`；
- 发布脚本负责测试、构建、签名、制作 DMG、计算 SHA-256，并可创建 GitHub Release。

本地开发命令很简单：

```bash
make run        # 使用 SPM 构建并运行
make xcodeproj  # 通过 XcodeGen 生成工程
make app        # Release 构建到 dist/Statly.app
make dmg        # 生成 DMG
```

发布脚本会根据本机环境选择签名策略：存在 Developer ID 证书和公证凭据时完成正式签名、公证与 staple；条件不足时退回 ad-hoc 签名。

## 隐私与当前限制

系统监控工具会接触设备信息，因此哪些数据留在本机、哪些数据会访问网络，应该说清楚。

- CPU、内存、温度、网速和磁盘数据都在本机采集；
- 公网 IP 仅在打开网络面板时向 `ipinfo.io` 查询，设置中可以关闭；
- 全球 IPv6、公网 IP 与归属地可以一键遮挡，便于录屏和共享屏幕；
- 手动“检查更新”会请求 GitHub Releases；
- Statly 不申请位置权限，因此不显示需要位置授权才能读取的 Wi-Fi SSID；
- 温度依赖私有接口，部分机型或未来系统版本可能无法读取；
- 当前版本未经 Apple 公证，首次启动需要在 Finder 中右键应用并选择“打开”。

## 下载与源码

- 项目源码：[github.com/imliusx/statly](https://github.com/imliusx/statly)
- 最新版本：[GitHub Releases](https://github.com/imliusx/statly/releases)
- 当前版本：`v0.4.1`
- 系统要求：macOS 13 或更高版本
- 开源协议：MIT

下载 DMG 后，将 Statly 拖入「应用程序」即可。当前版本未经 Apple 公证，首次启动也可以在终端移除隔离属性：

```bash
xattr -d com.apple.quarantine /Applications/Statly.app
```

卸载时删除应用和配置即可：

```bash
rm -rf /Applications/Statly.app
defaults delete com.statly.app
```

## 总结

对于常驻菜单栏应用而言，最重要的问题始终是：这段逻辑是否会一直运行？它每个周期消耗多少？用户没有打开界面时，它能不能暂停或延后？

目前 Statly 已完成五个核心模块、详情面板、设置持久化、开机自启、更新检查和 DMG 发布流程。后续计划继续补充风扇转速、GPU、阈值提醒与多语言支持，但前提仍然不变：新增功能不能破坏它作为轻量系统监控工具的基本定位。
