/**
 * timeline-core.js —— 时间线数据结构与持久化
 *
 * 从 timeline.js 拆出（避免单文件超 500 行）。
 * 职责：时间线读写（存 settings）、锁定状态、节点/整表规范化。
 */

import { settings, persist } from './store.js';

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

/** 篇章有序化时的容差比例（允许后一篇开头比前一篇末尾早至此比例） */
const ORDER_TOL_RATIO = 0.05;

/**
 * 强制篇章有序：后一篇的开头不早于前一篇的末尾。
 *
 * 背景：篇章边界本身是模糊的——划分/检索都可能略有偏差，因此允许后一篇开头
 * 比前一篇末尾**早至多 tol 个字符**（默认取正文长度的 5%）；「略晚」不设限。
 * 超出容差的倒挂才回拉到紧邻位置。
 *
 * 另修正 end<start 的异常：不再退化为「一直到正文末尾」（那会与大段后续篇章重叠）。
 *
 * 注意：这里**不复用 normalizeNode**——它在 end<=start 时会把 end 置为 textLen，
 * 恰好会掩盖重叠问题；故本函数直接按原始 start/end 处理。
 *
 * @param {Array} nodes 节点数组
 * @param {number} textLen 正文长度
 * @param {number} [tol] 容差（字符数），默认取正文长度的 5%
 * @returns {Array} 规范化且单调的节点数组（按 start 升序）
 */
export function enforceOrder(nodes, textLen, tol) {
    const len = Math.max(0, Number(textLen) || 0);
    const t = Math.max(0, Number.isFinite(tol) ? tol : Math.round(len * ORDER_TOL_RATIO));
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const list = (nodes || []).map((n) => ({
        id: n.id || makeId(),
        name: String(n.name || '未命名篇章').trim(),
        summary: String(n.summary || '').trim(),
        start: Math.max(0, Math.min(num(n.start, 0), len)),
        end: Math.max(0, Math.min(num(n.end, len), len)),
    })).sort((a, b) => a.start - b.start);

    // ① 先修正 end<start：取下一篇起点（无则正文末尾）
    for (let i = 0; i < list.length; i++) {
        if (list[i].end < list[i].start) {
            list[i].end = (i + 1 < list.length) ? Math.max(list[i].start, list[i + 1].start) : len;
        }
    }
    // ② 单调化 start：后一篇开头不早于前一篇末尾（允许 tol 以内略早）
    for (let i = 1; i < list.length; i++) {
        const floor = list[i - 1].end - t;
        if (list[i].start < floor) list[i].start = Math.max(list[i - 1].start, floor);
    }
    // ③ start 被抬高后可能再次 end<start，回填
    for (let i = 0; i < list.length; i++) {
        if (list[i].end < list[i].start) {
            list[i].end = (i + 1 < list.length) ? list[i + 1].start : len;
            if (list[i].end < list[i].start) list[i].end = list[i].start;
        }
    }
    return list;
}

/** 规范化整条时间线，并强制篇章有序 */
export function normalizeTimeline(tl, textLen) {
    return { nodes: enforceOrder(tl.nodes, textLen), locked: !!tl.locked };
}
