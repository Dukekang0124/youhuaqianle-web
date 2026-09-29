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
} from './goods_lexicon.js';

// 词表最长命中优先（与 parser 的 longestBrand / longestCatWord 同一条纪律）。
// 取第一个命中会按词表书写顺序漂移——同一句话换台设备就换了物品名，那是最脏的不可复现。
export function longestGoodsWord(seg) {
  let hit = null;
  for (const w of GOODS_WORDS) {
    if (!seg.includes(w.word)) continue;
    if (hit === null || [...w.word].length > [...hit.word].length) hit = w;
  }
  return hit;
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
