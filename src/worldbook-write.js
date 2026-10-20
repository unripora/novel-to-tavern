/**
 * worldbook-write.js —— 世界书写入酒馆 / 读取列表
 *
 * 从 worldbook.js 拆出（避免单文件超 500 行）。
 * 职责：把条目写入酒馆世界书（新建/追加）、冲突检测、列出已有世界书。
 */

import { ctx } from './st-bridge.js';
import { toTavernEntry, decorateEntries, orderForBook, bookPrefix } from './worldbook.js';


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

/**
 * 把世界书条目写入酒馆。mode='new' 新建独立文件（同名则合并）；mode='append' 读取当前角色绑定世界书并合并。
 *
 * opts：
 *  - prefix：给条目标题加书卷前缀（如「SAO篇·亚丝娜」），默认取书名；传 '' 可关闭
 *  - order：插入顺序，默认按书名推断（总本/通用本 100，篇章本 200）
 *  - strategy：'append' 追加（默认）| 'skip' 跳过重复 | 'overwrite' 覆盖
 *      overwrite＝先把目标书里**标题完全相同**的旧条目删掉，再写入新条目。
 *      比对标题时同时看「加前缀后的标题」和「加前缀前的原标题」，
 *      这样上次写入的无前缀条目（「亚丝娜」）也能被这次带前缀的（「SAO篇·亚丝娜」）覆盖，不会留下两份。
 *   全部策略都只按标题判重（不看关键词），避免泛用关键词误删其它条目。
 *  - dryRun：true 时只统计「将删除/跳过多少条」，不落盘（供 UI 二次确认）
 *
 * @returns {Promise<{ok:boolean, bookName:string, count:number, conflicts:Array, message:string,
 *                    removedTitles?:string[], skipped?:number}>}
 */
export async function writeWorldbookToTavern(bookName, entries, mode = 'new', opts = {}) {
    const c = ctx();
    if (!c || typeof c.loadWorldInfo !== 'function' || typeof c.saveWorldInfo !== 'function') {
        return { ok: false, bookName: bookName || '', count: 0, conflicts: [], message: '当前环境不支持世界书写入（缺少 loadWorldInfo/saveWorldInfo）' };
    }
    const userReplace = opts.userReplace || {};
    const rawList = Array.isArray(entries) ? entries : [];
    if (!rawList.length) return { ok: false, bookName: bookName || '', count: 0, conflicts: [], message: '没有条目可写入' };

    // 决定目标世界书名
    let name = String(bookName || '').trim();
    if (mode === 'append' && !name) name = boundWorldbookName();
    if (mode === 'append' && !name) return { ok: false, bookName: '', count: 0, conflicts: [], message: '未取到当前角色绑定的世界书，请显式指定世界书名' };
    if (!name) name = '世界书';

    // 按书名给条目加前缀 + 补插入顺序（总本浅、篇章本深），避免多本同名条目混淆、优先级倒挂
    const prefix = opts.prefix != null ? String(opts.prefix) : bookPrefix(name);
    const order = Number.isFinite(Number(opts.order)) && opts.order !== '' ? Number(opts.order) : orderForBook(name);
    const list = decorateEntries(rawList, { prefix, order });

    // 读取已有世界书（不存在则视为空）
    let data = {};
    try { data = normalizeWorldInfo(await c.loadWorldInfo(name)); } catch (e) { data = normalizeWorldInfo({}); }

    // 冲突检测：只按标题比对（加前缀后的标题 + 原标题，两种都算命中）
    const strategy = (opts.strategy === 'skip' || opts.strategy === 'overwrite') ? opts.strategy : 'append';
    const wanted = new Map();   // 标题 → 内部条目（含无前缀别名）
    list.forEach((e) => {
        const t = String(e.title || '').trim();
        if (t) wanted.set(t, e);
        const bare = String(e._bareTitle || '').trim();
        if (bare) wanted.set(bare, e);
    });
    const conflicts = [];
    const hitUids = [];
    eachTavernEntry(data, (te) => {
        const title = String(te.comment || '').trim();
        if (!title || !wanted.has(title)) return;
        conflicts.push({ title: wanted.get(title).title, existing: title });
        if (typeof te.uid === 'number') hitUids.push(te.uid);
    });

    // dryRun：只回报将要做什么，不落盘（UI 用来做二次确认）
    if (opts.dryRun) {
        const removedTitles = conflicts.map((x) => x.existing);
        const msg = strategy === 'overwrite'
            ? ('将删除同名旧条目 ' + removedTitles.length + ' 条，写入 ' + list.length + ' 条')
            : strategy === 'skip'
                ? ('将跳过重复条目 ' + removedTitles.length + ' 条')
                : ('未发现同名条目（追加写入 ' + list.length + ' 条）');
        return { ok: true, bookName: name, count: 0, conflicts, dryRun: true, removedTitles, message: msg };
    }

    const entriesObj = data.entries;
    let maxUid = 0;
    Object.values(entriesObj).forEach((te) => { if (te && typeof te.uid === 'number') maxUid = Math.max(maxUid, te.uid); });

    // overwrite：先删同名旧条目；skip：把冲突标题记下来，新条目直接跳过
    let removed = 0;
    if (strategy === 'overwrite') {
        hitUids.forEach((uid) => { if (entriesObj[String(uid)]) { delete entriesObj[String(uid)]; removed++; } });
    }
    const skipTitles = new Set(strategy === 'skip' ? conflicts.map((x) => x.existing) : []);
    let added = 0;
    let skipped = 0;
    list.forEach((e, i) => {
        if (strategy === 'skip') {
            const t = String(e.title || '').trim();
            const bare = String(e._bareTitle || '').trim();
            if (skipTitles.has(t) || (bare && skipTitles.has(bare))) { skipped++; return; }
        }
        const te = toTavernEntry(e, userReplace, i);
        te.uid = maxUid + 1 + added;
        entriesObj[String(te.uid)] = te;
        added++;
    });

    // 保存（第三个参数 true：立即刷新/触发世界书更新）
    try { await c.saveWorldInfo(name, data, true); } catch (e) {
        return { ok: false, bookName: name, count: 0, conflicts, message: '保存世界书失败：' + e.message };
    }

    const msg = '已写入世界书「' + name + '」：新增 ' + added + ' 条'
        + (removed ? ('，覆盖删除旧条目 ' + removed + ' 条') : '')
        + (skipped ? ('，跳过重复 ' + skipped + ' 条') : '');
    return { ok: true, bookName: name, count: added, skipped, removed, conflicts, message: msg };
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
