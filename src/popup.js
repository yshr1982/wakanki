'use strict';

const DEFAULTS = { kanji: true, kana: false, font: true, kunten: false, okuri: true, disabledHosts: [] };
const $ = (id) => document.getElementById(id);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function hostOf(tab) {
  try {
    const url = new URL(tab.url);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:' ? url.hostname : null;
  } catch {
    return null;
  }
}

function render(settings, host) {
  $('kanji').checked = settings.kanji;
  $('kana').checked = settings.kana;
  $('kana').disabled = !settings.kanji || settings.kunten;
  $('kunten').checked = settings.kunten;
  $('kunten').disabled = !settings.kanji;
  $('okuri').checked = settings.okuri;
  $('okuri').disabled = !settings.kanji || !settings.kunten;
  $('font').checked = settings.font;
  $('font').disabled = !settings.kanji;
  $('site').checked = host !== null && settings.disabledHosts.includes(host);
  $('site').disabled = host === null;
  $('host').textContent = host === null ? 'このページでは使えません' : host || 'ローカルファイル';
}

async function main() {
  const tab = await activeTab();
  const host = tab ? hostOf(tab) : null;
  let settings = await chrome.storage.sync.get(DEFAULTS);
  render(settings, host);

  async function save(patch) {
    settings = { ...settings, ...patch };
    await chrome.storage.sync.set(settings);
    render(settings, host);
  }

  $('kanji').addEventListener('change', (e) => save({ kanji: e.target.checked }));
  $('kana').addEventListener('change', (e) => save({ kana: e.target.checked }));
  $('font').addEventListener('change', (e) => save({ font: e.target.checked }));
  $('kunten').addEventListener('change', (e) => save({ kunten: e.target.checked }));
  $('okuri').addEventListener('change', (e) => save({ okuri: e.target.checked }));
  $('site').addEventListener('change', (e) => {
    const others = settings.disabledHosts.filter((h) => h !== host);
    save({ disabledHosts: e.target.checked ? [...others, host] : others });
  });
  $('restore').addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'cj2ja:restore' });
      $('status').textContent = '元に戻しました（再読み込みで再び変換します）';
    } catch {
      $('status').textContent = 'このページでは使えません';
    }
  });
}

main();
