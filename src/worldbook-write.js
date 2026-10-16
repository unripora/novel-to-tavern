/**
 * worldbook-write.js —— 世界书写入酒馆 / 读取列表
 *
 * 从 worldbook.js 拆出（避免单文件超 500 行）。
 * 职责：把条目写入酒馆世界书（新建/追加）、冲突检测、列出已有世界书。
 */

import { ctx } from './st-bridge.js';
import { toTavernEntry } from './worldbook.js';


/** 规范化一个酒馆世界书数据对象，保证 entries 存在 */
function normalizeWorldInfo(data) {
    const out = (data && typeof data === 'object') ? data : {};
    if (!out.entries || typeof out.entries !== 'object') out.entries = {};
    return out;
}

/** 遍历世界书 entries（键值对形式，值即条目对象） */
function eachTavernEntry(data, fn) {
    Object.values(normalizeWorldInfo(data).entries).forEach((entry) => { if (entry && typeof entry === 'object') fn(entry); });
}

/** 取当前角色绑定的世界书名 */
export function boundWorldbookName() {
    const c = ctx();
    if (!c) return '';
    try {
        const ch = (c.characters || [])[c.characterId];
        if (!ch) return '';
        return ch.world || ch.data?.extensions?.world || '';
    } catch (e) { return ''; }
}

/** 判断两内部条目是否冲突（标题相同，或关键词有交集） */
function isConflict(a, b) {
    const ta = String(a.title || '').trim();
    const tb = String(b.title || '').trim();
    if (ta && tb && ta === tb) return true;
    const ka = (a.keys || []).filter(Boolean);
    const kb = (b.keys || []).filter(Boolean);
    return ka.some((k) => kb.includes(k));
}

/**
 * 把世界书条目写入酒馆。mode='new' 新建独立文件（同名则合并）；mode='append' 读取当前角色绑定世界书并合并。
 * @returns {Promise<{ok:boolean, bookName:string, count:number, conflicts:Array, message:string}>}
 */
export async function writeWorldbookToTavern(bookName, entries, mode = 'new', opts = {}) {
    const c = ctx();
    if (!c || typeof c.loadWorldInfo !== 'function' || typeof c.saveWorldInfo !== 'function') {
        return { ok: false, bookName: bookName || '', count: 0, conflicts: [], message: '当前环境不支持世界书写入（缺少 loadWorldInfo/saveWorldInfo）' };
    }
    const userReplace = opts.userReplace || {};
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return { ok: false, bookName: bookName || '', count: 0, conflicts: [], message: '没有条目可写入' };

    // 决定目标世界书名
    let name = String(bookName || '').trim();
    if (mode === 'append' && !name) name = boundWorldbookName();
    if (mode === 'append' && !name) return { ok: false, bookName: '', count: 0, conflicts: [], message: '未取到当前角色绑定的世界书，请显式指定世界书名' };
    if (!name) name = '世界书';

    // 读取已有世界书（不存在则视为空）
    let data = {};
    try { data = normalizeWorldInfo(await c.loadWorldInfo(name)); } catch (e) { data = normalizeWorldInfo({}); }

    // 冲突检测：与已存在条目按标题/关键词比对（不静默覆盖）
    const conflicts = [];
    eachTavernEntry(data, (te) => {
        const ex = { title: te.comment || '', keys: Array.isArray(te.key) ? te.key : (te.key ? [te.key] : []) };
        for (const e of list) { if (isConflict(e, ex)) { conflicts.push({ title: e.title, existing: ex.title || e.title }); break; } }
    });

    // 追加到 entries（保留酒馆原有条目），uid 顺序续排
    const entriesObj = data.entries;
    let maxUid = 0;
    Object.values(entriesObj).forEach((te) => { if (te && typeof te.uid === 'number') maxUid = Math.max(maxUid, te.uid); });
    let added = 0;
    list.forEach((e, i) => {
        const te = toTavernEntry(e, userReplace, i);
        te.uid = maxUid + 1 + i;
        entriesObj[String(te.uid)] = te;
        added++;
    });

    // 保存（第三个参数 true：立即刷新/触发世界书更新）
    try { await c.saveWorldInfo(name, data, true); } catch (e) {
        return { ok: false, bookName: name, count: 0, conflicts, message: '保存世界书失败：' + e.message };
    }

    const msg = '已写入世界书「' + name + '」：新增 ' + added + ' 条' + (conflicts.length ? ('，其中 ' + conflicts.length + ' 条与已有条目关键词/标题重复，请检查是否覆盖') : '');
    return { ok: true, bookName: name, count: added, conflicts, message: msg };
}

/** 列出酒馆中已有世界书名（若 API 支持） */
export async function listWorldbooks() {
    const c = ctx();
    if (!c || typeof c.getWorldInfoNames !== 'function') return [];
    try { const names = await c.getWorldInfoNames(); return Array.isArray(names) ? names : []; } catch (e) { return []; }
}

/**
 * 读取某本酒馆世界书，转成**内部条目格式**（title/keys/content/constant）。
 * 用于打包导出（把世界书内嵌进卡）。
 * @param {string} bookName
 * @returns {Promise<Array>}
 */
export async function loadWorldbookEntries(bookName) {
    const c = ctx();
    const name = String(bookName || '').trim();
    if (!c || typeof c.loadWorldInfo !== 'function' || !name) return [];
    let data = {};
    try { data = normalizeWorldInfo(await c.loadWorldInfo(name)); } catch (e) { return []; }
    const out = [];
    eachTavernEntry(data, (te) => {
        const title = String(te.comment || te.name || '').trim();
        if (!title) return;
        const keys = Array.isArray(te.key) ? te.key.slice() : (te.key ? [te.key] : []);
        out.push({
            category: '',
            title,
            keys,
            content: String(te.content || '').trim(),
            constant: !!te.constant,
        });
    });
    return out;
}
