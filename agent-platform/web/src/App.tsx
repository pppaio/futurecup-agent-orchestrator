import { useEffect, useState } from 'react';
import { getBalance, getHealth, getRuns, type RunHistoryItem } from './api';
import type { BalanceInfo } from './api';
import type { AgentConfig, HealthInfo } from './types';
import { TaskConsole } from './components/TaskConsole';
import { RunDashboard } from './components/RunDashboard';
import { VerifyReport } from './components/VerifyReport';
import { HistoryView } from './components/HistoryView';

type View = 'console' | 'dashboard' | 'report' | 'history';

export default function App() {
  const [view, setView] = useState<View>('console');
  const [runId, setRunId] = useState<string | null>(null);
  const [requirement, setRequirement] = useState('');
  const [config, setConfig] = useState<AgentConfig>({});
  const [mode, setMode] = useState<'fixed' | 'auto'>('fixed');
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [activeRun, setActiveRun] = useState<RunHistoryItem | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
    getBalance()
      .then(setBalance)
      .catch(() => setBalance(null));
    // 刷新恢复：找最近一条未完成的运行，提示「继续」
    getRuns()
      .then((runs) => {
        const active = runs.find((r) => ['running', 'paused', 'awaiting_human'].includes(r.status));
        setActiveRun(active ?? null);
      })
      .catch(() => setActiveRun(null));
  }, []);

  function handleStarted(id: string, cfg: AgentConfig, runMode: 'fixed' | 'auto') {
    setRunId(id);
    setConfig(cfg);
    setMode(runMode);
    setView('dashboard');
    setActiveRun(null);
    setHistoryKey((k) => k + 1);
  }

  function openFromHistory(item: RunHistoryItem) {
    setRunId(item.runId);
    setRequirement(item.requirement);
    setMode(item.workflow.startsWith('auto') ? 'auto' : 'fixed');
    setView(item.status === 'done' || item.status === 'failed' ? 'report' : 'dashboard');
  }

  function resumeActive() {
    if (!activeRun) return;
    openFromHistory(activeRun);
    setActiveRun(null);
  }

  const tabs: { key: View; label: string; disabled: boolean }[] = [
    { key: 'console', label: '① 任务台', disabled: false },
    { key: 'dashboard', label: '② 运行看板', disabled: false },
    { key: 'report', label: '③ 核验报告', disabled: false },
    { key: 'history', label: '④ 历史记录', disabled: false },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">Agent 编排平台</span>
        </div>
        <nav className="tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`tab ${view === t.key ? 'tab-active' : ''}`}
              disabled={t.disabled}
              onClick={() => setView(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {health && (
          <div className="topbar-health">
            <span className={`dot ${health.ok ? 'dot-ok' : 'dot-bad'}`} />
            {health.ok ? '后端在线' : '后端离线'} · {health.model}
            {balance && (
              <>
                {balance.providers
                  .filter((p) => p.balance !== null)
                  .map((p) => (
                    <span key={p.id} className="topbar-balance">
                      {p.name}余额 <b className="balance-num">¥{p.balance}</b>
                    </span>
                  ))}
              </>
            )}
          </div>
        )}
      </header>

      <main className="main">
        {view === 'console' && (
          <>
            {activeRun && (
              <div className="resume-banner">
                <span>
                  ⚠️ 有未完成的运行 <code>{activeRun.runId}</code>（{activeRun.requirement.slice(0, 30)}
                  ）——刷新前的工作还在，点「继续」回到看板。
                </span>
                <button className="btn btn-primary" onClick={resumeActive}>
                  继续
                </button>
              </div>
            )}
            <TaskConsole
              requirement={requirement}
              setRequirement={setRequirement}
              onStarted={handleStarted}
              health={health}
            />
          </>
        )}

        {view === 'dashboard' && (
          <RunDashboard
            runId={runId}
            requirement={requirement}
            config={config}
            mode={mode}
            onOpenReport={() => setView('report')}
            onBack={() => setView('console')}
          />
        )}

        {view === 'report' && (
          <VerifyReport runId={runId} onBack={() => setView('dashboard')} />
        )}

        {view === 'history' && (
          <HistoryView
            onOpen={openFromHistory}
            refreshKey={historyKey}
          />
        )}
      </main>
    </div>
  );
}
