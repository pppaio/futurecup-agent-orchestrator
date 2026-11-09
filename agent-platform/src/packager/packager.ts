import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Bundle {
  files: string[];
  entry: string;
}

export interface Packager {
  pack(artifact: { title?: string; html?: string } | undefined, runDir: string): Promise<Bundle>;
}

/** 初赛只实现单文件 HTML 打包；exe 打包器预留接口。 */
export class SingleHtmlPackager implements Packager {
  async pack(artifact: { title?: string; html?: string } | undefined, runDir: string): Promise<Bundle> {
    const html = artifact?.html ?? '';
    const title = artifact?.title ?? 'app';
    const entry = join(runDir, 'bundle.html');
    writeFileSync(entry, html, 'utf8');
    const readme = join(runDir, 'README.txt');
    writeFileSync(readme, `${title}\n单文件 HTML 产物，双击 bundle.html 即可运行。\n`, 'utf8');
    return { files: [entry, readme], entry };
  }
}
