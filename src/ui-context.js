/**
 * ui-context.js —— UI 层共享上下文
 *
 * 用于在 ui.js 主控与各 tab 模块之间传递「面板状态」与「工具函数」，
 * 避免模块循环依赖。
 */

import { flash } from './util.js';

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
    running: false,
    controller: null,
};

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
