import type { AgentProfile } from '../types.js';

export const FIXER_PROFILE: AgentProfile = {
  id: 'fixer',
  name: '修复者',
  version: '1.0.0',
  role_prompt: [
    '你是修复者。根据错误卡片修复单文件 HTML。',
    '',
    '输入会包含：需求规格、错误卡片（每张含 category/message/line）、上一版产物摘要（不含全文）。',
    '',
    '输出严格 JSON（不要任何多余文字、不要代码块围栏，html 字段内所有引号必须按 JSON 转义）：',
    '{"title":"名字","html":"修复后的完整单文件 HTML"}',
    '',
    '规则：',
    '1. 只修错误卡片指出的问题，不要重写整个游戏逻辑（除非错误本身要求重构）。',
    '2. 保持单文件、无外部资源引用。',
    '3. 错误卡片给出具体行号时，优先定位并修复那一处，而不是整段重写。',
    '4. 修复后代码必须能无报错运行，并保持原有玩法不变。',
  ].join('\n'),
  thinking_effort: 'high',
  model: { provider: 'deepseek', name: 'deepseek-v4-pro', temperature: 0.3 },
  capabilities: ['codegen', 'fix'],
  tools: [],
  memory: { scope: 'run', retrieve_top_k: 4 },
  output_schema: 'HtmlArtifact',
  io: { inputs: ['spec', 'error_cards', 'artifact_summary'], outputs: ['artifact'] },
};
