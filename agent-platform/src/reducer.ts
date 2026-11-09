import type { ErrorCard, HardReport } from './types.js';

/**
 * 错误归一化（确定性代码，禁用 LLM —— R2 红线）：
 * 把 N 条报错 + 信号失败压成 ≤3 张错误卡片，按类别分类，去重，截断。
 * 信号失败（canvas 空 / DOM 过少）必须进卡片，否则修复者拿不到可操作信息。
 */
export function normalizeErrors(report: HardReport, opts: { requireCanvas?: boolean } = {}): ErrorCard[] {
  const requireCanvas = opts.requireCanvas ?? true;
  const cards: ErrorCard[] = report.errors.map((e) => {
    let category: ErrorCard['category'] = 'runtime';
    if (e.type === 'pageerror') category = 'runtime';
    else if (e.type === 'console') category = 'render';
    else if (e.type === 'timeout') category = 'resource';
    return { category, message: e.message.slice(0, 300), line: e.line };
  });

  if (!report.ok) {
    if (requireCanvas && !report.signals.canvas_nonempty) {
      cards.push({
        category: 'render',
        message: 'canvas 未渲染出非空像素：图形类产物必须用 <canvas> 绘制并在首帧填充内容',
      });
    }
    if (!requireCanvas && report.signals.dom_node_count < 12) {
      cards.push({
        category: 'render',
        message: `DOM 节点过少（${report.signals.dom_node_count} 个）：工具类产物需要实际界面内容（按钮/输入框/文本等）`,
      });
    }
  }

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
