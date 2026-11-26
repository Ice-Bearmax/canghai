// 藏海 · DSH (Cordis) 适配器
//
// 部署：DSH 的插件走 Cordis。把 canghai 目录作为插件放入，并在 DSH_HOME/profiles/<profile>/
// cordis.patch.yml 里加一条：
//   - insert:
//       - id: canghai
//         name: canghai
// 然后重载插件。入口即本文件（Cordis 约定 export apply(ctx)）。
//
// 与 QQAgent 版共用同一个 core（../../index.js）—— 两版只是「接线方式」不同，
// 检索/数据源/存储逻辑完全一致。这就是「做两版」的正确姿势：一份内核，两个壳。

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export const name = 'canghai';
// 只注入用得到的服务；缺失也能跑（工具不注册但引擎可用）。
export const inject = ['tools'];

export async function apply(ctx) {
  const { createEngine } = await import(pathToFileURL(path.join(ROOT, 'index.js')).href);

  const dataDir = process.env.CANGHAI_DATA_DIR || path.join(ROOT, 'data');
  const engine = createEngine({
    dataDir,
    fetch: (u, o) => globalThis.fetch(u, o),
    log: (...a) => ctx.logger?.info?.('canghai', ...a)
  });

  const limit = Number(process.env.CANGHAI_LOOKUP_LIMIT) || 3;

  // 注册查词工具给 DSH 的 agent。描述写死与记忆的分工边界。
  const register = ctx.tools?.register;
  if (typeof register === 'function') {
    register({
      name: 'canghai_lookup',
      description:
        '查「某个梗/角色/作品/术语是什么」。本地知识图鉴，秒回、不联网。' +
        '适合：不认识的网络梗、问某动漫/游戏角色是谁、某作品名场面。' +
        '分工：问「是什么/是谁」用本工具；问「之前聊过没有/说过什么」用记忆检索，不要用本工具。' +
        '查不到 ≠ 没有，可能未同步；不确定再联网查，别硬猜。',
      parameters: {
        type: 'object',
        properties: { term: { type: 'string', description: '要查的词：梗名/角色名/作品名/术语' } },
        required: ['term']
      },
      async execute(args) {
        const r = engine.lookup(args?.term || '', { limit });
        return { text: r.text };
      }
    });
    // 同步工具（可选，让 agent 也能触发更新）
    register({
      name: 'canghai_sync',
      description: '从外部数据源拉取最新知识更新本地图鉴（联网、耗时；一般由定时任务跑，主人要求手动更新时才调）。',
      parameters: { type: 'object', properties: { only: { type: 'string', description: '只同步某源 id，逗号分隔；留空=全部' } } },
      async execute(args) {
        const rep = await engine.sync({ only: args?.only ? String(args.only).split(',') : null });
        return { text: `同步完成：入库 ${rep.total} 条，成功 ${rep.okCount}/${rep.sources.length} 源。` +
          rep.sources.map((s) => `\n- ${s.label}: ${s.ok ? s.count + '条' : (s.error || '跳过')}`).join('') };
      }
    });
  }

  // 生命周期：DSH 卸载插件时清资源（此处引擎无长驻资源，占位防止内存泄漏告警）。
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => { /* dispose */ });
  }

  ctx.logger?.info?.('canghai', `就绪：库内 ${engine.stats().total} 条`);
}
