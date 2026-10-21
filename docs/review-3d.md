# PR #7 独立复核

审查对象是 `feat: three.js 3D renderer (replaces 2D canvas)`。基线为 `origin/main`，复核分支为 `cursor/three-js-3d-renderer-7547`。

## 裁决

| 项目 | 裁决 | 结论 |
|---|---|---|
| 禁动资产 | 通过 | 三个受保护文件相对 `origin/main` 无差异。 |
| 坐标映射 | 通过 | 代码、Node 独立复算和页面运行值一致。 |
| import map 与 CDN | 通过 | Three.js 固定为 0.160.0，页面实际加载的 13 个模块均返回 HTTP 200。 |
| 点击后持续跟随 | 已修复 | UI 现在把选择结果传给 `setFollow`。空白拾取会传回 `null`。 |
| 行星环拾取 | 已修复 | 土星和天王星的拾取代理现在覆盖行星环外沿。 |
| 闭环拖拽误判 | 已修复 | 指针一旦移动超过 5 px，该手势不再触发点击。 |
| 浏览器全流程 | 通过 | 加载、播放、跳日期、选中行星和点击空白均通过。控制台无错误。 |
| 慢速模块恢复 | 未通过 | 模块超过 15 秒才完成时，UI 已移除 ready 监听器，渲染器不会挂载。 |
| `CONTRACT.md` 一致性 | 未通过 | PR 使用 ES module 和外部 Three.js CDN，违反“零依赖”和“经典 script”约束。当前授权不允许修改契约。 |

本轮指定交互已通过。慢速模块恢复和契约冲突仍未解决，因此整体裁决为未通过。

## 禁动资产

实际命令如下。

```sh
git diff --exit-code origin/main...HEAD -- data/planets.js js/kepler.js js/alt.js
git diff --numstat origin/main...HEAD -- data/planets.js js/kepler.js js/alt.js
```

两条命令均退出为 0，标准输出为空。`data/planets.js`、`js/kepler.js` 和 `js/alt.js` 相对 `origin/main` 没有修改。PR 描述中的 `git diff HEAD -- ...` 只能检查工作区，不能证明 PR 相对主分支未改这些文件。

## 坐标映射独立复算

`js/render3d.js` 的 `toScene` 先计算：

```text
r = hypot(x, y, z)
k = 12 * r^0.55 / r
```

随后返回 `(k*x, k*z, -k*y)`。这与声明的 `X = k*x`、`Y = k*z`、`Z = -k*y` 一致。场景半径为 `12*r^0.55`。

独立 Node 计算只加载 `data/planets.js` 和 `js/kepler.js`。输入是 `2026-10-21T12:00:00.000Z`，对应 `JD 2461335`。

| 行星 | 引擎坐标 `(x, y, z)` AU | `r` | `k` | 公式换算场景坐标 `(X, Y, Z)` | 页面运行值 |
|---|---|---:|---:|---|---|
| 地球 | `(0.881148765, 0.463255548, -0.000028181)` | `0.995504320` | `12.024356092` | `(10.595246526, -0.000338862, -5.570349671)` | `(10.595246526, -0.000338862, -5.570349671)` |
| 火星 | `(-0.148223652, 1.575193357, 0.036645769)` | `1.582576151` | `9.760389937` | `(-1.446720643, 0.357676993, -15.374501386)` | `(-1.446720643, 0.357676993, -15.374501386)` |

地球和火星的场景半径分别为 `11.970298433` 和 `15.446560339`。它们分别等于 `12*r^0.55`。作者给出的地球值 `(10.595247, -0.000339, -5.570350)` 与独立结果在六位小数上一致。

## import map 与模块路径

`index.html` 把裸模块名映射到以下固定版本。

```text
three          -> https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js
three/addons/  -> https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/
```

`js/render3d.js` 直接引用 `OrbitControls.js`、`EffectComposer.js`、`RenderPass.js`、`UnrealBloomPass.js`、`OutputPass.js` 和 `CSS2DRenderer.js`。无头 Chrome 实际请求了这些文件及其传递依赖。13 个请求均返回 HTTP 200：

```text
build/three.module.js
examples/jsm/controls/OrbitControls.js
examples/jsm/postprocessing/EffectComposer.js
examples/jsm/postprocessing/RenderPass.js
examples/jsm/postprocessing/UnrealBloomPass.js
examples/jsm/postprocessing/OutputPass.js
examples/jsm/renderers/CSS2DRenderer.js
examples/jsm/postprocessing/Pass.js
examples/jsm/postprocessing/MaskPass.js
examples/jsm/postprocessing/ShaderPass.js
examples/jsm/shaders/CopyShader.js
examples/jsm/shaders/LuminosityHighPassShader.js
examples/jsm/shaders/OutputShader.js
```

技术路径有效，但 CDN 和 ES module 仍与现有 `CONTRACT.md` 冲突。

## 跟随缺口和修复

修复前点击地球后的证据如下：

```text
followId = null
controls.target 到地球距离 = 0
```

镜头只完成一次飞近，没有进入跟随状态。根因有两处。`js/ui.js` 的选择回调没有调用 `setFollow`，且 `js/render3d.js` 在射线未命中时不触发选择回调。

修复保持一个可空行星 id 作为选择和跟随值：

1. 行星命中时，渲染器回传行星 id。
2. 空白命中时，渲染器回传 `null`。
3. UI 用同一个值调用 `render.setFollow(nextId)`。

修复后选择地球并以 1000 倍速播放 1.2 秒。JD 从 `2461335` 前进到 `2462451.7`，地球场景位置移动 `21.333869786` 个单位。此时：

```text
followId = earth
controls.target = (-1.489057820, 0.000802490, 12.010992349)
earth.position = (-1.489057820, 0.000802490, 12.010992349)
controls.target 到地球距离 = 0
controls.enablePan = false
```

点击空白后，`followId = null`、`controls.enablePan = true`，且行星卡隐藏。

## 额外修复

独立复核发现，原拾取代理固定为行星半径的 1.6 倍。土星环和天王星环的外沿分别为 2.27 倍和 2.02 倍，因此环面的大部分区域不可点击。修复前点击土星 2.0 倍半径处得到：

```text
followId = null
card = ""
```

拾取代理改为 `max(1.6, ring.outer)` 倍半径后，同一点得到：

```text
followId = saturn
card = "土星"
```

原点击判断只比较按下点和抬起点。指针先移动 30 px 再回到按下点时会误触发行星选择。现在 `pointermove` 一旦超过 5 px 就清除点击候选。无头 Chrome 的闭环拖拽结束后，`followId` 仍为 `null`，信息卡仍隐藏。

## 无头 Chrome 全流程

环境使用 Google Chrome headless 和 SwiftShader。页面由本地 HTTP 服务器提供。浏览器通过真实 jsDelivr CDN 加载 Three.js。

结果如下：

- 控制台 error 为 0。
- 控制台 warning 为 0。
- `pageerror` 为 0。
- 失败网络请求为 0。
- 行星对象为 8。
- `.planet-label` 为 8。
- 轨道对象为 8。
- 点击地球后信息卡显示“地球”。
- 播放和持续跟随通过。
- 点击空白后解除跟随。
- 日期输入跳到 `2027-06-15` 后，读数为 `2027-06-15 12:00 UTC · JD 2461572.000`。
- 点击土星环外部区域后，信息卡显示“土星”。
- 闭环拖拽不会触发行星选择。

语法和补丁检查也通过：

```sh
node --check js/ui.js
cp js/render3d.js /tmp/render3d-review.mjs
node --check /tmp/render3d-review.mjs
git diff --check
```

## 对抗审查综合裁决

两名审查者分别使用 Claude Opus 和 Grok，对 `origin/main...HEAD` 做了独立审查。

### 必须处理

- 两名审查者都指出 15 秒超时后的模块不会挂载。代码路径确认该问题存在。修复需要重构 `js/ui.js` 的启动流程，超出本轮只允许接线 `setFollow` 的 UI 权限，因此保留为未通过。
- 两名审查者都指出 `CONTRACT.md` 与实现冲突。该问题与本人的契约核对一致，且当前授权不允许修改契约。

### 已处理

- Grok 指出行星环不在拾取范围内。独立浏览器复现失败后，已扩大环状行星的拾取代理并复测通过。
- Claude Opus 指出闭环拖拽会误判为点击。代码路径和独立浏览器测试确认该问题，已增加 5 px 最大位移判定并复测通过。

### 暂不处理

- 固定 `minDistance = 0.8` 可让相机进入太阳和四颗巨行星。问题成立，但正确修复需要让最近距离随当前目标和行星环范围变化，不属于小改。
- 窄屏会裁掉海王星轨道。PR 描述已把该行为列为限制，本轮没有改变首页镜头构图。
- 小行星的拾取半径低于旧 2D 渲染器的 10 px 下限。移动端触摸没有实测，因此本轮不凭估算修改交互。
- 拆分接近 1000 行的模块、清理只写字段和调整抗锯齿属于维护建议，不是本轮功能缺陷。
- 天王星环倾角和地球自转轴方位涉及视觉模型取舍。本轮没有权威基准或截图差异证明，因此未改。

两名审查者在慢速模块恢复和契约冲突上达成一致。其余发现分散在相机、拾取和视觉模型。只有能够独立复现且可用小补丁修复的两项进入本轮代码。

## 未验证

本轮未验证真实 GPU 帧率、移动端真机、iOS Safari、触摸手势、人工拖拽和滚轮手感。也未做视觉基准对比、长时间内存测试、超过 15 秒的真实 CDN 延迟或 `file://` 启动。土星双引擎偏差属于已知引擎精度问题，本轮没有修改或重新裁决。
