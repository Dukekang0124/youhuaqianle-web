// 财务口径唯一真源的 JS 版 —— 1:1 移植自 app/lib/core/money.dart
// 净支出 = 支出 − 退款；收入独立展示，不与支出混算。
export function moneyOf(txs) {
  let e = 0, r = 0, i = 0;
  for (const t of txs) {
    if (t.type === 'expense') e += t.amountCents;
    else if (t.type === 'refund') r += t.amountCents;
    else if (t.type === 'income') i += t.amountCents;
  }
  return { expense: e, refund: r, income: i, net: e - r, empty: e === 0 && r === 0 && i === 0 };
}

export function centsStr(cents) {
  const s = (cents / 100).toFixed(2);
  return s.endsWith('.00') ? s.slice(0, -3) : s;
}

// 分类净额（退款抵扣原分类）
export function netByCategory(txs) {
  const out = {};
  for (const t of txs) {
    if (t.type === 'income') continue;
    const delta = t.type === 'expense' ? t.amountCents : -t.amountCents;
    out[t.category] = (out[t.category] ?? 0) + delta;
  }
  return out;
}

// 连续记账天数（今日或昨天起算，断一天归零；今天没记不清零）
export function recordStreak(txs, now) {
  const days = new Set();
  for (const t of txs) {
    if (t.type === 'income') continue;
    days.add(new Date(t.occurredAt.getFullYear(), t.occurredAt.getMonth(), t.occurredAt.getDate()).getTime());
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86400000;
  let cursor = days.has(today) ? today : days.has(today - DAY) ? today - DAY : null;
  if (cursor === null) return 0;
  let n = 0;
  while (cursor !== null && days.has(cursor)) {
    n++;
    const d = new Date(cursor);
    cursor = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
  }
  return n;
}
