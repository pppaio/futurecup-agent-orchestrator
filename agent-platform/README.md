# Agent 编排调度平台

> 第五届「未来杯」创新大赛 · 赛题一（Agent 编排创新应用）

一个**配置驱动的多智能体编排引擎**：输入一句话需求，经「拆解 → 生成 → 无头浏览器硬核验 → 失败回灌修复」的闭环，交付一个确定可运行的软件产物，全过程可观测、可中断、可复现。

**核心主张：能不能跑，机器说了算。** LLM 只负责「生成」和「评价好不好用」，不负责「判定能不能跑」。

## 快速开始

```bash
# 环境：Node 20+（已在 v24 验证）、npm
npm install
npx playwright install chromium   # 首次需下载无头浏览器

# 配置模型（可选，不配则跑 fake LLM）
cp .env.example .env              # 填入 DEEPSEEK_API_KEY=sk-...

# 接入其它 API 供应商（OpenAI 兼容口径，如通义千问/智谱/月之暗面）
# .env 追加：
#   PROVIDER_QWEN_NAME=通义千问
#   PROVIDER_QWEN_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
#   PROVIDER_QWEN_KEY=sk-xxx
#   PROVIDER_QWEN_MODELS=qwen-max,qwen-plus
# 配置后，前端「角色配置」面板里每个角色都可以选择任意供应商的模型。
```

## 运行

```bash
npm run serve            # 启动完整应用（前端+后端，单端口 :3000）
npm run demo:single      # M1 最小环：生成 → 硬验证
npm run demo:workflow    # M2 全链路：分析→生成(坏)→验证失败→回灌修复→再验证→打包
npm run demo:stall       # Loop Watchdog 抓"假进展"并升级中止
npm run demo:interrupt   # M3 运行中中断 → 插入指令 → 断点续跑
npm run demo:gate        # §5.8 歧义停机：阻塞性歧义 → 自动暂停 → 人工回答 → 续跑
npm run demo:real        # 真实 v4-pro 单次全链路
npm run bench            # 20 样本批量实验（输出 runs/results.csv）
npm run compare          # 三策略对比 S1/S2/S3（输出 runs/results-compare.csv，COMPARE_LIMIT 控子集）
npm run summary          # 汇总实验指标（可运行率/轮次/p50-p95/成本）
npm run charts           # 生成 4 张实验图表（runs/charts/*.png）
npm run replay -- <runId>  # 事件流重放（可复现证据）
npm run export:doc       # 导出方案书 PDF（docs/方案书.pdf）
npm run export:ppt       # 导出讲解 PPT PDF（docs/讲解PPT.pdf）
npm run typecheck        # TS 类型检查
```

## 架构

```
前端(三页) ── REST/SSE ──► 编排引擎 Core（纯逻辑，可单测）
                            解析器 → 调度器 → 执行器 → 验证门控 → Self-Loop 控制器 → 人工介入控制器
                            + Loop Watchdog（外部只读观察者）
                          ──► 可插拔能力层：LLM Gateway / 工具层 / 沙箱 / RAG / 打包器
                          ──► events.jsonl（唯一事实来源）+ runs/artifacts
```

## 设计要点

- **事件溯源**：append-only 事件流是唯一事实来源，一份设计同时满足日志/快照/监控/轨迹/复现五项。
- **控制面确定性**：节点跳转只由 WorkflowDef + 状态机决定，禁止 LLM 决定"下一步谁执行"；错误归约/摘要用确定性代码，禁用 LLM。
- **两级判定**（Fast/Slow Path）：硬验证（Playwright 沙箱，非 LLM）判定"能不能跑"；软裁判（LLM）只评价"好不好"，不阻断交付。
- **Self-Loop 四道闸**：轮次上限 3 + 错误数连续两轮不降即升级 + 错误卡片重复即升级 + 修复者输出指纹去重即中止，超限带缺陷交付。
- **可中断可复现**：运行中可中断、插入指令、断点续跑；每次运行落盘 `run.json`（模型快照/错误曲线/耗时）+ `events.jsonl`（事件流）+ `hard_report.json`（硬验证）+ `bundle.html`（产物，sha256 记入事件流）；`replay` 命令可完整重放。

## 目录结构

```
src/
  engine/     编排引擎 + Loop Watchdog
  agents/     五角色定义（analyst/builder/critic/fixer + 硬验证沙箱）
  sandbox/    Playwright 硬验证
  gateway/    LLM 网关（Fake / DeepSeek）
  workflows/  工作流 DAG 定义
  bench/      20 样本数据集 + bench/对比 runner
  reducer.ts  确定性错误归一化
  packager/   打包器（单文件 HTML，exe 留接口）
```

详见 `docs/`（需求规格书、交接任务书、方案书草稿）。
