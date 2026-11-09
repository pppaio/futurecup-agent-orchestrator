import { useEffect, useState } from 'react';
import { artifactUrl, getReport } from '../api';
import { fmtWall, StatusBadge } from '../bits';
import type { HardError, RunReport } from '../types';
import { ErrorCurveChart } from './ErrorCurveChart';

interface Props {
  runId: string;
  onBack: () => void;
}

function errLabel(t: HardError['type']): string {
  switch (t) {
    case 'console':
      return 'console 报错';
    case 'pageerror':
      return '页面异常';
    case 'timeout':
      return '加载超时';
    default:
      return t;
  }
}

export function VerifyReport({ runId, onBack }: Props) {
  const [report, setReport] = useState<RunReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setReport(await getReport(runId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return (
    <div className="report-view">
      <div className="dash-top">
        <div className="dash-id">
          <button className="btn btn-ghost" onClick={onBack}>
            ← 看板
          </button>
          <div className="dash-runid">
            runId <code>{runId}</code>
          </div>
        </div>
        {report && <StatusBadge status={report.status} />}
        <div className="report-actions">
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? '加载中…' : '刷新'}
          </button>
          <a className="btn btn-primary" href={artifactUrl(runId)} download target="_blank" rel="noreferrer">
            下载产物
          </a>
        </div>
      </div>

      {loading && <div className="empty-note">报告加载中…</div>}
      {error && <div className="error-box">报告加载失败：{error}</div>}

      {report && !loading && (
        <>
          <div className="metric-row">
            <div className="metric-card">
              <div className="metric-label">总耗时 wall_ms</div>
              <div className="metric-value">{fmtWall(report.wall_ms)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">硬验证次数 verify_count</div>
              <div className="metric-value">{report.verify_count}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">软评分 score</div>
              <div className="metric-value">
                {report.soft_report ? `${report.soft_report.score} / 5` : '—'}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">最近硬验证 last_ok</div>
              <div className={`metric-value ${report.last_ok ? 'ok' : 'bad'}`}>
                {report.last_ok === null ? '—' : report.last_ok ? '通过' : '未通过'}
              </div>
            </div>
          </div>

          <div className="report-grid">
            <section className="panel">
              <h3>error_curve 条形图</h3>
              <ErrorCurveChart data={report.error_curve} />
            </section>

            <section className="panel">
              <h3>硬验证明细（last_errors）</h3>
              {report.last_errors.length === 0 ? (
                <div className="empty-note">最近一次硬验证无错误</div>
              ) : (
                <ul className="hard-errors">
                  {report.last_errors.map((e, i) => (
                    <li key={i} className="hard-error">
                      <span className="err-tag">{errLabel(e.type)}</span>
                      <div className="err-msg">
                        {e.line !== undefined && <span className="err-line">L{e.line}</span>}
                        {e.message}
                      </div>
                      {e.stack && <pre className="err-stack">{e.stack}</pre>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <h3>软裁判评分（soft_report）</h3>
              {report.soft_report ? (
                <>
                  <div className="soft-score">
                    <span className="soft-num">{report.soft_report.score}</span>
                    <span className="soft-of">/ 5</span>
                  </div>
                  <h4 className="sub-head">缺口 gaps（{report.soft_report.gaps.length}）</h4>
                  {report.soft_report.gaps.length === 0 ? (
                    <div className="empty-note">无缺口</div>
                  ) : (
                    <ul className="gaps">
                      {report.soft_report.gaps.map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <div className="empty-note">暂无软裁判结果</div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
