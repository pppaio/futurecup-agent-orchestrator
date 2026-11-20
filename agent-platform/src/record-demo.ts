import { chromium } from 'playwright';

/**
 * 演示视频素材自动录制（演示模式 :3100，零成本 Fake LLM）：
 * 任务台 → 运行看板（修复循环+评分返工实时事件）→ 人工确认点返工 → 接受 →
 * 核验报告（打分历史+版本历史）→ 历史记录。全程屏幕录像（webm）。
 */
async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: 'runs/video', size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3100/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ① 任务台：输入需求 + 浏览设置面板
  await page.fill('#requirement', '做个能玩的打砖块');
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.45));
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
  await page.click('button.btn-primary');
  console.log('已提交，观看看板…');

  // ② 等待运行推进（演示模式约 30~60 秒完成一轮评分循环）
  let status = 'running';
  for (let i = 0; i < 24; i++) {
    const s = await page
      .evaluate(async () => {
        const r = await fetch('/api/runs');
        const list = (await r.json()) as { runId: string; status: string }[];
        return list[0]?.status ?? 'unknown';
      })
      .catch(() => 'unknown');
    status = s;
    if (s === 'awaiting_human' || s === 'failed') break;
    await page.waitForTimeout(4000);
  }
  console.log('到达: ' + status);
  await page.waitForTimeout(2500);

  // ③ 人工确认点：返工（附指令）
  if (status === 'awaiting_human') {
    await page.fill('input.instr-input', '加个计分板');
    await page.waitForTimeout(1500);
    await page.click('button.btn-warn');
    console.log('已提交返工指令，等待改版…');
    for (let i = 0; i < 24; i++) {
      const s = await page
        .evaluate(async () => {
          const r = await fetch('/api/runs');
          const list = (await r.json()) as { runId: string; status: string }[];
          return list[0]?.status ?? 'unknown';
        })
        .catch(() => 'unknown');
      if (s === 'awaiting_human' || s === 'failed' || s === 'done') break;
      await page.waitForTimeout(4000);
    }
    await page.waitForTimeout(2500);

    // ④ 接受交付
    await page.click('button.btn-primary');
    console.log('已接受交付');
    await page.waitForTimeout(2500);
  }

  // ⑤ 核验报告：打分历史 + 版本历史
  const reportTab = page.locator('nav.tabs button', { hasText: '核验报告' });
  if ((await reportTab.count()) > 0) {
    await reportTab.click();
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);
  }

  // ⑥ 历史记录
  const histTab = page.locator('nav.tabs button', { hasText: '历史记录' });
  if ((await histTab.count()) > 0) {
    await histTab.click();
    await page.waitForTimeout(3000);
  }

  await ctx.close();
  await browser.close();
  console.log('录制完成');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
