/**
 * novel.js —— 小说导入与持久化
 *
 * 迁移自原 index.html 的 readNovelFile / pickDecoder / setNovel 逻辑。
 * 正文存 localforage（见 store.js）。
 */

import { novelStore } from './store.js';

const READ_CHUNK = 4 * 1024 * 1024;   // 每次读取 4MB
const PREVIEW_LIMIT = 200000;          // 预览截断长度

/** 当前内存中的正文 */
let novelText = '';

export function getNovel() {
    return novelText;
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
 * @returns {Promise<{text:string, enc:string}>}
 */
export async function readNovelFile(f, onProgress) {
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
    return { text, enc: dec };
}

/** 保存当前正文到记录 */
export async function saveNovelRecord(name) {
    if (!name) throw new Error('请填写小说名称');
    await novelStore.save(name, novelText);
    return name;
}

/** 载入指定记录 */
export async function loadNovelRecord(name) {
    const text = await novelStore.load(name);
    setNovel(text);
    return text;
}

/** 删除记录 */
export async function deleteNovelRecord(name) {
    await novelStore.del(name);
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
    saveNovelRecord, loadNovelRecord, deleteNovelRecord, listNovelRecords, statOf,
};
