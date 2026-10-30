// ページ内のテキストノード（<title> を含む）を変換する。元の文字列は保持し、OFF にすると戻す。
(function () {
  'use strict';

  const { convert, hasHan } = globalThis.CJ2JA;
  const font = globalThis.CJ2JA_FONT;
  const kunten = globalThis.CJ2JA_KUNTEN_DOM;
  const DEFAULTS = { kanji: true, kana: false, font: true, kunten: false, okuri: true, disabledHosts: [] };
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'CODE', 'KBD', 'SAMP', 'TEMPLATE', 'SVG', 'MATH']);

  /** @type {Map<Text, {original: string, converted: string}>} */
  const touched = new Map();
  let opts = { kanji: false, kana: false };
  let fontOn = false;
  let kuntenOn = false;
  let okuriOn = true;
  let observer = null;

  function isSkipped(node) {
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (SKIP_TAGS.has(el.tagName.toUpperCase()) || el.isContentEditable || el.classList.contains(kunten.CLASS)) return true;
    }
    return false;
  }

  function convertNode(node) {
    const record = touched.get(node);
    // ページ側が書き換えた場合は、その新しい文字列を元の文字列とみなす
    const original = record && node.nodeValue === record.converted ? record.original : node.nodeValue;
    if (!original || !hasHan(original) || isSkipped(node)) return;
    const converted = convert(original, opts);
    if (converted === original) {
      if (record) restoreNode(node);
      return;
    }
    touched.set(node, { original, converted });
    if (node.nodeValue !== converted) node.nodeValue = converted;
  }

  function restoreNode(node) {
    const record = touched.get(node);
    if (record && node.nodeValue === record.converted) node.nodeValue = record.original;
    touched.delete(node);
  }

  function walk(root) {
    if (root.nodeType === Node.TEXT_NODE) return convertNode(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) convertNode(n);
  }

  /** 返り点を付ける対象（漢字を含み、除外する要素の中でないテキストノード） */
  function kuntenTargets(root) {
    const nodes = [];
    if (root.nodeType === Node.TEXT_NODE) {
      if (hasHan(root.nodeValue) && !isSkipped(root)) nodes.push(root);
      return nodes;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (hasHan(n.nodeValue) && !isSkipped(n)) nodes.push(n);
    return nodes;
  }

  function requestKunten(root) {
    const nodes = kuntenTargets(root);
    if (nodes.length) kunten.request(nodes, (n) => touched.get(n)?.original ?? n.nodeValue, withoutObserver, { okuri: okuriOn });
  }

  function withoutObserver(fn) {
    if (observer) observer.disconnect();
    try {
      fn();
    } finally {
      if (observer && opts.kanji) observe();
    }
  }

  function observe() {
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  }

  function onMutations(mutations) {
    const added = [];
    withoutObserver(() => {
      for (const m of mutations) {
        if (m.type === 'characterData') convertNode(m.target);
        else
          for (const n of m.addedNodes) {
            if (n.nodeType === Node.TEXT_NODE) walk(n);
            else if (n.nodeType === Node.ELEMENT_NODE) {
              walk(n);
              if (fontOn) font.fixLang(n);
            } else continue;
            added.push(n);
          }
      }
      // ページが <head> を作り直してフォント指定が消えたら入れ直す
      if (fontOn && !document.getElementById(font.STYLE_ID)) font.enable();
    });
    if (kuntenOn) for (const n of added) if (n.isConnected) requestKunten(n);
  }

  function restoreAll() {
    withoutObserver(() => {
      kunten.removeAll();
      kuntenOn = false;
      for (const node of [...touched.keys()]) restoreNode(node);
      font.disable();
      fontOn = false;
    });
  }

  function apply(settings) {
    const enabled = settings.kanji && !settings.disabledHosts.includes(location.hostname);
    // 返り点は語順を示すものなので、字を置き換えるひらがな化とは同時に使わない
    opts = { kanji: enabled, kana: enabled && settings.kana && !settings.kunten };
    if (!observer) observer = new MutationObserver(onMutations);
    if (!enabled) {
      observer.disconnect();
      restoreAll();
      return;
    }
    withoutObserver(() => {
      // モードが変わったときは、返り点を外し、元の文字列から変換し直す
      kunten.removeAll();
      for (const node of [...touched.keys()]) {
        if (!node.isConnected) touched.delete(node);
        else convertNode(node);
      }
      walk(document.documentElement);
      fontOn = settings.font;
      if (fontOn) font.enable();
      else font.disable();
    });
    kuntenOn = settings.kunten;
    okuriOn = settings.okuri;
    if (kuntenOn) requestKunten(document.documentElement);
  }

  function load() {
    chrome.storage.sync.get(DEFAULTS, apply);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') load();
  });

  // popup の「元に戻す」: このタブだけ一時的に元へ戻す（再読込で再び変換）
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'cj2ja:restore') {
      opts = { kanji: false, kana: false };
      if (observer) observer.disconnect();
      restoreAll();
      sendResponse({ ok: true });
    } else if (msg && msg.type === 'cj2ja:reapply') {
      load();
      sendResponse({ ok: true });
    }
  });

  load();
})();
