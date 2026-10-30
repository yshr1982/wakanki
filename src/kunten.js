// 現代中国語の文に返り点（レ点・一二点・上下点・甲乙点）と送り仮名（助詞）を付ける。
// 1. jieba と同じ方式（辞書＋最大確率の経路）で単語に分け、辞書の品詞を付ける。
// 2. 「動詞＋目的語」「介詞＋名詞」「否定・助動詞＋動詞句」などを規則で見つけ、日本語で読む順を決める。
// 3. 読む順から返り点を決める。
// 純粋関数のみ。background（service worker）とテストから使う。
(function (root) {
  'use strict';

  // 辞書の品詞が、この用途に合わないものを上書きする
  const TAG_OVERRIDES = {
    不是: 'd', 不要: 'd', 不能: 'd', 不会: 'd', 不可: 'd', 不想: 'd', 不敢: 'd', 不用: 'd', 不必: 'd', 不再: 'd', 没: 'd', 没有: 'd', 无法: 'd',
    很: 'd', 太: 'd', 更: 'd', 最: 'd', 可以: 'v', 可: 'v', 东西: 'n', 应该: 'v', 必须: 'v',
    以后: 'c', 以前: 'c', 之后: 'c', 之前: 'c', 以来: 'c', 的时候: 'c', 时: 'c', 阻抗: 'n', 见面: 'v',
    为了: 'p', 对于: 'p', 关于: 'p', 由于: 'c', 除了: 'p', 通过: 'p', 根据: 'p', 按照: 'p',
  };

  // 否定（後ろの動詞句・形容詞を先に読む）
  const NEG = new Set(['不', '没', '没有', '未', '别', '莫', '勿', '不要', '不用', '不必', '不能', '不会', '不可', '不是', '不敢', '不想', '不再', '无法']);
  // 使役・兼語（人＋動作を先に読む）
  const CAUSATIVE = new Set(['让', '使', '叫', '令', '请', '派', '要求', '允许', '帮', '帮助', '教', '劝', '逼', '命令', '鼓励', '禁止']);
  // 文を目的語にとる動詞（後ろの節全体を先に読む）
  const CLAUSE_VERBS = new Set([
    '知道', '觉得', '认为', '以为', '相信', '希望', '说', '听说', '发现', '看见', '看到', '听到', '感到', '感觉', '表示',
    '担心', '怕', '害怕', '怀疑', '记得', '忘记', '忘了', '明白', '了解', '承认', '证明', '指出', '强调', '显示', '确定', '决定', '同意', '想',
  ]);
  // 名詞句の中で語をつなぐ接続詞（それ以外の接続詞は節の切れ目）
  const COORD = new Set(['和', '与', '及', '以及', '或', '或者', '跟', '同']);
  // 動詞の後ろに来る介詞（住在北京 → 北京に住む）
  const POST_VERB_PREP = new Set(['在', '到', '至', '给', '向', '往', '于', '自', '成', '为']);
  // 送り仮名（返る直前に読む語に付ける助詞）。介詞は意味で決める
  const PREP_KANA = {
    在: 'ニ', 于: 'ニ', 对: 'ニ', 对于: 'ニ', 向: 'ニ', 往: 'ニ', 朝: 'ニ', 给: 'ニ', 被: 'ニ', 让: 'ニ', 关于: 'ニ', 当: 'ニ',
    根据: 'ニ', 按照: 'ニ', 依照: 'ニ', 随着: 'ニ', 随著: 'ニ', 沿着: 'ニ', 针对: 'ニ', 面向: 'ニ', 基于: 'ニ', 作为: 'ト',
    从: 'ヨリ', 自: 'ヨリ', 由: 'ヨリ', 自从: 'ヨリ', 比: 'ヨリ', 离: 'ヨリ', 到: 'マデ', 至: 'マデ', 直到: 'マデ',
    跟: 'ト', 和: 'ト', 与: 'ト', 同: 'ト', 把: 'ヲ', 将: 'ヲ', 用: 'ヲ', 以: 'ヲ', 通过: 'ヲ', 除了: 'ヲ', 经过: 'ヲ',
    为: 'ノ為ニ', 为了: 'ノ為ニ',
  };
  // 目的語の助詞が「ヲ」以外になる動詞（是・有 は付けない）
  const VERB_KANA = {
    是: '', 有: '', 没有: '', 在: '', 作为: 'ト', 去: 'ニ', 来: 'ニ', 到: 'ニ', 回: 'ニ', 进: 'ニ', 进入: 'ニ', 住: 'ニ', 坐: 'ニ', 骑: 'ニ',
    像: 'ニ', 见: 'ニ', 遇到: 'ニ', 参加: 'ニ', 加入: 'ニ', 属于: 'ニ', 位于: 'ニ', 成为: 'ト', 变成: 'ト', 成: 'ト', 当: 'ト', 叫: 'ト',
  };
  // 文を目的語にとる動詞のうち「と」で受けるもの（思う・言う）
  const QUOTE_VERBS = new Set(['觉得', '认为', '以为', '相信', '希望', '说', '听说', '表示', '感到', '感觉', '担心', '怕', '害怕', '怀疑', '强调', '指出', '承认', '想']);
  const QUESTION = /^(什么|谁|哪|哪里|哪儿|哪个|怎么|怎样|为什么|几|多少|如何|是否|吗)$/;

  function verbKana(word) {
    if (word in VERB_KANA) return VERB_KANA[word];
    // 放在・送到・交给・走进 など、着く先をとる動詞
    if ([...word].length > 1 && /[在到给进向往入至]$/.test(word)) return 'ニ';
    return 'ヲ';
  }

  // 目的語にならない量（看一下・去一次）
  const VERBAL_MEASURE = /^(一下|一下儿|一次|一遍|一趟|一回|一会|一会儿|下|次|遍|趟|回)$/;

  const MARK_SERIES = [
    ['一', '二', '三', '四', '五', '六', '七', '八', '九'],
    ['上', '中', '下'],
    ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'],
    ['天', '地', '人'],
  ];

  const HAN = /\p{Script=Han}/u;
  const WORD_CHAR = /[\p{L}\p{N}_]/u;
  // 名詞化した動作を目的語にとりやすい動詞。後ろの「動詞＋名詞」を複合名詞の目的語とみなす（制定驾驶策略・支持充电电池）
  const NOMINAL_OBJ_VERBS = new Set([
    '进行', '制定', '实现', '提供', '支持', '加强', '完成', '开展', '推进', '推动', '促进', '生成', '构建', '采用', '包括', '包含',
    '具有', '拥有', '获得', '取得', '实施', '落实', '做出', '作出', '加快', '引起', '导致', '涉及', '依赖', '配置', '整合', '集成',
    '提升', '提高', '优化', '满足', '保证', '确保', '影响', '决定', '面临', '解决', '聚焦', '关注', '研究', '分析', '介绍', '简述',
  ]);
  // 1 字でも独立して使う動詞・形容詞（未知語の字をまとめるときに対象外にする）
  const FREE_SINGLE = new Set([...'是有在去来说看吃喝买卖用给让被把到做要会能可想应需将对找等叫听写读学教问送带拿放开关打玩住坐跑飞回进出上下过起变成为当帮请使令知懂爱怕好大小多少高低长短新旧快慢早晚难易很太更最都也还就才又再已只共与和及或从向往比由于以而且但却并即若如因故则乃之其此该各每某另']);

  function isNounish(t) {
    return /^(n|r|m|q|t|s|f|b|an|vn|j|eng|g)/.test(t.tag) && !(t.tag === 'r' && /^(怎么|怎样|怎么样|为什么|如何)$/.test(t.word));
  }
  const isVerb = (t) => /^v(?!n|i)/.test(t.tag);
  const isAdj = (t) => /^(a|z)/.test(t.tag) && t.tag !== 'an';
  const isPrep = (t) => t.tag === 'p';
  // 将: 後ろが名詞なら「把」と同じ介詞（将指令转化为…）、それ以外は「〜するだろう」の副詞
  const disposalJiang = (tokens, i) => tokens[i].word === '将' && i + 1 < tokens.length && isNounish(tokens[i + 1]);
  const isAspect = (t) => t.tag === 'ul' || t.tag === 'uz' || t.tag === 'ug';
  const isDe = (t) => t.tag === 'uj';
  const isAdverbialDe = (t) => t.tag === 'uv' || t.tag === 'ud';
  const isNeg = (t) => NEG.has(t.word);
  // 節の切れ目（句読点・語気詞・名詞をつながない接続詞・感動詞）
  const isBoundary = (t) => !NEG.has(t.word) && t.word !== '、' && (t.tag === 'x' || t.tag === 'y' || t.tag === 'e' || t.tag === 'o' || (t.tag === 'c' && !COORD.has(t.word)));

  function createAnalyzer(dictText, t2s = {}) {
    const freq = new Map();
    const tags = new Map();
    let total = 0;
    let maxLen = 1;
    for (const line of dictText.split('\n')) {
      if (!line || line[0] === '#') continue;
      const [word, f, tag] = line.split(' ');
      const n = Number(f);
      freq.set(word, n);
      tags.set(word, TAG_OVERRIDES[word] || tag);
      total += n;
      maxLen = Math.max(maxLen, [...word].length);
    }
    maxLen = Math.min(maxLen, 8);
    // 繁体字の「著」は「着」の意味でも使うため、よく使う語を補う（隨著 → 随著）
    for (const [word, tag] of [['随著', 'p'], ['接著', 'c'], ['跟著', 'v'], ['看著', 'v'], ['說著', 'v'], ['为著', 'p']]) {
      if (!freq.has(word)) {
        freq.set(word, 1000);
        tags.set(word, tag);
        total += 1000;
      }
    }
    const logTotal = Math.log(total);

    /** 漢字の並び（配列）を単語に分ける */
    function segmentHan(chars) {
      const n = chars.length;
      const best = new Float64Array(n + 1);
      const next = new Int32Array(n);
      for (let i = n - 1; i >= 0; i--) {
        best[i] = -Infinity;
        let word = '';
        for (let j = i; j < Math.min(n, i + maxLen); j++) {
          word += chars[j];
          let f = freq.get(word);
          if (f === undefined) {
            if (j !== i) continue;
            f = 1;
          }
          const score = Math.log(f) - logTotal + best[j + 1];
          if (score > best[i]) {
            best[i] = score;
            next[i] = j + 1;
          }
        }
      }
      const words = [];
      for (let i = 0; i < n; i = next[i]) words.push(chars.slice(i, next[i]).join(''));
      return words;
    }

    /** 文字列を {word, tag, start, end}（start/end は code point の位置）の並びにする */
    /**
     * 辞書にない語（引脚・载板・算力 など）は 1 字ずつに分かれ、「動詞＋目的語」と誤って読まれる。
     * 独立して使う字（FREE_SINGLE）以外の名詞・動詞・形容詞の 1 字が 2 つ以上続いたら、1 つの名詞にまとめる。
     */
    function mergeUnknown(run) {
      const mergeable = (t) => t.end - t.start === 1 && /^(n|v|a|b|g|ng|vg|ag|an|vn|nr|nz|z)/.test(t.tag) && !FREE_SINGLE.has(t.word) && !NEG.has(t.word);
      const out = [];
      for (let k = 0; k < run.length; ) {
        let m = k;
        while (m < run.length && mergeable(run[m])) m++;
        if (m - k >= 2) {
          out.push({ word: run.slice(k, m).map((t) => t.word).join(''), tag: 'n', start: run[k].start, end: run[m - 1].end });
          k = m;
        } else {
          out.push(run[k]);
          k++;
        }
      }
      return out;
    }

    function tokenize(text) {
      const chars = [...text].map((c) => t2s[c] || c);
      const tokens = [];
      let i = 0;
      while (i < chars.length) {
        let j = i;
        if (HAN.test(chars[i])) {
          while (j < chars.length && HAN.test(chars[j])) j++;
          let pos = i;
          const run = [];
          for (const word of segmentHan(chars.slice(i, j))) {
            const len = [...word].length;
            run.push({ word, tag: tags.get(word) || 'n', start: pos, end: pos + len });
            pos += len;
          }
          tokens.push(...mergeUnknown(run));
        } else if (WORD_CHAR.test(chars[i])) {
          const alnum = (c) => c !== undefined && WORD_CHAR.test(c) && !HAN.test(c);
          while (j < chars.length && (alnum(chars[j]) || (/[.\-]/.test(chars[j]) && alnum(chars[j - 1]) && alnum(chars[j + 1])))) j++;
          tokens.push({ word: chars.slice(i, j).join(''), tag: 'eng', start: i, end: j });
        } else if (/\s/.test(chars[i])) {
          j = i + 1;
          tokens.push({ word: chars[i], tag: 'w', start: i, end: j });
        } else {
          j = i + 1;
          tokens.push({ word: chars[i], tag: 'x', start: i, end: j });
        }
        i = j;
      }
      return tokens;
    }

    /** 単語の並びから「読む順」を表す木を作る */
    function parse(tokens) {
      const leaf = (i) => ({ leaf: i });
      // 空白は前後の語をつなぐものとして無視する
      const real = (i) => i < tokens.length && tokens[i].tag !== 'w';

      function clauseEnd(i, end) {
        while (i < end && !isBoundary(tokens[i])) i++;
        return i;
      }

      function parseSeq(i, end, inner, stopDe) {
        const items = [];
        while (i < end) {
          const t = tokens[i];
          if (inner && (isBoundary(t) || (stopDe && (isDe(t) || isAdverbialDe(t))))) break;
          const node = isBoundary(t) ? null : parseHead(i, inner ? end : clauseEnd(i, end));
          if (node) {
            items.push(node);
            i = node.next;
          } else {
            items.push(leaf(i));
            i++;
          }
        }
        return { items, next: i };
      }

      // asObject: 動詞の目的語のとき（句の終わりの 2 字以上の動詞を名詞とみなしてよい）
      function simpleNPEnd(i, end, asObject = false) {
        let j = i;
        while (j < end) {
          const t = tokens[j];
          const n = j + 1 < end ? tokens[j + 1] : null;
          const p = j > i ? tokens[j - 1] : null;
          const listed = (x) => x && (x.word === '、' || COORD.has(x.word));
          if (isNounish(t)) j++;
          // 感知、决策、执行 / 系统能力与开发效率: 並べられた動詞は名詞として扱う
          else if (isVerb(t) && (listed(p) || (listed(n) && n.word !== '跟' && n.word !== '同'))) j++;
          // 硬件设计・过孔设计: 名詞の後ろで句が終わる 2 字以上の動詞は名詞
          else if (isVerb(t) && p && isNounish(p) && [...t.word].length > 1 && (isDe(n || {}) || listed(n) || (asObject && (!n || isBoundary(n))))) j++;
          else if (isAdj(t) && n && (isNounish(n) || isDe(n))) j++;
          else if (j > i && (isDe(t) || t.word === '之') && n && (isNounish(n) || isAdj(n) || (isVerb(n) && j + 2 < end && isNounish(tokens[j + 2])))) j++;
          // 的抽象指令: 「的」の後ろで名詞を修飾する動詞
          else if (isVerb(t) && p && isDe(p) && n && isNounish(n)) j++;
          else if (j > i && (COORD.has(t.word) || t.word === '、') && n && (isNounish(n) || isVerb(n))) j++;
          else break;
        }
        return j;
      }

      function hasPredicate(i, end) {
        for (let k = i; k < end && !isBoundary(tokens[k]); k++) if (isVerb(tokens[k]) || isAdj(tokens[k]) || isNeg(tokens[k])) return true;
        return false;
      }

      // afterPrep: 介詞の後ろでは、修飾節の後にまだ述語が残るときだけ修飾節とみなす（在他住的地方见面 / 在东京开设了新的办公室）
      function parseNP(i, end, afterPrep = false) {
        const simple = simpleNPEnd(i, end, !afterPrep);
        // 連体修飾節（他写的书・很有意思的书）: 単純な名詞句の後に「…的＋名詞」が続けば、その前までを修飾節として解析する
        let rel = -1;
        for (let k = i; k < end && !isBoundary(tokens[k]); k++) {
          if (k >= simple && isDe(tokens[k]) && k + 1 < end && isNounish(tokens[k + 1])) rel = k;
        }
        if (rel >= 0) {
          const mod = parseSeq(i, rel, true, false);
          if (mod.next === rel) {
            const headEnd = simpleNPEnd(rel + 1, end);
            if (afterPrep && !hasPredicate(headEnd, end)) return plainNP(i, simple);
            const items = [...mod.items, leaf(rel)];
            for (let k = rel + 1; k < headEnd; k++) items.push(leaf(k));
            return { items, next: headEnd };
          }
        }
        return plainNP(i, simple);
      }

      function plainNP(i, j) {
        const items = [];
        for (let k = i; k < j; k++) items.push(leaf(k));
        return { items, next: j };
      }

      // kana: 送り仮名。comp.items の先頭 upto 個を読み終えたところ（返る直前の語）に付ける
      function node(head, comp, kana = '', upto = comp.items.length) {
        return { head, comp: comp.items, next: comp.next, kana, upto };
      }

      function parseHead(i, end) {
        const t = tokens[i];
        if (isNeg(t)) {
          const comp = parseSeq(i + 1, end, true, true);
          return comp.items.length ? node([i], comp) : null;
        }
        if (isPrep(t) || disposalJiang(tokens, i)) {
          // 化学与艺术: 名詞と名詞の間の 与・和 などは「と」でつなぐだけ（跟・同 は 我跟他说 のように介詞）
          if (/^(和|与|及|以及|或|或者)$/.test(t.word) && i > 0 && isNounish(tokens[i - 1]) && i + 1 < end && isNounish(tokens[i + 1])) return null;
          const comp = parseNP(i + 1, end, true);
          if (!comp.items.length) return null;
          let kana = PREP_KANA[t.word] ?? 'ニ';
          // 为: 後ろに動詞が続けば「ノ為ニ」（为工程师提供参考）、そうでなければ「ト」（转化为…・约为80毫秒）
          if (t.word === '为' && !(comp.next < end && (isVerb(tokens[comp.next]) || isNeg(tokens[comp.next])))) kana = 'ト';
          return node([i], comp, kana);
        }
        if (!isVerb(t)) return null;
        // 的计算处理平台・其计算平台是…: 「的」や 其・该 の直後の「動詞＋名詞／動詞」は名詞句の一部（这是… の 这 は主語なので含めない）
        const before = i > 0 ? tokens[i - 1] : null;
        if (before && (isDe(before) || /^(其|该|各|每)$/.test(before.word)) && i + 1 < end && (isNounish(tokens[i + 1]) || isVerb(tokens[i + 1]))) return null;
        // 動詞＋了・着・过 はまとめて 1 つの語として扱う
        let h = i + 1;
        while (h < end && isAspect(tokens[h])) h++;
        const head = [];
        for (let k = i; k < h; k++) head.push(k);
        if (h >= end || !real(h)) return null;
        const n = tokens[h];

        if (CAUSATIVE.has(t.word) && isNounish(n)) {
          const np = plainNP(h, simpleNPEnd(h, end));
          const rest = np.next < end && (isVerb(tokens[np.next]) || isNeg(tokens[np.next])) ? parseSeq(np.next, end, true, true) : { items: [], next: np.next };
          return node(head, { items: [...np.items, ...rest.items], next: rest.next }, 'ヲシテ', np.items.length);
        }
        const npEnd = simpleNPEnd(h, end);
        const npToEnd = npEnd > h && (npEnd >= end || isBoundary(tokens[npEnd]));
        if (CLAUSE_VERBS.has(t.word) && h + 1 < end && !isDe(tokens[h + 1]) && !npToEnd) {
          if (hasPredicate(h, end)) {
            const comp = parseSeq(h, end, true, false);
            let question = false;
            for (let k = h; k < comp.next; k++) if (QUESTION.test(tokens[k].word)) question = true;
            // 主語のない動詞句（想去北京＝行きたい）には付けない
            const kana = !isNounish(n) && t.word === '想' ? '' : (question ? 'カ' : '') + (QUOTE_VERBS.has(t.word) ? 'ト' : 'ヲ');
            if (comp.items.length) return node(head, comp, kana);
          }
        }
        if (isPrep(n) && POST_VERB_PREP.has(n.word)) {
          const pp = parseHead(h, end);
          return pp ? node(head, { items: [pp], next: pp.next }) : null;
        }
        if (isPrep(n) && /^(对|对于|关于|针对)$/.test(n.word)) {
          // 加强对环境的保护: 「对…的＋名詞」が目的語
          const np = parseNP(h, end);
          return np.next > h + 1 && isNounish(tokens[np.next - 1]) ? node(head, np, verbKana(t.word)) : null;
        }
        const listNext = h + 1 < end && (tokens[h + 1].word === '、' || (COORD.has(tokens[h + 1].word) && !/^(跟|同)$/.test(tokens[h + 1].word)));
        const nominalNext = h + 1 >= end || isBoundary(tokens[h + 1]) || isNounish(tokens[h + 1]);
        if (isVerb(n) && (listNext || (NOMINAL_OBJ_VERBS.has(t.word) && nominalNext))) {
          // 制定驾驶策略: 動詞句をとらない動詞の後ろの「動詞＋名詞」は複合名詞の目的語
          const j = listNext ? simpleNPEnd(h, end, true) : simpleNPEnd(h + 1, end, true);
          const after = j < end ? tokens[j] : null;
          if (!after || isBoundary(after) || isDe(after) || after.tag === 'c' || after.word === '、') {
            const np = plainNP(h, j);
            return node(head, np, verbKana(t.word));
          }
        }
        if (n.tag === 'd') {
          // 整合了原来分散的子系统: 「…的＋名詞」までが目的語の名詞句
          const np = parseNP(h, end);
          let hasDe = false;
          for (let k = h; k < np.next; k++) if (isDe(tokens[k])) hasDe = true;
          if (hasDe && np.next > h + 1 && isNounish(tokens[np.next - 1]) && (np.next >= end || isBoundary(tokens[np.next]))) return node(head, np, verbKana(t.word));
        }
        if (isVerb(n) || isNeg(n) || (n.tag === 'd' && h + 1 < end && (isVerb(tokens[h + 1]) || isNeg(tokens[h + 1])))) {
          const comp = parseSeq(h, end, true, true);
          return comp.items.length ? node(head, comp) : null;
        }
        if (isNounish(n) || (isAdj(n) && h + 1 < end && (isNounish(tokens[h + 1]) || isDe(tokens[h + 1])))) {
          const np = parseNP(h, end);
          // 智能驾驶系统需解决…: 名詞＋動詞＋名詞 のすぐ後に述語が来るなら、まとめて主語の複合名詞
          const prev = i > 0 ? tokens[i - 1] : null;
          const after = np.next < end ? tokens[np.next] : null;
          const subjectStart = !prev || isBoundary(prev) || (isNounish(prev) && !/^r/.test(prev.tag));
          if (subjectStart && after && (isVerb(after) || isNeg(after) || after.tag === 'd')) return null;
          // 可选的备用电池: 「的」の直後の「動詞＋名詞」は名詞句の一部
          if (prev && isDe(prev)) return null;
          const words = np.items.filter((it) => 'leaf' in it).map((it) => tokens[it.leaf].word).join('');
          if (!np.items.length || VERBAL_MEASURE.test(words) || np.items.every((it) => 'leaf' in it && /^(m|q|mq)$/.test(tokens[it.leaf].tag))) return null;
          return node(head, np, verbKana(t.word));
        }
        return null;
      }

      return parseSeq(0, tokens.length, false, false).items;
    }

    /** 木から、単語（まとめた動詞句は 1 つ）を読む順に並べる */
    function readingOrder(items, tokens) {
      const unitOf = tokens.map((_, i) => i);
      const order = [];
      const kanaOf = new Map();
      (function visit(list) {
        for (const it of list) {
          if ('leaf' in it) order.push(unitOf[it.leaf]);
          else {
            for (const k of it.head) unitOf[k] = it.head[0];
            const before = order.length;
            visit(it.comp.slice(0, it.upto));
            if (it.kana && order.length > before) {
              const last = order[order.length - 1];
              kanaOf.set(last, (kanaOf.get(last) || '') + it.kana);
            }
            visit(it.comp.slice(it.upto));
            order.push(it.head[0]);
          }
        }
      })(items);
      // 単語の位置（左から何番目の単位か）に直す
      const units = [...new Set(unitOf)].sort((a, b) => a - b);
      const rank = new Map(units.map((u, r) => [u, r]));
      const lastToken = new Map();
      unitOf.forEach((u, i) => lastToken.set(u, i));
      return {
        seq: order.map((u) => rank.get(u)),
        unitEnd: units.map((u) => tokens[lastToken.get(u)].end),
        kana: [...kanaOf].map(([u, k]) => ({ unit: rank.get(u), kana: k })),
      };
    }

    return { tokenize, parse, readingOrder, marks, annotate };

    /**
     * 文字列 → [{offset, mark?, kana?}]。offset の位置（code point 単位）の文字の後ろに、
     * 送り仮名 kana と返り点 mark を付ける。
     */
    function marks(text) {
      const tokens = tokenize(text);
      if (!tokens.length) return [];
      const { seq, unitEnd, kana } = readingOrder(parse(tokens), tokens);
      const at = new Map();
      const entry = (unit) => {
        const offset = unitEnd[unit];
        if (!at.has(offset)) at.set(offset, { offset });
        return at.get(offset);
      };
      for (const { unit, kana: k } of kana) entry(unit).kana = k;
      for (const { unit, mark } of assignMarks(seq)) entry(unit).mark = mark;
      return [...at.values()].sort((a, b) => a.offset - b.offset);
    }

    /**
     * テスト・確認用: 返り点（と送り仮名）を文字列に埋め込む
     * 例: 我想二去レ北京看一レ朋友 / okuri: 我想二去レ北京ニ看一レ朋友ヲ
     */
    function annotate(text, { okuri = false } = {}) {
      const chars = [...text];
      const at = new Map(marks(text).map((m) => [m.offset, m]));
      let out = '';
      chars.forEach((c, i) => {
        const m = at.get(i + 1);
        out += c + (m ? (okuri && m.kana ? m.kana : '') + (m.mark || '') : '');
      });
      return out;
    }
  }

  /**
   * 読む順（左からの位置の並び）から返り点を決める。
   * 下から上へ戻る「返り」が続く部分を 1 組とし、隣へ 1 つ戻るだけならレ点、
   * それ以外は一二点。一二点の組を内側に含む組は上下点、さらに外側は甲乙点。
   */
  function assignMarks(seq) {
    const re = new Set();
    const groups = [];
    for (let k = 0; k < seq.length - 1; k++) {
      if (seq[k + 1] >= seq[k]) continue;
      let numbered = null;
      for (; k < seq.length - 1 && seq[k + 1] < seq[k]; k++) {
        const from = seq[k];
        const to = seq[k + 1];
        if (!numbered && to === from - 1) re.add(to);
        else {
          if (!numbered) numbered = [from];
          numbered.push(to);
        }
      }
      if (numbered) groups.push(numbered);
      k--; // for の k++ と合わせて、返りの終わりの位置から次を調べる
    }
    // 内側に一二点の組を含む組ほど上の段（上下点・甲乙点）にする
    const span = (g) => [Math.min(...g), Math.max(...g)];
    const level = new Map();
    const sorted = [...groups].sort((a, b) => span(a)[1] - span(a)[0] - (span(b)[1] - span(b)[0]));
    for (const g of sorted) {
      const [lo, hi] = span(g);
      let lv = 0;
      for (const inner of sorted) {
        if (inner === g || !level.has(inner)) continue;
        const [ilo, ihi] = span(inner);
        if (ilo >= lo && ihi <= hi) lv = Math.max(lv, level.get(inner) + 1);
      }
      level.set(g, lv);
    }
    const out = new Map();
    for (const g of groups) {
      let lv = Math.min(level.get(g), MARK_SERIES.length - 1);
      while (g.length > MARK_SERIES[lv].length && lv < MARK_SERIES.length - 1) lv++;
      let series = MARK_SERIES[lv];
      if (series === MARK_SERIES[1] && g.length === 2) series = ['上', '下'];
      g.forEach((unit, i) => out.set(unit, series[i]));
    }
    for (const unit of re) out.set(unit, (out.get(unit) || '') + 'レ');
    return [...out].sort((a, b) => a[0] - b[0]).map(([unit, mark]) => ({ unit, mark }));
  }

  root.CJ2JA_KUNTEN = { createAnalyzer, assignMarks };
})(typeof globalThis !== 'undefined' ? globalThis : this);
