# Orbital Desk 行星轨道台

太阳系动态模拟：俯视轨道动画 + 时间轴 + 行星信息卡。
最大特色：**双引擎交叉验证** — 同一时刻每颗行星的位置由两套互相独立的公开算法各算一遍（JPL 开普勒根数 vs Schlyter 简化算法），页面实时显示两者偏差，对不上就标红。

本仓库是一次 poteto-mode 多 agent 并行（swarm）+ 交叉验证（interrogate）实验：5 个 slice 由不同 Cursor Cloud Agent 并行开发，接口以 CONTRACT.md 为准，最后由独立验收 agent 做双引擎核对。
