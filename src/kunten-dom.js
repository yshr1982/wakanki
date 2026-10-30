// 返り点と送り仮名をページに表示する（content script 側）。
// テキストノードを <span class="cj2ja-kunten">文字<sup class="cj2ja-okuri">ヲ</sup><sub class="cj2ja-kaeri">レ</sub>…</span> に置き換え、
// 元のテキストノードを覚えておいて、OFF にしたら戻す。
(function (root) {
  'use strict';

  const STYLE_ID = 'cj2ja-kunten-style';
  const CLASS = 'cj2ja-kunten';
  const MARK_CLASS = 'cj2ja-kaeri';
  const KANA_CLASS = 'cj2ja-okuri';
  const UNIT_CLASS = 'cj2ja-kunten-unit';
  const BATCH = 200;

  /** @type {Map<HTMLElement, Text>} */
  const spans = new Map();
  let generation = 0;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      `sub.${MARK_CLASS},sup.${KANA_CLASS}{font-size:.6em!important;line-height:0!important;margin:0 .02em!important;` +
      'font-weight:normal!important;font-style:normal!important;letter-spacing:0!important;opacity:.85;user-select:none;-webkit-user-select:none}' +
      `sub.${MARK_CLASS}{vertical-align:-.25em!important;margin-right:.08em!important}` +
      `sup.${KANA_CLASS}{vertical-align:.45em!important}` +
      `sup.${KANA_CLASS}+sub.${MARK_CLASS}{margin-left:-.1em!important}` +
      `.${UNIT_CLASS}{white-space:nowrap!important}`;
    (document.head || document.documentElement).append(style);
  }

  function small(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
  }

  function render(text, marks, okuri) {
    const chars = [...text];
    const span = document.createElement('span');
    span.className = CLASS;
    let pos = 0;
    for (const { offset, mark, kana } of marks) {
      if (offset <= pos || offset > chars.length) continue;
      if (!mark && !(okuri && kana)) continue;
      span.append(chars.slice(pos, offset - 1).join(''));
      // 送り仮名は字の右上、返り点は右下に小さく付ける。字と離れて改行されないよう 1 つにまとめる
      const unit = document.createElement('span');
      unit.className = UNIT_CLASS;
      unit.append(chars[offset - 1]);
      if (okuri && kana) unit.append(small('sup', KANA_CLASS, kana));
      if (mark) unit.append(small('sub', MARK_CLASS, mark));
      span.append(unit);
      pos = offset;
    }
    span.append(chars.slice(pos).join(''));
    return span;
  }

  /**
   * @param {Text[]} nodes 返り点を付けるテキストノード
   * @param {(node: Text) => string} originalOf 解析に使う元の文字列（変換前の中国語）
   * @param {(fn: () => void) => void} mutate DOM を書き換えるときに使う（MutationObserver を止める）
   * @param {{okuri?: boolean}} options okuri: 送り仮名も付ける
   */
  async function request(nodes, originalOf, mutate, { okuri = true } = {}) {
    const gen = generation;
    for (let i = 0; i < nodes.length; i += BATCH) {
      const batch = nodes.slice(i, i + BATCH).filter((n) => n.isConnected);
      if (!batch.length) continue;
      const shown = batch.map((n) => n.nodeValue);
      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: 'cj2ja:kunten', texts: batch.map(originalOf) });
      } catch {
        return;
      }
      if (gen !== generation || !res || !Array.isArray(res.marks)) return;
      mutate(() => {
        ensureStyle();
        batch.forEach((node, k) => {
          const marks = res.marks[k];
          const text = node.nodeValue;
          // 表示中の文字列が解析した文字列と同じ長さのときだけ付ける（ひらがな化などで長さが変わると位置がずれる）
          if (!marks || !marks.some((m) => m.mark || (okuri && m.kana)) || !node.isConnected || text !== shown[k] || [...text].length !== [...originalOf(node)].length) return;
          const span = render(text, marks, okuri);
          node.replaceWith(span);
          spans.set(span, node);
        });
      });
    }
  }

  function removeAll() {
    generation++;
    for (const [span, node] of spans) if (span.isConnected) span.replaceWith(node);
    spans.clear();
    document.getElementById(STYLE_ID)?.remove();
  }

  root.CJ2JA_KUNTEN_DOM = { request, removeAll, CLASS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
