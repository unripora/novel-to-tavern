/**
 * worldbook-by-chapter.js —— 按「时间线篇章」生成世界书（一总多分）
 *
 * 与 worldbook-split.js 的区别：
 *   - worldbook-split.js：先整本生成条目，再让 AI「事后归类」到各本。
 *   - 本文件：**直接按篇章范围分别提取/生成**，内容按篇章真实切分，不靠事后贴标签。
 *
 * 产出结构：
 *   总本（通用设定）：全局世界观 + 角色总表 + 剧情大纲（3 条常驻条目）
 *   各篇章本：在「该篇章正文范围」内提取的世界观/势力/地点/设定/历史/物品条目
 */

import { getNovel } from './novel.js';
import { settings } from './store.js';
import { generate } from './generate.js';
import { stripFence, stripThink, extractJsonArray, logTo } from './util.js';

/** 取某篇章节点的正文范围 */
function nodeText(node) {
    const text = getNovel();
    if (!node) return text;
    return text.slice(node.start || 0, node.end || text.length);
}

/** 从设置读取分段大小/段数上限 */
function chunkSizeOf() { return Math.max(10000, Number(settings().chunkSize) || 40000); }
function scanCapOf() { return Math.max(1, Number(settings().scanCap) || 40); }
function userMsgs(prompt, sys) {
    return sys ? [{ role: 'system', content: sys }, { role: 'user', content: prompt }] : [{ role: 'user', content: prompt }];
}
function nsfwLine() {
    return settings().nsfw ? '可包含成人向的世界观/设定条目，同样只依据原文，不编造。' : '不要提取成人 / 性相关内容。';
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 在指定正文范围内分段提取世界书条目
 * @param {string} text 该范围的正文
 * @param {string} label 日志前缀（篇章名）
 * @param {{signal?:AbortSignal, logEl?:string}} [opts]
 * @returns {Promise<Array>} 条目数组
 */
export async function extractEntriesInRange(text, label, { signal, logEl = 'ce_wb_log' } = {}) {
    const src = String(text || '').trim();
    if (!src) return [];
    const size = chunkSizeOf();
    const totalChunks = Math.ceil(src.length / size);
    const cap = Math.min(totalChunks, scanCapOf());
    if (totalChunks > cap) logTo(logEl, `「${label}」较长（${totalChunks} 段），仅提取前 ${cap} 段`, 'e');
    else logTo(logEl, `「${label}」共 ${cap} 段，开始提取…`);

    const nsfw = nsfwLine();
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
            '{"category":"分类(世界观/势力/地点/设定/历史/物品 之一)","title":"条目标题","keys":["触发关键词，用原文里会出现的名称/术语，2~5个"],"content":"该设定的说明，依据原文、简洁准确、不编造","constant":true 或 false}\n' +
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
            if (map.has(title)) {
                const ex = map.get(title);
                for (const k of keys) if (!ex.keys.includes(k)) ex.keys.push(k);
                if (content.length > ex.content.length) ex.content = content;
                ex.constant = ex.constant || !!e.constant;
            } else {
                map.set(title, { category: String(e.category || '设定').trim(), title, keys, content, constant: !!e.constant });
            }
        }
        logTo(logEl, `${label} 第${i + 1}段 → 累计 ${map.size} 条`, 'g');
    }
    return [...map.values()];
}

/**
 * 按篇章生成世界书（一总多分）
 *
 * @param {Array} nodes 时间线节点（篇章）列表
 * @param {{signal?:AbortSignal, logEl?:string, onProgress?:Function}} [opts]
 * @returns {Promise<{general:Array, chapters:Array<{name:string, entries:Array}>}>}
 */
export async function generateSplitWorldbook(nodes, { signal, logEl = 'ce_wb_log', onProgress } = {}) {
    const full = getNovel().trim();
    if (!full) throw new Error('请先导入小说');
    const chapters = (nodes || []).filter(Boolean);
    if (!chapters.length) throw new Error('请先在「时间线」页建立篇章');

    // —— 1. 总本：全局世界观 + 角色总表 + 剧情大纲 ——
    logTo(logEl, '生成总本（全局世界观 / 角色总表 / 剧情大纲）…');
    const general = await buildGeneralBook(full, chapters, { signal, logEl });

    // —— 2. 各篇章本：在该篇章范围内提取 ——
    const perChapter = [];
    for (let i = 0; i < chapters.length; i++) {
        if (signal && signal.aborted) break;
        const node = chapters[i];
        if (onProgress) onProgress(i, chapters.length, node.name);
        const seg = nodeText(node);                    // 该篇章正文范围
        const entries = await extractEntriesInRange(seg, node.name, { signal, logEl });
        perChapter.push({ name: node.name, entries });
    }

    logTo(logEl, '按篇章生成完成：总本 ' + general.length + ' 条，篇章本 ' + perChapter.length + ' 本', 'g');
    return { general, chapters: perChapter };
}

/**
 * 构建总本条目：全局世界观 + 角色总表 + 剧情大纲（均为常驻条目）
 * @param {string} full 全文
 * @param {Array} chapters 篇章列表（用于让 AI 知晓篇章结构）
 */
async function buildGeneralBook(full, chapters, { signal, logEl }) {
    const out = [];
    const chapterNames = chapters.map((n) => n.name).join('、');
    const sample = sampleText(full, 60000);

    // ① 全局世界观（整体背景/规则，不含角色个人档案）
    const p1 =
        '通读下面这部小说（节选），提取**贯穿全作的全局世界观与设定**：世界基本规则、整体地理/势力格局、' +
        '核心体系（如力量/科技/社会体系）、贯穿全作的重要概念。不要写任何单一角色的个人档案。\n' +
        '作品的篇章结构为：' + chapterNames + '\n' +
        '只依据原文，简洁准确，不编造。直接输出正文，不要标题、不要解释、不要代码块。\n\n=== 小说节选 ===\n' + sample;
    const c1 = await genText(p1, '总本·世界观', { signal, logEl });
    if (c1) out.push({ category: '世界观', title: '全局世界观', keys: [], content: c1, constant: true });

    // ② 角色总表（全作出场角色一览，供 AI 知道自己该认识谁）
    const p2 =
        '通读下面这部小说（节选），列出**全作主要出场角色总表**。每行一个角色：姓名（别名）——身份/阵营/一句话定位。\n' +
        '作品的篇章结构为：' + chapterNames + '\n' +
        '只依据原文，不要编造，不要展开个人档案。直接输出这份总表正文，不要解释、不要代码块。\n\n=== 小说节选 ===\n' + sample;
    const c2 = await genText(p2, '总本·角色总表', { signal, logEl });
    if (c2) out.push({ category: '角色总表', title: '角色总表', keys: [], content: c2, constant: true });

    // ③ 剧情大纲（全作主线脉络，按篇章顺序）
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
