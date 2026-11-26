// 藏海 canghai · 知识存储
//
// 物理边界：藏海的数据**只**存在自己指定的 dataDir/kb/ 下的 json 里，
// 绝不写进记忆系统（memory-v2）。这是「不冲突」最硬的一条保证。
//
// 每个 kb 文件形如 { entries: [...] } 或直接 [...]。同步产物与人工种子分文件，
// 去重时按「来源优先级」：手工种子 > 同步产物（同名条目以种子为准，避免上游脏数据盖掉人工校正）。

import fs from 'node:fs';
import path from 'node:path';
import { validateMany } from './schema.js';
import { search as searchEntries, buildSearchIndex, formatEntry } from './search.js';

// 来源优先级：数字大的覆盖小的。人工手写的库优先于自动同步的。
const PRIORITY = {
  seed: 100,      // 人工精选
  manual: 100,
  default: 50,
  generated: 10   // 数据源自动同步
};

export function createStore(dataDir) {
  const KB = path.join(dataDir, 'kb');
  let cache = null;      // { entries, index }
  let indexVersion = 0;  // 数据变了就 ++，让 search 的缓存索引失效重建

  function ensureDir() {
    fs.mkdirSync(KB, { recursive: true });
  }

  function readJson(file, fallback = null) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  }

  /** 列出所有 kb 文件（按文件名排序，稳定）。 */
  function listFiles() {
    try {
      return fs.readdirSync(KB).filter((n) => n.endsWith('.json')).sort();
    } catch { return []; }
  }

  /**
   * 加载全部条目：读所有文件 → schema 校验 → 按 title 去重（高优先级覆盖）。
   * 带内存缓存；任何写入后调 invalidate() 清缓存并重建索引版本号。
   */
  function loadAll() {
    if (cache) return cache.entries;
    ensureDir();
    const byTitle = new Map(); // normKey -> { entry, prio, source }
    const report = { files: 0, total: 0, rejected: 0, droppedDup: 0 };

    for (const name of listFiles()) {
      const raw = readJson(path.join(KB, name));
      if (!raw) continue;
      report.files++;
      // 允许 { entries: [] } 或 [] 两种；_generated:true 视为同步产物（低优先级）
      const list = Array.isArray(raw) ? raw : (raw.entries || []);
      const isGen = raw._generated === true || /-roster|-season|generated/.test(name);
      const prio = isGen ? PRIORITY.generated : (raw._manual ? PRIORITY.manual : PRIORITY.default);
      const { entries, rejected } = validateMany(list, raw._source || name.replace('.json', ''));
      report.total += entries.length;
      report.rejected += rejected.length;

      for (const e of entries) {
        const key = normKey(e.title);
        const prev = byTitle.get(key);
        const myPrio = e._source && /roster|season/.test(e._source) ? PRIORITY.generated : prio;
        if (!prev || myPrio >= prev.prio) {
          if (prev) report.droppedDup++;
          byTitle.set(key, { entry: e, prio: myPrio });
        } else {
          report.droppedDup++;
        }
      }
    }
    const entries = [...byTitle.values()].map((v) => v.entry);
    cache = { entries, index: null };
    indexVersion++;
    loadAll._report = report;
    return entries;
  }

  /** 检索（带预建索引缓存）。 */
  function query(q, opts = {}) {
    const entries = loadAll();
    if (!cache.index || cache._idxVer !== indexVersion) {
      cache.index = buildSearchIndex(entries);
      cache._idxVer = indexVersion;
    }
    return searchEntries(entries, q, { ...opts, index: cache.index });
  }

  /** 清缓存（写入/同步后调用），让下次 loadAll 重读磁盘。 */
  function invalidate() {
    cache = null;
  }

  /**
   * 原子写一个 kb 文件：先写 .tmp 再 rename，避免写一半崩溃损坏库。
   * @param {string} fileName 如 'genshin-roster.json'
   * @param {object} payload { entries, _source, _syncedAt, ... }
   */
  function writeFile(fileName, payload) {
    ensureDir();
    if (!/^[A-Za-z0-9_.\-]+\.json$/.test(fileName)) {
      throw new Error(`非法文件名（防路径穿越）：${fileName}`);
    }
    const file = path.join(KB, fileName);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, file); // 同盘 rename 是原子的
    invalidate();
    return file;
  }

  /** 统计：给面板概览与 CLI stats 用。 */
  function stats() {
    const entries = loadAll();
    const bySource = {};
    const byTag = {};
    for (const e of entries) {
      bySource[e._source || '?'] = (bySource[e._source || '?'] || 0) + 1;
      for (const t of (e.tags || [])) byTag[t] = (byTag[t] || 0) + 1;
    }
    return {
      total: entries.length,
      files: listFiles().length,
      bySource,
      topTags: Object.entries(byTag).sort((a, b) => b[1] - a[1]).slice(0, 20),
      loadReport: loadAll._report || null
    };
  }

  return { KB, listFiles, loadAll, query, invalidate, writeFile, stats, formatEntry };
}

function normKey(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}
