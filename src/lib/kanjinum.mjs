// 漢数字と算用数字の相互変換。
// e-Gov 法令 XML では条番号が二通りで現れる:
//   - Article/@Num …… "17" / "4_2"(= 第四条の二)の機械表記
//   - ArticleTitle 本文 …… 「第十七条」「第四条の二」の漢数字表記
// 参照は本文中に漢数字で書かれるため、両者を突き合わせるには変換が要る。

const DIGIT = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const UNIT = { 十: 10, 百: 100, 千: 1000 };
const DIGIT_CHAR = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 漢数字文字列を整数へ。対応範囲は 1〜9999(法令の条番号はこの範囲に収まる)。 */
export function kanjiToInt(s) {
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const ch of s) {
    if (ch in DIGIT) {
      digit = DIGIT[ch];
    } else if (ch in UNIT) {
      section += (digit || 1) * UNIT[ch];
      digit = 0;
    } else {
      return null;
    }
  }
  total = section + digit;
  return total > 0 ? total : null;
}

/** 整数を漢数字文字列へ(1〜9999)。 */
export function intToKanji(n) {
  if (!Number.isInteger(n) || n <= 0 || n > 9999) return null;
  let out = "";
  for (const [unit, value] of [["千", 1000], ["百", 100], ["十", 10]]) {
    const q = Math.floor(n / value) % 10;
    if (q > 0) out += (q > 1 ? DIGIT_CHAR[q] : "") + unit;
  }
  const ones = n % 10;
  if (ones > 0) out += DIGIT_CHAR[ones];
  return out;
}

/**
 * 「第四条の二」→ "4_2"、「第十七条」→ "17"。
 * 枝番は何段でも受ける(「第九条の二の三」→ "9_2_3")。
 */
export function kanjiToArticleNum(label) {
  const m = /^第([一二三四五六七八九十百千]+)条((?:の[一二三四五六七八九十百千]+)*)$/.exec(label);
  if (!m) return null;
  const head = kanjiToInt(m[1]);
  if (head === null) return null;
  const branches = m[2] ? m[2].split("の").filter(Boolean).map(kanjiToInt) : [];
  if (branches.some((b) => b === null)) return null;
  return [head, ...branches].join("_");
}

/** "120_2" → 「第百二十条の二」。 */
export function articleNumToLabel(num) {
  const parts = String(num).split("_").map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => !Number.isInteger(p))) return null;
  const [head, ...branches] = parts;
  const kanji = intToKanji(head);
  if (kanji === null) return null;
  return `第${kanji}条` + branches.map((b) => `の${intToKanji(b)}`).join("");
}
