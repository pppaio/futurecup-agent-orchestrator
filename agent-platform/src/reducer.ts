import type { ErrorCard, HardReport } from './types.js';

/**
 * 错误归一化（确定性代码，禁用 LLM —— R2 红线）：
 * 把 N 条报错压成 ≤3 张错误卡片，按类别分类，去重，截断。
 */
export function normalizeErrors(report: HardReport): ErrorCard[] {
  const cards: ErrorCard[] = report.errors.map((e) => {
    let category: ErrorCard['category'] = 'runtime';
    if (e.type === 'pageerror') category = 'runtime';
    else if (e.type === 'console') category = 'render';
    else if (e.type === 'timeout') category = 'resource';
    return { category, message: e.message.slice(0, 300), line: e.line };
  });

  const seen = new Set<string>();
  const uniq: ErrorCard[] = [];
  for (const c of cards) {
    const k = c.category + ':' + c.message;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(c);
    if (uniq.length >= 3) break;
  }
  return uniq;
}

/** 上一版产物摘要：不给全文，只给长度 + 头部片段，控制修复者上下文。 */
export function summarizeArtifact(html: string): { length: number; head: string } {
  return { length: html.length, head: html.slice(0, 300) };
}
