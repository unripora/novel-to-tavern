/**
 * ui-timeline.js —— 「时间线」Tab（AI 划分 + 人工校对）
 */

import { flash, logTo, clearLog } from './util.js';
import * as novel from './novel.js';
import * as timeline from './timeline.js';
import { settings, persist } from './store.js';
import { $, rerender } from './ui-context.js';

export function renderTimelineTab(box) {
    const tl = timeline.getTimeline();
    const textLen = novel.getNovel().length;
    const locked = timeline.isLocked();

    const rows = tl.nodes.length
        ? tl.nodes.map((n, i) => nodeRowHtml(n, i, textLen)).join('')
        : '<div class="ce-tip">还没有时间线。点「AI 自动划分」由 AI 识别篇章，或「手动添加」自己建。</div>';

    box.innerHTML = `
        <div class="ce-pane">
            <p class="ce-tip">时间线把作品按篇章/阶段切开。生成角色卡时可限定在某个篇章内检索，避免年龄、事件、世界观串线。</p>
            <div class="ce-section">
                <label class="ce-label">划分与锁定</label>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_tl_divide">AI 自动划分</button>
                    <button type="button" class="menu_button" id="ce_tl_add">手动添加</button>
                    <button type="button" class="menu_button" id="ce_tl_lock">${locked ? '解除锁定' : '锁定时间线'}</button>
                    <span id="ce_tl_msg" class="ce-msg ${locked ? 'ok' : ''}">${locked ? '已锁定' : ''}</span>
                </div>
            </div>
            <div class="ce-section">
                <label class="ce-label">按事件名划分（在正文中检索事件位置作为篇章起点）</label>
                <div class="ce-rowline">
                    <input type="text" id="ce_tl_events" class="text_pole"
                        placeholder="输入事件名，多个用逗号分隔，如：死亡游戏开始, 第一层攻略, 通关SAO">
                    <button type="button" class="menu_button" id="ce_tl_ev_run">检索划分</button>
                </div>
                <p class="ce-faint">逻辑同角色检索：正文包含该关键词即命中，取首次出现位置；相邻两事件之间为一个篇章（篇名用后一个事件名）。</p>
            </div>
            <div class="ce-section">
                <label class="ce-label">按故事梗概划分（粘贴梗概，自动识别篇章结构）</label>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_tl_syn_norm">AI 优化梗概</button>
                    <span class="ce-faint">把不规范的梗概整理成标准格式（篇名干净、顺序不变、自动去掉「另一本书」的部分）</span>
                </div>
                <textarea id="ce_tl_synopsis" class="text_pole ce-synopsis" rows="6"
                    placeholder="粘贴作品梗概，例如：&#10;## 1. 艾恩葛朗特篇&#10;2022 年万人被困死亡游戏 SAO……&#10;## 2. 妖精之舞篇&#10;SAO 通关，亚丝娜仍被困在 ALO……"></textarea>
                <label class="ce-label">参考文档（可选：作品目录 / 设定资料 / 篇章简介）</label>
                <textarea id="ce_tl_refdoc" class="text_pole ce-synopsis" rows="4"
                    placeholder="可粘贴该作品的目录、卷名列表、设定资料等，供 AI 更准确地定位各篇章边界（顺序仍以梗概为准）。"></textarea>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_tl_syn_run">梗概划分</button>
                    <span class="ce-faint">篇章顺序以梗概为准；先模糊检索篇名与卷标志行，再由 AI 复核全部篇章边界（给出可检索关键词以校正偏差）</span>
                </div>
            </div>
            <div class="ce-section">
                <label class="ce-label">篇章列表（可编辑校对）</label>
                <div class="ce-log" id="ce_tl_log"></div>
                <div class="ce-tl-list" id="ce_tl_list">${rows}</div>
            </div>
        </div>`;

    bindRowEvents(textLen);
    bindSynopsisDraft();

    $('ce_tl_divide').addEventListener('click', doDivide);
    $('ce_tl_ev_run').addEventListener('click', doDivideByEvents);
    $('ce_tl_syn_norm').addEventListener('click', doNormalizeSynopsis);
    $('ce_tl_syn_run').addEventListener('click', doDivideBySynopsis);
    $('ce_tl_add').addEventListener('click', () => {
        const tl2 = timeline.getTimeline();
        tl2.nodes.push(timeline.normalizeNode({ name: '新篇章', start: 0, end: textLen }, textLen));
        timeline.saveTimeline(tl2);
        rerender('timeline');
    });
    $('ce_tl_lock').addEventListener('click', () => {
        timeline.setLocked(!timeline.isLocked());
        rerender('timeline');
    });
}

/** 梗概 / 参考文档草稿：回填 + 自动保存（切换 Tab 或刷新不丢） */
function bindSynopsisDraft() {
    const syn = $('ce_tl_synopsis');
    const ref = $('ce_tl_refdoc');
    const s = settings();
    if (syn) {
        syn.value = s.tlSynopsis || '';
        syn.addEventListener('input', () => { settings().tlSynopsis = syn.value; persist(); });
    }
    if (ref) {
        ref.value = s.tlRefDoc || '';
        ref.addEventListener('input', () => { settings().tlRefDoc = ref.value; persist(); });
    }
}

function nodeRowHtml(n, i, textLen) {
    const pctS = textLen ? (n.start / textLen * 100).toFixed(1) : '0';
    const pctE = textLen ? (n.end / textLen * 100).toFixed(1) : '0';
    return `
        <div class="ce-tl-item" data-id="${n.id}">
            <div class="ce-tl-idx">${i + 1}</div>
            <div class="ce-tl-fields">
                <input type="text" class="text_pole ce-tl-name" value="${escapeAttr(n.name)}" placeholder="篇章名">
                <div class="ce-tl-range">
                    <span class="ce-faint">正文位置 ${pctS}% ~ ${pctE}%</span>
                    <input type="number" class="text_pole ce-tl-start" value="${n.start}" title="起始字符位置">
                    <input type="number" class="text_pole ce-tl-end" value="${n.end}" title="结束字符位置">
                </div>
                <textarea class="text_pole ce-tl-summary" rows="2" placeholder="该篇章的世界观 / 核心事件 / 角色状态（可空）">${escapeHtml(n.summary)}</textarea>
            </div>
            <button type="button" class="menu_button ce-tl-del" title="删除">✕</button>
        </div>`;
}

function bindRowEvents(textLen) {
    const list = $('ce_tl_list');
    if (!list) return;
    list.querySelectorAll('.ce-tl-item').forEach((row) => {
        const id = row.dataset.id;
        const name = row.querySelector('.ce-tl-name');
        const start = row.querySelector('.ce-tl-start');
        const end = row.querySelector('.ce-tl-end');
        const summary = row.querySelector('.ce-tl-summary');
        const save = () => {
            const tl = timeline.getTimeline();
            const n = tl.nodes.find((x) => x.id === id);
            if (!n) return;
            n.name = name.value;
            // 不能用 `Number(v) || 默认值`：输入 0 是合法位置，会被静默改成别的值。
            // 空输入或非法数字才回退到默认。
            const st = Number(start.value);
            const en = Number(end.value);
            n.start = (start.value.trim() !== '' && Number.isFinite(st)) ? st : 0;
            n.end = (end.value.trim() !== '' && Number.isFinite(en)) ? en : textLen;
            n.summary = summary.value;
            timeline.saveTimeline(tl);
        };
        [name, start, end, summary].forEach((el) => el.addEventListener('input', save));
        row.querySelector('.ce-tl-del').addEventListener('click', () => {
            const tl = timeline.getTimeline();
            tl.nodes = tl.nodes.filter((x) => x.id !== id);
            timeline.saveTimeline(tl);
            rerender('timeline');
        });
    });
}

/** 按事件名检索划分 */
function doDivideByEvents() {
    const raw = $('ce_tl_events').value.trim();
    if (!raw) { flash('ce_tl_msg', '请输入事件名', true); return; }
    if (!novel.getNovel().trim()) { flash('ce_tl_msg', '请先导入小说', true); return; }
    const events = raw.split(/[,，、\n]+/).map((s) => s.trim()).filter(Boolean);
    clearLog('ce_tl_log');
    try {
        const { nodes, missed } = timeline.divideByEvents(events, {
            onLog: (m, c) => logTo('ce_tl_log', m, c),
        });
        timeline.saveTimeline({ nodes, locked: false });
        flash('ce_tl_msg', `已按事件划分 ${nodes.length} 个篇章` + (missed.length ? `，${missed.length} 个未命中` : ''), missed.length > 0);
        rerender('timeline');
    } catch (e) {
        flash('ce_tl_msg', '失败：' + e.message, true);
    }
}

/** AI 优化梗概：整理成标准格式后回填输入框 */
async function doNormalizeSynopsis() {
    const ta = $('ce_tl_synopsis');
    const raw = ta.value.trim();
    if (!raw) { flash('ce_tl_msg', '请先粘贴故事梗概', true); return; }
    const btn = $('ce_tl_syn_norm');
    btn.disabled = true;
    clearLog('ce_tl_log');
    flash('ce_tl_msg', 'AI 优化中…', false, { persist: true });
    logTo('ce_tl_log', '正在把梗概整理成标准格式…');
    try {
        const text = await timeline.normalizeSynopsisText(raw);
        ta.value = text;
        settings().tlSynopsis = text;
        persist();
        flash('ce_tl_msg', '优化完成，请检查后点「梗概划分」');
        logTo('ce_tl_log', '优化完成', 'g');
    } catch (e) {
        flash('ce_tl_msg', '优化失败：' + e.message, true);
        logTo('ce_tl_log', '优化失败：' + e.message, 'e');
    } finally {
        btn.disabled = false;
    }
}

/** 按故事梗概划分 */
async function doDivideBySynopsis() {
    const raw = $('ce_tl_synopsis').value.trim();
    const refDoc = $('ce_tl_refdoc') ? $('ce_tl_refdoc').value.trim() : '';
    if (!raw) { flash('ce_tl_msg', '请先粘贴故事梗概', true); return; }
    if (!novel.getNovel().trim()) { flash('ce_tl_msg', '请先导入小说', true); return; }
    const btn = $('ce_tl_syn_run');
    btn.disabled = true;
    clearLog('ce_tl_log');
    flash('ce_tl_msg', '解析梗概中…');
    try {
        const { nodes, missed } = await timeline.divideBySynopsis(raw, {
            onLog: (m, c) => logTo('ce_tl_log', m, c),
            refDoc,
        });
        timeline.saveTimeline({ nodes, locked: false });
        flash('ce_tl_msg', `已按梗概划分 ${nodes.length} 个篇章` + (missed.length ? `，${missed.length} 个本地未命中已交 AI 复核` : ''), missed.length > 0);
        rerender('timeline');
    } catch (e) {
        flash('ce_tl_msg', '失败：' + e.message, true);
    } finally {
        btn.disabled = false;
    }
}

async function doDivide() {
    if (!novel.getNovel().trim()) { flash('ce_tl_msg', '请先导入小说', true); return; }
    const btn = $('ce_tl_divide');
    btn.disabled = true;
    clearLog('ce_tl_log');
    flash('ce_tl_msg', '划分中…');
    try {
        const nodes = await timeline.autoDivide({
            onLog: (m, c) => logTo('ce_tl_log', m, c),
        });
        timeline.saveTimeline({ nodes, locked: false });
        flash('ce_tl_msg', `已划分 ${nodes.length} 个篇章，请校对`);
        rerender('timeline');
    } catch (e) {
        flash('ce_tl_msg', '失败：' + e.message, true);
    } finally {
        btn.disabled = false;
    }
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
}
