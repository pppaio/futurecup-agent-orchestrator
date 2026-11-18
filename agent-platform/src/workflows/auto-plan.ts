import type { WorkflowDef } from '../types.js';

/**
 * 自主编排模式 v3（自调用 + 评分循环语义）：
 * 分析师输出「开发计划 plan」→ 引擎逐步编排子流程（每步=生成→验证→修复）→
 * 软裁判评分 → 质量门控：不满分 → 打包版本留痕 → 问题抛回分析师重新计划 → 再编排，
 * 直到满分或轮次耗尽 → 交付打包 → 人工确认。
 * 控制面确定性：LLM 只提供计划数据，步骤编排由引擎代码执行。
 */
export const AUTO_WF: WorkflowDef = {
  id: 'auto-plan-v2',
  name: '自主编排模式',
  entry: 'n1',
  nodes: [
    { id: 'n1', type: 'agent', agent: 'analyst', inputs: ['req', 'quality_cards'], outputs: ['spec'], note: 'plan replan' },
    { id: 'n2', type: 'subflow', subflow: 'step-pipeline', inputs: ['spec'], outputs: ['artifact'] },
    { id: 'n3', type: 'verify', verifier: 'hard-sandbox', inputs: ['artifact', 'spec'], outputs: ['hard_report'] },
    { id: 'n4', type: 'agent', agent: 'critic', inputs: ['artifact', 'spec'], outputs: ['soft_report'] },
    { id: 'n7', type: 'gate', gate: 'quality', inputs: ['soft_report'], outputs: ['gate_result'] },
    { id: 'n5', type: 'agent', agent: 'fixer', inputs: ['spec', 'error_cards', 'artifact_summary'], outputs: ['artifact'] },
    { id: 'n6a', type: 'packager', packager: 'single-html', inputs: ['artifact'], outputs: ['bundle'], note: '版本留痕（评分未满时打包当前版本）' },
    { id: 'n6b', type: 'packager', packager: 'single-html', inputs: ['artifact'], outputs: ['bundle'], note: '交付打包（最终版本）' },
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
    { from: 'n7', to: 'n6a', when: 'fail', loop: { max_iters: 5, on_exhaust: 'n6b' } },
    { from: 'n6a', to: 'n1', when: 'always' },
    { from: 'n7', to: 'n6b', when: 'pass' },
    { from: 'n6b', to: 'n9', when: 'always' },
    { from: 'n9', to: 'n8', when: 'fail', loop: { max_iters: 5 } },
    { from: 'n8', to: 'n3', when: 'always' },
  ],
  limits: { max_total_iters: 40, timeout_sec: 1800, max_concurrency: 4 },
  quality: { min_score: 5, max_iters: 5 },
};
