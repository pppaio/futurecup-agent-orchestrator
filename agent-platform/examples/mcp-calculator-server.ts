import { createInterface } from 'node:readline';

/**
 * 示例 MCP 服务器（stdio 传输，JSON-RPC 2.0）：
 * 暴露两个工具 add / multiply，演示平台 MCP 客户端接入外部工具服务器。
 * 用法：node examples/mcp-calculator-server.js（或 npx tsx examples/mcp-calculator-server.ts）
 */
const TOOLS = [
  { name: 'add', description: '计算两个数之和 a + b', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
  { name: 'multiply', description: '计算两个数之积 a * b', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
];

function send(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg: { jsonrpc?: string; id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  try {
    msg = JSON.parse(line) as typeof msg;
  } catch {
    return;
  }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'calculator', version: '1.0.0' } } });
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
  } else if (msg.method === 'tools/call') {
    const name = msg.params?.name;
    const args = (msg.params?.arguments ?? {}) as Record<string, number>;
    let result: unknown = { error: `未知工具 ${name}` };
    let isError = false;
    if (name === 'add') result = { result: (args.a ?? 0) + (args.b ?? 0) };
    else if (name === 'multiply') result = { result: (args.a ?? 0) * (args.b ?? 0) };
    else isError = true;
    send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError } });
  }
});
