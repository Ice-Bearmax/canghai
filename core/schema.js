// ZUKAN · 数据格式约定（Schema）
//
// 这是整个项目的「数据契约」：任何数据源（本地 JSON、原神库、新番表、以后的萌百…）
// 归一化后都必须产出符合本 schema 的 entry。核心逻辑（检索/面板/宿主适配）只认
// entry，不认具体来源 —— 这是「新增/切换数据源不改核心」的前提。
//
// 设计取舍：不引 zod/ajv 等依赖，自带够用的 validator。理由是要在 QQAgent/DSH
// 两个宿主里都能零安装跑起来，依赖越少越稳。

/** 一个知识条目 = 一条可被检索的「图鉴项」。 */
export const ENTRY_SCHEMA = {
  // 必填：图鉴项的名字，检索主键。
  title: { type: 'string', required: true, max: 120 },
  // 选填：别名/其他写法，命中权重仅次于 title（同一个梗常有多种写法）。
  aliases: { type: 'array', items: 'string', max: 16 },
  // 选填：这是什么、什么意思。面板详情与检索 snippet 都用它。
  meaning: { type: 'string', max: 2000 },
  // 选填：怎么用 / 例句，帮模型判断使用场合。
  usage: { type: 'string', max: 1000 },
  // 选填：语气（吐槽/温馨/中二…），供人格化引用。
  tone: { type: 'string', max: 40 },
  // 选填：出处（作品名/游戏名/事件）。
  era: { type: 'string', max: 120 },
  // 选填：新鲜度标签，面板可按此过滤。
  freshness: { type: 'string', enum: ['常用', '偏旧', '正热', ''], max: 8 },
  // 选填：分类标签，面板侧边栏与过滤用。
  tags: { type: 'array', items: 'string', max: 12 }
};

/** 运行时由系统补齐、数据源不该提供的字段（避免源数据伪造归属）。 */
export const RESERVED_FIELDS = ['id', '_source', '_syncedAt', '_hash'];

function cleanString(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim();
}

/**
 * 校验并归一化一条原始数据 → 合法 entry。
 * 不抛异常，返回 { ok, entry? } 或 { ok:false, errors }，
 * 方便批量导入时「坏的跳过、好的留下」。
 * @param {object} raw 数据源 normalize() 的产物
 * @param {string} sourceId 来源标识（写进 entry._source，便于溯源/去重）
 */
export function validateEntry(raw, sourceId = 'local') {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['不是对象'] };

  const entry = {};
  const title = cleanString(raw.title);
  if (!title) errors.push('title 缺失（必填）');
  else if (title.length > ENTRY_SCHEMA.title.max) errors.push(`title 超长（>${ENTRY_SCHEMA.title.max}）`);
  else entry.title = title;

  for (const [field, rule] of Object.entries(ENTRY_SCHEMA)) {
    if (field === 'title') continue;
    const v = raw[field];
    if (v === undefined || v === null || v === '') {
      if (rule.required) errors.push(`${field} 缺失`);
      continue;
    }
    if (rule.type === 'string') {
      if (typeof v !== 'string') { errors.push(`${field} 应为字符串`); continue; }
      if (rule.enum && !rule.enum.includes(v)) { errors.push(`${field} 不在允许值内`); continue; }
      entry[field] = v.length > rule.max ? v.slice(0, rule.max) : v;
    } else if (rule.type === 'array') {
      if (!Array.isArray(v)) { errors.push(`${field} 应为数组`); continue; }
      const arr = v.map(cleanString).filter(Boolean).slice(0, rule.max);
      if (arr.length) entry[field] = arr;
    }
  }

  // 丢弃数据源试图伪造的保留字段，但仍算合法（只是不采纳）。
  for (const rf of RESERVED_FIELDS) delete entry[rf];
  entry._source = sourceId;

  if (errors.length) return { ok: false, errors };
  return { ok: true, entry };
}

/** 批量校验：返回合法 entry 列表 + 被拒项（含原因），供同步报告用。 */
export function validateMany(rawList, sourceId) {
  const entries = [];
  const rejected = [];
  const list = Array.isArray(rawList) ? rawList : [];
  for (let i = 0; i < list.length; i++) {
    const r = validateEntry(list[i], sourceId);
    if (r.ok) entries.push(r.entry);
    else rejected.push({ index: i, title: list[i]?.title, errors: r.errors });
  }
  return { entries, rejected };
}

/** 生成用于去重/比对的稳定指纹（同 title+meaning+era 视为同一条）。 */
export function entryKey(entry) {
  return [entry.title, entry.meaning || '', entry.era || ''].join('\u0001');
}

/** 列出 schema 允许的所有字段（给面板/文档用，不暴露保留字段）。 */
export function schemaFieldList() {
  return Object.entries(ENTRY_SCHEMA).map(([name, rule]) => ({
    name,
    required: !!rule.required,
    type: rule.type,
    enum: rule.enum || null,
    max: rule.max
  }));
}
