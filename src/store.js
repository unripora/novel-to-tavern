/**
 * store.js —— 持久化层
 *
 * 策略：
 * - 配置类（模板、历史、扫描参数）：存酒馆 extensionSettings，随酒馆设置一并落盘
 * - 大文本（小说正文）：存酒馆共享库 localforage（IndexedDB），避免 localStorage 5MB 限制
 */

import { ctx, inTavern } from './st-bridge.js';

/** 扩展唯一标识（需全局唯一，避免与其他扩展冲突） */
export const MODULE_NAME = 'card_extractor';

/** 默认设置 */
export const DEFAULT_SETTINGS = Object.freeze({
    // 扫描参数（对齐原工具「高级参数」）
    chunkSize: 40000,
    scanCap: 40,
    ctxCap: 90000,
    fullCap: 120000,
    showThink: false,
    sysPrefix: '',
    // 生成参数（原网页「高级参数」中的 max_tokens 与若干开关）
    maxTokens: 8000,     // 插件内输出上限（覆盖酒馆设置；仅在 useGlobalResp=false 时生效）
    useGlobalResp: false,// 是否使用酒馆全局设置（true=用酒馆响应长度；false=用插件自定义）
    useStream: true,     // 流式输出
    autoCont: true,      // 截断自动续写
    nsfw: false,         // 是否包含 NSFW 内容（世界书等任务读取）
    wbMode: 'whole',     // 世界书生成方式：'whole' 整本生成 | 'chapter' 按篇章生成
    model: '',           // 展示用的模型名（实际调用走酒馆连接，仅记录）
    // 数值面板模式
    statPanelCard: false,    // 角色卡：是否开启数值面板模式
    statPanelFields: '',     // 数值面板字段（留空由 AI 依作品类型决定）
    statPanelRefs: '',       // 数值面板参考数值（可空）
    statPanelPersona: false, // user 人设：是否开启数值面板模式
    // 业务数据
    templates: [],       // 角色卡模板列表
    curTpl: '',          // 当前模板名
    history: [],         // 历史记录（最多 30）
    timeline: null,      // 时间线（章节轴）：{ nodes: [], locked: false }
    curNovel: '',        // 当前正文对应的记录名（刷新后自动恢复用）
    tlSynopsis: '',      // 时间线：梗概划分草稿（篇名+概述）
    tlRefDoc: '',        // 时间线：参考文档草稿
    characters: [],      // 扫描到的角色列表（含别名/次数），刷新不丢
    selectedNames: [],   // 已选角色名（用于生成），刷新不丢
});

/** 内存兜底（非酒馆环境或 localforage 不可用时使用） */
const mem = {};

/** 是否可用酒馆存储（懒加载，多级回落） */
let _lf = null;
function lf() {
    if (_lf) return _lf;
    // ① 全局 SillyTavern.libs.localforage（官方文档写法，最可靠）
    // ② getContext().libs.localforage（部分版本挂在 context 上）
    const candidates = [
        globalThis.SillyTavern?.libs?.localforage,
        ctx()?.libs?.localforage,
    ];
    for (const l of candidates) {
        if (l && typeof l.createInstance === 'function') {
            try {
                _lf = l.createInstance({ name: 'card-extractor' });
                return _lf;
            } catch (e) { /* 换下一个候选 */ }
        }
    }
    return null;
}

/**
 * 获取当前扩展设置（自动初始化并补齐默认键）
 */
export function settings() {
    const c = ctx();
    if (c?.extensionSettings) {
        const es = c.extensionSettings;
        if (!es[MODULE_NAME]) es[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
        for (const k of Object.keys(DEFAULT_SETTINGS)) {
            if (!Object.hasOwn(es[MODULE_NAME], k)) es[MODULE_NAME][k] = DEFAULT_SETTINGS[k];
        }
        return es[MODULE_NAME];
    }
    // 非酒馆环境：用内存兜底，保证可在浏览器单独调试
    if (!mem[MODULE_NAME]) mem[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    return mem[MODULE_NAME];
}

/** 持久化设置（酒馆环境写服务器） */
export function persist() {
    const c = ctx();
    if (c?.saveSettingsDebounced) c.saveSettingsDebounced();
}

/** 是否具备持久存储（localforage 可用） */
export function persistentAvailable() {
    return !!lf();
}

/** 小说正文存储（大文本走 localforage） */
export const novelStore = {
    async save(key, text) {
        const inst = lf();
        if (inst) return inst.setItem('novel:' + key, text);
        mem['novel:' + key] = text;
    },
    async load(key) {
        const inst = lf();
        if (inst) return (await inst.getItem('novel:' + key)) ?? '';
        return mem['novel:' + key] ?? '';
    },
    async del(key) {
        const inst = lf();
        if (inst) return inst.removeItem('novel:' + key);
        delete mem['novel:' + key];
    },
    async keys() {
        const inst = lf();
        if (inst) return (await inst.keys()).filter(k => k.startsWith('novel:')).map(k => k.slice(6));
        return Object.keys(mem).filter(k => k.startsWith('novel:')).map(k => k.slice(6));
    },
};

/** 面板产物存储（角色卡/人设/世界书等大文本，刷新不丢） */
export const panelStore = {
    async save(key, val) {
        const inst = lf();
        if (inst) return inst.setItem('panel:' + key, val);
        mem['panel:' + key] = val;
    },
    async load(key) {
        const inst = lf();
        if (inst) return (await inst.getItem('panel:' + key)) ?? null;
        return mem['panel:' + key] ?? null;
    },
    async del(key) {
        const inst = lf();
        if (inst) return inst.removeItem('panel:' + key);
        delete mem['panel:' + key];
    },
};

export default { MODULE_NAME, DEFAULT_SETTINGS, settings, persist, novelStore, panelStore, persistentAvailable };
