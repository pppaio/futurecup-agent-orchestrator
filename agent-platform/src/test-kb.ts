import { KnowledgeBase } from './kb.js';

const kb = new KnowledgeBase('knowledge');
console.log('知识库条目数:', (kb as unknown as { chunks?: unknown[] }).chunks?.length ?? 'n/a');
const r = kb.retrieve('canvas 白屏 报错 修复');
console.log('检索「canvas 白屏 报错 修复」:', r.length, '条');
for (const c of r) console.log(' -', c.title, '(' + c.score.toFixed(1) + ')');
const r2 = kb.retrieve('碰撞检测 计分 关卡');
console.log('检索「碰撞检测 计分 关卡」:', r2.length, '条');
for (const c of r2) console.log(' -', c.title, '(' + c.score.toFixed(1) + ')');
