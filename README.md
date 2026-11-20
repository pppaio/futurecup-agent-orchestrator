# 多智能体编排调度平台

> 第五届「未来杯」创新大赛 · **赛题一：Agent 编排创新应用**

**一句话定位**：输入一句话需求 → 多智能体协作生成单文件 HTML 小游戏 → Playwright 无头沙箱硬核验 → 失败回灌修复（≤3 轮）→ 交付确定可运行的产物。全过程可实时观察、可中断插入、可复现。

**核心主张：能不能跑，机器说了算。** 产物能否运行由无头浏览器沙箱判定（**非 LLM**）；LLM 只负责"生成"与"评价好不好"，不负责判定"能不能跑"。

---

## 评审快速验证（3 条命令，约 3 分钟）

```bash
cd agent-platform
npm install && npx playwright install chromium

npm run demo:single     # 最小闭环：生成 → 硬验证，打印 ok=true
npm run demo:workflow   # 全链路：分析 → 生成 → 验证失败 → 回灌修复 → 再验证 → 打包
```

**不配置任何 API Key 时自动走 Fake LLM，零成本可完整复现全部流程。** 配置 `.env`（见 `.env.example`）后可切换真实模型与任意 OpenAI 兼容供应商。

更多命令（16 个）：`npm run demo:stall`（卡死检测）、`demo:interrupt`（中断续跑）、`demo:gate`（歧义停机）、`demo:scheduler`（调度对比）、`demo:rollback`（版本回退）、`bench` / `compare`（批量实验）、`replay`（事件流重放）等。

---

## 目录结构

```
agent-platform/     可运行平台（TypeScript + Express + Playwright + React）
  src/engine/       编排引擎：调度器 / 验证门控 / Self-Loop / Watchdog
  src/agents/       5 个角色定义（分析师 / 生成者 / 硬校验器 / 软裁判 / 修复者）
  src/sandbox/      Playwright 硬验证沙箱
  src/gateway/      LLM 网关（多供应商，OpenAI 兼容）
  src/bench/        20 条样本数据集 + 批量实验
  src/reducer.ts    确定性错误归一化（禁用 LLM）
  web/              三页前端（任务台 / 运行看板 / 核验报告）
docs/               方案书、需求规格、实验记录、答辩 QA 等 14 份文档
presentation/       讲解 PPT 源文件
```

## 文档导航

| 文档 | 内容 |
|---|---|
| `docs/方案书.pdf` | 项目白皮书（完整方案） |
| `docs/讲解PPT.pdf` | 项目介绍 PPT |
| `docs/01-需求规格书.md` | 架构与接口契约（数据模型 / 红线 / Self-Loop 规格） |
| `docs/09-答辩QA.md` | 预设答辩问题与回答口径 |
| `docs/04-方案书-draft.md` | 方案书源文件 |

## 赛题五模块对应实现

| 赛题要求 | 实现位置 |
|---|---|
| Agent 团队定义与管理 | `src/agents/`（AgentProfile，含版本/能力标签/模型/思考强度） |
| 工作流编排 | `src/workflows/`（JSON DAG：顺序 / 并行 / 条件 / 循环 / 子工作流） |
| 智能调度引擎 | `src/engine/engine.ts`（就绪队列 + 并发上限 + `pickAgent` 能力匹配打分） |
| 工具与外部系统集成 | `src/gateway/`、`src/sandbox/`（LLM 网关 + 沙箱工具） |
| 执行监控与结果验证 | `src/event/`（事件流 + SSE）、`src/sandbox/`（硬验证）、`src/engine/watchdog.ts` |
| 反馈与自我优化 | `src/reducer.ts` + Self-Loop 控制器（错误卡片回灌，≤3 轮，超限带缺陷交付） |

## 关键设计

- **事件溯源**：append-only 事件流是唯一事实来源，一份设计同时满足日志 / 快照 / 实时监控 / 轨迹统计 / 断点续跑。
- **两级判定（Fast / Slow Path）**：确定性代码判定"能不能跑"，LLM 只评价"好不好"且不阻断交付。
- **控制面确定性**：节点跳转只由 WorkflowDef + 状态机决定，禁止 LLM 决定"下一步谁执行"。
- **Loop Watchdog**：主系统之外的只读观察者，监控"有无实质进展"（调用指纹去重 + 错误数单调性），而非进程存活。

---

**赛事**：第五届"未来杯"创新大赛 · 赛题一 · 智云数科（北京）科技股份有限公司主办
