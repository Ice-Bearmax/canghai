#!/usr/bin/env node
// 藏海 canghai · CLI
//
// 不依赖任何宿主也能跑：本地同步、检索、看统计。这也是「独立可测」的保证。
//   node cli.js sync                 全量同步所有启用数据源
//   node cli.js sync --only=genshin  只同步指定源（逗号分隔多个）
//   node cli.js search 钟离          查一个词
//   node cli.js stats                看库统计

import { createEngine } from './index.js';

const [, , cmd, ...rest] = process.argv;
const flags = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v];
}));
const args = rest.filter((a) => !a.startsWith('--'));

// Node 22 的 global fetch 在部分 Windows 环境 SSL 有问题；CLI 直接用它，
// 若失败由适配器归类为 NETWORK 错误并保留旧库（见 errors.js）。
const engine = createEngine();

async function main() {
  if (cmd === 'sync') {
    const only = flags.only ? String(flags.only).split(',') : null;
    console.log('开始同步数据源…');
    const rep = await engine.sync({ only });
    console.log('\n同步报告：');
    for (const s of rep.sources) {
      const unchanged = s.changed === false;
      const mark = s.ok ? (unchanged ? '⏭️' : '✅') : s.skipped ? '⏭️' : '⚠️';
      console.log(`  ${mark} ${s.label}: ${s.ok ? s.count + ' 条' : (s.error || s.reason || '跳过')}${s.note ? '（' + s.note + '）' : ''}`);
    }
    console.log(`\n合计入库 ${rep.total} 条，库内现有 ${engine.stats().total} 条。`);
    const changed = rep.sources.filter((s) => s.changed);
    console.log(changed.length ? `实际更新 ${changed.length} 个源：${changed.map((s) => s.label).join('、')}` : '本次无内容变化（无需提交）。');
    return;
  }
  if (cmd === 'search' || cmd === 'lookup') {
    const q = args.join(' ') || flags.q;
    if (!q) { console.log('用法：node cli.js search <关键词>'); return; }
    const r = engine.lookup(q, { limit: Number(flags.limit) || 3 });
    console.log(r.text);
    return;
  }
  if (cmd === 'domains') {
    const d = engine.stats().domains;
    const total = engine.stats().total;
    console.log(`藏海图鉴 · 共 ${total} 条，按领域：\n`);
    const sorted = Object.entries(d).filter(([k]) => k !== '其他').sort((a, b) => b[1] - a[1]);
    for (const [k, n] of sorted) {
      const pct = total ? ((n / total) * 100).toFixed(1) : '0';
      const bar = '█'.repeat(Math.round((n / Math.max(1, sorted[0][1])) * 20));
      console.log(`  ${k.padEnd(6, '　')} ${String(n).padStart(5)} 条  ${pct.padStart(5)}%  ${bar}`);
    }
    if (d['其他']) console.log(`  ${'其他'.padEnd(6, '　')} ${String(d['其他']).padStart(5)} 条`);
    const w = engine.stats().weakest;
    if (w) console.log(`\n最少的领域：${w.domain}（${w.count} 条）—— 下次优先补它。`);
    return;
  }
  if (cmd === 'stats') {
    const s = engine.stats();
    console.log(`藏海图鉴 · 共 ${s.total} 条，来自 ${s.files} 个文件\n`);
    console.log('按来源：');
    for (const [k, v] of Object.entries(s.bySource)) console.log(`  ${k}: ${v}`);
    console.log('\n热门标签：');
    console.log('  ' + s.topTags.map(([t, n]) => `${t}(${n})`).join('、'));
    return;
  }

  console.log('藏海 canghai · 二次元知识图鉴引擎\n');
  console.log('用法：');
  console.log('  node cli.js sync [--only=源id]   同步数据源');
  console.log('  node cli.js search <关键词>       查一个词');
  console.log('  node cli.js stats                 看库统计');
  console.log('  node server.js                    启动控制面板 (默认 :8792)');
}

main().catch((e) => { console.error('出错：', e.message); process.exit(1); });
