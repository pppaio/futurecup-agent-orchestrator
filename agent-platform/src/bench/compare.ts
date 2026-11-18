import { writeFileSync } from 'node:fs';
import type { LLMGateway } from '../gateway/llm.js';
import { Engine } from '../engine/engine.js';
import { EventStore } from '../event/store.js';
import { PlaywrightSandbox } from '../sandbox/sandbox.js';
import { SingleHtmlPackager } from '../packager/packager.js';
import { ALL_AGENTS } from '../agents/profiles.js';
import { GAME_GEN_WF } from '../workflows/game-gen.js';
import { S1_SERIAL_WF, S2_NO_GATE_WF } from '../workflows/strategies.js';
import type { WorkflowDef, HardReport, RunEvent } from '../types.js';
import { DATASET, HARD_DATASET, type BenchItem } from './dataset.js';

export interface StrategyRow {
  strategy: string;
  total: number;
  runnable: number;
  rate: string;
  avg_first_errors: string;
}

const STRATEGIES: { name: string; wf: WorkflowDef }[] = [
  { name: 'S1 串行单Agent(基线)', wf: S1_SERIAL_WF },
  { name: 'S2 多Agent无核验', wf: S2_NO_GATE_WF },
  { name: 'S3 本方案(核验+修复)', wf: GAME_GEN_WF },
];

/** 从 builder 的 assistant 事件里提取产物 HTML（S1/S2 无内置核验，用于事后统一度量）。 */
function extractBuilderHtml(events: RunEvent[]): string | null {
  const msg = events.find(
    (e) => e.type === 'agent.message' && e.agent_id === 'builder' && (e.payload as { role?: string }).role === 'assistant',
  );
  if (!msg) return null;
  try {
    const parsed = JSON.parse((msg.payload as { text: string }).text) as { html?: string };
    return parsed.html ?? null;
  } catch {
    return null;
  }
}

/** 从事后度量用：从 analyst 的 assistant 事件里提取规格（含 graphic 声明）。 */
function extractAnalystSpec(events: RunEvent[]): { graphic?: boolean } | null {
  const msg = events.find(
    (e) => e.type === 'agent.message' && e.agent_id === 'analyst' && (e.payload as { role?: string }).role === 'assistant',
  );
  if (!msg) return null;
  try {
    return JSON.parse((msg.payload as { text: string }).text) as { graphic?: boolean };
  } catch {
    return null;
  }
}

/** 三策略对比：同一批样本、同一"能否通过 L1 硬验证"的口径。limit 用于控成本/时间的子集实验；dataset 可换成难样本组。 */
export async function runCompare(
  llm: LLMGateway,
  limit = DATASET.length,
  dataset: BenchItem[] = DATASET,
): Promise<StrategyRow[]> {
  const store = new EventStore('runs');
  const sandbox = new PlaywrightSandbox();
  const rows: StrategyRow[] = [];
  const subset = dataset.slice(0, limit);

  for (const s of STRATEGIES) {
    let runnable = 0;
    let totalFirstErrors = 0;
    let verifyCount = 0;
    for (const item of subset) {
      const engine = new Engine({
        llm,
        sandbox,
        packager: new SingleHtmlPackager(),
        store,
        agents: ALL_AGENTS,
        humanGate: false, // 批量实验：歧义不停机
      });
      const runId = engine.start(s.wf, { requirement: item.requirement });
      await engine.wait(runId);
      const events = store.replay(runId);
      const verifyEvents = events.filter((e) => e.type === 'verify.hard.result');

      let ok = false;
      if (verifyEvents.length > 0) {
        // S3：内置硬验证门控，run.finished = 最终通过
        ok = events.some((e) => e.type === 'run.finished');
        totalFirstErrors += (verifyEvents[0].payload as unknown as HardReport).errors.length;
        verifyCount++;
      } else {
        // S1/S2：无核验，事后用同一沙箱度量"能不能跑"（按规格 graphic 选择判定）
        const html = extractBuilderHtml(events);
        if (html) {
          const spec = extractAnalystSpec(events);
          const report = await sandbox.run(html, { timeoutMs: 15000, requireCanvas: spec?.graphic ?? true });
          ok = report.ok;
          totalFirstErrors += report.errors.length;
          verifyCount++;
        }
      }
      if (ok) runnable++;
    }
    rows.push({
      strategy: s.name,
      total: subset.length,
      runnable,
      rate: `${Math.round((runnable / subset.length) * 100)}%`,
      avg_first_errors: verifyCount ? (totalFirstErrors / verifyCount).toFixed(1) : '-',
    });
  }
  return rows;
}

export function writeCompareCsv(rows: StrategyRow[], path: string): void {
  const header = 'strategy,total,runnable,rate,avg_first_errors';
  const lines = rows.map((r) => [r.strategy, r.total, r.runnable, r.rate, r.avg_first_errors].join(','));
  writeFileSync(path, [header, ...lines].join('\n'), 'utf8');
}
