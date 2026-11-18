import type { WorkflowDef } from '../types.js';

/**
 * 自主编排模式（自调用演示）：
 * 分析师（n1）输出「开发计划 plan（2~4 步）」→ 引擎按计划逐步编排 n2 子流程
 * （每一步 = 生成→硬验证→失败修复循环，逐步增量构建）→ 最终产物走与固定流水线相同的
 * 硬验证 → 软裁判 → 质量门控 → 打包 → 人工确认（可返工）。
 * 控制面仍是确定性的：LLM 只提供计划数据，步骤编排由引擎代码执行。
 */
export const AUTO_WF: WorkflowDef = {
  id: 'auto-plan-v1',
  name: '自主编排模式',
  nodes: [
    { id: 'n1', type: 'agent', agent: 'analyst', inputs: ['req'], outputs: ['spec'], note: 'plan' },
    { id: 'n2', type: 'subflow', subflow: 'step-pipeline', inputs: ['spec'], outputs: ['artifact'] },
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
    { from: 'n3', to: 'n5', when: 'fail' },
    { from: 'n5', to: 'n3', when: 'always', loop: { max_iters: 3 } },
    { from: 'n3', to: 'n4', when: 'pass' },
    { from: 'n4', to: 'n7', when: 'always' },
    { from: 'n7', to: 'n5', when: 'fail', loop: { max_iters: 5, on_exhaust: 'n6' } },
    { from: 'n7', to: 'n6', when: 'pass' },
    { from: 'n6', to: 'n9', when: 'always' },
    { from: 'n9', to: 'n8', when: 'fail', loop: { max_iters: 5 } },
    { from: 'n8', to: 'n3', when: 'always' },
  ],
  limits: { max_total_iters: 30, timeout_sec: 1800, max_concurrency: 4 },
  quality: { min_score: 4, max_iters: 5 },
};
