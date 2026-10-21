# Orbital Desk 行星轨道台

太阳系动态模拟：Three.js 3D 场景（可旋转/缩放/点击聚焦跟随） + 时间轴 + 行星信息卡。
最大特色：**双引擎交叉验证** — 同一时刻每颗行星的位置由两套互相独立的公开算法各算一遍（JPL 开普勒根数 vs Schlyter 简化算法），页面实时显示两者偏差，对不上就标红。

本仓库是一次 poteto-mode 多 agent 并行（swarm）+ 交叉验证（interrogate）实验：5 个 slice 由不同 Cursor Cloud Agent 并行开发，接口以 CONTRACT.md 为准，最后由独立验收 agent 做双引擎核对。

## 本地运行（重要：不能直接双击 index.html）

3D 渲染器 `js/render3d.js` 以 ES Module 方式加载，浏览器出于安全策略**禁止 file:// 页面加载模块脚本**；直接双击 `index.html` 会报「js/render3d.js 未加载或出错」（`window.OrbitRender` 缺失）。请用任意静态文件服务器打开，并保持联网（Three.js 从 jsDelivr CDN 加载；数据层与双引擎为零依赖本地脚本）：

```bash
# 在仓库根目录执行，任选其一
python3 -m http.server 8000
# 或
npx serve .
```

然后浏览器打开 <http://localhost:8000>。用完在终端按 Ctrl+C 停止服务器。
