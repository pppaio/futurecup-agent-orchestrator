import { EventStore } from './event/store.js';
import { Engine } from './engine/engine.js';
import { PlaywrightSandbox } from './sandbox/sandbox.js';
import { SingleHtmlPackager } from './packager/packager.js';
import { ALL_AGENTS } from './agents/profiles.js';
import { GAME_GEN_WF } from './workflows/game-gen.js';
import type { LLMGateway, LLMMessage, LLMResult } from './gateway/llm.js';
import type { AgentProfile } from './types.js';

/** 慢网关：模拟一次 30 秒的模型调用；收到中断信号立即中止。 */
class SlowLLM implements LLMGateway {
  async complete(opts: { agent: AgentProfile; messages: LLMMessage[]; json?: boolean; signal?: AbortSignal }): Promise<LLMResult> {
    await new Promise<void>((_resolve, reject) => {
      const t = setTimeout(() => reject(new Error('意外等到 30s')), 30_000);
      opts.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new DOMException('aborted', 'AbortError'));
        },
        { once: true },
      );
      // 永不 resolve：只有中断能结束
    });
    throw new Error('unreachable');
  }
}

async function main() {
  const store = new EventStore('runs');
  const engine = new Engine({
    llm: new SlowLLM(),
    sandbox: new PlaywrightSandbox(),
    packager: new SingleHtmlPackager(),
    store,
    agents: ALL_AGENTS,
    humanGate: false,
  });
  const runId = engine.start(GAME_GEN_WF, { requirement: '做个能玩的打砖块' });
  await new Promise((r) => setTimeout(r, 500)); // 等分析师进入 30s 的慢调用
  const t0 = Date.now();
  engine.interrupt(runId); // 应该立即中止在途调用
  await Promise.race([engine.wait(runId), new Promise((_, rej) => setTimeout(() => rej(new Error('中断超时')), 10_000))]);
  const dt = Date.now() - t0;
  const events = store.replay(runId);
  const paused = events.some((e) => e.type === 'run.interrupted');
  console.log(`中断到暂停耗时: ${dt}ms`);
  console.log(paused ? '✅ 快速中断生效（30 秒的在途调用被立即中止）' : '⚠️ 未进入暂停态');
  if (dt > 3000 || !paused) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
