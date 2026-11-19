import type { AgentConfig, HealthInfo, ProviderInfo, RunEvent, RunReport } from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = String(body.error);
    } catch {
      /* 忽略非 JSON 响应体 */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export interface RunLimits {
  fix_rounds?: number;
  quality_rounds?: number;
  revise_rounds?: number;
  max_total_iters?: number;
  timeout_sec?: number;
}

export async function startRun(
  requirement: string,
  config?: AgentConfig,
  scheduler?: 'off' | 'quality' | 'saving',
  limits?: RunLimits,
  mode?: 'fixed' | 'auto',
): Promise<{ runId: string }> {
  const res = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requirement, config, scheduler, limits, mode }),
  });
  return json<{ runId: string }>(res);
}

export async function interruptRun(runId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/runs/${runId}/interrupt`, { method: 'POST' });
  return json<{ ok: boolean }>(res);
}

export async function resumeRun(runId: string, instruction: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/runs/${runId}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction }),
  });
  return json<{ ok: boolean }>(res);
}

export async function getReport(runId: string): Promise<RunReport> {
  const res = await fetch(`/api/runs/${runId}/report`);
  return json<RunReport>(res);
}

export async function getHealth(): Promise<HealthInfo> {
  const res = await fetch('/api/health');
  return json<HealthInfo>(res);
}

export async function getProviders(): Promise<ProviderInfo[]> {
  const res = await fetch('/api/providers');
  if (!res.ok) return [];
  return (await res.json()) as ProviderInfo[];
}

export async function addProvider(input: {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}): Promise<ProviderInfo> {
  const res = await fetch('/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return json<ProviderInfo>(res);
}

export async function removeProvider(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/providers/${id}`, { method: 'DELETE' });
  return json<{ ok: boolean }>(res);
}

export interface BalanceInfo {
  providers: { id: string; name: string; balance: string | null; currency: string }[];
  fetched_at: number;
}

export async function getBalance(): Promise<BalanceInfo | null> {
  try {
    const res = await fetch('/api/balance');
    if (!res.ok) return null;
    return (await res.json()) as BalanceInfo;
  } catch {
    return null;
  }
}

export interface RunHistoryItem {
  runId: string;
  requirement: string;
  workflow: string;
  status: RunReport['status'];
  startedAt: number;
  latestScore: number | null;
}

export async function getRuns(): Promise<RunHistoryItem[]> {
  const res = await fetch('/api/runs');
  if (!res.ok) return [];
  return (await res.json()) as RunHistoryItem[];
}

export async function deleteRun(runId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
  return json<{ ok: boolean }>(res);
}

/** 打开 SSE 事件流；后端会先回放历史事件再推增量。 */
export function openEventStream(
  runId: string,
  onEvent: (e: RunEvent) => void,
  onError?: () => void,
): EventSource {
  const es = new EventSource(`/api/runs/${runId}/events`);
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as RunEvent);
    } catch {
      /* 忽略无法解析的行 */
    }
  };
  if (onError) es.onerror = onError;
  return es;
}

export const artifactUrl = (runId: string, version?: number) =>
  version && version > 0 ? `/api/runs/${runId}/artifact?v=${version}` : `/api/runs/${runId}/artifact`;
