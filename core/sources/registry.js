// 藏海 canghai · 数据源注册表
//
// 按 id 动态 import core/sources/ 下的适配器文件。config 里写 `adapter: 'genshin-db'`，
// registry 就去加载 `genshin-db.js`。加新源 = 丢一个文件进目录，registry 自动发现，零改动。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkAdapter } from './contract.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 扫描 sources 目录下所有适配器文件（排除 contract/registry 自身与 _ 前缀的内部文件）。 */
export function listAdapterFiles() {
  return fs.readdirSync(HERE)
    .filter((n) => n.endsWith('.js') && !['contract.js', 'registry.js'].includes(n) && !n.startsWith('_'))
    .map((n) => n.replace(/\.js$/, ''));
}

const loaded = new Map(); // id -> adapter

/** 按 id 加载适配器（带缓存）。找不到/不合格则抛错。 */
export async function getAdapter(id) {
  if (loaded.has(id)) return loaded.get(id);
  const file = path.join(HERE, `${id}.js`);
  if (!fs.existsSync(file)) {
    throw new Error(`数据源适配器不存在：${id}（应为 core/sources/${id}.js）`);
  }
  const mod = await import(pathToFileURL(file).href);
  const adapter = mod.default || mod;
  const problems = checkAdapter(adapter);
  if (problems.length) {
    throw new Error(`适配器 ${id} 不合规：${problems.join('；')}`);
  }
  loaded.set(id, adapter);
  return adapter;
}

/** 列出所有可用适配器及其元信息（面板「可用数据源」列表用）。 */
export async function describeAdapters() {
  const out = [];
  for (const id of listAdapterFiles()) {
    try {
      const a = await getAdapter(id);
      out.push({ id, label: a.label || id, configSpec: a.configSpec || {}, targetFile: a.targetFile || null });
    } catch (e) {
      out.push({ id, label: id, error: e.message });
    }
  }
  return out;
}

/** 供测试/热重载时清缓存。 */
export function resetCache() { loaded.clear(); }
