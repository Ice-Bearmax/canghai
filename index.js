// 藏海 canghai · 主入口（宿主无关）
//
// 对外只暴露一个 createEngine()：宿主适配器（QQAgent/DSH）和 CLI 都用它。
// 引擎 = store（存/检索）+ sync（更新）+ config（数据源）。
// 这样「核心逻辑」只有一份，两版宿主只是不同的「接线方式」。

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './core/kb-store.js';
import { runSync, loadConfig } from './core/sync.js';
import { formatEntry } from './core/search.js';
import * as schema from './core/schema.js';

const PKG_ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {object} opts
 *   dataDir  藏海自己的数据目录（默认 <包>/data）—— 关键：绝不用记忆系统的目录
 *   fetch    注入的 fetch（宿主用自己的，避免依赖全局；默认 globalThis.fetch）
 *   log      日志函数
 */
export function createEngine(opts = {}) {
  const dataDir = opts.dataDir || path.join(PKG_ROOT, 'data');
  const store = createStore(dataDir);
  const log = opts.log || ((...a) => console.log('[canghai]', ...a));
  const rawFetch = opts.fetch || ((url, init) => globalThis.fetch(url, init));

  return {
    dataDir,
    store,
    log,
    /** 检索：返回 [{entry, score}]。 */
    query(q, o) { return store.query(q, o); },
    /** 检索并渲染成文本（给模型/CLI 直接读）。 */
    lookup(q, o = {}) {
      const hits = store.query(q, { limit: o.limit || 3, ...o });
      if (!hits.length) return { text: `【图鉴】「${q}」没查到（可能没同步或不是收录范围）。`, hits: [] };
      return {
        text: hits.map((h) => formatEntry(h.entry)).join('\n\n'),
        hits: hits.map((h) => ({ title: h.entry.title, score: h.score, source: h.entry._source }))
      };
    },
    stats() { return store.stats(); },
    sync(o) {
      return runSync(
        { projectDir: PKG_ROOT, dataDir, store, log, fetch: rawFetch },
        o
      );
    },
    config() { return loadConfig(PKG_ROOT, store); },
    schema
  };
}

export { createStore, runSync, formatEntry };
