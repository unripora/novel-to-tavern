/**
 * ui-context.js —— UI 层共享上下文
 *
 * 用于在 ui.js 主控与各 tab 模块之间传递「面板状态」与「工具函数」，
 * 避免模块循环依赖。
 */

import { flash } from './util.js';
import { panelStore, serverMaybeSave } from './store.js';

/** 面板级状态 */
export const state = {
    selectedNames: [],
    templates: [],
    curTpl: 0,
    cardText: '',
    personaText: '',
    firstText: '',
    styleText: '',
    wbEntries: [],
    wbPreview: '',
    wbGroups: null,
    wbGroupNames: {},
    running: false,
    controller: null,
    // 日志缓存：切 Tab / 刷新后回显（key = 日志元素 id，value = 文本）
    logs: {},
};

/** 需要持久化的产物字段（切 Tab 保留内存、刷新存活于 localforage） */
const PRODUCT_KEYS = ['cardText', 'personaText', 'firstText', 'styleText', 'wbEntries', 'wbPreview', 'wbGroups', 'wbGroupNames'];
/** 日志缓存持久化：仅在生成期间防抖存一次，避免频繁写入 */
let _logSaveTimer = null;

/** 服务器落盘防抖：产物变动频繁，避免每次输入都请求 */
let _srvSaveTimer = null;

/** 保存产物到 localforage（大文本，刷新不丢），开关开启时同步落盘到服务器 */
export function saveProducts() {
    const data = {};
    for (const k of PRODUCT_KEYS) data[k] = state[k];
    panelStore.save('products', data).catch(() => { });
    // 服务器落盘（防抖 1.5s；未开开关 / 未装插件时内部静默跳过）
    if (_srvSaveTimer) clearTimeout(_srvSaveTimer);
    _srvSaveTimer = setTimeout(() => {
        _srvSaveTimer = null;
        serverMaybeSave('_state/products.json', JSON.stringify(data, null, 2)).catch(() => { });
    }, 1500);
}

/** 保存日志缓存（防抖，刷新后回显 AI 调用日志） */
function saveLogs() {
    if (_logSaveTimer) clearTimeout(_logSaveTimer);
    _logSaveTimer = setTimeout(() => {
        _logSaveTimer = null;
        panelStore.save('logs', state.logs).catch(() => { });
    }, 800);
}

/** 从 localforage 恢复产物（面板首次挂载时调用一次） */
export async function restoreProducts() {
    try {
        const data = await panelStore.load('products');
        if (data && typeof data === 'object') {
            for (const k of PRODUCT_KEYS) {
                if (data[k] != null) state[k] = data[k];
            }
        }
    } catch (e) { /* 忽略 */ }
    try {
        const logs = await panelStore.load('logs');
        if (logs && typeof logs === 'object') state.logs = logs;
    } catch (e) { /* 忽略 */ }
}

/** 记录一条日志到缓存（供切 Tab / 刷新后回显） */
export function cacheLog(elId, line) {
    if (!state.logs[elId]) state.logs[elId] = '';
    state.logs[elId] += line + '\n';
    saveLogs();
}

/** 取缓存的日志文本 */
export function getCachedLog(elId) {
    return state.logs[elId] || '';
}

/** 清空某日志缓存 */
export function clearCachedLog(elId) {
    state.logs[elId] = '';
    saveLogs();
}

/**
 * 把缓存的日志回填到容器内所有 .ce-log 元素（切 Tab / 刷新后回显）
 * @param {HTMLElement} root 渲染后的 Tab 容器
 */
export function mountLogs(root) {
    if (!root) return;
    root.querySelectorAll('.ce-log').forEach((el) => {
        const id = el.id;
        const cached = state.logs[id];
        if (cached) {
            el.innerHTML = '';
            cached.split('\n').forEach((line, i, arr) => {
                if (i === arr.length - 1 && line === '') return;
                const span = document.createElement('span');
                span.textContent = line + '\n';
                el.appendChild(span);
            });
            el.classList.add('show');
            el.scrollTop = el.scrollHeight;
        }
    });
}

/** 由 ui.js 注入的「重新渲染某 Tab」函数 */
export let rerender = () => { };
export function setRerender(fn) { rerender = fn; }

/** 由 ui.js 注入的「停止当前任务」函数 */
export let stopRun = () => { };
export function setStopRun(fn) { stopRun = fn; }

/* ---------- 通用 DOM 工具 ---------- */

export const $ = (id) => document.getElementById(id);

export function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
}

export function copyText(text, msgId) {
    if (!text) { flash(msgId, '没有可复制的内容', true); return; }
    navigator.clipboard.writeText(text).then(
        () => flash(msgId, '已复制'),
        () => flash(msgId, '复制失败', true),
    );
}

export function downloadText(text, filename, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
