# 多智能体编排调度平台

> 第五届「未来杯」创新大赛 · **赛题一：Agent 编排创新应用**
> 仓库：https://github.com/pppaio/futurecup-agent-orchestrator

**一句话定位**：输入一句话需求 → 多智能体协作生成单文件 HTML 小游戏 → Playwright 无头沙箱硬核验 → 失败回灌修复 → 评分返工循环 → 交付确定可运行的产物。全过程可实时观察、可秒级中断、可复现、可回退。

**核心主张：能不能跑，机器说了算。** 产物能否运行由无头浏览器沙箱判定（**非 LLM**）；LLM 只负责"生成"与"评价好不好"，不负责判定"能不能跑"。

---

## 一键启动（推荐评审使用）

**环境要求：Node.js 20 或更高版本**（未安装请到 https://nodejs.org/ 下载 LTS 版；双击 `start.bat` 会自动检测并给出提示）。

1. 下载本仓库并解压；
2. 双击根目录 **`start.bat`** → 自动检查环境、安装依赖、下载无头浏览器（仅首次）、启动服务并打开 http://localhost:3000。**前端首次会自动构建，无需手动操作**。

**不配置任何 API Key 时自动进入演示模式（Fake LLM）**，全链路零成本完整跑通；想接真实模型，在页面「接入 API」面板填任意 OpenAI 兼容服务的 Key 即可，或复制 `.env.example` 为 `.env`。

命令行方式与 3 分钟演示路径详见 **[安装与使用说明.md](安装与使用说明.md)**。

## 评审快速验证（命令行，约 3 分钟）

```bash
cd agent-platform
npm install && npx playwright install chromium

npm run demo:workflow   # 全链路：分析→生成(故意带错)→验证失败→回灌修复→再验证→打包
npm run demo:rollback   # 退步自动回滚 + 人工"返回第一版"
npm run demo:quality    # 评分返工循环收敛 [2,5]
```

20 个命令覆盖：`demo:single / workflow / stall / interrupt / gate / quality / confirm / scheduler / auto / rollback / real`、`bench`、`compare`、`summary`、`charts`、`replay`、`serve`、`export:doc / ppt`、`typecheck`。

## 核心机制（三层循环 + 可信交付）

| 机制 | 说明 |
|---|---|
| 硬验证 | 无头浏览器沙箱判定"能不能跑"（二值事实，非 LLM），失败错误卡片回灌 |
| 硬修复循环 | ≤3 轮，Watchdog 四道收敛闸门（轮次/指纹去重/错误不降/带缺陷交付） |
| 评分返工循环 | 软裁判未达目标分 → 版本留痕(bundle-vN) → 回分析师读代码 → 生成者增量改 → 再评分，轮次可配（默认 3，上限 9） |
| 人工返工循环 | 人工确认点：接受 / 带指令返工（回分析师），≤5 轮 |
| 退步保护 | 新版比历史最优差 → 自动回滚最优版；人工说"返回第一版"直接恢复该版本 |
| 智能调度 | 多候选按 `成功率/速度/成本` 打分择一，质量优先/省流双档 |
| 多供应商 | DeepSeek/通义千问等 OpenAI 兼容服务，界面直接接入，调用留痕可审计 |
| 自主编排 | 分析师拆开发计划 → 引擎逐步编排"生成→验证→修复"子流程 |

## 实验数据

- 20 条样本：首轮可运行率 **95%**，最终 **100%**；
- 三策略对比（串行单 Agent / 多 Agent 无核验 / 本方案）：**85% / 90% / 100%**——增益来自验证闭环而非 Agent 数量；
- 累计 303 次真实运行、109 个版本文件、54 次提交，全部可追溯。

## 目录结构

```
agent-platform/     可运行平台（TypeScript + Express + Playwright + React）
  src/engine/       编排引擎：调度器 / 验证门控 / 三层循环 / Watchdog / 秒级中断
  src/agents/       角色定义（分析师 / 生成者(+flash候选) / 硬校验器 / 软裁判 / 修复者）
  src/sandbox/      Playwright 硬验证沙箱
  src/gateway/      多供应商 LLM 网关（OpenAI 兼容，可运行时增删）
  src/bench/        数据集 + 批量实验 + 三策略对比
  web/              四页前端（任务台 / 运行看板 / 核验报告 / 历史记录）
docs/               方案书 PDF、讲解 PPT PDF、项目白皮书、安装说明等提交材料
presentation/       讲解 PPT 源文件
start.bat           一键启动脚本
```

## 赛题五模块对应实现

| 赛题要求 | 实现位置 |
|---|---|
| Agent 团队定义与管理 | `src/agents/`（AgentProfile：版本/能力标签/模型/思考强度/调度指标） |
| 工作流编排 | `src/workflows/`（JSON DAG：顺序 / 并行 / 条件 / 循环 / 子工作流） |
| 智能调度引擎 | `src/engine/engine.ts`（就绪队列 + 并发上限 + `pickAgent` 打分调度） |
| 工具与外部系统集成 | `src/gateway/`（多供应商网关）、`src/sandbox/`（沙箱工具） |
| 执行监控与结果验证 | `src/event/`（事件流 + SSE）、`src/sandbox/`（硬验证）、`src/engine/watchdog.ts` |
| 反馈与自我优化 | 三层循环（错误卡片回灌 / 评分返工 / 人工返工）+ 退步回滚 + 版本追溯 |

## 关键设计

- **事件溯源**：append-only 事件流是唯一事实来源，一份设计同时满足日志 / 快照 / 实时监控 / 轨迹统计 / 断点续跑。
- **两级判定（Fast / Slow Path）**：确定性代码判定"能不能跑"，LLM 只评价"好不好"且不阻断交付。
- **控制面确定性**：节点跳转、调度打分、质量门控、退步回滚全部由 WorkflowDef + 状态机 + 确定性函数决定，禁止 LLM 决策。
- **Loop Watchdog**：主系统之外的只读观察者，监控"有无实质进展"（调用指纹去重 + 错误数单调性），而非进程存活。

---

**赛事**：第五届"未来杯"创新大赛 · 赛题一 · 智云数科（北京）科技股份有限公司主办
