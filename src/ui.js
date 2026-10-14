/**
 * ui.js —— 插件主操作面板主控
 *
 * 挂载到 settings.html 的 #ce_content 容器，按 Tab 分发渲染。
 * 各 Tab 的具体实现拆分在 ui-novel / ui-chars / ui-card / ui-misc。
 */

import { settings, persist } from './store.js';
import { BUILTINS } from './prompts.js';
import { state, $, setRerender, setStopRun } from './ui-context.js';
import { renderNovelTab } from './ui-novel.js';
import { renderCharsTab } from './ui-chars.js';
import { renderCardTab } from './ui-card.js';
import { renderTimelineTab } from './ui-timeline.js';
import {
    renderPersonaTab, renderWorldTab, renderStyleTab,
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
