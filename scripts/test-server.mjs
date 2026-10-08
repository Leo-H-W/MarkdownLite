/**
 * 测试专用静态服务器：只从磁盘伺服 public/（端口 3459），不受 3456 上
 * exe/node 守护进程（跑的是打包快照，代码版本不可控）的影响。
 *
 *   node scripts/test-server.mjs          # 前台跑；或后台常驻
 *   MARKDOWNLITE_URL=http://localhost:3459 node scripts/edit-modern-check.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = 3459;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(normalize(ROOT))) { res.writeHead(403); return res.end(); }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(PORT, () => console.log(`test-server: http://localhost:${PORT} (disk: ${ROOT})`));
