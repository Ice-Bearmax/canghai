// 数据源：新番季度表（empty-233/anime-data，release 分支）
//
// 上游用 GitHub Actions 每周一自动更新，含中日英标题、类型、开播/完结时间、状态、
// Bangumi ID、图片。字段映射到 entry，era 归到「动漫」。可配年份/季度范围。

import { ERR, sourceError } from '../errors.js';

const RAW = 'https://raw.githubusercontent.com/empty-233/anime-data/release/season';
const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const CN = { WINTER: '冬季', SPRING: '春季', SUMMER: '夏季', FALL: '秋季' };

export default {
  id: 'anime-data',
  label: '新番季度表',
  targetFile: 'anime-season.json',
  configSpec: {
    years: { type: 'number', default: 2, label: '回溯年数（含明年）' },
    includeUpcoming: { type: 'boolean', default: true, label: '包含未播/未来季度' }
  },

  async fetch(ctx) {
    const thisYear = new Date().getFullYear();
    const back = Number(ctx.config.years) || 2;
    const years = [];
    for (let y = thisYear - back; y <= thisYear + 1; y++) years.push(y);

    const out = [];
    for (const y of years) {
      for (const s of SEASONS) {
        let list;
        try {
          list = await ctx.fetch(`${RAW}/${y}/${s}.json`, { json: true });
        } catch (e) {
          // 某季度文件不存在（404）是正常的，跳过即可，不算源失败。
          if (/404/.test(String(e.message))) continue;
          ctx.log(`${y}/${s} 拉取失败: ${e.message}`);
          continue;
        }
        if (Array.isArray(list)) out.push(...list.map((a) => ({ ...a, __season: s, __year: y })));
      }
    }
    if (!out.length) throw sourceError(ERR.EMPTY, '新番表：没拉到任何季度', { sourceId: this.id });
    return out;
  },

  normalize(raw) {
    return (raw || []).map((a) => {
      const zh = (a.titleTranslate?.['zh-Hans'] || [])[0] || '';
      const title = zh || a.title;
      if (!title) return null;
      const alias = [a.title, ...(a.synonyms || []).slice(0, 2)].filter((x) => x && x !== title);
      const bits = [`${a.__year}年${CN[a.__season] || a.__season}番`];
      if (a.type) bits.push(`类型 ${a.type}`);
      if (a.begin) bits.push(`开播 ${String(a.begin).slice(0, 10)}`);
      if (a.status) bits.push(`状态 ${a.status}`);
      if (a.episodes) bits.push(`${a.episodes} 集`);
      const bgm = (a.sites || []).find((s) => s.site === 'bangumi');
      if (bgm?.id) bits.push(`Bangumi#${bgm.id}`);
      return {
        title,
        aliases: alias,
        meaning: bits.join('。') + '。',
        usage: `例：${a.__year}年${CN[a.__season] || ''}有部番叫《${title}》`,
        era: '动漫',
        freshness: '常用',
        tags: ['动漫', '新番', String(a.__year)]
      };
    }).filter(Boolean);
  }
};
