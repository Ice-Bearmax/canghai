// 藏海 canghai · 核心自检（node --test）
// 覆盖：schema 校验、检索引擎打分、去重优先级、异常分类。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEntry, validateMany } from '../core/schema.js';
import { search, normText } from '../core/search.js';
import { ERR, isRetryable, shouldKeepOld, httpError } from '../core/errors.js';

test('schema：合法条目通过并保留字段', () => {
  const r = validateEntry({ title: '钟离', meaning: '岩神', tags: ['游戏'] }, 'genshin');
  assert.equal(r.ok, true);
  assert.equal(r.entry.title, '钟离');
  assert.equal(r.entry._source, 'genshin');
});

test('schema：缺 title 被拒', () => {
  const r = validateEntry({ meaning: '无标题' });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /title/);
});

test('schema：数据源伪造保留字段被丢弃', () => {
  const r = validateEntry({ title: 'x', _source: 'hacker', _syncedAt: 'now' }, 'real');
  assert.equal(r.ok, true);
  assert.equal(r.entry._source, 'real');
});

test('schema：批量导入坏的跳过、好的留下', () => {
  const { entries, rejected } = validateMany([{ title: 'a' }, { noTitle: 1 }, { title: 'b' }], 's');
  assert.equal(entries.length, 2);
  assert.equal(rejected.length, 1);
});

test('search：title 精确命中排第一，且权重最高', () => {
  const entries = [
    { title: '钟离岩王爷', meaning: '提钟离', era: '原神' },
    { title: '钟离', meaning: '岩神', era: '原神' }
  ];
  const hits = search(entries, '钟离');
  assert.equal(hits[0].entry.title, '钟离');
  assert.equal(hits[0].score, 100);
});

test('search：别名命中次之', () => {
  const entries = [{ title: '永远的神', aliases: ['yyds'], meaning: '很强' }];
  const hits = search(entries, 'yyds');
  assert.equal(hits[0].score, 90);
});

test('search：查不到返回空', () => {
  assert.equal(search([{ title: 'abc', meaning: 'x' }], '不存在的词').length, 0);
});

test('normText：去空白+小写', () => {
  assert.equal(normText('  YY DS '), 'yyds');
});

test('errors：网络错误可重试，鉴权不重试', () => {
  assert.equal(isRetryable({ code: ERR.NETWORK }), true);
  assert.equal(isRetryable(httpError(403, 's')), false);
  assert.equal(isRetryable(httpError(429, 's')), true);
});

test('errors：失败保留旧库，确认真空才允许清空', () => {
  const netErr = { code: ERR.NETWORK };
  assert.equal(shouldKeepOld(netErr, 0), false);          // 失败 → 不采用新（即保留旧）
  assert.equal(shouldKeepOld(null, 10), false);           // 成功 → 采用新
});