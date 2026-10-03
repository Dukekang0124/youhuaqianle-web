// 四要素解析引擎 —— 1:1 移植自 app/lib/core/parser.dart
// 真源是 Dart 那份；本文件与它必须给出同样的金额/分类/商户/时间，由 tools/web-parity.mjs 用同一份黄金集把关。
import { cn2num, cnDecimal, cnDigits, cnNumChars, normalizeText } from './cn.js';
import {
  detectGoodsGroup, longestGoodsWord, goodsWordSpans, goodsWordLenAt, wordAt, brandWordAt } from './goods_detect.js';
import {
  CATEGORIES, BRANDS, INCOME_WORDS, REFUND_WORDS, PLATFORM_WORDS, PAY_CHANNEL_WORDS,
} from './lexicon.js';

const CAT = `[${cnNumChars}]`;

// 角位与分位上能出现的字：只有 0-9 和单字数字，不含「十百千万」——与 Dart 的 `_tailDigits` 同源。
const TAIL_DIGITS = '0-9零〇一二两三四五六七八九';

// 「5万2」「23万」「1.5万」「8w」「1.5k」：阿拉伯数字 + 位数单位（k 与 w 同级，U1 2026-10-03，与 Dart 同源）。
// 🔴 必须排在所有其它金额规则之前（与 Dart 的 `_findMagnitude` 同一条理由）：
// 「淘宝花了5万2买沙发」在第 1 条匹配不上，掉到第 4 条「裸数字取最后一个」会把 52000 记成 ¥2。
const MAGNITUDE_RE =
  /([0-9]+(?:\.[0-9]{1,2})?)\s*([百千万]|[wW](?![a-zA-Z])|[kK](?![a-zA-Z]))(?:\s*(?:([0-9]|[一二两三四五六七八九])\s*([百千])?))?/;

function magUnit(c) {
  if (c === '百') return 100;
  if (c === '千' || c === 'k' || c === 'K') return 1000;
  return 10000; // 万 / w / W
}

// 「k」这一档只认**纯金额尾**（与 Dart 的 `_kGluedToItem` 同判据）：数字后面紧跟一个
// 词表物品词，那个 k 就是规格不是钱——「买了个4k显示器3000」里的 4k 是分辨率，钱是 3000。
// 中文「千/万」没有这种规格读法，所以这一道闸只管拉丁 k。
function kGluedToItem(unit, seg, at) {
  return (unit === 'k' || unit === 'K') && goodsWordLenAt(seg, at) >= 2;
}

function findMagnitude(seg) {
  for (const m of seg.matchAll(MAGNITUDE_RE_G)) {
    if (kGluedToItem(m[2], seg, m.index + m[0].length)) continue;
    const unit = magUnit(m[2]);
    let v = parseFloat(m[1]) * unit;
    if (m[3] !== undefined) {
      const d = cn2num(m[3]);
      if (d !== null) v += d * (m[4] !== undefined ? magUnit(m[4]) : Math.floor(unit / 10));
    }
    if (v <= 0) return null;
    return { cents: Math.round(v * 100), conf: 0.95 };
  }
  return null;
}

// 「N块M」这一族的骨架：元部分 + 单位词。单位词之后那段（角/分）不塞进正则，
// 交给 tailCents 逐字读——与 Dart 的 `_yuanUnitRe` 同源。
const YUAN_UNIT_RE = new RegExp(
  `(?<yuan>[0-9]+(?:\\.[0-9]{1,2})?|[${cnNumChars}]+(?:点[${TAIL_DIGITS}]{1,2})?)\\s*(?:块钱|块|元|圆|米)`,
);
const YUAN_UNIT_RE_G = new RegExp(YUAN_UNIT_RE.source, 'g');

// 单位词之后那串角分的形状（tailCents 读值、hideAmounts 量长度共用一份）。
const TAIL_RE = new RegExp(`^([${TAIL_DIGITS}]{1,2})\\s*(毛|角)?\\s*([${TAIL_DIGITS}])?\\s*(分)?`);

// 「一点五万」这类中文小数带位数单位：MAGNITUDE_RE 只认阿拉伯数字，这里补上中文写法。
// 它存在的理由只有一个——把那个小数点「点」从钟点正则眼前拿走。
const DECIMAL_MAG_RE = new RegExp(
  `[${cnNumChars}]+点[${TAIL_DIGITS}]{1,2}\\s*(?:[百千万]|[wW](?![a-zA-Z]))`,
);
const DECIMAL_MAG_RE_G = new RegExp(DECIMAL_MAG_RE.source, 'g');
const MAGNITUDE_RE_G = new RegExp(MAGNITUDE_RE.source, 'g');

function digitOf(c) {
  return c in cnDigits ? cnDigits[c] : /^\d$/.test(c) ? Number(c) : null;
}

// 单位词之后那串角分读成「几分」（0..99），四条口径与 Dart 的 `_tailCents` 逐条相同：
// ① 连着说两位（「152块75」）＝ 7 毛 5 分；② 写了「毛/角」「分」字的按字面走；
// ③ 只说一位、元部分自己没说过角（「七块五」）＝ 毛；
// ④ 元部分自己已带小数点（「一百五十二点七块五」）时那一位只能是分。
function tailCents(tail, yuanHasDecimal) {
  const m = TAIL_RE.exec(tail);
  if (!m) return 0;
  const a = m[1];
  if (a.length === 2) return digitOf(a[0]) * 10 + digitOf(a[1]);
  const d = digitOf(a);
  if (m[2] !== undefined || m[3] !== undefined) {
    return d * 10 + (m[3] === undefined ? 0 : digitOf(m[3]));
  }
  if (m[4] !== undefined) return d;
  return yuanHasDecimal ? d : d * 10;
}

// 「块」在这里是量词还是元：**只有单字数字 + 光杆「块」+ 紧跟物品名**才算量词
// （「一块蛋糕28」说的是一块蛋糕，钱是后面那个 28）。与 Dart 的 `_isMeasureWord` 同源。
//
// 🔴 上一版这里根本没有这一判据（只取第一个匹配就返回），于是网页版把「一块蛋糕28」
// 记成 ¥1；而 App 侧补上判据之后，同一句话在两端给出两笔完全不同的账。
// 🔴 判据也不能宽成「后面有物品名就算量词」：「十块钱牙膏」带「钱」字，
// 「八百块水费」「五十块话费」的元部分自己说了位数——没人把它们听成量词，
// 可词表里恰好有牙膏/水费/话费（2026-10-03 全量回归当场抓出来的真串案）。
function isMeasureWord(seg, m) {
  if (goodsWordLenAt(seg, m.index + m[0].length) < 2) return false;
  if (m[0].endsWith('块钱')) return false;
  return new RegExp(`^[${TAIL_DIGITS}]$`).test(m.groups.yuan);
}

// 「块/元」这一族一次读全（替掉旧的第 1、1b、2 三条各管一截的写法）。
// 量词那一处匹配跳过、不换档：同一句里后面还有真的「15块5」时照旧按元读。
function findYuanJiaoFen(seg) {
  for (const m of seg.matchAll(YUAN_UNIT_RE_G)) {
    if (isMeasureWord(seg, m)) continue;
    const yuanText = m.groups.yuan;
    const yuan = cnDecimal(yuanText);
    if (yuan === null || yuan <= 0) continue;
    return {
      cents: Math.round(yuan * 100) +
        tailCents(seg.slice(m.index + m[0].length),
          yuanText.includes('点') || yuanText.includes('.')),
      conf: 0.95,
    };
  }
  return null;
}

// 金额与位数短语在原文里占的那一段（元 + 单位词 + 角分尾）。
function amountSpans(seg) {
  const allOf = (re) => [...seg.matchAll(re)].map((m) => {
    const end = m.index + m[0].length;
    const t = TAIL_RE.exec(seg.slice(end));
    return [end, end + (t ? t[0].length : 0)];
  });
  return [...allOf(YUAN_UNIT_RE_G), ...allOf(MAGNITUDE_RE_G), ...allOf(DECIMAL_MAG_RE_G)];
}

// 挖掉金额短语后的原文（等长「※」占位）。时间那条路必须先走这一步：
// 「一百五十二点七块五」里的「点」是小数点，而钟点正则会把「五十二点」抓成 52 点；
// 与 Dart 同一条理由——错误的小时不报错，它进位成「两天后的 04:00」。
function hideAmounts(seg) {
  const spans = amountSpans(seg);
  if (spans.length === 0) return seg;
  // 按 UTF-16 码元逐位对齐（与 Dart 的 `seg[i]` 同一口径）：正则给的下标就是码元下标。
  let out = '';
  for (let i = 0; i < seg.length; i++) {
    out += spans.some((s) => i >= s[0] && i < s[1]) ? '※' : seg[i];
  }
  return out;
}

export function findAmount(seg) {
  const mag = findMagnitude(seg);
  if (mag) return mag;
  const yjf = findYuanJiaoFen(seg);
  if (yjf) return yjf;
  let m;
  // 3. 省略式（尾数取低一级单位）："一千二"->1200 "二百八"->280 "一万二"->12000
  m = seg.match(new RegExp(`([一二两三四五六七八九][千百万])([一二三四五六七八九])(?!${CAT})`));
  if (m) {
    const base = cn2num(m[1]);
    const unit = cn2num(m[1][1]);
    const rest = cn2num(m[2]) * Math.floor(unit / 10);
    if (base !== null) return { cents: (base + rest) * 100, conf: 0.6 };
  }
  // 4. 裸阿拉伯数字（取最后一个）
  const bare = [...seg.matchAll(/([0-9]+(?:\.[0-9]{1,2})?)(?![0-9point分:：])/g)];
  if (bare.length) return { cents: Math.round(parseFloat(bare[bare.length - 1][1]) * 100), conf: 0.6 };
  // 5. 裸中文数字结尾
  m = seg.match(new RegExp(`(${CAT}{2,6})\\s*$`));
  if (m) {
    const v = cn2num(m[1]);
    if (v !== null && v >= 1) return { cents: v * 100, conf: 0.7 };
  }
  return null;
}

export function findType(seg) {
  if (REFUND_WORDS.some((w) => seg.includes(w))) return 'refund';
  if (INCOME_WORDS.some((w) => seg.includes(w))) return 'income';
  return 'expense';
}

// 词典里常有两词同属一类，所以只回长度不合并计数。
function longestBrand(seg) {
  let hit = null;
  let hitLen = 0;
  for (const b of BRANDS) {
    for (const form of [b.brand, ...(b.aliases || [])]) {
      if (!form) continue;
      // 与 Dart 同一把闸（goods_detect.brandWordAt）：大小写都认、数字算边界、字母贴着的不算
      if (brandWordAt(seg, form) < 0) continue;
      if ([...form].length > hitLen) {
        hit = b;
        hitLen = [...form].length;
      }
    }
  }
  return hit;
}

// 真因 3（docs/30 §四 FR-3）—— 与 Dart 的 _isGoodsFragment 逐条同义：
// 单字关键词落在更长的物品词里、且不是那个词的最后一个字（中心语在后），才不算场景证据。
function isGoodsFragment(seg, word, spans) {
  if ([...word].length !== 1) return false;
  let seen = 0, buried = 0;
  for (let at = seg.indexOf(word); at >= 0; at = seg.indexOf(word, at + 1)) {
    seen++;
    const end = at + 1;
    const inside = spans.filter((s) => s[0] <= at && end <= s[1] && s[1] - s[0] > 1);
    if (inside.length > 0 && inside.every((s) => s[1] !== end)) buried++;
  }
  return seen > 0 && buried === seen;
}

function longestCatWord(seg) {
  const spans = goodsWordSpans(seg);
  let hit = null;
  for (const c of CATEGORIES) {
    if (c.name === '其他') continue;
    for (const w of c.words) {
      // 与物品词同一把匹配闸（goods_detect.wordAt）：ASCII 词大小写都认，
      // 但不许从更长的拉丁串里抠出来（与 Dart 同一条理由）。
      if (!w || wordAt(seg, w) < 0) continue;
      if (isGoodsFragment(seg, w, spans)) continue;
      if (hit === null || [...w].length > [...hit.word].length) {
        hit = { cat: c, word: w };
      }
    }
  }
  return hit;
}

// 「最长命中优先」：命中更具体的词，而不是先撞上的词（「美团买药」不被「美团」吃掉）。
export function findCategory(seg) {
  const b = longestBrand(seg);
  if (b) return { name: b.category, conf: 0.95 };
  const w = longestCatWord(seg);
  if (w) return { name: w.cat.name, conf: w.word.length >= 2 ? 0.85 : 0.75 };
  return { name: '其他', conf: 0.3 };
}

// 渠道名按长度倒序拼进交替式：「微信支付」必须排在「微信」前面，否则正则先撞上短的。
const CHANNEL_ALTERNATION = [...PAY_CHANNEL_WORDS]
  .sort((a, b) => [...b].length - [...a].length)
  .join('|');

// 「在/去/到 + 渠道名」：整词优先，走在通用商户框架之前。
// 通用框架允许「付」当动词、又允许捕获一个字，于是「我在支付宝上交了电费」
// 在旧实现里切出过商户「支」（实测截图 2026-10-01 11:05）。
const CHANNEL_FRAME_RE = new RegExp(`(?:在|去|到)(${CHANNEL_ALTERNATION})`);

// 「在/去/到 + 店名 + 动词」：捕获**至少两个字**——单字店名基本是切错的残渣。
// 动词表补了「交/缴」：水电话费这类账他说的就是「交了」，旧表里没有这个动词。
const MERCHANT_FRAME_RE = new RegExp(
  '(?:在|去|到)([一-龥A-Za-z0-9\\-]{2,10}?)' +
    '(?:买的|买了|买|吃饭|吃了|吃|喝|打车|充值|充|消费|花了|付了|付|刷|交了|交|缴了|缴)',
);

export function findMerchant(seg) {
  const b = longestBrand(seg);
  if (b) return { name: b.brand, conf: 0.9 };
  const ch = seg.match(CHANNEL_FRAME_RE);
  if (ch) return { name: ch[1], conf: 0.75 };
  const m = seg.match(MERCHANT_FRAME_RE);
  if (m) return { name: m[1], conf: 0.7 };
  return { name: '', conf: 0 };
}

const TOD = [
  ['凌晨', 2],
  ['早上|早晨|今早|早饭', 8],
  ['上午', 10],
  ['中午|午饭|正午', 12],
  ['下午', 15],
  ['傍晚', 18],
  ['晚上|今晚|晚饭|夜里', 20],
  ['昨晚', 21],
];

export function findTime(seg, now) {
  let dayOffset = 0;
  let hour = null;
  let minute = now.getMinutes();
  let found = false;
  if (/前天/.test(seg)) {
    dayOffset = -2;
    found = true;
  } else if (/昨天|昨晚/.test(seg)) {
    dayOffset = -1;
    found = true;
  }
  for (const [re, h] of TOD) {
    if (new RegExp(re).test(seg)) {
      hour = h;
      found = true;
      break;
    }
  }
  const m = hideAmounts(seg).match(/([0-9]{1,2}|[一二两三四五六七八九十]{1,3})点(半|[0-5]?[0-9]分?)?/);
  if (m) {
    const h = cn2num(m[1]);
    // 小时只在 0..23 才认。越界时宁可不给时间，也不许把「52 点」交给 new Date：
    // 它会静默进位成「两天后的 04:00」，把一笔今天的账记到下个月。
    if (h !== null && h >= 0 && h <= 23) {
      hour = h;
      const mm = m[2];
      minute = mm === '半' ? 30 : mm !== undefined && mm !== null ? parseInt(mm.replace('分', ''), 10) || 0 : 0;
      if (/下午|晚上|傍晚/.test(seg) && hour < 12) hour += 12;
      found = true;
    }
  }
  let d = new Date(now.getTime() + dayOffset * 86400000);
  if (hour !== null) {
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute);
  } else if (dayOffset !== 0) {
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0);
  }
  return { ts: d, conf: found ? 0.85 : 1 };
}

export const PAY_VERBS = ['花', '付', '买', '消费', '刷', '充', '交', '给'];

// 「一口气说完不带停顿」救星：一段话里出现 ≥2 个「数字+块钱/元」或「数字+万/千」时，逐笔切开
// 如「三十二块打车二十五块奶茶十九块九」→ 三个独立账目（否则 findAmount 只取第一个金额）
const AMT_UNIT_RE = new RegExp(
  `([0-9]+(?:\\.[0-9]{1,2})?|[${cnNumChars}]+)(?:块钱|块|元|圆)(?:[0-9一二三四五六七八九](?:毛|角)?)?(?![0-9${cnNumChars}])` +
    // v0.14.7：位数单位也是「明说了一笔钱」。「花了23万又交了5千」以前只数得出 0 笔，
    // 于是云端拆句的触发判据（`multiEntityCue`）对这类句子永远闭嘴。
    // U1（2026-10-03）：`k` 与 `w` 同级——`findAmount` 认「1.5k」是钱，这里就必须同样数得出，
    // 否则「他说了几笔钱」和拆句用的钱是两套口径（与 Dart 的 `_amtUnitRe` 同源）。
    // F10（2026-10-03，docs/40 §3）：位数单位前面放开一个空格，与 `MAGNITUDE_RE`（一直写着
    // `\s*`）**同一批口径**。不放的后果不是「少拆一笔」那么轻：`花了1.5 k和200块吃饭`
    // 里这一笔在拆句数不出来，于是那句被别的规则从数字中间切开，**¥1,500 记成了 ¥1.50**——
    // `万` 同样中招，比 `k` 早得多。
    // 🔴 空格只在**位数单位**这一档放开：「1.5 块」丢掉单位也只是 ¥1.50，不差数量级，不在射程里。
    // 🔴 单位要**命名捕获**（`mag`）：F9 那道护栏得知道这个锚用的是哪个单位字、那个字在哪结束。
    `|[0-9]+(?:\\.[0-9]{1,2})?\\s*(?<mag>[百千万]|[wW](?![a-zA-Z])|[kK](?![a-zA-Z]))(?:[0-9一二两三四五六七八九](?:[百千])?)?(?![0-9${cnNumChars}])`,
  'g',
);

/// 这句话里他**明说过带单位**的那几截钱——**锚点级**的出口，护栏已筛
/// （与 Dart 的 `_amountAnchors` 同一判据、同一处定义：拆句只许从这里数锚）。
///
/// 🔴 F9（2026-10-03，docs/40 §3）：以前这里直接拿 `AMT_UNIT_RE.matchAll` 用，
/// 而 `4k显示器` 里那个 `4k` 是**分辨率不是钱**（`findMagnitude` 有 `kGluedToItem` 挡它，
/// 拆句没有）。于是 `买了个4k显示器3000块` 数出两个锚 ⇒ 拆成两笔 ⇒ 凭空多落一行 **¥4,000**。
/// 护栏判据仍然只有 `kGluedToItem` 那一处，只是**多了一个使用点**；差别在于这里把整句
/// （已归一）交给它，而不是拆完的小段——规格词紧跟物品名这件事，句子越整越好判。
function amountAnchors(t) {
  return [...t.matchAll(AMT_UNIT_RE)].filter((m) => {
    const unit = m.groups && m.groups.mag;
    if (!unit) return true;
    // 单位字在整段匹配里的位置：数字尾巴里不会出现「百千万kwK」这几个字，第一次出现就是它自己。
    return !kGluedToItem(unit, t, m.index + m[0].indexOf(unit) + 1);
  });
}

// 「下一笔的起势」＋支付动词；切点取整个匹配的开始，所以「还买了」一起留给右段。
const GAP_VERB_RE = /[还又也再就]?(?:花|付|买|消费|刷|充|交|给)/g;

// gap 里第一个真正的支付动词：落在词表物品词内部的那些字（牙刷的「刷」）不算他说了一个动词。
//
// ⚠️ 这里必须用**自己的一份**正则，不许改回共享的 `GAP_VERB_RE`：全局正则的 `exec` 会把
// `lastIndex` 推到命中之后，而这个函数是**找到就 return**——留下的游标是脏的。
// `nextClauseAt` 随后用同一个正则 `matchAll`，而 `matchAll` 会拿调用方的 `lastIndex` 当起点，
// 于是「买牙膏花了」里第一个「买」被跳过、只剩一个动词，2054 那一刀在网页版上根本没落下
// （黄金集「花了30块买牙膏花了40块买鼠标」：App 拆成 30 块牙膏 + 40 块鼠标，网页版拆成
// 30 块空物品 + 牙膏鼠标两样都记在第二笔）。Dart 的 `allMatches` 没有这种状态，不会踩。
function firstRealVerbAt(gap) {
  const spans = goodsWordSpans(gap);
  const re = new RegExp(GAP_VERB_RE.source, 'g');
  let m;
  while ((m = re.exec(gap)) !== null) {
    if (spans.some((s) => m.index >= s[0] && m.index < s[1])) continue;
    return m.index;
  }
  return null;
}

/// 「下一句又起头了」的三个形状：主语重起、换笔的起势词、「在 + 地点或平台」。
const NEXT_CLAUSE_RE = /(?:我|咱|俺|还|又|也|再|就|然后|接着|顺便|另外|在)/g;

/// gap 里第一个新句起点在第几字；第 0 字不算（那正是本笔物品的开头）。
/// 与 firstRealVerbAt 同一套遮罩：词表物品名里的「在」不算换笔。
///
/// v0.14.7 起「新句起点」有两种形状，取更早的那个（与 Dart `_nextClauseAt` 逐条同义）：
/// ① 起势词/主语/「在+地点」；② **段里后一个支付动词**——「花了30块买牙膏花了40块买鼠标」
/// 里 gap 是「买牙膏花了」，它以动词开头、段里没有起势词，不认第二种就把「买牙膏」整段归给右笔，
/// 三笔串一位。而「三十九块九买面包十二块」里 gap 只有一个动词，仍整段归右（黄金集在守）。
function nextClauseAt(gap) {
  const spans = goodsWordSpans(gap);
  let at = null;
  const consider = (i) => {
    if (i === 0) return;
    if (spans.some((s) => i >= s[0] && i < s[1])) return;
    if (at === null || i < at) at = i;
  };
  for (const m of gap.matchAll(NEXT_CLAUSE_RE)) consider(m.index);
  const verbs = [...gap.matchAll(GAP_VERB_RE)];
  for (let i = 1; i < verbs.length; i++) consider(verbs[i].index);
  return at;
}

/// 两笔金额之间那段文字（gap）怎么分给这两笔 —— 与 Dart 的 `splitGap` 逐条同义
/// （三条判据与「宁可归右」的理由写在那份真源的注释里；2052 的 `gapAttachesLeft`
/// 整段搬运已被推翻，见 docs/30 §四 FR-1）。
export function splitGap(gap, clause) {
  if (!gap) return { left: '', right: gap };
  const verbAt = firstRealVerbAt(gap);
  let left, right;
  if (verbAt !== null) {
    const head = gap.slice(0, verbAt);
    if ([...head].length > 1 && head.startsWith('的')) {
      left = head;
      right = gap.slice(verbAt);
    } else if (verbAt === 0) {
      // 2053 真机新错：动词开头的 gap 是「本笔刚说完的东西＋下一笔的起势」，
      // 到新句起点处裁开；段里没有新句起点（「买面包」）照旧整段归右。
      const at = nextClauseAt(gap);
      left = at === null ? '' : gap.slice(0, at);
      right = at === null ? gap : gap.slice(at);
    } else {
      left = '';
      right = gap;
    }
  } else if (gap.startsWith('的')) {
    left = gap;
    right = '';
  } else if (longestGoodsWord(gap) !== null &&
      clause.includes('块钱') &&
      !/[，,、；;。！!？?\s]/.test(gap)) {
    left = gap;
    right = '';
  } else {
    left = '';
    right = gap;
  }
  // ③ 归左的部分遇到标点就到此为止（与 Dart 同义）：逗号后面的字是下一笔的话
  const sep = /[，,、；;。！!？?\s]/.exec(left);
  if (sep) {
    right = left.slice(sep.index) + right;
    left = left.slice(0, sep.index);
  }
  return { left, right };
}

export function implicitSplit(t) {
  // 🔴 走 `amountAnchors` 而不是裸用正则：F9 那条幻影账（`4k显示器` 的 `4k` 被当成一笔钱）
  // 就是从这一行走出去的。「他说了几笔钱」这件事全站只许有一处口径。
  const ms = amountAnchors(t);
  if (ms.length < 2) return t;
  let out = '';
  let last = 0;
  for (let i = 0; i < ms.length; i++) {
    const end = ms[i].index + ms[i][0].length;
    let cut = end;
    if (i !== ms.length - 1) {
      cut = end +
          splitGap(t.slice(end, ms[i + 1].index), t.slice(last, end)).left.length;
    }
    out += t.slice(last, cut);
    if (i !== ms.length - 1) out += '，';
    last = cut;
  }
  out += t.slice(last);
  return out;
}

// 「数字（可带万/千）＋（可带的）＋**词表物品词**」——一个**不带钱单位**的金额锚点。
// 代表句「我在京东买18000的电脑在天猫买了60000的电视在淘宝买6000的冰箱」里三个数都不说「块」，
// implicitSplit（只数带单位的钱）一次都不触发，整句读成一笔、金额取了最后一笔的 6000。
// 三条防误伤的闸（与 Dart 同义）：① 反向预查挡掉「39块9的牛奶」里那个当尾数的「9」；
// ② 数字后面必须紧跟一个 ≥2 字的词表物品词；③ 一句里 ≥2 个锚才动手。
const ITEM_AMT_RE =
  /(?<![块元毛角\d百千万])(\d+(?:\.\d{1,2})?)\s*(?:[百千万]\s*(?:[0-9]|[一二两三四五六七八九])?\s*[百千]?)?\s*(?:的)?/g;

// 上一笔说完之后，下一笔的「头」在第几个字：起势词/主语/「在+地点」或**平台词**
// （「天猫60000电视」这种连「在」都省了的说法）。找不到就不切这一刀。
function clauseHead(t, from, to) {
  if (to <= from) return null;
  const region = t.slice(from, to);
  const spans = goodsWordSpans(region);
  let best = -1;
  const consider = (rel) => {
    if (spans.some((s) => rel >= s[0] && rel < s[1])) return;
    if (best < 0 || rel < best) best = rel;
  };
  for (const m of region.matchAll(NEXT_CLAUSE_RE)) consider(m.index);
  for (const w of PLATFORM_WORDS) {
    const at = region.indexOf(w);
    if (at >= 0) consider(at);
  }
  return best < 0 ? null : from + best;
}

// 按「数字＋物品」锚点把一句话切成几笔：切点落在**下一笔的头**之前，
// 于是「在天猫买了」跟着 60000 那笔走，店名不会留在上一笔的尾巴上。
export function itemAnchorSplit(t) {
  const anchors = []; // [锚起点, 物品词结尾]
  for (const m of t.matchAll(ITEM_AMT_RE)) {
    const end = m.index + m[0].length;
    const len = goodsWordLenAt(t, end);
    if (len > 0) anchors.push([m.index, end + len]);
  }
  if (anchors.length < 2) return t;
  let out = '';
  let last = 0;
  for (let i = 1; i < anchors.length; i++) {
    const cut = clauseHead(t, anchors[i - 1][1], anchors[i][0]);
    if (cut === null || cut <= last) continue; // 认不出下一笔从哪儿开始 ⇒ 这一刀不切
    out += `${t.slice(last, cut)}，`;
    last = cut;
  }
  return out + t.slice(last);
}

export function parseSegment(seg, now, knownItems = [], learnedCats = {}) {  const amt = findAmount(seg);
  const hasPayVerb = PAY_VERBS.some((w) => seg.includes(w));
  const mer = findMerchant(seg);
  // 只说品牌词（如「星巴克」）也应成卡：缺金额由确认卡强制补录
  if (!amt && !hasPayVerb && !mer.name) return null;
  const cat = findCategory(seg);
  const time = findTime(seg, now);
  // 物品维度独立抽（docs/29 FR-1）：认不出就是空串，绝不拿场景分类冒充物品。
  // grp（docs/30 FR-4）：一个金额并列说到两样东西时，主物品承担全部金额，
  // 其余那几个名词进 itemExtras——不进金额、不进物品榜。
  const grp = detectGoodsGroup(seg, knownItems, learnedCats);
  const goods = grp ? grp.main : null;
  return {
    raw: seg,
    amountCents: amt ? amt.cents : null,
    amountConf: amt ? amt.conf : 0,
    type: findType(seg),
    category: cat.name,
    categoryConf: cat.conf,
    merchant: mer.name,
    merchantConf: mer.conf,
    occurredAt: time.ts,
    timeConf: time.conf,
    item: goods ? goods.item : '',
    itemNorm: goods ? goods.itemNorm : '',
    goodsCat: goods ? goods.goodsCat : '',
    itemSrc: goods ? goods.src : '',
    itemConf: goods ? goods.conf : 0,
    itemExtras: grp ? grp.extras : [],
    merchantInherited: false,
  };
}

// 商户句级作用域（与 Dart `storeCueWords`/`platformWords`/`merchantInheritable`/
// `applyMerchantScopes` 同义）：一次语音输入切出来的全部笔共享一段作用域，源头只认
// 「听到的」那家店，往下盖直到被三道闸任一关闭（换地点词/换平台词/换场景）。
export const STORE_CUE_WORDS = [
  '店', '超市', '商场', '市场', '卖场', '摊', '网上', '网购', '电商', '小程序',
  '直播', '门口', '楼下', '隔壁', '公司', '学校', '家里', '医院', '药店',
  '餐厅', '饭店', '食堂', '馆', '吧', '厅', '驿站', '理发', '健身',
];

// 闸②用到的「到场才完得成的事」（与 Dart `_onSiteScenes` 同义）：吃饭、出行、住。
// 购物/数码/教育/医疗/娱乐都是「商品」，一家电商平台全能卖，跨到它们不算换地方。
export const ON_SITE_SCENES = ['餐饮', '交通', '居住'];

export function merchantInheritable(seg) {
  const t = seg.trim();
  if (!t) return false;
  return !STORE_CUE_WORDS.some((w) => t.includes(w)) &&
    !PLATFORM_WORDS.some((w) => t.includes(w));
}

export function applyMerchantScopes(es) {
  let filled = 0;
  let scope = '';
  let scopeCat = '';
  for (const e of es) {
    if (e.merchant) {
      // 闸③：只有他自己说出来的店名才配当源头，继承来的不再续一段
      if (!e.merchantInherited) {
        scope = e.merchant;
        const w = longestCatWord(e.raw);
        scopeCat = w ? w.cat.name : '';
      }
      continue;
    }
    if (!scope) continue;
    if (!merchantInheritable(e.raw)) {
      scope = '';
      scopeCat = '';
      continue;
    }
    // 闸②：本笔说的是「到那儿去才完得成的事」，而且和源头不是一件事 ⇒ 他已经换了地方
    const own = longestCatWord(e.raw);
    if (own && scopeCat && own.cat.name !== scopeCat &&
        ON_SITE_SCENES.includes(own.cat.name)) {
      scope = '';
      scopeCat = '';
      continue;
    }
    e.merchant = scope;
    e.merchantInherited = true;
    e.merchantConf = 0.45;
    filled++;
  }
  return filled;
}

function hasAmountLike(part) {
  if (/[0-9]/.test(part)) return true;
  return new RegExp(CAT).test(part) && findAmount(part) !== null;
}

export function parseText(text, now, knownItems = [], learnedCats = {}) {
  let t = normalizeText(text);
  t = t.replace(/然后|接着|还有|加上|再来/g, '，').replace(/。/g, '，');
  t = implicitSplit(t);
  // 三个数一个「块」都没说时（「京东18000的电脑天猫60000的电视淘宝6000的冰箱」），
  // 改按「数字＋物品词」的锚点拆。两条救星管的是两种不同的说法，缺一不可。
  t = itemAnchorSplit(t);
  const parts = t.split(/[，,、；;\s]+/).filter((p) => p.length);
  const merged = [];
  let pending = '';
  for (const p of parts) {
    if (hasAmountLike(p)) {
      merged.push(pending + p);
      pending = '';
    } else if (merged.length) {
      merged[merged.length - 1] += ' ' + p;
    } else {
      // 累加而不是覆盖：只说品牌/商户名的小句本就该成卡
      pending = `${pending}${p} `;
    }
  }
  if (pending.length) merged.push(pending.trim());
  const es = merged
    .map((s) => parseSegment(s, now, knownItems, learnedCats))
    .filter(Boolean);
  // 一次语音输入 = 一段作用域：本句里自己没报店的笔沿用听到的那家店
  applyMerchantScopes(es);
  return es;
}
