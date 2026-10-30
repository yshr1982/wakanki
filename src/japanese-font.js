// 変換後の漢字を日本語の字形で表示する。
// 同じ文字コードでも、ページが中国語（lang="zh" や中国語フォントの指定）だと「化」「術」などが中国の字形で描かれるため、
// (1) lang を ja にし、(2) よく使われる中国語フォント名を @font-face で日本語フォントに差し替える。
// 差し替えは漢字・かな・全角記号の範囲だけに限るので、英数字やアイコンフォントには影響しない。
(function (root) {
  'use strict';

  const STYLE_ID = 'cj2ja-japanese-font';
  const LANG_ATTR = 'data-cj2ja-lang';

  // 漢字・かな・CJK 記号・全角形
  const UNICODE_RANGE = 'U+2E80-2FDF, U+3000-30FF, U+31F0-31FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FE30-FE4F, U+FF00-FFEF, U+20000-3FFFF';

  // local() にはフォントのフルネームか PostScript 名を書く（Mac / Windows / Linux の順）
  const JA_FONTS = {
    sans: {
      normal: ['Hiragino Sans W3', 'HiraginoSans-W3', 'Hiragino Kaku Gothic ProN W3', 'HiraKakuProN-W3', 'Yu Gothic Medium', 'YuGothic-Medium', 'Meiryo', 'Noto Sans CJK JP Regular', 'NotoSansCJKjp-Regular', 'Noto Sans JP Regular', 'NotoSansJP-Regular', 'Source Han Sans JP Regular', 'SourceHanSansJP-Regular', 'IPAexGothic', 'IPAPGothic', 'IPAGothic', 'MS PGothic'],
      bold: ['Hiragino Sans W6', 'HiraginoSans-W6', 'Hiragino Kaku Gothic ProN W6', 'HiraKakuProN-W6', 'Yu Gothic Bold', 'YuGothic-Bold', 'Meiryo Bold', 'Noto Sans CJK JP Bold', 'NotoSansCJKjp-Bold', 'Noto Sans JP Bold', 'NotoSansJP-Bold', 'Source Han Sans JP Bold', 'SourceHanSansJP-Bold'],
    },
    serif: {
      normal: ['Hiragino Mincho ProN W3', 'HiraMinProN-W3', 'Yu Mincho Regular', 'YuMincho-Regular', 'Noto Serif CJK JP Regular', 'NotoSerifCJKjp-Regular', 'Noto Serif JP Regular', 'NotoSerifJP-Regular', 'Source Han Serif JP Regular', 'SourceHanSerifJP-Regular', 'IPAexMincho', 'IPAPMincho', 'IPAMincho', 'MS PMincho'],
      bold: ['Hiragino Mincho ProN W6', 'HiraMinProN-W6', 'Yu Mincho Demibold', 'YuMincho-Demibold', 'Noto Serif CJK JP Bold', 'NotoSerifCJKjp-Bold', 'Noto Serif JP Bold', 'NotoSerifJP-Bold', 'Source Han Serif JP Bold', 'SourceHanSerifJP-Bold'],
    },
  };

  // 中国語ページでよく指定されるフォント名
  const ZH_FONTS = {
    sans: [
      'Microsoft YaHei', 'Microsoft YaHei UI', '微软雅黑', 'Microsoft JhengHei', 'Microsoft JhengHei UI', '微軟正黑體',
      'PingFang SC', 'PingFang TC', 'PingFang HK', '苹方', '蘋方', 'Hiragino Sans GB', '冬青黑体简体中文',
      'Heiti SC', 'Heiti TC', 'STHeiti', '华文黑体', 'SimHei', '黑体', '黑體',
      'Noto Sans SC', 'Noto Sans TC', 'Noto Sans HK', 'Noto Sans CJK SC', 'Noto Sans CJK TC', 'Noto Sans CJK HK',
      'Source Han Sans SC', 'Source Han Sans TC', 'Source Han Sans CN', 'Source Han Sans TW', 'Source Han Sans HK', '思源黑体', '思源黑體',
      'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei', '文泉驿微米黑', '文泉驿正黑', 'Droid Sans Fallback', 'HarmonyOS Sans SC', 'MiSans',
    ],
    serif: [
      'SimSun', 'NSimSun', '宋体', '新宋体', 'Songti SC', 'Songti TC', 'STSong', '华文宋体', 'FangSong', '仿宋', 'STFangsong',
      'KaiTi', '楷体', 'STKaiti', '华文楷体', 'Kaiti SC', 'Kaiti TC', 'DFKai-SB', '標楷體', 'BiauKai',
      'PMingLiU', 'MingLiU', '新細明體', '細明體', 'Noto Serif SC', 'Noto Serif TC', 'Noto Serif CJK SC', 'Noto Serif CJK TC',
      'Source Han Serif SC', 'Source Han Serif TC', 'Source Han Serif CN', '思源宋体', '思源宋體',
    ],
  };

  function quote(name) {
    return '"' + name.replace(/["\\]/g, '\\$&') + '"';
  }

  function face(family, locals, weight) {
    return `@font-face{font-family:${quote(family)};src:${locals.map((n) => `local(${quote(n)})`).join(',')};font-weight:${weight};unicode-range:${UNICODE_RANGE};}`;
  }

  /**
   * @param {{sans?: boolean, serif?: boolean}} bold 太字の日本語フォントがある種類
   * 太字の face を作らなければ 1-549 の face が使われ、Chrome が擬似太字にする
   */
  function buildCss(bold = {}) {
    let css = '';
    for (const kind of ['sans', 'serif']) {
      for (const family of ZH_FONTS[kind]) {
        css += face(family, JA_FONTS[kind].normal, '1 549');
        if (bold[kind]) css += face(family, JA_FONTS[kind].bold, '550 1000');
      }
    }
    return css;
  }

  /** 太字の日本語フォントがこの PC にあるかを調べる */
  async function detectBold() {
    const result = {};
    for (const kind of ['sans', 'serif']) {
      const src = JA_FONTS[kind].bold.map((n) => `local(${quote(n)})`).join(',');
      try {
        await new FontFace('cj2ja-probe-' + kind, src).load();
        result[kind] = true;
      } catch {
        result[kind] = false;
      }
    }
    return result;
  }

  let boldPromise = null;

  function isChineseLang(value) {
    return /^zh(-|$)/i.test(value || '');
  }

  /** root 以下（root を含む）の lang="zh*" を ja にする。元の値は属性に残す */
  function fixLang(rootEl) {
    if (!rootEl || rootEl.nodeType !== 1) return;
    const targets = rootEl.matches('[lang]') ? [rootEl] : [];
    targets.push(...rootEl.querySelectorAll('[lang]'));
    for (const el of targets) {
      const lang = el.getAttribute('lang');
      if (!isChineseLang(lang)) continue;
      el.setAttribute(LANG_ATTR, lang);
      el.setAttribute('lang', 'ja');
    }
  }

  function enable() {
    const html = document.documentElement;
    if (!html.hasAttribute(LANG_ATTR) && (!html.hasAttribute('lang') || isChineseLang(html.getAttribute('lang')))) {
      // lang がないページも、中国語として描かれることがあるので ja を付ける
      html.setAttribute(LANG_ATTR, html.getAttribute('lang') ?? '');
      html.setAttribute('lang', 'ja');
    }
    fixLang(html);
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = buildCss();
      // ページ側の @font-face より後に置く（同じ名前なら後のものが優先される）
      (document.head || html).append(style);
      boldPromise ??= detectBold();
      boldPromise.then((bold) => {
        if (bold.sans || bold.serif) style.textContent = buildCss(bold);
      });
    }
  }

  function disable() {
    document.getElementById(STYLE_ID)?.remove();
    for (const el of document.querySelectorAll(`[${LANG_ATTR}]`)) {
      const lang = el.getAttribute(LANG_ATTR);
      if (lang) el.setAttribute('lang', lang);
      else el.removeAttribute('lang');
      el.removeAttribute(LANG_ATTR);
    }
  }

  root.CJ2JA_FONT = { enable, disable, fixLang, buildCss, STYLE_ID };
})(typeof globalThis !== 'undefined' ? globalThis : this);
