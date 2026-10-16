// 又花钱了 · 网页版界面层：只做渲染与交互，判定全部走 js/ 里的纯函数（与 App core/ 同口径）
import { parseText } from './parser.js';
import { CATEGORIES, categoryByName as CAT_VIEW_BASE } from './lexicon.js';
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
  loadTax, saveTax, applyRuntimeTax, setCategoryBudget, addCategory, removeCategory,
} from './store.js';
import { goodsCatForName, itemExtrasNote, manualGoods, goodsNameProblem } from './goods_detect.js';
import { GOODS_CATEGORIES, GOODS_OTHER, goodsIcon } from './goods_lexicon.js';
import { TxFilters } from './filters.js';
import { topsForPicker, subsForPicker, ownerOf, KIND_FALLBACK } from './taxonomy.js';
import { categoryIcon, disableProblem, deleteProblem, activeCategories, builtinCategoryNames } from './categories.js';
import { budgetAlertsForMonth, budgetLevel } from './budget.js';
import { subRows } from './stats.js';

const $ = (id) => document.getElementById(id);
const yuan = (cents) => centsStr(cents);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 图标先查内置平表，查不到再走运行时生效表（自定义分类、导入来的陌生名字都要显示得出来）。
const catView = (name) => {
  const c = CAT_VIEW_BASE(name);
  return c && c.emoji ? c : { name, emoji: categoryIcon(name) };
};

// 物品大类下拉：14 类 + 兜底，书写次序就是词表里的次序（平手时靠它保证跨设备同答案）
const goodsOptions = (selected) => [...GOODS_CATEGORIES, GOODS_OTHER]
  .map((c) => `<option value="${c.name}"${c.name === selected ? ' selected' : ''}>${c.emoji} ${c.name}</option>`)
  .join('');

let txs = loadTxs();
let meta = loadMeta();
// 分类与分类预算：读盘 → 灌运行时（判类词表、选择器、图标都跟着走）→ 界面只读这一份
let tax = applyRuntimeTax(loadTax());
let pending = [];
let lastDeleted = null;
// `f` 是那把筛子本身（filters.js 的 TxFilters，与 App 的 LedgerState.filters 同形）；
// 界面上不再另存一个 ui.cat——多存一份就有「筛子与高亮不同步」那种第二次答案。
const ui = { view: 'today', range: 'month', q: '', f: new TxFilters(), period: PERIOD.month, scope: SCOPE.net, subTop: '' };

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
    // 附属物品那句实话（docs/30 FR-4）：与 App 确认卡同一文案、同一条判据——
    // 主物品被清空就不说，而且这一行点一下整串去掉（他猜错了第二个名词，不该只能留着）。
    const extrasNote = itemExtrasNote(p.itemExtras ?? [], !!p.item, '，点一下去掉');
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
      <p class="warn-miss" data-w="amt"${miss ? '' : ' hidden'}>没听出金额，补一下就能入账</p>
      ${extrasNote ? `<p class="warn-miss extras" data-a="extras" title="点一下去掉">${esc(extrasNote)}</p>` : ''}
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
        if (f === 'amount') {
          p.amountCents = inp.value === '' ? null : Math.round(parseFloat(inp.value) * 100);
          // 与 App 确认卡同一条：那边每敲一下金额就 setState，这边补好了那行提醒必须当场收掉，
          // 不许「金额已经有了、屏幕上还说没听出」。只收放这一行、不整张重画，是为了不丢输入焦点。
          const w = card.querySelector('[data-w="amt"]');
          if (w) w.hidden = !(p.amountCents === null || p.amountCents === undefined);
        }
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
    const ex = card.querySelector('[data-a="extras"]');
    // 点一下：整串附属作废（不落库的是我们猜的那几个名词，不是他记下的那笔账）
    if (ex) ex.onclick = () => { pending[i].itemExtras = []; renderPending(); };
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
  const chosen = new Set(idxs);
  const keptIdx = new Set();
  idxs.forEach((i) => {
    const p = pending[i];
    if (!p) return;
    if (!p.amountCents || p.amountCents <= 0) { keptIdx.add(i); return; }
    const err = goodsNameProblem((p.item ?? '').trim());
    if (err) { toast(err); keptIdx.add(i); return; }
    const g = goodsOf(p, learned);
    txs = addTx(txs, {
      type: p.type, amountCents: p.amountCents, category: p.category || '其他',
      merchant: (p.merchant ?? '').trim(), raw: p.raw ?? '', source: 'text',
      occurredAt: p.occurredAt instanceof Date && !isNaN(p.occurredAt) ? p.occurredAt : now,
      item: g?.item ?? '', itemNorm: g?.itemNorm ?? '',
      goodsCat: g?.goodsCat ?? '', itemSrc: g?.src ?? '',
      // 附属那一串原样交下去：级联清空与「跟主物品同名就剔掉」由 store.js 的 cascade 一处判定
      // （与 App 的 Tx.goodsExtras 同一口径）。界面上点掉那行时这里就是空串。
      itemExtras: (p.itemExtras ?? []).slice(),
    });
    added++;
  });
  // 留在卡上的只有两种：这批里没落库成功的（补金额），和这次根本没点的。
  // 后半句是这个函数曾经的缺陷：只按 idxs 重建 pending，逐张入账时没点的那几张会静默消失。
  pending = pending.filter((_, i) => keptIdx.has(i) || !chosen.has(i));
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
    <p class="warn-miss extras" id="f-extras" hidden title="点一下去掉"></p>
    <div class="field"><span>物品大类</span><select id="f-goods-cat">
      <option value=""${row?.item ? '' : ' selected'}>自动判断</option>${goodsOptions(row?.goodsCat ?? '')}
    </select></div>
    <div class="field"><span>时间</span><input id="f-when" type="datetime-local" value="${dtLocal(row?.occurredAt ?? new Date())}"></div>`;
  // 🔴 与 Dart 侧 edit_sheet 同一条：只有他真动过物品栏才算手改。
  // 打开编辑页改个金额就落 src=manual，等于把我的词典判断冒充成他的决定，
  // 而 manual 在学习表里压过一切、他自己也撤不回来。
  let goodsTouched = false;
  let goodsPicked = false;
  // 附属物品（docs/30 FR-4）：这一页没有编辑框可改它，但必须给一个「点掉」的动作——
  // 我们替他猜的第二个名词，不能让他只能留着。落库时原样带回去，判定在 store.js 的 cascade。
  let itemExtras = (row?.itemExtras ?? []).slice();
  const paintExtras = () => {
    const note = itemExtrasNote(itemExtras, $('f-item').value.trim() !== '', '，点一下去掉');
    const el = $('f-extras');
    el.textContent = note;
    el.hidden = note === '';
  };
  $('f-extras').onclick = () => { itemExtras = []; paintExtras(); };
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
    // 主物品被他清空 ⇒ 那句「还说到了…」跟着闭嘴（同一判据在两处各写一遍就会有一处先漂）
    paintExtras();
  };
  $('f-goods-cat').onchange = () => {
    goodsPicked = true;
    goodsTouched = true;
  };
  $('f-goods-cat').disabled = (row?.item ?? '') === '';
  paintExtras();
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
    // 这里永远显式带上五个字段：updateTx 是合并写，漏带键等于改一笔金额把物品清不掉。
    // 清空物品是合法决定（g 为 null ⇒ 四件一起空），附属那一串也不能因为「这页没编辑框」就丢。
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
      itemExtras: itemExtras.slice(),
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
  // 筛子整体交给 TxFilters（与 App 同一处判据）：网页版从前在这里自己写「分类相等 + 三个字段拼串搜」，
  // 那是第二份筛选口径——同一份账，手机上 12 笔、网页上 14 笔时界面上只是一个角标数字，看不出来。
  const f = ui.f;
  f.query = ui.q.trim();
  return f.apply(scopedTxs());
}

function txRow(t) {
  const c = catView(t.category);
  const sign = t.type === 'income' ? '+' : t.type === 'refund' ? '−' : '';
  const cls = t.type === 'income' ? 'amt in' : 'amt';
  // 物品跟在分类后面（与 App 明细行同一条：`' · ${goodsIcon(goods_cat)}${item}'`）。
  // 没记物品的笔不占位——写「·（无）」等于把「他没记」渲染成一种物品。
  // `+N`（docs/30 FR-4）：一句里并列说到的其它物品不单独成行、也不进金额榜，
  // 列表里只留一个计数，点进编辑页看得见全名。
  const nExtras = (t.itemExtras ?? []).length;
  const goods = t.item ? ` · ${goodsIcon(t.goodsCat)}${esc(t.item)}${nExtras ? `+${nExtras}` : ''}` : '';
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

// 明细页那排多选（v16-S48）：一级、二级各自一组 toggle chip，勾的是「当前候选」，
// 候选按方向过滤这一件事走 taxonomy 的 topsForPicker/subsForPicker（与 App 同一处）。
// 二级只在已经勾了一级时才出现——没勾一级就摊开整棵树的二级，会把「正餐」和收入树的同名格子混在一起。
function subCandidates() {
  const cats = [...ui.f.cats];
  if (!cats.length) return [];
  const out = [];
  for (const c of cats) {
    const k = ownerOf(c) ?? 'expense';
    for (const t of subsForPicker(k, c, tax.disabled)) if (!out.some((e) => e.name === t.name && e.kind === k)) out.push({ ...t, kind: k });
  }
  return out;
}

function fillCatFilter() {
  const kinds = ui.f.type ? [ui.f.type] : ['expense', 'income', 'refund'];
  const tops = [];
  for (const k of kinds) for (const t of topsForPicker(k, tax.disabled)) if (!tops.some((e) => e.name === t.name)) tops.push(t);
  // 账本里出现过、但当前方向候选没有的名字（停用/别棵树/自定义被删过）也要能撤——
  // 撤不掉就是界面把一把已经生效的筛子藏起来了，同 App 的 _topOrphans 那格。
  const orphans = [...ui.f.cats].filter((c) => !tops.some((t) => t.name === c));
  $('cat-chips').innerHTML =
    [['expense', '只看支出'], ['income', '只看收入'], ['refund', '只看退款']]
      .map(([k, label]) => chipHtml(ui.f.type === k, label, `type:${k}`))
      .concat(
        tops.map((t) => chipHtml(ui.f.cats.has(t.name), `${t.emoji || '🏷'} ${esc(t.name)}`, `cat:${esc(t.name)}`)),
        orphans.map((c) => chipHtml(true, `⚠ ${esc(c)}（这一格不在当前方向）`, `cat:${esc(c)}`)),
      )
    .join('');
  const subs = subCandidates();
  const subOrphans = [...ui.f.subs].filter((s) => !subs.some((t) => t.name === s));
  $('sub-chips').innerHTML = subs.length
    ? subs.map((t) => chipHtml(ui.f.subs.has(t.name), esc(t.name), `sub:${esc(t.name)}`)).concat(
        subOrphans.map((s) => chipHtml(true, `⚠ ${esc(s)}`, `sub:${esc(s)}`)),
      ).join('')
    : `<span class="dim">${ui.f.cats.size ? '这一级下面没有二级可勾' : '先勾上面的一级，才谈二级'}</span>`;
  $('filter-chips').innerHTML = ui.f.chips().map(([k, label]) => chipHtml(true, esc(label), `drop:${k}`)).join('');
  $('sub-all').disabled = subs.length === 0;
  $('sub-invert').disabled = subs.length === 0;
  $('sub-clear').disabled = ui.f.subs.size === 0;
  $('f-clear').disabled = !ui.f.hasCondition;
  bindChips();
}

function chipHtml(on, label, key) {
  return `<button class="fchip${on ? ' on' : ''}" type="button" data-k="${key}" aria-pressed="${on}">${label}</button>`;
}

function bindChips() {
  document.querySelectorAll('.fchip').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.k;
      if (k.startsWith('cat:')) toggleSet(ui.f.cats, k.slice(4));
      else if (k.startsWith('sub:')) toggleSet(ui.f.subs, k.slice(4));
      else if (k.startsWith('type:')) {
        const v = k.slice(5);
        // 换方向不清掉已经勾上的一级/二级（同 App：那些格子变成「孤儿」仍显示着，撤得掉）。
        // 悄悄替他清空＝机器擅自动他的筛选，而屏幕上是沉默的。
        ui.f.type = ui.f.type === v ? '' : v;
      } else if (k.startsWith('drop:')) ui.f.remove(k.slice(5));
      render();
    };
  });
}

function toggleSet(s, name) {
  if (s.has(name)) s.delete(name);
  else s.add(name);
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
    ? `最大一笔：${catView(maxTx.category).emoji} ${maxTx.merchant || maxTx.category} ¥${yuan(maxTx.amountCents)}`
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
    // 「日均那一行什么时候出现」以前在这里再写一遍 `pct >= 0.8`（浮点），于是同一个边界有两把尺：
    // 灯的档位由 budgetLevel 用整数交叉相乘判，pct 是除出来的小数，差一分的那一笔两边不同答案。
    // 现在只读红绿灯给出的档位号：那一行与灯同时出现，谁也不比谁早一分。
    const warn = tl.level != null && tl.perDay > 0;
    per.hidden = !warn;
    per.textContent = warn
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
    const cat = catView(name);
    return `<div class="catrow drill" data-top="${esc(name)}" role="button" tabindex="0"><div class="lab"><span>${cat.emoji} ${esc(name)}</span><b>¥${yuan(v)} · ${Math.round(v / curTotal * 100)}%</b></div>
      <div class="track"><div class="fill" style="width:${Math.max(2, Math.round(v / rows[0][1] * 100))}%"></div></div></div>`;
  }).join('') : '<p class="line dim">这个范围里还没有数据</p>';
  document.querySelectorAll('#st-cats .drill').forEach((el) => {
    el.onclick = () => {
      // 再点同一行收回（同 App 的下钻那一格）：这里只改「展开谁」，不改筛子——
      // 点了下钻就把筛选条件写进去，等于替他做了一个他没做的决定。
      ui.subTop = ui.subTop === el.dataset.top ? '' : el.dataset.top;
      renderStats();
    };
  });
  renderSubRows(cur);
  renderBudgetAlerts();

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
  renderCatBudgets();
  renderCatManage();
  const m = moneyOf(txsInPeriod(txs, ...periodRange(PERIOD.month, new Date())));
  const rate = savingsRatePct(meta.incomeCents || 0, m.net);
  $('ver').textContent = `又花钱了 网页版 v0.1.1 · 本机 ${txs.length} 笔 · 本月净支出 ¥${yuan(m.net)}${rate === null ? '' : ` · 储蓄率 ${rate}%`}`;
}

// 分类预算（信封）：候选按方向给（支出一棵树就够界面用），每格一个数，设 0 即撤线。
// 🔴 这一页只写 tax.catBudgets，不写月度总预算那一格——两条线各归各的，混在一格里就分不清了。
function renderCatBudgets() {
  const tops = topsForPicker('expense', tax.disabled).filter((t) => t.parent === '');
  $('cat-budgets').innerHTML = tops.map((t) => {
    const cents = tax.catBudgets[t.name] ?? 0;
    return `<label class="field"><span>${t.emoji || '🏷'} ${esc(t.name)}</span><input data-cat="${esc(t.name)}" class="cat-budget" type="number" min="0" step="1" placeholder="不设" value="${cents ? cents / 100 : ''}"></label>`;
  }).join('');
  document.querySelectorAll('.cat-budget').forEach((inp) => {
    inp.onchange = () => {
      tax = saveTax({ catBudgets: setCategoryBudget(inp.dataset.cat, Math.round(parseFloat(inp.value || '0') * 100)) });
      render();
    };
  });
}

function renderCatManage() {
  const builtin = CATEGORIES.filter((c) => !builtinCategoryNames().has(c.name) ? false : true);
  const rows = [];
  for (const c of builtin) {
    const off = tax.disabled.has(c.name);
    rows.push(
      `<div class="catrow"><span>${c.emoji} ${esc(c.name)}${off ? '（已停用）' : ''}</span>` +
        `<button data-name="${esc(c.name)}" class="ghost cat-toggle" type="button">${off ? '恢复' : '停用'}</button></div>`
    );
  }
  for (const c of tax.custom) {
    rows.push(
      `<div class="catrow"><span>${c.emoji} ${esc(c.name)}（自定义 · ${ownerLabel(c.kind)}）</span>` +
        `<button data-name="${esc(c.name)}" class="ghost cat-del" type="button">删除</button></div>`
    );
  }
  $('cat-manage').innerHTML = rows.join('');
  document.querySelectorAll('.cat-toggle').forEach((b) => {
    b.onclick = () => {
      const name = b.dataset.name;
      const active = activeCategories().map((c) => c.name);
      if (!tax.disabled.has(name)) {
        const problem = disableProblem(name, active.filter((n) => !tax.disabled.has(n)), builtinCategoryNames());
        if (problem) return sayCatMsg(problem);
        tax = saveTax({ disabled: new Set([...tax.disabled, name]) });
      } else {
        const next = new Set(tax.disabled);
        next.delete(name);
        tax = saveTax({ disabled: next });
      }
      sayCatMsg('');
      render();
    };
  });
  document.querySelectorAll('.cat-del').forEach((b) => {
    b.onclick = () => {
      const name = b.dataset.name;
      const r = removeCategory(tax, txs, name);
      const kinds = [...new Set(r.kinds)];
      const fallbacks = kinds.map((k) => KIND_FALLBACK[k]).filter(Boolean);
      const problem = deleteProblem(name, r.used, fallbacks);
      if (problem && !confirm(problem + ' 要现在就把这些账挪过去吗？（删分类本身不动流水）')) return;
      tax = saveTax({ custom: r.custom, catBudgets: r.catBudgets });
      // 删了分类，那些账归到各自方向的兜底（同 App 的 removeCategory 那句 kindFallback）。
      if (r.used > 0 && fallbacks.length) {
        for (const k of kinds) {
          const to = KIND_FALLBACK[k];
          for (const t of txs.filter((x) => x.type === k && x.category === name)) txs = updateTx(txs, { id: t.id, category: to, subCategory: '' });
        }
      }
      sayCatMsg(problem ? `删掉「${name}」，${r.used} 笔归到兜底那一格` : `删掉了空的「${name}」`);
      render();
    };
  });
  $('new-cat-add').onclick = () => {
    const r = addCategory(tax, $('new-cat-name').value, {
      wordsRaw: $('new-cat-words').value,
      kind: $('new-cat-kind').value,
    });
    if (r.error) return sayCatMsg(r.error);
    tax = saveTax({ custom: r.custom });
    $('new-cat-name').value = '';
    $('new-cat-words').value = '';
    sayCatMsg(`加好了：${r.name}`);
    render();
  };
}

function ownerLabel(k) {
  return k === 'income' ? '收入' : k === 'refund' ? '退款' : '支出';
}

function sayCatMsg(text) {
  const el = $('cat-msg');
  el.hidden = text === '';
  el.textContent = text;
}

// 二级那一排（统计多维的第二根轴）：每一格都留着，含负的——
// 一级净 ¥3.00 可能是「饮品 ¥5 − 正餐 ¥2」凑出来的，丢掉负的那格，这一排加起来会比它挂的那行还多。
// 所以最后那一行把「Σ 二级」与「一级那一格」并排放出来：口径差要在屏幕上看得见，不许藏在算法里。
function renderSubRows(cur) {
  const card = $('st-sub-card');
  if (!ui.subTop) {
    card.hidden = true;
    $('st-subs').innerHTML = '';
    return;
  }
  card.hidden = false;
  $('st-sub-head').textContent = `按二级拆开：${ui.subTop}`;
  const rows = subRows(cur, ui.scope, ui.subTop);
  const sum = rows.reduce((a, [, v]) => a + v, 0);
  $('st-subs').innerHTML = rows.length
    ? rows.map(([name, v]) => {
        const share = sum > 0 ? Math.round((v / sum) * 100) : 0;
        return `<div class="catrow"><div class="lab"><span>${esc(name)}</span><b>${v < 0 ? '−' : ''}¥${yuan(Math.abs(v))} · ${share}%</b></div>
          <div class="track"><div class="fill${v < 0 ? ' neg' : ''}" style="width:${Math.max(2, Math.min(100, Math.abs(sum) > 0 ? Math.round(Math.abs(v) / Math.abs(sum) * 100) : 0))}%"></div></div></div>`;
      }).join('') + `<p class="line dim">二级合计 ¥${yuan(sum)}（一级那一格也是这个数才对得上；「未细分」是那些没记过二级的账）</p>`
    : '<p class="line dim">这一级下面还没有可拆的二级</p>';
}

// 分类预算那一排：档位号一律由 budgetLevel 产出（与红绿灯同一函数），界面只翻译颜色。
function renderBudgetAlerts() {
  const now = new Date();
  const alerts = budgetAlertsForMonth(tax.catBudgets, txs, now);
  $('st-budget-card').hidden = alerts.length === 0;
  $('st-budgets').innerHTML = alerts
    .map((a) => {
      const level = budgetLevel(a.spentCents, a.budgetCents);
      const color = level === 100 ? 'over' : 'warn';
      const avg = a.count > 0 ? Math.round(a.spentCents / a.count) : 0;
      return `<li><span>${catView(a.category).emoji} ${esc(a.category)} <small>${a.count} 笔 · 均价 ¥${yuan(avg)}</small></span>` +
        `<b class="lamp ${color}">${level}% · ¥${yuan(a.spentCents)} / ¥${yuan(a.budgetCents)}</b></li>`;
    })
    .join('');
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

const jsonText = () => buildJson(txs, meta.budgetCents ?? 0, tax);

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
  $('sub-all').onclick = () => { subCandidates().forEach((t) => ui.f.subs.add(t.name)); render(); };
  $('sub-invert').onclick = () => {
    // 全选→反选＝一个都不留（同 App 那条判据）：它作用在「当前候选」上，不动别的树勾上的名字。
    for (const t of subCandidates()) {
      if (ui.f.subs.has(t.name)) ui.f.subs.delete(t.name);
      else ui.f.subs.add(t.name);
    }
    render();
  };
  $('sub-clear').onclick = () => { ui.f.subs = new Set(); render(); };
  $('f-clear').onclick = () => {
    const sort = ui.f.sort;
    ui.f = new TxFilters();
    ui.f.sort = sort;
    ui.subTop = '';
    render();
  };

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
      const { rows, skipped, custom, disabled, catBudgets } = parseImportJson($('imp-box').value);
      const r = importTxs(txs, rows);
      txs = r.txs;
      // 文件里带着分类段/预算段就跟着收（这是「导入」，不是「顺手备份一次」）：
      // 收了账却把停用的分类又放出来，等于把他在这台手机上的决定抹掉了。
      if (custom || disabled || catBudgets) {
        tax = saveTax({
          custom: custom ?? tax.custom,
          disabled: disabled ? new Set(disabled) : tax.disabled,
          catBudgets: catBudgets ?? tax.catBudgets,
        });
      }
      msg.textContent = `导入 ${r.added} 笔${skipped ? `，跳过坏行 ${skipped} 条` : ''}${rows.length - r.added ? `，重复 ${rows.length - r.added} 条已忽略` : ''}${custom || disabled ? '，分类一并收下了' : ''}`;
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
