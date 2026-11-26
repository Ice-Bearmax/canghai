// 藏海 canghai · 检索引擎
//
// 定位：**查词典**（title 是主键，精确命中权重最高），不是翻旧账。
// 与记忆系统（conversation-memory 的 BM25/IDF 全文召回）职责正交 ——
// 那边回答「聊过没有」，这里回答「是什么 / 是谁」。
//
// 打分策略（借鉴 QQAgent trendy-memes 的实测经验）：
//   1. title 完全相等最高 —— 查「钟离」就该出钟离，不是提到钟离的一堆条目；
//   2. 别名完全相等次之 —— 一个梗/角色常有多写法（yyds/永远的神）；
//   3. title 含查询 / 查询含 title —— 部分匹配；
//   4. 别名部分匹配；
//   5. 正文（meaning/usage/era/tags）兜底 —— 权重低，避免长句里随便一个字就命中；
//   6. 中文口语常把词条嵌在句中，做子串兜底但严格限长，防噪音。

/** 归一化：去空白、转小写，让「钟 离」≈「钟离」、英文大小写不敏感。 */
export function normText(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, '');
}

/** 预计算每条的可搜文本块，避免每次查询重复拼字符串。 */
function buildIndex(entries) {
  return entries.map((e, i) => ({
    i,
    titleN: normText(e.title),
    aliasN: (e.aliases || []).map(normText),
    bodyN: normText(`${e.meaning || ''}${e.usage || ''}${e.era || ''}${(e.tags || []).join('')}`)
  }));
}

/**
 * 检索。
 * @param {Array} entries 已加载的 entry 列表
 * @param {string} query 查询词
 * @param {object} opts { limit, minScore, index }
 *   index 可传入 buildIndex 的预建结果复用，省得每次重建。
 * @returns {Array<{entry, score, matched}>} 按分数降序
 */
export function search(entries, query, opts = {}) {
  const { limit = 5, minScore = 20 } = opts;
  const q = normText(query);
  if (!q || !entries?.length) return [];

  const idx = opts.index || buildIndex(entries);
  const scored = [];

  for (const item of idx) {
    let score = 0;
    let matched = '';
    if (item.titleN === q) { score += 100; matched = 'title'; }
    else if (item.aliasN.includes(q)) { score += 90; matched = 'alias'; }
    else if (item.titleN.includes(q)) { score += 60; matched = 'title~'; }
    else if (q.includes(item.titleN) && item.titleN.length >= 2) { score += 55; matched = 'title⊂'; }
    else if (item.aliasN.some((a) => a && (a.includes(q) || q.includes(a)))) { score += 50; matched = 'alias~'; }

    // 正文兜底：查询够长（≥2 字）且确实在正文里才加，且加得少。
    if (score < 60 && q.length >= 2 && item.bodyN.includes(q)) {
      score += 20;
      if (!matched) matched = 'body';
    }

    if (score >= minScore) scored.push({ entry: entries[item.i], score, matched });
  }

  scored.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
  return scored.slice(0, limit);
}

/** 把命中渲染成给模型看的文本（保留字段顺序，模型按这个读）。 */
export function formatEntry(e) {
  const lines = [`【${e.title}】`];
  if (e.aliases?.length) lines.push(`别名：${e.aliases.join('、')}`);
  if (e.meaning) lines.push(`是什么：${e.meaning}`);
  if (e.usage) lines.push(`怎么用：${e.usage}`);
  const meta = [
    e.tone && `语气：${e.tone}`,
    e.era && `出处：${e.era}`,
    e.tags?.length && `标签：${e.tags.join('/')}`
  ].filter(Boolean);
  if (meta.length) lines.push(meta.join(' ｜ '));
  return lines.join('\n');
}

/** 供外部预建索引（数据量大时可缓存，避免每次 search 重建）。 */
export function buildSearchIndex(entries) {
  return buildIndex(entries);
}
