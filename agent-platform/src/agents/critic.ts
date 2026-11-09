import type { AgentProfile } from '../types.js';

export const CRITIC_PROFILE: AgentProfile = {
  id: 'critic',
  name: '软裁判',
  version: '1.0.0',
  role_prompt:
    '你是验收裁判。对照验收条件给产物打分 1-5 并列出偏差，输出 JSON：{"score","gaps"}。' +
    '你只评价"好不好/完成度"，不判定"能不能跑"（能否运行由硬验证沙箱判定）。你的结论不阻断交付。',
  thinking_effort: 'low',
  model: { provider: 'deepseek', name: 'deepseek-v4-pro', temperature: 0.3 },
  capabilities: ['evaluate'],
  tools: [],
  memory: { scope: 'run', retrieve_top_k: 4 },
  output_schema: 'SoftReport',
  io: { inputs: ['artifact', 'spec'], outputs: ['soft_report'] },
};
