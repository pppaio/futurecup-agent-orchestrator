import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import type { HardReport } from '../types.js';

export interface SandboxOpts {
  timeoutMs: number;
  shotsDir?: string;
  /** 图形类需求才要求 canvas 非空；工具类要求 DOM 有实际内容。 */
  requireCanvas?: boolean;
  /** 可选交互脚本：模拟按键/点击，用于断言验收条件。 */
  interaction?: (page: Page) => Promise<void>;
  /** 运行中断信号：中止在途验证（加速中断）。 */
  signal?: AbortSignal;
}

export interface Sandbox {
  run(html: string, opts: SandboxOpts): Promise<HardReport>;
}

/** 自包含的 canvas 探测函数（会被序列化进浏览器上下文）。 */
function canvasProbe(): boolean {
  const c = document.querySelector('canvas');
  if (!c) return false;
  const ctx = c.getContext('2d');
  if (!ctx) return false;
  try {
    const d = ctx.getImageData(0, 0, Math.min(c.width, 200), Math.min(c.height, 200)).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * 硬验证沙箱：Playwright 无头浏览器。不含任何 LLM。
 * 判定规则（写死）：ok = load_ok && errors.length===0 && canvas_nonempty && interaction 未抛错。
 */
export class PlaywrightSandbox implements Sandbox {
  async run(html: string, opts: SandboxOpts): Promise<HardReport> {
    if (opts.signal?.aborted) throw new DOMException('已中断', 'AbortError');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    const errors: HardReport['errors'] = [];
    const onAbort = () => {
      void page.close().catch(() => {});
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    page.on('pageerror', (e) => errors.push({ type: 'pageerror', message: e.message, stack: e.stack }));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push({ type: 'console', message: m.text() });
    });

    let load_ok = true;
    const t0 = Date.now();
    try {
      await page.setContent(html, { waitUntil: 'load', timeout: opts.timeoutMs });
    } catch (e) {
      load_ok = false;
      errors.push({ type: 'timeout', message: String(e) });
    }
    const load_ms = Date.now() - t0;

    // 先截图：强制一次合成帧，确保 rAF 首帧已绘制（headless 冷启动偶发不绘帧）
    const screenshots: string[] = [];
    if (opts.shotsDir) {
      mkdirSync(opts.shotsDir, { recursive: true });
      const p1 = join(opts.shotsDir, 'first.png');
      await page.screenshot({ path: p1 }).catch(() => {});
      screenshots.push(p1);
    }

    // canvas 非空检测：轮询等待，避免首帧竞态
    let canvas_nonempty = false;
    try {
      await page.waitForFunction(canvasProbe, undefined, { timeout: 3000, polling: 100 });
      canvas_nonempty = true;
    } catch {
      canvas_nonempty = false;
    }

    const dom_node_count = await page
      .evaluate(() => document.querySelectorAll('*').length)
      .catch(() => 0);

    let interactionOk = true;
    if (opts.interaction) {
      try {
        await opts.interaction(page);
      } catch (e) {
        interactionOk = false;
        errors.push({ type: 'console', message: 'interaction failed: ' + String(e) });
      }
      if (opts.shotsDir) {
        const p2 = join(opts.shotsDir, 'after.png');
        await page.screenshot({ path: p2 }).catch(() => {});
        screenshots.push(p2);
      }
    }

    await browser.close().catch(() => {});
    opts.signal?.removeEventListener('abort', onAbort);
    if (opts.signal?.aborted) throw new DOMException('已中断', 'AbortError');
    // 图形类：canvas 非空；工具类：DOM 有实际内容（节点数阈值）
    const requireCanvas = opts.requireCanvas ?? true;
    const dom_ok = requireCanvas ? canvas_nonempty : dom_node_count >= 12;
    const ok = load_ok && errors.length === 0 && dom_ok && interactionOk;
    return { ok, load_ok, errors, signals: { canvas_nonempty, dom_node_count }, screenshots, load_ms };
  }
}
