// 藏海 canghai · 本地控制面板服务
//
// 一个零依赖的 HTTP 服务：静态托管 panel/ + 提供 /api。
// 两个宿主都用它：QQAgent/DSH 把面板内嵌/外开，或直接浏览器打开 http://127.0.0.1:PORT。
// 默认只绑 127.0.0.1（本机），不对外，避免知识面板变成公网入口。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from './index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL = path.join(HERE, 'panel');
const PORT = Number(process.env.CANGHAI_PORT || 8792);
const HOST = process.env.CANGHAI_HOST || '127.0.0.1';

const engine = createEngine({ log: (...a) => console.log('[canghai]', ...a) });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png'
};

function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(b);
}

let syncing = false;

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (p === '/api/stats') return json(res, 200, engine.stats());
  if (p === '/api/config') return json(res, 200, engine.config());
  if (p === '/api/schema') return json(res, 200, engine.schema.schemaFieldList());
  if (p === '/api/search') {
    const q = url.searchParams.get('q') || '';
    const limit = Number(url.searchParams.get('limit')) || 8;
    const hits = engine.query(q, { limit });
    return json(res, 200, { query: q, hits: hits.map((h) => ({ ...h.entry, _score: h.score })) });
  }
  if (p === '/api/sync' && req.method === 'POST') {
    if (syncing) return json(res, 409, { ok: false, error: '已有同步在跑' });
    syncing = true;
    try {
      const body = await readBody(req);
      const only = body.only ? String(body.only).split(',') : null;
      const rep = await engine.sync({ only });
      return json(res, 200, { ok: true, report: rep });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    } finally { syncing = false; }
  }
  return json(res, 404, { error: 'no api' });
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
}

function serveStatic(res, url) {
  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  rel = rel.replace(/\.\./g, ''); // 防目录穿越
  const file = path.join(PANEL, rel);
  if (!file.startsWith(PANEL) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url).catch((e) => json(res, 500, { error: e.message }));
  return serveStatic(res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`藏海 canghai 面板已启动：http://${HOST}:${PORT}`);
  console.log(`  库内 ${engine.stats().total} 条。`);
});
