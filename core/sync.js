// 藏海 canghai · 同步编排
//
// 唯一入口逻辑：读 sources.config → 对每个启用的源：加载适配器 → fetch → normalize
// → validateMany 校验 → 原子写 kb 文件。全程异常隔离，产出结构化报告（面板/CLI 都用它）。
//
// 这条链不认识任何具体数据源，只认 contract 接口 + schema 约定 —— 这就是「加源不改核心」。

import fs from 'node:fs';
import path from 'node:path';
import { validateMany } from './schema.js';
import { getAdapter } from './sources/registry.js';
import { ERR, sourceError, isRetryable, describeError } from './errors.js';

/** 读数据源配置；sources.local.json 存在则覆盖同名项（便于本地实验不污染仓库）。 */
export function loadConfig(projectDir, store) {
  const base = path.join(projectDir, 'sources.config.json');
  let cfg = { version: 1, sources: [] };
  if (fs.existsSync(base)) {
    try { cfg = JSON.parse(fs.readFileSync(base, 'utf8')); } catch (e) { throw sourceError(ERR.PARSE, `配置解析失败 sources.config.json: ${e.message}`); }
  }
  const local = path.join(projectDir, 'sources.local.json');
  if (fs.existsSync(local)) {
    try {
      const ov = JSON.parse(fs.readFileSync(local, 'utf8'));
      cfg = mergeConfig(cfg, ov);
    } catch { /* 本地覆盖坏了就忽略，不影响主配置 */ }
  }
  return cfg;
}

function mergeConfig(base, ov) {
  const map = new Map((base.sources || []).map((s) => [s.id, { ...s }]));
  for (const s of (ov.sources || [])) map.set(s.id, { ...(map.get(s.id) || {}), ...s });
  return { ...base, ...ov, sources: [...map.values()] };
}

/**
 * 执行同步。
 * @param {object} deps { projectDir, store, fetch, log, dataDir, fetchRetries }
 * @param {object} opts { only: string[] }  只同步指定源 id
 * @returns 报告 { startedAt, finishedAt, sources:[{id,label,ok,count,rejected,dropped,ms,error}], total }
 */
export async function runSync(deps, opts = {}) {
  const { projectDir, store, log = () => {}, fetchRetries = 2 } = deps;
  const cfg = loadConfig(projectDir, store);
  const wanted = opts.only?.length ? new Set(opts.only) : null;
  const report = { startedAt: new Date().toISOString(), sources: [], total: 0 };

  for (const src of (cfg.sources || [])) {
    if (wanted && !wanted.has(src.id)) continue;
    const rec = { id: src.id, label: src.id, ok: false, count: 0, rejected: 0, dropped: 0, ms: 0 };
    const t0 = Date.now();

    if (src.enabled === false) {
      rec.skipped = true; rec.reason = '已停用';
      report.sources.push(rec); continue;
    }

    try {
      const adapter = await getAdapter(src.adapter);
      rec.label = adapter.label || src.adapter;
      const config = { ...(adapter.configSpec ? defaultsOf(adapter.configSpec) : {}), ...(src.config || {}) };
      const ctx = makeCtx(deps, src, config, log);

      const raw = await fetchWithRetry(adapter, ctx, fetchRetries, log);
      const list = adapter.normalize(raw, ctx) || [];
      const { entries, rejected } = validateMany(list, src.id);
      rec.rejected = rejected.length;

      if (!entries.length) {
        // 一条合法数据都没有 → 不覆盖旧库（shouldKeepOld 语义）。
        rec.error = '无有效数据，保留旧库';
        rec.count = 0;
        report.sources.push(rec); continue;
      }

      const fileName = src.target || adapter.targetFile || `${src.id}.json`;
      store.writeFile(fileName, {
        _source: src.id,
        _adapter: src.adapter,
        _generated: true,
        _syncedAt: new Date().toISOString(),
        entries
      });
      rec.ok = true;
      rec.count = entries.length;
      report.total += entries.length;
      if (rejected.length) rec.note = `${rejected.length} 条不合格式已跳过`;
    } catch (e) {
      rec.error = describeError(e) || String(e.message || e);
    } finally {
      rec.ms = Date.now() - t0;
      report.sources.push(rec);
      log(`${rec.ok ? '✅' : '⚠️'} ${rec.label}: ${rec.ok ? rec.count + ' 条' : (rec.error || '未同步')} (${rec.ms}ms)`);
    }
  }

  // 写完统一让 store 重载缓存，反映最新磁盘状态。
  store.invalidate();
  report.finishedAt = new Date().toISOString();
  report.okCount = report.sources.filter((s) => s.ok).length;
  report.failCount = report.sources.filter((s) => s.error).length;
  return report;
}

function defaultsOf(spec) {
  const o = {};
  for (const [k, v] of Object.entries(spec)) if (v && v.default !== undefined) o[k] = v.default;
  return o;
}

function fetchWithRetry(adapter, ctx, retries, log) {
  return (async () => {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await adapter.fetch(ctx);
      } catch (e) {
        last = e;
        if (!isRetryable(e) || attempt === retries) break;
        const delay = Number(e.retryAfter) || 800 * (attempt + 1);
        log(`  ↻ ${adapter.id} 第 ${attempt + 1} 次失败（${e.code}），${delay}ms 后重试`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw last;
  })();
}

function makeCtx(deps, src, config, log) {
  return {
    config,
    dataDir: deps.dataDir,
    pkgRoot: deps.projectDir,
    log: (m) => log(`  · ${src.id}: ${m}`),
    now: Date.now,
    // 统一带 UA + 超时的 fetch；json:true 直接返回解析后的对象。
    fetch: async (url, opt = {}) => {
      const r = await deps.fetch(url, {
        headers: { 'User-Agent': 'canghai-kb/0.1 (+https://github.com/)', ...(opt.headers || {}) },
        signal: AbortSignal.timeout(opt.timeoutMs || 20000)
      });
      if (!r.ok) {
        const e = sourceError(/401|403/.test(String(r.status)) ? ERR.AUTH : r.status === 404 ? ERR.PARSE : ERR.HTTP, `HTTP ${r.status}`, { status: r.status, sourceId: src.id });
        if (r.status === 429) { const ra = Number(r.headers.get?.('retry-after')); if (ra) e.retryAfter = ra * 1000; }
        throw e;
      }
      return opt.json ? r.json() : r.text();
    }
  };
}
