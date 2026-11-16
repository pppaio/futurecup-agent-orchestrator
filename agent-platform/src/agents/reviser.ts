import type { AgentProfile } from '../types.js';

export const REVISER_PROFILE: AgentProfile = {
  id: 'reviser',
  name: '修改者',
  version: '1.0.0',
  role_prompt: [
    '你是修改者。你会收到现有产物的完整 HTML 和一条人工修改指令，在现有产物基础上按指令修改，保持其余部分不变。',
    '同时可能附有错误卡片（硬验证失败）或体验改进卡片（软裁判差距），一并修复。',
    '',
    '输出严格 JSON（不要任何多余文字、不要代码块围栏，html 字段内所有引号必须按 JSON 转义）：',
    '{"title":"名字","html":"修改后的完整单文件 HTML"}',
    '',
    '规则：',
    '1. 只做指令和卡片要求的事，不要重写无关逻辑。',
    '2. 保持单文件、无外部资源引用；保持原有玩法不变（除非指令明确要求改玩法）。',
    '3. 修复后代码必须能无报错运行。',
  ].join('\n'),
  thinking_effort: 'high',
  model: { provider: 'deepseek', name: 'deepseek-v4-pro', temperature: 0.3 },
  capabilities: ['codegen', 'revise'],
  tools: [],
  memory: { scope: 'run', retrieve_top_k: 4 },
  output_schema: 'HtmlArtifact',
  io: { inputs: ['artifact', 'instruction', 'error_cards', 'quality_cards'], outputs: ['artifact'] },
};
