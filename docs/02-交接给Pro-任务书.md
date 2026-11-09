# 交接给 Pro —— 实现任务书

> **读法**：本文是**唯一行动指令**。需要细节时查 `docs/01-需求规格书.md`（v0.3，完整契约，含数据模型与全部规则）。
> 两份冲突时：**硬约束以本文为准**，实现细节以 01 为准。

---

## 0. 你的任务（一句话）

在 **11 天内（今天 2026-11-09，硬截止 11-20）** 实现一个**可运行的**多智能体编排平台 Demo：

> **输入一句话需求（"做个能玩的打砖块"）→ 多个 Agent 协作生成单文件 HTML 小游戏 → 无头浏览器硬验证 → 失败回灌修复 → 交付可运行产物 + 核验报告。全过程可实时观察、可中断插入。**

这是"第五届未来杯创新大赛·赛题一（Agent 编排创新应用）"的参赛作品。**初赛评委看的是"五个模块齐不齐 + 能不能跑 + 材料齐不齐"，不是创意。** 所以优先级永远是：**跑通 > 好看 > 数量**。

---

## 1. 不可协商的硬约束（违反任一条，作品按不合格处理）

| # | 约束 | 为什么 |
|---|---|---|
| **H1** | 产物是**单文件 HTML/JS**，无后端、无 npm、无构建步骤 | 运行环境确定，错误可 100% 捕获回灌。允许任意产物＝11 天必死 |
| **H2** | 必须**≥3 个 Agent 角色**，且存在**对抗/验证关系**（不是串行搬砖） | 赛题原文："单 Agent 简单调用或仅封装大模型 API 的作品不符合要求" |
| **H3** | 必须有**硬验证沙箱**（Playwright 无头），失败**必须回灌修复**，循环上限 3 轮 | 这是本作品的支点，也是评分里"自我循环与验证机制" |
| **H4** | 必须支持**运行中中断 → 插入指令/改需求 → 断点续跑** | 差异化功能，对应赛题"人工介入节点"，也是视频主镜头 |
| **H5** | 必须有 **append-only 事件流** + SSE 实时推送，状态全部由它派生 | 一个设计同时满足"日志/快照/监控/轨迹/复现"五项要求 |
| **H6** | **控制面确定性**：节点跳转只由 WorkflowDef + 状态机决定，**禁止让 LLM 决定"下一步谁执行"** | 业界实测：交给模型临场判断会产生长尾、不可复现 |
| **H7** | **归约器禁用 LLM**：错误归一化、状态聚合、摘要压缩必须是确定性代码 | 归约器一旦用 LLM，噪声会被放大成错误，且不可复现 |
| **H8** | 每个节点输出**必须过 schema 校验**，失败记 `error` 事件，**不得静默透传** | 上游幻觉会被下游当事实使用 |

> 另有 4 条红线（R1~R4，含双层循环上限）见 `01-需求规格书.md` §5.1。

---

## 2. 明确不做（写进 README，防止后期手痒）

拖拽画布编辑器 · 节点/插件市场 · API 余额显示 · 本地模型接入 · Agent 自动发现（A2A）· 多模态 · 账号多租户 · 权限体系 · exe 打包（**只留接口**）· 事件驱动 Trigger 体系 · 存算分离 · 多信道接入

> 判据：**每个功能必须在 3~5 分钟演示视频里有一个镜头。** 分镜里排不上的，不做。

---

## 3. 系统形态

```
┌───────────── 前端 3 页（React/Vite，轻量）─────────────┐
│ ① 任务台   ② 运行看板（节点状态/事件流/中断按钮）  ③ 报告 │
└──────────────────────┬──────────────────────────────┘
                 REST + SSE
┌──────────────────────┴──────────────────────────────┐
│ 编排引擎 Core（纯逻辑，无 IO 副作用，必须可单测）        │
│  解析器 → 调度器(就绪队列/优先级/并发上限) → 执行器      │
│  → 验证门控 → Self-Loop 控制器 → 人工介入控制器          │
│  + Loop Watchdog（外部只读观察者，判"有无实质进展"）     │
└──────────────────────┬──────────────────────────────┘
┌──────────────────────┴──────────────────────────────┐
│ 可插拔能力层：LLM Gateway / 工具层 / 沙箱 / RAG / 打包器 │
└──────────────────────┬──────────────────────────────┘
              events.jsonl（唯一事实来源）+ runs/artifacts
```

**核心架构决定：事件溯源。** 不要另建"当前状态表"——状态是事件流的投影。

---

## 4. 数据结构契约（可直接抄）

### 4.1 AgentProfile

```jsonc
{ "id": "builder", "name": "生成者", "version": "1.0.0",
  "role_prompt": "…", "thinking_effort": "medium",
  "model": { "provider": "deepseek", "name": "deepseek-chat", "temperature": 0.3 },
  "capabilities": ["codegen"], "tools": [],
  "memory": { "scope": "run", "retrieve_top_k": 4 },
  "output_schema": "HtmlArtifact",
  "io": { "inputs": ["spec"], "outputs": ["artifact"] } }
```

### 4.2 WorkflowDef（DAG）

```jsonc
{ "id": "game-gen-v1",
  "nodes": [
    { "id":"n1","type":"agent","agent":"analyst","inputs":["req"],"outputs":["spec"] },
    { "id":"n2","type":"agent","agent":"builder","inputs":["spec"],"outputs":["artifact"] },
    { "id":"n3","type":"verify","verifier":"hard-sandbox","inputs":["artifact"],"outputs":["hard_report"] },
    { "id":"n4","type":"agent","agent":"critic","inputs":["artifact","spec"],"outputs":["soft_report"] },
    { "id":"n5","type":"agent","agent":"fixer","inputs":["spec","hard_report","artifact"],"outputs":["artifact"] },
    { "id":"n6","type":"packager","packager":"single-html","inputs":["artifact"],"outputs":["bundle"] },
    { "id":"n7","type":"human","note":"人工确认点" } ],
  "edges": [
    { "from":"n1","to":"n2" },
    { "from":"n2","to":"n3" },
    { "from":"n2","to":"n4","parallel":true },
    { "from":"n3","to":"n5","when":"fail","loop":{"max_iters":3,"to":"n3"} },
    { "from":"n3","to":"n6","when":"pass" },
    { "from":"n5","to":"n3" },
    { "from":"n6","to":"n7" } ],
  "limits": { "max_total_iters": 6, "timeout_sec": 900, "max_concurrency": 4 } }
```

必须支持的控制结构：顺序 / 并行分支（`parallel:true`）/ 条件（`when: always|pass|fail`）/ 循环（回边 + `loop.max_iters`）/ 子工作流（`type:"subflow"`）。

> 循环不特殊处理：**回边在运行时等于"该节点重新入队"**，靠 `loop` 计数 + 全局 `max_total_iters` 兜底。

### 4.3 Event（唯一事实来源）

```jsonc
{ "seq":1024,"ts":1762668000123,"run_id":"r_01J","node_id":"n2","agent_id":"builder",
  "type":"agent.thinking.delta","payload":{"text":"先画 16x16 网格…"} }
```

事件类型（枚举，不要随意扩展）：`run.started|finished|failed`、`node.entered|exited`、`agent.thinking.delta`、`agent.message`、`agent.tool.call|result`、`artifact.created`、`verify.hard.result`、`verify.soft.verdict`、`loop.iteration`、`run.interrupted|resumed`、`human.instruction`、`error`

### 4.4 RunRecord（可复现三件套）

```jsonc
{ "run_id":"r_01J","status":"running|paused|done|failed|aborted",
  "model_snapshot":[{"agent_id":"builder","model":"deepseek-chat","prompt_hash":"…"}],
  "seed":42,
  "artifacts":[{"id":"a1","path":"runs/r_01J/a1.html","sha256":"…"}],
  "metrics":{"wall_ms":94000,"tokens":51234,"rounds":3,"error_curve":[7,3,0]} }
```

---

## 5. 模块接口（TS，照此签名实现）

```ts
// 引擎：不直接调 LLM、不直接开浏览器，全部依赖注入（先用 fake 跑通全链路）
interface Engine {
  start(wf: WorkflowDef, task: TaskInput): RunId;
  interrupt(runId: RunId): void;
  resume(runId: RunId, instruction?: string): void;
  subscribe(runId: RunId, cb: (e: Event) => void): Unsubscribe;
}

// 沙箱：硬验证，不含 LLM
interface Sandbox {
  run(html: string, opts: { timeoutMs: number; interactionScript?: Action[] }): Promise<HardReport>;
}
type HardReport = {
  ok: boolean; load_ok: boolean;
  errors: { type:'console'|'pageerror'|'timeout'; message:string; stack?:string; line?:number }[];
  signals: { canvas_nonempty: boolean; dom_node_count: number };
  screenshots: string[]; load_ms: number;
};

// 判定规则（写死，不许含糊）
// ok = load_ok && errors.length === 0 && canvas_nonempty && interactionScript 未抛错

// 打包器：exe 的落点，初赛只实现 SingleHtmlPackager
interface Packager { pack(a: Artifact): Promise<Bundle>; }

// 循环观察者：只读事件流
interface LoopWatchdog {
  onEvent(e: Event): void;
  verdict(): { progress: boolean; reason: string; action: 'continue'|'escalate'|'abort' };
}
```

**调度器必须暴露 `pickAgent(node, candidates[])` 这一层**——实验要靠它对比"串行基线 vs 智能调度"。

---

## 6. 五个角色（职责与输出契约）

| 角色 | 输入 → 输出 | 关键要求 |
|---|---|---|
| **analyst 分析师** | requirement → `DecompositionSpec` | **必须输出 `assumptions[]` + `ambiguities[]`**；`blocking:true` 的歧义数 > 0 时**暂停转人工**（见 01 §5.8） |
| **builder 生成者** | tasks → `HtmlArtifact` | 只产出单文件 HTML，禁止外部资源引用（不能 `<script src="cdn…">`） |
| **hard-sandbox 硬校验器** | artifact → `HardReport` | **不是 LLM**，是 Playwright 脚本 |
| **critic 软裁判** | artifact + acceptance → `SoftReport` | 打 1-5 分 + 指出偏差条目；**不阻断流程**，只作为提示与人工介入的触发信号 |
| **fixer 修复者** | spec + 错误卡片 + 上一版 → 新版 | **只喂错误卡片（≤3 张）+ 需求摘要，不喂全文**；避免"防御性妥协"式假修复 |

### Prompt 的归属与存放（重要，违约会返工）

**存放**：所有 prompt 必须是**外部配置文件**（`configs/agents/*.json` 的 `role_prompt`，或独立 `.md` 文件），**禁止硬编码在 TS 里，必须支持热加载**。
→ 原因：赛题方会后续补一份 `04-Prompt套件.md`，硬编码会导致整块返工。

**归属分界**：

| 层 | 谁定 | 内容 |
|---|---|---|
| **契约层（不可自行发明）** | 赛题方给，以 `04` 为准 | 输出 schema 字段、**可判定性规则**（验收条件必须能被程序判定真假）、反例→正例清单、fixer 重试话术骨架 |
| **措辞层（你来迭代）** | 你定 | 具体句式、温度、few-shot 例子、思考强度映射 |

一句话：**凡是"机器能不能判"的归赛题方，凡是"模型听不听话"的归你。**

**在 `04` 到达之前**：先按 §6 表格把**结构**实现出来（输入输出、schema 校验、错误卡片格式、配置加载），`role_prompt` 用占位符即可，不要为写 prompt 停下 M2 的引擎工作。

### Self-Loop 规格（灵魂）

```
生成 → 硬验证 → ok 则出关
  → 失败则"错误归一化"：把 N 条报错压成 ≤3 张错误卡片
     （分类：语法/运行时/渲染/交互；附行号 + 截图路径）
  → 回灌 fixer：错误卡片 + 需求摘要 + 上一版产物摘要（不放全文，控 token）
  → 计数 +1

四条收敛判据（全部要落进代码）：
  1. 轮次上限 3
  2. 调用指纹去重：hash(node_id + 规范化(payload)) 重复或错误卡片集合相同 → 判"卡住"
  3. 错误数连续 2 轮不降 → 升级（拆更细 / 提 effort / 转人工）
  4. 超限 → 带缺陷交付：最佳版本 + 缺陷报告，绝不假装成功
```

---

## 7. 里程碑与验收（做完要能"演示"出来才算完）

| 里程碑 | 内容 | 验收动作 |
|---|---|---|
| **M1**（D1-2） | 事件流 + 引擎骨架 + Sandbox + 单 Agent「生成→验证」最小环 | `npm run demo:single` 打印 `ok=true`，落盘 `hard_report.json` + 截图 |
| **M2**（D3-5） | 多角色 + DAG(顺序/并行/条件) + 硬验证门控 + fixer 循环 | `npm run bench -- --set=smoke`（5 条）输出可运行率表，且至少 1 条能看到 `error_curve: [n, m, 0]` |
| **M3**（D6-7） | 异步中断/插入/续跑 + 三页前端 | **手动**：运行中点击中断 → 秒级 paused → 输入"加个计分板" → resume → 新版含计分板 |
| **M4**（D8） | Packager 接口 + 引用核验旁证跑通 1 例 | `npm run demo:citation` 跑通 1 例，且 `git diff --stat src/engine/` **为空**（证明换配置不改引擎） |
| **M5**（D9） | 批量实验 + 出图 | 产出 `results.csv` + 4 张图（收敛曲线/可运行率/耗时 p50-p95/成本） |
| **M6**（D10） | 方案书 5000 字 + PPT 10-15 页 | 文档齐 |
| **M7**（D11） | 视频 3-5 分钟 + 提交 | 成片可播 |

**降级开关（必须提前想好）**：若 **D5 结束 M2 仍未收敛**，立刻把需求样本 20 条 → 10 条，复杂度上限砍到"经典玩法复刻"两类。**保交付，不保野心。**

---

## 8. 技术选型建议

| 项 | 建议 | 说明 |
|---|---|---|
| 语言 | TypeScript + Node 20 | 与 Playwright 同生态，前端可复用类型 |
| 沙箱 | Playwright（chromium headless） | 捕获 `console`/`pageerror`，截图 |
| 存储 | SQLite 或 JSONL + 文件系统 | 事件用 JSONL 追加写最省事 |
| 前端 | React + Vite | 三页，不要上组件库 |
| 大模型 | DeepSeek / 通义 API，走统一 `LLMGateway` | 便于换模型、重试、计量 |
| 框架 | **不要用 LangChain/Dify 当骨架** | 赛题禁止套默认示例；自己写反而更快更可控 |

---

## 9. 工程提醒（踩坑预告）

1. **先用 fake LLM 跑通全链路**，再接真模型。否则你会在调 prompt 和调引擎之间反复横跳。
2. **沙箱三件事必须有**：加载超时 kill、`pageerror` 全捕获、产物 HTML 不放外部资源（<script src> 一律禁）。
3. **token 别失控**：fixer 只吃错误卡片 + 摘要，绝不喂整份 HTML。
4. **事件流是唯一真相**，不要另建状态表——否则中断续跑必错。
5. **中断要即时**：LLM 与沙箱调用改 `start` / `finish 事件回流` 两段式，在途结果标 `orphan` 丢弃。否则演示时点中断要愣半分钟。
6. **演示前预跑 3 条稳定需求**，别在评委面前现场生成 100% 成功率之外的题。

---

## 10. 交付物（= 赛题初赛四项，缺一不可）

1. **方案书 PDF ≥5000 字**，必须包含这 8 个章节（赛题原文要求，一个都不能少）：
   1. 选题背景与场景需求分析
   2. 平台总体架构设计与技术选型说明
   3. Agent 角色定义、工作流设计与编排逻辑详解
   4. 调度算法与自我循环机制说明
   5. 结果验证策略与反馈优化逻辑
   6. 核心代码模块说明与系统截图
   7. 测试用例、运行效果与性能评估
   8. 人工智能使用说明（各环节 LLM / RAG / MCP 的实际作用、贡献与局限）
2. **讲解 PPT 10~15 页**（要清晰展示架构、流程、创新点与演示效果）
3. **演示视频 3~5 分钟**（**必须完整展示**：平台界面 / Agent 编排过程 / 任务调度执行 / 结果验证 / 反馈循环的关键操作）
4. **可运行代码仓库**（Gitee/GitHub）+ README + 在线 Demo 或可复现步骤

> 第 8 章"人工智能使用说明"是最容易写空的一章，但它直接对应 25 分的评分项。写法：按环节列表，每个环节写"用了什么模型/工具、起了什么作用、**边界在哪（哪些判断没交给它）**"。

---

## 11. 三个"因为"（实现时别忘初心）

- **因为**评委要看到"多 Agent"，所以必须有对抗与验证，不是串行搬砖（H2）。
- **因为**评委要看到"自我循环有效"，所以必须有错误数下降的曲线（H3 + M2 的 `error_curve`）。
- **因为**评委要看到"AI 用得合理"，所以必须写清 LLM 干了什么、没干什么（硬验证不用 LLM 就是最好的回答）。
