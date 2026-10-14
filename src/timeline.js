/**
 * timeline.js —— 时间线（章节轴）数据结构与 AI 划分
 *
 * 解决多章节、跨时间线作品（如《刀剑神域》SAO→ALO→GGO 各篇章）的角色提取串线问题。
 *
 * 核心概念：
 *   Timeline = { nodes: [ { id, name, start, end, summary } ] }
 *   - name    篇章名（如「SAO篇」）
 *   - start   正文起始字符位置（含）
 *   - end     正文结束字符位置（不含）
 *   - summary 该篇章的世界观背景 / 核心事件 / 主要角色状态
 */

import { getNovel } from './novel.js';
import { settings, persist } from './store.js';
import { generate } from './generate.js';
import { stripFence, stripThink, extractJsonArray, logTo } from './util.js';

/** 生成一个稳定 id */
function makeId() {
    return 'tn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * 读取当前时间线（从设置持久化）
 * @returns {{nodes: Array}}
 */
export function getTimeline() {
    const s = settings();
    if (!s.timeline || typeof s.timeline !== 'object') s.timeline = { nodes: [] };
    if (!Array.isArray(s.timeline.nodes)) s.timeline.nodes = [];
    return s.timeline;
}

/** 保存时间线 */
export function saveTimeline(tl) {
    settings().timeline = tl;
    persist();
}

/** 清空时间线 */
export function clearTimeline() {
    saveTimeline({ nodes: [] });
}

/**
 * 是否已锁定（有节点且已通过校对）
 * 锁定标记存于 settings.timeline.locked
 */
export function isLocked() {
    const tl = getTimeline();
    return !!tl.locked && tl.nodes.length > 0;
}

export function setLocked(v) {
    const tl = getTimeline();
    tl.locked = !!v;
    saveTimeline(tl);
}

/**
 * 规范化单个节点（补齐字段、保证 start<end、clamp 到正文长度）
 */
export function normalizeNode(n, textLen) {
    const start = Math.max(0, Math.min(Number(n.start) || 0, textLen));
    let end = Number(n.end);
    if (!Number.isFinite(end) || end <= start) end = textLen;
    end = Math.max(start, Math.min(end, textLen));
    return {
        id: n.id || makeId(),
        name: String(n.name || '未命名篇章').trim(),
        start,
        end,
        summary: String(n.summary || '').trim(),
    };
}

/** 规范化整条时间线，并按 start 排序 */
export function normalizeTimeline(tl, textLen) {
    const nodes = (tl.nodes || [])
        .map((n) => normalizeNode(n, textLen))
        .sort((a, b) => a.start - b.start);
    return { nodes, locked: !!tl.locked };
}

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

/**
 * 解析「故事梗概」文本，提取篇章清单
 *
 * 支持用户常见的 markdown 梗概格式，如：
 *   ## 1. 艾恩葛朗特篇（Aincrad / SAO 篇，第 1 卷）
 *   （正文描述若干行……）
 *
 * 解析规则：
 *   - 以行首的 markdown 标题（# / ## / ###）或以「数字.」「数字、」「数字)」开头的行作为篇章起点
 *   - 篇章名取标题括号前的部分（去掉序号）
 *   - 自篇章名起，直到下一个篇章标题之间的所有非空行，拼成该篇章 summary
 *
 * @param {string} raw 梗概原文
 * @returns {Array<{name:string, summary:string}>}
 */
export function parseSynopsis(raw) {
    const lines = String(raw || '').split(/\r?\n/);
    const items = [];
    let cur = null;

    const isHeading = (ln) => {
        const t = ln.trim();
        if (!t) return false;
        if (/^#{1,6}\s+/.test(t)) return true;              // markdown 标题
        if (/^\d+\s*[.、)．]\s*\S/.test(t)) return true;     // 序号行：1. / 1、 / 1)
        return false;
    };

    for (const ln of lines) {
        if (isHeading(ln)) {
            if (cur) items.push(cur);
            let name = ln.trim().replace(/^#{1,6}\s+/, '').replace(/^\d+\s*[.、)．]\s*/, '');
            name = name.replace(/[（(].*$/, '').trim();      // 去掉括号里的补充说明
            if (!name) name = '篇章' + (items.length + 1);
            cur = { name, summary: '' };
        } else if (cur) {
            const t = ln.trim().replace(/^>\s?/, '');        // 去掉引用块前缀
            if (t && !/^-{3,}$/.test(t)) {
                cur.summary += (cur.summary ? '\n' : '') + t;
            }
        }
    }
    if (cur) items.push(cur);
    return items;
}

/**
 * 按「故事梗概」划分篇章
 *
 * 流程：
 *   1. 解析梗概得到篇章清单（篇名 + 概述）
 *   2. 篇名检索：在正文中查找篇名，命中则用首次出现位置作为分界起点
 *   3. AI 微调：对未命中的篇章，把抽样正文与篇章清单交给 AI，请它给出各篇章的起始占比
 *   4. 未命中且 AI 也未覆盖的，按顺序均分兜底
 *
 * @param {string} raw 梗概原文
 * @param {{signal?:AbortSignal, onLog?:(msg:string,cls?:string)=>void}} [opts]
 * @returns {Promise<{nodes:Array, missed:string[], refined:boolean}>}
 */
export async function divideBySynopsis(raw, { signal, onLog } = {}) {
    const text = getNovel();
    if (!text) throw new Error('请先导入小说');
    if (!String(raw || '').trim()) throw new Error('请先粘贴故事梗概');

    const log = (m, c) => { if (onLog) onLog(m, c); else logTo('ce_tl_log', m, c); };
    const textLen = text.length;
    const items = parseSynopsis(raw);
    if (!items.length) throw new Error('未能从梗概中解析出篇章，请检查格式（每篇以标题或「1.」开头）');
    log('梗概解析出 ' + items.length + ' 个篇章，开始在正文中检索篇名…');

    // ① 篇名检索
    const missed = [];
    for (const it of items) {
        const pos = text.indexOf(it.name);
        if (pos >= 0) {
            it.pos = pos;
            log('篇章「' + it.name + '」命中于 ' + (pos / textLen * 100).toFixed(1) + '%', 'g');
        } else {
            missed.push(it.name);
            log('篇章「' + it.name + '」未在正文中找到，将交由 AI 估算', 'e');
        }
    }

    // ② AI 微调：只要有未命中的篇章，就请求 AI 给出全部篇章的起始占比
    let refined = false;
    if (missed.length) {
        try {
            log('提交 AI 微调篇章边界…');
            const sample = sampleForTimeline(text);
            const prompt = buildSynopsisPrompt(items);
            const rawAi = await generate([
                { role: 'system', content: '你是精通叙事结构的文学分析师，擅长依据作品梗概定位章节在正文中的大致位置。' },
                { role: 'user', content: prompt + '\n\n=== 小说内容（抽样）===\n' + sample },
            ], { signal, useStream: false, maxCont: 2 });

            const arr = extractJsonArray(stripThink(stripFence(rawAi)));
            if (arr.length) {
                arr.forEach((it, i) => {
                    const pct = Number(it.start_pct);
                    if (Number.isFinite(pct) && items[i] && items[i].pos == null) {
                        items[i].pos = Math.round(pct * textLen);
                    }
                });
                refined = true;
                log('AI 已返回各篇章位置估算', 'g');
            }
        } catch (e) {
            log('AI 微调失败（' + e.message + '），未命中的篇章将按顺序均分', 'e');
        }
    }

    // ③ 均分兜底：仍无位置的篇章，按其在清单中的序号插值
    for (let i = 0; i < items.length; i++) {
        if (items[i].pos == null) items[i].pos = Math.round(i / items.length * textLen);
    }

    // 按位置排序后，相邻两篇章构成正文区间
    const ordered = items.slice().sort((a, b) => a.pos - b.pos);
    const nodes = ordered.map((it, i) => normalizeNode({
        name: it.name,
        summary: it.summary,
        start: it.pos,
        end: (i + 1 < ordered.length) ? ordered[i + 1].pos : textLen,
    }, textLen));

    // 首篇章起点归零（若有内容在第一个篇名之前）
    if (nodes.length && nodes[0].start > 0) nodes[0].start = 0;

    log('梗概划分完成，共 ' + nodes.length + ' 个篇章' + (missed.length ? '（' + missed.length + ' 个篇章由 AI/均分估算）' : ''), 'g');
    return { nodes, missed, refined };
}

/** 梗概划分的 AI 微调提示词 */
function buildSynopsisPrompt(items) {
    const list = items.map((it, i) =>
        (i + 1) + '. 「' + it.name + '」：' + (it.summary || '（无概述）').replace(/\n+/g, ' ')
    ).join('\n');
    return '下面给出这部小说的**篇章清单**（按剧情先后排列），以及小说的抽样内容。\n' +
        '请判断每个篇章大致从正文的哪个位置开始，用「起始占比」（0~1 的小数）表示。\n\n' +
        '篇章清单：\n' + list + '\n\n' +
        '只输出 JSON 数组，元素顺序与篇章清单一致，形如：\n' +
        '[{"start_pct":0.0},{"start_pct":0.25},{"start_pct":0.5}]\n' +
        '不要输出解释、不要代码块。';
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
 * 抽样全书：头、中、尾各取一段 + 等距多段，控制总长度
 */
function sampleForTimeline(text, cap = 60000) {
    if (text.length <= cap) return text;
    const pieces = [];
    const seg = 6000;
    const slices = 8;
    pieces.push(text.slice(0, seg));                 // 头部
    for (let i = 1; i < slices - 1; i++) {
        const start = Math.floor(i * text.length / slices);
        pieces.push(text.slice(start, start + seg));
    }
    pieces.push(text.slice(text.length - seg));       // 尾部
    return pieces.join('\n\n…（此处省略）…\n\n').slice(0, cap);
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

export default {
    getTimeline, saveTimeline, clearTimeline, isLocked, setLocked,
    normalizeNode, normalizeTimeline, autoDivide, divideByEvents,
    parseSynopsis, divideBySynopsis,
    nodeText, contextInNode,
};
