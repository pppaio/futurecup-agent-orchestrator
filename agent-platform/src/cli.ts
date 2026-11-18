import { mkdirSync } from 'node:fs';
import { EventStore } from './event/store.js';
import { FakeLLM, DeepSeekLLM } from './gateway/llm.js';
import type { LLMGateway } from './gateway/llm.js';
import { runBench, writeCsv } from './bench/runner.js';
import { runCompare, writeCompareCsv } from './bench/compare.js';
import { DATASET, HARD_DATASET } from './bench/dataset.js';
import { renderCharts } from './bench/charts.js';
import { summarizeCsv } from './bench/summary.js';
import { PlaywrightSandbox } from './sandbox/sandbox.js';
import { SingleHtmlPackager } from './packager/packager.js';
import { Engine } from './engine/engine.js';
import { ALL_AGENTS } from './agents/profiles.js';
import { SAMPLE_GAME_HTML, SAMPLE_GAME_V2_HTML } from './agents/sample-game.js';
import { SAMPLE_BROKEN_HTML } from './agents/sample-broken.js';
import { GAME_GEN_WF } from './workflows/game-gen.js';
import { AUTO_WF } from './workflows/auto-plan.js';
import type { HardReport, RunEvent, WorkflowDef } from './types.js';

// 加载 .env（若存在）
try {
  process.loadEnvFile?.('.env');
} catch {
  /* .env 不存在时忽略 */
}

const M1_SINGLE_WF: WorkflowDef = {
  id: 'm1-single',
  name: 'M1 最小环：生成→硬验证',
  nodes: [
    { id: 'n1', type: 'agent', agent: 'builder', inputs: ['spec'], outputs: ['artifact'] },
    { id: 'n2', type: 'verify', verifier: 'hard-sandbox', inputs: ['artifact'], outputs: ['hard_report'] },
  ],
  edges: [{ from: 'n1', to: 'n2', when: 'always' }],
  limits: { max_total_iters: 6, timeout_sec: 900, max_concurrency: 4 },
};

function fakeHandlers(builderOutput: string, fixerOutput: string, criticScore = 5) {
  let builderCalls = 0;
  return {
    analyst: () =>
      JSON.stringify({
        goal: '可玩的打砖块',
        graphic: true,
        acceptance: ['页面加载无 console 报错', 'canvas 有非空像素', '球拍可左右控制且球与砖块碰撞'],
        assumptions: ['单人、无存档'],
        ambiguities: [],
        tasks: [],
      }),
    builder: () => {
      builderCalls++;
      // 首次故意返回坏产物（演示修复闭环）；返工轮返回好的（生成者"学会了"，与分析师返工语义一致）
      return builderCalls === 1
        ? builderOutput
        : JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML });
    },
    critic: () => JSON.stringify({ score: criticScore, gaps: criticScore < 4 ? ['画面简陋，缺少计分显示'] : [] }),
    fixer: () => fixerOutput,
    reviser: (messages: { role: string; content: string }[]) => {
      const userText = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .join('\n');
      // 演示：指令含「计分板」时返回带醒目计分板的 v2
      if (userText.includes('计分板')) return JSON.stringify({ title: '打砖块·计分板版', html: SAMPLE_GAME_V2_HTML });
      return JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML });
    },
  };
}

function makeFakeEngine(
  builderOutput: string,
  fixerOutput = JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML }),
  opts: { humanGate?: boolean; criticScore?: number } = {},
) {
  const store = new EventStore('runs');
  const fake = new FakeLLM(fakeHandlers(builderOutput, fixerOutput, opts.criticScore));
  const engine = new Engine({
    llm: fake,
    sandbox: new PlaywrightSandbox(),
    packager: new SingleHtmlPackager(),
    store,
    agents: ALL_AGENTS,
    humanGate: opts.humanGate ?? false,
  });
  return { engine, store };
}

function summarize(events: RunEvent[]): void {
  const hardResults = events.filter((e) => e.type === 'verify.hard.result') as RunEvent[];
  const errorCurve = hardResults.map((e) => (e.payload as unknown as HardReport).errors.length);
  const finished = events.some((e) => e.type === 'run.finished');
  const failed = events.some((e) => e.type === 'run.failed');
  console.log(`终态       : ${finished ? 'finished' : failed ? 'failed' : 'unknown'}`);
  console.log(`硬验证次数 : ${hardResults.length}`);
  console.log(`error_curve: [${errorCurve.join(', ')}]`);
}

async function demoSingle(): Promise<void> {
  const { engine, store } = makeFakeEngine(JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML }));
  console.log('[demo:single] 一句话需求 -> 生成 -> 硬验证');
  const runId = engine.start(M1_SINGLE_WF, { requirement: '做个能玩的打砖块' });
  await engine.wait(runId);
  const events = store.replay(runId);
  const hardResult = events.find((e) => e.type === 'verify.hard.result');
  const report = hardResult?.payload as unknown as HardReport | undefined;
  console.log(`\nrun_id     : ${runId}`);
  console.log(`ok         : ${report?.ok}`);
  console.log(`errors     : ${report?.errors?.length ?? '?'}`);
  console.log(`load_ms    : ${report?.load_ms ?? '?'}`);
  console.log(`产物落盘   : runs/${runId}/`);
  console.log(report?.ok ? '\n✅ M1 通过' : '\n❌ M1 失败');
  if (!report?.ok) process.exitCode = 1;
}

async function demoWorkflow(): Promise<void> {
  const { engine, store } = makeFakeEngine(JSON.stringify({ title: 'broken', html: SAMPLE_BROKEN_HTML }));
  console.log('[demo:workflow] 全链路：分析→生成(故意坏)→硬验证失败→回灌修复→再验证通过→打包');
  const runId = engine.start(GAME_GEN_WF, { requirement: '做个能玩的打砖块' });
  await engine.wait(runId);
  const events = store.replay(runId);
  console.log(`\nrun_id     : ${runId}`);
  summarize(events);
  const bundle = events.find((e) => e.type === 'artifact.created');
  console.log(bundle ? `✅ 打包完成，产物见 runs/${runId}/bundle.html` : '⚠️ 未打包');
  const fixed = events.filter((e) => e.type === 'node.entered' && e.node_id === 'n5').length;
  console.log(`修复轮次   : ${fixed}`);
  if (!events.some((e) => e.type === 'run.finished')) process.exitCode = 1;
}

async function demoStall(): Promise<void> {
  const broken = JSON.stringify({ title: 'broken', html: SAMPLE_BROKEN_HTML });
  const { engine, store } = makeFakeEngine(broken, broken);
  console.log('[demo:stall] 修复者反复返回同样的坏代码 → Loop Watchdog 应升级中止');
  const runId = engine.start(GAME_GEN_WF, { requirement: '做个能玩的打砖块' });
  await engine.wait(runId);
  const events = store.replay(runId);
  summarize(events);
  const watchdogErr = events.find(
    (e) => e.type === 'error' && String((e.payload as { message?: string }).message).includes('watchdog'),
  );
  console.log(
    watchdogErr
      ? `✅ 看门狗触发：${(watchdogErr.payload as { message: string }).message}`
      : '⚠️ 看门狗未触发',
  );
  if (!watchdogErr) process.exitCode = 1;
}

async function bench(): Promise<void> {
  const key = process.env.DEEPSEEK_API_KEY;
  let llm: LLMGateway;
  if (key) {
    llm = new DeepSeekLLM(key);
    console.log('[bench] 使用真实 DeepSeek v4-pro');
  } else {
    llm = new FakeLLM(
      fakeHandlers(
        JSON.stringify({ title: 'broken', html: SAMPLE_BROKEN_HTML }),
        JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML }),
      ),
    );
    console.log('[bench] 无 API key，使用 fake LLM（仅验证流水线，数字无意义）');
  }
  const rows = await runBench(llm);
  writeCsv(rows, 'runs/results.csv');
  const ok = rows.filter((r) => r.ok).length;
  console.log(`\n可运行率: ${ok}/${rows.length}  结果落盘: runs/results.csv`);
  printUsage(llm);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function printUsage(llm: LLMGateway): void {
  if (llm instanceof DeepSeekLLM) {
    const u = llm.getUsage();
    const cost = (u.input * 4.5 + u.output * 13.5) / 1_000_000; // 闲时价（元）
    console.log(`\nToken 用量: 输入 ${u.input} · 输出 ${u.output} · 思考 ${u.reasoning} · 调用 ${u.calls} 次`);
    console.log(`估算成本(闲时): ¥${cost.toFixed(2)}`);
  }
}

async function demoInterrupt(): Promise<void> {
  const { engine, store } = makeFakeEngine(JSON.stringify({ title: 'broken', html: SAMPLE_BROKEN_HTML }));
  console.log('[demo:interrupt] 运行中中断 → 插入指令 → 断点续跑');
  const runId = engine.start(GAME_GEN_WF, { requirement: '做个能玩的打砖块' });
  await sleep(1200);
  engine.interrupt(runId);
  await engine.wait(runId);
  console.log('已暂停，插入指令「加个计分板」并续跑');
  engine.resume(runId, '加个计分板');
  await engine.wait(runId);
  // 续跑到人工确认点 → 接受交付
  let evInt = store.replay(runId);
  if (evInt.some((e) => e.type === 'run.interrupted' && (e.payload as { reason?: string }).reason === 'awaiting_human')) {
    engine.resume(runId);
    await engine.wait(runId);
  }
  const events = store.replay(runId);
  const interrupted = events.some((e) => e.type === 'run.interrupted');
  const resumed = events.some((e) => e.type === 'run.resumed');
  const instruction = events.find(
    (e) => e.type === 'human.instruction' && (e.payload as { text?: string }).text === '加个计分板',
  );
  const finished = events.some((e) => e.type === 'run.finished');
  console.log(
    `中断事件: ${interrupted}  续跑事件: ${resumed}  指令事件: ${!!instruction}  终态: ${finished ? 'finished' : 'other'}`,
  );
  const allOk = interrupted && resumed && !!instruction && finished;
  console.log(allOk ? '\n✅ M3 中断/续跑机制跑通' : '\n⚠️ 有环节缺失');
  if (!allOk) process.exitCode = 1;
}

async function demoReal(): Promise<void> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    console.log('未配置 DEEPSEEK_API_KEY（agent-platform/.env）');
    process.exitCode = 1;
    return;
  }
  const store = new EventStore('runs');
  const engine = new Engine({
    llm: new DeepSeekLLM(key),
    sandbox: new PlaywrightSandbox(),
    packager: new SingleHtmlPackager(),
    store,
    agents: ALL_AGENTS,
    humanGate: false, // CLI 冒烟：自动接受人工确认点
  });
  console.log('[demo:real] 真实 v4-pro 全链路：做个能玩的打砖块');
  const t0 = Date.now();
  const runId = engine.start(GAME_GEN_WF, { requirement: '做个能玩的打砖块' });
  await engine.wait(runId);
  const events = store.replay(runId);
  summarize(events);
  console.log(`总耗时     : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const hardResults = events.filter((e) => e.type === 'verify.hard.result');
  const lastReport = hardResults[hardResults.length - 1]?.payload as unknown as { errors?: unknown[] } | undefined;
  console.log(`末轮报错   : ${lastReport?.errors?.length ?? '?'} 条`);
  console.log(`产物       : runs/${runId}/bundle.html`);
  if (!events.some((e) => e.type === 'run.finished')) process.exitCode = 1;
}

async function demoGate(): Promise<void> {
  const store = new EventStore('runs');
  const fake = new FakeLLM({
    analyst: () =>
      JSON.stringify({
        goal: '未明确的游戏',
        graphic: true,
        acceptance: ['页面加载无 console 报错', 'canvas 有非空像素'],
        assumptions: [],
        ambiguities: [{ q: '需求没有明确玩法，请指定（如：打砖块/贪吃蛇）', blocking: true }],
        tasks: [],
      }),
    builder: () => JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML }),
    critic: () => JSON.stringify({ score: 5, gaps: [] }),
    fixer: () => JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML }),
  });
  const engine = new Engine({
    llm: fake,
    sandbox: new PlaywrightSandbox(),
    packager: new SingleHtmlPackager(),
    store,
    agents: ALL_AGENTS,
  });
  console.log('[demo:gate] §5.8 歧义停机：阻塞性歧义 → 自动暂停 → 人工回答 → 续跑');
  const runId = engine.start(GAME_GEN_WF, { requirement: '做个好玩的游戏' });
  await engine.wait(runId);
  let events = store.replay(runId);
  const interrupted = events.find((e) => e.type === 'run.interrupted');
  const reason = (interrupted?.payload as { reason?: string }).reason;
  const prompt = (interrupted?.payload as { prompt?: string }).prompt;
  const builderRanBefore = events.some((e) => e.type === 'node.entered' && e.node_id === 'n2');
  console.log(`暂停原因 : ${reason}`);
  console.log(`歧义提示 : ${prompt?.split('\n')[0]}`);
  console.log(`续跑前生成者已运行: ${builderRanBefore}`);
  engine.resume(runId, '做一个打砖块游戏');
  await engine.wait(runId);
  // 流程继续走到人工确认点 → 接受
  let ev2 = store.replay(runId);
  if (ev2.some((e) => e.type === 'run.interrupted' && (e.payload as { reason?: string }).reason === 'awaiting_human')) {
    engine.resume(runId);
    await engine.wait(runId);
  }
  events = store.replay(runId);
  const finished = events.some((e) => e.type === 'run.finished');
  console.log(`续跑后终态: ${finished ? 'finished' : 'other'}`);
  const ok = reason === 'blocking_ambiguities' && !!prompt && !builderRanBefore && finished;
  console.log(ok ? '\n✅ §5.8 歧义停机跑通' : '\n⚠️ 有环节缺失');
  if (!ok) process.exitCode = 1;
}

async function demoQuality(): Promise<void> {
  // 有状态的假裁判：第一版打 2 分（触发质量返工），返工后打 5 分
  let criticCalls = 0;
  const store = new EventStore('runs');
  const fake = new FakeLLM({
    analyst: () =>
      JSON.stringify({
        goal: '可玩的打砖块',
        graphic: true,
        acceptance: ['页面加载无 console 报错', 'canvas 有非空像素', '球拍可左右控制且球与砖块碰撞'],
        assumptions: ['单人、无存档'],
        ambiguities: [],
        tasks: [],
      }),
    builder: () => JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML }),
    critic: () => {
      criticCalls++;
      return JSON.stringify(
        criticCalls === 1 ? { score: 2, gaps: ['画面简陋，缺少计分显示'] } : { score: 5, gaps: [] },
      );
    },
    fixer: () => JSON.stringify({ title: '打砖块·计分板版', html: SAMPLE_GAME_V2_HTML }),
    reviser: () => JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML }),
  });
  const engine = new Engine({
    llm: fake,
    sandbox: new PlaywrightSandbox(),
    packager: new SingleHtmlPackager(),
    store,
    agents: ALL_AGENTS,
    humanGate: false,
  });
  console.log('[demo:quality] 质量门控：软裁判首版打 2 分 → 自动返工 → 二版打 5 分 → 交付');
  const runId = engine.start(GAME_GEN_WF, { requirement: '做个能玩的打砖块' });
  await engine.wait(runId);
  const events = store.replay(runId);
  summarize(events);
  const verdicts = events.filter((e) => e.type === 'verify.soft.verdict');
  const scores = verdicts.map((e) => (e.payload as { score: number }).score);
  const finished = events.some((e) => e.type === 'run.finished');
  const packed = events.some((e) => e.type === 'artifact.created');
  console.log(`软裁判打分: [${scores.join(', ')}]`);
  console.log(`打包交付  : ${packed}`);
  const ok = finished && packed && scores.length >= 2 && scores[0] === 2 && scores[scores.length - 1] === 5;
  console.log(ok ? '\n✅ 质量门控 + 低分自动返工跑通' : '\n⚠️ 有环节缺失');
  if (!ok) process.exitCode = 1;
}

async function demoConfirm(): Promise<void> {
  const { engine, store } = makeFakeEngine(JSON.stringify({ title: 'broken', html: SAMPLE_BROKEN_HTML }), undefined, {
    humanGate: true,
  });
  console.log('[demo:confirm] 人工确认点：接受 / 返工（附指令）');
  const runId = engine.start(GAME_GEN_WF, { requirement: '做个能玩的打砖块' });
  await engine.wait(runId);
  let events = store.replay(runId);
  const paused = events.find((e) => e.type === 'run.interrupted');
  const reason = (paused?.payload as { reason?: string }).reason;
  console.log(`暂停原因 : ${reason}`);
  // 第一次：给指令返工
  engine.resume(runId, '加个计分板');
  await engine.wait(runId);
  events = store.replay(runId);
  const paused2 = events.filter((e) => e.type === 'run.interrupted').length;
  const instr = events.some((e) => e.type === 'human.instruction' && (e.payload as { text?: string }).text === '加个计分板');
  console.log(`返工后再次到确认点: ${paused2 === 2} · 指令事件: ${instr}`);
  // 第二次：接受
  engine.resume(runId);
  await engine.wait(runId);
  events = store.replay(runId);
  const finished = events.some((e) => e.type === 'run.finished');
  const artifacts = events.filter((e) => e.type === 'artifact.created');
  const versions = artifacts.map((e) => ((e.payload as { bundle?: { version?: number } }).bundle?.version ?? '?'));
  console.log(`接受后终态: ${finished ? 'finished' : 'other'} · 打包版本: [${versions.join(', ')}]`);
  const ok = reason === 'awaiting_human' && instr && finished && versions.length >= 2;
  console.log(ok ? '\n✅ 人工确认 + 返工 + 版本化交付跑通' : '\n⚠️ 有环节缺失');
  if (!ok) process.exitCode = 1;
}

async function demoScheduler(): Promise<void> {
  const store = new EventStore('runs');
  const good = JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML });
  const fake = new FakeLLM({
    analyst: () =>
      JSON.stringify({ goal: '可玩的打砖块', graphic: true, acceptance: ['页面加载无 console 报错', 'canvas 有非空像素'], assumptions: [], ambiguities: [], tasks: [] }),
    builder: () => good,
    'builder-flash': () => good,
    critic: () => JSON.stringify({ score: 5, gaps: [] }),
    fixer: () => good,
    reviser: () => good,
  });
  const engine = new Engine({
    llm: fake,
    sandbox: new PlaywrightSandbox(),
    packager: new SingleHtmlPackager(),
    store,
    agents: ALL_AGENTS,
    humanGate: false,
  });

  async function runOnce(label: string, weights: { w_succ: number; w_speed: number; w_cost: number }): Promise<string | null> {
    const runId = engine.start(GAME_GEN_WF, { requirement: '做个能玩的打砖块' }, { schedulerWeights: weights });
    await engine.wait(runId);
    const events = store.replay(runId);
    const picked = events.find((e) => e.type === 'scheduler.picked');
    const p = picked?.payload as { picked?: string; candidates?: { agent: string; score: number }[] } | undefined;
    console.log(`${label}: 选择 [${p?.picked}]  打分 ${(p?.candidates ?? []).map((c) => `${c.agent}=${c.score}`).join(' · ')}`);
    return p?.picked ?? null;
  }

  console.log('[demo:scheduler] 智能调度：同一生成节点，按权重在 builder(pro) 与 builder-flash 之间择一');
  const q = await runOnce('质量优先', { w_succ: 1, w_speed: 0.05, w_cost: 0.03 });
  const s = await runOnce('省流优先', { w_succ: 0.3, w_speed: 0.2, w_cost: 0.5 });
  const ok = q === 'builder' && s === 'builder-flash';
  console.log(ok ? '\n✅ 智能调度打分跑通（质量→pro，省流→flash）' : '\n⚠️ 调度结果不符合预期');
  if (!ok) process.exitCode = 1;
}

async function demoAuto(): Promise<void> {
  const store = new EventStore('runs');
  const good = JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML });
  const fake = new FakeLLM({
    analyst: () =>
      JSON.stringify({
        goal: '可玩的打砖块',
        graphic: true,
        acceptance: ['页面加载无 console 报错', 'canvas 有非空像素', '球拍可左右控制且球与砖块碰撞'],
        assumptions: ['单人、无存档'],
        ambiguities: [],
        tasks: [],
        plan: [
          { step: '搭画布与核心循环：球拍移动、球反弹、砖块碰撞', acceptance: ['canvas 渲染非空', '球拍可控制'] },
          { step: '加计分与通关判定：计分板、砖块清零胜利提示', acceptance: ['计分显示正确', '胜利条件可触发'] },
        ],
      }),
    builder: () => good,
    fixer: () => good,
    critic: () => JSON.stringify({ score: 5, gaps: [] }),
    reviser: () => good,
  });
  const engine = new Engine({
    llm: fake,
    sandbox: new PlaywrightSandbox(),
    packager: new SingleHtmlPackager(),
    store,
    agents: ALL_AGENTS,
    humanGate: false,
  });
  console.log('[demo:auto] 自主编排：分析师拆 2 步计划 → 引擎逐步编排生成-验证-修复 → 打包');
  const runId = engine.start(AUTO_WF, { requirement: '做个能玩的打砖块' });
  await engine.wait(runId);
  const events = store.replay(runId);
  summarize(events);
  const planMsg = events.find((e) => e.type === 'agent.message' && String((e.payload as { text?: string }).text ?? '').includes('自主编排'));
  const steps = events.filter((e) => e.type === 'node.entered' && e.node_id?.startsWith('n2#s'));
  const stepVerify = events.filter((e) => e.type === 'verify.hard.result' && e.node_id?.startsWith('n2#s'));
  const finished = events.some((e) => e.type === 'run.finished');
  console.log(`计划消息  : ${planMsg ? '✅' : '❌'}`);
  console.log(`步骤执行  : ${steps.length} 步（node.entered）· 步骤内验证 ${stepVerify.length} 次`);
  const ok = finished && !!planMsg && steps.length >= 2 && stepVerify.length >= 2;
  console.log(ok ? '\n✅ 自主编排（自调用）跑通：分析师出计划，引擎自动为每步编排生成-验证闭环' : '\n⚠️ 有环节缺失');
  if (!ok) process.exitCode = 1;
}

async function compare(): Promise<void> {
  const key = process.env.DEEPSEEK_API_KEY;
  let llm: LLMGateway;
  if (key) {
    llm = new DeepSeekLLM(key);
    console.log('[compare] 使用真实 DeepSeek v4-pro');
  } else {
    llm = new FakeLLM(
      fakeHandlers(
        JSON.stringify({ title: 'broken', html: SAMPLE_BROKEN_HTML }),
        JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML }),
      ),
    );
    console.log('[compare] 无 API key，使用 fake LLM（仅验证流水线，数字无意义）');
  }
  const hard = process.env.COMPARE_SET === 'hard';
  const limit = Number(process.env.COMPARE_LIMIT ?? (hard ? '2' : '8'));
  console.log(`${hard ? '[难样本组]' : ''}子集 ${limit} 样本 × 3 策略`);
  const rows = await runCompare(llm, limit, hard ? HARD_DATASET : DATASET);
  const outPath = hard ? 'runs/results-compare-hard.csv' : 'runs/results-compare.csv';
  writeCompareCsv(rows, outPath);
  console.log(`结果落盘: ${outPath}`);
  console.log('\n三策略对比（可运行率，同一 L1 硬验证口径）：');
  for (const r of rows) {
    console.log(`  ${r.strategy.padEnd(20)} ${r.runnable}/${r.total}  (${r.rate})  平均首轮错误 ${r.avg_first_errors}`);
  }
  printUsage(llm);
}

async function charts(): Promise<void> {
  const out = await renderCharts('runs/results.csv', 'runs/charts');
  console.log('已生成图表：');
  for (const p of out) console.log('  ' + p);
}

async function summary(): Promise<void> {
  console.log(summarizeCsv('runs/results.csv'));
}

async function replay(): Promise<void> {
  const runId = process.argv[3];
  if (!runId) {
    console.log('用法: npm run replay -- <runId>');
    process.exitCode = 1;
    return;
  }
  const store = new EventStore('runs');
  const events = store.replay(runId);
  if (events.length === 0) {
    console.log(`未找到 run: ${runId}`);
    process.exitCode = 1;
    return;
  }
  console.log(`重放 ${runId}：${events.length} 条事件（可复现证据）`);
  for (const e of events) {
    const t = new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false });
    const node = e.node_id ? ` @${e.node_id}` : '';
    const brief = JSON.stringify(e.payload).slice(0, 70);
    console.log(`  #${String(e.seq).padStart(3)} ${t} ${e.type}${node} ${brief}`);
  }
}

async function main(): Promise<void> {
  mkdirSync('runs', { recursive: true });
  const cmd = process.argv[2] ?? 'demo:single';
  switch (cmd) {
    case 'demo:single':
      await demoSingle();
      break;
    case 'demo:workflow':
      await demoWorkflow();
      break;
    case 'demo:stall':
      await demoStall();
      break;
    case 'demo:interrupt':
      await demoInterrupt();
      break;
    case 'demo:real':
      await demoReal();
      break;
    case 'demo:gate':
      await demoGate();
      break;
    case 'demo:quality':
      await demoQuality();
      break;
    case 'demo:confirm':
      await demoConfirm();
      break;
    case 'demo:scheduler':
      await demoScheduler();
      break;
    case 'demo:auto':
      await demoAuto();
      break;
    case 'bench':
      await bench();
      break;
    case 'compare':
      await compare();
      break;
    case 'charts':
      await charts();
      break;
    case 'summary':
      await summary();
      break;
    case 'replay':
      await replay();
      break;
    default:
      console.log(`未知命令：${cmd}`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
