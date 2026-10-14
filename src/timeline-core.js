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

/** 规范化整条时间线，并按 start 排序 */
export function normalizeTimeline(tl, textLen) {
    const nodes = (tl.nodes || [])
        .map((n) => normalizeNode(n, textLen))
        .sort((a, b) => a.start - b.start);
    return { nodes, locked: !!tl.locked };
}
