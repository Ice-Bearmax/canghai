// 数据源：原神角色库（theBowja/genshin-db）
//
// 上游是从游戏客户端扒的中文角色数据，124+ 个，含称号/描述/元素/武器/所属/命座/生日。
// 走 GitHub raw 逐角色拉取。字段映射到藏海 entry。
//
// ⚠️ 依赖 ctx.fetch（由宿主/CLI 注入，走系统栈）。本机 Python urllib 的 SSL 会失败，
//    Node fetch 实测可直连 raw.githubusercontent.com。

import { ERR, sourceError, httpError } from '../errors.js';

const REPO = 'theBowja/genshin-db';
const API = `https://api.github.com/repos/${REPO}/contents/src/data/ChineseSimplified/characters`;
const RAW = `https://raw.githubusercontent.com/${REPO}/main/src/data/ChineseSimplified/characters/`;

export default {
  id: 'genshin-db',
  label: '原神角色库',
  targetFile: 'genshin-roster.json',
  configSpec: {
    maxCharacters: { type: 'number', default: 0, label: '最多导入(0=全部)' },
    skipPlaceholder: { type: 'boolean', default: true, label: '跳过占位角色(如 manekin)' }
  },

  async fetch(ctx) {
    const idx = await ctx.fetch(API, { json: true });
    if (!Array.isArray(idx)) throw sourceError(ERR.PARSE, '角色索引不是数组', { sourceId: this.id });
    let files = idx.filter((x) => x.name.endsWith('.json'));
    if (ctx.config.skipPlaceholder !== false) files = files.filter((x) => !x.name.startsWith('manekin'));
    const cap = Number(ctx.config.maxCharacters) || 0;
    if (cap > 0) files = files.slice(0, cap);

    const out = [];
    for (const f of files) {
      try {
        const c = await ctx.fetch(RAW + f.name, { json: true });
        if (c && c.name) out.push(c);
      } catch (e) {
        // 单个角色失败只记一条，不影响其余（降级：partial）。
        ctx.log(`角色拉取失败 ${f.name}: ${e.message}`);
      }
    }
    if (!out.length) throw sourceError(ERR.EMPTY, '原神角色：一个都没拉到', { sourceId: this.id });
    return out;
  },

  normalize(raw) {
    return (raw || []).map((c) => {
      const parts = [];
      if (c.title) parts.push(`称号「${c.title}」。`);
      if (c.description) parts.push(c.description);
      parts.push(`元素：${c.elementText || '未知'}；武器：${c.weaponText || '未知'}；所属：${c.affiliation || c.region || '未知'}；${c.rarity || 4}星。`);
      if (c.birthday) parts.push(`生日 ${c.birthday}。`);
      if (c.constellation) parts.push(`命座「${c.constellation}」。`);
      return {
        title: c.name,
        aliases: [c.title].filter(Boolean),
        meaning: parts.join('').slice(0, 2000),
        usage: `例：聊原神角色，${c.name}（${c.elementText || '?'}系${c.weaponText || '?'}）`,
        era: '原神',
        freshness: '常用',
        tags: ['游戏', '原神', '角色']
      };
    });
  }
};
