import type { AgentProfile } from '../types.js';

export const BUILDER_FLASH_PROFILE: AgentProfile = {
  id: 'builder-flash',
  name: '生成者·快速版',
  version: '1.0.0',
  role_prompt: [
    '你是前端生成者（快速版）。根据需求规格，产出能直接运行的单文件 HTML 小游戏/小工具。',
    '',
    '输出严格 JSON（不要任何多余文字、不要代码块围栏，html 字段内所有引号必须按 JSON 转义）：',
    '{"title":"名字","html":"<!doctype html>...完整单文件..."}',
    '',
    '硬约束：',
    '1. 单文件：CSS/JS 全部内联，禁止任何外部资源（<script src>、<link href>、@import、fetch、网络图片）。',
    '2. 必须用 canvas 或 DOM 实现可交互玩法，有键盘/鼠标事件处理。',
    '3. 图形类需求用 <canvas> 绘制并填充一帧背景；工具类（graphic=false）用 DOM 控件。',
    '4. 代码无报错运行。',
    '5. 只输出 JSON 对象本身，html 是转义后的字符串。',
  ].join('\n'),
  thinking_effort: 'medium',
  model: { provider: 'deepseek', name: 'deepseek-flash', temperature: 0.3 },
  capabilities: ['codegen'],
  tools: [],
  memory: { scope: 'run', retrieve_top_k: 4 },
  output_schema: 'HtmlArtifact',
  io: { inputs: ['spec'], outputs: ['artifact'] },
  // 调度打分依据（fast 版：更快更便宜，但成功率略低——估值，见方案书口径）
  metrics: { success_rate: 0.85, avg_latency_ms: 60000, cost_tier: 1 },
};
