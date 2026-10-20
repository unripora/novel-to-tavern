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

/** 面板产物中需要按小说隔离的字段（与 ui-context 的 PRODUCT_KEYS 对齐） */
export const SCOPED_PRODUCT_KEYS = ['cardText', 'cardGroups', 'wbEntries', 'wbPreview', 'wbGroups', 'wbGroupNames'];

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

/** 把面板产物从 state 摘出来 */
function snapshotProducts(state) {
    const out = {};
    for (const k of SCOPED_PRODUCT_KEYS) out[k] = state[k];
    return out;
}

/** 把面板产物写回 state */
function applyProducts(state, snap) {
    for (const k of SCOPED_PRODUCT_KEYS) {
        if (snap && snap[k] !== undefined) state[k] = snap[k];
    }
}

/** 清空面板产物（新小说用） */
function clearProducts(state) {
    state.cardText = '';
    state.cardGroups = [];
    state.cardViewIdx = null;
    state.wbEntries = [];
    state.wbPreview = '';
    state.wbGroups = null;
    state.wbGroupNames = {};
}

/** 读取某小说的分区快照（不存在则 null） */
async function loadScope(rec) {
    try { return await panelStore.load(recKey(rec)); } catch (e) { return null; }
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
        if (snap) {
            applySettings(snap.settings || null);
            applyProducts(state, snap.products || {});
            return {
                restored: true, keptExisting: false,
                characters: countOf(snap, 'characters'), nodes: countOf(snap, 'nodes'),
            };
        }
        // 无快照：保留 settings 里现有的一切，只补建快照供下次使用。
        // 这里绝不调用 applySettings(null) —— 那会把用户的时间线清掉。
        if (next) {
            await saveScope(next, {
                settings: snapshotSettings(),
                products: snapshotProducts(state),
                savedAt: Date.now(),
            });
        }
        logKeepExisting(next);
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

    // 3) 有快照就恢复；确实没有（第一次进入这本）才清空运行态
    if (snap) {
        applySettings(snap.settings || null);
        applyProducts(state, snap.products || {});
    } else {
        applySettings(null);
        clearProducts(state);
    }

    return {
        restored: !!snap, keptExisting: false,
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

/** 删除某小说的分区（删除正文记录时调用） */
export async function dropNovelScope(rec) {
    if (!rec) return;
    try { await panelStore.del(recKey(rec)); } catch (e) { /* 忽略 */ }
}

/** 某小说是否已有分区 */
export async function hasNovelScope(rec) {
    return !!(await loadScope(rec));
}

export default { switchNovelScope, dropNovelScope, hasNovelScope, SCOPED_PRODUCT_KEYS };
