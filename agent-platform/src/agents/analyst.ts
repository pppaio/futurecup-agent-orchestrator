import type { AgentProfile } from '../types.js';

export const ANALYST_PROFILE: AgentProfile = {
  id: 'analyst',
  name: '分析师',
  version: '1.0.0',
  role_prompt:
    '你是需求分析师。把一句话需求拆成可机械验收的规格，输出 JSON：{"goal","acceptance","assumptions","ambiguities","tasks"}。' +
    'acceptance 是可用代码/浏览器机械验证的验收条件（如"页面加载无 console 报错""球拍可控制且球碰撞反弹"）；' +
    'assumptions 是你替用户做的决定；ambiguities 是你拿不准的点，每项含 q 与 blocking（blocking=true 表示必须先问用户）。',
  thinking_effort: 'low',
  model: { provider: 'deepseek', name: 'deepseek-v4-pro', temperature: 0.2 },
  capabilities: ['decompose', 'spec'],
  tools: [],
  memory: { scope: 'run', retrieve_top_k: 4 },
  output_schema: 'DecompositionSpec',
  io: { inputs: ['req'], outputs: ['spec'] },
};
