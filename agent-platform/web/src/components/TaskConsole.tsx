import { useState } from 'react';
import { startRun } from '../api';
import type { AgentConfig, AgentConfigItem, HealthInfo } from '../types';

interface Props {
  requirement: string;
  setRequirement: (v: string) => void;
  onStarted: (runId: string, config: AgentConfig) => void;
  health: HealthInfo | null;
}

const AGENT_META: { id: string; label: string }[] = [
  { id: 'analyst', label: '分析师' },
  { id: 'builder', label: '生成者' },
  { id: 'critic', label: '软裁判' },
  { id: 'fixer', label: '修复者' },
  { id: 'reviser', label: '修改者' },
];

const MODELS = ['deepseek-v4-pro', 'deepseek-flash'];
const EFFORTS: { value: AgentConfigItem['effort']; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

const DEFAULT_CONFIG: AgentConfig = {
  analyst: { model: 'deepseek-v4-pro', effort: 'low' },
  builder: { model: 'deepseek-v4-pro', effort: 'high' },
  critic: { model: 'deepseek-v4-pro', effort: 'low' },
  fixer: { model: 'deepseek-v4-pro', effort: 'high' },
  reviser: { model: 'deepseek-v4-pro', effort: 'high' },
};

function applyPreset(preset: 'balanced' | 'saving' | 'best'): AgentConfig {
  const set = (effort: AgentConfigItem['effort'], model: string): AgentConfig => ({
    analyst: { model, effort: 'low' },
    builder: { model: 'deepseek-v4-pro', effort },
    critic: { model, effort: 'low' },
    fixer: { model: 'deepseek-v4-pro', effort },
    reviser: { model: 'deepseek-v4-pro', effort },
  });
  switch (preset) {
    case 'saving':
      return set('medium', 'deepseek-flash');
    case 'best':
      return set('high', 'deepseek-v4-pro');
    default:
      return set('high', 'deepseek-v4-pro');
  }
}

export function TaskConsole({ requirement, setRequirement, onStarted, health }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG);

  async function submit() {
    if (!requirement.trim()) {
      setError('请先输入需求描述');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { runId } = await startRun(requirement.trim(), config);
      onStarted(runId, config);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="console-view">
      <div className="claim">
        <h1>能不能跑，机器说了算</h1>
        <p>
          输入一句话需求，Agent 编排引擎完成「分析 → 生成 → 无头浏览器硬验证 → 低分返工 → 失败回灌修复 → 打包」的闭环，
          并在交付前<span>等你确认</span>——不满意就一句修改指令打回重做，历史版本可回退。
        </p>
      </div>

      <div className="console-card">
        <label className="field-label" htmlFor="requirement">
          需求描述
        </label>
        <textarea
          id="requirement"
          className="requirement-input"
          placeholder="例如：做一个可玩的打砖块小游戏，canvas 渲染，球拍可左右控制"
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
          rows={6}
        />
        <div className="console-actions">
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? '提交中…' : '开始生成'}
          </button>
          <button className="btn btn-ghost" onClick={() => setShowConfig((s) => !s)}>
            {showConfig ? '收起角色配置 ▲' : '角色配置（模型/思考强度）▼'}
          </button>
          {health && (
            <span className="health-note">
              后端 {health.ok ? '在线' : '离线'} · 模型{' '}
              <b>{health.model === 'fake' ? 'fake(演示)' : health.model}</b> · 历史 run {health.runs}
            </span>
          )}
        </div>
        {error && <div className="error-box">{error}</div>}
      </div>

      {showConfig && (
        <div className="console-card config-panel">
          <div className="config-head">
            <span className="field-label">每个角色用哪个模型 / 多大思考强度</span>
            <span className="config-presets">
              <button className="btn btn-ghost" onClick={() => setConfig(applyPreset('balanced'))}>
                默认均衡
              </button>
              <button className="btn btn-ghost" onClick={() => setConfig(applyPreset('saving'))}>
                省流（裁判/分析用 Flash）
              </button>
              <button className="btn btn-ghost" onClick={() => setConfig(applyPreset('best'))}>
                全 Pro 最强
              </button>
            </span>
          </div>
          <table className="config-table">
            <thead>
              <tr>
                <th>角色</th>
                <th>模型</th>
                <th>思考强度</th>
              </tr>
            </thead>
            <tbody>
              {AGENT_META.map((a) => {
                const item = config[a.id] ?? DEFAULT_CONFIG[a.id];
                return (
                  <tr key={a.id}>
                    <td>{a.label}</td>
                    <td>
                      <select
                        value={item.model}
                        onChange={(e) =>
                          setConfig((c) => ({ ...c, [a.id]: { ...c[a.id], model: e.target.value } }))
                        }
                      >
                        {MODELS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={item.effort}
                        onChange={(e) =>
                          setConfig((c) => ({
                            ...c,
                            [a.id]: { ...c[a.id], effort: e.target.value as AgentConfigItem['effort'] },
                          }))
                        }
                      >
                        {EFFORTS.map((ef) => (
                          <option key={ef.value} value={ef.value}>
                            {ef.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="config-hint">
            生成者/修复者/修改者建议保持 v4-pro（代码质量决定成功率）；软裁判/分析师可换 Flash 省钱。
          </p>
        </div>
      )}
    </div>
  );
}
