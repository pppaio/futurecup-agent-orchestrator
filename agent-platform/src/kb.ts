import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface KbChunk {
  title: string;
  text: string;
}

/**
 * 轻量知识库（无向量库依赖的确定性检索）：
 * knowledge/ 目录下 Markdown 文件按「## 标题」切块，按关键词命中打分取 topK。
 * 检索结果作为 Function Calling 工具 kb_search 的返回，注入各 Agent 提示。
 */
export class KnowledgeBase {
  private chunks: KbChunk[] = [];

  constructor(private dir: string) {
    this.reload();
  }

  reload(): void {
    this.chunks = [];
    try {
      for (const f of readdirSync(this.dir).filter((f) => f.endsWith('.md'))) {
        const raw = readFileSync(join(this.dir, f), 'utf8');
        const lines = raw.split('\n');
        let title = f.replace(/\.md$/, '');
        let buf: string[] = [];
        const flush = () => {
          if (buf.length > 0) this.chunks.push({ title, text: buf.join('\n').trim() });
          buf = [];
        };
        for (const line of lines) {
          if (line.startsWith('## ')) {
            flush();
            title = f.replace(/\.md$/, '') + ' · ' + line.slice(3).trim();
          } else {
            buf.push(line);
          }
        }
        flush();
      }
    } catch {
      /* 目录不存在则空库 */
    }
  }

  /** 关键词打分检索：query 切词（连续中文/字母数字），按命中次数加权排序。 */
  retrieve(query: string, topK = 3): { title: string; text: string; score: number }[] {
    const terms = (query.toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9_]{2,}/g) ?? []).filter(
      (t) => !['的', '了', '和', '在', '是', '一个'].includes(t),
    );
    const scored = this.chunks
      .map((c) => {
        const text = c.text.toLowerCase();
        let score = 0;
        for (const t of terms) {
          const n = text.split(t).length - 1;
          if (n > 0) score += 1 + Math.log(n);
        }
        return { ...c, score };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return scored;
  }
}
