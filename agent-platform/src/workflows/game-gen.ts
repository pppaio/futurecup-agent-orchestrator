import type { WorkflowDef } from '../types.js';

/**
 * 小游戏生成闭环 v4（按用户需求改的评分循环语义）：
 * 分析 → 生成 → 硬验证（失败修复 ≤3 轮）→ 软裁判评分 → 质量门控：
 *  - 不满分 → 先把当前版本打包留痕（bundle-vN）→ 问题抛回分析师重新分析 → 生成者改动
 *    → 再验证 → 再评分，循环直到满分或预设轮次耗尽；
 *  - 满分 / 轮次耗尽 → 最终打包 → 人工确认点：
 *    · 接受 → 结束；
 *    · 返工（附指令）→ 回到分析师（结合指令+当前版本重新分析）→ 生成者改动 → 再走验证闭环。
 * 每次评分不满的版本都有独立编号，可追溯。
 */
export const GAME_GEN_WF: WorkflowDef = {
  id: 'game-gen-v4',
  name: '小游戏生成闭环',
  entry: 'n1',
  nodes: [
    { id: 'n1', type: 'agent', agent: 'analyst', inputs: ['req', 'spec', 'quality_cards', 'artifact', 'instruction', 'run_memory'], outputs: ['spec'], note: 'replan' },
    { id: 'n2', type: 'agent', agent: 'builder', candidates: ['builder', 'builder-flash'], inputs: ['spec', 'artifact'], outputs: ['artifact'] },
    { id: 'n3', type: 'verify', verifier: 'hard-sandbox', inputs: ['artifact', 'spec'], outputs: ['hard_report'] },
    { id: 'n4', type: 'agent', agent: 'critic', inputs: ['artifact', 'spec'], outputs: ['soft_report'] },
    { id: 'n7', type: 'gate', gate: 'quality', inputs: ['soft_report'], outputs: ['gate_result'] },
    { id: 'n5', type: 'agent', agent: 'fixer', inputs: ['spec', 'error_cards', 'artifact_summary'], outputs: ['artifact'] },
    { id: 'n6a', type: 'packager', packager: 'single-html', inputs: ['artifact'], outputs: ['bundle'], note: '版本留痕（评分未满时打包当前版本）' },
    { id: 'n6b', type: 'packager', packager: 'single-html', inputs: ['artifact'], outputs: ['bundle'], note: '交付打包（最终版本）' },
    { id: 'n9', type: 'human', note: '人工确认点：接受交付 / 输入修改指令返工（回到分析师重新分析）' },
  ],
  edges: [
    { from: 'n1', to: 'n2', when: 'always' },
    { from: 'n2', to: 'n3', when: 'always' },
    { from: 'n3', to: 'n5', when: 'fail' },                       // 硬验证失败 → 修复者
    { from: 'n5', to: 'n3', when: 'always', loop: { max_iters: 3 } }, // 硬修复循环（看门狗把关）
    { from: 'n3', to: 'n4', when: 'pass' },                       // 通过才打分
    { from: 'n4', to: 'n7', when: 'always' },                     // 质量门控
    { from: 'n7', to: 'n6a', when: 'fail', loop: { max_iters: 5, on_exhaust: 'n6b' } }, // 不满分：打包留痕 → 回分析师
    { from: 'n6a', to: 'n1', when: 'always' },                    // 版本留痕后 → 分析师重新分析
    { from: 'n7', to: 'n6b', when: 'pass' },                      // 满分 → 交付打包
    { from: 'n6b', to: 'n9', when: 'always' },                    // 人工确认点
    { from: 'n9', to: 'n1', when: 'fail', loop: { max_iters: 5 } }, // 人工返工：回到分析师（带指令重新分析）
  ],
  limits: { max_total_iters: 30, timeout_sec: 900, max_concurrency: 4 },
  quality: { min_score: 5, max_iters: 5 },
};
