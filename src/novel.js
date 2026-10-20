/**
 * novel.js —— 小说导入与持久化
 *
 * 迁移自原 index.html 的 readNovelFile / pickDecoder / setNovel 逻辑。
 * 正文存 localforage（见 store.js）。
 */

import { novelStore, settings, persist, serverMaybeDel } from './store.js';
import * as persistMod from './persist.js';
import { switchNovelScope, dropNovelScope } from './novel-scope.js';

const READ_CHUNK = 4 * 1024 * 1024;   // 每次读取 4MB
const PREVIEW_LIMIT = 200000;          // 预览截断长度

/** 当前内存中的正文 */
let novelText = '';

export function getNovel() {
    return novelText;
}

/** 当前正文对应的记录名（用于刷新后自动恢复） */
export function getCurrentRecord() {
    return settings().curNovel || '';
}

/**
 * 切换当前记录名，并同步切换「中间产物分区」。
 *
 * 这是换小说的唯一入口：角色列表、时间线、角色卡等产物都按记录名各存一份，
 * 切到新小说时旧产物不会残留；切回旧小说时自动恢复。
 *
 * @param {string} name 目标记录名
 * @param {object} [state] ui-context 的 state（用于读写面板产物）
 * @returns {Promise<{restored:boolean, characters:number, nodes:number}|null>}
 */
async function setCurrentRecord(name, state) {
    const prev = getCurrentRecord();
    const next = name || '';
    settings().curNovel = next;
    persist();
    if (prev === next) return null;
    const res = state ? await switchNovelScope({ prev, next, state }) : null;
    // scan 的角色列表有内存缓存，切换后必须失效，否则仍返回上一本的角色。
    // 用动态 import 打破 novel.js ↔ scan.js 的循环依赖。
    try { (await import('./scan.js')).invalidateCharacters(); } catch (e) { /* 忽略 */ }
    return res;
}

export function previewOf(text) {
    return (text || '').slice(0, PREVIEW_LIMIT);
}

export function setNovel(text) {
    novelText = text || '';
    return novelText;
}

/** 让出主线程，避免大文件解码卡死 UI */
function yieldToUI() {
    return new Promise((r) => setTimeout(r, 0));
}

/**
 * 采样文件头部判断编码，避免对超长文本全量多次解码
 * @param {File|Blob} f
 */
async function pickDecoder(f) {
    const head = await f.slice(0, Math.min(65536, f.size)).arrayBuffer();
    const b = new Uint8Array(head);
    if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return 'utf-8';
    if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return 'utf-16le';
    if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return 'utf-16be';
    const bad = (s) => (s.match(/\uFFFD/g) || []).length;
    let best = 'utf-8';
    let bestBad = Infinity;
    for (const enc of ['utf-8', 'gb18030']) {
        let t = '';
        try { t = new TextDecoder(enc).decode(b); } catch (e) { continue; }
        const n = bad(t);
        if (n < bestBad) { bestBad = n; best = enc; if (n === 0) break; }
    }
    return best;
}

/**
 * 分片读取文件并增量解码
 * @param {File} f
 * @param {(pct:number, text:string)=>void} onProgress
 * @param {object} [state] ui-context 的 state（切换分区用）
 * @returns {Promise<{text:string, enc:string, record:string, scope:object|null}>}
 */
export async function readNovelFile(f, onProgress, state) {
    const total = f.size;
    if (!total) return { text: '', enc: 'utf-8' };

    const dec = await pickDecoder(f);
    const decoder = new TextDecoder(dec, { fatal: false });
    const parts = [];
    let done = 0;

    while (done < total) {
        const end = Math.min(done + READ_CHUNK, total);
        const buf = await f.slice(done, end).arrayBuffer();
        parts.push(decoder.decode(buf, { stream: end < total }));
        done = end;
        if (onProgress) {
            const decoded = parts.reduce((s, p) => s + p.length, 0);
            onProgress(done / total * 100, '读取中 ' + Math.round(done / total * 100) + '% · 已解码约 ' + decoded.toLocaleString() + ' 字');
        }
        await yieldToUI();
    }
    parts.push(decoder.decode());   // flush

    const text = parts.join('');
    setNovel(text);
    // 导入即自动落盘：用文件名（去扩展名）作为记录名，刷新后可自动恢复
    const recName = (f.name || '').replace(/\.[^.]+$/, '').trim() || ('导入_' + Date.now());
    let scope = null;
    try { scope = (await saveNovelRecord(recName, state)).scope; } catch (e) { /* 存储不可用时不阻断导入 */ }
    return { text, enc: dec, record: recName, scope };
}

/**
 * 启动时恢复上次使用的正文（若存在）。
 * 传了 state 时，顺带载入该小说的中间产物分区（角色 / 时间线 / 角色卡）。
 * 冷启动不传 state，只还原正文，避免在面板未挂载时动分区。
 */
export async function restoreLastNovel(state) {
    const name = getCurrentRecord();
    if (!name) return '';
    try {
        const text = await novelStore.load(name);
        if (text) setNovel(text);
        if (state) {
            // 冷启动时 prev 为空：不会把空白状态覆盖写回，只做「载入」
            await switchNovelScope({ prev: '', next: name, state });
        }
        return text;
    } catch (e) { return ''; }
}

/**
 * 保存当前正文到记录。
 * @param {string} name 记录名
 * @param {object} [state] ui-context 的 state（切换分区用）
 */
export async function saveNovelRecord(name, state) {
    if (!name) throw new Error('请填写小说名称');
    await novelStore.save(name, novelText);
    const scope = await setCurrentRecord(name, state);
    // 开关开启时同步落盘服务器工作区（<记录名>/novel.txt），失败静默跳过
    persistMod.saveNovelText(name, novelText, name).catch(() => { });
    return { name, scope };
}

/**
 * 载入指定记录。
 * @param {string} name 记录名
 * @param {object} [state] ui-context 的 state（恢复该小说的角色/时间线/产物）
 */
export async function loadNovelRecord(name, state) {
    const text = await novelStore.load(name);
    setNovel(text);
    const scope = await setCurrentRecord(name, state);
    return { text, scope };
}

/** 删除记录（若删的是当前记录，清空当前记录名；连带删除该小说的中间产物分区） */
export async function deleteNovelRecord(name, state) {
    await novelStore.del(name);
    if (getCurrentRecord() === name) await setCurrentRecord('', state);
    await dropNovelScope(name);
    // 同步删除服务器工作区下的正文（开关关闭 / 插件不可用时内部静默跳过）
    serverMaybeDel(persistMod.wsPath(name, 'novel.txt')).catch(() => { });
}

/** 列出全部记录名 */
export async function listNovelRecords() {
    return novelStore.keys();
}

/** 字数统计 */
export function statOf(text) {
    const t = text || '';
    return { chars: t.length };
}

export default {
    getNovel, previewOf, setNovel, readNovelFile,
    getCurrentRecord, restoreLastNovel,
    saveNovelRecord, loadNovelRecord, deleteNovelRecord, listNovelRecords, statOf,
};
