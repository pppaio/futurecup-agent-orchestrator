import type { RunStatus } from './types';

export const STATUS_TEXT: Record<RunStatus, string> = {
  running: 'running',
  paused: 'paused',
  awaiting_human: 'awaiting_human',
  done: 'done',
  failed: 'failed',
  unknown: 'unknown',
};

export const STATUS_LABEL: Record<RunStatus, string> = {
  running: '运行中',
  paused: '已暂停',
  awaiting_human: '待人工确认',
  done: '已完成',
  failed: '失败',
  unknown: '未知',
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="badge-dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export type NodeState = 'idle' | 'active' | 'done' | 'failed';

export interface NodeMeta {
  id: string;
  label: string;
  hint: string;
}

// 与后端 workflows/game-gen.ts 的节点 id 一一对应（按实际流转顺序排列）。
export const NODES: NodeMeta[] = [
  { id: 'n1', label: '分析师', hint: '拆解需求/返工分析' },
  { id: 'n2', label: '生成者', hint: '产出 HTML' },
  { id: 'n3', label: '硬验证', hint: '沙箱判定' },
  { id: 'n4', label: '软裁判', hint: '评分缺口' },
  { id: 'n7', label: '质量门控', hint: '未满分→版本留痕→回分析师' },
  { id: 'n5', label: '修复者', hint: '硬错误回灌修复' },
  { id: 'n6a', label: '版本留痕', hint: 'bundle-vN' },
  { id: 'n6b', label: '交付打包', hint: '最终版本' },
  { id: 'n9', label: '人工确认', hint: '接受 / 返工' },
  { id: 'n8', label: '修改者', hint: '按你的指令增量改版' },
];

export const NODE_LABEL: Record<string, string> = Object.fromEntries(
  NODES.map((n) => [n.id, n.label]),
);

export const NODE_STATE_TEXT: Record<NodeState, string> = {
  idle: '待执行',
  active: '执行中',
  done: '已通过',
  failed: '未通过',
};

export function fmtWall(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
