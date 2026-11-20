import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MemoryLesson {
  error: string;   // 错误卡片摘要（第一次硬验证失败的代表性报错）
  rounds: number;  // 收敛所需轮次（含失败的最终轮次）
  success: boolean;
  at: number;
}

/**
 * 跨运行记忆：把每次运行"硬修复"的教训持久化到 memory.json，
 * 新运行中修复者拿到相似错误时，把历史处理记录注入其提示（记忆管理能力）。
 */
export class MemoryStore {
  private lessons: MemoryLesson[] = [];
  private file: string;

  constructor(dir: string) {
    this.file = join(dir, 'memory.json');
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as MemoryLesson[];
      if (Array.isArray(raw)) this.lessons = raw;
    } catch {
      /* 首次运行 */
    }
  }

  add(lesson: MemoryLesson): void {
    this.lessons.push(lesson);
    if (this.lessons.length > 200) this.lessons = this.lessons.slice(-200);
    writeFileSync(this.file, JSON.stringify(this.lessons, null, 2), 'utf8');
  }

  /** 关键词重合打分检索历史教训（确定性，无向量库）。 */
  retrieve(text: string, topK = 2): MemoryLesson[] {
    const terms = (text.toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9_]{2,}/g) ?? []).filter(
      (t) => !['的', '了', '和', '在', '是', '一个'].includes(t),
    );
    return this.lessons
      .map((l) => {
        const t = l.error.toLowerCase();
        let score = 0;
        for (const term of terms) if (t.includes(term)) score++;
        return { l, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((x) => x.l);
  }
}
