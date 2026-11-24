import { useEffect, useState } from 'react';
import { addProvider, getProviders, removeProvider, startRun, testProvider } from '../api';
import type { AgentConfig, AgentConfigItem, HealthInfo, ProviderInfo } from '../types';

interface Props {
  requirement: string;
  setRequirement: (v: string) => void;
  onStarted: (runId: string, config: AgentConfig, mode: 'fixed' | 'auto') => void;
  health: HealthInfo | null;
}

// 设置持久化：切页/刷新不丢（localStorage）
function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem('ap-' + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveLS(key: string, value: unknown): void {
  try {
    localStorage.setItem('ap-' + key, JSON.stringify(value));
  } catch {
    /* 忽略 */
  }
}

const DEFAULT_LIMITS = {
  fix_rounds: 3,
  quality_rounds: 3,
  revise_rounds: 5,
  max_total_iters: 30,
  timeout_sec: 900,
  target_score: 5,
};

const AGENT_META: { id: string; label: string }[] = [
  { id: 'analyst', label: '分析师' },
  { id: 'builder', label: '生成者' },
  { id: 'critic', label: '软裁判' },
  { id: 'fixer', label: '修复者' },
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
  const [config, setConfig] = useState<AgentConfig>(() => loadLS('config', DEFAULT_CONFIG));
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [scheduler, setScheduler] = useState<'off' | 'quality' | 'saving'>(() => loadLS('scheduler', 'off'));
  const [mode, setMode] = useState<'fixed' | 'auto'>(() => loadLS('mode', 'fixed'));
  const [apiForm, setApiForm] = useState({ name: '', baseUrl: '', apiKey: '', models: '' });
  const [apiMsg, setApiMsg] = useState<string | null>(null);

  // 常见供应商速填（只留 API Key 给用户贴）
  const PROVIDER_PRESETS: { name: string; baseUrl: string; models: string }[] = [
    { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: 'deepseek-chat,deepseek-reasoner' },
    { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: 'qwen-max,qwen-plus' },
    { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: 'moonshot-v1-8k,moonshot-v1-32k' },
    { name: '智谱GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: 'glm-4-plus,glm-4-flash' },
  ];
  const [limits, setLimits] = useState(() => loadLS('limits', DEFAULT_LIMITS));

  // 任何设置变化都持久化（防止运行后切页重置为默认值）
  useEffect(() => {
    getProviders().then(setProviders).catch(() => setProviders([]));
  }, []);
  useEffect(() => saveLS('config', config), [config]);
  useEffect(() => saveLS('scheduler', scheduler), [scheduler]);
  useEffect(() => saveLS('mode', mode), [mode]);
  useEffect(() => saveLS('limits', limits), [limits]);

  async function submit() {
    if (!requirement.trim()) {
      setError('请先输入需求描述');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { runId } = await startRun(requirement.trim(), config, scheduler, limits, mode);
      onStarted(runId, config, mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitApi() {
    setApiMsg(null);
    if (!apiForm.name.trim() || !apiForm.baseUrl.trim() || !apiForm.apiKey.trim()) {
      setApiMsg('名称 / Base URL / API Key 不能为空');
      return;
    }
    const models = apiForm.models.split(',').map((s) => s.trim()).filter(Boolean);
    if (models.length === 0) {
      setApiMsg('模型列表不能为空：请至少填一个模型名（多个用英文逗号分隔，如 gpt-4o,gpt-4o-mini）。没有模型名，角色配置下拉里就不会出现任何选项。');
      return;
    }
    // Base URL 启发式警告：填了控制台/密钥管理页面地址而不是 API 接口地址
    const looksLikeConsole = /platform\.|console\.|api_keys|apikey\//i.test(apiForm.baseUrl);
    if (looksLikeConsole && !window.confirm('这个 Base URL 看起来是控制台/密钥管理页面，不是 API 接口地址。\n正确示例：DeepSeek 填 https://api.deepseek.com；通义千问填 https://dashscope.aliyuncs.com/compatible-mode/v1；Kimi 填 https://api.moonshot.cn/v1\n\n仍要按现在的内容保存吗？')) {
      return;
    }
    try {
      await addProvider({
        name: apiForm.name.trim(),
        baseUrl: apiForm.baseUrl.trim(),
        apiKey: apiForm.apiKey.trim(),
        models,
      });
      setApiMsg(`已接入「${apiForm.name.trim()}」`);
      setApiForm({ name: '', baseUrl: '', apiKey: '', models: '' });
      setProviders(await getProviders());
    } catch (e) {
      setApiMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function fetchModels() {
    setApiMsg(null);
    if (!apiForm.baseUrl.trim() || !apiForm.apiKey.trim()) {
      setApiMsg('先填 Base URL 和 API Key，再点「自动获取模型列表」');
      return;
    }
    setApiMsg('正在向该供应商查询真实模型列表…');
    try {
      const { models } = await testProvider({ baseUrl: apiForm.baseUrl.trim(), apiKey: apiForm.apiKey.trim() });
      setApiForm((f) => ({ ...f, models: models.join(',') }));
      setApiMsg(`已获取 ${models.length} 个真实模型名并自动填入：${models.slice(0, 6).join(', ')}${models.length > 6 ? '…' : ''}`);
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
          {health && (
            <span className="health-note">
              后端 {health.ok ? '在线' : '离线'} · 模型 <b>{health.model === 'fake' ? 'fake(演示)' : health.model}</b>
            </span>
          )}
        </div>
        {error && <div className="error-box">{error}</div>}
      </div>

      {/* ① 运行设置（常开）：编排/调度/目标评分/轮次上限 */}
      <div className="console-card config-panel">
        <div className="config-head">
          <span className="field-label">运行设置</span>
        </div>
        <div className="limits-row">
          <label>
            编排
            <select value={mode} onChange={(e) => setMode(e.target.value as 'fixed' | 'auto')}>
              <option value="fixed">固定流水线</option>
              <option value="auto">自主编排（分析师拆步骤→引擎自动调度）</option>
            </select>
          </label>
          <label>
            调度
            <select value={scheduler} onChange={(e) => setScheduler(e.target.value as 'off' | 'quality' | 'saving')}>
              <option value="off">手动指定</option>
              <option value="quality">智能·质量优先</option>
              <option value="saving">智能·省流</option>
            </select>
          </label>
          <label>
            目标评分
            <select
              value={limits.target_score}
              onChange={(e) => setLimits((l) => ({ ...l, target_score: Number(e.target.value) }))}
            >
              {[3, 4, 5].map((s) => (
                <option key={s} value={s}>
                  {s}/5
                </option>
              ))}
            </select>
          </label>
          <label>
            评分返工轮次
            <input
              type="number"
              min={0}
              max={9}
              value={limits.quality_rounds}
              onChange={(e) => setLimits((l) => ({ ...l, quality_rounds: Number(e.target.value) }))}
            />
          </label>
          <label>
            硬修复轮次
            <input
              type="number"
              min={0}
              max={9}
              value={limits.fix_rounds}
              onChange={(e) => setLimits((l) => ({ ...l, fix_rounds: Number(e.target.value) }))}
            />
          </label>
          <label>
            人工返工轮次
            <input
              type="number"
              min={0}
              max={9}
              value={limits.revise_rounds}
              onChange={(e) => setLimits((l) => ({ ...l, revise_rounds: Number(e.target.value) }))}
            />
          </label>
          <label>
            总轮次上限
            <input
              type="number"
              min={1}
              max={99}
              value={limits.max_total_iters}
              onChange={(e) => setLimits((l) => ({ ...l, max_total_iters: Number(e.target.value) }))}
            />
          </label>
          <label>
            单节点超时(秒)
            <input
              type="number"
              min={60}
              max={3600}
              value={limits.timeout_sec}
              onChange={(e) => setLimits((l) => ({ ...l, timeout_sec: Number(e.target.value) }))}
            />
          </label>
        </div>
        <p className="config-hint">
          评分循环语义：软裁判评分 &lt; 目标评分 → 先把当前版本打包留痕（bundle-vN）→ 问题抛回分析师重新分析 → 生成者改动 →
          再评分，直到达到目标分或评分返工轮次耗尽。日常测试省钱：目标评分 4、返工轮次 1。
        </p>
      </div>

      {/* ② 角色配置（常开） */}
      <div className="console-card config-panel">
        <div className="config-head">
          <span className="field-label">角色配置：每个角色用哪个供应商的哪个模型 / 多大思考强度</span>
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
                        p.models.length === 0 ? (
                          <option key={`${p.id}:empty`} value={`${p.id}:`} disabled>
                            {p.name}（未配置模型——请在「接入 API」里填模型列表）
                          </option>
                        ) : (
                          p.models.map((m) => (
                            <option key={`${p.id}:${m}`} value={`${p.id}:${m}`}>
                              {p.name} · {m}
                            </option>
                          ))
                        ),
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
          生成者/修复者/修改者建议保持强模型（代码质量决定成功率）；软裁判/分析师可换便宜模型省钱。
        </p>
      </div>

      {/* ③ 接入 API（常开） */}
      <div className="console-card config-panel">
        <div className="config-head">
          <span className="field-label">接入 API：填你自己的供应商（OpenAI 兼容口径：DeepSeek/通义千问/Kimi/智谱/OpenAI 等）</span>
        </div>
        <div className="api-guide">
          <b>📋 接入四步（跟着做就不会错）：</b>
          <ol>
            <li><b>点</b>下面任意一个供应商按钮 —— 名称、地址、模型名自动填好；</li>
            <li><b>贴</b>你自己的 API Key（唯一要你动手的）；</li>
            <li><b>点「自动获取模型列表」</b> —— 向接口核实真实模型名（防止手填错）；</li>
            <li><b>保存</b> → 去「角色配置」把<b>每个角色</b>的模型都换成这个供应商，再点「开始生成」。</li>
          </ol>
        </div>
        <div className="api-presets">
          <span className="config-hint">👇 第 1 步：先点一个（自动填好，只需贴 Key）：</span>
          {PROVIDER_PRESETS.map((p) => (
            <button
              key={p.name}
              className="btn btn-accent"
              onClick={() => setApiForm((f) => ({ ...f, name: p.name, baseUrl: p.baseUrl, models: p.models, apiKey: '' }))}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="api-form">
          <input
            className="api-input"
            placeholder="名称（点上面按钮会自动填）"
            value={apiForm.name}
            onChange={(e) => setApiForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            className="api-input api-input-wide"
            placeholder="Base URL（点上面按钮会自动填）"
            value={apiForm.baseUrl}
            onChange={(e) => setApiForm((f) => ({ ...f, baseUrl: e.target.value }))}
          />
          <input
            className="api-input"
            type="password"
            placeholder="API Key（第 2 步：粘贴你的 Key）"
            value={apiForm.apiKey}
            onChange={(e) => setApiForm((f) => ({ ...f, apiKey: e.target.value }))}
          />
          <input
            className="api-input"
            placeholder="模型列表（第 3 步：点「自动获取模型列表」自动填）"
            value={apiForm.models}
            onChange={(e) => setApiForm((f) => ({ ...f, models: e.target.value }))}
          />
          <button className="btn btn-primary" onClick={submitApi}>
            第 4 步 · 保存供应商
          </button>
          <button className="btn btn-accent" onClick={fetchModels} title="向该供应商接口查询真实模型名，自动填入模型列表（推荐，避免手填错模型名）">
            第 3 步 · 自动获取模型列表
          </button>
        </div>
        {apiMsg && <div className="api-msg">{apiMsg}</div>}
        <div className="api-list">
          {providers.length === 0 && <span className="config-hint">尚未接入任何供应商</span>}
          {providers.map((p) => (
            <span key={p.id} className="api-chip">
              {p.name}（{p.models.join(' / ')}）
              {p.id !== 'deepseek' && p.id !== 'qwen' && (
                <button className="api-del" onClick={() => removeApi(p.id)} title="删除该供应商">
                  删除
                </button>
              )}
            </span>
          ))}
        </div>
        <p className="config-hint">
          保存后，「角色配置」的模型下拉会立即出现该供应商的模型，任意角色可选用。Key 只保存在本地 providers.json，不上传。
        </p>
      </div>
    </div>
  );
}
