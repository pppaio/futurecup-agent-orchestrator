import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { createInterface } from 'node:readline';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface JsonRpcMessage {
  jsonrpc: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * 最小 MCP 客户端（Model Context Protocol，JSON-RPC 2.0 over stdio）：
 * 启动 MCP 服务器子进程 → initialize → tools/list → tools/call。
 * 任何实现 stdio 传输的 MCP 服务器均可接入（`mcpServers` 配置命令与参数）。
 */
export class McpClient {
  private child: ChildProcessByStdio<Writable, Readable, null>;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private tools: McpTool[] = [];

  constructor(command: string, args: string[], shell = false) {
    this.child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'], shell });
    const rl = createInterface({ input: this.child.stdout });
    rl.on('line', (line) => {
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(line) as JsonRpcMessage;
      } catch {
        return;
      }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      }
    });
    this.child.on('exit', () => {
      for (const p of this.pending.values()) p.reject(new Error('MCP 服务器进程已退出'));
      this.pending.clear();
    });
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg: JsonRpcMessage = { jsonrpc: '2.0', id, method, params: params ?? {} };
      this.child.stdin.write(JSON.stringify(msg) + '\n');
    });
  }

  async init(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agent-platform', version: '1.0.0' },
    });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const res = (await this.request('tools/list')) as { tools?: McpTool[] };
    this.tools = (res.tools ?? []).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema ?? {} }));
  }

  getTools(): McpTool[] {
    return this.tools;
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const res = (await this.request('tools/call', { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = (res.content ?? []).map((c) => c.text ?? '').join('\n');
    if (res.isError) return { error: text };
    try {
      return JSON.parse(text || 'null');
    } catch {
      return { text };
    }
  }

  dispose(): void {
    this.child.kill();
  }
}
