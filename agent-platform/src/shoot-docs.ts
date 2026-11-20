import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

/** 方案书配图：拍摄当前系统的任务台/看板/报告/历史记录四页截图。 */
async function main() {
  mkdirSync('../docs/figures', { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // ① 任务台（需求输入 + 开始生成）
  await page.fill('#requirement', '做个能玩的打砖块');
  await page.screenshot({ path: '../docs/figures/图1-任务台.png' });
  // 滚动到角色配置/接入API 面板
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.55));
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../docs/figures/图2-任务台配置面板.png' });

  // ② 历史记录页
  await page.click('text=④ 历史记录');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '../docs/figures/图5-历史记录.png' });

  // ③ 打开最近一条已完成 run 的看板
  await page.click('button:has-text("查看 →")');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '../docs/figures/图3-运行看板.png' });

  // ④ 核验报告
  const reportBtn = page.locator('button', { hasText: '核验报告' }).first();
  if ((await reportBtn.count()) > 0) {
    await reportBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '../docs/figures/图4-核验报告.png' });
  }
  await browser.close();
  console.log('截图完成');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
