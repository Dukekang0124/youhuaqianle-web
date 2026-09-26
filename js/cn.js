// 中文数字与文本规范化 —— 1:1 移植自 app/lib/core/cn_numbers.dart，口径以 Dart 为真源
export const cnDigits = {
  零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 贰: 2, 两: 2, 俩: 2,
  三: 3, 叁: 3, 四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6,
  七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9,
};
export const cnUnits = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };
export const cnBig = { 万: 10000, 亿: 100000000 };
export const cnNumChars = '零〇一二两俩三四五六七八九十百千万';

export function cn2num(raw) {
  const s = String(raw).trim();
  if (!s) return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+(\.\d+)?$/.test(s)) return Math.trunc(parseFloat(s));
  for (const c of s) {
    if (!(c in cnDigits) && !(c in cnUnits) && !(c in cnBig)) return null;
  }
  let total = 0, section = 0, num0 = 0;
  let seen = false;
  for (const c of s) {
    if (c in cnDigits) {
      num0 = cnDigits[c];
      seen = true;
    } else if (c in cnUnits) {
      section += (num0 === 0 ? 1 : num0) * cnUnits[c];
      num0 = 0;
      seen = true;
    } else if (c in cnBig) {
      section = section + num0 === 0 ? 1 : section + num0;
      total += section * cnBig[c];
      section = 0;
      num0 = 0;
      seen = true;
    }
  }
  const v = total + section + num0;
  return seen ? v : null;
}

export function normalizeText(text) {
  let t = String(text).replace(/[０-９]/g, (m) =>
    String.fromCharCode(m.charCodeAt(0) - 0xff10 + 48),
  );
  t = t.replace(/[．。]/g, '。').replace(/\s+/g, ' ').trim();
  return t;
}
