import type { WorkflowDef } from '../types.js';

/**
 * 小游戏生成闭环 v2：
 * 分析 → 生成 → 硬验证（失败回灌修复 ≤3 轮）→ 软裁判打分 → 质量门控（低分自动返工 ≤2 轮）
 * → 打包（版本化）→ 人工确认点（接受 / 返工附指令，≤5 轮）。
 */
export const GAME_GEN_WF: WorkflowDef = {
  id: 'game-gen-v2',
  name: '小游戏生成闭环',
  nodes: [
    { id: 'n1', type: 'agent', agent: 'analyst', inputs: ['req'], outputs: ['spec'] },
    { id: 'n2', type: 'agent', agent: 'builder', candidates: ['builder', 'builder-flash'], inputs: ['spec'], outputs: ['artifact'] },
    { id: 'n3', type: 'verify', verifier: 'hard-sandbox', inputs: ['artifact', 'spec'], outputs: ['hard_report'] },
    { id: 'n4', type: 'agent', agent: 'critic', inputs: ['artifact', 'spec'], outputs: ['soft_report'] },
    { id: 'n7', type: 'gate', gate: 'quality', inputs: ['soft_report'], outputs: ['gate_result'] },
    { id: 'n5', type: 'agent', agent: 'fixer', inputs: ['spec', 'error_cards', 'quality_cards', 'artifact_summary'], outputs: ['artifact'] },
    { id: 'n6', type: 'packager', packager: 'single-html', inputs: ['artifact'], outputs: ['bundle'] },
    { id: 'n8', type: 'agent', agent: 'reviser', inputs: ['artifact', 'instruction', 'error_cards', 'quality_cards'], outputs: ['artifact'] },
    { id: 'n9', type: 'human', note: '人工确认点：接受交付 / 输入修改指令返工' },
  ],
  edges: [
    { from: 'n1', to: 'n2', when: 'always' },
    { from: 'n2', to: 'n3', when: 'always' },
    { from: 'n3', to: 'n5', when: 'fail' },                       // 硬验证失败 → 修复者
    { from: 'n5', to: 'n3', when: 'always', loop: { max_iters: 3 } }, // 硬修复循环（看门狗把关）
    { from: 'n3', to: 'n4', when: 'pass' },                       // 通过才打分
    { from: 'n4', to: 'n7', when: 'always' },                     // 质量门控
    { from: 'n7', to: 'n5', when: 'fail', loop: { max_iters: 5, on_exhaust: 'n6' } }, // 低分自动返工（自循环至收敛，≤5 轮）；耗尽仍打包（带缺陷交付）
    { from: 'n7', to: 'n6', when: 'pass' },                       // 达标 → 打包
    { from: 'n6', to: 'n9', when: 'always' },                     // 人工确认点
    { from: 'n9', to: 'n8', when: 'fail', loop: { max_iters: 5 } }, // 人工返工：修改者
    { from: 'n8', to: 'n3', when: 'always' },                     // 修改后重新走验证
  ],
  limits: { max_total_iters: 20, timeout_sec: 900, max_concurrency: 4 },
  quality: { min_score: 4, max_iters: 5 },
};
