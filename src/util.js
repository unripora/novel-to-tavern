/**
 * util.js —— 通用工具函数
 *
 * 迁移自原 index.html：日志、文本清洗、JSON 提取、UI 让步等。
 */

import { ctx } from './st-bridge.js';

/** 酒馆环境下的 toast 提示（无则用 console） */
export function toast(msg, isErr) {
    const c = ctx();
    try {
        if (c?.toastr) {
            isErr ? c.toastr.error(msg) : c.toastr.info(msg);
            return;
        }
    } catch (e) { /* 忽略 */ }
    if (isErr) console.error('[card-extractor]', msg);
    else console.log('[card-extractor]', msg);
}

/** 让出主线程，刷新 UI */
export function yieldToUI() {
    return new Promise((r) => setTimeout(r, 0));
}

/** 去掉 ``` 代码围栏 */
export function stripFence(s) {
    return String(s || '')
        .replace(/^\s*```(?:json|yaml|yml)?/i, '')
        .replace(/```\s*$/, '')
        .trim();
}

/** 去掉 <think>…</think> 思考过程 */
export function stripThink(s) {
    return String(s || '')
        .replace(/<think[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking[\s\S]*?<\/thinking>/gi, '')
        .trim();
}

/** 按开关决定是否保留思考内容 */
export function dispThink(s, showThink) {
    return showThink ? String(s || '') : stripThink(s);
}

/**
 * 从文本中提取 JSON 数组（容错处理模型输出的杂散文本）
 */
export function extractJsonArray(s) {
    const t = stripFence(String(s || ''));
    const start = t.indexOf('[');
    const end = t.lastIndexOf(']');
    if (start < 0 || end < 0 || end < start) return [];
    let body = t.slice(start, end + 1);
    try {
        const arr = JSON.parse(body);
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        // 容错：去掉尾随逗号后再试
        body = body.replace(/,(\s*[\]}])/g, '$1');
        try {
            const arr = JSON.parse(body);
            return Array.isArray(arr) ? arr : [];
        } catch (e2) {
            return [];
        }
    }
}

/** 数组去重 */
export function uniq(arr) {
    return [...new Set((arr || []).filter(Boolean))];
}

/** 日志缓存钩子（由 ui-context 注入，避免循环依赖） */
let _logCacheHook = null;   // (elId, line) => void
let _logClearHook = null;   // (elId) => void
export function setLogCacheHooks(onLog, onClear) {
    _logCacheHook = onLog;
    _logClearHook = onClear;
}

/** 简易日志面板输出 */
export function logTo(elId, msg, cls) {
    if (_logCacheHook) { try { _logCacheHook(elId, msg); } catch (e) { /* ignore */ } }
    const el = document.getElementById(elId);
    if (!el) return;
    el.classList.add('show');
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = msg + '\n';
    el.appendChild(span);
    el.scrollTop = el.scrollHeight;
}

export function clearLog(elId) {
    if (_logClearHook) { try { _logClearHook(elId); } catch (e) { /* ignore */ } }
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = '';
    el.classList.remove('show');
}

/** flash 的定时器句柄（按元素 id 记录，避免旧定时器误清新的持久提示） */
const _flashTimers = {};

/**
 * 短暂提示（面板内小字）
 * @param {string} elId 目标元素 id
 * @param {string} msg 文本
 * @param {boolean} [isErr] 是否错误色
 * @param {{persist?:boolean}} [opts] persist=true 时不自动清除（用于「生成中…」这类持续提示）
 */
export function flash(elId, msg, isErr, opts = {}) {
    const el = document.getElementById(elId);
    if (!el) return;
    // 清掉该元素上未触发的旧定时器
    if (_flashTimers[elId]) { clearTimeout(_flashTimers[elId]); _flashTimers[elId] = null; }
    el.textContent = msg;
    el.style.color = isErr ? '#e0736a' : '#8fbf8a';
    if (!opts.persist) {
        _flashTimers[elId] = setTimeout(() => {
            const cur = document.getElementById(elId);
            if (cur) cur.textContent = '';
            _flashTimers[elId] = null;
        }, 2600);
    }
}

/** 立即清除某元素的提示（结束持续提示时用） */
export function clearFlash(elId) {
    if (_flashTimers[elId]) { clearTimeout(_flashTimers[elId]); _flashTimers[elId] = null; }
    const el = document.getElementById(elId);
    if (el) el.textContent = '';
}

export default {
    toast, yieldToUI, stripFence, stripThink, dispThink,
    extractJsonArray, uniq, logTo, clearLog, flash, clearFlash, setLogCacheHooks,
};
