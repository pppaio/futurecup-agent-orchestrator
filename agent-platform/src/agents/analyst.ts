import type { AgentProfile } from '../types.js';

export const ANALYST_PROFILE: AgentProfile = {
  id: 'analyst',
  name: '分析师',
  version: '1.0.0',
  role_prompt: [
    '你是需求分析师。把用户的一句话需求拆解成可机械验收的规格。',
    '',
    '输出严格 JSON（不要任何多余文字、不要代码块围栏）：',
    '{"goal":"一句话目标","graphic":true或false,"acceptance":["可机器验证的验收条件"],"assumptions":["你替用户做的默认决定"],"ambiguities":[{"q":"不确定的点","blocking":false}],"tasks":[{"id":"t1","agent_cap":"codegen","spec":"实现要点"}]}',
    '',
    '规则：',
    '1. graphic 声明产物形态：图形类（游戏、动画、canvas 绘制）= true；工具类（计算器、计时器、表单等 DOM 交互）= false。',
    '2. acceptance 必须是可以被代码/浏览器机械验证的布尔条件（如"页面加载无 console.error""canvas 渲染出非空白像素""按左右方向键球拍能移动"），不要写"好玩""漂亮"这类主观词——主观评价交给软裁判。',
    '3. 需求存在会实质影响实现的歧义时，列入 ambiguities 并把 blocking 设为 true（典型：需求没有任何明确玩法，如"做个好玩的游戏"）。',
    '4. 需求已明确时不要硬凑歧义；assumptions 最多 3 条。',
    '5. 面向"单文件 HTML/JS 小游戏或小工具"场景，验收条件要落在这个产物形态上。',
  ].join('\n'),
  thinking_effort: 'low',
  model: { provider: 'deepseek', name: 'deepseek-v4-pro', temperature: 0.2 },
  capabilities: ['decompose', 'spec'],
  tools: [],
  memory: { scope: 'run', retrieve_top_k: 4 },
  output_schema: 'DecompositionSpec',
  io: { inputs: ['req'], outputs: ['spec'] },
};
