// 明细筛选/搜索的纯模型 —— 1:1 移植自 app/lib/core/filters.dart。
// 改这里必须同步改 Dart 那一份，`tools/web-parity.mjs` 第⑩块钉的是「双端同一条筛子同一个答案」。
//
// 为什么筛子要单独成一个文件而不是写在 app.js 里：网页版那条硬规矩是「app.js 不许算钱、
// 不许自己判口径」。筛选也一样——它决定屏幕上出现哪几笔，两边各写一遍就会出现
// 「手机上是 12 笔、网页上是 14 笔」，而那种差在界面上只是角上一个小数字。
import { netByCategory } from './money.js';

/// 一笔账「怎么进来的」全部取值（与 Dart `txSources` 同一张表，顺序也算口径：
/// 界面上按这个顺序列 chip，换顺序就是在改用户看见的东西）
export const TX_SOURCES = ['voice', 'ai', 'text', 'manual', 'import'];
export const DEFAULT_TX_SOURCE = 'manual';

/// 备份是外部输入：不认识的值 ⇒ 回落 manual，不猜（照 Dart `txSourceOf`）。
export function txSourceOf(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return TX_SOURCES.includes(s) ? s : DEFAULT_TX_SOURCE;
}

export function typeLabel(t) {
  return t === 'expense' ? '支出' : t === 'income' ? '收入' : t === 'refund' ? '退款' : '全部';
}

export function sourceLabel(s) {
  return s === 'voice'
    ? '语音'
    : s === 'ai'
      ? 'AI'
      : s === 'text'
        ? '文字'
        : s === 'manual'
          ? '手动'
          : s === 'import'
            ? '导入'
            : s;
}

// Dart 的 `~/` 在这一格只用来把分转成元，进这里的数恒非负，所以 Math.floor 与它同答案。
const yuanFloor = (cents) => Math.floor(cents / 100);

export class TxFilters {
  constructor() {
    this.cats = new Set(); // 多选一级，空=全部
    this.subs = new Set(); // 多选二级，空=全部；空串那笔永远不算命中（见 matches）
    this.type = '';
    this.merchant = '';
    this.minCents = 0; // 0=不限
    this.maxCents = 0;
    this.start = null; // [start, end) 右开
    this.end = null;
    this.sources = new Set();
    this.query = '';
    this.sort = 'time';
  }

  static copy(o) {
    const n = new TxFilters();
    n.cats = new Set(o.cats);
    n.subs = new Set(o.subs);
    n.type = o.type;
    n.merchant = o.merchant;
    n.minCents = o.minCents;
    n.maxCents = o.maxCents;
    n.start = o.start;
    n.end = o.end;
    n.sources = new Set(o.sources);
    n.query = o.query;
    n.sort = o.sort;
    return n;
  }

  // 🔴 与 Dart 逐条同判据的一条「有没有条件」：这里**只看 start，不看 end**。
  // 不是漏写——只填了结束日（往回看到某天）在 App 上不算「加了条件」，
  // 网页版要是多认一个 end，同一份账两端会出现一屏「清除筛选」按钮、另一屏没有。
  get hasCondition() {
    return (
      this.cats.size > 0 ||
      this.subs.size > 0 ||
      this.type !== '' ||
      this.merchant !== '' ||
      this.minCents > 0 ||
      this.maxCents > 0 ||
      this.start != null ||
      this.sources.size > 0 ||
      this.query !== ''
    );
  }

  matches(t) {
    if (this.cats.size && !this.cats.has(t.category ?? '')) return false;
    // 按二级筛时，没记二级的账（空串）不出现：它确实不是那一格的账。
    // 「未细分」那一行是 subRows 给的合计，不是一把可点的筛子——所以这里不认空串。
    if (this.subs.size && !this.subs.has(t.subCategory ?? '')) return false;
    if (this.type !== '' && t.type !== this.type) return false;
    if (this.merchant !== '' && !(t.merchant ?? '').includes(this.merchant)) return false;
    if (this.minCents > 0 && t.amountCents < this.minCents) return false;
    if (this.maxCents > 0 && t.amountCents > this.maxCents) return false;
    const at = t.occurredAt;
    if (this.start != null && at < this.start) return false;
    if (this.end != null && !(at < this.end)) return false;
    if (this.sources.size && !this.sources.has(t.source)) return false;
    if (this.query !== '') {
      const q = this.query.toLowerCase();
      if (!(t.merchant ?? '').toLowerCase().includes(q) && !(t.raw ?? '').toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  }

  apply(src) {
    const out = src.filter((t) => this.matches(t));
    if (this.sort === 'amount_desc') out.sort((a, b) => b.amountCents - a.amountCents);
    else if (this.sort === 'amount_asc') out.sort((a, b) => a.amountCents - b.amountCents);
    else out.sort((a, b) => b.occurredAt - a.occurredAt);
    return out;
  }

  // 顶部条件 chips：[key, 文案]，key 供逐个移除。顺序即 Dart chips() 的顺序。
  chips() {
    const out = [];
    if (this.cats.size) out.push(['cats', '分类:' + [...this.cats].join('/')]);
    if (this.subs.size) out.push(['subs', '二级:' + [...this.subs].join('/')]);
    if (this.type !== '') out.push(['type', typeLabel(this.type)]);
    if (this.merchant !== '') out.push(['merchant', '商户~' + this.merchant]);
    if (this.minCents > 0 || this.maxCents > 0) {
      out.push([
        'amount',
        '¥' + yuanFloor(this.minCents) + '–' + (this.maxCents > 0 ? yuanFloor(this.maxCents) : '不限'),
      ]);
    }
    if (this.start != null) {
      const s = this.start;
      const tail =
        this.end == null
          ? '…'
          : `${this.end.getMonth() + 1}/${this.end.getDate() - 1}`;
      out.push(['period', `${s.getMonth() + 1}/${s.getDate()}–${tail}`]);
    }
    if (this.sources.size) out.push(['sources', '来源:' + [...this.sources].map(sourceLabel).join('/')]);
    if (this.query !== '') out.push(['query', '搜:' + this.query]);
    return out;
  }

  remove(key) {
    switch (key) {
      case 'cats':
        this.cats = new Set();
        break;
      case 'subs':
        this.subs = new Set();
        break;
      case 'type':
        this.type = '';
        break;
      case 'merchant':
        this.merchant = '';
        break;
      case 'amount':
        this.minCents = 0;
        this.maxCents = 0;
        break;
      case 'period':
        this.start = null;
        this.end = null;
        break;
      case 'sources':
        this.sources = new Set();
        break;
      case 'query':
        this.query = '';
        break;
    }
  }

  clearAll() {
    this.cats = new Set();
    this.subs = new Set();
    this.type = '';
    this.merchant = '';
    this.minCents = 0;
    this.maxCents = 0;
    this.start = null;
    this.end = null;
    this.sources = new Set();
    this.query = '';
    // 排序偏好留着（同 Dart `clearAll`：那是视图，不是条件）
  }
}

/// 「只看钱进来那一族、窗口取 [from, to)」这一条口径的唯一落点（同 Dart `_incomeIn`）。
function incomeIn(from, to) {
  const f = new TxFilters();
  f.type = 'income';
  f.start = from;
  f.end = to;
  return f;
}

export function incomeOfDay(day) {
  return incomeIn(
    new Date(day.getFullYear(), day.getMonth(), day.getDate()),
    new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1),
  );
}

export function incomeOfMonth(day) {
  return incomeIn(
    new Date(day.getFullYear(), day.getMonth(), 1),
    new Date(day.getFullYear(), day.getMonth() + 1, 1),
  );
}

/// 筛后合计走 money.js 那一处，不在这里另开一份算钱的口径。
export function filteredNet(txs, f) {
  return netByCategory(f.apply(txs));
}
