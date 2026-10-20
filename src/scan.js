/**
 * scan.js —— 角色扫描与上下文收集
 *
 * 迁移自原 index.html：collectContext / 扫描全书 / 角色合并等逻辑。
 */

import { getNovel } from './novel.js';
import { settings, persist } from './store.js';
import { uniq } from './util.js';

/** 角色列表（懒加载自设置持久化，刷新不丢） */
let characters = null;

export function getCharacters() {
    if (characters == null) {
        const s = settings();
        characters = Array.isArray(s.characters) ? s.characters : [];
    }
    return characters;
}

/**
 * 丢弃内存缓存，下次 getCharacters 重新从 settings 读。
 * 切换小说时必须调用：否则缓存的仍是上一本的角色列表。
 */
export function invalidateCharacters() {
    characters = null;
}

export function setCharacters(list) {
    characters = Array.isArray(list) ? list : [];
    settings().characters = characters;
    persist();
    return characters;
}

export function clearCharacters() {
    characters = [];
    settings().characters = [];
    persist();
}

/** 取某角色的所有称呼（名字 + 别名） */
export function charNames(name) {
    const c = getCharacters().find((x) => x.name === name);
    return uniq([name, ...((c && c.aliases) ? c.aliases : [])]);
}

/**
 * 收集某角色相关的上下文段落
 * 迁移自原 collectContext；超量时跨全书等距采样，兼顾开头/中间/结尾
 * @param {string} name 角色名
 * @param {string[]} extra 额外关键词（如被替换的 user 名）
 * @param {boolean} fullCtx 是否用全文
 * @param {{start:number,end:number}|null} range 限定章节范围（时间线节点），null 表示全书
 */
export function collectContext(name, extra = [], fullCtx = false, range = null) {
    const s = settings();
    const full = getNovel();
    // 时间线：限定正文范围
    const text = range ? full.slice(range.start || 0, range.end || full.length) : full;
    const CAP = Math.max(10000, Number(s.ctxCap) || 90000);
    const FULLCAP = Math.max(10000, Number(s.fullCap) || 120000);

    if (fullCtx) return text.slice(0, FULLCAP);

    const names = uniq([...charNames(name), ...extra]);
    const paras = text.split(/\n\s*\n|\n/).filter((p) => p.trim());
    const hit = paras.filter((p) => names.some((n) => p.includes(n)));
    if (hit.length === 0) return text.slice(0, FULLCAP);

    const total = hit.reduce((sum, p) => sum + p.length + 2, 0);
    if (total <= CAP) return hit.join('\n\n');

    const avg = total / hit.length;
    const keepN = Math.max(2, Math.min(hit.length, Math.floor(CAP / avg)));
    const seen = new Set();
    const out = [];
    for (let i = 0; i < keepN; i++) {
        const idx = Math.round(i * (hit.length - 1) / (keepN - 1));
        if (!seen.has(idx)) { seen.add(idx); out.push(hit[idx]); }
    }
    let joined = out.join('\n\n');
    if (joined.length > CAP) joined = joined.slice(0, CAP);
    return joined;
}

/**
 * 全书抽样（用于文风蒸馏）
 * @param {number} perChunk 每段字符数
 * @param {number} slices 采样段数
 * @param {number} cap 总字符上限
 */
export function sampleForStyle(perChunk = 8000, slices = 6, cap = 52000) {
    const text = getNovel();
    if (!text) return '';
    if (text.length <= cap) return text;
    const out = [];
    const step = Math.floor(text.length / slices);
    for (let i = 0; i < slices; i++) {
        const start = Math.floor(i * step);
        out.push(text.slice(start, start + perChunk));
    }
    return out.join('\n\n…\n\n').slice(0, cap);
}

/** 小说抽样（供世界书等使用） */
export function novelSampleOrEmpty() {
    const t = getNovel().trim();
    return t ? sampleForStyle(t) : '';
}

export default {
    getCharacters, setCharacters, clearCharacters, invalidateCharacters, charNames,
    collectContext, sampleForStyle, novelSampleOrEmpty,
};
