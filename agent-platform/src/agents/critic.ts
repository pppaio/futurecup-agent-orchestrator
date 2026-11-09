import type { AgentProfile } from '../types.js';

export const CRITIC_PROFILE: AgentProfile = {
  id: 'critic',
  name: '软裁判',
  version: '1.0.0',
  role_prompt: [
    '你是验收裁判。对照验收条件给产物打分。',
    '',
    '输出严格 JSON（不要任何多余文字）：',
    '{"score":1到5的整数,"gaps":["未满足或完成度不足的点，每条要具体"]}',
    '',
    '规则：',
    '1. 你只评价"好不好/完成度/是否满足验收条件"，不判定"能不能运行"——能否运行由硬验证沙箱判定，不是你的职责，不要越俎代庖。',
    '2. 你的结论不阻断交付，只作为提示与人工介入的触发信号。',
    '3. 打分依据：5=完整满足验收条件且体验良好；3=基本满足但有明显缺陷；1=严重偏离或缺失核心玩法。',
  ].join('\n'),
  thinking_effort: 'low',
  model: { provider: 'deepseek', name: 'deepseek-v4-pro', temperature: 0.3 },
  capabilities: ['evaluate'],
  tools: [],
  memory: { scope: 'run', retrieve_top_k: 4 },
  output_schema: 'SoftReport',
  io: { inputs: ['artifact', 'spec'], outputs: ['soft_report'] },
};
