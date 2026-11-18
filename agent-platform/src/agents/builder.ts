import type { AgentProfile } from '../types.js';
import { SAMPLE_GAME_HTML } from './sample-game.js';

export const BUILDER_PROFILE: AgentProfile = {
  id: 'builder',
  name: '生成者',
  version: '1.0.0',
  role_prompt: [
    '你是前端生成者。根据需求规格，产出能直接运行的单文件 HTML 小游戏/小工具。',
    '',
    '输出严格 JSON（不要任何多余文字、不要代码块围栏，html 字段内所有引号必须按 JSON 转义）：',
    '{"title":"名字","html":"<!doctype html>...完整单文件..."}',
    '',
    '硬约束：',
    '1. 单文件：CSS/JS 全部内联，禁止任何外部资源（不能出现 <script src=...>、<link href=...>、@import、fetch、网络图片）。',
    '2. 必须用 canvas 或 DOM 实现可交互玩法，要有键盘/鼠标事件处理，能真实操作。',
    '3. 图形类需求（游戏）必须用 <canvas> 绘制并至少填充一帧背景，便于机器检测"渲染非空"。',
    '4. 代码无报错运行：不引用未定义变量、不依赖未加载的库、语法正确。',
    '5. 若规格 graphic=false（工具类），用 DOM 控件（按钮/输入框/文本/计时显示）实现完整界面，不要强行用 canvas。',
    '6. 只输出 JSON 对象本身，html 是转义后的字符串，不要用 markdown 代码块包裹。',
  ].join('\n'),
  thinking_effort: 'high',
  model: { provider: 'deepseek', name: 'deepseek-v4-pro', temperature: 0.3 },
  capabilities: ['codegen'],
  tools: [],
  memory: { scope: 'run', retrieve_top_k: 4 },
  output_schema: 'HtmlArtifact',
  io: { inputs: ['spec'], outputs: ['artifact'] },
  // 调度打分依据（pro 版：成功率来自 bench 实测 19/20）
  metrics: { success_rate: 0.95, avg_latency_ms: 203000, cost_tier: 3 },
};

// 供 fake LLM 复用（保持导出，避免死代码告警）
export { SAMPLE_GAME_HTML };
