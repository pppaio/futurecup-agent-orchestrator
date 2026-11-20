import { EventStore } from '../event/store.js';
import { FakeLLM } from '../gateway/llm.js';
import { Engine } from '../engine/engine.js';
import { PlaywrightSandbox } from '../sandbox/sandbox.js';
import { SingleHtmlPackager } from '../packager/packager.js';
import { ALL_AGENTS } from '../agents/profiles.js';
import type { WorkflowDef } from '../types.js';
import { SAMPLE_GAME_HTML } from '../agents/sample-game.js';

/**
 * 并发性能测试（零成本演示模式）：4 个并行的硬验证节点跑同一产物，
 * 对比 max_concurrency = 1（串行）与 4（并行）的墙钟时间。
 */
const CONCURRENCY_WF: WorkflowDef = {
  id: 'concurrency-test',
  name: '并发测试（4 个并行验证）',
  nodes: [
    { id: 'v1', type: 'verify', verifier: 'hard-sandbox', inputs: ['artifact'], outputs: ['r1'] },
    { id: 'v2', type: 'verify', verifier: 'hard-sandbox', inputs: ['artifact'], outputs: ['r2'] },
    { id: 'v3', type: 'verify', verifier: 'hard-sandbox', inputs: ['artifact'], outputs: ['r3'] },
    { id: 'v4', type: 'verify', verifier: 'hard-sandbox', inputs: ['artifact'], outputs: ['r4'] },
  ],
  edges: [],
  limits: { max_total_iters: 6, timeout_sec: 900, max_concurrency: 4 },
};

async function main() {
  const store = new EventStore('runs');
  const fake = new FakeLLM({});
  const seed = { artifact: { title: '打砖块', html: SAMPLE_GAME_HTML } };

  async function bench(maxConcurrency: number, rounds: number): Promise<number[]> {
    const times: number[] = [];
    for (let i = 0; i < rounds; i++) {
      const engine = new Engine({
        llm: fake,
        sandbox: new PlaywrightSandbox(),
        packager: new SingleHtmlPackager(),
        store,
        agents: ALL_AGENTS,
        humanGate: false,
      });
      const wf: WorkflowDef = {
        ...CONCURRENCY_WF,
        limits: { ...CONCURRENCY_WF.limits, max_concurrency: maxConcurrency },
      };
      const t0 = Date.now();
      const runId = engine.start(wf, { requirement: '并发测试' }, { seed });
      await engine.wait(runId);
      times.push(Date.now() - t0);
    }
    return times;
  }

  const serial = await bench(1, 3);
  const parallel = await bench(4, 3);
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  console.log(`串行(max_concurrency=1): ${serial.join(', ')} ms · 均值 ${avg(serial)} ms`);
  console.log(`并行(max_concurrency=4): ${parallel.join(', ')} ms · 均值 ${avg(parallel)} ms`);
  const speedup = (avg(serial) / Math.max(1, avg(parallel))).toFixed(2);
  console.log(`加速比: ${speedup}x`);
  const ok = avg(parallel) < avg(serial);
  console.log(ok ? `✅ 并发批处理生效（并行快于串行 ${speedup}x）` : '⚠️ 并行未见收益');
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
