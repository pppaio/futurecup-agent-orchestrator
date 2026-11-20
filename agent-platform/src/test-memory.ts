import { mkdirSync, rmSync } from 'node:fs';
import { MemoryStore } from './memory.js';

/** 验证跨运行记忆：写入教训 → 相似错误检索命中。 */
function main() {
  const dir = 'runs/memory-test';
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const m = new MemoryStore(dir);
  m.add({ error: "Cannot read properties of undefined (reading 'y')", rounds: 1, success: true, at: Date.now() });
  m.add({ error: 'canvas 白屏无像素', rounds: 2, success: true, at: Date.now() });
  const r = m.retrieve('Cannot read properties of undefined');
  console.log('检索命中:', r.length, '条 →', r[0]?.error.slice(0, 40));
  const ok = r.length >= 1;
  console.log(ok ? '✅ 跨运行记忆存取/检索跑通' : '⚠️ 未命中');
  if (!ok) process.exitCode = 1;
}
main();
