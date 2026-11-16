import { useEffect, useState } from 'react';
import { getHealth } from './api';
import type { AgentConfig, HealthInfo } from './types';
import { TaskConsole } from './components/TaskConsole';
import { RunDashboard } from './components/RunDashboard';
import { VerifyReport } from './components/VerifyReport';

type View = 'console' | 'dashboard' | 'report';

export default function App() {
  const [view, setView] = useState<View>('console');
  const [runId, setRunId] = useState<string | null>(null);
  const [requirement, setRequirement] = useState('');
  const [config, setConfig] = useState<AgentConfig>({});
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  function handleStarted(id: string, cfg: AgentConfig) {
    setRunId(id);
    setConfig(cfg);
    setView('dashboard');
  }

  const tabs: { key: View; label: string; disabled: boolean }[] = [
    { key: 'console', label: '① 任务台', disabled: false },
    { key: 'dashboard', label: '② 运行看板', disabled: !runId },
    { key: 'report', label: '③ 核验报告', disabled: !runId },
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
          </div>
        )}
      </header>

      <main className="main">
        {view === 'console' && (
          <TaskConsole
            requirement={requirement}
            setRequirement={setRequirement}
            onStarted={handleStarted}
            health={health}
          />
        )}

        {view === 'dashboard' && runId && (
          <RunDashboard
            runId={runId}
            requirement={requirement}
            config={config}
            onOpenReport={() => setView('report')}
            onBack={() => setView('console')}
          />
        )}

        {view === 'report' && runId && (
          <VerifyReport runId={runId} onBack={() => setView('dashboard')} />
        )}
      </main>
    </div>
  );
}
