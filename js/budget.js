// 分类预算档位判定 —— 1:1 移植自 app/lib/core/budget.dart。
// 档位判据只有这一处（同 Dart 那句「源头锁」）：网页版的红绿灯与告警共用它，
// 避免出现「页面说安全、通知说超了」。
import { netByCategory } from './money.js';

/// 黄档那条线的默认值。App 上面板可以把它调成别的数（那一格的真源在 `alert_rules.dart`），
/// 网页版目前没有那条面板，所以这里恒取默认值——这一条口径差如实登记，不伪装成两端等价。
export const BUDGET_WARN_PCT = 80;

/// 档位判据：达预算 100 档，达 warnPct% 预警档，都没到返回 null。
/// 用整数交叉相乘而不是 spent/budget 的浮点比较——分位数大时 0.8 的舍入会把差一分到线的账判错档。
/// 返回的是那条线本身而不是符号 80，因为界面要把档位号画出来（面板写 90%、返回 80 就是当着人念回旧数）。
export function budgetLevel(spentCents, budgetCents, warnPct = BUDGET_WARN_PCT) {
  if (budgetCents <= 0 || spentCents <= 0) return null;
  if (spentCents >= budgetCents) return 100;
  return spentCents * 100 >= budgetCents * warnPct ? warnPct : null;
}

/// 一条告警。字段与 Dart `BudgetAlert` 同形（spentCents 是净额，含退款抵扣后的那一份）。
export class BudgetAlert {
  constructor(category, spentCents, budgetCents, level, count, txIds = []) {
    this.category = category;
    this.spentCents = spentCents;
    this.budgetCents = budgetCents;
    this.level = level;
    this.count = count;
    this.txIds = txIds;
  }

  dedupeKey(now) {
    return `notified_${now.getFullYear()}-${now.getMonth() + 1}_${this.category}_${this.level}`;
  }
}

/// 当月每条分类预算的档位。口径与 Dart `budgetAlertsForMonth` 逐条相同：
/// ① 只取「now 那一年那一月」的账；② spent 走 netByCategory 那一处（退款抵扣原分类）；
/// ③ 笔数只数支出（「按均价还够几次」的"次"是一次消费），证据把退款一起带上；
/// ④ 预算 ≤0 跳过（设 0 就是移除）、spent ≤0 跳过；⑤ 输出按分类名排序（两端列表同序）。
export function budgetAlertsForMonth(budgetCats, txs, now, warnPct = BUDGET_WARN_PCT) {
  const keys = Object.keys(budgetCats ?? {});
  if (keys.length === 0) return [];
  const month = txs.filter(
    (e) => e.occurredAt.getFullYear() === now.getFullYear() && e.occurredAt.getMonth() === now.getMonth(),
  );
  const spent = netByCategory(month);
  const counts = {};
  const ids = {};
  for (const e of month) {
    if (e.type === 'income') continue;
    if (e.type === 'expense') counts[e.category] = (counts[e.category] ?? 0) + 1;
    if (e.id != null) (ids[e.category] ??= []).push(e.id);
  }
  const out = [];
  for (const key of keys.slice().sort()) {
    const budgetCents = budgetCats[key] ?? 0;
    if (budgetCents <= 0) continue;
    const s = spent[key] ?? 0;
    if (s <= 0) continue;
    const level = budgetLevel(s, budgetCents, warnPct);
    if (level == null) continue;
    out.push(new BudgetAlert(key, s, budgetCents, level, counts[key] ?? 0, [...(ids[key] ?? [])]));
  }
  return out;
}

/// 红绿灯三色（网页版今日页那一格）：100 ⇒ 红、null ⇒ 绿、其余 ⇒ 黄。
/// 与 App `ui/pages.dart` 同一个映射；档位号仍由 budgetLevel 一处产出，这里只做颜色翻译。
export function budgetLampColor(level) {
  return level === 100 ? 'red' : level == null ? 'green' : 'yellow';
}
