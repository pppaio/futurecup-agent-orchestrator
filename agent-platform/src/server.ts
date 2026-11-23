import express from 'express';
import { readFileSync, existsSync, readdirSync, writeFileSync, appendFileSync, statSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { EventStore } from './event/store.js';
import { MultiProviderLLM, FakeLLM, providersFromEnv } from './gateway/llm.js';
import type { LLMGateway, LLMMessage, ProviderConfig } from './gateway/llm.js';
import { PlaywrightSandbox } from './sandbox/sandbox.js';
import { SingleHtmlPackager } from './packager/packager.js';
import { Engine } from './engine/engine.js';
import { ALL_AGENTS } from './agents/profiles.js';
import { GAME_GEN_WF } from './workflows/game-gen.js';
import { AUTO_WF } from './workflows/auto-plan.js';
import { SAMPLE_BROKEN_HTML } from './agents/sample-broken.js';
import { SAMPLE_GAME_HTML } from './agents/sample-game.js';
import type { AgentProfile, HardReport, RunEvent, RunId } from './types.js';
import { KnowledgeBase } from './kb.js';
import { MemoryStore } from './memory.js';
import { McpClient } from './mcp.js';

try {
  process.loadEnvFile?.('.env');
} catch {
  /* 忽略 */
}

// 用户在前端「接入 API」面板里添加的供应商（持久化到 providers.json，不进 git）
const PROVIDERS_FILE = join(process.cwd(), 'providers.json');
function loadUserProviders(): Map<string, ProviderConfig> {
  const map = new Map<string, ProviderConfig>();
  try {
    const list = JSON.parse(readFileSync(PROVIDERS_FILE, 'utf8')) as ProviderConfig[];
    for (const p of list) map.set(p.id, p);
  } catch {
    /* 文件不存在或损坏则忽略 */
  }
  return map;
}
function persistUserProviders(userProviders: Map<string, ProviderConfig>): void {
  writeFileSync(PROVIDERS_FILE, JSON.stringify([...userProviders.values()], null, 2), 'utf8');
}

/** 启动时收尾：上次进程若被重启/杀掉，未终态的 run 补一条 run.failed（诚实收尾，避免悬挂）。 */
function closeOrphanedRuns(): void {
  const runsRoot = join(process.cwd(), 'runs');
  let dirs: string[] = [];
  try {
    dirs = readdirSync(runsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
  }
  for (const runId of dirs) {
    const p = join(runsRoot, runId, 'events.jsonl');
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length === 0) continue;
      const last = JSON.parse(lines[lines.length - 1]) as RunEvent;
      if (last.type === 'run.finished' || last.type === 'run.failed') continue;
      const closing: RunEvent = {
        seq: last.seq + 1,
        ts: Date.now(),
        run_id: runId as RunId,
        type: 'run.failed',
        payload: { reason: 'server_restarted' },
      };
      appendFileSync(p, JSON.stringify(closing) + '\n', 'utf8');
    } catch {
      /* 跳过 */
    }
  }
}
closeOrphanedRuns();

const store = new EventStore('runs');
// 合并「.env 配置的供应商」+「用户在前端接入的供应商(providers.json)」
const providers = providersFromEnv();
const userProviders = loadUserProviders();
for (const [id, p] of userProviders) providers.set(id, p);

/** 演示模式（无任何 API Key）：Fake LLM 跑通全链路，评审零成本复现。 */
function makeDemoFake(): FakeLLM {
  let builderCalls = 0;
  const good = JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML });
  return new FakeLLM({
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
          { step: '加计分与通关判定：计分板、砖块清零胜利提示', acceptance: ['计分显示正确'] },
        ],
      }),
    builder: () => {
      builderCalls++;
      return builderCalls === 1
        ? JSON.stringify({ title: 'broken', html: SAMPLE_BROKEN_HTML }) // 首版故意带错 → 演示修复闭环
        : good;
    },
    'builder-flash': () => good,
    critic: () => JSON.stringify({ score: 4, gaps: ['画面简陋，缺少计分显示'] }),
    fixer: () => good,
    reviser: () => good,
  });
}

// 可切换网关：无 Key 时用 Fake 演示模式；用户在界面接入供应商后自动切到真实模式
const llmBox: { current: LLMGateway } = {
  current: providers.size > 0 ? new MultiProviderLLM(providers) : makeDemoFake(),
};
class SwitchableLLM implements LLMGateway {
  complete(opts: { agent: AgentProfile; messages: LLMMessage[]; json?: boolean; signal?: AbortSignal }) {
    return llmBox.current.complete(opts);
  }
}
const llm: MultiProviderLLM | FakeLLM | SwitchableLLM = new SwitchableLLM();
const realGateway = (): MultiProviderLLM | null =>
  llmBox.current instanceof MultiProviderLLM ? llmBox.current : null;
const isDemoMode = (): boolean => llmBox.current instanceof FakeLLM;

// MCP 服务器（可选）：MCP_CMD + MCP_ARGS 指定命令与参数（stdio 传输），如
// MCP_CMD=npx  MCP_ARGS="tsx examples/mcp-calculator-server.ts"
const mcpClients: McpClient[] = [];
const mcpCmd = process.env.MCP_CMD;
if (mcpCmd) {
  const client = new McpClient(mcpCmd, (process.env.MCP_ARGS ?? '').split(' ').filter(Boolean), true);
  mcpClients.push(client);
  client
    .init()
    .then(() => console.log(`MCP 服务器已连接，工具: ${client.getTools().map((t) => t.name).join(', ')}`))
    .catch((e) => console.warn('MCP 连接失败:', String(e)));
}

const engine = new Engine({
  llm,
  sandbox: new PlaywrightSandbox(),
  packager: new SingleHtmlPackager(),
  store,
  agents: ALL_AGENTS,
  kb: new KnowledgeBase(join(process.cwd(), 'knowledge')),
  memory: new MemoryStore(join(process.cwd(), 'runs')),
  mcp: mcpClients,
});

const app = express();
app.use(express.json({ limit: '2mb' }));

// 静态托管前端构建产物：整个应用只跑在 :3000 一个端口
const webDist = join(process.cwd(), 'web', 'dist');

// 首次启动自愈：仓库不含 web/dist（构建产物不入库），新克隆环境缺少前端时自动安装依赖并构建
if (!existsSync(join(webDist, 'index.html'))) {
  console.log('[首次启动] 前端未构建，自动安装并构建（约 1 分钟，仅一次）...');
  const inst = spawnSync('npm', ['--prefix', 'web', 'install'], { stdio: 'inherit', shell: true });
  if (inst.status === 0) {
    spawnSync('npm', ['--prefix', 'web', 'run', 'build'], { stdio: 'inherit', shell: true });
  } else {
    console.warn('[警告] 前端依赖安装失败，页面将不可用；可手动执行 npm --prefix web install && npm --prefix web run build');
  }
}
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
  // 软裁判：取「最新一次」评分（不是第一次）；同时保留完整打分历史
  const verdicts = events.filter((e) => e.type === 'verify.soft.verdict');
  const soft = verdicts.length > 0 ? verdicts[verdicts.length - 1].payload : null;
  const verdict_history = verdicts.map((e) => ({
    seq: e.seq,
    score: (e.payload as { score?: number }).score ?? null,
    gaps: (e.payload as { gaps?: string[] }).gaps ?? [],
  }));
  const finished = events.find((e) => e.type === 'run.finished');
  const lastHard = hardReports[hardReports.length - 1];
  // 版本列表（人工返工后累积）；每个版本关联「打包前最近一次软裁判评分」
  let versions: { file: string; version: number; score: number | null; gaps: string[] }[] = [];
  try {
    const files = readdirSync(store.runDir(runId)).filter((f) => /^bundle-v\d+\.html$/.test(f)).sort();
    let lastVerdict: { score: number; gaps: string[] } | null = null;
    for (const e of events) {
      if (e.type === 'verify.soft.verdict') {
        const p = e.payload as { score?: number; gaps?: string[] };
        lastVerdict = { score: p.score ?? 0, gaps: p.gaps ?? [] };
      }
      if (e.type === 'artifact.created') {
        const ver = (e.payload as { bundle?: { version?: number } }).bundle?.version ?? 1;
        const file = `bundle-v${ver}.html`;
        if (files.includes(file)) {
          versions.push({ file, version: ver, score: lastVerdict?.score ?? null, gaps: lastVerdict?.gaps ?? [] });
        }
      }
    }
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
    verdict_history,
    wall_ms: (finished?.payload as { wall_ms?: number } | undefined)?.wall_ms ?? null,
    verify_count: hardReports.length,
    versions,
  };
}

app.get('/api/health', (_req, res) => {
  let runCount = 0;
  try {
    runCount = readdirSync(join(process.cwd(), 'runs')).filter((d) => existsSync(join(process.cwd(), 'runs', d, 'events.jsonl'))).length;
  } catch {
    /* 无 runs 目录 */
  }
  res.json({ ok: true, model: isDemoMode() ? 'demo' : [...providers.keys()].join('+') || 'none', runs: runCount });
});

/** 可用供应商列表（不含 key）：{ id, name, models }；演示模式返回空列表 */
app.get('/api/providers', (_req, res) => {
  const gw = realGateway();
  res.json(gw ? gw.getProviders() : []);
});

/** 接入/更新一个供应商（用户在前端填 name/baseUrl/key/models）。key 不回传。 */
app.post('/api/providers', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const baseUrl = String(req.body?.baseUrl ?? '').trim();
  const apiKey = String(req.body?.apiKey ?? '').trim();
  const models = Array.isArray(req.body?.models)
    ? req.body.models.map((m: unknown) => String(m).trim()).filter(Boolean)
    : String(req.body?.models ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!name || !baseUrl || !apiKey) {
    res.status(400).json({ error: '名称 / Base URL / API Key 均不能为空' });
    return;
  }
  if (models.length === 0) {
    res.status(400).json({ error: '模型列表不能为空：请至少填一个模型名（多个用英文逗号分隔，如 gpt-4o,gpt-4o-mini）' });
    return;
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // 中文/非 ASCII 名称会退化为空，用随机后缀保证 id 唯一且不冲突
  const id = slug || `custom-${Math.random().toString(36).slice(2, 6)}`;
  const config: ProviderConfig = {
    id,
    name,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    models,
    supportsReasoningEffort: false,
    supportsResponseFormat: true,
  };
  // 接入供应商后：从演示模式切换到真实网关（引擎经 SwitchableLLM 无感切换）
  providers.set(id, config);
  if (llmBox.current instanceof FakeLLM) {
    llmBox.current = new MultiProviderLLM(providers);
  }
  userProviders.set(id, config);
  persistUserProviders(userProviders);
  res.json({ ok: true, provider: { id, name, models } });
});

/** 删除一个用户接入的供应商（内置 deepseek 等 .env 配置的不删）。 */
app.delete('/api/providers/:id', (req, res) => {
  const id = req.params.id;
  if (!userProviders.has(id)) {
    res.status(400).json({ error: '只能删除通过「接入 API」面板添加的供应商' });
    return;
  }
  providers.delete(id);
  userProviders.delete(id);
  persistUserProviders(userProviders);
  res.json({ ok: true });
});

// ---------- 余额查询（DeepSeek 提供 /user/balance；其它供应商一般不提供，标 null） ----------
let balanceCache: { at: number; data: { id: string; name: string; balance: string | null; currency: string }[] } | null = null;
app.get('/api/balance', async (_req, res) => {
  try {
    if (!balanceCache || Date.now() - balanceCache.at > 60_000) {
      const deepseek = providers.get('deepseek');
      let balance: string | null = null;
      let currency = '';
      if (deepseek) {
        const r = await fetch(`${deepseek.baseUrl}/user/balance`, {
          headers: { Authorization: `Bearer ${deepseek.apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const data = (await r.json()) as { is_available?: boolean; balance_infos?: { currency: string; total_balance: string }[] };
          balance = data.balance_infos?.[0]?.total_balance ?? null;
          currency = data.balance_infos?.[0]?.currency ?? '';
        }
      }
      balanceCache = {
        at: Date.now(),
        data: [...providers.values()].map((p) => ({
          id: p.id,
          name: p.name,
          balance: p.id === 'deepseek' ? balance : null, // 其它供应商无标准余额接口
          currency,
        })),
      };
    }
    res.json({ providers: balanceCache.data, fetched_at: balanceCache.at });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.post('/api/runs', (req, res) => {
  const requirement = String(req.body?.requirement ?? '').trim();
  if (!requirement) {
    res.status(400).json({ error: 'requirement 不能为空' });
    return;
  }
  // 每 Agent 的供应商/模型/思考强度覆盖：{ analyst: { provider: 'qwen', model: 'qwen-max', effort: 'low' }, ... }
  const config = (req.body?.config ?? {}) as Record<
    string,
    { provider?: string; model?: string; effort?: 'low' | 'medium' | 'high' }
  >;
  // 智能调度模式：off=手动 / quality=质量优先(选强模型) / saving=省流(选便宜模型)
  const mode = String(req.body?.scheduler ?? 'off');
  const schedulerWeights =
    mode === 'quality'
      ? { w_succ: 1, w_speed: 0.05, w_cost: 0.03 }
      : mode === 'saving'
        ? { w_succ: 0.3, w_speed: 0.2, w_cost: 0.5 }
        : undefined;
  // 每轮次上限自定义（省流：quality_rounds 调小甚至 0）
  const rawLimits = (req.body?.limits ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };
  const limits = {
    fix_rounds: num(rawLimits.fix_rounds),
    quality_rounds: num(rawLimits.quality_rounds),
    revise_rounds: num(rawLimits.revise_rounds),
    max_total_iters: num(rawLimits.max_total_iters),
    timeout_sec: num(rawLimits.timeout_sec),
    target_score: num(rawLimits.target_score),
  };
  // 编排模式：fixed=固定流水线 / auto=自主编排（分析师出计划，引擎逐步编排）
  const autoMode = String(req.body?.mode ?? 'fixed') === 'auto';
  const wf = autoMode ? AUTO_WF : GAME_GEN_WF;
  const runId = engine.start(wf, { requirement }, { overrides: config, schedulerWeights, limits });
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

/** 删除一次运行：若正在运行 → 先快速中断（中止在途调用），再删除目录与产物。 */
app.delete('/api/runs/:id', async (req, res) => {
  const runId = req.params.id;
  try {
    engine.interrupt(runId);
    await Promise.race([engine.wait(runId), new Promise((r) => setTimeout(r, 6000))]);
  } catch {
    /* 不在内存（已结束/已重启）则直接删目录 */
  }
  engine.forget(runId as RunId);
  const dir = join(process.cwd(), 'runs', runId);
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
      return;
    }
  }
  res.json({ ok: true });
});

/** 历史记录：从磁盘扫 runs/ 目录（事件流第一行=需求，末行=终态），服务重启也不丢。 */
app.get('/api/runs', (_req, res) => {
  const list: {
    runId: string;
    requirement: string;
    workflow: string;
    status: string;
    startedAt: number;
    latestScore: number | null;
  }[] = [];
  const runsRoot = join(process.cwd(), 'runs');
  let dirs: string[] = [];
  try {
    // 按目录 mtime（最后写入时间）倒序，再取前 200——不能直接 slice，
    // 否则 readdir 顺序是目录名顺序，会把今天的 run 切掉
    dirs = readdirSync(runsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(runsRoot, d.name, 'events.jsonl')))
      .map((d) => ({ name: d.name, mtime: statSync(join(runsRoot, d.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 200)
      .map((d) => d.name);
  } catch {
    /* 无 runs 目录 */
  }
  for (const runId of dirs) {
    try {
      const p = join(runsRoot, runId, 'events.jsonl');
      const raw = readFileSync(p, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length === 0) continue;
      const first = JSON.parse(lines[0]) as RunEvent;
      const last = JSON.parse(lines[lines.length - 1]) as RunEvent;
      const startPayload = first.payload as { requirement?: string; workflow?: string };
      let status = 'running';
      if (last.type === 'run.finished') status = 'done';
      else if (last.type === 'run.failed') status = 'failed';
      else if (last.type === 'run.interrupted') {
        status = (last.payload as { reason?: string }).reason === 'awaiting_human' ? 'awaiting_human' : 'paused';
      }
      let latestScore: number | null = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const e = JSON.parse(lines[i]) as RunEvent;
        if (e.type === 'verify.soft.verdict') {
          latestScore = (e.payload as { score?: number }).score ?? null;
          break;
        }
      }
      list.push({
        runId,
        requirement: String(startPayload.requirement ?? ''),
        workflow: String(startPayload.workflow ?? ''),
        status,
        startedAt: first.ts,
        latestScore,
      });
    } catch {
      /* 单条损坏跳过 */
    }
  }
  list.sort((a, b) => b.startedAt - a.startedAt);
  res.json(list);
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
  console.log(`模型: ${isDemoMode() ? '演示模式（无 Key，Fake LLM）' : [...providers.keys()].join('+')}`);
  console.log(`健康检查: http://localhost:${PORT}/api/health`);
});
