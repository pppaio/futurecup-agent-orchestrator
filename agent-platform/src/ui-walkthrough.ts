import { chromium } from 'playwright';

/**
 * 前端走查 v2（真实模型全流程）：
 * 提交需求(带角色配置) → 看板实时 → 人工确认点截图 → 输入修改指令返工
 * → 再次人工确认 → 接受交付 → 核验报告（含版本历史）。
 */
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });

  // ① 任务台：输入 + 打开角色配置（验证新 UI）
  await page.fill('#requirement', '做个能玩的打砖块');
  await page.click('text=角色配置');
  await page.screenshot({ path: 'runs/ui-v2-task-config.png' });
  await page.click('button.btn-primary'); // 开始生成
  console.log('已提交（默认配置），等待运行…');

  // 等待到达人工确认点（最多 8 分钟）
  let status = 'running';
  for (let i = 0; i < 48; i++) {
    const s = await page
      .evaluate(async () => {
        const res = await fetch('/api/runs');
        const list = (await res.json()) as { runId: string; report: { status: string } }[];
        return list[0]?.report?.status ?? 'unknown';
      })
      .catch(() => 'unknown');
    status = s;
    if (s === 'awaiting_human' || s === 'failed') break;
    await page.waitForTimeout(10000);
  }
  console.log('到达状态: ' + status);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'runs/ui-v2-awaiting-human.png' });

  // ② 返工：输入修改指令
  if (status === 'awaiting_human') {
    await page.fill('input.instr-input', '加个计分板');
    await page.click('button.btn-warn'); // 返工
    console.log('已提交返工指令，等待修改者…');
    for (let i = 0; i < 36; i++) {
      const s = await page
        .evaluate(async () => {
          const res = await fetch('/api/runs');
          const list = (await res.json()) as { runId: string; report: { status: string } }[];
          return list[0]?.report?.status ?? 'unknown';
        })
        .catch(() => 'unknown');
      if (s === 'awaiting_human' || s === 'failed' || s === 'done') break;
      await page.waitForTimeout(10000);
    }
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'runs/ui-v2-revised-awaiting.png' });

    // ③ 接受交付
    await page.click('button.btn-primary'); // ✅ 接受交付
    console.log('已接受交付，等待终态…');
    for (let i = 0; i < 12; i++) {
      const s = await page
        .evaluate(async () => {
          const res = await fetch('/api/runs');
          const list = (await res.json()) as { runId: string; report: { status: string } }[];
          return list[0]?.report?.status ?? 'unknown';
        })
        .catch(() => 'unknown');
      if (s === 'done' || s === 'failed') break;
      await page.waitForTimeout(5000);
    }
  }

  // ④ 核验报告（含版本历史）
  const reportTab = page.locator('nav.tabs button', { hasText: '核验报告' });
  if ((await reportTab.count()) > 0) {
    await reportTab.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'runs/ui-v2-report.png' });
  }
  await browser.close();
  console.log('UI 走查 v2 完成');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
