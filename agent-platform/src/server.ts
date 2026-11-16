import express from 'express';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventStore } from './event/store.js';
import { DeepSeekLLM, FakeLLM } from './gateway/llm.js';
import type { LLMGateway } from './gateway/llm.js';
import { PlaywrightSandbox } from './sandbox/sandbox.js';
import { SingleHtmlPackager } from './packager/packager.js';
import { Engine } from './engine/engine.js';
import { ALL_AGENTS } from './agents/profiles.js';
import { GAME_GEN_WF } from './workflows/game-gen.js';
import { SAMPLE_BROKEN_HTML } from './agents/sample-broken.js';
import { SAMPLE_GAME_HTML } from './agents/sample-game.js';
import type { HardReport, RunEvent, RunId } from './types.js';

try {
  process.loadEnvFile?.('.env');
} catch {
  /* 忽略 */
}

const store = new EventStore('runs');
const key = process.env.DEEPSEEK_API_KEY;

let llm: LLMGateway;
if (key) {
  llm = new DeepSeekLLM(key);
} else {
  llm = new FakeLLM({
    analyst: () =>
      JSON.stringify({
        goal: '可玩的打砖块',
        graphic: true,
        acceptance: ['页面加载无 console 报错', 'canvas 渲染非空', '球拍可控制'],
        assumptions: ['单人、无存档'],
        ambiguities: [],
        tasks: [],
      }),
    builder: () => JSON.stringify({ title: 'broken', html: SAMPLE_BROKEN_HTML }),
    critic: () => JSON.stringify({ score: 2, gaps: ['无法运行'] }),
    fixer: () => JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML }),
    reviser: () => JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML }),
  });
}

const engine = new Engine({
  llm,
  sandbox: new PlaywrightSandbox(),
  packager: new SingleHtmlPackager(),
  store,
  agents: ALL_AGENTS,
});

const app = express();
app.use(express.json({ limit: '2mb' }));

// 静态托管前端构建产物：整个应用只跑在 :3000 一个端口
const webDist = join(process.cwd(), 'web', 'dist');
app.use(express.static(webDist));

const PORT = Number(process.env.PORT ?? 3000);
const runsOrder: string[] = [];

// 实时事件推送（SSE）
const clients = new Map<RunId, Set<express.Response>>();
engine.subscribe((e: RunEvent) => {
  const set = clients.get(e.run_id);
  if (!set) return;
  const data = `data: ${JSON.stringify(e)}\n\n`;
  for (const res of set) res.write(data);
});

function buildReport(runId: string) {
  const events = store.replay(runId);
  let status = 'unknown';
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i].type;
    if (t === 'run.finished') { status = 'done'; break; }
    if (t === 'run.failed') { status = 'failed'; break; }
    if (t === 'run.interrupted') {
      const reason = (events[i].payload as { reason?: string }).reason;
      status = reason === 'awaiting_human' ? 'awaiting_human' : 'paused';
      break;
    }
    if (t === 'run.resumed' || t === 'run.started') { status = 'running'; break; }
  }
  const hardReports = events.filter((e) => e.type === 'verify.hard.result').map((e) => e.payload as unknown as HardReport);
  const errorCurve = hardReports.map((r) => r.errors.length);
  const soft = events.find((e) => e.type === 'verify.soft.verdict')?.payload;
  const finished = events.find((e) => e.type === 'run.finished');
  const lastHard = hardReports[hardReports.length - 1];
  // 版本列表（人工返工后累积）
  let versions: string[] = [];
  try {
    versions = readdirSync(store.runDir(runId)).filter((f) => /^bundle-v\d+\.html$/.test(f)).sort();
  } catch {
    /* 目录不存在 */
  }
  return {
    runId,
    status,
    error_curve: errorCurve,
    last_ok: lastHard?.ok ?? null,
    last_errors: lastHard?.errors ?? [],
    soft_report: soft ?? null,
    wall_ms: (finished?.payload as { wall_ms?: number } | undefined)?.wall_ms ?? null,
    verify_count: hardReports.length,
    versions,
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: key ? 'deepseek-v4-pro' : 'fake', runs: runsOrder.length });
});

app.post('/api/runs', (req, res) => {
  const requirement = String(req.body?.requirement ?? '').trim();
  if (!requirement) {
    res.status(400).json({ error: 'requirement 不能为空' });
    return;
  }
  // 每 Agent 的模型/思考强度覆盖：{ analyst: { model: 'deepseek-flash', effort: 'low' }, ... }
  const config = (req.body?.config ?? {}) as Record<string, { model?: string; effort?: 'low' | 'medium' | 'high' }>;
  const runId = engine.start(GAME_GEN_WF, { requirement }, { overrides: config });
  runsOrder.unshift(runId);
  res.json({ runId });
});

app.post('/api/runs/:id/interrupt', (req, res) => {
  try {
    engine.interrupt(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.post('/api/runs/:id/resume', (req, res) => {
  try {
    engine.resume(req.params.id, req.body?.instruction);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.get('/api/runs', (_req, res) => {
  res.json(runsOrder.map((id) => ({ runId: id, report: buildReport(id) })));
});

app.get('/api/runs/:id/events', (req, res) => {
  const runId = req.params.id;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  for (const e of store.replay(runId)) res.write(`data: ${JSON.stringify(e)}\n\n`);
  let set = clients.get(runId);
  if (!set) {
    set = new Set();
    clients.set(runId, set);
  }
  set.add(res);
  req.on('close', () => set?.delete(res));
});

app.get('/api/runs/:id/report', (req, res) => {
  res.json(buildReport(req.params.id));
});

app.get('/api/runs/:id/artifact', (req, res) => {
  // ?v=N 查看历史版本（人工返工前的旧版）
  const v = Number(req.query.v ?? 0);
  const p = v > 0 ? join(store.runDir(req.params.id), `bundle-v${v}.html`) : join(store.runDir(req.params.id), 'bundle.html');
  if (!existsSync(p)) {
    res.status(404).json({ error: '产物不存在' });
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(readFileSync(p, 'utf8'));
});

app.listen(PORT, () => {
  console.log(`后端已启动: http://localhost:${PORT}`);
  console.log(`模型: ${key ? 'deepseek-v4-pro' : 'fake'}`);
  console.log(`健康检查: http://localhost:${PORT}/api/health`);
});
