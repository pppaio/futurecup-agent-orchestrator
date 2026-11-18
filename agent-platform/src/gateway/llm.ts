import type { AgentProfile } from '../types.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
}

export interface LLMResult {
  text: string;
  json?: unknown;
  usage: LLMUsage;
}

export interface LLMGateway {
  complete(opts: {
    agent: AgentProfile;
    messages: LLMMessage[];
    json?: boolean;
  }): Promise<LLMResult>;
}

/**
 * Fake 网关：先用它跑通全链路，不花一分钱。
 * handlers 按 agent id 返回固定文本（可含 JSON）。
 */
export class FakeLLM implements LLMGateway {
  constructor(private handlers: Record<string, (messages: LLMMessage[]) => string>) {}

  async complete(opts: { agent: AgentProfile; messages: LLMMessage[]; json?: boolean }): Promise<LLMResult> {
    const h = this.handlers[opts.agent.id];
    if (!h) throw new Error(`FakeLLM: no handler for agent '${opts.agent.id}'`);
    const text = h(opts.messages);
    let json: unknown;
    if (opts.json) {
      try { json = JSON.parse(text); } catch { throw new Error(`FakeLLM: agent '${opts.agent.id}' 返回了非法 JSON`); }
    }
    return { text, json, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

/** 一个可接入的 API 供应商（OpenAI 兼容口径）。 */
export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  /** 该供应商是否支持 reasoning_effort 参数（DeepSeek 支持；多数兼容服务不支持，跳过） */
  supportsReasoningEffort?: boolean;
  /** 该供应商是否支持 response_format json_object */
  supportsResponseFormat?: boolean;
}

/**
 * 多供应商网关（OpenAI 兼容）：按 agent.model.provider 路由到对应供应商。
 * 新增供应商只需在 .env 加 PROVIDER_<ID>_BASE / PROVIDER_<ID>_KEY / PROVIDER_<ID>_MODELS。
 */
export class MultiProviderLLM implements LLMGateway {
  private total = { input: 0, output: 0, reasoning: 0, calls: 0 };

  constructor(private providers: Map<string, ProviderConfig>) {}

  getUsage() {
    return { ...this.total };
  }

  getProviders(): { id: string; name: string; models: string[] }[] {
    return [...this.providers.values()].map((p) => ({ id: p.id, name: p.name, models: p.models }));
  }

  /** 运行时增/改一个供应商（用户在前端「接入 API」面板里填的）。 */
  addProvider(config: ProviderConfig): void {
    this.providers.set(config.id, config);
  }

  removeProvider(id: string): void {
    this.providers.delete(id);
  }

  async complete(opts: { agent: AgentProfile; messages: LLMMessage[]; json?: boolean }): Promise<LLMResult> {
    const providerId = opts.agent.model.provider ?? 'deepseek';
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`未配置供应商 '${providerId}'（在 .env 添加 PROVIDER_${providerId.toUpperCase()}_BASE/_KEY/_MODELS）`);
    const model = opts.agent.model.name;
    if (provider.models.length > 0 && !provider.models.includes(model)) {
      throw new Error(`供应商 ${provider.name} 未配置模型 '${model}'（可用: ${provider.models.join(', ')}）`);
    }

    const effortMap = { low: 'low', medium: 'high', high: 'max' } as const;
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      temperature: opts.agent.model.temperature ?? 0.3,
    };
    if (provider.supportsReasoningEffort) {
      if (opts.agent.model.reasoning_effort) {
        body.reasoning_effort = opts.agent.model.reasoning_effort;
      } else if (opts.agent.thinking_effort) {
        body.reasoning_effort = effortMap[opts.agent.thinking_effort] ?? 'high';
      }
    }
    if (opts.json && provider.supportsResponseFormat !== false) {
      body.response_format = { type: 'json_object' };
    }

    // R2 超时熔断：单次调用 10 分钟无响应 → Abort
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600_000);
    try {
      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return await this.handleResponse(res, opts, provider);
    } finally {
      clearTimeout(timer);
    }
  }

  private async handleResponse(
    res: Response,
    opts: { agent: AgentProfile; json?: boolean },
    provider: ProviderConfig,
  ): Promise<LLMResult> {
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`${provider.name} API ${res.status}: ${errText.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      choices: { message: { content?: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number; completion_tokens_details?: { reasoning_tokens?: number } };
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    this.total.calls++;
    this.total.input += data.usage?.prompt_tokens ?? 0;
    this.total.output += data.usage?.completion_tokens ?? 0;
    this.total.reasoning += data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    let json: unknown;
    if (opts.json) {
      try { json = JSON.parse(content); } catch { throw new Error(`${provider.name} 返回了非法 JSON：${content.slice(0, 300)}`); }
    }
    return {
      text: content,
      json,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens,
      },
    };
  }
}

/** DeepSeek 单供应商网关（向后兼容；内部就是 MultiProviderLLM 的一个子集）。 */
export class DeepSeekLLM extends MultiProviderLLM {
  constructor(apiKey: string, baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com') {
    super(
      new Map([
        [
          'deepseek',
          {
            id: 'deepseek',
            name: 'DeepSeek',
            baseUrl,
            apiKey,
            models: ['deepseek-v4-pro', 'deepseek-flash'],
            supportsReasoningEffort: true,
            supportsResponseFormat: true,
          },
        ],
      ]),
    );
  }
}

/** 从环境变量构建供应商注册表：DEEPSEEK_API_KEY + 任意 PROVIDER_<ID>_BASE/KEY/MODELS/NAME。 */
export function providersFromEnv(): Map<string, ProviderConfig> {
  const map = new Map<string, ProviderConfig>();
  const dsKey = process.env.DEEPSEEK_API_KEY;
  if (dsKey) {
    map.set('deepseek', {
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      apiKey: dsKey,
      models: ['deepseek-v4-pro', 'deepseek-flash'],
      supportsReasoningEffort: true,
      supportsResponseFormat: true,
    });
  }
  for (const [k, v] of Object.entries(process.env)) {
    const m = /^PROVIDER_([A-Z0-9_]+)_KEY$/.exec(k);
    if (!m || !v) continue;
    const base = process.env[`PROVIDER_${m[1]}_BASE`];
    if (!base) continue;
    const id = m[1].toLowerCase();
    map.set(id, {
      id,
      name: process.env[`PROVIDER_${m[1]}_NAME`] ?? m[1],
      baseUrl: base,
      apiKey: v,
      models: (process.env[`PROVIDER_${m[1]}_MODELS`] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      supportsReasoningEffort: false,
      supportsResponseFormat: true,
    });
  }
  return map;
}
