// 藏海 canghai · 数据源适配器接口约定（contract）
//
// 这是「可插拔数据源」的核心：任何数据源只要实现本文件的 SourceAdapter 接口，
// 放进 core/sources/ 并在 sources.config.json 里加一项，就能被同步管线调用。
// 新增/切换/停用数据源 —— 不改 sync.js、不改检索、不改面板。
//
// 一个适配器 = 一个 .js 文件，default 导出符合下述形状的对象。
//
//   export default {
//     id: 'genshin-db',                 // 唯一标识，配置里引用它
//     label: '原神角色库',               // 中文名，面板显示
//     // 可选：本源支持的配置项及默认值（面板据此渲染表单，也用于校验）
//     configSpec: {
//       lang: { type:'string', default:'ChineseSimplified', label:'语言' },
//       limit:{ type:'number', default:0, label:'最多条数(0=全部)' }
//     },
//
//     // 拉取：给定 config，返回「原始数据」（任意结构，交给 normalize 解释）。
//     // 失败请 throw sourceError(ERR.*, ...)；返回 null 视为「无数据」。
//     async fetch(ctx) { ... return raw; },
//
//     // 归一化：把原始数据映射成符合 schema 的 entry 数组（可带 _target 指定落库文件）。
//     // 只负责「翻译字段」，不做校验（校验由 validateMany 统一做）。
//     normalize(raw, ctx) { return [ {title, meaning, era, tags, ...}, ... ]; },
//
//     // 落地文件名（可省略，默认 `${id}.json`）
//     targetFile: 'genshin-roster.json'
//   }
//
// ctx 提供：{ config, log, fetch(带超时/UA), cacheDir, now }

/** 校验一个适配器是否满足接口；返回问题列表（空=合格）。 */
export function checkAdapter(adapter) {
  const problems = [];
  if (!adapter || typeof adapter !== 'object') return ['不是对象'];
  if (!adapter.id || typeof adapter.id !== 'string') problems.push('缺 id');
  if (typeof adapter.fetch !== 'function') problems.push('缺 fetch()');
  if (typeof adapter.normalize !== 'function') problems.push('缺 normalize()');
  return problems;
}

/** 归一化后的 entry 允许携带的系统字段：_target 指定落库文件名。 */
export const META_FIELDS = ['_target'];
