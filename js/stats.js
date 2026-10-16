// 统计与预算口径 —— 1:1 移植自 app/lib/core/stats.dart + ui/pages.dart 的红绿灯段
// 支出=仅 expense；净支出=expense−refund；收入=仅 income。金额全程存分。
// 红绿灯的档位那一刀不在这里判，改走 budget.js 的 `budgetLevel`（与分类告警共用同一个函数）——
// 网页版从前自己写了一套浮点比较（>1 红 / ≥0.8 黄），「花的刚好等于预算」那一笔两端会打脸：
// 页面说黄、App 说超支。档位号与颜色都由 budgetLevel 一处产出，这里只做颜色翻译。
import { moneyOf } from './money.js';
import { subsOf } from './taxonomy.js';
import { budgetLevel } from './budget.js';

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
    // 判据走 scopeDelta 那一处，不在这里重写一遍「退款取负、收入跳过」
    const v = scopeDelta(t, s);
    if (v == null) continue;
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

// 记账页红绿灯（ui/pages.dart 同口径）：档位取 budgetLevel，100 ⇒ over、null ⇒ ok、其余 ⇒ warn。
// 日均按剩下的日子平摊；shownLeft 那一格与 App 同一条夹逼（既不报负数、也不报超过预算的余额）。
export function trafficLight(budgetCents, monthNetCents, now, warnPct) {
  const level = budgetLevel(monthNetCents, budgetCents, warnPct ?? 80);
  const pct = budgetCents > 0 ? monthNetCents / budgetCents : 0;
  const left = budgetCents - monthNetCents;
  const daysLeft = daysInMonth(now) - now.getDate() + 1;
  const perDay = left > 0 && daysLeft > 0 ? Math.floor(left / daysLeft) : 0;
  const lamp = level === 100 ? 'over' : level == null ? 'ok' : 'warn';
  return {
    pct,
    left,
    daysLeft,
    perDay,
    lamp,
    level,
    shownLeft: Math.max(0, Math.min(left, budgetCents)),
  };
}

// —— v16-S48 网页版多维（docs/16 §五 的二级那一轴）：以下三段与 stats.dart 逐条同判据 ——

/// 一笔在某个口径里贡献多少钱；null = 这一笔不参与。
/// 🔴 口径的唯一定义处：一级榜 catRows 与二级榜 subRows 都走这里（同 Dart 那句理由——
/// 两处各写一遍「退款取负、收入跳过」，就会出现「一级对得上、二级加不上一级的钱」）。
export function scopeDelta(t, s) {
  if (s === SCOPE.income) return t.type === 'income' ? t.amountCents : null;
  if (s === SCOPE.expense) return t.type === 'expense' ? t.amountCents : null;
  if (t.type === 'income') return null;
  return t.type === 'expense' ? t.amountCents : -t.amountCents;
}

/// 没记二级的账在二级榜上的名字（同 Dart `subUnsetLabel`）。
/// 这一格必须看得见，否则「一级 ¥500、二级加起来 ¥320」那种缺口就凭空消失了。
export const SUB_UNSET_LABEL = '未细分';

/// 二级维度：只有「这个名字确实挂在这一笔那个一级底下」才算数。
/// 空串、别的树的名字、同树却挂在别的一级底下（迁移或手改库留下的残值）统统落「未细分」——
/// 宁可少一格，也不把金额记到一盏他没选过的标签上。
/// `custom` 传进来时自定义那几格也算数（与 taxonomy 的裁决同一处，不在这里另判）。
export function subDim(t, custom) {
  const sub = t.subCategory ?? '';
  if (sub === '') return SUB_UNSET_LABEL;
  const kin = subsOf(t.type, t.category, custom);
  return kin.some((e) => e.name === sub) ? sub : SUB_UNSET_LABEL;
}

/// 某个一级之下按二级拆开的金额，降序。`top` 必填：二级名字只在自己那一棵里有定义，
/// 把两棵树的同名二级并成一行，就是「收入复用支出分类」那一族缺陷换个方向重演。
/// 🔴 与 catRows 唯一不一样：这里**不剔除非正数那一格**（一级净 ¥3.00 可能是「饮品 ¥5 − 正餐 ¥2」
/// 凑出来的，丢掉负的那格，那一排 chip 加起来会比它挂的那一行还多）。
export function subRows(txs, s, top, custom) {
  const out = {};
  for (const t of txs) {
    if (t.category !== top) continue;
    const d = scopeDelta(t, s);
    if (d == null) continue;
    const sub = subDim(t, custom);
    out[sub] = (out[sub] ?? 0) + d;
  }
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
}

