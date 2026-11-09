import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { marked } from 'marked';
import { chromium } from 'playwright';

/** 方案书 markdown → PDF（图片按 md 所在目录解析为 file:// 绝对路径） */
export async function exportDoc(mdPath: string, outPath: string): Promise<void> {
  const md = readFileSync(mdPath, 'utf8');
  const mdDir = dirname(resolve(mdPath));
  const body = (await marked.parse(md)).replace(/<img src="([^"]+)"/g, (_m, src: string) => {
    if (/^(https?:|data:)/.test(src)) return `<img src="${src}"`;
    const p = resolve(mdDir, src);
    try {
      const buf = readFileSync(p);
      const ext = (p.split('.').pop() ?? 'png').toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
      return `<img src="data:${mime};base64,${buf.toString('base64')}"`;
    } catch {
      return `<img src="${src}"`;
    }
  });
  const html = `<!doctype html><html><head><meta charset="utf-8">
  <style>
    body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; max-width: 860px; margin: 0 auto; padding: 36px; color: #1f2937; line-height: 1.75; font-size: 14px; }
    h1 { font-size: 25px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
    h2 { font-size: 19px; margin-top: 26px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
    h3 { font-size: 15.5px; margin-top: 18px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 12.5px; }
    th, td { border: 1px solid #d1d5db; padding: 5px 9px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
    pre { background: #111827; color: #e5e7eb; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 12px; }
    pre code { background: none; color: inherit; padding: 0; }
    blockquote { border-left: 3px solid #22d3ee; margin: 12px 0; padding: 4px 14px; background: #f0fdff; color: #374151; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 22px 0; }
    img { max-width: 100%; }
    li { margin: 3px 0; }
  </style></head><body>${body}</body></html>`;
  await htmlToPdf(html, outPath, 'A4');
}

/** PPT slides.html → PDF（按 @page 尺寸，一页一幻灯片） */
export async function exportPpt(htmlPath: string, outPath: string): Promise<void> {
  const html = readFileSync(htmlPath, 'utf8');
  const withPage = html.replace(
    '</style>',
    '@page { size: 1280px 720px; margin: 0; } .slide { margin: 0 !important; page-break-after: always; }\n</style>',
  );
  await htmlToPdf(withPage, outPath, undefined);
}

/** 渲染 HTML → PDF：写入临时文件后 goto(file://) 以正常加载本地图片。 */
async function htmlToPdf(html: string, outPath: string, format: 'A4' | undefined): Promise<void> {
  mkdirSync('dist', { recursive: true });
  const tmp = resolve('dist', '_export.html');
  writeFileSync(tmp, html, 'utf8');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('file:///' + tmp.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForTimeout(800); // 等图片加载
  if (format) {
    await page.pdf({
      path: outPath,
      format,
      margin: { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' },
      printBackground: true,
    });
  } else {
    await page.pdf({ path: outPath, printBackground: true, preferCSSPageSize: true });
  }
  await browser.close();
  console.log('PDF 导出: ' + outPath);
}

const cmd = process.argv[2];
if (cmd === 'doc') {
  const src = process.argv[3] ?? '../docs/04-方案书-draft.md';
  await exportDoc(src, '../docs/方案书.pdf');
} else if (cmd === 'ppt') {
  await exportPpt('../presentation/slides.html', '../docs/讲解PPT.pdf');
} else {
  console.log('用法: tsx src/export.ts doc|ppt');
}
