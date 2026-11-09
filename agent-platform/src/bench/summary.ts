import { readFileSync } from 'node:fs';

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

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 从 results.csv 汇总关键指标，返回可粘贴进方案书的文本块。 */
export function summarizeCsv(path: string): string {
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
  const header = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const v = splitCsvLine(l);
    const o: Record<string, string> = {};
    header.forEach((h, i) => {
      o[h] = v[i] ?? '';
    });
    return o;
  });

  const okCount = rows.filter((r) => r.ok === 'true').length;
  const rate = Math.round((okCount / rows.length) * 1000) / 10;

  const fixRounds = rows.map((r) => Number(r.fix_rounds));
  const roundsMed = median(fixRounds);
  const maxRounds = Math.max(...fixRounds);

  const wallMs = rows.map((r) => Number(r.wall_ms)).sort((a, b) => a - b);
  const p50 = Math.round(wallMs[Math.floor(wallMs.length * 0.5)] / 1000);
  const p95 = Math.round(wallMs[Math.min(wallMs.length - 1, Math.floor(wallMs.length * 0.95))] / 1000);

  const curves = rows.map((r) => JSON.parse(r.error_curve) as number[]);
  const maxLen = Math.max(...curves.map((c) => c.length));
  const avgByRound: number[] = [];
  for (let i = 0; i < maxLen; i++) {
    const vals = curves.filter((c) => c.length > i).map((c) => c[i]);
    avgByRound.push(Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10);
  }

  const byCategory = new Map<string, { ok: number; total: number }>();
  for (const r of rows) {
    const c = byCategory.get(r.category) ?? { ok: 0, total: 0 };
    c.total++;
    if (r.ok === 'true') c.ok++;
    byCategory.set(r.category, c);
  }

  const catLines = [...byCategory.entries()]
    .map(([cat, v]) => `  ${cat}: ${v.ok}/${v.total} (${Math.round((v.ok / v.total) * 100)}%)`)
    .join('\n');

  return [
    `样本总数   : ${rows.length}`,
    `一次可运行率: ${okCount}/${rows.length} = ${rate}%`,
    `修复轮次   : 中位数 ${roundsMed}，最大 ${maxRounds}`,
    `耗时       : p50=${p50}s，p95=${p95}s`,
    `平均报错/轮 : [${avgByRound.join(', ')}]`,
    `按类别     :`,
    catLines,
  ].join('\n');
}
