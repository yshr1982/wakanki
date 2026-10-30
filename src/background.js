// 返り点の解析を行う service worker。辞書（約 2MB）は返り点を ON にしたときだけ、1 度読み込む。
importScripts('data/t2s.js', 'kunten.js');

let analyzer = null;

function getAnalyzer() {
  analyzer ??= fetch(chrome.runtime.getURL('src/data/jieba-dict.txt'))
    .then((res) => res.text())
    .then((text) => globalThis.CJ2JA_KUNTEN.createAnalyzer(text, globalThis.CJ2JA_T2S));
  return analyzer;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || msg.type !== 'cj2ja:kunten' || !Array.isArray(msg.texts)) return false;
  getAnalyzer().then(
    (a) => sendResponse({ marks: msg.texts.map((t) => (typeof t === 'string' ? a.marks(t) : [])) }),
    () => sendResponse({ marks: [] }),
  );
  return true; // 非同期に返す
});
