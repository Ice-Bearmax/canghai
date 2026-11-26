// 藏海 · QQAgent 适配器（setup(api) 接口）
//
// 部署：把整个 canghai 目录拷到 QQAgent 的 plugins/canghai/。
// 本文件在 plugins/canghai/adapters/qqagent/index.js，核心在 ../../（../../index.js）。
//
// 注册 3 个工具（对齐原 trendy-memes 的能力，替换它不降级）：
//   lookup   查词（是什么/是谁）
//   index    浏览目录（库里都有什么 / 查不到时如实说有什么）
//   remember 自学习（查明白的新梗写进本地 user 库，下次不再联网查）
//
// 与记忆系统的边界：只读写自己的 dataDir（seed/kb/user），绝不碰 memory-v2。

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..'); // canghai 仓库根

export async function setup(api) {
  const { createEngine } = await import(pathToFileURL(path.join(ROOT, 'index.js')).href);

  const cfg = (api.config && api.config()) || {};
  // 数据目录：默认放宿主数据区（与记忆隔离），可用设置覆盖
  const dataDir = cfg.dataDir || path.join(process.env.QQ_AGENT_DATA_DIR || ROOT, 'canghai');

  const engine = createEngine({
    dataDir,
    fetch: api.fetch ? (u, o) => api.fetch(u, o) : (u, o) => globalThis.fetch(u, o),
    log: (...a) => api.log && api.log(...a)
  });

  const limit = Number(cfg.lookupLimit) || 3;
  const allowTeach = cfg.allowTeach !== false;

  // ── 1. 查词 ─────────────────────────────────────────────
  api.registerTool({
    id: 'lookup',
    name: '查图鉴',
    description:
      '查「某个梗/角色/作品/术语是什么」。本地知识图鉴，秒回、不联网。' +
      '触发场景：看到不认识的网络梗、问某动漫/游戏角色是谁、某作品名场面是什么。' +
      '注意分工：问「是什么/是谁」用本工具；问「我们上次聊过没有/他说过什么」用记忆检索，不要用本工具。' +
      '查不到不代表没有，可能是没同步——不确定就联网查，别硬猜。',
    category: 'knowledge',
    icon: '🔍',
    parameters: {
      type: 'object',
      properties: { term: { type: 'string', description: '要查的词：梗名/角色名/作品名/术语' } },
      required: ['term']
    },
    async execute(_ctx, args) {
      return { content: engine.lookup(args?.term || '', { limit }).text };
    }
  });

  // ── 2. 目录 ─────────────────────────────────────────────
  api.registerTool({
    id: 'index',
    name: '图鉴目录',
    description:
      '列出图鉴库里已有的条目。用在：想知道库里覆盖了哪些梗/角色，或查不到时如实告诉对方库里有什么。' +
      '可用 keyword 只看含这个词的条目。',
    category: 'knowledge',
    icon: '📚',
    parameters: {
      type: 'object',
      properties: { keyword: { type: 'string', description: '可选：只看标题/别名/标签里含这个词的条目' } }
    },
    async execute(_ctx, args) {
      const { total, items } = engine.store.indexEntries(args?.keyword || '', Number(cfg.indexLimit) || 30);
      if (!total) return { content: args?.keyword ? `图鉴里没有含「${args.keyword}」的条目。` : '图鉴目前是空的。' };
      const lines = items.map((e) => `· ${e.title}${e.freshness ? `（${e.freshness}）` : ''}${e.meaning ? `：${e.meaning.slice(0, 30)}` : ''}`);
      const tail = total > items.length ? `\n…还有 ${total - items.length} 条没列出。` : '';
      return { content: `图鉴共 ${total} 条：\n${lines.join('\n')}${tail}` };
    }
  });

  // ── 3. 收录（自学习）────────────────────────────────────
  api.registerTool({
    id: 'remember',
    name: '收录图鉴',
    description:
      '把一个查明白的梗/角色/设定写进本地图鉴（自学习库），下次不用再联网查。' +
      '只在**确实学到**库里没有的东西、且判断以后还会用到时使用；不要每句话都记。' +
      'title 是名字，meaning 是一句话说明，usage 是怎么用。',
    category: 'knowledge',
    icon: '💾',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '条目名，例如「尊嘟假嘟」' },
        meaning: { type: 'string', description: '一句话说明它是什么/什么意思' },
        usage: { type: 'string', description: '怎么用、什么场合用，可举例句' },
        aliases: { type: 'string', description: '可选：其他写法，逗号分隔' },
        era: { type: 'string', description: '可选：出处/哪阵子火的' },
        tags: { type: 'string', description: '可选：标签，逗号分隔' }
      },
      required: ['title', 'meaning']
    },
    async execute(_ctx, args) {
      if (!allowTeach) return { content: '当前设置不允许收录（「允许机器人自己收录」是关的），请直接回答。', isError: true };
      const r = engine.store.rememberEntry(args || {});
      if (!r.ok) return { content: `收录失败：${r.error}`, isError: true };
      return {
        content: `${r.updated ? '已更新' : '已收录'}「${args.title}」，自学习库现有 ${r.count} 条。`
          + '（不要向群友报告收录动作，继续正常聊天即可。）'
      };
    }
  });

  // 软依赖：声明能力供其它插件调用
  if (api.registerCapability) {
    api.registerCapability('knowledge.canghai', async (args = {}) => {
      const term = args.term || args.query || '';
      return term ? engine.lookup(term, { limit: args.limit || limit }) : { text: '', hits: [] };
    });
  }

  // 首次启动：库空则从包内种子灌入（不联网），再后台增量同步
  (async () => {
    try {
      if (engine.stats().total === 0) {
        await engine.sync({ only: ['seed'] });
        api.log && api.log(`首次初始化：已灌入种子库 ${engine.stats().total} 条`);
      }
      if (cfg.autoSync === false) return; // 设置里关了就不联网
      engine.sync()
        .then((rep) => api.log && api.log(`后台同步：入库 ${rep.total} 条，成功 ${rep.okCount}/${rep.sources.length} 源`))
        .catch((e) => api.warn && api.warn(`后台同步失败（不影响查已有库）：${e.message}`));
    } catch (e) {
      api.warn && api.warn(`初始化异常（不影响进程）：${e.message}`);
    }
  })();

  // 面板服务：技能加载时后台拉起（端口已占用则跳过）。
  // 这样托盘/插件卡片的「面板」按钮点开即用，不必等 spawn。
  ensurePanelServer(dataDir, Number(cfg.panelPort) || 8792, api);

  api.log && api.log(`藏海就绪：库内 ${engine.stats().total} 条，数据目录 ${dataDir}`);
  return { engine };
}

/** 端口没开就后台起 server.js（detached，随系统存活；端口已开直接跳过）。 */
function ensurePanelServer(dataDir, port, api) {
  const check = () => globalThis.fetch(`http://127.0.0.1:${port}/api/stats`, { signal: AbortSignal.timeout(1200) })
    .then((r) => r.ok).catch(() => false);

  (async () => {
    if (await check()) { api.log && api.log(`面板服务已在 ${port} 运行`); return; }
    try {
      const { spawn } = await import('node:child_process');
      const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), `--data=${dataDir}`], {
        detached: true, stdio: 'ignore', windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CANGHAI_PORT: String(port) }
      });
      child.unref();
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (await check()) { api.log && api.log(`面板服务已启动：http://127.0.0.1:${port}`); return; }
      }
      api.warn && api.warn(`面板服务启动超时（端口 ${port}），可手动运行 server.js`);
    } catch (e) {
      api.warn && api.warn(`面板服务启动失败：${e.message}（不影响查词）`);
    }
  })();
}