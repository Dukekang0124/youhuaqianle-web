// 网页版本地账本：localStorage 真源，金额存分，零外发（页面上没有任何一条请求会带账本数据）
// 导入/导出格式与 App 的 JSON v5 对齐（app/lib/core/backup.dart），所以手机导出来的账本能直接贴进这里。
import { GOODS_OTHER, goodsCategoryNames, goodsNorm } from './goods_lexicon.js';
import { goodsCatPick } from './goods_detect.js';

const KEY_TX = 'yhq.web.txs.v1';
const KEY_META = 'yhq.web.meta.v1';

// 备份是**外部输入**，来历只认这三个（与 backup.dart 的 _itemSrcs 同一张表）
const ITEM_SRCS = new Set(['lexicon', 'learned', 'manual']);

function two(n) {
  return String(n).padStart(2, '0');
}

export function localTime(d) {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

export function parseLocalTime(s) {
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
}

// v11 附属物品（docs/30 FR-4）：只认字符串数组，别的形态（缺键、半个对象、手改过的文件）
// 一律当「没有」——这一串只多在界面上显示几个名词，为它把整行账跳掉是本末倒置。
function extrasList(raw) {
  return Array.isArray(raw)
    ? raw.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
    : [];
}

function revive(raw) {
  return {
    id: raw.id,
    type: raw.type,
    amountCents: raw.amountCents,
    category: raw.category,
    merchant: raw.merchant ?? '',
    raw: raw.raw ?? '',
    source: raw.source ?? 'manual',
    occurredAt: new Date(raw.occurredAt),
    // v10 物品维度：旧账本根本没有这几项 ⇒ 落成空串。这不是容错，是事实——
    // 那笔账确实没记过物品，分析页要把它算进「没记物品」那一档，而不是假装存在过。
    item: raw.item ?? '',
    itemNorm: raw.item_norm ?? raw.itemNorm ?? '',
    goodsCat: raw.goods_cat ?? raw.goodsCat ?? '',
    itemSrc: raw.item_src ?? raw.itemSrc ?? '',
    // v11 附属物品（docs/30 FR-4）：页面上存的那份用的是驼峰，备份文件用的是 snake_case，
    // 两个都得认——刷新一次页面就把「牙刷」忘掉，等于这台设备的账自己说了不算。
    itemExtras: extrasList(raw.itemExtras ?? raw.item_extra),
  };
}

export function loadTxs() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY_TX) ?? '[]');
    return Array.isArray(list) ? list.filter((r) => r && r.id).map(revive) : [];
  } catch {
    return [];
  }
}

// 🔴 级联清空只在这一处定义（与 Dart 侧 `Tx.toMap()` 同一条纪律，docs/29 §2.1）：
// 没有物品名就没有聚合键、大类与来历，四个一起走。漏掉一次，图上就凭空多出一格「他没买过的东西」。
// `itemNorm` 是 `item` 的函数、不是第二个真源：这里现算，规则改了旧记录也不会留下第三种答案。
// 附属那串（v11 · docs/30 FR-4）也挂在同一个判断上：主物品空 ⇒ 附属空，主物品不空 ⇒ 把与它
// 同名的那条剔掉。Dart 侧这段规则叫 `Tx.goodsExtras`，两处各写一遍就会有一处先漂。
function cascade(t) {
  const item = (t.item ?? '').trim();
  if (item === '') {
    return { ...t, item: '', itemNorm: '', goodsCat: '', itemSrc: '', itemExtras: [] };
  }
  const norm = goodsNorm(item);
  return {
    ...t,
    item,
    itemNorm: norm,
    itemExtras: [...new Set(extrasList(t.itemExtras).filter((n) => n !== norm))].sort(),
  };
}

// 备份里的物品三件套是**外部输入**，处置与 backup.dart 逐条相同：
// 陌生大类退回兜底（图上不许出现第 15 类）、来历认不出来就置空（不许冒充他本人改的）、
// 空物品的另外两栏一律清空。聚合键照旧现算，不读文件里那一份。
// v5 的 item_extra（docs/30 FR-4）：文件里那一串是聚合键数组，原样收下；
// 「主物品空不空」这一刀不在这里判，cascade 一处说了算（与 Dart 的 Tx.goodsExtras 同一口径）。
function goodsFromBackup(e) {
  const item = String(e.item ?? '').trim();
  if (item === '') return { item: '', itemNorm: '', goodsCat: '', itemSrc: '', itemExtras: [] };
  const cat = String(e.goods_cat ?? '').trim();
  const src = String(e.item_src ?? '').trim();
  return {
    item,
    itemNorm: goodsNorm(item),
    goodsCat: goodsCategoryNames().includes(cat) ? cat : GOODS_OTHER.name,
    itemSrc: ITEM_SRCS.has(src) ? src : '',
    itemExtras: extrasList(e.item_extra),
  };
}

function saveTxs(txs) {
  const clean = txs.map(cascade);
  localStorage.setItem(KEY_TX, JSON.stringify(clean.map((t) => ({ ...t, occurredAt: t.occurredAt.toISOString() }))));
  // 返回归一后的那份：内存里那份才是页面上渲染的那份，两边不一致就等于账本说谎
  return clean;
}

function nextId(txs) {
  return txs.reduce((a, t) => Math.max(a, t.id || 0), Date.now());
}

export function addTx(txs, t) {
  const row = { ...t, id: nextId(txs) + 1 };
  return saveTxs([...txs, row]);
}

export function updateTx(txs, row) {
  return saveTxs(txs.map((t) => (t.id === row.id ? { ...t, ...row } : t)));
}

export function removeTx(txs, id) {
  const removed = txs.find((t) => t.id === id);
  return { txs: saveTxs(txs.filter((t) => t.id !== id)), removed };
}

export function restoreTx(txs, removed) {
  if (!removed) return txs;
  return saveTxs([...txs, removed]);
}

// ---- 备份保鲜（网页版没有服务端：丢了账本，唯一能救回来的就是用户自己导出的那份）----
export const BACKUP_STALE_DAYS = 7;

// 返回 null = 不提醒；否则 {days, text}。判定不放界面层，是为了让它可被闸门校验
export function backupNudge(meta, txCount, now) {
  if (txCount <= 0) return null;
  const last = parseLocalTime(meta.lastExportAt ?? '');
  if (!last) return { days: null, text: '账本只存在这台设备的浏览器里，导出一次才算有备份' };
  const days = Math.floor((now.getTime() - last.getTime()) / 86400000);
  if (days < BACKUP_STALE_DAYS) return null;
  return { days, text: `已经 ${days} 天没导出备份了，浏览器一清缓存这些账就全没` };
}

// ---- 设置（月度预算、月收入、语音开关、上次备份时间）----
export function loadMeta() {
  try {
    return JSON.parse(localStorage.getItem(KEY_META) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export function saveMeta(patch) {
  const next = { ...loadMeta(), ...patch };
  localStorage.setItem(KEY_META, JSON.stringify(next));
  return next;
}

// 只清账本，保留预算/收入等设置
export function clearTxs() {
  localStorage.removeItem(KEY_TX);
}

// ---- 导出：与 App 的 buildJson / buildCsv 同格式 ----
export function buildJson(txs, budgetCents) {
  return JSON.stringify(
    {
      app: '又花钱了',
      // v4（v0.14.0）：每条多了 item / goods_cat / item_src。
      // v5（v0.14.2）：多了 item_extra（docs/30 FR-4，一句里并列说到的其它物品）。
      // 读侧一律按「缺字段＝没记」处理，所以这个号码只是**能力标注**，不是格式门禁。
      // 网页版到这一版仍然不带 categories 段（它没有自定义分类能力），这一点与号码无关，
      // 导入侧本来就按「没有这一段＝没停用过」处理。
      version: 5,
      exported_at: localTime(new Date()),
      budget_cents: budgetCents,
      transactions: txs.map((t) => ({
        type: t.type,
        amount_cents: t.amountCents,
        category: t.category,
        merchant: t.merchant,
        raw: t.raw,
        source: t.source,
        occurred_at: localTime(t.occurredAt),
        // 空物品不写键（同 backup.dart）：写了「item":""」等于把「没记」变成一个值，
        // 覆盖率统计就分不清是他留空还是机器根本没跑。聚合键 item_norm 永远不写——
        // 它是 item 的函数，进文件就是第二个真源。
        // item_extra 相反：那一串不是 item 的函数（第二样叫什么只有他说过才知道），必须写。
        // 形态与 App 逐字相同（聚合键数组、没有附属就不写键），所以两边导出的文件互相贴得回去。
        ...(t.item ? { item: t.item, goods_cat: t.goodsCat, item_src: t.itemSrc } : {}),
        ...(t.itemExtras && t.itemExtras.length ? { item_extra: t.itemExtras } : {}),
      })),
    },
    null,
    2,
  );
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(txs) {
  const rows = [
    ['类型', '金额(元)', '分类', '商户', '原始语句', '来源', '时间'],
    ...txs.map((t) => [
      t.type === 'expense' ? '支出' : t.type === 'income' ? '收入' : '退款',
      (t.amountCents / 100).toFixed(2),
      t.category,
      t.merchant,
      t.raw,
      t.source,
      localTime(t.occurredAt),
    ]),
  ];
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// ---- 导入：容忍多余字段与毫秒格式，坏行跳过（同 App 的 parseImportJson 口径）----
export function parseImportJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON 文本');
  }
  const list = Array.isArray(data)
    ? data
    : data && Array.isArray(data.transactions)
      ? data.transactions
      : null;
  if (!list) throw new Error('找不到 transactions 列表，请粘贴本 App 导出的 JSON');
  const out = [];
  let skipped = 0;
  for (const e of list.filter((x) => x && typeof x === 'object')) {
    const cents =
      typeof e.amount_cents === 'number' ? Math.round(e.amount_cents) : parseInt(String(e.amount_cents ?? ''), 10);
    const when = typeof e.occurred_at === 'string' ? parseLocalTime(e.occurred_at) : null;
    const type = e.type;
    if (!Number.isFinite(cents) || cents <= 0 || !when) {
      skipped++;
      continue;
    }
    if (type !== 'expense' && type !== 'income' && type !== 'refund') {
      skipped++;
      continue;
    }
    out.push({
      type,
      amountCents: cents,
      category: (e.category ?? '其他').trim() || '其他',
      merchant: (e.merchant ?? '').trim(),
      raw: e.raw ?? '',
      source: e.source ?? 'import',
      occurredAt: when,
      ...goodsFromBackup(e),
    });
  }
  return { rows: out, skipped };
}

export function importTxs(txs, rows) {
  // 同一笔（同时刻+同金额+同类型+同商户）不重复入
  const seen = new Set(txs.map((t) => `${t.occurredAt.getTime()}|${t.amountCents}|${t.type}|${t.merchant}`));
  let added = 0;
  let next = txs;
  for (const r of rows) {
    const key = `${r.occurredAt.getTime()}|${r.amountCents}|${r.type}|${r.merchant}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next = addTx(next, r);
    added++;
  }
  return { txs: next, added };
}

// ---- 这台设备「学过」什么：网页版没有 goods_learning 表，学习信号从账本现算 ----
// App 侧那张表是持久化的（账删了意图还在），网页版只在账还在时认得出——这一点如实写在这里，
// 而不是伪装成两边等价。裁决函数复用 `goodsCatPick`，平手次序与 App 同一个答案。
export function goodsKnownItems(txs) {
  const byNorm = new Map();
  for (const t of txs) {
    if (!t.item) continue;
    const n = t.itemNorm || goodsNorm(t.item);
    if (!byNorm.has(n)) byNorm.set(n, t.item);
  }
  return [...byNorm.values()].filter((n) => [...n].length >= 2)
    .sort((a, b) => [...b].length - [...a].length);
}

export function goodsCatSuggestions(txs) {
  const tally = {};
  for (const t of txs) {
    if (!t.item || !t.goodsCat) continue;
    const n = t.itemNorm || goodsNorm(t.item);
    const cell = (tally[n] ??= {});
    const cur = cell[t.goodsCat] ?? { uses: 0, over: false };
    // 只有他亲手改过的那笔算 user_override：机器的 lexicon/learned 来源不该把自己的猜测记成他的判断
    cell[t.goodsCat] = { uses: cur.uses + 1, over: cur.over || t.itemSrc === 'manual' };
  }
  const out = {};
  for (const [n, byCat] of Object.entries(tally)) {
    const pick = goodsCatPick(byCat);
    if (pick) out[n] = pick;
  }
  return out;
}
