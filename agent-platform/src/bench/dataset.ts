export interface BenchItem {
  id: string;
  category: string;
  requirement: string;
}

/** 20 条样本：5 类 × 4 条，覆盖不同复杂度（对应需求规格书 §8.1）。 */
export const DATASET: BenchItem[] = [
  // 经典玩法复刻
  { id: 'c1', category: '经典玩法复刻', requirement: '做个能玩的打砖块' },
  { id: 'c2', category: '经典玩法复刻', requirement: '做个贪吃蛇游戏' },
  { id: 'c3', category: '经典玩法复刻', requirement: '做个俄罗斯方块' },
  { id: 'c4', category: '经典玩法复刻', requirement: '做个扫雷小游戏' },
  // 机制微创新
  { id: 'm1', category: '机制微创新', requirement: '俄罗斯方块但每个方块有不同重力' },
  { id: 'm2', category: '机制微创新', requirement: '贪吃蛇但吃到道具会加速' },
  { id: 'm3', category: '机制微创新', requirement: '打砖块但球碰到板会分裂成两个' },
  { id: 'm4', category: '机制微创新', requirement: '2048 但每步随机插入负数格子' },
  // 交互小工具
  { id: 't1', category: '交互小工具', requirement: '番茄钟，带进度环' },
  { id: 't2', category: '交互小工具', requirement: '简易计算器，支持键盘输入' },
  { id: 't3', category: '交互小工具', requirement: '倒计时器，可设置分钟' },
  { id: 't4', category: '交互小工具', requirement: '单位换算器，支持长度和重量' },
  // 多维需求
  { id: 'd1', category: '多维需求', requirement: '记忆翻牌，含计分、计时、难度切换' },
  { id: 'd2', category: '多维需求', requirement: '打砖块，含生命值、道具、关卡进度' },
  { id: 'd3', category: '多维需求', requirement: '贪吃蛇，含排行榜和速度调节' },
  { id: 'd4', category: '多维需求', requirement: '井字棋，含人机对战和悔棋' },
  // 边界/歧义
  { id: 'e1', category: '边界/歧义', requirement: '做个好玩的游戏' },
  { id: 'e2', category: '边界/歧义', requirement: '做个工具' },
  { id: 'e3', category: '边界/歧义', requirement: '随便做点什么' },
  { id: 'e4', category: '边界/歧义', requirement: '做一个应用' },
];
