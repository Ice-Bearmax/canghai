// 藏海 canghai · 领域分类
//
// 一套判据三处共用：CLI 的 domains 统计、面板的筛选、定时任务的「补哪个领域」决策。
// 只按 tags 归类（首匹配优先），不猜正文——判据必须稳定可复现。

export const DOMAINS = ['动漫', '游戏', '影视', '网络梗', '其他'];

const RULES = [
  ['动漫', ['动漫', '新番', 'ACGN', '动画']],
  ['游戏', ['游戏', '原神', '星穹铁道', '崩坏3', '明日方舟', '战锤', '英雄联盟', '王者荣耀',
    'CS:GO', '绝地求生', 'DOTA2', '塞尔达', '宝可梦', '黑神话', 'Minecraft', '我的世界',
    '艾尔登法环', '守望先锋', '尼尔', '魂系列', 'MOBA', '桌游']],
  ['影视', ['影视', '电影', '剧集', '电视剧']],
  ['网络梗', ['梗', '网络用语', '谐音', '引用', '修辞', '俗语', '缩写', '现象']]
];

/** 判一条 entry 属于哪个领域。 */
export function domainOf(entry) {
  const tags = entry?.tags || [];
  for (const [name, keys] of RULES) {
    if (tags.some((t) => keys.includes(t))) return name;
  }
  return '其他';
}

/** 统计每个领域的条数。 */
export function domainStats(entries) {
  const out = {};
  for (const d of DOMAINS) out[d] = 0;
  for (const e of entries) out[domainOf(e)]++;
  return out;
}

/** 最需要补的领域（排除网络梗——它的数据集已经很大，且不靠手写）。 */
export function weakestDomain(entries) {
  const st = domainStats(entries);
  const pool = Object.entries(st).filter(([k]) => k !== '网络梗' && k !== '其他');
  pool.sort((a, b) => a[1] - b[1]);
  return pool[0] ? { domain: pool[0][0], count: pool[0][1] } : null;
}