// 统计与预算口径 —— 1:1 移植自 app/lib/core/stats.dart + ui/pages.dart 的红绿灯段
// 支出=仅 expense；净支出=expense−refund；收入=仅 income。金额全程存分。
import { moneyOf } from './money.js';

export const PERIOD = { week: 'week', month: 'month', year: 'year' };
export const SCOPE = { expense: 'expense', net: 'net', income: 'income' };

const DAY = 86400000;

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// [start, end)；周从周一起算
export function periodRange(p, now) {
  if (p === PERIOD.week) {
    const monday = new Date(startOfDay(now).getTime() - ((now.getDay() + 6) % 7) * DAY);
    return [monday, new Date(monday.getTime() + 7 * DAY)];
  }
  if (p === PERIOD.month) {
    return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)];
  }
  return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1)];
}

export function previousRange(p, now) {
  const [start] = periodRange(p, now);
  if (p === PERIOD.week) return [new Date(start.getTime() - 7 * DAY), start];
  if (p === PERIOD.month) return [new Date(start.getFullYear(), start.getMonth() - 1, 1), start];
  return [new Date(start.getFullYear() - 1, 0, 1), start];
}

function inRange(t, start, end) {
  const ts = t.occurredAt.getTime();
  return ts >= start.getTime() && ts < end.getTime();
}

export function txsInPeriod(txs, start, end) {
  return txs.filter((t) => inRange(t, start, end));
}

// 当期已过天数/月数（日均分母：不拿还没到的日子摊薄）
export function elapsedUnits(p, now) {
  if (p === PERIOD.week) return Math.floor((now.getTime() - startOfDay(now).getTime()) / DAY) + 1;
  if (p === PERIOD.month) return now.getDate();
  return Math.floor((startOfDay(now).getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / DAY) + 1;
}

export function scopeTotal(m, s) {
  return s === SCOPE.expense ? m.expense : s === SCOPE.income ? m.income : m.net;
}

export function scopeOf(t, s) {
  if (s === SCOPE.expense) return t.type === 'expense' ? t.amountCents : 0;
  if (s === SCOPE.income) return t.type === 'income' ? t.amountCents : 0;
  if (t.type === 'income') return 0;
  return t.type === 'expense' ? t.amountCents : -t.amountCents;
}

export function catRows(txs, s) {
  const out = {};
  for (const t of txs) {
    const v = scopeOf(t, s);
    if (s === SCOPE.expense && t.type !== 'expense') continue;
    if (s === SCOPE.income && t.type !== 'income') continue;
    if (s === SCOPE.net && t.type === 'income') continue;
    out[t.category] = (out[t.category] ?? 0) + v;
  }
  return Object.entries(out)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
}

// 环形图 >6 类时前 5 + 「其他」合并
export function mergeTopRows(rows, keep = 5) {
  if (rows.length <= keep + 1) return rows;
  const head = rows.slice(0, keep);
  let rest = 0;
  for (const e of rows.slice(keep)) rest += e[1];
  head.push(['其他', rest]);
  return head;
}

export function merchantTop(txs, s, limit = 10) {
  const agg = {};
  for (const t of txs) {
    const name = t.merchant || '未备注';
    if (s === SCOPE.expense && t.type !== 'expense') continue;
    if (s === SCOPE.income && t.type !== 'income') continue;
    if (s === SCOPE.net && t.type === 'income') continue;
    const delta = s === SCOPE.net ? (t.type === 'expense' ? t.amountCents : -t.amountCents) : t.amountCents;
    const cur = agg[name] ?? { cents: 0, count: 0 };
    agg[name] = { cents: cur.cents + delta, count: cur.count + 1 };
  }
  return Object.entries(agg)
    .filter(([, v]) => v.cents > 0)
    .map(([name, v]) => ({ name, cents: v.cents, count: v.count }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, limit);
}

export function seriesPoints(txs, p, s, now) {
  const [start] = periodRange(p, now);
  const val = (a, b) => scopeTotal(moneyOf(txsInPeriod(txs, a, b)), s);
  if (p === PERIOD.week) {
    return Array.from({ length: 7 }, (_, i) =>
      val(new Date(start.getTime() + i * DAY), new Date(start.getTime() + (i + 1) * DAY)));
  }
  if (p === PERIOD.month) {
    return Array.from({ length: daysInMonth(start) }, (_, i) =>
      val(new Date(start.getFullYear(), start.getMonth(), i + 1), new Date(start.getFullYear(), start.getMonth(), i + 2)));
  }
  return Array.from({ length: 12 }, (_, m) =>
    val(new Date(start.getFullYear(), m, 1), new Date(start.getFullYear(), m + 1, 1)));
}

export function highlightIndex(p, now) {
  if (p === PERIOD.week) return (now.getDay() + 6) % 7;
  if (p === PERIOD.month) return now.getDate() - 1;
  return now.getMonth();
}

// 月热力：按日聚合口径金额，key=日（1 起）
export function dailyHeat(txs, month, s) {
  const out = {};
  for (const t of txs) {
    if (t.occurredAt.getFullYear() !== month.getFullYear() || t.occurredAt.getMonth() !== month.getMonth()) continue;
    out[t.occurredAt.getDate()] = (out[t.occurredAt.getDate()] ?? 0) + scopeOf(t, s);
  }
  for (const [k, v] of Object.entries(out)) if (v <= 0) delete out[k];
  return out;
}

// 5 档着色：0 无记录 / 1-4 按最大值四分
export function heatBucket(cents, maxCents) {
  if (cents <= 0 || maxCents <= 0) return 0;
  const q = maxCents / 4;
  return Math.min(4, Math.max(1, Math.ceil(cents / q)));
}

// 环比：上期为 0 时返回 null（显示「—」）
export function periodOverPeriod(curCents, prevCents) {
  return prevCents <= 0 ? null : Math.round(((curCents - prevCents) * 100) / prevCents);
}

// 记账页红绿灯（ui/pages.dart 同口径）：>100% 红、≥80% 黄、其余绿；日均按剩下的日子平摊
export function trafficLight(budgetCents, monthNetCents, now) {
  const pct = budgetCents > 0 ? monthNetCents / budgetCents : 0;
  const left = budgetCents - monthNetCents;
  const daysLeft = daysInMonth(now) - now.getDate() + 1;
  const perDay = left > 0 && daysLeft > 0 ? Math.floor(left / daysLeft) : 0;
  const lamp = pct > 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok';
  return { pct, left, daysLeft, perDay, lamp, shownLeft: Math.max(0, Math.min(left, budgetCents)) };
}
