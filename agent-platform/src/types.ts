import { z } from 'zod';

export type RunId = string;
export type AgentId = string;
export type NodeId = string;

// ---------- 模型配置 ----------
export const ModelConfigSchema = z.object({
  provider: z.string().default('deepseek'),
  name: z.string().default('deepseek-v4-pro'),
  temperature: z.number().optional(),
  reasoning_effort: z.enum(['low', 'high', 'max']).optional(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// ---------- Agent 角色定义 ----------
export const AgentProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string().default('1.0.0'),
  role_prompt: z.string(),
  thinking_effort: z.enum(['low', 'medium', 'high']).default('medium'),
  model: ModelConfigSchema,
  capabilities: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  memory: z.object({ scope: z.literal('run'), retrieve_top_k: z.number().default(4) }).default({ scope: 'run', retrieve_top_k: 4 }),
  output_schema: z.string(),
  io: z.object({ inputs: z.array(z.string()), outputs: z.array(z.string()) }),
  metrics: z.object({
    success_rate: z.number().min(0).max(1).default(0.9),
    avg_latency_ms: z.number().default(1000),
    cost_tier: z.number().default(1), // 相对成本档位：1 便宜 ~ 3 贵
  }).optional(),
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

// ---------- 工作流 DAG ----------
export const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['agent', 'verify', 'packager', 'human', 'subflow', 'gate']),
  agent: z.string().optional(),
  verifier: z.string().optional(),
  packager: z.string().optional(),
  gate: z.string().optional(),
  subflow: z.string().optional(),
  inputs: z.array(z.string()).optional(),
  outputs: z.array(z.string()).optional(),
  note: z.string().optional(),
  candidates: z.array(z.string()).optional(), // 智能调度：多个候选 Agent，按打分择一
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  parallel: z.boolean().optional(),
  when: z.enum(['always', 'pass', 'fail']).default('always'),
  loop: z.object({ max_iters: z.number(), on_exhaust: z.string().optional() }).optional(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  limits: z.object({
    max_total_iters: z.number().default(6),
    timeout_sec: z.number().default(900),
    max_concurrency: z.number().default(4),
  }).default({ max_total_iters: 6, timeout_sec: 900, max_concurrency: 4 }),
  quality: z.object({
    min_score: z.number().default(4),
    max_iters: z.number().default(2),
  }).optional(),
  scheduler: z.object({
    w_succ: z.number().default(1),
    w_speed: z.number().default(0.05),
    w_cost: z.number().default(0.03),
  }).optional(),
});
export type WorkflowDef = z.infer<typeof WorkflowDefSchema>;

// ---------- 事件（唯一事实来源） ----------
export type EventType =
  | 'run.started' | 'run.finished' | 'run.failed'
  | 'node.entered' | 'node.exited'
  | 'agent.thinking.delta' | 'agent.message'
  | 'agent.tool.call' | 'agent.tool.result'
  | 'artifact.created'
  | 'verify.hard.result' | 'verify.soft.verdict'
  | 'loop.iteration'
  | 'run.interrupted' | 'run.resumed'
  | 'human.instruction'
  | 'scheduler.picked'
  | 'error';

export interface RunEvent {
  seq: number;
  ts: number;
  run_id: RunId;
  node_id?: NodeId;
  agent_id?: AgentId;
  type: EventType;
  payload: Record<string, unknown>;
}

// ---------- 产物与硬验证 ----------
export const HtmlArtifactSchema = z.object({
  title: z.string(),
  html: z.string().min(1),
});
export type HtmlArtifact = z.infer<typeof HtmlArtifactSchema>;

export const HardReportSchema = z.object({
  ok: z.boolean(),
  load_ok: z.boolean(),
  errors: z.array(z.object({
    type: z.enum(['console', 'pageerror', 'timeout']),
    message: z.string(),
    stack: z.string().optional(),
    line: z.number().optional(),
  })),
  signals: z.object({
    canvas_nonempty: z.boolean(),
    dom_node_count: z.number(),
    fps_sample: z.number().optional(),
  }),
  screenshots: z.array(z.string()),
  load_ms: z.number(),
});
export type HardReport = z.infer<typeof HardReportSchema>;

// ---------- 分析师输出（DecompositionSpec） ----------
export const AmbiguitySchema = z.object({
  q: z.string(),
  blocking: z.boolean(),
});
export type Ambiguity = z.infer<typeof AmbiguitySchema>;

export const DecompositionSpecSchema = z.object({
  goal: z.string(),
  graphic: z.boolean(),
  acceptance: z.array(z.string()),
  assumptions: z.array(z.string()).default([]),
  ambiguities: z.array(AmbiguitySchema).default([]),
  tasks: z.array(z.object({ id: z.string(), agent_cap: z.string(), spec: z.string() })).default([]),
  plan: z.array(z.object({ step: z.string(), acceptance: z.array(z.string()).default([]) })).optional(),
});
export type DecompositionSpec = z.infer<typeof DecompositionSpecSchema>;

// ---------- 软裁判输出（SoftReport） ----------
export const SoftReportSchema = z.object({
  score: z.number().min(1).max(5),
  gaps: z.array(z.string()).default([]),
});
export type SoftReport = z.infer<typeof SoftReportSchema>;

// ---------- 错误卡片（确定性归约产物） ----------
export const ErrorCardSchema = z.object({
  category: z.enum(['syntax', 'runtime', 'render', 'interaction', 'resource']),
  message: z.string(),
  line: z.number().optional(),
  screenshot: z.string().optional(),
});
export type ErrorCard = z.infer<typeof ErrorCardSchema>;

// ---------- 运行记录（可复现三件套） ----------
export interface RunRecord {
  run_id: RunId;
  workflow_id: string;
  status: 'running' | 'paused' | 'done' | 'failed' | 'aborted';
  model_snapshot: { agent_id: string; model: string; prompt_hash: string }[];
  seed: number;
  artifacts: { id: string; path: string; sha256: string }[];
  metrics: {
    wall_ms: number;
    tokens: number;
    cost_usd: number;
    rounds: number;
    error_curve: number[];
  };
}

export interface TaskInput {
  requirement: string;
}
