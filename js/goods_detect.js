// 物品抽取 —— 逐字对齐 app/lib/core/goods_detect.dart（docs/29 FR-1）
// 从一句原话里把「买了什么」那个词找出来。红线与全站一致：纯字符串、不联网、
// 不碰金额、不改分类；抽不出来一律回 null，界面对应的说法是「没听出来，点一下补」。
//
// 🔴 与 Dart 侧同一条最贵的决定：**没有第三把**。
// ① 开放式句式抽取（「买了 + 任意名词段」）在负例上不可控，误抽是在账上写下一条他没买过的东西；
// ② 近邻相似度属于**纠错**层不属于**抽取**层——历史物品在这里当动态词典用（只认包含关系），
//    不该让「三轮车」因为离「三脚架」近就被抽出来。
import {
  GOODS_OTHER, GOODS_WORDS, goodsCategoryNames, goodsCatOfDisplay, goodsDisplay, goodsNorm,
  AMOUNT_CHARS,
} from './goods_lexicon.js';

// 词表最长命中优先（与 parser 的 longestBrand / longestCatWord 同一条纪律）。
// 取第一个命中会按词表书写顺序漂移——同一句话换台设备就换了物品名，那是最脏的不可复现。
// 服务动词闸（与 Dart 的 _servicedRightAfter 逐字同判据）：「给电瓶车充电三块」里的电瓶车
// 是被伺候的东西，不是买回来的东西——把它抽成物品等于在账上凭空多出一辆车。
const GOODS_SERVICE_VERBS = ['充电', '维修', '保养', '加油', '洗车', '打蜡', '补胎', '贴膜', '托运'];

function servicedRightAfter(seg, end) {
  if (end >= seg.length) return false;
  const rest = seg.slice(end);
  return GOODS_SERVICE_VERBS.some((v) => rest.startsWith(v));
}

export function longestGoodsWord(seg) {
  let hit = null;
  for (const w of GOODS_WORDS) {
    const at = seg.indexOf(w.word);
    if (at < 0) continue;
    if (servicedRightAfter(seg, at + w.word.length)) continue;
    if (hit === null || [...w.word].length > [...hit.word].length) hit = w;
  }
  return hit;
}

// 词表物品词在 seg 里占住的字符区间 [start, end) —— 与 Dart 的 goodsWordSpans 逐字同判据。
// 拆笔找支付动词时先遮掉这些位置：「牙刷」里的「刷」是物品名自己的字，不遮就把
// 「的牙膏牙刷还买了」从牙刷中间割开（docs/30 §四 FR-1 判据 ①）。每词只取第一次出现。
export function goodsWordSpans(seg) {
  const spans = [];
  for (const w of GOODS_WORDS) {
    const at = seg.indexOf(w.word);
    if (at < 0) continue;
    spans.push([at, at + w.word.length]);
  }
  return spans;
}

// 本机历史物品当动态词典：只认包含关系里的最长者，不算模糊距离。
// 传进来的是显示形态（他第一次记下的那个写法），比的是聚合键；返回原样而不是归一后的串。
export function longestKnownGoods(seg, known) {
  const s = goodsNorm(seg);
  let hit = null;
  let hitLen = null;
  for (const k of known) {
    if (k.length < 2) continue; // 与词表同一条单字纪律
    const n = goodsNorm(k);
    if ([...n].length < 2 || !s.includes(n)) continue;
    if (hit === null || [...n].length > hitLen) {
      hit = k;
      hitLen = [...n].length;
    }
  }
  return hit;
}

// 大类归属：他本人改过的类（学习表）→ 词表给的类 → 兜底「其他物品」。
// 顺序不能反：词典更新不许把用户决定冲掉。
export function goodsCatFor(item, lexiconCat, learnedCats = {}) {
  const norm = goodsNorm(item);
  const learned = learnedCats[norm];
  if (learned != null && learned !== '') return learned;
  if (lexiconCat != null && lexiconCat !== '' && goodsCategoryNames().includes(lexiconCat)) {
    return lexiconCat;
  }
  return GOODS_OTHER.name;
}

// 学习表裁决：手改过 > 次数多 > 大类表书写次序（最后一条只打破平手，保证跨设备同答案）。
export function goodsCatPick(learned) {
  const keys = Object.keys(learned);
  if (keys.length === 0) return null;
  keys.sort((a, b) => {
    const x = learned[a], y = learned[b];
    if (x.over !== y.over) return x.over ? -1 : 1;
    if (x.uses !== y.uses) return y.uses - x.uses;
    return goodsCategoryNames().indexOf(a) - goodsCategoryNames().indexOf(b);
  });
  return keys[0];
}

// 从一句话里抽物品。抽不到一律 null——这是正常出口，不是失败。
export function detectGoods(seg, knownItems = [], learnedCats = {}) {
  const w = longestGoodsWord(seg);
  const known = longestKnownGoods(seg, knownItems);
  // 两把都命中时取更长的串：更长的串才是他真正说出口的那个东西。
  if (w !== null && (known === null || [...w.word].length >= [...known].length)) {
    const display = goodsDisplay(w);
    return {
      item: display,
      itemNorm: goodsNorm(display),
      // learnedCats 这里也必须传：只在动态词典那条腿上尊重学习表，等于词表里的东西永远改不动，
      // 而词表恰恰是最需要被他纠正的那一类（它是我写的，不是他说的）。
      goodsCat: goodsCatFor(display, w.cat, learnedCats),
      src: 'lexicon',
      conf: 0.9,
    };
  }
  if (known !== null) {
    return {
      item: known,
      itemNorm: goodsNorm(known),
      goodsCat: goodsCatFor(known, goodsCatOfDisplay(known), learnedCats),
      src: 'learned',
      conf: 0.75,
    };
  }
  return null;
}

// 附属物品那一句实话（docs/30 FR-4）：确认卡与编辑页共用同一条文案，两份各写一遍
// 就会有一处先漂成「已识别」。返回 '' = 没话要说（不是「一切正常」的横幅）。
// 主物品被清空时也不说：与 Dart 的 itemExtrasNote 同一判据。
export function itemExtrasNote(extras, hasMainItem, suffix = '') {
  if (!extras || extras.length === 0 || !hasMainItem) return '';
  return `还说到了 ${extras.join('、')}：这句里没单独花钱，一分钱都不摊进它们${suffix}`;
}

// 并列/停顿记号：两个物品词之间**只允许**隔这些字，隔别的就不算一串（与 Dart 同表）。
export const GOODS_COORD_JOINS = ['', '、', '，', ',', '和', '与', '或', '跟', '以及'];
const coordJoinOk = (gap) => GOODS_COORD_JOINS.includes(gap);

// 以 main 为起点向两边接出自并列的一串物品词，按他说出来的先后排序。
function coordRun(seg, main) {
  const occ = [];
  for (const w of GOODS_WORDS) {
    const at = seg.indexOf(w.word);
    if (at < 0) continue;
    if (servicedRightAfter(seg, at + w.word.length)) continue;
    occ.push({ word: w, start: at, end: at + w.word.length });
  }
  const anchor = occ.filter((o) => o.word.word === main.word);
  if (anchor.length === 0) return [main];
  const run = [main];
  let lo = anchor[0].start;
  let hi = anchor[0].end;
  for (let grew = true; grew; ) {
    grew = false;
    let right = null;
    let left = null;
    for (const o of occ) {
      if (run.includes(o.word)) continue;
      if (o.start >= hi && coordJoinOk(seg.slice(hi, o.start))) {
        if (
          right === null ||
          o.start < right.start ||
          (o.start === right.start && [...o.word.word].length > [...right.word.word].length)
        ) right = o;
      } else if (o.end <= lo && coordJoinOk(seg.slice(o.end, lo))) {
        if (
          left === null ||
          o.end > left.end ||
          (o.end === left.end && [...o.word.word].length > [...left.word.word].length)
        ) left = o;
      }
    }
    // 左右都接得上时先接左边：「鞋刷牙膏」里先说出口的那个才该承担金额（FR-4）
    if (left !== null) {
      run.push(left.word);
      lo = left.start;
      grew = true;
    }
    if (right !== null) {
      run.push(right.word);
      hi = right.end;
      grew = true;
    }
  }
  run.sort((a, b) => seg.indexOf(a.word) - seg.indexOf(b.word));
  return run;
}

// 一个金额两样东西（docs/30 FR-4，v0.14.2）：与 Dart 的 detectGoodsGroup 逐字同判据。
// 主物品进 item 并承担**全部**金额，与它紧挨着并列说到的其它物品进 itemExtras（聚合键）。
// 附属一分钱都不摊，也不进物品榜——替他摊单价就是编一个他没报出来的数。
// 只在「相邻」这一种形状上收；附属只从**词表**来（动态词典那条腿不做相邻扩展）。
export function detectGoodsGroup(seg, knownItems = [], learnedCats = {}) {
  const hit = detectGoods(seg, knownItems, learnedCats);
  if (hit === null) return null;
  if (hit.src !== 'lexicon') return { main: hit, extras: [] };
  const w = longestGoodsWord(seg);
  if (w === null || goodsDisplay(w) !== hit.item) return { main: hit, extras: [] };
  const run = coordRun(seg, w);
  const first = run[0];
  let main = hit;
  if (first.word !== w.word) {
    const display = goodsDisplay(first);
    main = {
      item: display,
      itemNorm: goodsNorm(display),
      goodsCat: goodsCatFor(display, first.cat, learnedCats),
      src: 'lexicon',
      conf: 0.9,
    };
  }
  // 归一后按聚合键去重：「牙刷」和「牙 刷」是同一件东西，记两遍就是重复入账
  const extras = [];
  const seen = new Set([goodsNorm(main.item)]);
  for (const g of run.slice(1)) {
    const n = goodsNorm(goodsDisplay(g));
    if (n === '' || seen.has(n)) continue;
    seen.add(n);
    extras.push(n);
  }
  return { main, extras };
}

// 未登录词的**候选**（与 Dart 的 goodsCandidate 逐条同判据）：只变成确认卡上一颗 chip，
// 他不点就不落库——所以这一把可以比词表激进，但形态只认「买/换/修/办/充/订/租 + 2~4 字体词段」。
export const GOODS_CANDIDATE_VERBS = ['买', '换', '修', '办', '充', '订', '租'];
export const GOODS_VAGUE_WORDS = ['东西', '玩意', '教训', '什么', '啥', '其他', '别的', '这些', '那些', '一点', '空气', '经验'];
const CAND_LEAD = /^(了|的|点|些)+/;
const CAND_QTY = /^(一|二|两|三|四|五|六|七|八|九|十|几|半)?(个|件|台|副|双|瓶|盒|份|袋|箱|包|杯|条|支|本|顶|把|块|张)/;
const CAND_MONEY = /^\d+(\.\d+)?[块元]?[钱角分毛]?/;
const CAND_STOP = /[，,。.!！?？、;；:：\s和跟与或的]/;

export function goodsCandidate(seg, muted = []) {
  // 按下标走，不用 indexOf：同一个动词在一句里出现两次时（「买了X又买了Y」），
  // indexOf 永远回到第一个位置，两次判的是同一段——那是 Dart 侧明确避免的漂移。
  for (let i = 0; i < seg.length; i++) {
    if (!GOODS_CANDIDATE_VERBS.includes(seg[i])) continue;
    const cand = nounAfterVerb(seg.slice(i + 1));
    if (cand === null) continue;
    if (muted.includes(goodsNorm(cand))) continue;
    if (longestGoodsWord(cand) !== null) continue; // 词表认得的词不再问第二遍
    return cand;
  }
  return null;
}

function nounAfterVerb(rest) {
  let s = rest;
  for (let guard = 0; guard < 4; guard++) {
    const before = s.length;
    s = s.replace(CAND_LEAD, '').replace(CAND_MONEY, '').replace(CAND_QTY, '');
    if (s.length === before) break;
  }
  if (s === '') return null;
  let word = '';
  for (const ch of s) {
    // 段首就是数字/金额字 → 这里没有名词
    if (word === '' && AMOUNT_CHARS.includes(ch)) return null;
    if (AMOUNT_CHARS.includes(ch) || CAND_STOP.test(ch)) break;
    word += ch;
    if ([...word].length > 4) return null;
  }
  if ([...word].length < 2) return null;
  if (GOODS_VAGUE_WORDS.some((v) => word.includes(v))) return null;
  return word;
}

// 「他刚敲下名字、还没点大类」时该显示哪一类：词典 → 学习表 → 兜底。
// 确认卡与编辑页共用这一条——两个界面各写一遍推类，就会有一个先漂移。
// 名字空着回空串（不是兜底类）：没有物品的笔不许占一格「其他物品」。
export function goodsCatForName(name, learnedCats = {}) {
  const n = name.trim();
  if (n === '') return '';
  return goodsCatFor(n, goodsCatOfDisplay(n), learnedCats);
}

// 手改之后的落库形态：他显式选了大类就用那个，词典与学习表都排它后面。
// 物品名空着回 null——清空物品是合法决定，不是「没填」。
export function manualGoods(item, goodsCat = '', learnedCats = {}) {
  const name = item.trim();
  if (name === '') return null;
  const chosen = (goodsCat ?? '').trim();
  return {
    item: name,
    itemNorm: goodsNorm(name),
    goodsCat: goodsCategoryNames().includes(chosen)
      ? chosen
      : goodsCatFor(name, goodsCatOfDisplay(name), learnedCats),
    src: 'manual',
    conf: 1,
  };
}

// 物品名长度闸：超过 12 个字的「物品」多半是把整句话粘进来了，
// 宁可退回空并在界面上说实话。
export function goodsNameProblem(raw) {
  const s = raw.trim();
  if (s === '') return null;
  if ([...s].length > 12) return '物品名最长 12 个字，先写短一点';
  if (/[0-9]/.test(s)) return '物品名里不要带数字（那是金额或数量）';
  return null;
}
