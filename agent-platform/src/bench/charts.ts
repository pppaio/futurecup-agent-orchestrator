import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

interface Row {
  id: string;
  category: string;
  ok: string;
  error_curve: string;
  fix_rounds: string;
  wall_ms: string;
}

/** 按逗号切分，但方括号内的逗号（如 error_curve [1,0]）不切。 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inBracket = false;
  for (const ch of line) {
    if (ch === '[') inBracket = true;
    else if (ch === ']') inBracket = false;
    if (ch === ',' && !inBracket) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(path: string): Row[] {
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const v = splitCsvLine(l);
    const o: Record<string, string> = {};
    header.forEach((h, i) => {
      o[h] = v[i] ?? '';
    });
    return o as unknown as Row;
  });
}

const W = 720;

function svgWrap(body: string, title: string, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" font-family="sans-serif">
  <style>text{fill:#e5e7eb;font-size:13px} .t{fill:#9ca3af;font-size:11px}</style>
  <rect width="100%" height="100%" fill="#111827"/>
  <text x="20" y="28" font-size="17" font-weight="bold">${title}</text>
  ${body}
</svg>`;
}

function curveToPoints(curve: number[]): { x: number; y: number }[] {
  const max = Math.max(1, ...curve);
  return curve.map((v, i) => ({
    x: 80 + (i * (W - 140)) / Math.max(1, curve.length - 1),
    y: 260 - (v / max) * 180,
  }));
}

/** 收敛曲线：所有 run 的首轮错误数 → 各轮错误数下降趋势（叠加）。 */
function convergenceSvg(rows: Row[]): string {
  const curves = rows
    .map((r) => JSON.parse(r.error_curve.replace(/\[/g, '[').replace(/\]/g, ']')) as number[])
    .filter((c) => c.length > 1);
  const lines = curves
    .map((c) => {
      const pts = curveToPoints(c);
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const dots = pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#22d3ee"/>`).join('');
      return `<path d="${d}" fill="none" stroke="#22d3ee" stroke-width="1.5" opacity="0.7"/>${dots}`;
    })
    .join('');
  return svgWrap(
    `<text x="80" y="290" class="t">轮次 1 → 轮次 N</text><text x="20" y="270" class="t">错误条数</text>${lines}`,
    `收敛曲线（${curves.length} 条需修复的 run）`,
    320,
  );
}

function barChartSvg(title: string, items: { label: string; value: number; color?: string }[], maxHint?: number): string {
  const max = Math.max(1, maxHint ?? Math.max(...items.map((i) => i.value)));
  const bw = (W - 140) / items.length;
  const bars = items
    .map((it, i) => {
      const h = (it.value / max) * 180;
      const x = 80 + i * bw + bw * 0.15;
      const y = 260 - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" fill="${it.color ?? '#34d399'}" rx="3"/>
      <text x="${(x + bw * 0.35).toFixed(1)}" y="280" text-anchor="middle" class="t">${it.label}</text>
      <text x="${(x + bw * 0.35).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="12">${it.value}</text>`;
    })
    .join('');
  return svgWrap(bars, title, 320);
}

function pct(v: number): number {
  return Math.round(v * 100);
}

/** 生成 4 张图到 outDir，返回文件路径列表。 */
export async function renderCharts(csvPath: string, outDir: string): Promise<string[]> {
  const rows = parseCsv(csvPath);
  if (rows.length === 0) throw new Error('results.csv 为空');
  mkdirSync(outDir, { recursive: true });

  const okCount = rows.filter((r) => r.ok === 'true').length;
  const rate = okCount / rows.length;

  const wallMs = rows.map((r) => Number(r.wall_ms)).sort((a, b) => a - b);
  const p50 = wallMs[Math.floor(wallMs.length * 0.5)];
  const p95 = wallMs[Math.min(wallMs.length - 1, Math.floor(wallMs.length * 0.95))];

  const byCategory = new Map<string, { ok: number; total: number }>();
  for (const r of rows) {
    const c = byCategory.get(r.category) ?? { ok: 0, total: 0 };
    c.total++;
    if (r.ok === 'true') c.ok++;
    byCategory.set(r.category, c);
  }

  const svgs: { name: string; svg: string }[] = [
    {
      name: '1-runnable-rate',
      svg: barChartSvg(`一次可运行率 ${pct(rate)}%（${okCount}/${rows.length}）`, [
        { label: '可运行', value: pct(rate) },
        { label: '失败', value: 100 - pct(rate), color: '#f87171' },
      ], 100),
    },
    {
      name: '2-category-rate',
      svg: barChartSvg(
        '按类别可运行率（%）',
        [...byCategory.entries()].map(([label, v]) => ({ label, value: pct(v.ok / v.total) })),
        100,
      ),
    },
    {
      name: '3-latency',
      svg: barChartSvg('耗时分布（ms）', [
        { label: 'p50', value: p50, color: '#38bdf8' },
        { label: 'p95', value: p95, color: '#a78bfa' },
      ]),
    },
    { name: '4-convergence', svg: convergenceSvg(rows) },
  ];

  const browser = await chromium.launch({ headless: true });
  const outputs: string[] = [];
  for (const s of svgs) {
    const page = await browser.newPage({ viewport: { width: W, height: 340 } });
    await page.setContent(s.svg);
    const out = join(outDir, s.name + '.png');
    await page.screenshot({ path: out });
    outputs.push(out);
    await page.close();
  }
  await browser.close();
  return outputs;
}
