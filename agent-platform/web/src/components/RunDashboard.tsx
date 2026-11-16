import { useEffect, useRef, useState } from 'react';
import { artifactUrl, getReport, interruptRun, openEventStream, resumeRun } from '../api';
import { NODE_LABEL, StatusBadge, type NodeState } from '../bits';
import type { AgentConfig, RunEvent, RunStatus } from '../types';
import { NodeBar } from './NodeBar';

interface Props {
  runId: string;
  requirement: string;
  config: AgentConfig;
  onOpenReport: () => void;
  onBack: () => void;
}

const MAX_EVENTS = 400;

function trunc(s: string, n = 120): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function arrLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

function summarizeEvent(e: RunEvent): string {
  const p = e.payload as Record<string, unknown>;
  const node = e.node_id ? NODE_LABEL[e.node_id] ?? e.node_id : '';
  switch (e.type) {
    case 'run.started':
      return `工作流 ${String(p.workflow ?? '')} 启动 · 需求已受理`;
    case 'run.finished':
      return `运行完成 · 耗时 ${String(p.wall_ms ?? '—')} ms`;
    case 'run.failed':
      return `运行失败 · ${trunc(String(p.reason ?? 'verify_not_passed'))}`;
    case 'node.entered':
      return `进入节点 ${node}`;
    case 'node.exited':
      return `离开节点 ${node} · pass=${p.pass === true ? 'true' : 'false'}`;
    case 'agent.message':
      return `${String(e.agent_id ?? '')} [${String(p.role ?? '')}] ${trunc(String(p.text ?? ''))}`;
    case 'verify.hard.result':
      return `硬验证 ${p.ok ? '✅ 通过' : '❌ 失败'} · ${arrLen(p.errors)} 处错误 · load_ms=${String(p.load_ms ?? '—')}`;
    case 'verify.soft.verdict':
      return `软裁判 ${String(p.score ?? '—')}/5 · ${arrLen(p.gaps)} 个缺口`;
    case 'loop.iteration':
      return p.exceeded ? '循环超出上限' : `循环迭代 ${String(p.iteration ?? '')}/${String(p.max ?? '')}`;
    case 'run.interrupted': {
      const reason = String(p.reason ?? '');
      return reason === 'awaiting_human' ? '到达人工确认点：等待接受 / 返工决定' : '已中断（暂停）';
    }
    case 'run.resumed':
      return '已续跑';
    case 'human.instruction':
      return `人工指令：${trunc(String(p.text ?? p.note ?? ''))}`;
    case 'artifact.created':
      return '产物 bundle.html 已创建';
    case 'agent.thinking.delta':
      return '模型思考中…';
    case 'agent.tool.call':
      return `工具调用：${String(p.tool ?? p.name ?? '')}`;
    case 'agent.tool.result':
      return '工具返回结果';
    case 'error':
      return `错误：${trunc(String(p.message ?? ''))}`;
    default:
      return e.type;
  }
}

export function RunDashboard({ runId, requirement, config, onOpenReport, onBack }: Props) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<RunStatus>('unknown');
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({});
  const [hasArtifact, setHasArtifact] = useState(false);
  const [connected, setConnected] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [acting, setActing] = useState<'interrupt' | 'resume' | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let closed = false;

    const handleEvent = (e: RunEvent) => {
      if (closed) return;
      setEvents((prev) => {
        const next = [...prev, e];
        return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
      });
      switch (e.type) {
        case 'run.started':
        case 'run.resumed':
          setStatus('running');
          break;
        case 'run.interrupted':
          setStatus((e.payload as { reason?: string }).reason === 'awaiting_human' ? 'awaiting_human' : 'paused');
          break;
        case 'run.finished':
          setStatus('done');
          break;
        case 'run.failed':
          setStatus('failed');
          break;
        case 'artifact.created':
          setHasArtifact(true);
          break;
        case 'node.entered':
          if (e.node_id) setNodeStates((s) => ({ ...s, [e.node_id!]: 'active' }));
          break;
        case 'node.exited':
          if (e.node_id)
            setNodeStates((s) => ({ ...s, [e.node_id!]: e.payload.pass === false ? 'failed' : 'done' }));
          break;
        default:
          break;
      }
    };

    const es = openEventStream(
      runId,
      handleEvent,
      () => setConnected(false),
    );
    setConnected(true);

    // 兜底：用 report 同步一次状态（SSE 回放失败/已结束的场景也能拿到状态）。
    getReport(runId)
      .then((r) => {
        if (closed) return;
        setStatus((prev) => (prev === 'unknown' ? r.status : prev));
        if (r.status === 'done') setHasArtifact(true);
      })
      .catch(() => {
        /* 后端未启动时忽略 */
      });

    return () => {
      closed = true;
      es.close();
    };
  }, [runId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  const showArtifact = hasArtifact || status === 'done';
  const paused = status === 'paused';
  const awaiting = status === 'awaiting_human';
  const terminal = status === 'done' || status === 'failed';

  async function handleInterrupt() {
    setActing('interrupt');
    setActionMsg(null);
    try {
      await interruptRun(runId);
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(null);
    }
  }

  async function handleResume() {
    setActing('resume');
    setActionMsg(null);
    try {
      await resumeRun(runId, instruction.trim());
      setInstruction('');
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(null);
    }
  }

  /** 人工确认点：接受交付（无指令）。 */
  async function handleAccept() {
    setActing('resume');
    setActionMsg(null);
    try {
      await resumeRun(runId, '');
      setInstruction('');
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="dashboard">
      <div className="dash-top">
        <div className="dash-id">
          <button className="btn btn-ghost" onClick={onBack}>
            ← 新任务
          </button>
          <div>
            <div className="dash-runid">
              runId <code>{runId}</code>
            </div>
            <div className="dash-req">{trunc(requirement, 60) || '（无需求文本）'}</div>
          </div>
        </div>
        <StatusBadge status={status} />
        <button className="btn btn-primary" onClick={onOpenReport}>
          核验报告 →
        </button>
      </div>

      <div className="dash-grid">
        <aside className="panel panel-nodes">
          <h3>节点状态</h3>
          <NodeBar states={nodeStates} />
          <div className="agent-config-note">
            {Object.entries(config)
              .filter(([, v]) => !!v)
              .map(([id, v]) => (
                <div key={id} className="agent-config-row">
                  <span className="agent-config-id">{id}</span>
                  <span className="agent-config-val">
                    {v.model} · {v.effort === 'low' ? '低' : v.effort === 'high' ? '高' : '中'}
                  </span>
                </div>
              ))}
          </div>
        </aside>

        <section className="panel panel-events">
          <h3>
            实时事件流{' '}
            {connected ? <span className="live">● LIVE</span> : <span className="offline">● 断线</span>}
          </h3>
          <div className="event-list" ref={listRef}>
            {events.length === 0 && <div className="empty-note">等待事件…</div>}
            {events.map((e) => (
              <div key={e.seq} className={`evt evt-${e.type.replace(/\./g, '-')}`}>
                <span className="evt-seq">#{e.seq}</span>
                <span className="evt-type">{e.type}</span>
                <span className="evt-sum">{summarizeEvent(e)}</span>
              </div>
            ))}
          </div>
        </section>

        <aside className="panel panel-artifact">
          <h3>产物预览</h3>
          {showArtifact ? (
            <iframe title="bundle" src={artifactUrl(runId)} className="artifact-frame" />
          ) : (
            <div className="empty-note">产物生成后在此预览</div>
          )}
        </aside>
      </div>

      <div className="panel panel-controls">
        {awaiting ? (
          <div className="confirm-row">
            <span className="confirm-title">🛎 产物已生成，等你拍板：</span>
            <button
              className="btn btn-primary"
              onClick={handleAccept}
              disabled={acting !== null}
            >
              {acting === 'resume' ? '处理中…' : '✅ 接受交付'}
            </button>
            <input
              className="instr-input"
              placeholder="不满意？输入修改指令（如：加个计分板、背景换成深蓝）"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <button
              className="btn btn-warn"
              onClick={handleResume}
              disabled={acting !== null || instruction.trim().length === 0}
            >
              {acting === 'resume' ? '返工中…' : '🔧 返工'}
            </button>
            {actionMsg && <span className="action-msg">{actionMsg}</span>}
          </div>
        ) : (
          <>
            <button
              className="btn btn-warn"
              onClick={handleInterrupt}
              disabled={acting !== null || terminal}
            >
              {acting === 'interrupt' ? '中断中…' : '中断'}
            </button>
            <input
              className="instr-input"
              placeholder="插入人工指令（续跑时注入下一个 Agent 的上下文）"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={!paused}
            />
            <button
              className="btn btn-primary"
              onClick={handleResume}
              disabled={!paused || acting !== null}
            >
              {acting === 'resume' ? '续跑中…' : '续跑'}
            </button>
            {actionMsg && <span className="action-msg">{actionMsg}</span>}
            {!paused && !terminal && (
              <span className="control-hint">中断在下一个节点边界生效；暂停后可插入指令并续跑。</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
