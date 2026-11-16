import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Bundle {
  files: string[];
  entry: string;
  version: number;
}

export interface Packager {
  pack(artifact: { title?: string; html?: string } | undefined, runDir: string): Promise<Bundle>;
}

/** 初赛只实现单文件 HTML 打包（版本化：bundle-vN.html 累积 + bundle.html 指向最新）；exe 打包器预留接口。 */
export class SingleHtmlPackager implements Packager {
  async pack(artifact: { title?: string; html?: string } | undefined, runDir: string): Promise<Bundle> {
    const html = artifact?.html ?? '';
    const title = artifact?.title ?? 'app';

    // 版本号 = 已有 bundle-vN 数量 + 1（人工返工后同一目录内累积历史版本，支持回退）
    let version = 1;
    try {
      const existing = readdirSync(runDir).filter((f) => /^bundle-v\d+\.html$/.test(f));
      version = existing.length + 1;
    } catch {
      /* 目录不存在则从 1 开始 */
    }

    const versioned = join(runDir, `bundle-v${version}.html`);
    writeFileSync(versioned, html, 'utf8');
    const entry = join(runDir, 'bundle.html');
    writeFileSync(entry, html, 'utf8'); // 最新版入口
    const readme = join(runDir, 'README.txt');
    writeFileSync(readme, `${title}\n单文件 HTML 产物，双击 bundle.html 运行最新版；历史版本见 bundle-vN.html。\n`, 'utf8');
    return { files: [versioned, entry, readme], entry, version };
  }
}
