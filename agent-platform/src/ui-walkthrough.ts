import { chromium } from 'playwright';

/**
 * 前端走查：提交需求 → 看板实时事件流 → 等跑完 → 核验报告，全程截图。
 * 既是看板/报告页截图来源，也是演示视频的彩排脚本。
 */
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });

  // ① 任务台
  await page.fill('#requirement', '做个能玩的打砖块');
  await page.screenshot({ path: 'runs/ui-2-task-filled.png' });
  await page.click('button.btn-primary');
  console.log('已提交需求，等待看板出现…');

  await page.waitForSelector('nav.tabs', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(40000); // 分析 + 生成进行中
  await page.screenshot({ path: 'runs/ui-3-dashboard-live.png' });
  console.log('看板进行中截图完成');

  // 轮询报告直到 done（最多 6 分钟）
  let done = false;
  for (let i = 0; i < 36; i++) {
    const status = await page
      .evaluate(async () => {
        const res = await fetch('/api/runs');
        const list = (await res.json()) as { runId: string; report: { status: string } }[];
        return list[0]?.report?.status ?? 'unknown';
      })
      .catch(() => 'unknown');
    if (status === 'done' || status === 'failed') {
      done = true;
      break;
    }
    await page.waitForTimeout(10000);
  }
  console.log('终态: ' + (done ? 'done/failed' : 'timeout'));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'runs/ui-3-dashboard-done.png' });

  // ③ 核验报告
  const reportTab = page.locator('nav.tabs button', { hasText: '核验报告' });
  if ((await reportTab.count()) > 0) {
    await reportTab.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'runs/ui-4-report.png' });
    console.log('报告页截图完成');
  }
  await browser.close();
  console.log('UI 走查完成');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
