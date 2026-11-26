// 藏海 canghai · 面板逻辑（无框架，纯 fetch + DOM）
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const api = (p, o) => fetch('/api' + p, o).then((r) => r.json());
const post = (p, body) => fetch('/api' + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
}).then((r) => r.json());
const del = (p) => fetch('/api' + p, { method: 'DELETE' }).then((r) => r.json());
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ── 页面切换 ── */
$$('.nav-btn').forEach((b) => {
  b.onclick = () => {
    $$('.nav-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $$('.page').forEach((p) => (p.hidden = true));
    $('#page-' + b.dataset.page).hidden = false;
    const map = { overview: loadStats, search: initSearch, entries: loadEntries, sources: loadSources, about: loadAbout };
    if (map[b.dataset.page]) map[b.dataset.page]();
  };
});

/* ── 概览 ── */
async function loadStats() {
  const s = await api('/stats');
  $('#foot-count').textContent = `库内 ${s.total} 条`;
  const cards = [
    { n: s.total, l: '图鉴条目', i: '🐚' },
    { n: s.files, l: '来源文件', i: '📖' },
    { n: Object.keys(s.bySource).length, l: '数据来源', i: '🌐' },
    { n: s.userCount || 0, l: '自学习条目', i: '💾' }
  ];
  $('#stat-cards').innerHTML = cards.map((c) =>
    `<div class="card"><div style="font-size:20px">${c.i}</div><div class="stat-num">${c.n}</div><div class="stat-label">${c.l}</div></div>`
  ).join('');

  // 领域图
  const dom = s.domains || {};
  const list = (s.domainList || Object.keys(dom)).filter((k) => k !== '其他');
  const max = Math.max(1, ...list.map((k) => dom[k] || 0));
  const weak = s.weakest;
  $('#domain-chart').innerHTML = list.map((k) => {
    const n = dom[k] || 0;
    const w = Math.round((n / max) * 100);
    const isWeak = weak && weak.domain === k;
    return `<div class="dom-row">
      <span class="dom-name">${k}</span>
      <div class="dom-track"><div class="dom-fill${isWeak ? ' weak' : ''}" style="width:${Math.max(2, w)}%"></div></div>
      <span class="dom-num">${n} 条</span>
    </div>`;
  }).join('');
  $('#weakest-hint').textContent = weak ? `最缺：${weak.domain}（${weak.count} 条）` : '';

  // 来源
  const src = Object.entries(s.bySource || {}).sort((a, b) => b[1] - a[1]);
  $('#source-list').innerHTML = src.length
    ? `<table class="tbl"><tbody>${src.map(([k, n]) => `<tr><td class="t-title">${esc(k)}</td><td class="acts">${n}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">暂无</div>';

  // 标签
  $('#top-tags').innerHTML = (s.topTags || []).map(([t, n]) => `<span class="tag">${esc(t)} · ${n}</span>`).join(' ') || '<div class="empty">暂无</div>';
}

/* ── 检索 ── */
let domainsLoaded = false;
async function initSearch() {
  if (!domainsLoaded) {
    const s = await api('/stats');
    const opts = (s.domainList || []).filter((d) => d !== '其他').map((d) => `<option value="${d}">${d}</option>`).join('');
    $('#q-domain').innerHTML = '<option value="">全部领域</option>' + opts;
    $('#e-domain').innerHTML = '<option value="">全部领域</option>' + opts;
    domainsLoaded = true;
  }
}
async function doSearch() {
  const q = $('#q').value.trim();
  if (!q) return;
  const d = $('#q-domain').value;
  const lim = $('#q-limit').value;
  const { hits } = await api(`/search?q=${encodeURIComponent(q)}&limit=${lim}&domain=${encodeURIComponent(d)}`);
  const box = $('#results');
  if (!hits.length) { box.innerHTML = `<div class="empty">没查到「${esc(q)}」<br>可去「同步」拉取更多数据源</div>`; return; }
  box.innerHTML = hits.map((h, i) => resultCard(h, i)).join('');
}
function resultCard(h, i) {
  const al = h.aliases?.length ? `<div class="alias">别名：${esc(h.aliases.join('、'))}</div>` : '';
  const us = h.usage ? `<div class="meaning" style="color:var(--glow)">怎么用：${esc(h.usage)}</div>` : '';
  const tags = [...(h.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`), `<span class="tag src">${esc(h._source)}</span>`].join('');
  const er = h.era ? `<span class="tag">出处 ${esc(h.era)}</span>` : '';
  return `<div class="result" style="animation-delay:${i * 40}ms">
    <h3>${esc(h.title)}<span class="score">匹配 ${h._score}</span></h3>
    ${al}<div class="meaning">${esc(h.meaning || '')}</div>${us}
    <div class="meta">${er}${tags}</div></div>`;
}
$('#go').onclick = doSearch;
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

/* ── 条目管理 ── */
let ePage = 1;
async function loadEntries(page = ePage) {
  ePage = page;
  const p = new URLSearchParams({
    page, size: $('#e-size').value,
    q: $('#e-q').value, domain: $('#e-domain').value, source: $('#e-source').value
  });
  const r = await api('/entries?' + p);
  // 来源下拉只初始化一次
  if ($('#e-source').options.length <= 1) {
    const srcs = [...new Set(r.items.map((x) => x._source))];
    const all = await api('/stats');
    const list = Object.keys(all.bySource || {}).sort();
    $('#e-source').innerHTML = '<option value="">全部来源</option>' + list.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  }
  if (!r.items.length) { $('#e-list').innerHTML = '<div class="empty">没有符合条件的条目</div>'; $('#e-pager').innerHTML = ''; return; }

  $('#e-list').innerHTML = `<table class="tbl">
    <thead><tr><th style="width:20%">标题</th><th style="width:44%">意思</th><th style="width:10%">领域</th><th style="width:14%">来源</th><th style="width:12%"></th></tr></thead>
    <tbody>${r.items.map((e) => `<tr>
      <td class="t-title">${esc(e.title)}${e.aliases?.length ? `<div class="t-mean">${esc(e.aliases.slice(0, 3).join('、'))}</div>` : ''}</td>
      <td class="t-mean">${esc((e.meaning || '').slice(0, 90))}</td>
      <td>${esc(e._domain)}</td>
      <td class="t-mean">${esc(e._source)}</td>
      <td class="acts">${e._editable
        ? `<button class="mini-btn" data-edit="${esc(e.title)}">改</button> <button class="mini-btn danger" data-del="${esc(e.title)}">删</button>`
        : `<span class="lock" title="人工精选/同步条目只读">🔒</span>`}</td>
    </tr>`).join('')}</tbody></table>`;

  $('#e-pager').innerHTML = `
    <button class="mini-btn" ${r.page <= 1 ? 'disabled' : ''} data-p="${r.page - 1}">‹ 上一页</button>
    <span>${r.page} / ${r.pages}（共 ${r.total} 条）</span>
    <button class="mini-btn" ${r.page >= r.pages ? 'disabled' : ''} data-p="${r.page + 1}">下一页 ›</button>`;

  $$('#e-pager [data-p]').forEach((b) => b.onclick = () => loadEntries(Number(b.dataset.p)));
  $$('#e-list [data-edit]').forEach((b) => b.onclick = () => openModal(r.items.find((x) => x.title === b.dataset.edit)));
  $$('#e-list [data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm(`删除自学习条目「${b.dataset.del}」？删掉后机器人就不认识它了。`)) return;
    const res = await del('/entries?title=' + encodeURIComponent(b.dataset.del));
    if (!res.ok) alert(res.error || '删除失败');
    loadEntries(ePage);
  });
}
$('#e-refresh').onclick = () => loadEntries(1);
$('#e-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadEntries(1); });
$('#e-domain').onchange = () => loadEntries(1);
$('#e-source').onchange = () => loadEntries(1);
$('#e-size').onchange = () => loadEntries(1);

/* ── 弹窗 ── */
function openModal(entry) {
  $('#m-title').textContent = entry ? '编辑条目' : '新增条目';
  $('#m-t').value = entry?.title || '';
  $('#m-a').value = (entry?.aliases || []).join(',');
  $('#m-m').value = entry?.meaning || '';
  $('#m-u').value = entry?.usage || '';
  $('#m-e').value = entry?.era || '';
  $('#m-tone').value = entry?.tone || '';
  $('#m-tags').value = (entry?.tags || []).join(',');
  $('#modal').hidden = false;
  $('#m-t').focus();
}
const closeModal = () => { $('#modal').hidden = true; };
$('#m-close').onclick = closeModal;
$('#m-cancel').onclick = closeModal;
$('#e-new').onclick = () => openModal(null);
$('#m-save').onclick = async () => {
  const body = {
    title: $('#m-t').value.trim(), meaning: $('#m-m').value.trim(),
    aliases: $('#m-a').value, usage: $('#m-u').value, era: $('#m-e').value,
    tone: $('#m-tone').value, tags: $('#m-tags').value
  };
  if (!body.title || !body.meaning) { alert('标题和「意思」是必填'); return; }
  const r = await post('/entries', body);
  if (!r.ok) { alert(r.error || '保存失败'); return; }
  closeModal(); loadEntries(1);
};

/* ── 数据源 ── */
async function loadSources() {
  const cfg = await api('/config');
  $('#src-list').innerHTML = (cfg.sources || []).map((s) => {
    const on = s.enabled !== false;
    return `<div class="src-row">
      <div>
        <div class="lbl">${esc(s.label || s.id)}</div>
        <div class="id">适配器 ${esc(s.adapter)} · id ${esc(s.id)}${s.target ? ' · 写入 ' + esc(s.target) : ''}</div>
      </div>
      <span class="badge count">${s.count || 0} 条</span>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="mini-btn" data-sync="${esc(s.id)}">单独同步</button>
        <label class="switch"><input type="checkbox" data-toggle="${esc(s.id)}" ${on ? 'checked' : ''}><span class="slider"></span></label>
      </div>
    </div>`;
  }).join('') || '<div class="empty">未配置数据源</div>';

  $$('#src-list [data-toggle]').forEach((cb) => {
    cb.onchange = async () => {
      const r = await post('/sources', { id: cb.dataset.toggle, enabled: cb.checked });
      if (!r.ok) { alert(r.error || '保存失败'); cb.checked = !cb.checked; }
      else { cb.blur(); }
    };
  });
  $$('#src-list [data-sync]').forEach((b) => {
    b.onclick = () => { switchTo('sync'); runSync([b.dataset.sync]); };
  });
}

/* ── 同步 ── */
function switchTo(page) {
  $$('.nav-btn').forEach((x) => x.classList.toggle('active', x.dataset.page === page));
  $$('.page').forEach((p) => (p.hidden = true));
  $('#page-' + page).hidden = false;
  if (page === 'sync') { /* 保持日志 */ }
}
async function runSync(only) {
  const btn = $('#sync-all');
  const log = $('#sync-log');
  btn.disabled = true;
  const tag = only?.length ? `源 ${only.join(',')}` : '全部源';
  log.innerHTML = `<div class="log-line">开始同步（${tag}）…首次联网较慢</div>`;
  try {
    const { ok, report, error } = await post('/sync', only?.length ? { only } : {});
    if (!ok) log.innerHTML += `<div class="log-line warn">同步失败：${esc(error)}</div>`;
    else {
      for (const s of report.sources) {
        const unchanged = s.changed === false;
        const cls = s.ok ? (unchanged ? '' : 'ok') : s.skipped ? '' : 'warn';
        const mark = s.ok ? (unchanged ? '⏭️' : '✅') : s.skipped ? '⏭️' : '⚠️';
        const txt = s.ok ? `${s.label}：${s.count} 条${s.note ? '（' + s.note + '）' : ''}` : `${s.label}：${s.error || s.reason || '跳过'}`;
        log.innerHTML += `<div class="log-line ${cls}">${mark} ${esc(txt)} · ${s.ms}ms</div>`;
      }
      log.innerHTML += `<div class="log-line ok">— 合计入库 ${report.total} 条 —</div>`;
    }
  } catch (e) { log.innerHTML += `<div class="log-line warn">请求失败：${esc(e.message)}</div>`; }
  finally { btn.disabled = false; loadStats(); }
}
$('#sync-all').onclick = () => runSync();
$('#sync-clear').onclick = () => { $('#sync-log').innerHTML = '<div class="empty">日志已清空。</div>'; };

/* ── 关于 ── */
async function loadAbout() {
  const [s, sch] = await Promise.all([api('/stats'), api('/schema')]);
  const updated = s.updatedAt ? new Date(s.updatedAt).toLocaleString('zh-CN') : '未知';
  $('#about-runtime').innerHTML = `<table class="tbl"><tbody>
    <tr><td>库内条目</td><td class="acts">${s.total}</td></tr>
    <tr><td>来源文件</td><td class="acts">${s.files}</td></tr>
    <tr><td>自学习条目</td><td class="acts">${s.userCount || 0}</td></tr>
    <tr><td>最近更新</td><td class="acts">${esc(updated)}</td></tr>
    <tr><td>加载报告</td><td class="acts">${s.loadReport ? `丢弃重复 ${s.loadReport.droppedDup} · 格式不符 ${s.loadReport.rejected}` : '—'}</td></tr>
  </tbody></table>`;
  $('#about-schema').innerHTML = `<table class="tbl"><thead><tr><th>字段</th><th>类型</th><th>说明</th></tr></thead><tbody>
    ${sch.map((f) => `<tr><td class="t-title">${esc(f.name)}${f.required ? ' <span class="req">*</span>' : ''}</td><td class="t-mean">${esc(f.type)}</td><td class="t-mean">${esc(f.enum ? f.enum.join(' / ') : '')}</td></tr>`).join('')}
  </tbody></table>`;
  $('#about-api').innerHTML = `<table class="tbl"><tbody>
    ${[['GET /api/stats', '总量/领域/来源统计'], ['GET /api/search?q=&domain=', '检索'],
      ['GET /api/entries?page=&size=&domain=&source=&q=', '分页浏览'],
      ['POST /api/entries', '新增/更新（写入自学习库）'], ['DELETE /api/entries?title=', '删除自学习条目'],
      ['POST /api/sources', '{id,enabled} 开关数据源'], ['POST /api/sync', '{only?} 同步'],
      ['GET /api/config', '数据源配置'], ['GET /api/schema', '字段约定']
    ].map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td class="t-mean">${esc(v)}</td></tr>`).join('')}
  </tbody></table>`;
}

loadStats();