import type { WorkflowDef } from '../types.js';

/** 小游戏生成闭环：分析 → 生成 → 硬验证(失败回灌修复，≤3 轮) → 打包 → 人工确认。 */
export const GAME_GEN_WF: WorkflowDef = {
  id: 'game-gen-v1',
  name: '小游戏生成闭环',
  nodes: [
    { id: 'n1', type: 'agent', agent: 'analyst', inputs: ['req'], outputs: ['spec'] },
    { id: 'n2', type: 'agent', agent: 'builder', inputs: ['spec'], outputs: ['artifact'] },
    { id: 'n3', type: 'verify', verifier: 'hard-sandbox', inputs: ['artifact'], outputs: ['hard_report'] },
    { id: 'n4', type: 'agent', agent: 'critic', inputs: ['artifact', 'spec'], outputs: ['soft_report'] },
    { id: 'n5', type: 'agent', agent: 'fixer', inputs: ['spec', 'error_cards', 'artifact_summary'], outputs: ['artifact'] },
    { id: 'n6', type: 'packager', packager: 'single-html', inputs: ['artifact'], outputs: ['bundle'] },
    { id: 'n7', type: 'human', note: '人工确认点' },
  ],
  edges: [
    { from: 'n1', to: 'n2', when: 'always' },
    { from: 'n2', to: 'n3', when: 'always' },
    { from: 'n2', to: 'n4', when: 'always', parallel: true },
    { from: 'n3', to: 'n5', when: 'fail' },
    { from: 'n5', to: 'n3', when: 'always', loop: { max_iters: 3 } },
    { from: 'n3', to: 'n6', when: 'pass' },
    { from: 'n6', to: 'n7', when: 'always' },
  ],
  limits: { max_total_iters: 6, timeout_sec: 900, max_concurrency: 4 },
};
