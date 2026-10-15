/**
 * persist.js —— 产物持久化管线
 *
 * 职责（在已打通的服务器落盘地基之上）：
 *  1. 断点续跑：把分段任务的进度指针（next/len/cap + 部分结果）落盘，刷新后可续跑。
 *  2. 篇章落盘：世界书按篇章独立落盘（某篇完成即写一个文件），并维护已完成索引。
 *  3. 导出/导入：把全部产物打包为 .json，或从 .json 恢复。
 *
 * 策略：双写 —— localforage（运行态，快读）+ Server Plugin（持久主存）。
 *       服务器不可用时静默跳过，功能与未装插件时一致。
 */

import { panelStore, serverMaybeSave, serverMaybeDel, serverStatus, settings, persist } from './store.js';
import { serverList, serverRead } from './st-bridge.js';

/** 落盘根目录下的子目录 */
const DIR_WB = 'worldbook';
const DIR_STATE = '_state';

/* ==================== 通用小工具 ==================== */

/** 安全文件名（去路径分隔与非法字符） */
export function safeName(name) {
    return String(name || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || ('item_' + Date.now());
}

/**
 * 工作区路径：以「记录名」为分区根。
 * rec 为空时回退到旧平铺路径（兼容未改造的调用）。
 * @param {string} rec 记录名（小说工作区）
 * @param {string} rel 相对路径，如 'worldbook/第一卷.json'
 * @returns {string}
 */
export function wsPath(rec, rel) {
    const r = String(rec || '').trim();
    return r ? (safeName(r) + '/' + rel) : rel;
}

/** 读取 panelStore 键（容错） */
async function pGet(key) {
    try { return await panelStore.load(key); } catch (e) { return null; }
}
/** 写入 panelStore 键（容错） */
async function pSet(key, val) {
    try { await panelStore.save(key, val); } catch (e) { /* 忽略 */ }
}

/* ==================== 一、断点续跑 ==================== */

/**
 * 序列化断点 state。
 * wbExtractCore 的 state 含 Map（map: Map<title, entry>），需转成数组。
 * @param {object} state 内核 state
 * @returns {object|null} 可 JSON 化的对象
 */
function encodeState(state) {
    if (!state || typeof state !== 'object') return null;
    const out = { ...state };
    if (state.map instanceof Map) out.map = [...state.map.entries()];
    return out;
}

/** 反序列化断点 state（数组 → Map） */
function decodeState(data) {
    if (!data || typeof data !== 'object') return null;
    const out = { ...data };
    if (Array.isArray(data.map)) out.map = new Map(data.map);
    return out;
}

/**
 * 规范化任务键：仅取冒号前的 kind。
 * 保证本地键与服务器路径算出同一 kind，避免二者不一致。
 */
function kindOf(taskKey) {
    return safeName(String(taskKey == null ? '' : taskKey).split(':')[0] || 'task');
}
/** 断点存储键（localforage；含记录名以隔离工作区） */
function progressKey(taskKey, rec) { return 'progress:' + (rec ? (safeName(rec) + ':') : '') + kindOf(taskKey); }
/** 断点对应的服务器相对路径（工作区内） */
function progressPath(taskKey, rec) {
    return wsPath(rec, DIR_STATE + '/resume_' + kindOf(taskKey) + '.json');
}

/**
 * 保存断点。
 * @param {string} taskKey 任务键，如 'extract'
 * @param {object} state  内核 state（含 next/len/cap/map）
 * @param {string} [rec]  记录名（工作区）；省略则回退旧平铺路径
 */
export async function saveProgress(taskKey, state, rec) {
    const enc = encodeState(state);
    if (!enc) return false;
    await pSet(progressKey(taskKey, rec), enc);
    await serverMaybeSave(progressPath(taskKey, rec), JSON.stringify(enc, null, 2));
    return true;
}

/**
 * 读取断点。
 * @param {string} taskKey
 * @param {string} [rec]
 * @returns {Promise<object|null>} 反序列化后的 state（含 Map），无则 null
 */
export async function loadProgress(taskKey, rec) {
    let enc = await pGet(progressKey(taskKey, rec));
    if (!enc) {
        // 本地无、服务器有：从服务器补读（换设备场景）
        const txt = await serverRead(progressPath(taskKey, rec));
        if (txt) { try { enc = JSON.parse(txt); } catch (e) { enc = null; } }
    }
    return decodeState(enc);
}

/** 清除断点（任务完成 / 正文变更作废时调用） */
export async function clearProgress(taskKey, rec) {
    await panelStore.del(progressKey(taskKey, rec)).catch(() => { });
    await serverMaybeDel(progressPath(taskKey, rec));
}

/* ==================== 二、世界书按篇章落盘 ==================== */

/** 单卷世界书的本地键 / 服务器路径（工作区内） */
function chapterKey(rec, name) { return 'wbchapter:' + (rec ? (safeName(rec) + ':') : '') + safeName(name); }
function chapterPath(rec, name) { return wsPath(rec, DIR_WB + '/' + safeName(name) + '.json'); }

/**
 * 落盘单卷世界书本（含总本 _whole）。
 * @param {string} rec 记录名（工作区）
 * @param {string} name 卷名（总本传 '_whole'）
 * @param {Array} entries 条目数组
 * @returns {Promise<boolean>}
 */
export async function saveChapterBook(rec, name, entries) {
    const data = { name, entries: entries || [], savedAt: Date.now() };
    await pSet(chapterKey(rec, name), data);
    await serverMaybeSave(chapterPath(rec, name), JSON.stringify(data, null, 2));
    return true;
}

/** 读回单卷世界书本 */
export async function loadChapterBook(rec, name) {
    let data = await pGet(chapterKey(rec, name));
    if (!data) {
        const txt = await serverRead(chapterPath(rec, name));
        if (txt) { try { data = JSON.parse(txt); } catch (e) { data = null; } }
    }
    return (data && Array.isArray(data.entries)) ? data : null;
}

/** 列出某工作区已落盘的卷文件名（不含 _whole）——即「已生成卷」清单 */
export async function listChapterBooks(rec) {
    const files = await serverList(wsPath(rec, DIR_WB));
    return files
        .filter((f) => f.toLowerCase().endsWith('.json'))
        .map((f) => f.replace(/^.*\//, '').replace(/\.json$/i, ''))
        .filter((n) => n && n !== '_whole');
}

/**
 * 判定某卷是否已生成（文件存在即已生成）。
 * 优先查本地键，再查服务器文件。
 * @param {string} rec 记录名
 * @param {string} name 卷名（'_whole' 为总本）
 * @returns {Promise<boolean>}
 */
export async function hasChapterBook(rec, name) {
    const local = await pGet(chapterKey(rec, name));
    if (local && Array.isArray(local.entries)) return true;
    const txt = await serverRead(chapterPath(rec, name));
    return txt != null;
}

/**
 * 列出某工作区已生成的卷集合（用于 UI 标记），返回 { name: true }。
 *
 * 枚举来源有两处，缺一不可：
 *   ① 服务器文件清单（可发现「不在当前时间线里」的历史卷）；
 *   ② 传入的候选卷名逐个用 hasChapterBook 判定（本地键优先）。
 * 之所以要 ② ：本地篇章键（panelStore 的 wbchapter:*）**无法枚举**，
 * 未启用 Server Plugin 时 ① 恒为空，只有按候选名逐个查文件才能得到「已生成」。
 *
 * @param {string} rec 记录名
 * @param {string[]} [names] 候选卷名（通常来自时间线节点）
 */
export async function doneChapterSet(rec, names = []) {
    const set = {};
    for (const n of await listChapterBooks(rec)) set[n] = true;
    for (const n of (names || [])) {
        if (n && !set[n] && await hasChapterBook(rec, n)) set[n] = true;
    }
    if (await hasChapterBook(rec, '_whole')) set['_whole'] = true;
    return set;
}

/* ==================== 三、已完成篇章索引（小数据） ==================== */

/** 索引缓存键：以工作区记录名隔离，避免不同小说互相污染 */
function idxKey(rec) { return rec ? safeName(rec) : ''; }

/**
 * 保存已完成篇章索引（小数据：写 extensionSettings + 服务器）。
 * 注意：这是「便捷索引」，权威判定仍以文件存在为准（hasChapterBook）。
 * 存储形状：{ [记录名]: { updatedAt, chapters } }，按工作区分区。
 * @param {Array<{name:string,count:number}>} chapters
 * @param {string} [rec] 记录名（工作区）
 */
export async function saveWbIndex(chapters, rec) {
    const idx = { updatedAt: Date.now(), chapters: chapters || [] };
    // 小数据优先入 extensionSettings（随酒馆设置落盘、体积小、换设备可跟随）
    // 按记录名键控，避免把 A 书的索引写进 B 书
    const s = settings();
    const all = (s.wbIndex && typeof s.wbIndex === 'object' && !Array.isArray(s.wbIndex)) ? { ...s.wbIndex } : {};
    all[idxKey(rec)] = idx;
    s.wbIndex = all;
    persist();
    await serverMaybeSave(wsPath(rec, DIR_STATE + '/wb_index.json'), JSON.stringify(idx, null, 2));
    return idx;
}

/**
 * 读取已完成篇章索引（优先 extensionSettings 中该工作区的槽，回落服务器文件）。
 * 旧结构（未分区的 {updatedAt, chapters}）视为无效缓存，直接回落服务器。
 */
export async function loadWbIndex(rec) {
    const s = settings();
    const all = (s.wbIndex && typeof s.wbIndex === 'object' && !Array.isArray(s.wbIndex)) ? s.wbIndex : null;
    let idx = all ? all[idxKey(rec)] : null;
    if (!idx || !Array.isArray(idx.chapters)) {
        const txt = await serverRead(wsPath(rec, DIR_STATE + '/wb_index.json'));
        if (txt) { try { idx = JSON.parse(txt); } catch (e) { idx = null; } }
    }
    return (idx && Array.isArray(idx.chapters)) ? idx : { updatedAt: 0, chapters: [] };
}

/* ==================== 三之二、工作区其他状态 ==================== */

/** 保存该工作区的生成选项 + 时间线快照（中间状态） */
export async function saveOpts(rec, opts) {
    // 与既有选项合并，避免「保存正文」这类调用抹掉已记录的生成选项（mode/options）
    const prev = await loadOpts(rec);
    const data = { ...(prev || {}), ...(opts || {}), savedAt: Date.now() };
    await pSet('wsopts:' + (rec ? safeName(rec) : ''), data);
    await serverMaybeSave(wsPath(rec, DIR_STATE + '/opts.json'), JSON.stringify(data, null, 2));
    return true;
}

/** 读取该工作区的生成选项 */
export async function loadOpts(rec) {
    let data = await pGet('wsopts:' + (rec ? safeName(rec) : ''));
    if (!data) {
        const txt = await serverRead(wsPath(rec, DIR_STATE + '/opts.json'));
        if (txt) { try { data = JSON.parse(txt); } catch (e) { data = null; } }
    }
    return data || null;
}

/** 保存正文到工作区（<记录名>/novel.txt） */
export async function saveNovelText(rec, text, name) {
    const body = String(text == null ? '' : text);
    await serverMaybeSave(wsPath(rec, 'novel.txt'), body);
    // 同时记一份文件名到 opts（便于识别）
    if (name) await saveOpts(rec, { novelName: name });
    return true;
}

/** 读取工作区正文 */
export async function loadNovelText(rec) {
    return await serverRead(wsPath(rec, 'novel.txt'));
}

/* ==================== 四、导出 / 导入备份 ==================== */

/** 需要纳入备份的产物键（与 ui-context 的 PRODUCT_KEYS 对齐，另含小说记录） */
const BACKUP_PANEL_KEYS = ['products', 'logs'];

/**
 * 打包全部产物为可下载的 JSON 字符串。
 * @param {string} [rec] 记录名（工作区）；省略则导出全局面板产物
 * @param {object} [extra] 额外附加内容（如小说列表）
 * @returns {Promise<string>}
 */
export async function exportAll(rec, extra = {}) {
    const panel = {};
    for (const k of BACKUP_PANEL_KEYS) {
        const v = await pGet(k);
        if (v != null) panel[k] = v;
    }
    // 已落盘的卷（以索引为线索，实际读取文件）
    const idx = await loadWbIndex(rec);
    const chapters = {};
    for (const c of idx.chapters) {
        const book = await loadChapterBook(rec, c.name);
        if (book) chapters[c.name] = book;
    }
    const whole = await loadChapterBook(rec, '_whole');
    const pack = {
        format: 'card-extractor-backup',
        version: 1,
        exportedAt: Date.now(),
        rec: rec || '',
        panel,
        wbIndex: idx,
        worldbook: { whole: whole || null, chapters },
        ...extra,
    };
    return JSON.stringify(pack, null, 2);
}

/**
 * 从备份 JSON 恢复产物（本地 + 服务器）。
 * @param {string} json
 * @param {string} [rec] 记录名（工作区）；省略则用备份内的 rec
 * @returns {Promise<{ok:boolean, message:string}>}
 */
export async function importAll(json, rec) {
    let pack;
    try { pack = JSON.parse(String(json || '')); } catch (e) { return { ok: false, message: 'JSON 解析失败：' + e.message }; }
    if (!pack || pack.format !== 'card-extractor-backup') return { ok: false, message: '不是本工具的备份文件' };
    const r = rec || pack.rec || '';

    // 面板产物
    if (pack.panel && typeof pack.panel === 'object') {
        for (const k of Object.keys(pack.panel)) await pSet(k, pack.panel[k]);
    }
    // 世界书：总本 + 各卷
    if (pack.worldbook) {
        if (pack.worldbook.whole) await saveChapterBook(r, '_whole', pack.worldbook.whole.entries || []);
        const chs = pack.worldbook.chapters || {};
        for (const name of Object.keys(chs)) {
            await saveChapterBook(r, name, (chs[name] && chs[name].entries) || []);
        }
    }
    // 索引
    if (pack.wbIndex && Array.isArray(pack.wbIndex.chapters)) await saveWbIndex(pack.wbIndex.chapters, r);

    return { ok: true, message: '导入完成' };
}

/** 探测服务器落盘是否可用（供 UI 显示状态） */
export function persistAvailable() {
    return serverStatus();
}

export default {
    safeName, wsPath,
    saveProgress, loadProgress, clearProgress,
    saveChapterBook, loadChapterBook, listChapterBooks, hasChapterBook, doneChapterSet,
    saveWbIndex, loadWbIndex, saveOpts, loadOpts, saveNovelText, loadNovelText,
    exportAll, importAll, persistAvailable,
};
