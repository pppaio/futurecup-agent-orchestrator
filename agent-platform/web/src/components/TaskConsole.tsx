import { useState } from 'react';
import { startRun } from '../api';
import type { HealthInfo } from '../types';

interface Props {
  requirement: string;
  setRequirement: (v: string) => void;
  onStarted: (runId: string) => void;
  health: HealthInfo | null;
}

export function TaskConsole({ requirement, setRequirement, onStarted, health }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!requirement.trim()) {
      setError('请先输入需求描述');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { runId } = await startRun(requirement.trim());
      onStarted(runId);
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
          输入一句话需求，Agent 编排引擎完成「分析 → 生成 → 无头浏览器硬验证 → 失败回灌修复 → 打包」的闭环，
          交付一个<b>确定可运行</b>的软件产物。
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
              后端 {health.ok ? '在线' : '离线'} · 模型{' '}
              <b>{health.model === 'fake' ? 'fake(演示)' : health.model}</b> · 历史 run {health.runs}
            </span>
          )}
        </div>
        {error && <div className="error-box">{error}</div>}
      </div>
    </div>
  );
}
