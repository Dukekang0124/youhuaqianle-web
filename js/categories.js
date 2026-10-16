// 自定义分类的校验与合并 —— 1:1 移植自 app/lib/core/categories.dart。
// 内置分类**可停用不可删**（历史流水还要显示），自定义分类可增删改；所有判定都在这一处，界面只调用。
//
// 与 Dart 同一条例子：这张表不进 lexicon.js。`lexicon.js` 的平表是解析器词典真源，
// 闸门 4 拿它与 Dart 逐字比对——把用户自己建的名字混进去，就等于把闸门搞脏。
import { CATEGORIES } from './lexicon.js';

export const CATEGORY_ICONS = [
  '🏷',
  '🐱',
  '🌸',
  '⚽',
  '📚',
  '💊',
  '🚗',
  '✈',
  '🎁',
  '👕',
  '💡',
  '🎬',
  '🐶',
  '🧾',
  '☕',
  '🏋',
];

export const DEFAULT_CATEGORY_ICON = '🏷';
export const MAX_CUSTOM_CATEGORIES = 20;
export const MAX_CATEGORY_NAME_LEN = 6;
export const MAX_KEYWORD_LEN = 8;

// 会去抢金额/数量的词不能当分类关键词（同 Dart 的 _moneyChars：进了词表，解析器会为了
// 命中分类把金额吃掉——那比「没认出分类」严重得多）。字符集必须与 Dart 那一串逐字相同。
const MONEY_CHARS = '块元角毛钱折倍';

/// 分类名能不能用；返回 null = 可以，否则是给用户看的一句话原因。
/// 空格判的是 0x20/0x09/0x3000 三种（全角空格在输入法里最常见），别的空白不动。
export function categoryProblem(raw, taken, customCount) {
  const name = String(raw ?? '').trim();
  if (name === '') return '先给它起个名字';
  for (const ch of name) {
    const c = ch.codePointAt(0);
    if (c === 0x20 || c === 0x09 || c === 0x3000) {
      return '名字里不要留空格（后面筛选、语音都要用它）';
    }
  }
  if ([...name].length > MAX_CATEGORY_NAME_LEN) return `名字最多 ${MAX_CATEGORY_NAME_LEN} 个字`;
  if (taken.has(name)) return `已经有叫「${name}」的分类了`;
  if (customCount >= MAX_CUSTOM_CATEGORIES) {
    return `自定义分类最多 ${MAX_CUSTOM_CATEGORIES} 个，先删掉不用的`;
  }
  return null;
}

/// 「，、;/| 空格」都当分隔符；去重、剔纯数字与带金额字的词、限长。
/// 丢掉的词不静默：调用方要把结果原样回显成 chips，用户看得见自己输入了什么。
export function parseKeywords(raw) {
  const out = [];
  for (const part of String(raw ?? '').split(/[，,、;；/|\s]+/)) {
    const w = part.trim();
    if (w === '' || [...w].length > MAX_KEYWORD_LEN) continue;
    if (/^[0-9０-９.]+$/.test(w)) continue;
    if ([...w].some((ch) => MONEY_CHARS.includes(ch))) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/// 生效分类表 = 内置（去掉停用的，保持词典顺序）+ 自定义（按加入顺序）。
/// `custom` 里的每一项是 {name, emoji, words[]}——words 是已经过 parseKeywords 的那份。
export function mergeCategories(disabled = new Set(), custom = []) {
  return [
    ...CATEGORIES.filter((c) => !disabled.has(c.name)),
    ...custom.map((c) => ({
      name: c.name,
      emoji: c.emoji || DEFAULT_CATEGORY_ICON,
      words: [...(c.words ?? [])],
      custom: true,
    })),
  ];
}

/// 停用一个分类是否安全：至少得留一个能选的，否则确认卡没有落账的入口。
export function disableProblem(name, active, builtinNames) {
  if (!builtinNames.has(name)) return '自定义分类直接删掉就行，不用停用';
  // 「其他」是解析认不出来时的落点，停掉它等于让账没有地方记
  if (name === '其他') return '「其他」是兜底分类，不能停用';
  if (active.length <= 1) return '至少要留一个分类，不然没地方记账';
  return null;
}

/// 删掉自定义分类前必须回答的问题：还有几笔挂在它上面。删分类**不动流水**。
/// `fallbacks` 由调用方从 taxonomy 那侧读来（这里不 import 那棵树，谁 import 谁成环——同 Dart）。
export function deleteProblem(name, usedCount, fallbacks) {
  if (usedCount <= 0) return null;
  if (!fallbacks || fallbacks.length === 0) {
    return `还有 ${usedCount} 笔记在「${name}」下；这些笔记的方向不在分类体系里，删掉分类也不会挪动它们。`;
  }
  const to = fallbacks.map((f) => `「${f}」`).join('、');
  return `还有 ${usedCount} 笔记在「${name}」下；删掉分类后这些账还在，只是归到${to}。`;
}

// —— 运行时生效表（解析器与所有选择器读这里，不再直接读 CATEGORIES）——
// 🔴 这一份与 Dart 的 `_active` 是同一个角色：改它必须走 setActiveCategories，
// 任何界面自己拼一张表，就是在开第二份算分类的口径。
let _active = mergeCategories();
let _activeKinds = {};

export const activeCategories = () => _active;
export const activeCategoryKinds = () => _activeKinds;
export const builtinCategoryNames = () => new Set(CATEGORIES.map((c) => c.name));

/// 装一次生效表。清空了（脏数据/坏文件）就回退整张内置表——不能让记账没有落点。
export function setActiveCategories(disabled = new Set(), custom = [], customKinds = {}) {
  const next = mergeCategories(disabled, custom);
  _active = next.length === 0 ? mergeCategories() : next;
  _activeKinds = {};
  for (const c of custom) _activeKinds[c.name] = customKinds[c.name] ?? '';
  return _active;
}

/// 找不到就回退默认图标——停用的内置分类、导入来的陌生分类名都要能显示。
export function categoryIcon(name) {
  for (const c of _active) if (c.name === name) return c.emoji;
  for (const c of CATEGORIES) if (c.name === name) return c.emoji;
  return DEFAULT_CATEGORY_ICON;
}

/// 名字现在能不能用：用户停用了「数码」，「买手机」就不该再被硬塞回数码。
export function isActiveCategory(name) {
  return _active.some((c) => c.name === name);
}
