// 又花钱了 · 网页版界面层：只做渲染与交互，判定全部走 js/ 里的纯函数（与 App core/ 同口径）
import { parseText } from './parser.js';
import { CATEGORIES, categoryByName } from './lexicon.js';
import { moneyOf, netByCategory, centsStr, recordStreak, savingsRatePct } from './money.js';
import {
  PERIOD, SCOPE, periodRange, previousRange, txsInPeriod, elapsedUnits, scopeTotal,
  catRows, mergeTopRows, merchantTop, seriesPoints, highlightIndex, dailyHeat, heatBucket,
  periodOverPeriod, trafficLight, daysInMonth,
} from './stats.js';
import {
  loadTxs, addTx, updateTx, removeTx, restoreTx, loadMeta, saveMeta, clearTxs,
  buildJson, buildCsv, parseImportJson, importTxs, localTime, backupNudge,
  goodsKnownItems, goodsCatSuggestions,
} from './store.js';
import { goodsCatForName, manualGoods, goodsNameProblem } from './goods_detect.js';
import { GOODS_CATEGORIES, GOODS_OTHER, goodsIcon } from './goods_lexicon.js';

const $ = (id) => document.getElementById(id);
const yuan = (cents) => centsStr(cents);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 物品大类下拉：14 类 + 兜底，书写次序就是词表里的次序（平手时靠它保证跨设备同答案）
const goodsOptions = (selected) => [...GOODS_CATEGORIES, GOODS_OTHER]
  .map((c) => `<option value="${c.name}"${c.name === selected ? ' selected' : ''}>${c.emoji} ${c.name}</option>`)
  .join('');

let txs = loadTxs();
let meta = loadMeta();
let pending = [];
let lastDeleted = null;
const ui = { view: 'today', range: 'month', q: '', cat: '', period: PERIOD.month, scope: SCOPE.net };

// ---------- 通用 ----------
let toastTimer = null;
function toast(msg, actionLabel, action) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  el.onclick = null;
  if (actionLabel) {
    el.textContent = `${msg} · ${actionLabel}`;
    el.onclick = () => { hideToast(); action(); };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actionLabel ? 5000 : 2200);
}
function hideToast() { $('toast').hidden = true; }

function fmtDay(d) {
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function dtLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- 视图切换 ----------
function showView(name) {
  ui.view = name;
  for (const v of ['today', 'list', 'stats', 'me']) {
    $(`view-${v}`).hidden = v !== name;
  }
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  render();
}

// ---------- 快记 ----------
const HINTS = ['中午星巴克拿铁三十二块', '打车回家二十七块五', '美团买药 39.9', '工资到账 8600', '京东下单，耳机明天到'];

function renderHints() {
  $('hints').innerHTML = HINTS.map((h) => `<button type="button">${esc(h)}</button>`).join('');
  $('hints').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { $('say').value = b.textContent; $('say').focus(); };
  });
}

function doParse() {
  const text = $('say').value.trim();
  if (!text) return;
  const rows = parseText(text, new Date(), goodsKnownItems(txs), goodsCatSuggestions(txs));
  if (!rows.length) {
    toast('这句话里没听出金额，手动填一下？');
    openManual(text);
    return;
  }
  pending = rows.map((r) => ({ ...r, key: Math.random().toString(36).slice(2) }));
  $('say').value = '';
  renderPending();
}

function renderPending() {
  const box = $('pending');
  if (!pending.length) { box.innerHTML = ''; return; }
  const learned = goodsCatSuggestions(txs);
  // 大类显示的是**这一笔将要落库的那个类**：他没点过就是推出来的结果，点过就按他选的。
  // 与 App 确认卡同一条：名字一改，先前推出来的大类作废重推（别让「跑鞋」挂着「饮品」）。
  const goodsCatOf = (p) => (p.item
    ? (p.goodsPicked ? p.goodsCat : goodsCatForName(p.item, learned))
    : '');
  box.innerHTML = pending.map((p, i) => {
    const miss = p.amountCents === null || p.amountCents === undefined;
    return `<div class="pcard" data-i="${i}">
      <p class="raw">「${esc(p.raw)}」</p>
      <div class="pgrid">
        <label>金额（元）<input data-f="amount" type="number" min="0" step="0.01" value="${miss ? '' : (p.amountCents / 100)}" placeholder="必填"></label>
        <label>类型<select data-f="type">
          <option value="expense"${p.type === 'expense' ? ' selected' : ''}>支出</option>
          <option value="income"${p.type === 'income' ? ' selected' : ''}>收入</option>
          <option value="refund"${p.type === 'refund' ? ' selected' : ''}>退款</option>
        </select></label>
        <label>分类<select data-f="category">${CATEGORIES.map((c) => `<option value="${c.name}"${c.name === p.category ? ' selected' : ''}>${c.emoji} ${c.name}</option>`).join('')}</select></label>
        <label>商户<input data-f="merchant" value="${esc(p.merchant)}" placeholder="可留空"></label>
        <label>物品<input data-f="item" value="${esc(p.item ?? '')}" placeholder="${p.item ? '' : '没听出来，点一下补'}"></label>
        <label>大类<select data-f="goodsCat"${p.item ? '' : ' disabled'}>
          <option value=""${p.item ? '' : ' selected'}>自动判断</option>
          ${goodsOptions(goodsCatOf(p))}
        </select></label>
        <label style="grid-column:1/-1">时间<input data-f="when" type="datetime-local" value="${dtLocal(new Date(p.occurredAt))}"></label>
      </div>
      ${miss ? '<p class="warn-miss">没听出金额，补一下就能入账</p>' : ''}
      <div class="pfoot">
        <button class="primary" data-a="ok" type="button">入账</button>
        <button class="ghost" data-a="drop" type="button">不要这条</button>
      </div>
    </div>`;
  }).join('') + (pending.length > 1
    ? '<div class="pfoot"><button class="ghost" data-all="1" type="button">全部入账（金额空的会提醒补）</button></div>'
    : '');

  box.querySelectorAll('.pcard').forEach((card) => {
    const i = Number(card.dataset.i);
    card.querySelectorAll('[data-f]').forEach((inp) => {
      inp.onchange = () => {
        const p = pending[i];
        const f = inp.dataset.f;
        if (f === 'amount') p.amountCents = inp.value === '' ? null : Math.round(parseFloat(inp.value) * 100);
        else if (f === 'when') p.occurredAt = new Date(inp.value);
        else if (f === 'item') {
          p.item = inp.value.trim();
          p.goodsTouched = true;
          p.goodsPicked = false;
          // 重画一次：大类那格要么跟着清空、要么换成新名字推出来的类， disabled 也要跟着变
          renderPending();
        } else if (f === 'goodsCat') { p.goodsCat = inp.value; p.goodsPicked = true; }
        else p[f] = inp.value;
      };
    });
    card.querySelector('[data-a="ok"]').onclick = () => commit([i]);
    card.querySelector('[data-a="drop"]').onclick = () => { pending.splice(i, 1); renderPending(); };
  });
  const all = box.querySelector('[data-all]');
  if (all) all.onclick = () => commit(pending.map((_, i) => i));
}

// 落库形态一律走 core 的那两个函数，界面不自己重算大类归属（与 App 确认卡同一条纪律）：
// 他动过物品栏 ⇒ manualGoods（显式选过的大类压过一切，没选就交回词典+学习表推）；
// 没动过 ⇒ 原样交回本机抽出来的结果，不许在界面上悄悄改口。
function goodsOf(p, learned) {
  const name = (p.item ?? '').trim();
  if (p.goodsTouched) return manualGoods(name, p.goodsPicked ? p.goodsCat : '', learned);
  if (name === '') return null;
  return { item: name, itemNorm: p.itemNorm ?? '', goodsCat: p.goodsCat ?? '', src: p.itemSrc ?? '' };
}

function commit(idxs) {
  const now = new Date();
  const learned = goodsCatSuggestions(txs);
  let added = 0;
  const kept = [];
  idxs.forEach((i) => {
    const p = pending[i];
    if (!p) return;
    if (!p.amountCents || p.amountCents <= 0) { kept.push(p); return; }
    const err = goodsNameProblem((p.item ?? '').trim());
    if (err) { toast(err); kept.push(p); return; }
    const g = goodsOf(p, learned);
    txs = addTx(txs, {
      type: p.type, amountCents: p.amountCents, category: p.category || '其他',
      merchant: (p.merchant ?? '').trim(), raw: p.raw ?? '', source: 'text',
      occurredAt: p.occurredAt instanceof Date && !isNaN(p.occurredAt) ? p.occurredAt : now,
      item: g?.item ?? '', itemNorm: g?.itemNorm ?? '',
      goodsCat: g?.goodsCat ?? '', itemSrc: g?.src ?? '',
    });
    added++;
  });
  pending = kept;
  if (added) toast(`已记 ${added} 笔 · 账本在你这台设备上`);
  renderPending();
  render();
}

// ---------- 手动 / 编辑 ----------
function openSheet(title, row, onSubmit) {
  $('sheet-title').textContent = title;
  const learned = goodsCatSuggestions(txs);
  const body = $('sheet-body');
  body.innerHTML = `
    <div class="field"><span>金额（元）</span><input id="f-amount" type="number" min="0" step="0.01" value="${row?.amountCents ? row.amountCents / 100 : ''}"></div>
    <div class="field"><span>类型</span><select id="f-type">
      <option value="expense">支出</option><option value="income">收入</option><option value="refund">退款</option>
    </select></div>
    <div class="field"><span>分类</span><select id="f-cat">${CATEGORIES.map((c) => `<option value="${c.name}">${c.emoji} ${c.name}</option>`).join('')}</select></div>
    <div class="field"><span>商户</span><input id="f-mer" value="${esc(row?.merchant ?? '')}" placeholder="可留空"></div>
    <div class="field"><span>物品</span><input id="f-item" value="${esc(row?.item ?? '')}" placeholder="没记就是没记，可留空"></div>
    <div class="field"><span>物品大类</span><select id="f-goods-cat">
      <option value=""${row?.item ? '' : ' selected'}>自动判断</option>${goodsOptions(row?.goodsCat ?? '')}
    </select></div>
    <div class="field"><span>时间</span><input id="f-when" type="datetime-local" value="${dtLocal(row?.occurredAt ?? new Date())}"></div>`;
  // 🔴 与 Dart 侧 edit_sheet 同一条：只有他真动过物品栏才算手改。
  // 打开编辑页改个金额就落 src=manual，等于把我的词典判断冒充成他的决定，
  // 而 manual 在学习表里压过一切、他自己也撤不回来。
  let goodsTouched = false;
  let goodsPicked = false;
  $('f-type').value = row?.type ?? 'expense';
  $('f-cat').value = row?.category ?? '其他';
  // 名字一改，先前推出来的大类就作废：重推一次，别让「跑鞋」挂着「饮品」
  $('f-item').oninput = () => {
    goodsTouched = true;
    const nm = $('f-item').value.trim();
    const sel = $('f-goods-cat');
    sel.disabled = nm === '';
    if (nm === '') {
      sel.value = '';
      goodsPicked = false;
    } else if (!goodsPicked) {
      sel.value = goodsCatForName(nm, learned);
    }
  };
  $('f-goods-cat').onchange = () => {
    goodsPicked = true;
    goodsTouched = true;
  };
  $('f-goods-cat').disabled = (row?.item ?? '') === '';
  $('sheet').hidden = false;
  $('sheet-ok').onclick = () => {
    const cents = Math.round(parseFloat($('f-amount').value || '0') * 100);
    if (!cents || cents <= 0) { toast('金额没填或为 0'); return; }
    const itemName = $('f-item').value.trim();
    const g = goodsTouched ? manualGoods(itemName, goodsPicked ? $('f-goods-cat').value : '', learned) : null;
    if (goodsTouched) {
      const err = goodsNameProblem(itemName);
      if (err) { toast(err); return; }
    }
    // 这里永远显式带上四个字段：updateTx 是合并写，漏带键等于改一笔金额把物品清不掉。
    // 清空物品是合法决定（g 为 null ⇒ 四件一起空），不是「没填」。
    onSubmit({
      amountCents: cents,
      type: $('f-type').value,
      category: $('f-cat').value,
      merchant: $('f-mer').value.trim(),
      occurredAt: new Date($('f-when').value),
      item: goodsTouched ? (g?.item ?? '') : (row?.item ?? ''),
      itemNorm: goodsTouched ? (g?.itemNorm ?? '') : (row?.itemNorm ?? ''),
      goodsCat: goodsTouched ? (g?.goodsCat ?? '') : (row?.goodsCat ?? ''),
      itemSrc: goodsTouched ? (g?.src ?? '') : (row?.itemSrc ?? ''),
    });
    closeSheet();
  };
  $('sheet-cancel').onclick = closeSheet;
}
function closeSheet() { $('sheet').hidden = true; }

function openManual(raw) {
  openSheet('手动记一笔', raw ? { merchant: '', type: 'expense', category: '其他', occurredAt: new Date() } : null, (v) => {
    txs = addTx(txs, { ...v, raw: raw ?? '', source: 'manual' });
    toast('已记 1 笔');
    render();
  });
}

// ---------- 列表 ----------
function scopedTxs() {
  const now = new Date();
  if (ui.range === 'all') return txs;
  const [s, e] = ui.range === 'week'
    ? [new Date(now.getTime() - 7 * 86400000), new Date(now.getTime() + 86400000)]
    : periodRange(PERIOD.month, now);
  return txsInPeriod(txs, s, e);
}

function filtered() {
  const q = ui.q.trim().toLowerCase();
  return scopedTxs()
    .filter((t) => !ui.cat || t.category === ui.cat)
    .filter((t) => !q || `${t.merchant}${t.category}${t.raw}`.toLowerCase().includes(q))
    .sort((a, b) => b.occurredAt - a.occurredAt);
}

function txRow(t) {
  const c = categoryByName(t.category);
  const sign = t.type === 'income' ? '+' : t.type === 'refund' ? '−' : '';
  const cls = t.type === 'income' ? 'amt in' : 'amt';
  // 物品跟在分类后面（与 App 明细行同一条：`' · ${goodsIcon(goods_cat)}${item}'`）。
  // 没记物品的笔不占位——写「·（无）」等于把「他没记」渲染成一种物品。
  const goods = t.item ? ` · ${goodsIcon(t.goodsCat)}${esc(t.item)}` : '';
  return `<li class="tx" data-id="${t.id}">
    <span class="emo">${c.emoji}</span>
    <span class="who"><b>${esc(t.merchant || t.category)}</b><small>${c.name}${goods} · ${fmtDay(t.occurredAt)} ${String(t.occurredAt.getHours()).padStart(2, '0')}:${String(t.occurredAt.getMinutes()).padStart(2, '0')}${t.source === 'import' ? ' · 导入' : ''}</small></span>
    <span class="${cls}">${sign}¥${yuan(t.amountCents)}</span>
    <button class="del" type="button" title="删除">✕</button>
  </li>`;
}

function bindRows(root) {
  root.querySelectorAll('.tx').forEach((li) => {
    const id = Number(li.dataset.id);
    li.querySelector('.del').onclick = () => {
      const { txs: next, removed } = removeTx(txs, id);
      txs = next;
      lastDeleted = removed;
      render();
      toast('已删除那笔', '撤销', () => { if (lastDeleted) { txs = restoreTx(txs, lastDeleted); lastDeleted = null; render(); } });
    };
    li.querySelector('.who').onclick = () => {
      const row = txs.find((t) => t.id === id);
      if (!row) return;
      openSheet('编辑这笔', row, (v) => { txs = updateTx(txs, { id, ...v }); render(); });
    };
  });
}

function renderList() {
  const rows = filtered();
  const m = moneyOf(rows);
  $('list-sum').textContent = rows.length
    ? `${rows.length} 笔 · 支出 ¥${yuan(m.expense)}${m.refund ? ` − 退款 ¥${yuan(m.refund)}` : ''} = 净支出 ¥${yuan(m.net)}${m.income ? ` · 收入 ¥${yuan(m.income)}` : ''}`
    : '';
  $('list-empty').hidden = rows.length > 0;
  const groups = {};
  for (const t of rows) {
    const k = new Date(t.occurredAt.getFullYear(), t.occurredAt.getMonth(), t.occurredAt.getDate()).getTime();
    (groups[k] ??= []).push(t);
  }
  $('groups').innerHTML = Object.keys(groups).map(Number).sort((a, b) => b - a).map((k) => {
    const day = new Date(k);
    const total = Object.values(netByCategory(groups[k])).reduce((a, v) => a + v, 0);
    return `<div class="dayhead"><span>${fmtDay(day)} · ${day.getMonth() + 1}/${day.getDate() >= 10 ? day.getDate() : '0' + day.getDate()}</span><span>净支出 ¥${yuan(total)}</span></div>
      <ul class="txlist">${groups[k].map(txRow).join('')}</ul>`;
  }).join('');
  bindRows($('groups'));
}

function fillCatFilter() {
  const used = [...new Set(txs.map((t) => t.category))].sort();
  $('cat-filter').innerHTML = `<option value="">全部分类</option>` + used.map((c) => {
    const cat = categoryByName(c);
    return `<option value="${esc(c)}"${c === ui.cat ? ' selected' : ''}>${cat.emoji} ${esc(c)}</option>`;
  }).join('');
}

// ---------- 今日 ----------
function renderToday() {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = txsInPeriod(txs, dayStart, new Date(dayStart.getTime() + 86400000));
  const dayMoney = moneyOf(day);
  $('today-total').textContent = `¥${yuan(dayMoney.net)}`;

  const streak = recordStreak(txs, now);
  $('streak').hidden = streak < 2;
  $('streak').textContent = `🔥 ${streak} 天连胜`;

  const maxTx = day.filter((t) => t.type === 'expense').sort((a, b) => b.amountCents - a.amountCents)[0];
  $('today-max').textContent = maxTx
    ? `最大一笔：${categoryByName(maxTx.category).emoji} ${maxTx.merchant || maxTx.category} ¥${yuan(maxTx.amountCents)}`
    : '今天还没有消费记录，记一笔就有了';

  const [ms, me] = periodRange(PERIOD.month, now);
  const monthNet = moneyOf(txsInPeriod(txs, ms, me)).net;
  const budget = meta.budgetCents ?? 0;
  const lampEl = $('lamp');
  if (budget > 0) {
    const tl = trafficLight(budget, monthNet, now);
    lampEl.hidden = false;
    lampEl.className = `lamp ${tl.lamp}`;
    lampEl.textContent = tl.lamp === 'over' ? '🔴 已超支' : tl.lamp === 'warn' ? '🟡 注意' : '🟢 安心';
    const line = $('budget-line');
    line.hidden = false;
    line.textContent = `本月预算 ¥${yuan(budget)} · 已花(净额) ¥${yuan(monthNet)}（${Math.round(tl.pct * 100)}%）${lampEl.textContent} · 剩 ¥${yuan(tl.shownLeft)}`;
    const per = $('budget-per');
    per.hidden = !(tl.pct >= 0.8 && tl.perDay > 0);
    per.textContent = tl.pct >= 0.8 && tl.perDay > 0
      ? `还能花 ¥${yuan(tl.left)}，剩下的日子日均 ¥${yuan(tl.perDay)}`
      : '';
  } else {
    lampEl.hidden = true;
    $('budget-line').hidden = true;
    $('budget-per').hidden = true;
  }

  const nudged = backupNudge(meta, txs.length, now);
  const nudge = $('backup-nudge');
  nudge.hidden = !nudged;
  if (nudged) $('backup-nudge-text').textContent = nudged.text;
  else $('bk-plain').hidden = true;

  const sorted = day.sort((a, b) => b.occurredAt - a.occurredAt);
  $('today-list').innerHTML = sorted.map(txRow).join('');
  $('today-empty').hidden = sorted.length > 0;
  bindRows($('today-list'));
}

// ---------- 统计 ----------
function renderStats() {
  const now = new Date();
  const [cs, ce] = periodRange(ui.period, now);
  const [ps, pe] = previousRange(ui.period, now);
  const cur = txsInPeriod(txs, cs, ce);
  const prev = txsInPeriod(txs, ps, pe);
  const curTotal = scopeTotal(moneyOf(cur), ui.scope);
  const prevTotal = scopeTotal(moneyOf(prev), ui.scope);
  const units = elapsedUnits(ui.period, now);
  $('st-cur').textContent = `¥${yuan(curTotal)}`;
  $('st-prev').textContent = `¥${yuan(prevTotal)}`;
  const pop = periodOverPeriod(curTotal, prevTotal);
  const popEl = $('st-pop');
  popEl.textContent = pop === null ? '—' : `${pop > 0 ? '+' : ''}${pop}%`;
  popEl.className = `mid${pop !== null && pop < 0 ? ' dim' : ''}`;
  $('st-avg').textContent = `¥${yuan(units ? Math.round(curTotal / units) : 0)}`;

  const pts = seriesPoints(txs, ui.period, ui.scope, now);
  const max = Math.max(1, ...pts);
  const hi = highlightIndex(ui.period, now);
  $('st-series').innerHTML = pts.map((v, i) => {
    const h = Math.max(3, Math.round((v / max) * 80));
    return `<i class="${v > 0 ? 'hot' : ''}${i === hi ? ' on' : ''}" style="height:${h}px" title="¥${yuan(v)}"></i>`;
  }).join('');

  const rows = mergeTopRows(catRows(cur, ui.scope));
  $('st-cats').innerHTML = rows.length ? rows.map(([name, v]) => {
    const cat = categoryByName(name);
    return `<div class="catrow"><div class="lab"><span>${cat.emoji} ${esc(name)}</span><b>¥${yuan(v)} · ${Math.round(v / curTotal * 100)}%</b></div>
      <div class="track"><div class="fill" style="width:${Math.max(2, Math.round(v / rows[0][1] * 100))}%"></div></div></div>`;
  }).join('') : '<p class="line dim">这个范围里还没有数据</p>';

  const mrows = merchantTop(cur, ui.scope);
  $('st-merchants').innerHTML = mrows.length ? mrows.map((r) =>
    `<li><span>${esc(r.name)} <small>${r.count} 笔</small></span><b>¥${yuan(r.cents)}</b></li>`).join('')
    : '<li><span class="dim">还没有商户数据，记账时填上商户就更清楚</span></li>';

  const heat = dailyHeat(txs, now, ui.scope);
  const hmax = Math.max(1, ...Object.values(heat));
  $('st-heat').innerHTML = Array.from({ length: daysInMonth(now) }, (_, i) => {
    const d = i + 1;
    const v = heat[d] ?? 0;
    return `<i class="b${heatBucket(v, hmax)}" title="${d} 日 ¥${yuan(v)}">${d}</i>`;
  }).join('');
}

// ---------- 我的 ----------
function renderMe() {
  $('inp-budget').value = meta.budgetCents ? meta.budgetCents / 100 : '';
  $('inp-income').value = meta.incomeCents ? meta.incomeCents / 100 : '';
  $('inp-voice').checked = !!meta.voiceOn;
  $('micnote').hidden = !meta.voiceOn;
  $('last-backup').textContent = meta.lastExportAt ? `上次备份：${meta.lastExportAt}` : '这笔账本还没导出过备份';
  const m = moneyOf(txsInPeriod(txs, ...periodRange(PERIOD.month, new Date())));
  const rate = savingsRatePct(meta.incomeCents || 0, m.net);
  $('ver').textContent = `又花钱了 网页版 v0.1.1 · 本机 ${txs.length} 笔 · 本月净支出 ¥${yuan(m.net)}${rate === null ? '' : ` · 储蓄率 ${rate}%`}`;
}

function render() {
  if (ui.view === 'today') renderToday();
  else if (ui.view === 'list') { fillCatFilter(); renderList(); }
  else if (ui.view === 'stats') renderStats();
  else renderMe();
}

// ---------- 语音（浏览器识别，明示且可关）----------
function initMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('mic');
  if (!SR) {
    mic.disabled = true;
    mic.title = '这个浏览器没有语音识别，直接打字效果一样';
    return;
  }
  let rec = null;
  mic.onclick = () => {
    if (!meta.voiceOn) {
      meta = saveMeta({ voiceOn: true });
      $('inp-voice').checked = true;
      $('micnote').hidden = false;
      toast('已开启：这句话会交给浏览器识别服务转成文字');
      return;
    }
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join('');
      $('say').value = text;
      doParse();
    };
    rec.onerror = (e) => { toast(`识别没成功（${e.error}），打字记也一样快`); };
    rec.onend = () => { mic.classList.remove('live'); rec = null; };
    rec.start();
    mic.classList.add('live');
  };
}

// ---------- 导入导出 ----------
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

function stampExport() {
  meta = saveMeta({ ...meta, lastExportAt: localTime(new Date()) });
}

const jsonText = () => buildJson(txs, meta.budgetCents ?? 0);

function exportJson() {
  download(`又花钱了-网页版导出-${localTime(new Date()).slice(0, 10)}.json`, jsonText(), 'application/json');
  stampExport();
  render();
  toast('已导出，把这份文件存到微信「文件传输助手」也算存住了');
}

function exportCsv() {
  download(`又花钱了-网页版导出-${localTime(new Date()).slice(0, 10)}.csv`, buildCsv(txs), 'text/csv;charset=utf-8');
  stampExport();
  render();
  toast('已导出 CSV');
}

// 微信内置浏览器常常不响应下载，所以留一条粘贴路：复制内容 → 发给文件传输助手
async function copyBackup() {
  const text = jsonText();
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  if (ok) {
    stampExport();
    $('bk-plain').hidden = true;
    render();
    toast('备份内容已复制，粘贴到聊天里就存住了');
  } else {
    // 手机浏览器/微信里复制常被挡，那就把内容摊出来让他长按选中——这条路一定走得通
    const box = $('bk-plain');
    box.hidden = false;
    box.value = text;
    box.focus();
    box.select();
    toast('复制被浏览器挡了：长按上面那段文字，全选后复制');
  }
}

// ---------- 绑定 ----------
function bind() {
  document.querySelectorAll('.tabbar button').forEach((b) => (b.onclick = () => showView(b.dataset.view)));
  $('parse').onclick = doParse;
  $('manual').onclick = () => openManual('');
  $('say').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doParse(); }
  });
  document.querySelectorAll('#range-segs button').forEach((b) => {
    b.onclick = () => {
      ui.range = b.dataset.range;
      document.querySelectorAll('#range-segs button').forEach((x) => x.classList.toggle('on', x === b));
      render();
    };
  });
  document.querySelectorAll('#p-segs button').forEach((b) => {
    b.onclick = () => {
      ui.period = b.dataset.p;
      document.querySelectorAll('#p-segs button').forEach((x) => x.classList.toggle('on', x === b));
      render();
    };
  });
  document.querySelectorAll('#s-segs button').forEach((b) => {
    b.onclick = () => {
      ui.scope = b.dataset.s;
      document.querySelectorAll('#s-segs button').forEach((x) => x.classList.toggle('on', x === b));
      render();
    };
  });
  $('search').oninput = (e) => { ui.q = e.target.value; renderList(); };
  $('cat-filter').onchange = (e) => { ui.cat = e.target.value; renderList(); };

  $('inp-budget').onchange = (e) => {
    meta = saveMeta({ budgetCents: Math.max(0, Math.round(parseFloat(e.target.value || '0') * 100)) });
    render();
  };
  $('inp-income').onchange = (e) => {
    meta = saveMeta({ incomeCents: Math.max(0, Math.round(parseFloat(e.target.value || '0') * 100)) });
    render();
  };
  $('inp-voice').onchange = (e) => {
    meta = saveMeta({ voiceOn: e.target.checked });
    $('micnote').hidden = !e.target.checked;
  };

  $('exp-json').onclick = exportJson;
  $('exp-csv').onclick = exportCsv;
  $('bk-json').onclick = exportJson;
  $('bk-copy').onclick = copyBackup;
  $('imp-btn').onclick = () => {
    $('imp-box').hidden = false;
    $('imp-row').hidden = false;
    $('imp-box').focus();
  };
  $('imp-cancel').onclick = () => { $('imp-box').hidden = true; $('imp-row').hidden = true; $('imp-msg').hidden = true; };
  $('imp-go').onclick = () => {
    const msg = $('imp-msg');
    msg.hidden = false;
    try {
      const { rows, skipped } = parseImportJson($('imp-box').value);
      const r = importTxs(txs, rows);
      txs = r.txs;
      msg.textContent = `导入 ${r.added} 笔${skipped ? `，跳过坏行 ${skipped} 条` : ''}${rows.length - r.added ? `，重复 ${rows.length - r.added} 条已忽略` : ''}`;
      $('imp-box').value = '';
      render();
    } catch (e) {
      msg.textContent = `导入失败：${e.message}`;
    }
  };

  $('wipe').onclick = () => {
    if (!confirm('确定清空这台设备上的账本？导出的 JSON 还能再导回来。')) return;
    clearTxs();
    txs = [];
    render();
    toast('已清空');
  };
}

renderHints();
bind();
initMic();
showView('today');
