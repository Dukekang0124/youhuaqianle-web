// 四要素解析引擎 —— 1:1 移植自 app/lib/core/parser.dart
// 真源是 Dart 那份；本文件与它必须给出同样的金额/分类/商户/时间，由 tools/web-parity.mjs 用同一份黄金集把关。
import { cn2num, cnNumChars, normalizeText } from './cn.js';
import {
  detectGoodsGroup, longestGoodsWord, goodsWordSpans,
} from './goods_detect.js';
import { CATEGORIES, BRANDS, INCOME_WORDS, REFUND_WORDS, PLATFORM_WORDS } from './lexicon.js';

const CAT = `[${cnNumChars}]`;

export function findAmount(seg) {
  let m;
  // 1. 阿拉伯 + 单位
  m = seg.match(/([0-9]+(?:\.[0-9]{1,2})?)\s*(?:块钱|元|块|圆|米)(?![0-9])/);
  if (m) return { cents: Math.round(parseFloat(m[1]) * 100), conf: 0.95 };
  // 1b. "39块9" -> 39.9
  m = seg.match(/([0-9]+)块([0-9])(?![0-9])/);
  if (m) return { cents: parseInt(m[1], 10) * 100 + parseInt(m[2], 10) * 10, conf: 0.95 };
  // 2. 中文 + 单位 + 尾数/毛角
  m = seg.match(new RegExp(`(${CAT}+)\\s*(?:块钱|块|圆|元)([一二两三四五六七八九])?(?:毛|角)?`));
  if (m) {
    const v = cn2num(m[1]);
    if (v !== null) {
      const tail = m[2] ? cn2num(m[2]) * 10 : 0;
      return { cents: v * 100 + tail, conf: 0.95 };
    }
  }
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
  for (const b of BRANDS) {
    if (!b.brand || !seg.includes(b.brand)) continue;
    if (hit === null || b.brand.length > hit.brand.length) hit = b;
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
      if (!w || !seg.includes(w)) continue;
      if (isGoodsFragment(seg, w, spans)) continue;
      if (hit === null || w.length > hit.word.length) hit = { cat: c, word: w };
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

export function findMerchant(seg) {
  const b = longestBrand(seg);
  if (b) return { name: b.brand, conf: 0.9 };
  const m = seg.match(
    /(?:在|去|到)([一-龥A-Za-z0-9\-]{1,10}?)(?:买的|买了|买|吃饭|吃了|吃|喝|打车|充值|充|消费|花了|付了|付|刷)/,
  );
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
  const m = seg.match(/([0-9]{1,2}|[一二两三四五六七八九十]{1,3})点(半|[0-5]?[0-9]分?)?/);
  if (m) {
    const h = cn2num(m[1]);
    if (h !== null) hour = h;
    const mm = m[2];
    minute = mm === '半' ? 30 : mm !== undefined && mm !== null ? parseInt(mm.replace('分', ''), 10) || 0 : 0;
    if (/下午|晚上|傍晚/.test(seg) && hour !== null && hour < 12) hour += 12;
    found = true;
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

// 「一口气说完不带停顿」救星：一段话里出现 ≥2 个「数字+块钱/元」时，逐笔切开
const AMT_UNIT_RE = new RegExp(
  `([0-9]+(?:\\.[0-9]{1,2})?|[${cnNumChars}]+)(?:块钱|块|元|圆)(?:[0-9一二三四五六七八九](?:毛|角)?)?(?![0-9${cnNumChars}])`,
  'g',
);

// 「下一笔的起势」＋支付动词；切点取整个匹配的开始，所以「还买了」一起留给右段。
const GAP_VERB_RE = /[还又也再就]?(?:花|付|买|消费|刷|充|交|给)/g;

// gap 里第一个真正的支付动词：落在词表物品词内部的那些字（牙刷的「刷」）不算他说了一个动词。
function firstRealVerbAt(gap) {
  const spans = goodsWordSpans(gap);
  GAP_VERB_RE.lastIndex = 0;
  let m;
  while ((m = GAP_VERB_RE.exec(gap)) !== null) {
    if (spans.some((s) => m.index >= s[0] && m.index < s[1])) continue;
    return m.index;
  }
  return null;
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
  const ms = [...t.matchAll(AMT_UNIT_RE)];
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

export function parseSegment(seg, now, knownItems = [], learnedCats = {}) {
  const amt = findAmount(seg);
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
