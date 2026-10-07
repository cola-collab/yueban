import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const files = ['index.html', 'style.css', 'app.js', 'care-data.mjs', 'state.mjs', 'logic.mjs', 'sw.js', 'icon.svg', 'manifest.webmanifest'];
const check = process.argv.includes('--check');

async function same(source, target) {
  try {
    const [a, b] = await Promise.all([readFile(source), readFile(target)]);
    return createHash('sha256').update(a).digest('hex') === createHash('sha256').update(b).digest('hex');
  } catch { return false; }
}
async function visit(relative) {
  const source = join(root, relative);
  const target = join(root, 'dist', relative);
  if (check) {
    if (!await same(source, target)) throw new Error(`dist 与源文件不一致: ${relative}`);
  } else {
    await mkdir(join(target, '..'), { recursive: true });
    await copyFile(source, target);
  }
}
async function visitDirectory(relative) {
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) await visitDirectory(path);
    else if (entry.isFile()) await visit(path);
  }
}
for (const file of files) await visit(file);
await visitDirectory('vendor');
console.log(check ? 'dist 与源文件一致' : 'dist 已从唯一源目录生成');
