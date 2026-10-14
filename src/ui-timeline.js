/**
 * ui-timeline.js —— 「时间线」Tab（AI 划分 + 人工校对）
 */

import { flash, logTo, clearLog } from './util.js';
import * as novel from './novel.js';
import * as timeline from './timeline.js';
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
            <div class="ce-rowline">
                <button type="button" class="menu_button" id="ce_tl_divide">AI 自动划分</button>
                <button type="button" class="menu_button" id="ce_tl_add">手动添加</button>
                <button type="button" class="menu_button" id="ce_tl_lock">${locked ? '解除锁定' : '锁定时间线'}</button>
                <span id="ce_tl_msg" class="ce-msg ${locked ? 'ok' : ''}">${locked ? '已锁定' : ''}</span>
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
                <textarea id="ce_tl_synopsis" class="text_pole ce-synopsis" rows="6"
                    placeholder="粘贴作品梗概，例如：&#10;## 1. 艾恩葛朗特篇&#10;2022 年万人被困死亡游戏 SAO……&#10;## 2. 妖精之舞篇&#10;SAO 通关，亚丝娜仍被困在 ALO……"></textarea>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_tl_syn_run">梗概划分</button>
                    <span class="ce-faint">先按篇名关键词在正文中模糊检索（含「第X卷」标志行），未命中的交给 AI 重检索</span>
                </div>
            </div>
            <div class="ce-log" id="ce_tl_log"></div>
            <div class="ce-tl-list" id="ce_tl_list">${rows}</div>
        </div>`;

    bindRowEvents(textLen);

    $('ce_tl_divide').addEventListener('click', doDivide);
    $('ce_tl_ev_run').addEventListener('click', doDivideByEvents);
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
            n.start = Number(start.value) || 0;
            n.end = Number(end.value) || textLen;
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

/** 按故事梗概划分 */
async function doDivideBySynopsis() {
    const raw = $('ce_tl_synopsis').value.trim();
    if (!raw) { flash('ce_tl_msg', '请先粘贴故事梗概', true); return; }
    if (!novel.getNovel().trim()) { flash('ce_tl_msg', '请先导入小说', true); return; }
    const btn = $('ce_tl_syn_run');
    btn.disabled = true;
    clearLog('ce_tl_log');
    flash('ce_tl_msg', '解析梗概中…');
    try {
        const { nodes, missed } = await timeline.divideBySynopsis(raw, {
            onLog: (m, c) => logTo('ce_tl_log', m, c),
        });
        timeline.saveTimeline({ nodes, locked: false });
        flash('ce_tl_msg', `已按梗概划分 ${nodes.length} 个篇章` + (missed.length ? `，${missed.length} 个由 AI/均分估算` : ''), missed.length > 0);
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
