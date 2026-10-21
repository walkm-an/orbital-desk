> **v2 修订（2026-10-21，契约 owner）**：渲染层升级为 Three.js 3D。本修订与下文冲突处以本修订为准：
> - 渲染层（js/render3d.js）允许 ES module + CDN import map（three@0.160.0 锁定，jsDelivr），取代原 js/render.js；window.OrbitRender 接口（mount/setTime/setFollow/onSelect）不变。
> - 数据层与双引擎（data/planets.js、js/kepler.js、js/alt.js）维持零依赖、经典 script 不变，仍是禁动资产。
> - 页面为可旋转/缩放的 3D 场景；原"俯视"表述作废。index.html 其余结构与偏差面板契约不变。

# 接口契约 CONTRACT（所有 slice 必须严格遵守，冲突以本文件为准）

## 总约束
- 纯静态站：零依赖、零构建、零图片。经典 <script> 标签按序加载（非 module）。
- 加载顺序：data/planets.js → js/kepler.js → js/alt.js → js/render.js → js/ui.js，样式 style.css。
- 每个 slice 只能新增/修改自己负责的文件，禁止动别人的文件。index.html、style.css、js/ui.js 只归 UI slice。
- 坐标系：日心黄道坐标，单位 AU；x/y 为黄道面投影（俯视图），lon 为黄道经度（度，0-360）。
- 时间：一切时间函数用儒略日 JD（number）。采样核对日期（UTC 正午）：2026-01-01、2026-10-21、2027-06-15、2030-01-01。

## 文件与全局接口
1. data/planets.js → window.PLANETS
   数组，8 大行星，字段：{id（英文小写）, name（中文）, color（十六进制）, radiusKm, massKg（可为科学计数法数值）, dayHours（自转周期小时，可负表示逆行）, moons,
   elements: {a, e, I, L, longPeri, longNode, aRate, eRate, IRate, LRate, longPeriRate, longNodeRate}}
   根数必须采用 JPL 公开的 Keplerian Elements（Table 1：J2000 历元值 + 每儒略世纪变化率），a 单位 AU、角度单位度。文件头注释写明数据来源名称与表名。
2. js/kepler.js → window.KeplerEngine = { toJD(date), positionAt(id, jd) }
   positionAt 返回 {x, y, z, lon}。用 PLANETS 的根数：由 JD 算 T（自 J2000 起儒略世纪数）→ 各根数线性外推 → 平近点角 M = L - longPeri → 牛顿迭代解开普勒方程 E（精度 1e-9）→ 真近点角与日距 → 黄道坐标。找不到 id 时抛 Error。
3. js/alt.js → window.AltEngine = { positionAt(id, jd) }
   返回同上结构。算法采用 Paul Schlyter《How to compute planetary positions》的简化算法，根数内置于本文件（与 JPL 根数互相独立），文件头注释写明来源。精度目标：内行星约角分量级。
4. js/render.js → window.OrbitRender = { mount(canvas, options), setTime(jd), setFollow(idOrNull), onSelect(callback) }
   Canvas 俯视图：太阳在中心、8 条轨道椭线、行星圆点+中文名标签；位置一律调 KeplerEngine.positionAt 取数（不许自己算轨道）。支持滚轮缩放、拖拽平移、点击选中行星（触发 onSelect 回调传 id）。处理 devicePixelRatio。requestAnimationFrame 循环，时间由 ui.js 通过 setTime 推进（render 不自己计时）。
5. js/ui.js + index.html + style.css（UI slice）
   深色天文主题。布局：左/上为画布区，侧栏含：① 时间控制（播放/暂停按钮、倍速选择 0.1/1/10/100/1000 倍、日期输入、当前模拟日期显示，播放时按倍速推进 JD 并调 OrbitRender.setTime）；② 行星信息卡（点击行星显示：中文名、半径、自转、卫星数、当前日距 AU、双引擎经度）；③ 双轨偏差面板（表格列出 8 行星：A 引擎经度、B 引擎经度、经度差、位置距离差 AU；阈值：水金地火木土 >0.02 AU 标红，天王/海王 >0.1 AU 标红；偏差随时间推进实时刷新，节流到每 250ms 一次）。

## 验证要求（每个 slice 的 PR 描述必须包含）
- 对自己 JS 文件的 node --check 结果（或抽出的等价语法检查）。
- 与本 slice 相关的 sanity 输出（如引擎 slice 给出采样日期下地球/火星的日距与经度，量级必须合理：地球约 1 AU、火星约 1.52 AU）。
- 未验证项如实声明，不许假装在浏览器里验过。
