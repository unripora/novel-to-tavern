/**
 * char-presence.js —— 判断某个角色在指定篇章里是否「真的出场」
 *
 * 为什么要这个：多人卡会把所有角色的详情写进世界书，但有些角色很晚才登场。
 * 若早期篇章的书里就带着 TA 的完整档案，只要对话提到名字就会注入 → 提前剧透。
 *
 * 做法是两级：
 *  1. 程序粗筛（cheap）：角色名/别名在该卷正文里出现几次。0 次 → 直接判定没出场，不花 AI 调用。
 *  2. AI 复核（准）：粗筛命中的，让 AI 判断「有实际戏份」还是「仅被提及/回忆/预告」。
 *     只被提到名字（如「听说有个叫凯兹的剑士」）不算出场，否则等于提前剧透。
 */

import { generate } from './generate.js';
import { stripFence, stripThink, extractJsonArray, logTo } from './util.js';
import { settings } from './store.js';

/** 名字在正文中的出现次数 */
function countHits(text, name) {
    if (!text || !name) return 0;
    let n = 0;
    let i = 0;
    while ((i = text.indexOf(name, i)) >= 0) { n++; i += name.length; }
    return n;
}

/** 取某角色所有称呼（名字 + 别名） */
function namesOf(char) {
    const out = [String(char && char.name || '').trim()];
    for (const a of (char && char.aliases) || []) {
        const s = String(a || '').trim();
        if (s && !out.includes(s)) out.push(s);
    }
    return out.filter(Boolean);
}

/**
 * 程序粗筛：哪些角色在这一卷正文里「名字压根没出现」。
 * 没出现的直接判定为未出场，不进入 AI 复核，省 token。
 *
 * @param {string} text 本卷正文
 * @param {Array} chars 角色列表（{name, aliases}）
 * @returns {{absent:Array, candidates:Array<{char:object, hits:number}>}}
 */
export function screenCharacters(text, chars) {
    const absent = [];
    const candidates = [];
    for (const c of (chars || [])) {
        const names = namesOf(c);
        if (!names.length) continue;
        const hits = names.reduce((s, n) => s + countHits(text, n), 0);
        if (hits === 0) absent.push(c);
        else candidates.push({ char: c, hits });
    }
    return { absent, candidates };
}

/**
 * AI 复核：从粗筛命中的角色里，挑出「本卷内有实际戏份」的。
 *
 * 明确区分两种情形：
 *  - 实际戏份：本人登场、参与对话/行动/战斗，或在本卷有可观察到的行为。
 *  - 仅被提及：只出现在他人的转述、传闻、回忆、预告、名单里，本人并未在场。
 *
 * @param {object} o
 * @param {string} o.text 本卷正文
 * @param {string} o.chapterName 卷名（用于提示与日志）
 * @param {Array<{char:object, hits:number}>} o.candidates 粗筛命中项
 * @param {AbortSignal} [o.signal]
 * @param {string} [o.logEl]
 * @returns {Promise<{present:Array<object>, mentionedOnly:Array<object>}>}
 */
export async function verifyCharactersInChapter({ text, chapterName = '', candidates = [], signal, logEl = 'ce_wb_log' } = {}) {
    const list = (candidates || []).filter((x) => x && x.char);
    if (!list.length) return { present: [], mentionedOnly: [] };

    const names = list.map((x) => x.char.name);
    // 正文过长时按角色检索周边段落，避免一次塞进整卷
    const sample = buildSample(text, names);
    const prompt =
        '下面是小说《' + chapterName + '》这一篇章的部分正文，以及一份角色名单。\n' +
        '请判断名单里的每个角色，在**这一篇章里是否真的有实际戏份**。\n\n' +
        '判定标准：\n' +
        '· 有戏份（true）：本人登场，参与了对话、行动、战斗，或在本篇章内有可观察到的具体表现。\n' +
        '· 无戏份（false）：只出现在他人的**转述、传闻、回忆、预告、名单、假设**里，本人并未在本篇章中现身。\n' +
        '· 拿不准时按 false 处理——少给信息远比提前剧透安全。\n\n' +
        '角色名单：' + names.join('、') + '\n\n' +
        '输出 JSON 数组，每个角色一项：\n' +
        '[{"name":"角色名","present":true 或 false,"reason":"一句话依据（原文里的什么表现）"}]\n' +
        '名单里每个角色都要有一项，不要遗漏。只输出 JSON，不要代码块、不要解释。\n\n' +
        '=== 正文 ===\n' + sample;

    let raw = '';
    try {
        raw = await generate([
            { role: 'system', content: '你是严谨的文本分析助手，擅长判断虚构作品中某角色在某一段剧情里是否真的登场。只依据给定正文，不臆测。' },
            { role: 'user', content: prompt },
        ], { signal, useStream: false, maxCont: settings().autoCont ? 2 : 0, logEl, label: '出场复核·' + chapterName });
    } catch (e) {
        if (e && e.name === 'AbortError') return { present: list.map((x) => x.char), mentionedOnly: [] };
        logTo(logEl, '出场复核失败，本卷按「粗筛命中即出场」处理：' + e.message, 'e');
        // 复核失败时保守处理：粗筛命中的都当作出场，避免漏掉本卷该有的角色
        return { present: list.map((x) => x.char), mentionedOnly: [] };
    }

    const arr = extractJsonArray(stripFence(stripThink(raw)));
    if (!Array.isArray(arr) || !arr.length) {
        logTo(logEl, '出场复核解析失败，本卷按「粗筛命中即出场」处理', 'e');
        return { present: list.map((x) => x.char), mentionedOnly: [] };
    }

    const verdict = new Map();
    for (const it of arr) {
        if (!it || !it.name) continue;
        verdict.set(String(it.name).trim(), !!it.present);
    }
    const present = [];
    const mentionedOnly = [];
    for (const x of list) {
        const v = verdict.get(x.char.name);
        // AI 没给结论的，按「有戏份」处理（宁可多给本卷该有的角色，也不误删）
        if (v === false) mentionedOnly.push(x.char);
        else present.push(x.char);
    }
    return { present, mentionedOnly };
}

/** 为每个角色取周边段落拼成复核样本（总长受限） */
function buildSample(text, names, perName = 3500, cap = 24000) {
    const src = String(text || '');
    if (!src) return '';
    if (src.length <= cap) return src;
    const pieces = [];
    for (const n of names.slice(0, 12)) {
        let idx = src.indexOf(n);
        if (idx < 0) continue;
        const st = Math.max(0, idx - Math.floor(perName / 2));
        pieces.push('【' + n + ' 附近】\n' + src.slice(st, st + perName));
        if (pieces.join('\n\n').length >= cap) break;
    }
    if (!pieces.length) return src.slice(0, cap);
    return pieces.join('\n\n…\n\n').slice(0, cap);
}

/**
 * 把「角色 → 出场卷」汇总成文字。
 * 可选：生成后提示用户哪些角色在哪一卷出场，便于核对。
 * @param {Array<{name:string, chapters:string[]}>} rows
 * @returns {string}
 */
export function buildAppearanceTable(rows) {
    return (rows || [])
        .filter((r) => r && r.name)
        .map((r) => {
            const ch = (r.chapters || []).filter(Boolean);
            return '· ' + r.name + '：' + (ch.length ? ('出场于 ' + ch.join('、')) : '全作未正式出场');
        })
        .join('\n');
}

export default { screenCharacters, verifyCharactersInChapter, buildAppearanceTable };
