// 数据源：本地 JSON 文件
//
// 最基础的适配器，也是「自定义数据」的入口：你把任何符合 schema 的 json 放进
// config.dir，它负责读进来。用于人工种子库、离线导入、以及测试管线本身。
// 同时它是所有远程源的兜底 —— 远程挂了还能用本地这份。

import fs from 'node:fs';
import path from 'node:path';

export default {
  id: 'local-file',
  label: '本地文件',
  configSpec: {
    dir: { type: 'string', default: 'seed', label: '文件目录（相对 dataDir）' },
    pattern: { type: 'string', default: '*.json', label: '文件匹配（仅 *.json）' }
  },

  async fetch(ctx) {
    const dir = path.resolve(ctx.dataDir, ctx.config.dir || 'seed');
    if (!fs.existsSync(dir)) {
      // 目录不存在不算错误，返回空，让 sync 跳过（首次 clone 后没种子是正常的）。
      ctx.log(`本地目录不存在，跳过：${dir}`);
      return [];
    }
    const files = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
    const all = [];
    for (const f of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const list = Array.isArray(raw) ? raw : (raw.entries || []);
        for (const e of list) all.push({ ...e, _target: ctx.config.targetFile || undefined });
      } catch (e) {
        ctx.log(`本地文件解析失败 ${f}: ${e.message}`);
      }
    }
    return all;
  },

  // 本地文件已是 entry 形状，直接透传（校验交给 sync 的 validateMany）。
  normalize(raw) { return Array.isArray(raw) ? raw : []; }
};
