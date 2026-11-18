import { chromium } from 'playwright';

/** 无视觉溢出体检 v2：多视口 × 多页面（任务台/历史/看板/报告），并检测「超出父容器」的元素。 */
async function main() {
  const browser = await chromium.launch({ headless: true });
  for (const width of [800, 1024, 1280, 1366, 1440, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    async function scan(label: string) {
      const issues = await page.evaluate(() => {
        const out: string[] = [];
        const docW = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth > docW + 1) {
          out.push(`★页面横向溢出: scrollWidth=${document.documentElement.scrollWidth} clientWidth=${docW}`);
        }
        const seen = new Set<string>();
        document.querySelectorAll('*').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          const cls = typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '';
          const tag = el.tagName.toLowerCase() + cls;
          const txt = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
          if (r.right > docW + 2 && !seen.has(tag)) {
            seen.add(tag);
            out.push(`[超出视口] <${tag}> right=${Math.round(r.right)} 文本:${txt}`);
          }
          if (el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 10 && !seen.has(tag + ':inner')) {
            seen.add(tag + ':inner');
            out.push(`[内部溢出] <${tag}> ${el.scrollWidth}>${el.clientWidth} 文本:${txt}`);
          }
          // 纵向被裁：容器高度受限且内容更高（overflow hidden 会盖住内容）
          const style = getComputedStyle(el);
          if (
            el.scrollHeight > el.clientHeight + 4 &&
            el.clientHeight > 10 &&
            (style.overflowY === 'hidden' || style.overflow === 'hidden') &&
            !seen.has(tag + ':vclip')
          ) {
            seen.add(tag + ':vclip');
            out.push(`[纵向被裁] <${tag}> 内容高${el.scrollHeight} > 框高${el.clientHeight} (overflow:hidden) 文本:${txt}`);
          }
        });
        return out.slice(0, 30);
      });
      console.log(`\n[${width}px · ${label}] ${issues.length === 0 ? '✅' : issues.join('\n')}`);
    }

    await scan('任务台');

    // 历史记录
    await page.click('text=④ 历史记录');
    await page.waitForTimeout(800);
    await scan('历史记录');

    // 打开最近一条 → 看板
    const firstView = page.locator('button', { hasText: '查看 →' }).first();
    if ((await firstView.count()) > 0) {
      await firstView.click();
      await page.waitForTimeout(1200);
      await scan('运行看板');
      // 报告
      const reportBtn = page.locator('button', { hasText: '核验报告' }).first();
      if ((await reportBtn.count()) > 0) {
        await reportBtn.click();
        await page.waitForTimeout(800);
        await scan('核验报告');
      }
    }
    await page.close();
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
