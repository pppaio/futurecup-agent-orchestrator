// 与后端 src/types.ts 契约对齐的最小镜像（只包含前端渲染所需字段）。

export type EventType =
  | 'run.started'
  | 'run.finished'
  | 'run.failed'
  | 'node.entered'
  | 'node.exited'
  | 'agent.thinking.delta'
  | 'agent.message'
  | 'agent.tool.call'
  | 'agent.tool.result'
  | 'artifact.created'
  | 'verify.hard.result'
  | 'verify.soft.verdict'
  | 'loop.iteration'
  | 'run.interrupted'
  | 'run.resumed'
  | 'human.instruction'
  | 'error';

export interface RunEvent {
  seq: number;
  ts: number;
  run_id: string;
  node_id?: string;
  agent_id?: string;
  type: EventType;
  payload: Record<string, unknown>;
}

export interface HardError {
  type: 'console' | 'pageerror' | 'timeout';
  message: string;
  stack?: string;
  line?: number;
}

export interface HardReport {
  ok: boolean;
  load_ok: boolean;
  errors: HardError[];
  signals: { canvas_nonempty: boolean; dom_node_count: number; fps_sample?: number };
  screenshots: string[];
  load_ms: number;
}

export interface SoftReport {
  score: number;
  gaps: string[];
}

export type RunStatus = 'running' | 'paused' | 'done' | 'failed' | 'unknown';

export interface RunReport {
  runId: string;
  status: RunStatus;
  error_curve: number[];
  last_ok: boolean | null;
  last_errors: HardError[];
  soft_report: SoftReport | null;
  wall_ms: number | null;
  verify_count: number;
}

export interface HealthInfo {
  ok: boolean;
  model: string;
  runs: number;
}
