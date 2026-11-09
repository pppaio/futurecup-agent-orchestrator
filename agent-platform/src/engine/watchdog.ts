import type { HardReport, RunEvent } from '../types.js';
import { normalizeErrors } from '../reducer.js';

export type WatchdogAction = 'continue' | 'escalate' | 'abort';
export interface WatchdogVerdict {
  progress: boolean;
  reason: string;
  action: WatchdogAction;
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/**
 * Loop Watchdog：外部只读观察者，只看硬信号（事件流），不看 Agent 自述。
 * 收敛判据（落码）：
 *  1. 轮次上限 —— 由 loop.max_iters 在引擎侧兜底（不在此处）
 *  2. 错误数连续 2 轮不降 → escalate（无实质进展）
 *  3. 错误卡片集合重复出现 → escalate（修复者没抓到根因）
 *  4. 修复者输出与上一轮完全相同 → abort（防御性妥协，假进展）
 */
export class LoopWatchdog {
  private errorCurve: number[] = [];
  private consecutiveNoDrop = 0;
  private lastCardKey: string | null = null;
  private repeatCardCount = 0;
  private fixerOutputCounts = new Map<string, number>();

  onEvent(e: RunEvent): void {
    if (e.type === 'verify.hard.result') {
      const report = e.payload as unknown as HardReport;
      this.errorCurve.push(report.errors.length);
      const cards = normalizeErrors(report);
      const key = JSON.stringify(cards.map((c) => c.category + ':' + c.message));
      if (this.lastCardKey !== null && key === this.lastCardKey && cards.length > 0) {
        this.repeatCardCount++;
      }
      this.lastCardKey = key;
      const n = this.errorCurve.length;
      if (n >= 2 && this.errorCurve[n - 1] >= this.errorCurve[n - 2]) {
        this.consecutiveNoDrop++;
      } else {
        this.consecutiveNoDrop = 0;
      }
    }
    if (e.type === 'agent.message' && e.agent_id === 'fixer' && e.payload) {
      const role = (e.payload as { role?: string }).role;
      if (role === 'assistant') {
        const fp = hashString((e.payload as { text?: string }).text ?? '');
        this.fixerOutputCounts.set(fp, (this.fixerOutputCounts.get(fp) ?? 0) + 1);
      }
    }
  }

  verdict(): WatchdogVerdict {
    if (this.errorCurve.length >= 2 && this.consecutiveNoDrop >= 2) {
      return { progress: false, reason: '错误数连续 2 轮不降', action: 'escalate' };
    }
    if (this.repeatCardCount >= 1) {
      return { progress: false, reason: '错误卡片集合重复出现，未命中根因', action: 'escalate' };
    }
    for (const [, v] of this.fixerOutputCounts) {
      if (v >= 2) return { progress: false, reason: '修复者输出与上一轮完全相同（假进展）', action: 'abort' };
    }
    return { progress: true, reason: 'ok', action: 'continue' };
  }

  reset(): void {
    this.errorCurve = [];
    this.consecutiveNoDrop = 0;
    this.lastCardKey = null;
    this.repeatCardCount = 0;
    this.fixerOutputCounts.clear();
  }
}
