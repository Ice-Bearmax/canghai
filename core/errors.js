// 藏海 canghai · 异常与降级
//
// 数据源是外部依赖，一定会挂：网络超时、上游改字段、被风控、限流。
// 原则：**一个源挂，不能拖垮整个同步；同步挂，不能清空已有库。**
//
// 所以这里定义统一的错误码 + 降级策略，sync.js 据此决定「重试 / 跳过 / 用旧快照」。

/** 错误码：让调用方能区分「可重试」与「不该重试」。 */
export const ERR = {
  NETWORK: 'NETWORK',        // 连不上上游（超时/DNS/TLS）→ 可重试
  HTTP: 'HTTP',              // 上游返回非 2xx → 视状态码（429/5xx 可重试，404/403 不重试）
  PARSE: 'PARSE',            // 拉到了但不是合法 JSON / 结构对不上 → 多半上游改版，不重试
  NORMALIZE: 'NORMALIZE',    // normalize() 抛错（字段迁移）→ 不重试，需改适配
  EMPTY: 'EMPTY',            // 源正常但返回 0 条 → 可疑，默认不当作「清空」，保留旧库
  SCHEMA: 'SCHEMA',          // 条目大量不符合 schema → 数据质量问题，部分入库
  AUTH: 'AUTH',              // 需要授权/被风控（如萌百 action-notallowed）→ 不重试，跳过
  DISABLED: 'DISABLED',      // 配置里该源被关 → 正常跳过
  UNKNOWN: 'UNKNOWN'
};

/** 可重试的错误（瞬时故障）。不可重试的要人去看，别反复打上游。 */
const RETRYABLE = new Set([ERR.NETWORK]);
const MAYBE_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * 构造一个带 code 的标准化错误。
 * @param {string} code ERR.*
 * @param {string} msg 人类可读中文原因
 * @param {object} extra 附加信息（status、sourceId…）
 */
export function sourceError(code, msg, extra = {}) {
  const e = new Error(msg);
  e.code = code;
  e.sourceId = extra.sourceId;
  Object.assign(e, extra);
  return e;
}

/** 从 HTTP 状态码归类错误。 */
export function httpError(status, sourceId) {
  const code = status === 401 || status === 403 ? ERR.AUTH : status === 404 ? ERR.PARSE : ERR.HTTP;
  return sourceError(code, `上游返回 HTTP ${status}`, { status, sourceId });
}

/** 这个错误值不值得重试。429/5xx 的 HTTP 错误也值得轻重试一次。 */
export function isRetryable(err) {
  if (!err) return false;
  if (RETRYABLE.has(err.code)) return true;
  if (err.code === ERR.HTTP && MAYBE_RETRYABLE_STATUS.has(err.status)) return true;
  return false;
}

/**
 * 同步失败的降级决策：告诉上层这次要不要保留旧数据。
 *
 * 关键安全线：除非「源明确成功但返回空」且配置允许，否则**任何失败都保留旧库**。
 * 绝不允许因为一次网络抖动把本地几千条清空。
 * @param {object} err 或 null
 * @param {number} count 本次成功入库条数
 */
export function shouldKeepOld(err, count) {
  if (!err) return false;                 // 成功，用新数据
  if (err.code === ERR.EMPTY && err.confirmedEmpty) return true; // 源确认空了才敢清
  return false;                            // 其它一律保留旧库
}

/** 把错误转成给面板/日志看的一行中文。 */
export function describeError(err) {
  if (!err) return '成功';
  const tag = err.sourceId ? `[${err.sourceId}] ` : '';
  return `${tag}${err.code}：${err.message}`;
}
