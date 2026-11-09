import type { WorkflowDef } from '../types.js';

/** S1 串行基线：分析 → 生成，无核验、无修复。 */
export const S1_SERIAL_WF: WorkflowDef = {
  id: 's1-serial',
  name: 'S1 串行单Agent（基线）',
  nodes: [
    { id: 'n1', type: 'agent', agent: 'analyst', inputs: ['req'], outputs: ['spec'] },
    { id: 'n2', type: 'agent', agent: 'builder', inputs: ['spec'], outputs: ['artifact'] },
  ],
  edges: [{ from: 'n1', to: 'n2', when: 'always' }],
  limits: { max_total_iters: 6, timeout_sec: 900, max_concurrency: 4 },
};

/** S2 多 Agent 无核验：分析 → 生成 → 软裁判，无硬验证、无修复。 */
export const S2_NO_GATE_WF: WorkflowDef = {
  id: 's2-no-gate',
  name: 'S2 多Agent无核验',
  nodes: [
    { id: 'n1', type: 'agent', agent: 'analyst', inputs: ['req'], outputs: ['spec'] },
    { id: 'n2', type: 'agent', agent: 'builder', inputs: ['spec'], outputs: ['artifact'] },
    { id: 'n3', type: 'agent', agent: 'critic', inputs: ['artifact', 'spec'], outputs: ['soft_report'] },
  ],
  edges: [
    { from: 'n1', to: 'n2', when: 'always' },
    { from: 'n2', to: 'n3', when: 'always' },
  ],
  limits: { max_total_iters: 6, timeout_sec: 900, max_concurrency: 4 },
};
