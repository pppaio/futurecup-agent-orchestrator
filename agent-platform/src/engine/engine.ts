import { writeFileSync } from 'node:fs';
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
  /** §5.8 歧义停机开关：交互模式开，批量实验关（避免跑批时卡在暂停）。 */
  humanGate?: boolean;
}

interface NodeState {
  node: WorkflowNode;
  output: unknown;
  runs: number;
}

type NodeResult = { pass: boolean; output: unknown };

interface RunState {
  wf: WorkflowDef;
  task: TaskInput;
  runId: RunId;
  runDir: string;
  startedAt: number;
  states: Map<string, NodeState>;
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
  waiters: (() => void)[];
}

/**
 * 编排引擎：节点跳转只由 WorkflowDef + 状态机决定（控制面确定性，禁用 LLM 决策）。
 * 调度语义为 OR 激活：任一条入边条件满足即触发目标节点。
 * 循环 = loop 边：带 max_iters 计数 + Loop Watchdog 外部观察者双重把关。
 * 支持运行中中断（节点边界粒度）→ 插入指令 → 断点续跑。
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
  start(wf: WorkflowDef, task: TaskInput): RunId {
    const runId = ('r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)) as RunId;
    const runDir = this.opts.store.runDir(runId);
    const startedAt = Date.now();
    this.watchdog.reset();

    const states = new Map<string, NodeState>();
    for (const n of wf.nodes) states.set(n.id, { node: n, output: undefined, runs: 0 });

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
      ports: { req: task.requirement },
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

  /** 续跑，可带一条人工指令（注入下一个 Agent 的上下文）。 */
  resume(runId: RunId, instruction?: string): void {
    const rs = this.runs.get(runId);
    if (!rs) throw new Error(`未知 run: ${runId}`);
    if (!rs.paused) throw new Error(`run 未处于暂停态: ${runId}`);
    rs.paused = false;
    if (instruction && instruction.length > 0) {
      this.emit({ run_id: runId, type: 'human.instruction', payload: { text: instruction } });
      rs.ports['human_instruction'] = instruction;
    }
    this.emit({ run_id: runId, type: 'run.resumed', payload: {} });
    this.runLoop(rs).catch((err) => {
      this.emit({ run_id: runId, type: 'error', payload: { message: 'runLoop crashed: ' + String(err) } });
      rs.finished = true;
      this.flushWaiters(rs);
    });
  }

  private flushWaiters(rs: RunState): void {
    const ws = rs.waiters.splice(0);
    for (const w of ws) w();
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

      const nodeId = rs.queue.shift()!;
      const st = rs.states.get(nodeId)!;
      st.runs++;
      this.emit({ run_id: rs.runId, node_id: nodeId, type: 'node.entered', payload: { run: st.runs } });

      let result: NodeResult;
      try {
        result = await this.executeNode(st.node, rs.ports, rs.runId, rs.runDir, rs.task);
      } catch (err) {
        this.emit({ run_id: rs.runId, node_id: nodeId, type: 'error', payload: { message: String(err) } });
        result = { pass: false, output: { error: String(err) } };
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
          if (report.ok) rs.verifyPassed = true;
        }
      }

      this.emit({ run_id: rs.runId, node_id: nodeId, type: 'node.exited', payload: { pass: result.pass } });

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
          const verdict = this.watchdog.verdict();
          if (verdict.action !== 'continue') {
            this.emit({ run_id: rs.runId, node_id: e.to, type: 'error', payload: { message: `watchdog ${verdict.action}: ${verdict.reason}` } });
            return;
          }
          const c = (rs.loopCounts.get(idx) ?? 0) + 1;
          rs.loopCounts.set(idx, c);
          this.emit({ run_id: rs.runId, node_id: e.to, type: 'loop.iteration', payload: { iteration: c, max: e.loop.max_iters } });
          if (c > e.loop.max_iters) {
            this.emit({ run_id: rs.runId, node_id: e.to, type: 'loop.iteration', payload: { exceeded: true } });
            return;
          }
          rs.queue.push(e.to);
        } else {
          rs.queue.push(e.to);
        }
      });

      // §5.8：分析师产出阻塞性歧义 → 自动暂停转人工（下一节点运行前生效；批量实验可关）
      if (
        this.opts.humanGate !== false &&
        st.node.type === 'agent' &&
        st.node.agent === 'analyst' &&
        result.output &&
        typeof result.output === 'object'
      ) {
        const spec = result.output as { ambiguities?: { q: string; blocking: boolean }[] };
        const blocking = (spec.ambiguities ?? []).filter((a) => a.blocking);
        if (blocking.length > 0) {
          rs.pendingHumanPrompt = blocking.map((b) => '· ' + b.q).join('\n');
          rs.interruptRequested = true;
        }
      }
    }

    const hasVerify = rs.wf.nodes.some((n) => n.type === 'verify');
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

  private async executeNode(
    node: WorkflowNode,
    ports: Record<string, unknown>,
    runId: RunId,
    runDir: string,
    task: TaskInput,
  ): Promise<NodeResult> {
    switch (node.type) {
      case 'agent':
        return this.executeAgent(node, ports, runId, task);
      case 'verify':
        return this.executeVerify(node, ports, runId, runDir);
      case 'packager':
        return this.executePackager(node, ports, runId, runDir);
      case 'human':
        this.emit({ run_id: runId, node_id: node.id, type: 'human.instruction', payload: { note: node.note ?? '人工确认点' } });
        return { pass: true, output: { confirmed: true } };
      default:
        throw new Error(`节点类型未实现：${node.type}`);
    }
  }

  private async executeAgent(node: WorkflowNode, ports: Record<string, unknown>, runId: RunId, task: TaskInput): Promise<NodeResult> {
    const profile = this.opts.agents.get(node.agent ?? '');
    if (!profile) throw new Error(`未找到 Agent '${node.agent}'`);

    const inputs = this.readInputs(node, ports);
    const userContent = JSON.stringify({ task: task.requirement, inputs }, null, 2);
    const messages: LLMMessage[] = [
      { role: 'system', content: profile.role_prompt },
      { role: 'user', content: userContent },
    ];

    // 人工指令：注入下一个 Agent 的上下文（一次性）
    const instr = ports['human_instruction'];
    if (typeof instr === 'string' && instr.length > 0) {
      messages.push({ role: 'user', content: '[人工指令] ' + instr });
      delete ports['human_instruction'];
    }

    this.emit({ run_id: runId, node_id: node.id, agent_id: profile.id, type: 'agent.message', payload: { role: 'system', text: profile.role_prompt } });
    for (const m of messages.slice(1)) {
      this.emit({ run_id: runId, node_id: node.id, agent_id: profile.id, type: 'agent.message', payload: { role: m.role, text: m.content } });
    }

    const res = await this.opts.llm.complete({ agent: profile, messages, json: true });
    this.emit({ run_id: runId, node_id: node.id, agent_id: profile.id, type: 'agent.message', payload: { role: 'assistant', text: res.text } });

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
        this.emit({ run_id: runId, node_id: node.id, agent_id: profile.id, type: 'verify.soft.verdict', payload: r.data as unknown as Record<string, unknown> });
        break;
      }
      default:
        parsed = res.json ?? { raw: res.text };
    }
    return { pass: true, output: parsed };
  }

  private async executeVerify(node: WorkflowNode, ports: Record<string, unknown>, runId: RunId, runDir: string): Promise<NodeResult> {
    const inputs = this.readInputs(node, ports);
    const artifact = inputs.artifact as { html?: string } | string | undefined;
    const html = typeof artifact === 'string' ? artifact : artifact?.html ?? '';
    if (!html) throw new Error('验证节点缺少 html 输入');
    const spec = inputs.spec as { graphic?: boolean } | undefined;
    const requireCanvas = spec?.graphic ?? true;

    const shotsDir = join(runDir, 'shots');
    const report: HardReport = await this.opts.sandbox.run(html, { timeoutMs: 15000, shotsDir, requireCanvas });

    writeFileSync(join(runDir, 'hard_report.json'), JSON.stringify(report, null, 2), 'utf8');
    this.emit({ run_id: runId, node_id: node.id, type: 'verify.hard.result', payload: report as unknown as Record<string, unknown> });

    // 失败时把信号失败也压成错误卡片（修复者需要可操作信息）
    if (!report.ok) {
      ports['error_cards'] = normalizeErrors(report, { requireCanvas });
      ports['artifact_summary'] = summarizeArtifact(html);
    }
    return { pass: report.ok, output: report };
  }

  private async executePackager(node: WorkflowNode, ports: Record<string, unknown>, runId: RunId, runDir: string): Promise<NodeResult> {
    const inputs = this.readInputs(node, ports);
    const artifact = inputs.artifact as { title?: string; html?: string } | undefined;
    const bundle = await this.opts.packager.pack(artifact, runDir);
    this.emit({ run_id: runId, node_id: node.id, type: 'artifact.created', payload: { bundle } as unknown as Record<string, unknown> });
    return { pass: true, output: bundle };
  }
}
