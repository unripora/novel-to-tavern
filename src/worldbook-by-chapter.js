/**
 * worldbook-by-chapter.js —— 按「时间线篇章」生成世界书（一总多分）
 *
 * 与 worldbook.js（整本生成）的关系：
 *   - 整本生成：在全书中提取，得到单一本条目（通用设定）。
 *   - 按篇章生成：把整本生成里的各个任务，改为「在该篇章正文范围内」逐篇执行，
 *     每篇章各得一本；总本 = 全局世界观 + 角色总表 + 剧情大纲（3 条常驻）。
 *
 * 复用 worldbook.js 的任务内核（提取条目 / 共享背景 / 配角群像 / 剧情分段 / 人物列表 / 剧情大纲）：
 * 范围敏感的任务（提取条目 / 剧情分段）在本文件内按篇章范围重写；其余直接在整本内核上执行。
 */

import { settings } from './store.js';
import { generate } from './generate.js';
import {
    wbBgCore, wbMinorCore, wbConstantEntry,
} from './worldbook.js';
import { stripFence, stripThink, logTo } from './util.js';

/** 取某篇章节点的正文位置范围 */
function nodeText(node) {
    const start = (node && node.start) || 0;
    const end = (node && node.end) || start;
    return { start, end };
}

/** 从设置读取分段大小/段数上限 */
function chunkSizeOf() { return Math.max(10000, Number(settings().chunkSize) || 40000); }
function scanCapOf() { return Math.max(1, Number(settings().scanCap) || 40); }
function userMsgs(prompt, sys) {
    return sys ? [{ role: 'system', content: sys }, { role: 'user', content: prompt }] : [{ role: 'user', content: prompt }];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 在指定正文范围内分段提取世界书条目（对应整本生成的「提取条目」）
 * @param {string} text 该范围的正文
 * @param {string} label 日志前缀（篇章名）
 * @param {{signal?:AbortSignal, logEl?:string}} [opts]
 * @returns {Promise<Array>} 条目数组
 */
export async function extractEntriesInRange(text, label, { signal, logEl = 'ce_wb_log', relatedMode = 'none' } = {}) {
    const src = String(text || '').trim();
    if (!src) return [];
    const size = chunkSizeOf();
    const totalChunks = Math.ceil(src.length / size);
    const cap = Math.min(totalChunks, scanCapOf());
    if (totalChunks > cap) logTo(logEl, `「${label}」较长（${totalChunks} 段），仅提取前 ${cap} 段`, 'e');
    else logTo(logEl, `「${label}」共 ${cap} 段，开始提取…`);

    const nsfw = nsfwLine();
    const wantRelated = relatedMode === 'light' || relatedMode === 'heavy';
    const map = new Map();
    for (let i = 0; i < cap; i++) {
        if (signal && signal.aborted) break;
        if (i > 0) await sleep(400);
        const chunk = src.slice(i * size, (i + 1) * size);
        const prompt =
            '下面是小说《' + label + '》这一篇章的一段正文。只提取**属于该篇章**的「世界观 / 设定」类信息，做成世界书条目。\n' +
            '关注：该篇章的世界观背景、势力/组织、地点、种族/体系设定、重要概念或规则、历史事件、关键物品等。\n' +
            '不要提取具体角色的个人档案（那属于角色卡）；群体性的身份/种族/阵营设定可以。\n' +
            '注意：只写**此篇章范围内**成立的设定，不要混入其它篇章的内容。\n' +
            nsfw + '\n' +
            '输出 JSON 数组，每个元素：\n' +
            '{"category":"分类(世界观/势力/地点/设定/历史/物品 之一)","title":"条目标题","keys":["触发关键词，用原文里会出现的名称/术语，2~5个"],"content":"该设定的说明，依据原文、简洁准确、不编造","constant":true 或 false' +
            (wantRelated ? ',"related":["与该条目相关的人物名，2~5个"]' : '') + '}\n' +
            'constant：整体世界观/总背景 → true；具体的势力/地点/术语/物品 → false。\n' +
            '只输出 JSON 数组，不要代码块、不要解释。该段没有明确设定就输出 []。\n\n文本：\n' + chunk;
        let raw = '';
        try {
            raw = await generate(userMsgs(prompt), {
                signal, useStream: false,
                maxCont: settings().autoCont ? 3 : 0, logEl, label: `${label}·第${i + 1}段`,
            });
        } catch (err) {
            if (signal && signal.aborted) break;
            logTo(logEl, `${label} 第${i + 1}段失败：${err.message}`, 'e');
            continue;
        }
        const arr = extractJsonArray(raw);
        if (!Array.isArray(arr) || !arr.length) continue;
        for (const e of arr) {
            if (!e || !e.title) continue;
            const title = String(e.title).trim();
            if (!title) continue;
            const keys = Array.isArray(e.keys) ? e.keys.map((k) => String(k).trim()).filter(Boolean) : [];
            const content = String(e.content || '').trim();
            const related = Array.isArray(e.related) ? e.related.map((s) => String(s).trim()).filter(Boolean) : [];
            if (map.has(title)) {
                const ex = map.get(title);
                for (const k of keys) if (!ex.keys.includes(k)) ex.keys.push(k);
                for (const r of related) { ex.related = ex.related || []; if (!ex.related.includes(r)) ex.related.push(r); }
                if (content.length > ex.content.length) ex.content = content;
                ex.constant = ex.constant || !!e.constant;
            } else {
                const item = { category: String(e.category || '设定').trim(), title, keys, content, constant: !!e.constant };
                if (wantRelated && related.length) item.related = related;
                map.set(title, item);
            }
        }
        logTo(logEl, `${label} 第${i + 1}段 → 累计 ${map.size} 条`, 'g');
    }
    return [...map.values()];
}

/** JSON 数组提取（容错） */
function extractJsonArray(s) {
    const t = stripFence(String(s || ''));
    const a = t.indexOf('['), b = t.lastIndexOf(']');
    if (a < 0 || b < 0 || b < a) return [];
    let body = t.slice(a, b + 1);
    try { const arr = JSON.parse(body); return Array.isArray(arr) ? arr : []; }
    catch (e) {
        body = body.replace(/,(\s*[\]}])/g, '$1');
        try { const arr = JSON.parse(body); return Array.isArray(arr) ? arr : []; } catch (e2) { return []; }
    }
}

/** NSFW 提示行 */
function nsfwLine() {
    return settings().nsfw ? '可包含成人向的世界观/设定条目，同样只依据原文，不编造。' : '不要提取成人 / 性相关内容。';
}

/* ==================== 主入口 ==================== */

/**
 * 按篇章生成世界书（一总多分）
 *
 * @param {Array} nodes 时间线节点（篇章，需含 start/end 正文位置）
 * @param {object} opts
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.logEl]
 * @param {Function} [opts.onProgress] (i,total,name)=>void
 * @param {object} [opts.options] 继承自「整本生成」的选项：
 *        { extract, bg, minor, minorMode, plot, chars, plotlist }
 * @param {string} [opts.fullText] 全文（用于总本 / 范围切片）
 * @returns {Promise<{general:Array, chapters:Array<{name:string, entries:Array}>}>}
 */
export async function generateSplitWorldbook(nodes, {
    signal, logEl = 'ce_wb_log', onProgress, options = {}, fullText = '', onChapterDone, onGeneralDone, genGeneral = true,
} = {}) {
    const full = String(fullText || '');
    if (!full.trim()) throw new Error('请先导入小说');
    const chapters = (nodes || []).filter(Boolean);
    if (!chapters.length) throw new Error('请先在「时间线」页建立篇章');

    const opt = {
        extract: true, bg: false, minor: false, minorMode: 'group',
        plot: false, chars: false, plotlist: false, ...options,
    };

    // —— 1. 总本：全局世界观 + 角色总表 + 剧情大纲（3 条常驻）——
    // 未勾选总本时跳过构建，避免「只选了卷却在生成总本」
    let general = [];
    if (genGeneral) {
        logTo(logEl, '生成总本（全局世界观 / 角色总表 / 剧情大纲）…');
        general = await buildGeneralBook(full, chapters, { signal, logEl });
        if (onGeneralDone) await onGeneralDone(general);
    }

    // —— 2. 各篇章本：在该篇章正文范围内执行所选任务 ——
    const perChapter = [];
    for (let i = 0; i < chapters.length; i++) {
        if (signal && signal.aborted) break;
        const node = chapters[i];
        if (onProgress) onProgress(i, chapters.length, node.name);
        const { start, end } = nodeText(node);
        const seg = full.slice(start, end);
        const entries = await tasksInRange(seg, node, opt, { signal, logEl });
        const item = { name: node.name, entries };
        perChapter.push(item);
        // 某篇完成即回调：上层据此独立落盘 + 更新预览 + 更新索引
        if (onChapterDone) await onChapterDone(item, i, chapters.length);
    }

    logTo(logEl, '按篇章生成完成：总本 ' + general.length + ' 条，篇章本 ' + perChapter.length + ' 本', 'g');
    return { general, chapters: perChapter };
}

/**
 * 在篇章范围内执行所选任务（继承整本生成的选项）
 * 范围敏感任务（提取条目 / 剧情分段）用本文件内的范围实现；
 * 其它任务复用 worldbook.js 的内核，并把其日志指向同一日志区。
 */
async function tasksInRange(seg, node, opt, { signal, logEl }) {
    const range = String(seg || '').trim();
    if (!range) return [];
    const out = [];
    const label = node.name;

    // ① 提取条目（范围敏感 → 用范围实现）
    if (opt.extract) {
        logTo(logEl, `「${label}」▶ 提取条目`);
        const list = await extractEntriesInRange(range, label, { signal, logEl, relatedMode: opt.relatedMode || 'none' });
        out.push(...list);
    }

    // ② 剧情分段（范围敏感 → 逐段总结本篇章剧情）
    if (opt.plot) {
        logTo(logEl, `「${label}」▶ 剧情分段`);
        const list = await plotInRange(range, label, { signal, logEl });
        out.push(...list);
    }

    // ③ 配角群像（复用整本内核：基于全书取样，非本篇章范围）
    if (opt.minor) {
        logTo(logEl, `「${label}」▶ 配角群像`);
        const list = await runOptional(() => wbMinorCore({ signal, mode: opt.minorMode, cap: 20 }), '配角群像', logEl);
        out.push(...(list || []));
    }

    // ④ 共享背景（复用整本内核：基于全书取样；条目标题按篇章加前缀）
    if (opt.bg) {
        logTo(logEl, `「${label}」▶ 共享背景`);
        const one = await runOptional(() => wbBgCore({ signal }), '共享背景', logEl);
        if (one) out.push({ ...one, title: label + '·背景大纲' });
    }

    // ⑤ 人物列表（复用整本内核：基于全书取样；条目标题按篇章加前缀）
    if (opt.chars) {
        logTo(logEl, `「${label}」▶ 人物列表`);
        const one = await runOptional(() => wbConstantEntry({ signal, kind: 'chars' }), '人物列表', logEl);
        if (one) out.push({ ...one, category: '人物', title: label + '·人物列表', constant: false, keys: one.keys || [] });
    }

    // ⑥ 剧情大纲（复用整本内核：基于全书取样；条目标题按篇章加前缀）
    if (opt.plotlist) {
        logTo(logEl, `「${label}」▶ 剧情大纲`);
        const one = await runOptional(() => wbConstantEntry({ signal, kind: 'plot' }), '剧情大纲', logEl);
        if (one) out.push({ ...one, category: '剧情', title: label + '·剧情大纲', constant: false, keys: one.keys || [] });
    }

    return dedupeByTitle(out);
}

/** 范围内剧情分段：逐段总结，title 加篇章前缀避免与其它篇章撞名 */
async function plotInRange(range, label, { signal, logEl }) {
    const size = Math.max(50000, chunkSizeOf());
    const totalChunks = Math.ceil(range.length / size);
    const cap = Math.min(totalChunks, scanCapOf());
    const nsfw = settings().nsfw ? '可包含成人向剧情。' : '不必回避剧情，但不要展开露骨性描写。';
    const map = new Map();
    for (let i = 0; i < cap; i++) {
        if (signal && signal.aborted) break;
        if (i > 0) await sleep(400);
        const chunk = range.slice(i * size, (i + 1) * size);
        const prompt =
            '下面是小说《' + label + '》这一篇章按顺序的第 ' + (i + 1) + '/' + cap + ' 段。请把这段的剧情按「阶段 / 副本」切分并逐段总结。\n' +
            '每个阶段一条，包含：\n' +
            '- title：阶段 / 副本的名称\n' +
            '- keys：触发关键词（该阶段会被提到的名称、地点、副本名等，2~5个）\n' +
            '- content：该阶段的剧情总结，**不少于 300 字**，必须包含【重要出场角色、事件的前因后果、重要道具、时间线】，**不可遗漏任何剧情和伏笔**。\n' +
            nsfw + '\n' +
            '只依据原文、不编造。输出 JSON 数组 [{"title":"","keys":[],"content":""}]，只输出 JSON，不要代码块、不要解释。该段无实质剧情就输出 []。\n\n文本：\n' + chunk;
        let raw = '';
        try {
            raw = await generate(userMsgs(prompt), {
                signal, useStream: false,
                maxCont: settings().autoCont ? 3 : 0, logEl, label: `${label}·剧情${i + 1}`,
            });
        } catch (err) {
            if (signal && signal.aborted) break;
            logTo(logEl, `${label} 剧情第${i + 1}段失败：${err.message}`, 'e');
            continue;
        }
        const arr = extractJsonArray(raw);
        if (!Array.isArray(arr)) continue;
        for (const e of arr) {
            if (!e || !e.title || !e.content) continue;
            const rawTitle = String(e.title).trim();
            const keys = Array.isArray(e.keys) ? e.keys.map((k) => String(k).trim()).filter(Boolean) : [];
            if (!keys.includes(rawTitle)) keys.unshift(rawTitle);
            const title = label + '·剧情·' + rawTitle;
            map.set(title, { category: '剧情', title, keys, content: String(e.content).trim(), constant: false });
        }
        logTo(logEl, `${label} 剧情第${i + 1}段 → 累计 ${map.size} 条`, 'g');
    }
    return [...map.values()];
}

/** 执行可选任务并兜错，失败不影响其它任务 */
async function runOptional(fn, name, logEl) {
    try { return await fn(); }
    catch (e) {
        if (e && e.name === 'AbortError') return null;
        logTo(logEl, name + ' 失败：' + e.message, 'e');
        return null;
    }
}

/** 按 title 去重合并 */
function dedupeByTitle(list) {
    const map = new Map();
    for (const e of (list || [])) {
        if (!e || !e.title) continue;
        if (map.has(e.title)) {
            const ex = map.get(e.title);
            for (const k of (e.keys || [])) if (!ex.keys.includes(k)) ex.keys.push(k);
            if ((e.content || '').length > (ex.content || '').length) ex.content = e.content;
            ex.constant = ex.constant || !!e.constant;
        } else {
            map.set(e.title, e);
        }
    }
    return [...map.values()];
}

/* ==================== 总本（全局 3 条常驻） ==================== */

async function buildGeneralBook(full, chapters, { signal, logEl }) {
    const out = [];
    const chapterNames = chapters.map((n) => n.name).join('、');
    const sample = sampleText(full, 60000);

    const p1 =
        '通读下面这部小说（节选），提取**贯穿全作的全局世界观与设定**：世界基本规则、整体地理/势力格局、' +
        '核心体系（如力量/科技/社会体系）、贯穿全作的重要概念。不要写任何单一角色的个人档案。\n' +
        '作品的篇章结构为：' + chapterNames + '\n' +
        '只依据原文，简洁准确，不编造。直接输出正文，不要标题、不要解释、不要代码块。\n\n=== 小说节选 ===\n' + sample;
    const c1 = await genText(p1, '总本·世界观', { signal, logEl });
    if (c1) out.push({ category: '世界观', title: '全局世界观', keys: [], content: c1, constant: true });

    const p2 =
        '通读下面这部小说（节选），列出**全作主要出场角色总表**。每行一个角色：姓名（别名）——身份/阵营/一句话定位。\n' +
        '作品的篇章结构为：' + chapterNames + '\n' +
        '只依据原文，不要编造，不要展开个人档案。直接输出这份总表正文，不要解释、不要代码块。\n\n=== 小说节选 ===\n' + sample;
    const c2 = await genText(p2, '总本·角色总表', { signal, logEl });
    if (c2) out.push({ category: '角色总表', title: '角色总表', keys: [], content: c2, constant: true });

    const p3 =
        '通读下面这部小说（节选），按篇章顺序总结**全作剧情主线大纲**。\n' +
        '作品篇章顺序为：' + chapterNames + '\n' +
        '按该顺序分段概括每一篇章的核心剧情走向（每篇章 1~3 句），让 AI 掌握整体故事脉络。\n' +
        '只依据原文，简洁准确，不编造。直接输出这份大纲正文，不要解释、不要代码块。\n\n=== 小说节选 ===\n' + sample;
    const c3 = await genText(p3, '总本·剧情大纲', { signal, logEl });
    if (c3) out.push({ category: '剧情大纲', title: '剧情大纲', keys: [], content: c3, constant: true });

    return out;
}

/** 单次取文本（带续写） */
async function genText(prompt, label, { signal, logEl }) {
    try {
        const raw = await generate(userMsgs(prompt), {
            signal, useStream: !!settings().useStream,
            maxCont: settings().autoCont ? 5 : 0, logEl, label,
        });
        return stripFence(stripThink(raw)).trim();
    } catch (e) {
        if (signal && signal.aborted) return '';
        logTo(logEl, label + ' 失败：' + e.message, 'e');
        return '';
    }
}

/** 采样全文（头/中/尾 + 等距） */
function sampleText(text, cap) {
    if (text.length <= cap) return text;
    const seg = 8000, slices = 8;
    const pieces = [text.slice(0, seg)];
    for (let i = 1; i < slices - 1; i++) {
        const s = Math.floor(i * text.length / slices);
        pieces.push(text.slice(s, s + seg));
    }
    pieces.push(text.slice(text.length - seg));
    return pieces.join('\n\n…（此处省略）…\n\n').slice(0, cap);
}

export default { generateSplitWorldbook, extractEntriesInRange };
