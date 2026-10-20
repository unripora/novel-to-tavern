/**
 * novel-scope.js —— 中间产物按小说分区隔离
 *
 * 问题：角色列表 / 选中角色 / 时间线 / 角色卡等产物原本是「全局一份」，
 * 换一本小说后旧数据仍在，角色卡、篇章划分会串到新书上。
 *
 * 方案：以小说记录名为 key，把上述中间产物各存一份到 localforage。
 *  - 切换小说：先把当前小说的状态存回它的分区，再载入目标小说的分区（没有则清空）。
 *  - 重新载入旧小说：从它的分区恢复，产物就回来了。
 */

import { settings, persist, panelStore } from './store.js';

/**
 * 面板产物中需要按小说隔离的字段。
 * 必须与 ui-context.js 的 PRODUCT_KEYS 保持同源（那边现由此处派生）。
 * styleText / firstText 也按书隔离：它们是「这本书的文风与开场」，跨书混用会串味。
 * personaText 属于用户人设，跨书复用，故不在此列。
 */
export const SCOPED_PRODUCT_KEYS = [
    'cardText', 'cardGroups', 'cardViewIdx',
    'wbEntries', 'wbPreview', 'wbGroups', 'wbGroupNames',
    'styleText', 'firstText',
];

/** 分区前缀（避免与已有 key 冲突） */
const SCOPE = 'scope:';

/** 记录名兜底：没有记录名时用固定名，避免写到 undefined 分区 */
const recKey = (rec) => SCOPE + (String(rec || '').trim() || '_unsaved');

/** 从 settings 里摘出「属于当前小说」的配置字段（单值，换书必须搬走） */
function snapshotSettings() {
    const s = settings();
    return {
        characters: Array.isArray(s.characters) ? s.characters : [],
        selectedNames: Array.isArray(s.selectedNames) ? s.selectedNames : [],
        timeline: s.timeline || { nodes: [] },
        tlSynopsis: s.tlSynopsis || '',
        tlRefDoc: s.tlRefDoc || '',
        wbIndex: s.wbIndex || null,
    };
}

/** 把一份快照写回 settings（整体替换，不做合并） */
function applySettings(snap) {
    const s = settings();
    s.characters = Array.isArray(snap && snap.characters) ? snap.characters : [];
    s.selectedNames = Array.isArray(snap && snap.selectedNames) ? snap.selectedNames : [];
    s.timeline = (snap && snap.timeline) || { nodes: [] };
    s.tlSynopsis = (snap && snap.tlSynopsis) || '';
    s.tlRefDoc = (snap && snap.tlRefDoc) || '';
    s.wbIndex = (snap && snap.wbIndex) || null;
    persist();
}

/** 各产物字段的默认值：快照里缺这个键时用它重置，而不是留着上一本书的值 */
const PRODUCT_DEFAULTS = {
    cardText: '',
    cardGroups: () => [],
    cardViewIdx: null,
    wbEntries: () => [],
    wbPreview: '',
    wbGroups: null,
    wbGroupNames: () => ({}),
    styleText: '',
    firstText: '',
};

/** 把面板产物从 state 摘出来 */
function snapshotProducts(state) {
    const out = {};
    for (const k of SCOPED_PRODUCT_KEYS) out[k] = state[k];
    return out;
}

/**
 * 把面板产物写回 state。
 * 快照里没有的键要显式重置为默认值：否则会保留上一本书的内容
 * （例如 A 书改过世界书分组名，切到 B 书后 wbGroupNames 仍是 A 的）。
 */
function applyProducts(state, snap) {
    for (const k of SCOPED_PRODUCT_KEYS) {
        if (snap && snap[k] !== undefined) {
            state[k] = snap[k];
        } else {
            const def = PRODUCT_DEFAULTS[k];
            state[k] = (typeof def === 'function') ? def() : def;
        }
    }
}

/** 清空面板产物（新小说用） */
function clearProducts(state) {
    applyProducts(state, null);
}

/** 读失败哨兵：区分「没有快照」与「存储读不出来」，后者绝不能当成新书去清空 */
const LOAD_FAILED = Symbol('scope-load-failed');

/** 读取某小说的分区快照（不存在则 null；读失败返回 LOAD_FAILED） */
async function loadScope(rec) {
    try { return await panelStore.load(recKey(rec)); } catch (e) { return LOAD_FAILED; }
}

/** 写入某小说的分区快照 */
async function saveScope(rec, snap) {
    try { await panelStore.save(recKey(rec), snap); } catch (e) { /* 存储不可用时不阻断 */ }
}

/**
 * 切换小说上下文。
 *
 * 【安全规则 · 不可破坏】
 * 冷启动（prev 为空）一律**只恢复、绝不清空**：不删除、不覆盖任何已有中间产物
 * （角色列表 / 时间线 / 角色卡）。找不到快照就沿用 settings 里现有的数据。
 * 原因：时间线是用户手工划出来的，误清一次就得重做，代价远高于「隔离得不够干净」。
 *
 * 只有**用户主动换书**（prev 非空）才允许清空：先把旧书状态存回它的分区，
 * 再载入新书分区；新书确实没有快照，才清空运行态。
 *
 * @param {{prev?:string, next?:string, state:object}} o
 * @returns {Promise<{restored:boolean, keptExisting:boolean, characters:number, nodes:number}>}
 */
export async function switchNovelScope({ prev = '', next = '', state }) {
    // —— 冷启动：只恢复，绝不写空 ——
    if (!prev) {
        const snap = next ? await loadScope(next) : null;
        if (snap && snap !== LOAD_FAILED) {
            applySettings(snap.settings || null);
            applyProducts(state, snap.products || {});
            return {
                restored: true, keptExisting: false,
                characters: countOf(snap, 'characters'), nodes: countOf(snap, 'nodes'),
            };
        }
        // 无快照 / 读失败：保留 settings 里现有的一切，只补建快照。
        // 这里绝不调用 applySettings(null) —— 那会把用户的时间线清掉。
        // 读失败时更不能补建，否则会用当前（可能不完整的）状态覆盖真正存在的快照。
        if (next && snap !== LOAD_FAILED) {
            await saveScope(next, {
                settings: snapshotSettings(),
                products: snapshotProducts(state),
                savedAt: Date.now(),
            });
        }
        if (snap === LOAD_FAILED) logLoadFailed(next);
        else logKeepExisting(next);
        return { restored: false, keptExisting: true, characters: 0, nodes: 0 };
    }

    // —— 用户主动换书 ——
    // 1) 旧书状态存回它的分区，保证切回去时不丢
    await saveScope(prev, {
        settings: snapshotSettings(),
        products: snapshotProducts(state),
        savedAt: Date.now(),
    });

    // 2) 载入新书分区
    const snap = next ? await loadScope(next) : null;

    // 3) 有快照就恢复；读失败则保留现状（不动用户数据）；确实没有才清空
    if (snap && snap !== LOAD_FAILED) {
        applySettings(snap.settings || null);
        applyProducts(state, snap.products || {});
    } else if (snap === LOAD_FAILED) {
        logLoadFailed(next);
        return { restored: false, keptExisting: true, characters: 0, nodes: 0 };
    } else {
        applySettings(null);
        clearProducts(state);
    }

    return {
        restored: !!(snap && snap !== LOAD_FAILED), keptExisting: false,
        characters: countOf(snap, 'characters'), nodes: countOf(snap, 'nodes'),
    };
}

/** 从快照里取角色数 / 篇章数（用于提示信息） */
function countOf(snap, kind) {
    const st = snap && snap.settings;
    if (!st) return 0;
    if (kind === 'characters') return Array.isArray(st.characters) ? st.characters.length : 0;
    return st.timeline && Array.isArray(st.timeline.nodes) ? st.timeline.nodes.length : 0;
}

/** 冷启动无快照时的提示（走日志，不打断流程） */
function logKeepExisting(rec) {
    try { console.log('[card-extractor] 未找到「' + rec + '」的分区快照，保留现有中间产物并建立快照'); } catch (e) { /* 忽略 */ }
}

/** 读分区失败时的提示：数据保留原样，不做任何清空 */
function logLoadFailed(rec) {
    try { console.warn('[card-extractor] 读取「' + rec + '」的分区快照失败，已保留当前中间产物未做清空'); } catch (e) { /* 忽略 */ }
}

/** 删除某小说的分区（删除正文记录时调用） */
export async function dropNovelScope(rec) {
    if (!rec) return false;
    try { await panelStore.del(recKey(rec)); return true; } catch (e) {
        try { console.warn('[card-extractor] 删除分区失败：' + rec); } catch (e2) { /* 忽略 */ }
        return false;
    }
}

/** 某小说是否已有分区 */
export async function hasNovelScope(rec) {
    const s = await loadScope(rec);
    return !!s && s !== LOAD_FAILED;
}

export default { switchNovelScope, dropNovelScope, hasNovelScope, SCOPED_PRODUCT_KEYS };
