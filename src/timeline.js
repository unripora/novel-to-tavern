/**
 * timeline.js —— 时间线（章节轴）总控
 *
 * 解决多章节、跨时间线作品（如《刀剑神域》SAO→ALO→GGO 各篇章）的角色提取串线问题。
 *
 * 核心概念：
 *   Timeline = { nodes: [ { id, name, start, end, summary } ] }
 *   - name    篇章名（如「SAO篇」）
 *   - start   正文起始字符位置（含）
 *   - end     正文结束字符位置（不含）
 *   - summary 该篇章的世界观背景 / 核心事件 / 主要角色状态
 *
 * 本文件保留：AI 自动划分、按事件名划分、节点取文。
 * 数据结构见 timeline-core.js，梗概划分见 timeline-synopsis.js。
 */

import { getNovel } from './novel.js';
import { generate } from './generate.js';
import { stripFence, stripThink, extractJsonArray, logTo } from './util.js';
import { normalizeNode, normalizeTimeline, getTimeline, saveTimeline, clearTimeline, isLocked, setLocked } from './timeline-core.js';
import {
    sampleForTimeline, parseSynopsis, divideBySynopsis, normalizeSynopsisText,
    coreKeyword, coreKeywords, fuzzyFind,
} from './timeline-synopsis.js';

/**
 * AI 自动划分章节 / 阶段
 * 策略：抽样全书（头/中/尾 + 等距），让 AI 依据剧情结构给出篇章划分。
 * 注意：AI 无法给出精确字符位置，这里用「相对占比」估算，再由用户在界面校对。
 *
 * @param {{signal?:AbortSignal, onLog?:(msg:string,cls?:string)=>void}} opts
 * @returns {Promise<Array>} 规范化后的节点数组
 */
export async function autoDivide({ signal, onLog } = {}) {
    const text = getNovel().trim();
    if (!text) throw new Error('请先导入小说');

    const log = (m, c) => { if (onLog) onLog(m, c); else logTo('ce_tl_log', m, c); };
    log('正在抽样全书，准备划分章节…');

    const sample = sampleForTimeline(text);
    const prompt = buildDividePrompt();
    log('已提交 AI 划分，等待返回…');

    const raw = await generate([
        { role: 'system', content: '你是精通叙事结构的文学分析师，擅长识别长篇作品的分卷、篇章与阶段结构。' },
        { role: 'user', content: prompt + '\n\n=== 小说内容（抽样）===\n' + sample },
    ], { signal, useStream: false, maxCont: 2 });

    const arr = extractJsonArray(stripThink(stripFence(raw)));
    if (!arr.length) throw new Error('AI 未返回有效的章节划分，请重试或手动添加');

    const textLen = text.length;
    const nodes = arr.map((it, i) => {
        // 兼容 AI 返回 {name, summary, ratio} 或 {name, start_pct, end_pct}
        const name = it.name || it.title || ('篇章' + (i + 1));
        const summary = it.summary || it.desc || '';
        let startPct = Number(it.start_pct);
        let endPct = Number(it.end_pct);
        if (!Number.isFinite(startPct)) {
            // 退化为按序号均分
            startPct = i / arr.length;
            endPct = (i + 1) / arr.length;
        }
        if (!Number.isFinite(endPct)) endPct = (i + 1) / arr.length;
        return normalizeNode({
            name,
            summary,
            start: Math.round(startPct * textLen),
            end: Math.round(endPct * textLen),
        }, textLen);
    });

    log('划分完成，共 ' + nodes.length + ' 个篇章（请校对后再使用）', 'g');
    return nodes;
}

/**
 * 按事件名检索划分篇章
 *
 * 逻辑与角色检索一致：在正文中查找每个事件关键词，取首次出现位置作为该事件的「起点」，
 * 相邻两事件之间构成一个篇章（篇名用后一个事件名），最后一个事件到全书末尾构成末篇章。
 *
 * @param {string[]} events 事件名列表（按剧情先后顺序）
 * @param {{onLog?:(msg:string,cls?:string)=>void}} [opts]
 * @returns {{nodes:Array, missed:string[]}} 划分结果 + 未命中的事件名
 */
export function divideByEvents(events, { onLog } = {}) {
    const text = getNovel();
    if (!text) throw new Error('请先导入小说');
    const log = (m, c) => { if (onLog) onLog(m, c); else logTo('ce_tl_log', m, c); };

    const list = (events || []).map((s) => String(s || '').trim()).filter(Boolean);
    if (!list.length) throw new Error('请至少输入一个事件名');

    const textLen = text.length;
    const found = [];   // { name, pos }
    const missed = [];  // 未命中的事件名

    for (const name of list) {
        const pos = text.indexOf(name);
        if (pos < 0) {
            missed.push(name);
            log('未找到事件「' + name + '」，已跳过', 'e');
        } else {
            found.push({ name, pos });
            log('事件「' + name + '」首次出现于 ' + (pos / textLen * 100).toFixed(1) + '%', 'g');
        }
    }
    if (!found.length) throw new Error('所有事件都未在正文中找到，请检查关键词');

    // 按出现位置排序（用户输入顺序可能与正文顺序不一致）
    found.sort((a, b) => a.pos - b.pos);

    // 相邻事件之间为一个篇章，篇名用后一个事件名；最后一个事件到末尾为末篇章
    const nodes = [];
    for (let i = 0; i < found.length; i++) {
        const start = i === 0 ? 0 : found[i].pos;
        const end = (i + 1 < found.length) ? found[i + 1].pos : textLen;
        nodes.push(normalizeNode({
            name: found[i].name,
            summary: '',
            start,
            end,
        }, textLen));
    }

    log('检索完成，共 ' + nodes.length + ' 个篇章' + (missed.length ? ('（' + missed.length + ' 个事件未命中）') : ''), 'g');
    return { nodes, missed };
}


/** 划分用的提示词 */
function buildDividePrompt() {
    return '下面是一部小说（内容为抽样片段）。请识别它的**篇章 / 阶段结构**——即按剧情发展划分出的若干阶段' +
        '（如「SAO篇」「ALO篇」，或「童年」「成长」「决战」，或「第一卷」「第二卷」等，以作品实际结构为准）。\n' +
        '对每个阶段给出：\n' +
        '1. name：阶段名称（简短，用作品里的通用叫法）\n' +
        '2. summary：该阶段的世界观背景、核心事件、主要角色状态（一两句话）\n' +
        '3. start_pct / end_pct：该阶段在全文中的大致位置占比（0~1 的小数）\n\n' +
        '只输出 JSON 数组，元素形如：\n' +
        '{"name":"SAO篇","summary":"...","start_pct":0.0,"end_pct":0.25}\n' +
        '只依据内容判断，通常 2~8 个阶段。不要输出解释、不要代码块。';
}

/**
 * 取某节点的正文范围
 * @param {object} node
 * @returns {string}
 */
export function nodeText(node) {
    const text = getNovel();
    if (!node) return text;
    return text.slice(node.start || 0, node.end || text.length);
}

/**
 * 取某角色在指定节点内的相关段落（供 collectContext 使用）
 * @param {string} name 角色名
 * @param {string[]} aliases 别名
 * @param {object} node 时间线节点
 * @param {number} cap 字符上限
 */
export function contextInNode(name, aliases, node, cap = 60000) {
    const seg = nodeText(node);
    const names = [name, ...(aliases || [])].filter(Boolean);
    const paras = seg.split(/\n\s*\n|\n/).filter((p) => p.trim());
    const hit = paras.filter((p) => names.some((n) => p.includes(n)));
    const used = hit.length ? hit : paras;
    let joined = used.join('\n\n');
    if (joined.length > cap) joined = joined.slice(0, cap);
    return joined;
}

// 统一对外导出（保持与拆分前一致的 API）
export { getTimeline, saveTimeline, clearTimeline, isLocked, setLocked, normalizeNode, normalizeTimeline } from './timeline-core.js';
export {
    parseSynopsis, coreKeyword, coreKeywords, fuzzyFind,
    normalizeSynopsisText, divideBySynopsis, sampleForTimeline,
} from './timeline-synopsis.js';

export default {
    getTimeline, saveTimeline, clearTimeline, isLocked, setLocked,
    normalizeNode, normalizeTimeline, autoDivide, divideByEvents,
    parseSynopsis, divideBySynopsis, normalizeSynopsisText,
    coreKeyword, coreKeywords, fuzzyFind,
    nodeText, contextInNode,
};
