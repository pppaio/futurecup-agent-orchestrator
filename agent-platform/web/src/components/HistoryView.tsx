import { useEffect, useState } from 'react';
import { getRuns, type RunHistoryItem } from '../api';
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

export function HistoryView({ onOpen, refreshKey }: Props) {
  const [runs, setRuns] = useState<RunHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getRuns()
      .then(setRuns)
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  return (
    <div className="history-view">
      <div className="history-head">
        <h2>历史记录</h2>
        <span className="config-hint">
          每次运行的事件流/产物/截图都落在本机 runs/ 目录，刷新或重启服务都不丢。点击任意一条可回看。
        </span>
      </div>
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
            {runs.map((r) => (
              <tr key={r.runId}>
                <td className="hist-time">{fmtTime(r.startedAt)}</td>
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
                  <button className="btn btn-ghost" onClick={() => onOpen(r)}>
                    查看 →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
