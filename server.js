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
import { domainOf } from './core/domains.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL = path.join(HERE, 'panel');
const PORT = Number(process.env.CANGHAI_PORT || 8792);
const HOST = process.env.CANGHAI_HOST || '127.0.0.1';

const engine = createEngine({
  // 支持 --data=路径 或 CANGHAI_DATA_DIR，否则用包内 data/
  dataDir: argData() || process.env.CANGHAI_DATA_DIR || undefined,
  log: (...a) => console.log('[canghai]', ...a)
});

function argData() {
  const a = process.argv.find((x) => x.startsWith('--data='));
  return a ? a.slice('--data='.length) : '';
}

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

  // ── 读 ────────────────────────────────────────────────
  if (p === '/api/stats') return json(res, 200, engine.stats());
  if (p === '/api/config') {
    const cfg = engine.config();
    const counts = Object.fromEntries(engine.store.sourcesList().map((x) => [x.id, x.count]));
    return json(res, 200, {
      ...cfg,
      sources: (cfg.sources || []).map((s) => ({ ...s, count: counts[s.id] || 0 }))
    });
  }
  if (p === '/api/schema') return json(res, 200, engine.schema.schemaFieldList());
  if (p === '/api/entries' && req.method === 'GET') {
    const q = url.searchParams;
    return json(res, 200, engine.store.listEntries({
      page: Number(q.get('page')) || 1,
      size: Math.min(200, Number(q.get('size')) || 20),
      domain: q.get('domain') || '',
      source: q.get('source') || '',
      q: q.get('q') || ''
    }));
  }
  if (p === '/api/search') {
    const q = url.searchParams.get('q') || '';
    const limit = Number(url.searchParams.get('limit')) || 8;
    const domain = url.searchParams.get('domain') || '';
    // 带领域筛选时多取一些再过滤（领域是 tags 判定的，不在检索打分里）
    let hits = engine.query(q, { limit: domain ? limit * 6 : limit });
    if (domain) hits = hits.filter((h) => domainOf(h.entry) === domain).slice(0, limit);
    return json(res, 200, { query: q, hits: hits.map((h) => ({ ...h.entry, _score: h.score, _domain: domainOf(h.entry) })) });
  }

  // ── 写 ────────────────────────────────────────────────
  if (p === '/api/entries' && req.method === 'POST') {
    const b = await readBody(req);
    const r = engine.store.rememberEntry(b || {});
    return json(res, r.ok ? 200 : 400, r);
  }
  if (p === '/api/entries' && req.method === 'DELETE') {
    const title = url.searchParams.get('title') || '';
    const r = engine.store.deleteUserEntry(title);
    return json(res, r.ok ? 200 : 400, r);
  }
  if (p === '/api/sources') {
    // 开关某个源：写 sources.local.json（本地覆盖，不改仓库里的主配置）
    const b = await readBody(req);
    const id = b.id;
    if (!id) return json(res, 400, { ok: false, error: '缺 id' });
    try {
      const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sources.local.json');
      let local = { sources: [] };
      if (fs.existsSync(file)) { try { local = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 坏了重来 */ } }
      const arr = local.sources || (local.sources = []);
      const i = arr.findIndex((s) => s.id === id);
      const patch = { id, enabled: b.enabled !== false };
      if (i >= 0) arr[i] = { ...arr[i], ...patch }; else arr.push(patch);
      fs.writeFileSync(file, JSON.stringify(local, null, 2), 'utf8');
      return json(res, 200, { ok: true, id, enabled: patch.enabled });
    } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
  }
  if (p === '/api/sync' && req.method === 'POST') {
    if (syncing) return json(res, 409, { ok: false, error: '已有同步在跑' });
    syncing = true;
    try {
      const body = await readBody(req);
      const only = body.only ? (Array.isArray(body.only) ? body.only : String(body.only).split(',')) : null;
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
