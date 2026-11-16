import { writeFileSync } from 'node:fs';
import type { LLMGateway } from '../gateway/llm.js';
import { Engine } from '../engine/engine.js';
import { EventStore } from '../event/store.js';
import { PlaywrightSandbox } from '../sandbox/sandbox.js';
import { SingleHtmlPackager } from '../packager/packager.js';
import { ALL_AGENTS } from '../agents/profiles.js';
import { GAME_GEN_WF } from '../workflows/game-gen.js';
import type { HardReport } from '../types.js';
import { DATASET, type BenchItem } from './dataset.js';

export interface BenchRow {
  id: string;
  category: string;
  ok: boolean;
  error_curve: string;
  fix_rounds: number;
  wall_ms: number;
}

export async function runBench(llm: LLMGateway, dataset: BenchItem[] = DATASET): Promise<BenchRow[]> {
  const store = new EventStore('runs');
  const rows: BenchRow[] = [];
  for (const item of dataset) {
    const engine = new Engine({
      llm,
      sandbox: new PlaywrightSandbox(),
      packager: new SingleHtmlPackager(),
      store,
      agents: ALL_AGENTS,
      humanGate: false, // 批量实验：人工确认点自动接受
    });
    const t0 = Date.now();
    const runId = engine.start(GAME_GEN_WF, { requirement: item.requirement });
    await engine.wait(runId);
    const wallMs = Date.now() - t0;
    const events = store.replay(runId);
    const errorCurve = events
      .filter((e) => e.type === 'verify.hard.result')
      .map((e) => (e.payload as unknown as HardReport).errors.length);
    const ok = events.some((e) => e.type === 'run.finished');
    const fixRounds = events.filter((e) => e.type === 'node.entered' && e.node_id === 'n5').length;
    rows.push({
      id: item.id,
      category: item.category,
      ok,
      error_curve: `[${errorCurve.join(',')}]`,
      fix_rounds: fixRounds,
      wall_ms: wallMs,
    });
    console.log(
      `${item.id.padEnd(3)} ${item.category.padEnd(8)} ok=${ok} fix=${fixRounds} curve=[${errorCurve.join(',')}] ${wallMs}ms`,
    );
  }
  return rows;
}

export function writeCsv(rows: BenchRow[], path: string): void {
  const header = 'id,category,ok,error_curve,fix_rounds,wall_ms';
  const lines = rows.map((r) => [r.id, r.category, r.ok, r.error_curve, r.fix_rounds, r.wall_ms].join(','));
  writeFileSync(path, [header, ...lines].join('\n'), 'utf8');
}
