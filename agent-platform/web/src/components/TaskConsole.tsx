import { useEffect, useState } from 'react';
import { addProvider, getProviders, removeProvider, startRun } from '../api';
import type { AgentConfig, AgentConfigItem, HealthInfo, ProviderInfo } from '../types';

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

const EFFORTS: { value: AgentConfigItem['effort']; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

const DEFAULT_CONFIG: AgentConfig = {
  analyst: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'low' },
  builder: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'high' },
  critic: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'low' },
  fixer: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'high' },
  reviser: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'high' },
};

function applyPreset(preset: 'balanced' | 'saving' | 'best'): AgentConfig {
  const set = (effort: AgentConfigItem['effort'], provider: string, model: string): AgentConfig => ({
    analyst: { provider, model, effort: 'low' },
    builder: { provider: 'deepseek', model: 'deepseek-v4-pro', effort },
    critic: { provider, model, effort: 'low' },
    fixer: { provider: 'deepseek', model: 'deepseek-v4-pro', effort },
    reviser: { provider: 'deepseek', model: 'deepseek-v4-pro', effort },
  });
  switch (preset) {
    case 'saving':
      return set('medium', 'deepseek', 'deepseek-flash');
    case 'best':
      return set('high', 'deepseek', 'deepseek-v4-pro');
    default:
      return set('high', 'deepseek', 'deepseek-v4-pro');
  }
}

export function TaskConsole({ requirement, setRequirement, onStarted, health }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [scheduler, setScheduler] = useState<'off' | 'quality' | 'saving'>('off');
  const [showApiPanel, setShowApiPanel] = useState(false);
  const [apiForm, setApiForm] = useState({ name: '', baseUrl: '', apiKey: '', models: '' });
  const [apiMsg, setApiMsg] = useState<string | null>(null);

  useEffect(() => {
    getProviders().then(setProviders).catch(() => setProviders([]));
  }, []);

  async function submitApi() {
    setApiMsg(null);
    if (!apiForm.name.trim() || !apiForm.baseUrl.trim() || !apiForm.apiKey.trim()) {
      setApiMsg('名称 / Base URL / API Key 不能为空');
      return;
    }
    try {
      await addProvider({
        name: apiForm.name.trim(),
        baseUrl: apiForm.baseUrl.trim(),
        apiKey: apiForm.apiKey.trim(),
        models: apiForm.models.split(',').map((s) => s.trim()).filter(Boolean),
      });
      setApiMsg(`已接入「${apiForm.name.trim()}」`);
      setApiForm({ name: '', baseUrl: '', apiKey: '', models: '' });
      setProviders(await getProviders());
    } catch (e) {
      setApiMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeApi(id: string) {
    try {
      await removeProvider(id);
      setProviders(await getProviders());
    } catch (e) {
      setApiMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function submit() {
    if (!requirement.trim()) {
      setError('请先输入需求描述');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { runId } = await startRun(requirement.trim(), config, scheduler);
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
          <button className="btn btn-ghost" onClick={() => setShowApiPanel((s) => !s)}>
            {showApiPanel ? '收起接入 API ▲' : '接入 API / 供应商▼'}
          </button>
          <label className="scheduler-toggle">
            调度：
            <select value={scheduler} onChange={(e) => setScheduler(e.target.value as 'off' | 'quality' | 'saving')}>
              <option value="off">手动指定</option>
              <option value="quality">智能·质量优先</option>
              <option value="saving">智能·省流</option>
            </select>
          </label>
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
                const curProvider = item.provider ?? 'deepseek';
                const curModels = providers.find((p) => p.id === curProvider)?.models ?? [
                  'deepseek-v4-pro',
                  'deepseek-flash',
                ];
                return (
                  <tr key={a.id}>
                    <td>{a.label}</td>
                    <td>
                      <select
                        value={`${curProvider}:${item.model ?? curModels[0]}`}
                        onChange={(e) => {
                          const [p, m] = e.target.value.split(':');
                          setConfig((c) => ({
                            ...c,
                            [a.id]: { ...c[a.id], provider: p, model: m },
                          }));
                        }}
                      >
                        {providers.length === 0 && (
                          <option value={`deepseek:${item.model}`}>{item.model}</option>
                        )}
                        {providers.map((p) =>
                          p.models.map((m) => (
                            <option key={`${p.id}:${m}`} value={`${p.id}:${m}`}>
                              {p.name} · {m}
                            </option>
                          )),
                        )}
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
            生成者/修复者/修改者建议保持强模型（代码质量决定成功率）；软裁判/分析师可换便宜模型省钱。接入更多供应商：在下方「接入 API」面板填写，或 .env 加 PROVIDER_&lt;ID&gt;_*。
          </p>
        </div>
      )}

      {showApiPanel && (
        <div className="console-card config-panel">
          <div className="config-head">
            <span className="field-label">接入你自己的 API 供应商（OpenAI 兼容口径：通义/智谱/月之暗面/OpenAI 等）</span>
          </div>
          <div className="api-form">
            <input
              className="api-input"
              placeholder="名称（如：通义千问）"
              value={apiForm.name}
              onChange={(e) => setApiForm((f) => ({ ...f, name: e.target.value }))}
            />
            <input
              className="api-input api-input-wide"
              placeholder="Base URL（如 https://dashscope.aliyuncs.com/compatible-mode/v1）"
              value={apiForm.baseUrl}
              onChange={(e) => setApiForm((f) => ({ ...f, baseUrl: e.target.value }))}
            />
            <input
              className="api-input"
              type="password"
              placeholder="API Key"
              value={apiForm.apiKey}
              onChange={(e) => setApiForm((f) => ({ ...f, apiKey: e.target.value }))}
            />
            <input
              className="api-input"
              placeholder="模型列表，逗号分隔（如 qwen-max,qwen-plus）"
              value={apiForm.models}
              onChange={(e) => setApiForm((f) => ({ ...f, models: e.target.value }))}
            />
            <button className="btn btn-primary" onClick={submitApi}>
              保存供应商
            </button>
          </div>
          {apiMsg && <div className="api-msg">{apiMsg}</div>}
          <div className="api-list">
            {providers.length === 0 && <span className="config-hint">尚未接入任何供应商</span>}
            {providers.map((p) => (
              <span key={p.id} className="api-chip">
                {p.name}（{p.models.join(' / ')}）
                {p.id !== 'deepseek' && p.id !== 'qwen' && (
                  <button className="api-del" onClick={() => removeApi(p.id)} title="删除">
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
          <p className="config-hint">
            保存后，「角色配置」的模型下拉会立即出现该供应商的模型，任意角色可选用。Key 只保存在本地
            providers.json，不上传。
          </p>
        </div>
      )}
    </div>
  );
}
