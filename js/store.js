// 网页版本地账本：localStorage 真源，金额存分，零外发（页面上没有任何一条请求会带账本数据）
// 导入/导出格式与 App 的 JSON v2 对齐（app/lib/core/backup.dart），所以手机导出来的账本能直接贴进这里。
const KEY_TX = 'yhq.web.txs.v1';
const KEY_META = 'yhq.web.meta.v1';

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

function saveTxs(txs) {
  localStorage.setItem(KEY_TX, JSON.stringify(txs.map((t) => ({ ...t, occurredAt: t.occurredAt.toISOString() }))));
}

function nextId(txs) {
  return txs.reduce((a, t) => Math.max(a, t.id || 0), Date.now());
}

export function addTx(txs, t) {
  const row = { ...t, id: nextId(txs) + 1 };
  const out = [...txs, row];
  saveTxs(out);
  return out;
}

export function updateTx(txs, row) {
  const out = txs.map((t) => (t.id === row.id ? { ...t, ...row } : t));
  saveTxs(out);
  return out;
}

export function removeTx(txs, id) {
  const removed = txs.find((t) => t.id === id);
  const out = txs.filter((t) => t.id !== id);
  saveTxs(out);
  return { txs: out, removed };
}

export function restoreTx(txs, removed) {
  if (!removed) return txs;
  const out = [...txs, removed];
  saveTxs(out);
  return out;
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
      version: 2,
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
