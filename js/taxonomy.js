// 三套分类体系（支出/收入/退款）的**树**——表体由 tools/taxonomy-js.mjs 从
// app/lib/core/category_taxonomy.dart 生成（生成时实抽：income 7 一级 / 21 二级，refund 5 一级 / 10 二级），**不要手改表体**；
// 改了 Dart 就重跑生成器，别在这里对着改。
//
// 与 lexicon.js 的分工照搬 App 侧那条纪律：`CATEGORIES` 是**平表**（一级名字 + 关键词，
// 闸门 4 拿它和 Dart 逐字比对），这里只声明「名字挂在哪一棵、哪一格下面，以及二级各自的词」。
// 支出树的一级不在这张表里，它就是 CATEGORIES 去掉「工资」（收入）和「其他」（兜底）那些行。
//
// 下面那组函数是手写的口径镜像：改这里必须同步改 Dart 的 category_taxonomy.dart，
// 而 `tools/web-parity.mjs` 第⑨块钉的是「双端判类逐条同答案」——口径写歪了会红在那儿。
import { CATEGORIES } from './lexicon.js';

export const KIND_EXPENSE = 'expense';
export const KIND_INCOME = 'income';
export const KIND_REFUND = 'refund';
export const TX_KINDS = [KIND_EXPENSE, KIND_INCOME, KIND_REFUND];

// 每套体系的兜底分类。支出那一格故意沿用旧名「其他」（全仓拿它当「还没归好类」的判点），
// 收入/退款是新树，用各自的名字——与 Dart 的 kindFallback 同一份定义。
export const KIND_FALLBACK = {
  "expense": "其他",
  "income": "其他收入",
  "refund": "其他退款",

};

// lexicon 平表里那些名字的归属；没列出来的默认支出树。
export const LEXICON_OWNER = {
  "工资": "income",

};

export const BUILTIN_TAXONOMY = [
  { kind: "income", name: "工资", emoji: "💰", parent: "", words: [] },
  { kind: "income", name: "月薪", emoji: "💵", parent: "工资", words: ["月薪", "工资", "发薪"] },
  { kind: "income", name: "加班费", emoji: "⏰", parent: "工资", words: ["加班费"] },
  { kind: "income", name: "补贴津贴", emoji: "🪙", parent: "工资", words: ["补贴", "津贴"] },
  { kind: "income", name: "十三薪", emoji: "🗓", parent: "工资", words: ["十三薪"] },
  { kind: "income", name: "奖金", emoji: "🏆", parent: "", words: [] },
  { kind: "income", name: "年终奖", emoji: "🎊", parent: "奖金", words: ["年终奖"] },
  { kind: "income", name: "绩效奖", emoji: "📊", parent: "奖金", words: ["绩效", "绩效奖金"] },
  { kind: "income", name: "提成", emoji: "🧮", parent: "奖金", words: ["提成"] },
  { kind: "income", name: "项目奖", emoji: "📊", parent: "奖金", words: ["项目奖"] },
  { kind: "income", name: "报销", emoji: "🧾", parent: "", words: [] },
  { kind: "income", name: "差旅报销", emoji: "✈", parent: "报销", words: ["差旅报销"] },
  { kind: "income", name: "医药报销", emoji: "💊", parent: "报销", words: ["报销医药费"] },
  { kind: "income", name: "日常报销", emoji: "📎", parent: "报销", words: ["报销"] },
  { kind: "income", name: "副业", emoji: "🛠", parent: "", words: [] },
  { kind: "income", name: "私单外包", emoji: "💼", parent: "副业", words: ["私单", "外包"] },
  { kind: "income", name: "平台接单", emoji: "📱", parent: "副业", words: ["接单"] },
  { kind: "income", name: "内容创作", emoji: "✍", parent: "副业", words: ["稿费", "打赏"] },
  { kind: "income", name: "投资理财", emoji: "📈", parent: "", words: [] },
  { kind: "income", name: "股息分红", emoji: "🏦", parent: "投资理财", words: ["分红", "股息"] },
  { kind: "income", name: "基金收益", emoji: "📈", parent: "投资理财", words: ["基金赚"] },
  { kind: "income", name: "利息", emoji: "🪙", parent: "投资理财", words: ["利息"] },
  { kind: "income", name: "理财赎回", emoji: "🧊", parent: "投资理财", words: ["赎回"] },
  { kind: "income", name: "收礼红包", emoji: "🧧", parent: "", words: [] },
  { kind: "income", name: "亲友红包", emoji: "🧧", parent: "收礼红包", words: ["收到红包", "红包给我"] },
  { kind: "income", name: "节日红包", emoji: "🎆", parent: "收礼红包", words: ["压岁钱"] },
  { kind: "income", name: "份子钱收回", emoji: "💌", parent: "收礼红包", words: ["随礼收回"] },
  { kind: "income", name: "其他收入", emoji: "➕", parent: "", words: [] },
  { kind: "refund", name: "商品退款", emoji: "📦", parent: "", words: [] },
  { kind: "refund", name: "电商退款", emoji: "🛒", parent: "商品退款", words: ["淘宝退款", "退了"] },
  { kind: "refund", name: "线下退货", emoji: "🏪", parent: "商品退款", words: ["退货"] },
  { kind: "refund", name: "代购退款", emoji: "📮", parent: "商品退款", words: ["代购退"] },
  { kind: "refund", name: "服务退款", emoji: "🔄", parent: "", words: [] },
  { kind: "refund", name: "会员退费", emoji: "🎫", parent: "服务退款", words: ["会员退"] },
  { kind: "refund", name: "课程退费", emoji: "📚", parent: "服务退款", words: ["课退费", "退课"] },
  { kind: "refund", name: "多扣返还", emoji: "↩", parent: "服务退款", words: ["多扣", "误扣退"] },
  { kind: "refund", name: "押金退回", emoji: "🔑", parent: "", words: [] },
  { kind: "refund", name: "租房押金", emoji: "🏠", parent: "押金退回", words: ["押金退"] },
  { kind: "refund", name: "共享押金", emoji: "🚲", parent: "押金退回", words: ["共享单车押金"] },
  { kind: "refund", name: "差价退还", emoji: "📐", parent: "", words: [] },
  { kind: "refund", name: "价保退差", emoji: "🛡", parent: "差价退还", words: ["价保"] },
  { kind: "refund", name: "优惠返还", emoji: "🎟", parent: "差价退还", words: ["返现"] },
  { kind: "refund", name: "其他退款", emoji: "↩️", parent: "", words: [] },
  { kind: "expense", name: "正餐", emoji: "🍚", parent: "餐饮", words: ["午饭", "晚饭", "食堂"] },
  { kind: "expense", name: "饮品咖啡", emoji: "☕", parent: "餐饮", words: ["奶茶", "咖啡", "拿铁"] },
  { kind: "expense", name: "外卖", emoji: "🛵", parent: "餐饮", words: ["外卖"] },
  { kind: "expense", name: "零食水果", emoji: "🍎", parent: "餐饮", words: ["零食", "水果"] },
  { kind: "expense", name: "聚餐请客", emoji: "🥢", parent: "餐饮", words: ["请客", "聚餐"] },
  { kind: "expense", name: "公共交通", emoji: "🚇", parent: "交通", words: ["地铁", "公交"] },
  { kind: "expense", name: "打车", emoji: "🚕", parent: "交通", words: ["打车", "滴滴"] },
  { kind: "expense", name: "加油充电", emoji: "⛽", parent: "交通", words: ["加油", "充电费"] },
  { kind: "expense", name: "停车过路", emoji: "🅿", parent: "交通", words: ["停车", "过路费"] },
  { kind: "expense", name: "城际出行", emoji: "🚄", parent: "交通", words: ["高铁", "机票"] },
  { kind: "expense", name: "日用百货", emoji: "🧻", parent: "购物", words: ["日用品", "超市"] },
  { kind: "expense", name: "服饰鞋包", emoji: "👕", parent: "购物", words: ["衣服", "鞋", "包"] },
  { kind: "expense", name: "美妆个护", emoji: "🧴", parent: "购物", words: ["化妆品", "洗发水"] },
  { kind: "expense", name: "家电家居", emoji: "🔌", parent: "购物", words: ["家电", "家具"] },
  { kind: "expense", name: "生鲜买菜", emoji: "🥬", parent: "购物", words: ["买菜", "菜市场"] },
  { kind: "expense", name: "电影演出", emoji: "🎬", parent: "娱乐", words: ["电影", "演唱会"] },
  { kind: "expense", name: "游戏充值", emoji: "🎮", parent: "娱乐", words: ["游戏", "充值"] },
  { kind: "expense", name: "运动健身", emoji: "🏸", parent: "娱乐", words: ["健身", "羽毛球"] },
  { kind: "expense", name: "旅游度假", emoji: "🏖", parent: "娱乐", words: ["门票", "旅行"] },
  { kind: "expense", name: "会员订阅", emoji: "🔁", parent: "娱乐", words: ["会员", "订阅"] },
  { kind: "expense", name: "房租", emoji: "🏠", parent: "居住", words: ["房租", "租金"] },
  { kind: "expense", name: "水电燃气", emoji: "💡", parent: "居住", words: ["电费", "水费", "燃气"] },
  { kind: "expense", name: "物业宽带", emoji: "📶", parent: "居住", words: ["物业", "宽带", "话费"] },
  { kind: "expense", name: "装修保洁", emoji: "🧹", parent: "居住", words: ["装修", "保洁"] },
  { kind: "expense", name: "门诊挂号", emoji: "🏥", parent: "医疗", words: ["挂号", "门诊"] },
  { kind: "expense", name: "药品", emoji: "💊", parent: "医疗", words: ["买药", "药"] },
  { kind: "expense", name: "检查体检", emoji: "🩺", parent: "医疗", words: ["体检", "检查"] },
  { kind: "expense", name: "口腔护理", emoji: "🦷", parent: "医疗", words: ["牙", "洗牙"] },
  { kind: "expense", name: "学费培训", emoji: "🎓", parent: "教育", words: ["学费", "培训"] },
  { kind: "expense", name: "书籍课程", emoji: "📖", parent: "教育", words: ["书", "网课"] },
  { kind: "expense", name: "考试认证", emoji: "📝", parent: "教育", words: ["考试", "报名费"] },
  { kind: "expense", name: "兴趣班", emoji: "🎨", parent: "教育", words: ["兴趣班"] },
  { kind: "expense", name: "红包随礼", emoji: "🧧", parent: "人情", words: ["红包", "随礼", "份子钱"] },
  { kind: "expense", name: "礼物", emoji: "🎁", parent: "人情", words: ["礼物", "送礼"] },
  { kind: "expense", name: "请客吃饭", emoji: "🍻", parent: "人情", words: ["请客", "吃饭"] },
  { kind: "expense", name: "孝敬长辈", emoji: "👵", parent: "人情", words: ["孝敬", "给爸妈"] },
  { kind: "expense", name: "手机配件", emoji: "📱", parent: "数码", words: ["手机壳", "充电器"] },
  { kind: "expense", name: "电脑平板", emoji: "💻", parent: "数码", words: ["电脑", "平板"] },
  { kind: "expense", name: "影音设备", emoji: "🎧", parent: "数码", words: ["耳机", "相机"] },
  { kind: "expense", name: "软件服务", emoji: "🧩", parent: "数码", words: ["软件", "云服务"] },

];

// ——以下与 Dart 的 category_taxonomy.dart 手写镜像，改一边必须改另一边——

// 运行时那几格自定义分类（网页版由 store.js 在启动时灌进来；闸门要复现内置答案时传空表）。
// 这是 Dart 侧「categories.dart 的运行时生效表 + treeOf(custom:) 参数」那一套的对应物：
// **不是第二棵真源**——内置那部分永远来自上面生成的表体，这里只挂用户自己建的那几格。
let _custom = [];
export function setRuntimeTaxonomy(custom = []) {
  _custom = (custom || [])
    .filter((t) => t && t.name)
    .map((t) => ({
      kind: TX_KINDS.includes(t.kind) ? t.kind : KIND_EXPENSE,
      name: t.name,
      emoji: t.emoji || '',
      parent: t.parent || '',
      words: [...(t.words || [])],
    }));
  return _custom;
}
export const customTaxons = () => _custom;

// 这个名字属于哪一棵树；自定义名先认（它可能借了一个内置没有的名字），
// 内置名与传进来的自定义名之外的（脏数据）返回 null。
export function ownerOf(name, custom = _custom) {
  for (const t of custom) {
    if (t.name === name) return TX_KINDS.includes(t.kind) ? t.kind : null;
  }
  if (!name) return null;
  if (LEXICON_OWNER[name]) return LEXICON_OWNER[name];
  const t = BUILTIN_TAXONOMY.find((x) => x.name === name);
  if (t) return t.kind;
  if (CATEGORIES.some((c) => c.name === name)) return KIND_EXPENSE;
  return null;
}

// 某棵树的全部节点（一级按界面顺序 + 该树二级 + 自定义那几格），按名字去重、先上来的赢——同 Dart。
// 自定义排在内置一级之后、内置二级之前（Dart 里 addTop 的三次调用就是这个次序）。
export function treeOf(kind, custom = _custom) {
  const tops = [];
  const topNames = new Set();
  const addTop = (t) => {
    if (t.kind === kind && !topNames.has(t.name)) {
      topNames.add(t.name);
      tops.push(t);
    }
  };
  if (kind === KIND_EXPENSE) {
    for (const c of CATEGORIES) {
      if (ownerOf(c.name) === KIND_EXPENSE) {
        addTop({ kind: KIND_EXPENSE, name: c.name, emoji: c.emoji, parent: '', words: [] });
      }
    }
  }
  for (const t of BUILTIN_TAXONOMY) if (!t.parent) addTop(t);
  for (const t of custom) addTop(t);
  return [
    ...tops,
    ...BUILTIN_TAXONOMY.filter(
      (t) => t.kind === kind && t.parent && topNames.has(t.parent)
    ),
  ];
}

// 某棵树的一级列表（同 Dart topsOf）。
export const topsOf = (kind, custom = _custom) =>
  treeOf(kind, custom).filter((t) => !t.parent);

// 某个一级下面的二级列表（没有子分类就返回空表——UI 不许造一个「默认」格子）。
export const subsOf = (kind, parent, custom = _custom) =>
  treeOf(kind, custom).filter((t) => t.parent === parent);

/// 记账卡上那一排一级候选：这棵树的格子，去掉他自己停用过的那些。
/// 全被停用就原样给回——一张没有落点的空卡比多出一格更糟（与 categories.js 兜底同口径）。
export function topsForPicker(kind, disabled = new Set(), custom = _custom) {
  const tops = topsOf(kind, custom);
  const kept = tops.filter((t) => !disabled.has(t.name));
  return kept.length ? kept : tops;
}

/// 二级候选：只在这次选了那个一级之后才出现；全停用了就给空表（一级才是记账的落点）。
export const subsForPicker = (kind, parent, disabled = new Set(), custom = _custom) =>
  subsOf(kind, parent, custom).filter((t) => !disabled.has(t.name));

/// 内置三棵树的全部名字（一级+二级）：「还能不能建这个自定义分类」的判点之一。
export const builtinTaxonNames = () => {
  const s = new Set();
  for (const k of TX_KINDS) for (const t of treeOf(k, [])) s.add(t.name);
  return s;
};

// 这一类能不能出现在这个方向的账上。「禁止收入复用支出分类」的判点只在这里。
// 「其他」只在支出那一格返回 true（它是支出树的兜底），挂到收入/退款那两行就是外来名字。
export function allows(kind, name, custom = _custom) {
  if (!name) return false;
  if (name === KIND_FALLBACK[kind]) return true;
  return ownerOf(name, custom) === kind;
}

// 这个名字挂在哪一棵的哪一个**一级**下面（一级自己返回自己；找不到就把名字当一级返回，
// 同 Dart 的 pathOf().first 那条宽容口径——网页版只需要那一个名字，所以这里不铺全路径）。
export function topOf(kind, name, custom = _custom) {
  let cur = name;
  const seen = new Set();
  for (;;) {
    if (!cur || seen.has(cur)) break;
    seen.add(cur);
    const t = treeOf(kind, custom).find((x) => x.name === cur);
    if (!t) return name;
    if (!t.parent) return t.name;
    cur = t.parent;
  }
  return name;
}
// 一级候选词：**不分方向**那一档（kind 为 null）只给手里没有方向的四处分词处用，
// 判类入账不许用它——那是「一个方向一套词表」这条纪律的落点。
// 自定义那几格的关键词进这张表（v16-S48 起网页版有了自定义分类，判类与 App 同一条：
// App 侧读的是 categories.dart 的运行时生效表，这里读 setRuntimeTaxonomy 灌进来的那一份）。
export function topsWords(kind = null, custom = _custom) {
  const out = [];
  for (const c of CATEGORIES) {
    if (c.name === KIND_FALLBACK[KIND_EXPENSE]) continue;
    if (kind !== null && ownerOf(c.name) !== kind) continue;
    for (const w of c.words) if (w) out.push({ word: w, top: c.name, sub: '' });
  }
  for (const t of custom) {
    if (t.parent) continue; // 自定义的是二级时交给 subsWords 那一套
    if (kind !== null && t.kind !== kind) continue;
    for (const w of t.words) if (w) out.push({ word: w, top: t.name, sub: '' });
  }
  return out;
}

/// 某方向的**二级**候选词（一级一个都不在这里）：三套词表在解析侧的第二套。
export function subsWords(kind, under = null, custom = _custom) {
  const out = [];
  for (const t of treeOf(kind, custom)) {
    if (!t.parent) continue;
    const top = topOf(t.kind, t.name, custom);
    if (under !== null && top !== under) continue;
    for (const w of t.words) if (w) out.push({ word: w, top, sub: t.name });
  }
  return out;
}
