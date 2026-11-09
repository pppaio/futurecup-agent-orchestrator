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
 * Fake 网关：M1 用它先跑通全链路，不花一分钱。
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

/**
 * DeepSeek 网关（OpenAI 兼容）。thinking_effort 映射：
 * low -> low, medium -> high, high -> max（对应 API 的 low/high/max 三档）。
 */
export class DeepSeekLLM implements LLMGateway {
  private total = { input: 0, output: 0, reasoning: 0, calls: 0 };

  constructor(
    private apiKey: string,
    private baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  ) {}

  getUsage() {
    return { ...this.total };
  }

  async complete(opts: { agent: AgentProfile; messages: LLMMessage[]; json?: boolean }): Promise<LLMResult> {
    const model = opts.agent.model.name;
    const effortMap = { low: 'low', medium: 'high', high: 'max' } as const;
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      temperature: opts.agent.model.temperature ?? 0.3,
    };
    if (opts.agent.model.reasoning_effort) {
      body.reasoning_effort = opts.agent.model.reasoning_effort;
    } else if (opts.agent.thinking_effort) {
      body.reasoning_effort = effortMap[opts.agent.thinking_effort] ?? 'high';
    }
    if (opts.json) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`DeepSeek API ${res.status}: ${errText.slice(0, 500)}`);
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
      try { json = JSON.parse(content); } catch { throw new Error(`DeepSeek 返回了非法 JSON：${content.slice(0, 300)}`); }
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
