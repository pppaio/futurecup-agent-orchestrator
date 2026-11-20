import { EventStore } from './event/store.js';
import { FakeLLM } from './gateway/llm.js';
import { Engine } from './engine/engine.js';
import { PlaywrightSandbox } from './sandbox/sandbox.js';
import { SingleHtmlPackager } from './packager/packager.js';
import { ALL_AGENTS } from './agents/profiles.js';
import { GAME_GEN_WF } from './workflows/game-gen.js';
import { MemoryStore } from './memory.js';
import { SAMPLE_GAME_HTML } from './agents/sample-game.js';
import { SAMPLE_BROKEN_HTML } from './agents/sample-broken.js';

/**
 * 验证跨运行记忆注入：第一次运行（坏产物→修复成功）写入教训，
 * 第二次运行修复者应收到「历史经验」提示。
 */
async function main() {
  const store = new EventStore('runs');
  const memory = new MemoryStore('runs');
  const good = JSON.stringify({ title: '打砖块', html: SAMPLE_GAME_HTML });
  const fake = new FakeLLM({
    analyst: () =>
      JSON.stringify({ goal: '可玩的打砖块', graphic: true, acceptance: ['无报错', 'canvas 非空'], assumptions: [], ambiguities: [], tasks: [] }),
    builder: () => JSON.stringify({ title: 'broken', html: SAMPLE_BROKEN_HTML }),
    critic: () => JSON.stringify({ score: 5, gaps: [] }),
    fixer: () => good,
  });
  const engine = new Engine({
    llm: fake,
    sandbox: new PlaywrightSandbox(),
    packager: new SingleHtmlPackager(),
    store,
    agents: ALL_AGENTS,
    humanGate: false,
    memory,
  });

  const runOnce = async () => {
    const runId = engine.start(GAME_GEN_WF, { requirement: '做个能玩的打砖块' });
    await engine.wait(runId);
    return store.replay(runId);
  };

  await runOnce(); // 第一次：记录教训
  const events2 = await runOnce(); // 第二次：修复者应收到历史经验
  const injected = events2.some(
    (e) => e.type === 'agent.message' && e.agent_id === 'fixer' && String((e.payload as { text?: string }).text ?? '').includes('[历史经验]'),
  );
  console.log('第二次运行修复者收到历史经验:', injected);
  console.log(injected ? '✅ 跨运行记忆注入跑通（教训跨运行传递）' : '⚠️ 未注入');
  if (!injected) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
