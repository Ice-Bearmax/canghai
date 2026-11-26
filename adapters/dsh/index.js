// 藏海 · DSH (Cordis) 适配器
//
// 安装（推荐）：
//   dsh plugin --profile desktop add github:<owner>/canghai
// 或手动：把本仓库作为插件放入，在 $DSH_HOME/profiles/<profile>/cordis.patch.yml 追加：
//   - insert:
//       - id: canghai
//         name: canghai
//
// 与 QQAgent 版共用同一个 core（./core）。两版只是「接线方式」不同。
//
// 开箱即用：首次启动若本地库为空，自动灌入 data/seed（不联网、毫秒级），
// 随后可选在后台跑一次全量同步（需联网，失败不影响已可用的种子库）。

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const name = 'canghai';
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

  // ── 注册工具（写死与记忆的分工边界）────────────────────────────
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

    register({
      name: 'canghai_sync',
      description: '从外部数据源拉取最新知识更新本地图鉴（联网、耗时；一般由定时任务跑，主人要求手动更新时才调）。',
      parameters: {
        type: 'object',
        properties: { only: { type: 'string', description: '只同步某源 id，逗号分隔；留空=全部' } }
      },
      async execute(args) {
        const rep = await engine.sync({ only: args?.only ? String(args.only).split(',') : null });
        return {
          text: `同步完成：入库 ${rep.total} 条，成功 ${rep.okCount}/${rep.sources.length} 源。` +
            rep.sources.map((s) => `\n- ${s.label}: ${s.ok ? s.count + ' 条' : (s.error || '跳过')}`).join('')
        };
      }
    });
  }

  // ── 首次启动：库空则灌种子（不联网），再后台尝试全量同步 ──────────
  (async () => {
    try {
      if (engine.stats().total === 0) {
        await engine.sync({ only: ['seed'] });
        ctx.logger?.info?.('canghai', `首次初始化：已灌入种子库 ${engine.stats().total} 条`);
      }
      // 后台增量（失败无声，保留已有库）。CANGHAI_NO_BG_SYNC=1 可关（纯离线/测试）。
      if (process.env.CANGHAI_NO_BG_SYNC === '1') return;
      engine.sync()
        .then((rep) => ctx.logger?.info?.('canghai', `后台同步：入库 ${rep.total} 条，成功 ${rep.okCount}/${rep.sources.length} 源`))
        .catch((e) => ctx.logger?.warn?.('canghai', `后台同步失败（不影响查已有库）：${e.message}`));
    } catch (e) {
      ctx.logger?.warn?.('canghai', `初始化异常（不影响进程）：${e.message}`);
    }
  })();

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => { /* dispose：引擎无长驻资源 */ });
  }

  ctx.logger?.info?.('canghai', `就绪：库内 ${engine.stats().total} 条`);
}
