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

// 来源优先级：数字大的覆盖小的。自学习 > 人工精选 > 自动同步。
const PRIORITY = {
  user: 200,      // 机器人自学习（运行时写入，最新最准）
  seed: 100,      // 人工精选
  manual: 100,
  default: 50,
  generated: 10   // 数据源自动同步
};

export function createStore(dataDir) {
  const KB = path.join(dataDir, 'kb');       // 同步产物（最低优先级）
  const SEED = path.join(dataDir, 'seed');   // 人工精选（随包发布）
  const USER = path.join(dataDir, 'user');   // 机器人自学习（最优先，运行时写入）
  const USER_FILE = path.join(USER, 'user-added.json');
  let cache = null;      // { entries, index }
  let indexVersion = 0;  // 数据变了就 ++，让 search 的缓存索引失效重建

  function ensureDir() {
    fs.mkdirSync(KB, { recursive: true });
  }

  function readJson(file, fallback = null) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  }

  /** 列出 user/ seed/ kb/ 下的所有 json（优先级从高到低）。 */
  function listSources() {
    const out = [];
    for (const [dir, kind] of [[USER, 'user'], [SEED, 'seed'], [KB, 'kb']]) {
      let names = [];
      try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { continue; }
      for (const name of names) out.push({ file: path.join(dir, name), name, kind });
    }
    return out;
  }

  /**
   * 加载全部条目：读所有文件 → schema 校验 → 按 title 去重（高优先级覆盖）。
   * 带内存缓存；任何写入后调 invalidate() 清缓存并重建索引版本号。
   */
  /**
   * 数据指纹：文件列表 + mtime + size。外部改了文件（如定时任务补条目）也能被发现。
   * 代价是每次 loadAll 一次 readdir+stat（十几文件，可忽略）。
   */
  function signature() {
    const parts = [];
    for (const { file } of listSources()) {
      try { const s = fs.statSync(file); parts.push(`${file}:${s.mtimeMs}:${s.size}`); } catch { /* 刚被删 */ }
    }
    return parts.join('|');
  }

  function loadAll() {
    const sig = signature();
    if (cache && cache.sig === sig) return cache.entries;
    ensureDir();
    const byTitle = new Map(); // normKey -> { entry, prio, source }
    const report = { files: 0, total: 0, rejected: 0, droppedDup: 0 };

    for (const { file, name, kind } of listSources()) {
      const raw = readJson(file);
      if (!raw) continue;
      report.files++;
      // 允许 { entries: [] } 或 [] 两种；_generated:true 视为同步产物（低优先级）
      const list = Array.isArray(raw) ? raw : (raw.entries || []);
      // 优先级：自学习(user) > 人工精选(seed) > 同步产物(kb)
      const prio = kind === 'user' ? PRIORITY.user
        : (kind === 'seed' ? PRIORITY.manual : PRIORITY.generated);
      // 来源标识：优先用数据源给的短 id；太长（如 chime 的许可串）就用文件名。
      const rawSrc = raw._source ? String(raw._source) : '';
      const srcId = (rawSrc && rawSrc.length <= 24 && !/\s/.test(rawSrc)) ? rawSrc : name.replace(/\.json$/, '');
      const { entries, rejected } = validateMany(list, srcId);
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
    cache = { entries, index: null, sig };
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
  /**
   * 原子写。**幂等**：条目内容没变就不落盘（只更新 _syncedAt 不算变化），
   * 否则定时任务每次跑都会产生一行时间戳 diff，自动提交变成垃圾噪音。
   * @returns {{file:string, skipped:boolean, changed:number}}
   */
  function writeFile(fileName, payload) {
    ensureDir();
    if (!/^[A-Za-z0-9_.\-]+\.json$/.test(fileName)) {
      throw new Error(`非法文件名（防路径穿越）：${fileName}`);
    }
    const file = path.join(KB, fileName);

    // 内容比对：只看 entries，忽略 _syncedAt / _generated 这类元数据。
    const prev = readJson(file);
    const prevEntries = prev && (Array.isArray(prev) ? prev : prev.entries) || [];
    const nextEntries = payload.entries || [];
    if (JSON.stringify(prevEntries) === JSON.stringify(nextEntries)) {
      return { file, skipped: true, changed: 0 };
    }

    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, file); // 同盘 rename 是原子的
    invalidate();
    return { file, skipped: false, changed: nextEntries.length };
  }

  /**
   * 收录一条自学习条目（机器人查明白某个梗/角色后写进来，下次不用再查）。
   * 同标题/别名已存在则合并覆盖，不堆重复。上限防无限膨胀。
   * @returns {{ok:boolean, updated?:boolean, count?:number, error?:string}}
   */
  function rememberEntry(input = {}, maxEntries = 2000) {
    const title = String(input.title ?? '').trim();
    const meaning = String(input.meaning ?? '').trim();
    if (!title || !meaning) return { ok: false, error: '缺少 title 或 meaning' };

    const split = (raw) => String(raw ?? '').split(/[,，、;；]+/).map((s) => s.trim()).filter(Boolean);
    const cur = readJson(USER_FILE, { entries: [] });
    const list = Array.isArray(cur) ? cur : (cur.entries || []);

    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
    const t = norm(title);
    const at = list.findIndex((e) => norm(e.title) === t || (e.aliases || []).some((a) => norm(a) === t));

    const entry = {
      title,
      aliases: split(input.aliases),
      meaning,
      usage: String(input.usage ?? '').trim(),
      era: String(input.era ?? '').trim(),
      freshness: '自学习',
      tags: split(input.tags)
    };

    if (at >= 0) {
      list[at] = { ...list[at], ...entry, aliases: [...new Set([...(list[at].aliases || []), ...entry.aliases])] };
    } else {
      if (list.length >= maxEntries) return { ok: false, error: `自学习库已达上限 ${maxEntries} 条，请先整理 ${USER_FILE}` };
      list.push(entry);
    }

    try {
      fs.mkdirSync(USER, { recursive: true });
      fs.writeFileSync(USER_FILE, JSON.stringify({ entries: list }, null, 2), 'utf8');
      invalidate();
    } catch (e) {
      return { ok: false, error: `写入失败：${e.message}` };
    }
    return { ok: true, updated: at >= 0, count: list.length };
  }

  /** 浏览目录：按关键词过滤标题/别名/标签，返回精简列表。 */
  function indexEntries(keyword = '', limit = 30) {
    const k = String(keyword || '').toLowerCase().replace(/\s+/g, '');
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
    let all = loadAll();
    if (k) {
      all = all.filter((e) => norm(e.title).includes(k)
        || (e.aliases || []).some((a) => norm(a).includes(k))
        || (e.tags || []).some((t) => norm(t).includes(k)));
    }
    return { total: all.length, items: all.slice(0, Math.max(5, Math.min(limit, 80))) };
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
      files: listSources().length,
      bySource,
      topTags: Object.entries(byTag).sort((a, b) => b[1] - a[1]).slice(0, 20),
      loadReport: loadAll._report || null
    };
  }

  return { KB, SEED, USER, USER_FILE, listSources, loadAll, query, invalidate, writeFile, stats, formatEntry, rememberEntry, indexEntries };
}

function normKey(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}
