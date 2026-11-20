import { McpClient } from './mcp.js';

/** 验证 MCP 客户端：启动内置示例 MCP 服务器 → initialize → tools/list → tools/call。 */
async function main() {
  const client = new McpClient('npx', ['tsx', 'examples/mcp-calculator-server.ts'], true);
  try {
    await client.init();
    const tools = client.getTools();
    console.log('MCP 服务器工具:', tools.map((t) => t.name).join(', '));
    const add = (await client.call('add', { a: 2, b: 3 })) as { result?: number };
    const mul = (await client.call('multiply', { a: 4, b: 5 })) as { result?: number };
    console.log(`add(2,3) = ${add.result} · multiply(4,5) = ${mul.result}`);
    const ok = tools.length === 2 && add.result === 5 && mul.result === 20;
    console.log(ok ? '\n✅ MCP 客户端跑通（JSON-RPC over stdio：初始化/列举工具/调用工具）' : '\n⚠️ MCP 验证失败');
    if (!ok) process.exitCode = 1;
  } finally {
    client.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
