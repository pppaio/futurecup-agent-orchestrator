import type { AgentProfile } from '../types.js';
import { SAMPLE_GAME_HTML } from './sample-game.js';

export const BUILDER_PROFILE: AgentProfile = {
  id: 'builder',
  name: '生成者',
  version: '1.0.0',
  role_prompt:
    '你是前端游戏生成者。只产出单文件 HTML/JS（内联 CSS/JS），禁止任何外部资源引用（不能有 <script src> / <link href>）。输出一个 JSON 对象：{"title": string, "html": string}。',
  thinking_effort: 'high',
  model: { provider: 'deepseek', name: 'deepseek-v4-pro', temperature: 0.3 },
  capabilities: ['codegen'],
  tools: [],
  memory: { scope: 'run', retrieve_top_k: 4 },
  output_schema: 'HtmlArtifact',
  io: { inputs: ['spec'], outputs: ['artifact'] },
};
