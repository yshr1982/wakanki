// 文字列変換の純粋関数。content script とテストの両方から使う。
// 先に src/data/kanji-map.js と src/data/kana-rules.js を読み込んでおくこと。
(function (root) {
  'use strict';

  const kanjiMap = new Map(Object.entries(root.CJ2JA_KANJI_MAP || {}));

  function escapeClass(c) {
    return /[\\\]^-]/.test(c) ? '\\' + c : c;
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 熟語（1 字ずつでは決まらないもの）は先頭の字ごとに、長い順に並べておく
  const phrasesByHead = new Map();
  for (const [from, to] of Object.entries(root.CJ2JA_PHRASE_MAP || {})) {
    const chars = [...from];
    if (!phrasesByHead.has(chars[0])) phrasesByHead.set(chars[0], []);
    phrasesByHead.get(chars[0]).push({ chars, to });
  }
  for (const list of phrasesByHead.values()) list.sort((a, b) => b.chars.length - a.chars.length);

  // 変換が必要な字を含むかの判定に使う正規表現
  const kanjiPattern = new RegExp(
    '[' + [...new Set([...kanjiMap.keys(), ...phrasesByHead.keys()])].map(escapeClass).join('') + ']',
    'u',
  );

  function matchPhrase(chars, i) {
    const list = phrasesByHead.get(chars[i]);
    if (!list) return null;
    for (const p of list) {
      let ok = i + p.chars.length <= chars.length;
      for (let k = 1; ok && k < p.chars.length; k++) ok = chars[i + k] === p.chars[k];
      if (ok) return p;
    }
    return null;
  }

  /** 簡体字・繁体字を日本の字体に置き換える（モード1） */
  function convertKanji(text) {
    if (!kanjiPattern.test(text)) return text;
    const chars = [...text];
    let out = '';
    for (let i = 0; i < chars.length; ) {
      const p = matchPhrase(chars, i);
      if (p) {
        out += p.to;
        i += p.chars.length;
      } else {
        out += kanjiMap.get(chars[i]) ?? chars[i];
        i++;
      }
    }
    return out;
  }

  const hanPattern = /\p{Script=Han}/u;

  /** 漢字を含むか（変換の必要がないテキストを素早く飛ばすため） */
  function hasHan(text) {
    return hanPattern.test(text);
  }

  // ルールのキーは簡体・繁体・日本字体のどれで書いても、モード1の結果に合うように正規化する
  const kanaRules = new Map();
  for (const [from, to] of Object.entries(root.CJ2JA_KANA_RULES || {})) {
    kanaRules.set(convertKanji(from), to);
  }
  const protectedWords = new Set((root.CJ2JA_KANA_PROTECT || []).map(convertKanji));

  // 保護語 → ルール の順に、長い語ほど先に照合する（最長一致）
  const kanaPattern = new RegExp(
    [...new Set([...protectedWords, ...kanaRules.keys()])]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|'),
    'gu',
  );

  /** 機能語の漢字をひらがなにする（モード2）。モード1の結果に対して使う */
  function toHiragana(text) {
    if (kanaRules.size === 0) return text;
    return text.replace(kanaPattern, (w) => (protectedWords.has(w) ? w : kanaRules.get(w)));
  }

  /**
   * @param {string} text
   * @param {{kanji?: boolean, kana?: boolean}} opts kana はモード1が有効なときだけ効く
   */
  function convert(text, opts) {
    if (!opts || !opts.kanji) return text;
    const converted = convertKanji(text);
    return opts.kana ? toHiragana(converted) : converted;
  }

  root.CJ2JA = { convert, convertKanji, toHiragana, hasHan };
})(typeof globalThis !== 'undefined' ? globalThis : this);
