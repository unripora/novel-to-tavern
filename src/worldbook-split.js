/**
 * worldbook-split.js —— 世界书解耦（通用本 + 各篇章本）
 *
 * 目的：把世界书按篇章拆分，避免跨篇章 OOC（如 SAO 篇不该知道 ALO 篇的角色与剧情）。
 *
 * 归类规则：
 *  - 跨篇章持续出场的角色基础设定、贯穿全作的全局规则/设定 → 通用本
 *  - 只在某一篇章出场的 NPC/反派、该篇章专属地点/势力/设定、该篇章剧情 → 该篇章本
 */

import { generate } from './generate.js';
import { stripFence, stripThink, extractJsonArray } from './util.js';
import { writeWorldbookToTavern } from './worldbook.js';

/**
 * AI 自动归类：把条目分到「通用本」或各「篇章本」
 *
 * @param {Array} entries 内部条目列表
 * @param {Array} nodes   时间线节点（篇章）列表；为空则全部归入通用本
 * @param {{signal?:AbortSignal, onLog?:(m:string,c?:string)=>void}} [opts]
 * @returns {Promise<{general:Array, chapters:Array<{name:string, entries:Array}>}>}
 */
export async function classifyEntries(entries, nodes, { signal, onLog } = {}) {
    const log = (m, c) => { if (onLog) onLog(m, c); };
    const list = (entries || []).filter(Boolean);
    const chapters = (nodes || []).filter(Boolean);
    if (!list.length) return { general: [], chapters: [] };
    if (!chapters.length) {
        log('未建立时间线，全部归入通用本');
        return { general: list, chapters: [] };
    }

    const names = chapters.map((n) => n.name);
    log('正在归类 ' + list.length + ' 条到通用本 / ' + names.length + ' 个篇章本…');

    // 构造给 AI 的清单（只给标题/关键词/内容摘要，控长度）
    const brief = list.map((e, i) =>
        (i + 1) + '. [' + (e.category || '') + '] ' + e.title +
        '｜关键词:' + ((e.keys || []).join('、') || '无') +
        '｜内容:' + String(e.content || '').slice(0, 80)
    ).join('\n');

    const prompt =
        '下面是一批世界书条目。请判断每一条应归入「通用本」还是哪个「篇章本」。\n\n' +
        '篇章列表（按剧情先后）：' + names.join('、') + '\n\n' +
        '归类规则：\n' +
        '· 通用本：跨篇章持续出场的角色基础设定、贯穿全作的全局规则/设定（如世界基本规则、主角基础性格）。\n' +
        '· 篇章本：只在某一个篇章出场的 NPC/反派、该篇章专属的地点/势力/设定、该篇章的剧情进展与事件。\n' +
        '· 拿不准是否跨篇章时，若该条目只在某一篇章的语境下成立，就归该篇章；真正贯穿全作才归通用。\n\n' +
        '条目清单：\n' + brief + '\n\n' +
        '只输出 JSON 数组，每个元素形如：{"i":序号,"book":"通用" 或 "篇章名"}\n' +
        'book 必须严格取自「通用」或上面列出的篇章名。只输出 JSON，不要解释、不要代码块。';

    const raw = await generate([
        { role: 'system', content: '你是严谨的设定整理助手，擅长判断虚构作品的设定条目是全局通用还是篇章专属。' },
        { role: 'user', content: prompt },
    ], { signal, useStream: false, maxCont: 1 });

    const arr = extractJsonArray(stripThink(stripFence(raw)));
    if (!arr.length) {
        log('AI 归类失败，全部归入通用本', 'e');
        return { general: list, chapters: [] };
    }

    // 应用归类结果
    const general = [];
    const chapterMap = new Map(names.map((n) => [n, []]));
    arr.forEach((it) => {
        const idx = Number(it.i) - 1;
        if (!(idx >= 0 && idx < list.length)) return;
        const e = list[idx];
        const book = String(it.book || '通用').trim();
        if (book === '通用' || !chapterMap.has(book)) general.push(e);
        else chapterMap.get(book).push(e);
    });
    // 未被 AI 覆盖的条目兜底进通用本
    const covered = new Set(arr.map((it) => Number(it.i) - 1));
    list.forEach((e, i) => { if (!covered.has(i)) general.push(e); });

    const out = {
        general,
        chapters: names.map((n) => {
            const node = chapters.find((x) => x.name === n) || {};
            // 篇章本附带原文范围（世界书「自带范围」），供「角色 & 世界」按对应原文生成角色条目
            return { name: n, entries: chapterMap.get(n), range: { start: node.start, end: node.end } };
        }).filter((c) => c.entries.length),
    };
    log('归类完成：通用本 ' + out.general.length + ' 条，篇章本 ' + out.chapters.length + ' 本', 'g');
    return out;
}

/**
 * 一次写入多本世界书（每本自带名字）
 * @param {Array<{name:string, entries:Array}>} books 待写入的书单（名字已由调用方定好）
 * @param {'new'|'append'} mode 写入模式
 * @param {{userReplace?:object}} [opts]
 * @returns {Promise<{ok:boolean, books:Array, message:string}>}
 */
export async function writeSplitWorldbooks(books, mode = 'new', opts = {}) {
    const list = (books || []).filter((b) => b && b.name && b.entries && b.entries.length);
    if (!list.length) return { ok: false, books: [], message: '没有可写入的条目' };

    const results = [];
    for (const t of list) {
        const r = await writeWorldbookToTavern(t.name, t.entries, mode, opts);
        results.push({ bookName: t.name, count: r.count, conflicts: r.conflicts, message: r.message, ok: r.ok });
    }

    const okAll = results.every((r) => r.ok);
    const total = results.reduce((s, r) => s + (r.count || 0), 0);
    const failed = results.filter((r) => !r.ok).length;
    const msg = '共写入 ' + results.length + ' 本世界书、' + total + ' 条' + (failed ? ('（' + failed + ' 本失败）') : '');
    return { ok: okAll, books: results, message: msg };
}

export default { classifyEntries, writeSplitWorldbooks };
