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

/** SEO 安全文件名（去路径分隔与非法字符） */
export function safeName(name) {
    return String(name || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || ('item_' + Date.now());
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

/** 断点存储键（localforage 与服务器共用同一 taskKey 概念） */
function progressKey(taskKey) { return 'progress:' + taskKey; }
/** 断点对应的服务器相对路径 */
function progressPath(taskKey) { return DIR_STATE + '/progress_' + safeName(taskKey) + '.json'; }

/**
 * 保存断点。
 * @param {string} taskKey 任务键，如 'extract:某小说'
 * @param {object} state  内核 state（含 next/len/cap/map）
 */
export async function saveProgress(taskKey, state) {
    const enc = encodeState(state);
    if (!enc) return false;
    await pSet(progressKey(taskKey), enc);
    await serverMaybeSave(progressPath(taskKey), JSON.stringify(enc, null, 2));
    return true;
}

/**
 * 读取断点。
 * @param {string} taskKey
 * @returns {Promise<object|null>} 反序列化后的 state（含 Map），无则 null
 */
export async function loadProgress(taskKey) {
    let enc = await pGet(progressKey(taskKey));
    if (!enc) {
        // 本地无、服务器有：从服务器补读（换设备场景）
        const txt = await serverRead(progressPath(taskKey));
        if (txt) { try { enc = JSON.parse(txt); } catch (e) { enc = null; } }
    }
    return decodeState(enc);
}

/** 清除断点（任务完成 / 正文变更作废时调用） */
export async function clearProgress(taskKey) {
    await pSet(progressKey(taskKey), null);
    await panelStore.del(progressKey(taskKey)).catch(() => { });
    await serverMaybeDel(progressPath(taskKey));
}

/* ==================== 二、世界书按篇章落盘 ==================== */

/** 单篇世界书的本地键 / 服务器路径 */
function chapterKey(name) { return 'wbchapter:' + safeName(name); }
function chapterPath(name) { return DIR_WB + '/' + safeName(name) + '.json'; }

/**
 * 落盘单篇世界书本（含总本）。
 * @param {string} name 篇章名（总本传 '_whole'）
 * @param {Array} entries 条目数组
 * @returns {Promise<boolean>}
 */
export async function saveChapterBook(name, entries) {
    const data = { name, entries: entries || [], savedAt: Date.now() };
    await pSet(chapterKey(name), data);
    await serverMaybeSave(chapterPath(name), JSON.stringify(data, null, 2));
    return true;
}

/** 读回单篇世界书本 */
export async function loadChapterBook(name) {
    let data = await pGet(chapterKey(name));
    if (!data) {
        const txt = await serverRead(chapterPath(name));
        if (txt) { try { data = JSON.parse(txt); } catch (e) { data = null; } }
    }
    return (data && Array.isArray(data.entries)) ? data : null;
}

/** 列出服务器上已落盘的篇章本文件名（不含 _whole） */
export async function listChapterBooks() {
    const files = await serverList(DIR_WB);
    return files
        .filter((f) => f.toLowerCase().endsWith('.json'))
        .map((f) => f.replace(/^.*\//, '').replace(/\.json$/i, ''))
        .filter((n) => n && n !== '_whole');
}

/* ==================== 三、已完成篇章索引（小数据） ==================== */

/**
 * 保存已完成篇章索引（小数据：写 extensionSettings + 服务器）。
 * 结构：{ updatedAt, chapters: [{ name, count, savedAt }] }
 * @param {Array<{name:string,count:number}>} chapters
 */
export async function saveWbIndex(chapters) {
    const idx = { updatedAt: Date.now(), chapters: chapters || [] };
    // 小数据优先入 extensionSettings（随酒馆设置落盘、体积小、换设备可跟随）
    const s = settings();
    s.wbIndex = idx;
    persist();
    await serverMaybeSave(DIR_STATE + '/wb_index.json', JSON.stringify(idx, null, 2));
    return idx;
}

/** 读取已完成篇章索引（优先 extensionSettings，回落服务器） */
export async function loadWbIndex() {
    const s = settings();
    let idx = s.wbIndex;
    if (!idx || !Array.isArray(idx.chapters)) {
        const txt = await serverRead(DIR_STATE + '/wb_index.json');
        if (txt) { try { idx = JSON.parse(txt); } catch (e) { idx = null; } }
    }
    return (idx && Array.isArray(idx.chapters)) ? idx : { updatedAt: 0, chapters: [] };
}

/* ==================== 四、导出 / 导入备份 ==================== */

/** 需要纳入备份的产物键（与 ui-context 的 PRODUCT_KEYS 对齐，另含小说记录） */
const BACKUP_PANEL_KEYS = ['products', 'logs'];

/**
 * 打包全部产物为可下载的 JSON 字符串。
 * @param {object} [extra] 额外附加内容（如小说列表）
 * @returns {Promise<string>}
 */
export async function exportAll(extra = {}) {
    const panel = {};
    for (const k of BACKUP_PANEL_KEYS) {
        const v = await pGet(k);
        if (v != null) panel[k] = v;
    }
    // 已落盘的篇章本（本地键遍历不可行时，退化为索引）
    const idx = await loadWbIndex();
    const chapters = {};
    for (const c of idx.chapters) {
        const book = await loadChapterBook(c.name);
        if (book) chapters[c.name] = book;
    }
    const whole = await loadChapterBook('_whole');
    const pack = {
        format: 'card-extractor-backup',
        version: 1,
        exportedAt: Date.now(),
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
 * @returns {Promise<{ok:boolean, message:string}>}
 */
export async function importAll(json) {
    let pack;
    try { pack = JSON.parse(String(json || '')); } catch (e) { return { ok: false, message: 'JSON 解析失败：' + e.message }; }
    if (!pack || pack.format !== 'card-extractor-backup') return { ok: false, message: '不是本工具的备份文件' };

    // 面板产物
    if (pack.panel && typeof pack.panel === 'object') {
        for (const k of Object.keys(pack.panel)) await pSet(k, pack.panel[k]);
    }
    // 世界书：总本 + 各篇章本
    if (pack.worldbook) {
        if (pack.worldbook.whole) await saveChapterBook('_whole', pack.worldbook.whole.entries || []);
        const chs = pack.worldbook.chapters || {};
        for (const name of Object.keys(chs)) {
            await saveChapterBook(name, (chs[name] && chs[name].entries) || []);
        }
    }
    // 索引
    if (pack.wbIndex && Array.isArray(pack.wbIndex.chapters)) await saveWbIndex(pack.wbIndex.chapters);

    return { ok: true, message: '导入完成' };
}

/** 探测服务器落盘是否可用（供 UI 显示状态） */
export function persistAvailable() {
    return serverStatus();
}

export default {
    safeName,
    saveProgress, loadProgress, clearProgress,
    saveChapterBook, loadChapterBook, listChapterBooks,
    saveWbIndex, loadWbIndex,
    exportAll, importAll, persistAvailable,
};
