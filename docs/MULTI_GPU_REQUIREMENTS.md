# RezMon 多 GPU 支持需求文档

- **文档类型**：功能需求 / 技术交接文档
- **项目**：RezMon GNOME Shell 资源监控插件
- **目标版本**：GNOME Shell 45–51
- **状态**：待实现
- **相关代码**：`src/metrics/gpu.js`、`src/indicator.js`、`src/prefs.js`、`src/schemas/org.gnome.shell.extensions.rezmon.gschema.xml`

## 1. 背景

当前 RezMon 的 GPU 逻辑虽然会尝试检测 NVIDIA、AMD 和 Intel GPU，但最终只返回一个 GPU 对象。设置界面也只有以下三种选择：

- Auto（优先独立 GPU）
- Dedicated GPU
- Integrated GPU

因此，当系统存在两张或更多 GPU 时，插件只能显示其中一张，无法让用户选择具体的 GPU，也无法循环展示全部 GPU。

本需求将 GPU 监控模型改为多 GPU 模型：检测系统中的全部 GPU，生成稳定的 GPU 编号 `GPU 0` 至 `GPU N`，在设置界面列出检测到的设备供用户选择，并使用同一组显示配置作用于所有 GPU。

## 2. 目标

实现以下能力：

1. 自动检测系统中的全部 GPU，数量由运行时检测结果决定。
2. 为每张 GPU 分配稳定的显示编号：`GPU 0`、`GPU 1`、……、`GPU N`。
3. 在设置界面动态列出已检测到的 GPU。
4. 用户可选择：
   - 显示全部 GPU；
   - 只显示某一张 GPU；
   - 选择多张 GPU进行显示。
5. 所有 GPU 共用一套显示配置：
   - 使用率；
   - 时钟频率；
   - 温度；
   - VRAM 已使用；
   - VRAM 剩余；
   - VRAM 百分比。
6. 顶栏和下拉面板按顺序循环显示选中的 GPU。
7. GPU 数量变化、设备休眠或设备暂时不可读时，插件不崩溃。
8. 保持现有单 GPU 配置的兼容性。

## 3. 非目标

本次不实现以下内容：

- 不为每张 GPU 增加独立的显示字段配置。
- 不为每张 GPU 设置独立的告警阈值。
- 不实现 GPU 之间的合并统计或平均统计。
- 不改变 CPU、RAM、磁盘和网络监控逻辑。
- 不要求用户手工填写 PCI 地址、DRM 路径或设备名称。
- 不要求所有 GPU 使用相同的底层查询方式。NVIDIA、AMD、Intel 可继续使用各自的查询逻辑。

## 4. 用户需求

### 4.1 GPU 检测

插件启动或首次刷新 GPU 指标时，应扫描系统 GPU，并生成 GPU 列表。

检测结果至少应包含：

```js
{
    id: "gpu-0",
    index: 0,
    name: "NVIDIA GeForce ...",
    vendor: "nvidia",
    driver: "nvidia",
    devicePath: "/sys/class/drm/card1/device",
    drmCard: "card1"
}
```

字段说明：

| 字段 | 要求 |
|---|---|
| `id` | 稳定的内部标识，用于保存设置；优先使用设备唯一标识，不能仅依赖本次扫描顺序 |
| `index` | 当前显示编号，从 0 开始连续编号 |
| `name` | 面向用户显示的设备名称；无法获取时使用厂商名或 `Unknown GPU` |
| `vendor` | `nvidia`、`amd`、`intel` 或 `unknown` |
| `driver` | 实际驱动名称 |
| `devicePath` | 可选，底层查询指标使用 |
| `drmCard` | 可选，用于定位 DRM 设备 |

### 4.2 GPU 编号

设置界面和监控输出使用以下编号规则：

```text
GPU 0
GPU 1
GPU 2
...
GPU N
```

`N` 由检测到的 GPU 数量决定。若检测到 2 张 GPU，应显示 `GPU 0` 和 `GPU 1`。

编号排序要求：

1. 优先按 DRM/PCI 设备顺序排序。
2. 同一设备在刷新时应保持相同的 `id`。
3. 设备名称变化不能导致已保存选择失效。
4. 如果设备被移除，设置中应自动忽略失效 ID，而不是报错。

### 4.3 设置界面

GPU 设置页面新增“显示 GPU”选择器，支持多选。

建议界面结构：

```text
GPU Settings

显示 GPU
[x] 全部 GPU
[x] GPU 0 - Intel Graphics
[x] GPU 1 - NVIDIA GeForce RTX ...

显示内容
[x] Usage %
[ ] Clock
[x] Temperature
[x] VRAM Used
[ ] VRAM Free
[ ] VRAM Percent
```

行为要求：

- “全部 GPU”是快捷选择项。
- 选择“全部 GPU”时，所有检测到的 GPU 都参与显示。
- 取消“全部 GPU”后，可逐张选择 GPU。
- 逐张 GPU 选择项由检测结果动态生成。
- 没有检测到 GPU 时显示说明文本，不应显示空白或导致设置页崩溃。
- 选择变化后立即保存到 GSettings，并在下一次指标刷新时生效。
- 原有 `gpu-device` 配置需要兼容迁移：
  - `auto`：迁移为全部 GPU，或按旧逻辑选择首个独立 GPU；推荐迁移为全部 GPU；
  - `dedicated`：迁移为所有检测到的独立 GPU；
  - `integrated`：迁移为所有检测到的集成 GPU。

推荐新增设置键：

```xml
<key name="gpu-selected" type="as">
  <default>['all']</default>
</key>
```

其中：

- `['all']` 表示显示全部 GPU；
- `['gpu-0']` 表示只显示 GPU 0；
- `['gpu-0', 'gpu-1']` 表示显示 GPU 0 和 GPU 1。

旧的 `gpu-device` 可暂时保留用于兼容，但新逻辑应以 `gpu-selected` 为准。

### 4.4 顶栏显示

顶栏显示所有已选择 GPU，顺序与设置列表一致。例如：

```text
GPU0(12% | 45°C | 1.2G)  GPU1(3% | 42°C | 0.4G)
```

或沿用现有前缀和分隔符：

```text
🎮(GPU0 12% | 45°C | 1.2G) 🎮(GPU1 3% | 42°C | 0.4G)
```

要求：

- 每张 GPU 必须显示可区分的编号或名称。
- 使用同一份 `gpu-*` 显示开关处理所有 GPU。
- 单张 GPU 时尽量保持现有显示效果，避免无意义的 `GPU0` 视觉变化；但名称或编号必须可在下拉面板中识别。
- 多张 GPU 时不得覆盖前一张 GPU 的数据。
- 某张 GPU 查询失败时，只显示该 GPU 的 `Unavailable` 或 `N/A`，其他 GPU 仍正常显示。
- 仍然支持None(Compact)，即不显示编号，直接展示指标，由Brackets分割。

### 4.5 下拉面板显示

下拉面板应按 GPU 顺序显示独立区块：

```text
GPU 0  Intel Graphics
[████░░░░░░░░] 32%  |  48°C  |  Shared: 2.0G

GPU 1  NVIDIA GeForce RTX ...
[█░░░░░░░░░░░░] 8%   |  41°C  |  VRAM: 0.8G
```

要求：

- 每张 GPU 使用独立标题。
- 每张 GPU 的使用率、温度和显存数据来自该 GPU 自身。
- GPU 处于 runtime suspended 时显示 `Sleep`，不能导致整个面板停止刷新。
- 不同 GPU 的字段缺失时允许显示部分字段。

## 5. 技术设计要求

### 5.1 数据结构

`updateGPU()` 应从返回单个对象改为返回数组：

```js
[
    {
        id: "gpu-0",
        index: 0,
        name: "Intel Graphics",
        vendor: "intel",
        sleeping: false,
        usage: 32,
        clock: 1200,
        temp: 48,
        vramUsed: 2.0,
        vramFree: 6.0,
        vramPercent: 25
    },
    {
        id: "gpu-1",
        index: 1,
        name: "NVIDIA GeForce RTX ...",
        vendor: "nvidia",
        sleeping: false,
        usage: 8,
        clock: 900,
        temp: 41,
        vramUsed: 0.8,
        vramFree: 7.2,
        vramPercent: 10
    }
]
```

### 5.2 厂商查询

#### NVIDIA

`nvidia-smi` 必须使用多 GPU 输出，并逐行解析：

```bash
nvidia-smi --query-gpu=index,name,utilization.gpu,temperature.gpu,clocks.current.graphics,memory.used,memory.total --format=csv,noheader,nounits
```

禁止只读取第一行。每一行对应一个 NVIDIA GPU，并通过 `index` 与检测结果绑定。

#### AMD

每个 AMD DRM 设备独立读取：

- `gpu_busy_percent`
- `current_gfxclk`
- `mem_info_vram_used`
- `mem_info_vram_total`
- 对应 hwmon 温度

#### Intel

每个 Intel DRM 设备独立读取：

- `gt_act_freq_mhz` 或 `gt_cur_freq_mhz`
- `rc6_residency_ms`
- 对应 hwmon 温度
- `lmem_total_bytes` 和 `lmem_avail_bytes`

### 5.3 指标刷新

- 一次刷新应并行查询所有选中的 GPU。
- 未选中的 GPU可以不查询，以减少开销；设置页打开时可刷新完整检测列表。
- 任一 GPU 查询失败不得阻止其他 GPU返回。
- GPU 检测列表建议使用缓存，但应支持重新扫描：
  - 插件启用时扫描一次；
  - 设置页打开时扫描一次；
  - 检测到设备列表变化时重新扫描。

### 5.4 设置与运行时同步

`indicator.js` 需要监听 `gpu-selected` 变化。变化后：

1. 更新内存中的选择列表；
2. 立即触发一次 GPU 指标刷新；
3. 重新生成顶栏文本；
4. 如果下拉菜单打开，重新生成 GPU 区块。

### 5.5 向后兼容

- 旧用户升级后不应丢失现有 GPU 显示开关。
- 旧的 `gpu-usage`、`gpu-clock`、`gpu-temp`、`gpu-vram-*` 设置继续有效。
- 旧的 `gpu-device` 只作为首次迁移依据，不应继续覆盖用户之后对 `gpu-selected` 的选择。
- `updateGPU()` 返回数组后，所有调用方必须同步处理数组，禁止继续按单对象字段访问。

## 6. 异常与边界条件

| 场景 | 期望行为 |
|---|---|
| 没有检测到 GPU | 设置页显示“未检测到 GPU”，顶栏不显示 GPU 区块 |
| 只有一张 GPU | 正常显示，行为接近当前版本 |
| 两张不同厂商 GPU | 两张均可列出、选择和显示 |
| 两张 NVIDIA GPU | `nvidia-smi` 多行结果分别显示 |
| GPU runtime suspended | 该 GPU 显示 `Sleep`，其他 GPU继续刷新 |
| GPU 被移除 | 自动从有效显示列表中移除，不崩溃 |
| GPU 驱动不支持某项指标 | 该字段显示 `N/A` 或隐藏，其余字段正常 |
| GPU 名称包含特殊字符 | 输出到 Pango markup 前必须转义 |
| 设置中保存了不存在的 GPU ID | 忽略失效 ID，并保留有效 ID |
| GPU 顺序发生变化 | 通过稳定 ID恢复选择，不应误选其他设备 |
| `nvidia-smi` 不存在 | NVIDIA GPU显示为不可用，不影响 AMD/Intel |

## 7. 验收标准

### 功能验收

- [ ] 在一台包含两张 GPU 的机器上，设置界面能显示 `GPU 0` 和 `GPU 1`。
- [ ] 用户可以选择全部 GPU。
- [ ] 用户可以只选择 GPU 0。
- [ ] 用户可以只选择 GPU 1。
- [ ] 用户可以同时选择 GPU 0 和 GPU 1。
- [ ] 选择结果重启 GNOME Shell 后仍然保留。
- [ ] 两张 GPU 在顶栏均有独立输出。
- [ ] 两张 GPU 在下拉面板均有独立区块。
- [ ] 所有 GPU 共用同一组显示内容开关。
- [ ] 关闭“温度”后，所有 GPU 的温度都隐藏。
- [ ] 开启“VRAM Used”后，所有支持该指标的 GPU 都显示显存使用量。
- [ ] 一张 GPU 查询失败时，另一张仍能显示。

### 兼容性验收

- [ ] GNOME Shell 45–51 均能加载扩展。
- [ ] 单 GPU 场景保持可用。
- [ ] 旧版本配置可正常迁移。
- [ ] 不出现 `ImportError`、`TypeError` 或设置页崩溃。

### 构建与安装验收

```bash
make build
make zip
make install
```

安装包必须包含：

```text
extension.js
indicator.js
prefs.js
metrics/*.js
utils/*.js
metadata.json
schemas/*
```

## 8. 建议实现顺序

1. 将 GPU 检测结果抽象为数组，并为每张设备建立稳定 ID。
2. 修改 NVIDIA 查询，支持多行 `nvidia-smi` 输出。
3. 修改 AMD 和 Intel 查询，使每个 DRM 设备生成一个独立指标对象。
4. 将 `updateGPU()` 改为返回 GPU 数组。
5. 修改 `indicator.js` 的顶栏格式化逻辑。
6. 修改下拉面板 GPU 展示逻辑。
7. 增加 `gpu-selected` GSettings 键和迁移逻辑。
8. 修改 `prefs.js`，动态生成 GPU 多选项。
9. 添加配置变化监听和重新扫描逻辑。
10. 在单 GPU、双 GPU、休眠 GPU 和部分指标缺失场景下测试。
11. 重新打包并安装到本机 GNOME 扩展目录。

## 9. 测试命令

检测系统 GPU：

```bash
lspci | grep -Ei 'vga|3d|display'
ls -l /sys/class/drm/card*/device/driver
```

检测 NVIDIA 多卡：

```bash
nvidia-smi --query-gpu=index,name,utilization.gpu,temperature.gpu,clocks.current.graphics,memory.used,memory.total --format=csv
```

构建和安装：

```bash
make build
make zip
make install
```

查看扩展状态：

```bash
gnome-extensions info rezmon@azz.lol
journalctl --user -b --no-pager | grep -i -E 'rezmon|ImportError|TypeError|SyntaxError'
```

## 10. 交接说明

实现时应优先保证“数据模型从单对象改为数组”这一核心变化的一致性。任何继续使用以下形式的代码都需要检查：

```js
gpu.usage
gpu.temp
gpu.name
```

这些访问方式必须改为遍历：

```js
for (const gpu of gpus) {
    gpu.usage;
    gpu.temp;
    gpu.name;
}
```

最终应确保：

- 检测层负责发现所有 GPU 和采集指标；
- 设置层负责选择显示哪些 GPU；
- 显示层负责按顺序循环渲染 GPU；
- 显示字段配置只有一份，并作用于所有选中的 GPU；
- 任意单张 GPU 异常不会影响其他 GPU。
