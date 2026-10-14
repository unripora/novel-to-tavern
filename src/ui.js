/**
 * ui.js —— 插件主操作面板主控
 *
 * 挂载到 settings.html 的 #ce_content 容器，按 Tab 分发渲染。
 * 各 Tab 的具体实现拆分在 ui-novel / ui-chars / ui-card / ui-misc。
 */

import { settings, persist } from './store.js';
import { BUILTINS } from './prompts.js';
import { setLogCacheHooks } from './util.js';
import { state, $, setRerender, setStopRun, restoreProducts, mountLogs, cacheLog, clearCachedLog } from './ui-context.js';
import { renderNovelTab } from './ui-novel.js';
import { renderCharsTab } from './ui-chars.js';
import { renderCardTab } from './ui-card.js';
import { renderTimelineTab } from './ui-timeline.js';
import { renderWorldTab } from './ui-world.js';
import {
    renderPersonaTab, renderStyleTab,
    renderFirstTab, renderCheckTab, renderHistoryTab,
} from './ui-misc.js';

/** Tab 渲染表 */
const TABS = {
    novel: renderNovelTab,
    timeline: renderTimelineTab,
    chars: renderCharsTab,
    card: renderCardTab,
    persona: renderPersonaTab,
    world: renderWorldTab,
    style: renderStyleTab,
    first: renderFirstTab,
    check: renderCheckTab,
    history: (box) => renderHistoryTab(box, renderTab),
};

/** 渲染指定 Tab */
function renderTab(name) {
    const box = $('ce_content');
    if (!box) return;
    box.innerHTML = '';
    const fn = TABS[name];
    if (fn) fn(box);
    // 回填缓存的日志（切 Tab / 刷新后不丢）
    mountLogs(box);
}

/** 初始化模板数据 */
function initTemplates() {
    const s = settings();
    state.templates = Array.isArray(s.templates) && s.templates.length
        ? s.templates
        : BUILTINS.map((t) => ({ ...t }));
    if (!Array.isArray(s.templates) || !s.templates.length) {
        s.templates = state.templates;
        persist();
    }
    const idx = state.templates.findIndex((t) => t.name === s.curTpl);
    state.curTpl = idx >= 0 ? idx : 0;
}

/** 恢复上次的选中角色（刷新不丢） */
function initState() {
    const s = settings();
    state.selectedNames = Array.isArray(s.selectedNames) ? s.selectedNames : [];
}

/** 保存选中角色到设置 */
export function saveSelectedNames() {
    settings().selectedNames = state.selectedNames;
    persist();
}

/** 停止当前运行中的任务 */
function stopCurrentRun() {
    if (state.controller) {
        try { state.controller.abort(); } catch (e) { /* 忽略 */ }
    }
    state.running = false;
}

/** 供子模块触发重渲染 / 停止 */
function exposeRerender() {
    setRerender(renderTab);
    setStopRun(stopCurrentRun);
    window.__ce_rerender = renderTab;
}

/** 挂载面板 */
export function mountUI() {
    const tabs = $('ce_tabs');
    if (!tabs) return;
    exposeRerender();

    if (!tabs.dataset.bound) {
        tabs.dataset.bound = '1';
        initTemplates();
        initState();
        // 注入日志缓存钩子：logTo/clearLog 自动同步到 state.logs
        setLogCacheHooks(cacheLog, clearCachedLog);
        // 恢复上次生成的产物（角色卡/人设/世界书等，刷新不丢）
        restoreProducts().then(() => {
            // 恢复完成后若当前在相应 Tab，重渲染以显示产物
            const active = tabs.querySelector('.ce-tab.active');
            if (active) renderTab(active.dataset.tab);
        });
        tabs.querySelectorAll('.ce-tab').forEach((btn) => {
            btn.addEventListener('click', () => {
                tabs.querySelectorAll('.ce-tab').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                renderTab(btn.dataset.tab);
            });
        });
    }
    renderTab('novel');
}

export default { mountUI };
