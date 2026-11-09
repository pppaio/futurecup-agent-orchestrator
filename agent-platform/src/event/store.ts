import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RunEvent, RunId } from '../types.js';

/** append-only 事件存储：一条 JSON 一行，事件流是唯一事实来源。 */
export class EventStore {
  private dir: string;

  constructor(dir = 'runs') {
    this.dir = dir;
    mkdirSync(this.dir, { recursive: true });
  }

  runDir(runId: RunId): string {
    const d = join(this.dir, runId);
    mkdirSync(d, { recursive: true });
    return d;
  }

  append(e: RunEvent): void {
    const line = JSON.stringify(e) + '\n';
    appendFileSync(join(this.runDir(e.run_id), 'events.jsonl'), line, 'utf8');
  }

  replay(runId: RunId): RunEvent[] {
    const p = join(this.runDir(runId), 'events.jsonl');
    if (!existsSync(p)) return [];
    return readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as RunEvent);
  }
}
