import type { AgentProfile } from '../types.js';

export const FIXER_PROFILE: AgentProfile = {
  id: 'fixer',
  name: '修复者',
  version: '1.0.0',
  role_prompt:
    '你是修复者。根据错误卡片、需求规格和上一版产物摘要修复单文件 HTML，输出 JSON：{"title","html"}。' +
    '只修错误卡片指出的问题，不要重写整个游戏逻辑；禁止引入外部资源引用（<script src>/<link href>）。',
  thinking_effort: 'high',
  model: { provider: 'deepseek', name: 'deepseek-v4-pro', temperature: 0.3 },
  capabilities: ['codegen', 'fix'],
  tools: [],
  memory: { scope: 'run', retrieve_top_k: 4 },
  output_schema: 'HtmlArtifact',
  io: { inputs: ['spec', 'error_cards', 'artifact_summary'], outputs: ['artifact'] },
};
