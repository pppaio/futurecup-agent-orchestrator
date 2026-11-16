import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type {
  AgentProfile,
  HardReport,
  RunEvent,
  RunId,
  TaskInput,
  WorkflowDef,
  WorkflowNode,
} from '../types.js';
import {
  DecompositionSpecSchema,
  HtmlArtifactSchema,
  SoftReportSchema,
} from '../types.js';
import { EventStore } from '../event/store.js';
import type { LLMGateway, LLMMessage } from '../gateway/llm.js';
import type { Sandbox } from '../sandbox/sandbox.js';
import type { Packager } from '../packager/packager.js';
import { normalizeErrors, summarizeArtifact } from '../reducer.js';
import { LoopWatchdog } from './watchdog.js';

export interface EngineOptions {
  llm: LLMGateway;
  sandbox: Sandbox;
  packager: Packager;
  store: EventStore;
  agents: Map<string, AgentProfile>;
  /** §5.8 歧义停机 + 人工确认点开关：交互模式开，批量实验关（避免跑批时卡在暂停）。 */
  humanGate?: boolean;
}

/** 单次运行的 per-agent 覆盖：换模型 / 调思考强度。 */
export interface AgentOverride {
  model?: string;
  effort?: 'low' | 'medium' | 'high';
}

export interface StartOptions {
  /** 初始端口值（如修改流程的既有产物/规格/指令）。 */
  seed?: Record<string, unknown>;
  /** 每 Agent 的模型/思考强度覆盖。 */
  overrides?: Record<string, AgentOverride>;
  /** 复用已有 run 目录（修改流程：版本号在同一目录递增）。 */
  runDirOverride?: string;
}

interface NodeState {
  node: WorkflowNode;
  output: unknown;
  runs: number;
}

type NodeResult = { pass: boolean; output: unknown };
type NodeDone = { nodeId: string; pending: false; result: NodeResult } | { nodeId: string; pending: true };

interface RunState {
  wf: WorkflowDef;
  task: TaskInput;
  runId: RunId;
  runDir: string;
  startedAt: number;
  states: Map<string, NodeState>;
  agents: Map<string, AgentProfile>;
  ports: Record<string, unknown>;
  loopCounts: Map<number, number>;
  errorCurve: number[];
  verifyPassed: boolean;
  totalLoopIters: number;
  queue: string[];
  paused: boolean;
  finished: boolean;
  interruptRequested: boolean;
  pendingHumanPrompt?: string;
  pendingHumanNode?: string;
  waiters: (() => void)[];
}

/**
 * 编排引擎：节点跳转只由 WorkflowDef + 状态机决定（控制面确定性，禁用 LLM 决策）。
 * - OR 激活调度 + 并发 Worker 批次（R3 状态剥离）
 * - loop 边 max_iters 计数；硬修复循环受 Loop Watchdog 把关
 * - 节点级 10 分钟超时熔断（R2）
 * - 质量门控（gate 节点，确定性代码读软评分）→ 低分自动返工
 * - 人工确认点（human 节点）：暂停等「接受 / 返工（附指令）」
 * - 运行中中断 → 插入指令 → 断点续跑
 */
export class Engine {
  private seq = 0;
  private watchdog = new LoopWatchdog();
  private runs = new Map<RunId, RunState>();
  private subscribers = new Set<(e: RunEvent) => void>();

  constructor(private opts: EngineOptions) {}

  /** 订阅实时事件（供 SSE 推送），返回取消订阅函数。 */
  subscribe(cb: (e: RunEvent) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private emit(e: Omit<RunEvent, 'seq' | 'ts'>): void {
    const full: RunEvent = { seq: ++this.seq, ts: Date.now(), ...e };
    this.watchdog.onEvent(full);
    this.opts.store.append(full);
    for (const cb of this.subscribers) cb(full);
  }

  /** 启动一次运行（后台执行），立即返回 runId。 */
  start(wf: WorkflowDef, task: TaskInput, startOpts: StartOptions = {}): RunId {
    const runId = ('r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)) as RunId;
    const runDir = startOpts.runDirOverride ?? this.opts.store.runDir(runId);
    const startedAt = Date.now();
    this.watchdog.reset();

    const states = new Map<string, NodeState>();
    for (const n of wf.nodes) states.set(n.id, { node: n, output: undefined, runs: 0 });

    // per-run agent 覆盖：换模型 / 调思考强度
    const agents = new Map(this.opts.agents);
    for (const [id, ov] of Object.entries(startOpts.overrides ?? {})) {
      const base = agents.get(id);
      if (!base) continue;
      agents.set(id, {
        ...base,
        model: { ...base.model, name: ov.model ?? base.model.name },
        thinking_effort: ov.effort ?? base.thinking_effort,
      });
    }

    const queue: string[] = [];
    const hasIncoming = new Set<string>(wf.edges.map((e) => e.to));
    for (const n of wf.nodes) if (!hasIncoming.has(n.id)) queue.push(n.id);

    const rs: RunState = {
      wf,
      task,
      runId,
      runDir,
      startedAt,
      states,
      agents,
      ports: { req: task.requirement, ...(startOpts.seed ?? {}) },
      loopCounts: new Map(),
      errorCurve: [],
      verifyPassed: false,
      totalLoopIters: 0,
      queue,
      paused: false,
      finished: false,
      interruptRequested: false,
      waiters: [],
    };
    this.runs.set(runId, rs);

    this.emit({ run_id: runId, type: 'run.started', payload: { workflow: wf.id, requirement: task.requirement } });
    this.runLoop(rs).catch((err) => {
      this.emit({ run_id: runId, type: 'error', payload: { message: 'runLoop crashed: ' + String(err) } });
      rs.finished = true;
      this.flushWaiters(rs);
    });
    return runId;
  }

  /** 等待运行进入静止态（paused 或 finished）。 */
  wait(runId: RunId): Promise<void> {
    const rs = this.runs.get(runId);
    if (!rs) return Promise.reject(new Error(`未知 run: ${runId}`));
    if (rs.paused || rs.finished) return Promise.resolve();
    return new Promise((resolve) => rs.waiters.push(resolve));
  }

  /** 请求中断：下一次节点边界生效（在途节点跑完后暂停）。 */
  interrupt(runId: RunId): void {
    const rs = this.runs.get(runId);
    if (!rs) throw new Error(`未知 run: ${runId}`);
    rs.interruptRequested = true;
  }

  /**
   * 续跑，可带一条人工指令。
   * - 停在人工确认点：无指令 = 接受交付；有指令 = 返工（指令注入修改者）。
   * - 停在中断点/歧义点：指令注入下一个 Agent 的上下文。
   */
  resume(runId: RunId, instruction?: string): void {
    const rs = this.runs.get(runId);
    if (!rs) throw new Error(`未知 run: ${runId}`);
    if (!rs.paused) throw new Error(`run 未处于暂停态: ${runId}`);

    if (rs.pendingHumanNode) {
      // 人工确认点：完成该节点（接受 or 返工）
      const nodeId = rs.pendingHumanNode;
      rs.pendingHumanNode = undefined;
      rs.paused = false;
      const hasInstruction = !!instruction && instruction.trim().length > 0;
      if (hasInstruction) {
        this.emit({ run_id: runId, type: 'human.instruction', payload: { text: instruction } });
        rs.ports['instruction'] = instruction;
      }
      const result: NodeResult = hasInstruction
        ? { pass: false, output: { action: 'revise' } }
        : { pass: true, output: { action: 'accept' } };
      const st = rs.states.get(nodeId)!;
      st.output = result.output;
      this.emit({ run_id: runId, node_id: nodeId, type: 'node.exited', payload: { pass: result.pass } });
      this.propagateEdges(rs, nodeId, result);
      this.emit({ run_id: runId, type: 'run.resumed', payload: {} });
      this.continueLoop(rs);
      return;
    }

    rs.paused = false;
    if (instruction && instruction.length > 0) {
      this.emit({ run_id: runId, type: 'human.instruction', payload: { text: instruction } });
      rs.ports['human_instruction'] = instruction;
    }
    this.emit({ run_id: runId, type: 'run.resumed', payload: {} });
    this.continueLoop(rs);
  }

  private continueLoop(rs: RunState): void {
    this.runLoop(rs).catch((err) => {
      this.emit({ run_id: rs.runId, type: 'error', payload: { message: 'runLoop crashed: ' + String(err) } });
      rs.finished = true;
      this.flushWaiters(rs);
    });
  }

  private flushWaiters(rs: RunState): void {
    const ws = rs.waiters.splice(0);
    for (const w of ws) w();
  }

  /** 边传播：loop 边带计数与看门狗（仅硬修复循环），普通边直接入队。 */
  private propagateEdges(rs: RunState, nodeId: string, result: NodeResult): void {
    rs.wf.edges.forEach((e, idx) => {
      if (e.from !== nodeId) return;
      const edgeOk = e.when === 'always' || (e.when === 'pass' ? result.pass : !result.pass);
      if (!edgeOk) return;

      if (e.loop) {
        rs.totalLoopIters++;
        if (rs.totalLoopIters > rs.wf.limits.max_total_iters) {
          this.emit({ run_id: rs.runId, node_id: e.to, type: 'error', payload: { message: 'max_total_iters exceeded' } });
          return;
        }
        // 看门狗只把关「硬修复循环」（回边目标是 verify 节点的循环）；
        // 质量返工/人工返工有各自的门控与上限，不受硬错误收敛判据干扰。
        const targetIsVerify = rs.states.get(e.to)?.node.type === 'verify';
        if (targetIsVerify) {
          const verdict = this.watchdog.verdict();
          if (verdict.action !== 'continue') {
            this.emit({ run_id: rs.runId, node_id: e.to, type: 'error', payload: { message: `watchdog ${verdict.action}: ${verdict.reason}` } });
            return;
          }
        }
        const c = (rs.loopCounts.get(idx) ?? 0) + 1;
        rs.loopCounts.set(idx, c);
        this.emit({ run_id: rs.runId, node_id: e.to, type: 'loop.iteration', payload: { iteration: c, max: e.loop.max_iters } });
        if (c > e.loop.max_iters) {
          this.emit({ run_id: rs.runId, node_id: e.to, type: 'loop.iteration', payload: { exceeded: true } });
          // 超限兜底：带缺陷交付 / 指定兜底节点（如质量返工耗尽 → 仍打包交付）
          if (e.loop.on_exhaust) {
            this.emit({ run_id: rs.runId, node_id: e.loop.on_exhaust, type: 'error', payload: { message: `循环超限，按兜底策略转 ${e.loop.on_exhaust}` } });
            rs.queue.push(e.loop.on_exhaust);
          }
          return;
        }
        rs.queue.push(e.to);
      } else {
        rs.queue.push(e.to);
      }
    });
  }

  private async runLoop(rs: RunState): Promise<void> {
    while (rs.queue.length > 0) {
      if (rs.interruptRequested) {
        rs.interruptRequested = false;
        rs.paused = true;
        this.emit({
          run_id: rs.runId,
          type: 'run.interrupted',
          payload: {
            reason: rs.pendingHumanPrompt ? 'blocking_ambiguities' : 'manual_interrupt',
            prompt: rs.pendingHumanPrompt,
          },
        });
        rs.pendingHumanPrompt = undefined;
        this.flushWaiters(rs);
        return;
      }

      // R3 状态剥离：一次取出至多 max_concurrency 个就绪节点，交给并发 Worker 执行。
      const batch: string[] = [];
      const cap = Math.max(1, rs.wf.limits.max_concurrency);
      while (rs.queue.length > 0 && batch.length < cap) batch.push(rs.queue.shift()!);

      const done = await Promise.all(batch.map((nodeId) => this.runOneNode(rs, nodeId)));

      let humanPending = false;
      for (const d of done) {
        if (d.pending) {
          humanPending = true;
          continue;
        }
        this.propagateEdges(rs, d.nodeId, d.result);

        // §5.8：分析师产出阻塞性歧义 → 自动暂停转人工（批量实验可关）
        const st = rs.states.get(d.nodeId)!;
        if (
          this.opts.humanGate !== false &&
          st.node.type === 'agent' &&
          st.node.agent === 'analyst' &&
          d.result.output &&
          typeof d.result.output === 'object'
        ) {
          const spec = d.result.output as { ambiguities?: { q: string; blocking: boolean }[] };
          const blocking = (spec.ambiguities ?? []).filter((a) => a.blocking);
          if (blocking.length > 0) {
            rs.pendingHumanPrompt = blocking.map((b) => '· ' + b.q).join('\n');
            rs.interruptRequested = true;
          }
        }
      }
      if (humanPending) return; // 停在人工确认点，等 resume()
    }

    this.finishRun(rs);
  }

  private finishRun(rs: RunState): void {
    const hasVerify = rs.wf.nodes.some((n) => n.type === 'verify');
    const finalStatus = hasVerify && !rs.verifyPassed ? 'failed' : 'done';

    const agentIds = [...new Set([...rs.states.values()].map((s) => s.node.agent).filter((a): a is string => !!a))];
    writeFileSync(
      join(rs.runDir, 'run.json'),
      JSON.stringify(
        {
          run_id: rs.runId,
          workflow_id: rs.wf.id,
          status: finalStatus,
          model_snapshot: agentIds.map((a) => ({
            agent_id: a,
            model: rs.agents.get(a)?.model.name ?? 'unknown',
            effort: rs.agents.get(a)?.thinking_effort ?? 'unknown',
          })),
          error_curve: rs.errorCurve,
          wall_ms: Date.now() - rs.startedAt,
        },
        null,
        2,
      ),
      'utf8',
    );

    if (hasVerify && !rs.verifyPassed) {
      this.emit({
        run_id: rs.runId,
        type: 'run.failed',
        payload: { reason: 'verify_not_passed', error_curve: rs.errorCurve, wall_ms: Date.now() - rs.startedAt },
      });
    } else {
      this.emit({
        run_id: rs.runId,
        type: 'run.finished',
        payload: { error_curve: rs.errorCurve, wall_ms: Date.now() - rs.startedAt },
      });
    }
    rs.finished = true;
    this.flushWaiters(rs);
  }

  private readInputs(node: WorkflowNode, ports: Record<string, unknown>): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    for (const name of node.inputs ?? []) inputs[name] = ports[name];
    return inputs;
  }

  /**
   * 单节点 Worker：执行与主循环解耦（R3 状态剥离）。
   * R2 超时熔断：节点超过 10 分钟未完成 → 强制判失败。
   * human 节点：批量模式自动接受；交互模式暂停等人工决定。
   */
  private async runOneNode(rs: RunState, nodeId: string): Promise<NodeDone> {
    const st = rs.states.get(nodeId)!;
    st.runs++;
    this.emit({ run_id: rs.runId, node_id: nodeId, type: 'node.entered', payload: { run: st.runs } });

    if (st.node.type === 'human') {
      if (this.opts.humanGate === false) {
        const result: NodeResult = { pass: true, output: { action: 'auto_accept' } };
        st.output = result.output;
        this.emit({ run_id: rs.runId, node_id: nodeId, type: 'node.exited', payload: { pass: true } });
        return { nodeId, pending: false, result };
      }
      // 交互模式：暂停，等人工「接受 / 返工」
      rs.paused = true;
      rs.pendingHumanNode = nodeId;
      this.emit({
        run_id: rs.runId,
        node_id: nodeId,
        type: 'run.interrupted',
        payload: { reason: 'awaiting_human', note: st.node.note ?? '人工确认点' },
      });
      this.flushWaiters(rs);
      return { nodeId, pending: true };
    }

    const NODE_TIMEOUT_MS = 600_000; // 10 分钟无输出 → 熔断
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: NodeResult;
    try {
      result = await Promise.race([
        this.executeNode(rs, st.node),
        new Promise<NodeResult>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`节点 ${nodeId} 超过 10 分钟未完成，熔断判失败`)),
            NODE_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (err) {
      this.emit({ run_id: rs.runId, node_id: nodeId, type: 'error', payload: { message: String(err) } });
      result = { pass: false, output: { error: String(err) } };
    } finally {
      if (timer) clearTimeout(timer);
    }

    st.output = result.output;
    const outObj = (result.output && typeof result.output === 'object' ? result.output : {}) as Record<string, unknown>;
    for (const name of st.node.outputs ?? []) {
      rs.ports[name] = name in outObj ? outObj[name] : outObj;
    }

    if (st.node.type === 'verify') {
      const report = result.output as Partial<HardReport>;
      if (Array.isArray(report.errors)) {
        rs.errorCurve.push(report.errors.length);
        rs.verifyPassed = !!report.ok; // 以「最近一次验证」为准
      }
    }

    this.emit({ run_id: rs.runId, node_id: nodeId, type: 'node.exited', payload: { pass: result.pass } });
    return { nodeId, pending: false, result };
  }

  private async executeNode(rs: RunState, node: WorkflowNode): Promise<NodeResult> {
    switch (node.type) {
      case 'agent':
        return this.executeAgent(rs, node);
      case 'verify':
        return this.executeVerify(rs, node);
      case 'packager':
        return this.executePackager(rs, node);
      case 'gate':
        return this.executeGate(rs, node);
      default:
        throw new Error(`节点类型未实现：${node.type}`);
    }
  }

  private async executeAgent(rs: RunState, node: WorkflowNode): Promise<NodeResult> {
    const profile = rs.agents.get(node.agent ?? '');
    if (!profile) throw new Error(`未找到 Agent '${node.agent}'`);
    const ports = rs.ports;

    const inputs = this.readInputs(node, ports);
    const userContent = JSON.stringify({ task: rs.task.requirement, inputs }, null, 2);
    const messages: LLMMessage[] = [
      { role: 'system', content: profile.role_prompt },
      { role: 'user', content: userContent },
    ];

    // 人工指令（中断插入）：注入下一个 Agent 的上下文（一次性）
    const instr = ports['human_instruction'];
    if (typeof instr === 'string' && instr.length > 0) {
      messages.push({ role: 'user', content: '[人工指令] ' + instr });
      delete ports['human_instruction'];
    }

    this.emit({ run_id: rs.runId, node_id: node.id, agent_id: profile.id, type: 'agent.message', payload: { role: 'system', text: profile.role_prompt } });
    for (const m of messages.slice(1)) {
      this.emit({ run_id: rs.runId, node_id: node.id, agent_id: profile.id, type: 'agent.message', payload: { role: m.role, text: m.content } });
    }

    const res = await this.opts.llm.complete({ agent: profile, messages, json: true });
    this.emit({ run_id: rs.runId, node_id: node.id, agent_id: profile.id, type: 'agent.message', payload: { role: 'assistant', text: res.text } });

    let parsed: unknown;
    switch (profile.output_schema) {
      case 'HtmlArtifact': {
        const r = HtmlArtifactSchema.safeParse(res.json);
        if (!r.success) throw new Error(`[schema] ${profile.id} 输出不合法: ${r.error.message}`);
        if (/<script[^>]+src\s*=/i.test(r.data.html) || /<link[^>]+href\s*=/i.test(r.data.html)) {
          throw new Error(`[schema] ${profile.id} 产物包含外部资源引用，违反 H1`);
        }
        parsed = r.data;
        break;
      }
      case 'DecompositionSpec': {
        const r = DecompositionSpecSchema.safeParse(res.json);
        if (!r.success) throw new Error(`[schema] ${profile.id} 输出不合法: ${r.error.message}`);
        parsed = r.data;
        break;
      }
      case 'SoftReport': {
        const r = SoftReportSchema.safeParse(res.json);
        if (!r.success) throw new Error(`[schema] ${profile.id} 输出不合法: ${r.error.message}`);
        parsed = r.data;
        this.emit({ run_id: rs.runId, node_id: node.id, agent_id: profile.id, type: 'verify.soft.verdict', payload: r.data as unknown as Record<string, unknown> });
        break;
      }
      default:
        parsed = res.json ?? { raw: res.text };
    }
    return { pass: true, output: parsed };
  }

  private async executeVerify(rs: RunState, node: WorkflowNode): Promise<NodeResult> {
    const inputs = this.readInputs(node, rs.ports);
    const artifact = inputs.artifact as { html?: string } | string | undefined;
    const html = typeof artifact === 'string' ? artifact : artifact?.html ?? '';
    if (!html) throw new Error('验证节点缺少 html 输入');
    const spec = inputs.spec as { graphic?: boolean } | undefined;
    const requireCanvas = spec?.graphic ?? true;

    const shotsDir = join(rs.runDir, 'shots');
    const report: HardReport = await this.opts.sandbox.run(html, { timeoutMs: 15000, shotsDir, requireCanvas });

    writeFileSync(join(rs.runDir, 'hard_report.json'), JSON.stringify(report, null, 2), 'utf8');
    this.emit({ run_id: rs.runId, node_id: node.id, type: 'verify.hard.result', payload: report as unknown as Record<string, unknown> });

    if (!report.ok) {
      rs.ports['error_cards'] = normalizeErrors(report, { requireCanvas });
      rs.ports['artifact_summary'] = summarizeArtifact(html);
    }
    return { pass: report.ok, output: report };
  }

  /** 质量门控（确定性代码，禁用 LLM）：软裁判分数低于阈值 → 把差距压成改进卡片并返工。 */
  private executeGate(rs: RunState, node: WorkflowNode): NodeResult {
    const minScore = rs.wf.quality?.min_score ?? 4;
    const soft = rs.ports['soft_report'] as { score?: number; gaps?: string[] } | undefined;
    if (!soft || typeof soft.score !== 'number') {
      this.emit({ run_id: rs.runId, node_id: node.id, type: 'error', payload: { message: '质量门控缺少软评分（软裁判未完成）' } });
      return { pass: false, output: { reason: 'no_soft_report' } };
    }
    if (soft.score >= minScore) {
      return { pass: true, output: { score: soft.score, min_score: minScore } };
    }
    rs.ports['quality_cards'] = (soft.gaps ?? []).slice(0, 3).map((g) => ({ category: 'render', message: g }));
    return { pass: false, output: { score: soft.score, min_score: minScore, gaps: soft.gaps } };
  }

  private async executePackager(rs: RunState, node: WorkflowNode): Promise<NodeResult> {
    const inputs = this.readInputs(node, rs.ports);
    const artifact = inputs.artifact as { title?: string; html?: string } | undefined;
    const bundle = await this.opts.packager.pack(artifact, rs.runDir);
    const sha256 = createHash('sha256').update(artifact?.html ?? '').digest('hex');
    this.emit({
      run_id: rs.runId,
      node_id: node.id,
      type: 'artifact.created',
      payload: { bundle, sha256 } as unknown as Record<string, unknown>,
    });
    return { pass: true, output: bundle };
  }
}
