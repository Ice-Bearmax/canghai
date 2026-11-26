// 藏海 canghai · 面板逻辑（无框架，纯 fetch + DOM）
const $ = (s) => document.querySelector(s);
const api = (p) => fetch('/api' + p).then((r) => r.json());

/* ── 页面切换 ── */
document.querySelectorAll('.nav-btn').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.nav-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.page').forEach((p) => (p.hidden = true));
    $('#page-' + b.dataset.page).hidden = false;
    if (b.dataset.page === 'overview') loadStats();
    if (b.dataset.page === 'sources') loadSources();
  };
});

/* ── 概览 ── */
async function loadStats() {
  const s = await api('/stats');
  const cards = [
    { n: s.total, l: '图鉴条目', i: '🐚' },
    { n: s.files, l: '来源文件', i: '📖' },
    { n: Object.keys(s.bySource).length, l: '启用数据源', i: '🌐' }
  ];
  $('#stat-cards').innerHTML = cards.map((c) =>
    `<div class="card"><div style="font-size:22px">${c.i}</div><div class="stat-num">${c.n}</div><div class="stat-label">${c.l}</div></div>`
  ).join('');
  $('#top-tags').innerHTML = (s.topTags || []).map(([t, n]) => `<span class="tag">${t} · ${n}</span>`).join(' ') || '<span class="empty">暂无标签</span>';
}

/* ── 检索 ── */
async function doSearch() {
  const q = $('#q').value.trim();
  if (!q) return;
  const { hits } = await api('/search?q=' + encodeURIComponent(q));
  const box = $('#results');
  if (!hits.length) { box.innerHTML = `<div class="empty">没查到「${q}」<br>可去「同步」拉取更多数据源</div>`; return; }
  box.innerHTML = hits.map((h, i) => resultCard(h, i)).join('');
}
function resultCard(h, i) {
  const al = h.aliases?.length ? `<div class="alias">别名：${h.aliases.join('、')}</div>` : '';
  const us = h.usage ? `<div class="meaning" style="color:var(--glow)">怎么用：${h.usage}</div>` : '';
  const tags = [...(h.tags || []).map((t) => `<span class="tag">${t}</span>`), `<span class="tag src">${h._source}</span>`].join('');
  const er = h.era ? `<span class="tag">出处 ${h.era}</span>` : '';
  return `<div class="result" style="animation-delay:${i * 40}ms">
    <h3>${h.title}${`<span class="score">匹配度 ${h._score}</span>`}</h3>
    ${al}<div class="meaning">${h.meaning || ''}</div>${us}
    <div class="meta">${er}${tags}</div></div>`;
}
$('#go').onclick = doSearch;
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

/* ── 数据源 ── */
async function loadSources() {
  const [cfg, s] = await Promise.all([api('/config'), api('/stats')]);
  const list = (cfg.sources || []).map((src) => {
    const count = s.bySource[src.id] || 0;
    const on = src.enabled !== false;
    return `<div class="src-row">
      <div><div class="lbl">${src.label || src.id}</div><div class="id">适配器：${src.adapter} · ${src.id}</div></div>
      <span class="badge count">${count} 条</span>
      <label class="switch"><input type="checkbox" ${on ? 'checked' : ''} disabled><span class="slider"></span></label>
    </div>`;
  }).join('');
  $('#src-list').innerHTML = list || '<div class="empty">未配置数据源</div>';
}

/* ── 同步 ── */
$('#sync-clear').onclick = () => { $('#sync-log').innerHTML = '<div class="empty">日志已清空。</div>'; };
$('#sync-all').onclick = async () => {
  const btn = $('#sync-all'); btn.disabled = true; btn.innerHTML = '<span class="pulse"></span> 同步中…';
  const log = $('#sync-log'); log.innerHTML = '<div class="log-line">开始从各数据源拉取…（首次联网较慢）</div>';
  try {
    const { ok, report, error } = await fetch('/api/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    }).then((r) => r.json());
    if (!ok) { log.innerHTML += `<div class="log-line warn">同步失败：${error}</div>`; }
    else {
      for (const s of report.sources) {
        const cls = s.ok ? 'ok' : s.skipped ? '' : 'warn';
        const txt = s.ok ? `${s.label}：${s.count} 条${s.note ? '（' + s.note + '）' : ''}` : `${s.label}：${s.error || s.reason || '跳过'}`;
        log.innerHTML += `<div class="log-line ${cls}">${s.ok ? '✅' : s.skipped ? '⏭️' : '⚠️'} ${txt} · ${s.ms}ms</div>`;
      }
      log.innerHTML += `<div class="log-line ok">— 合计入库 ${report.total} 条 —</div>`;
    }
  } catch (e) { log.innerHTML += `<div class="log-line warn">请求失败：${e.message}</div>`; }
  finally { btn.disabled = false; btn.innerHTML = '🔄 同步全部'; }
};

loadStats();
