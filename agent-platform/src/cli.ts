import { mkdirSync } from 'node:fs';
import { EventStore } from './event/store.js';
import { FakeLLM, DeepSeekLLM } from './gateway/llm.js';
import type { LLMGateway } from './gateway/llm.js';
import { runBench, writeCsv } from './bench/runner.js';
import { PlaywrightSandbox } from './sandbox/sandbox.js';
import { SingleHtmlPackager } from './packager/packager.js';
import { Engine } from './engine/engine.js';
import { ALL_AGENTS } from './agents/profiles.js';
import { SAMPLE_GAME_HTML } from './agents/sample-game.js';
import { SAMPLE_BROKEN_HTML } from './agents/sample-broken.js';
import { GAME_GEN_WF } from './workflows/game-gen.js';
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

function fakeHandlers(builderOutput: string, fixerOutput: string) {
  return {
    analyst: () =>
      JSON.stringify({
        goal: '可玩的打砖块',
        acceptance: ['页面加载无 console 报错', 'canvas 有非空像素', '球拍可左右控制且球与砖块碰撞'],
        assumptions: ['单人、无存档'],
        ambiguities: [],
        tasks: [],
      }),
    builder: () => builderOutput,
    critic: () => JSON.stringify({ score: 2, gaps: ['游戏无法运行'] }),
    fixer: () => fixerOutput,
  };
}

function makeFakeEngine(
  builderOutput: string,
  fixerOutput = JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML }),
) {
  const store = new EventStore('runs');
  const fake = new FakeLLM(fakeHandlers(builderOutput, fixerOutput));
  const engine = new Engine({
    llm: fake,
    sandbox: new PlaywrightSandbox(),
    packager: new SingleHtmlPackager(),
    store,
    agents: ALL_AGENTS,
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
    case 'bench':
      await bench();
      break;
    case 'replay':
      console.log(`命令 ${cmd} 将在后续里程碑实现`);
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
