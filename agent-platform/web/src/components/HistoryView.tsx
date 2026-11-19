import { useEffect, useState } from 'react';
import { deleteRun, getRuns, type RunHistoryItem } from '../api';
import { STATUS_LABEL } from '../bits';

interface Props {
  onOpen: (item: RunHistoryItem) => void;
  refreshKey: number;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ACTIVE_STATUSES = ['running', 'paused', 'awaiting_human'];

export function HistoryView({ onOpen, refreshKey }: Props) {
  const [runs, setRuns] = useState<RunHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try {
      const list = await getRuns();
      // 在途 run 置顶（运行中的项目一眼可见）
      list.sort(
        (a, b) =>
          Number(ACTIVE_STATUSES.includes(b.status)) - Number(ACTIVE_STATUSES.includes(a.status)) ||
          b.startedAt - a.startedAt,
      );
      setRuns(list);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // 有在途 run 时自动刷新（运行中的项目实时反映在这里）
  useEffect(() => {
    if (runs.length === 0) return;
    const hasActive = runs.some((r) => ACTIVE_STATUSES.includes(r.status));
    if (!hasActive) return;
    const t = setInterval(() => void load(), 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs]);

  async function handleDelete(r: RunHistoryItem) {
    const active = ACTIVE_STATUSES.includes(r.status);
    const note = active
      ? `该运行正在进行（${STATUS_LABEL[r.status]}），删除会先中断再删除。确定？`
      : `删除该运行及其全部产物（事件流/版本/截图）？不可恢复。`;
    if (!window.confirm(note)) return;
    setMsg(null);
    try {
      await deleteRun(r.runId);
      setMsg(active ? `已中断并删除 ${r.runId}` : `已删除 ${r.runId}`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="history-view">
      <div className="history-head">
        <h2>历史记录</h2>
        <span className="config-hint">
          每次运行的事件流/产物/截图都落在本机 runs/ 目录。运行中的项目置顶显示并自动刷新；删除会连同产物一起清除。
        </span>
      </div>
      {msg && <div className="api-msg">{msg}</div>}
      {loading && <div className="empty-note">加载中…</div>}
      {!loading && runs.length === 0 && <div className="empty-note">还没有任何运行记录</div>}
      {!loading && runs.length > 0 && (
        <table className="history-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>需求</th>
              <th>编排</th>
              <th>评分</th>
              <th>状态</th>
              <th>runId</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const active = ACTIVE_STATUSES.includes(r.status);
              return (
                <tr key={r.runId} className={active ? 'hist-row-active' : ''}>
                  <td className="hist-time">
                    {fmtTime(r.startedAt)}
                    {active && <span className="hist-live"> ● 进行中</span>}
                  </td>
                  <td className="hist-req">{r.requirement.length > 40 ? r.requirement.slice(0, 40) + '…' : r.requirement}</td>
                  <td>{r.workflow.startsWith('auto') ? '🧠 自主编排' : '⚙️ 固定流水线'}</td>
                  <td>{r.latestScore !== null ? `${r.latestScore}/5` : '—'}</td>
                  <td>
                    <span className={`hist-status hist-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                  </td>
                  <td>
                    <code className="hist-id">{r.runId}</code>
                  </td>
                  <td>
                    <span className="hist-actions">
                      <button className="btn btn-ghost" onClick={() => onOpen(r)}>
                        查看 →
                      </button>
                      <button className="btn btn-danger-sm" onClick={() => void handleDelete(r)}>
                        {active ? '中断并删除' : '删除'}
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
