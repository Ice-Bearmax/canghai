// 藏海 · QQAgent 适配器（setup(api) 接口）
//
// 部署：把整个 canghai 目录拷到 QQAgent 的 plugins/canghai/。
// 本文件在 plugins/canghai/adapters/qqagent/index.js，核心在 ../../（../../index.js）。
//
// 职责：把「引擎」接到 QQAgent 的插件 API 上 —— 注册一个查词工具给模型用、
// 可选启动面板、可选开机同步。核心逻辑不在这儿，在仓库根的 core/。
//
// 与记忆系统的边界：只读自己的 dataDir/kb，绝不碰 memory-v2。见 README「为何不冲突」。

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..'); // canghai 仓库根

export async function setup(api) {
  // 动态 import 仓库根的引擎（不打包，保持单一实现）
  const { createEngine } = await import(path.join(ROOT, 'index.js').replace(/\\/g, '/') );
  // QQAgent 用宿主 data 目录，和记忆隔离；也可在设置里覆盖
  const cfg = api.config ? api.config() : {};
  const dataDir = cfg.dataDir || path.join(process.env.QQ_AGENT_DATA_DIR || ROOT, 'canghai');

  const engine = createEngine({
    dataDir,
    // 注入宿主的 fetch（若暴露）否则用全局
    fetch: (api.fetch) ? (u, o) => api.fetch(u, o) : (u, o) => globalThis.fetch(u, o),
    log: (...a) => api.log && api.log(...a)
  });

  const limit = Number(cfg.lookupLimit) || 3;

  // ★ 注册给模型的查词工具。描述里写死边界词：「是什么/谁」=查藏海，「上次/之前」=记忆。
  api.registerTool({
    id: 'lookup',
    description:
      '查「某个梗/角色/作品/术语是什么」。本地图鉴，秒回、不联网。' +
      '触发场景：看到不认识的网络梗、问某动漫/游戏角色是谁、某作品名场面是什么。' +
      '注意分工：问「是什么/是谁」用本工具；问「我们上次聊过没有/他说过什么」用记忆检索(memory.search)，不要用本工具。' +
      '查不到不代表没有，可能是没同步——不确定就 web_search 兜底，别硬猜。',
    parameters: {
      type: 'object',
      properties: {
        term: { type: 'string', description: '要查的词：梗名/角色名/作品名/术语' }
      },
      required: ['term']
    },
    async run({ term }) {
      const r = engine.lookup(term, { limit });
      return r.text;
    }
  });

  // 软依赖：把自己声明成一个能力，别的插件可 api.capability('knowledge.canghai', {term})
  if (api.registerCapability) {
    api.registerCapability('knowledge.canghai', async (args = {}) => {
      const term = args.term || args.query || '';
      return term ? engine.lookup(term, { limit: args.limit || limit }) : { text: '', hits: [] };
    });
  }

  // 可选：开机后台同步（默认关，避免每次启动都联网拖慢）
  if (cfg.autoSync) {
    setTimeout(() => {
      engine.sync().then((rep) => api.log && api.log(`启动同步完成：入库 ${rep.total} 条，成功 ${rep.okCount} 源`))
        .catch((e) => api.warn && api.warn('启动同步失败（不影响查已有库）：', e.message));
    }, 8000);
  }

  // 可选：起面板（独立进程更稳，这里只提示）
  api.log && api.log(`藏海就绪：库内 ${engine.stats().total} 条。面板：node ${path.join(ROOT, 'server.js')}`);

  return { engine };
}
