/**
 * ui-world.js —— 「世界书」Tab
 *
 * 两种生成方式：
 *   - 整本生成：所选任务在全书范围执行一次，合并为一本。
 *   - 按篇章生成：总本（全局世界观+角色总表+剧情大纲）+ 各篇章本（在该篇章正文范围内生成）。
 * 两模式共用同一套选项（含成人设定 / 配角处理 / 6 类任务勾选）。
 */

import { toast, flash, logTo, clearLog } from './util.js';
import { settings, persist } from './store.js';
import * as novel from './novel.js';
import * as worldbook from './worldbook.js';
import * as wbByChapter from './worldbook-by-chapter.js';
import * as timeline from './timeline.js';
import { $, state, escapeHtml, downloadText, stopRun, saveProducts } from './ui-context.js';

export function renderWorldTab(box) {
    const nodes = timeline.getTimeline().nodes || [];
    box.innerHTML = `
        <div class="ce-pane">
            <div class="ce-section">
                <label class="ce-label">生成世界书</label>
                <div class="ce-rowline">
                    <input type="text" id="ce_wb_name" class="text_pole" style="flex:1" placeholder="世界书名称，如：《XX》世界观">
                </div>
                <div class="ce-rowline">
                    <label>生成方式</label>
                    <select id="ce_wb_mode" class="text_pole">
                        <option value="whole">整本生成（全书提取为一本）</option>
                        <option value="chapter">按篇章生成（一总多分，推荐长篇）</option>
                    </select>
                    <span id="ce_wb_mode_hint" class="ce-faint"></span>
                </div>
                <div class="ce-rowline">
                    <label class="checkbox_label"><input type="checkbox" id="ce_wb_nsfw"> 含成人设定</label>
                    <label>配角处理</label>
                    <select id="ce_wb_minor_mode" class="text_pole">
                        <option value="group">群像合集</option>
                        <option value="each">每个配角单独一条</option>
                    </select>
                </div>
                <div class="ce-rowline">
                    <label class="checkbox_label"><input type="checkbox" id="ce_wb_t_extract" checked> 提取条目</label>
                    <label class="checkbox_label"><input type="checkbox" id="ce_wb_t_bg"> 共享背景</label>
                    <label class="checkbox_label"><input type="checkbox" id="ce_wb_t_minor"> 配角群像</label>
                    <label class="checkbox_label"><input type="checkbox" id="ce_wb_t_plot"> 剧情分段</label>
                    <label class="checkbox_label"><input type="checkbox" id="ce_wb_t_chars"> 人物列表</label>
                    <label class="checkbox_label"><input type="checkbox" id="ce_wb_t_plotlist"> 剧情大纲</label>
                </div>
                <p class="ce-faint" id="ce_wb_opt_tip"></p>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_wb_run">生成世界书</button>
                    <span id="ce_wb_msg" class="ce-msg"></span>
                </div>
                <div class="ce-log" id="ce_wb_log"></div>
            </div>
            <div class="ce-section" id="ce_wb_write_sec">
                <label class="ce-label">条目预览与写入</label>
                <textarea id="ce_wb_out" class="text_pole" rows="12" placeholder="提取的世界书条目会显示在这里…"></textarea>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_wb_write_new">写入酒馆（新建文件）</button>
                    <button type="button" class="menu_button" id="ce_wb_write_append">写入酒馆（追加到角色绑定）</button>
                    <button type="button" class="menu_button" id="ce_wb_dl">导出 .json</button>
                    <button type="button" class="menu_button" id="ce_wb_clear">清空</button>
                    <span id="ce_wb_msg2" class="ce-msg"></span>
                </div>
            </div>
            <div class="ce-section" id="ce_wb_groups_sec" style="display:none">
                <label class="ce-label">按篇章结果（总本 + 各篇章本）</label>
                <p class="ce-faint">
                    总本 = 全局世界观 + 角色总表 + 剧情大纲（3 条常驻）；
                    各篇章本 = 在各篇章正文范围内按上面勾选的任务生成（内容按篇章真实切分，不混线）。
                </p>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_wb_chapter_write">解耦写入酒馆（多本）</button>
                    <span id="ce_wb_msg3" class="ce-msg"></span>
                </div>
                <div id="ce_wb_groups"></div>
            </div>
            <div class="ce-section">
                <label class="ce-label">（可选）事后归类现有条目</label>
                <p class="ce-faint">已有条目想按篇章拆分时用：让 AI 判断每条属于通用本还是某篇章本。需先在「时间线」页建立篇章。</p>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_wb_classify">归类现有条目</button>
                    <span id="ce_wb_msg4" class="ce-msg"></span>
                </div>
            </div>
        </div>`;

    $('ce_wb_out').value = state.wbPreview;
    $('ce_wb_out').addEventListener('input', (e) => { state.wbPreview = e.target.value; saveProducts(); });
    $('ce_wb_run').addEventListener('click', runWorldbook);
    $('ce_wb_write_new').addEventListener('click', () => writeWorld('new'));
    $('ce_wb_write_append').addEventListener('click', () => writeWorld('append'));
    $('ce_wb_dl').addEventListener('click', () => {
        const json = worldbook.buildWbJson(state.wbEntries, {});
        downloadText(JSON.stringify(json, null, 2), ($('ce_wb_name').value || '世界书') + '.json', 'application/json');
    });
    $('ce_wb_clear').addEventListener('click', () => {
        state.wbEntries = []; state.wbPreview = ''; $('ce_wb_out').value = '';
        state.wbGroups = null;
        saveProducts();
        flash('ce_wb_msg2', '已清空');
    });
    $('ce_wb_classify').addEventListener('click', doClassify);
    $('ce_wb_chapter_write').addEventListener('click', doSplitWrite);
    bindWorldModeUI(nodes);
    // 刷新 / 切 Tab 后回填上次的归类结果
    if (state.wbGroups) {
        renderGroups(state.wbGroups);
        $('ce_wb_groups_sec').style.display = 'block';
    }
}

/** 生成方式切换：整本 / 按篇章（选项共用） */
function bindWorldModeUI(nodes) {
    const sel = $('ce_wb_mode');
    const hint = $('ce_wb_mode_hint');
    const tip = $('ce_wb_opt_tip');
    const writeSec = $('ce_wb_write_sec');
    const groupsSec = $('ce_wb_groups_sec');
    if (!sel) return;

    sel.value = settings().wbMode || 'whole';
    const refresh = () => {
        const m = sel.value;
        settings().wbMode = m;
        persist();
        if (m === 'chapter') {
            hint.textContent = nodes.length ? `（已建立 ${nodes.length} 个篇章）` : '（尚未建立时间线，请去「时间线」页划分）';
            tip.textContent = '按篇章生成：总本 = 全局世界观 + 角色总表 + 剧情大纲；各篇章本按上面勾选的任务在「该篇章正文范围内」生成。';
            writeSec.style.display = 'none';
            groupsSec.style.display = 'block';
        } else {
            hint.textContent = '';
            tip.textContent = '整本生成：把所选任务在全书范围内执行一次，结果合并为一本世界书。';
            writeSec.style.display = 'block';
            groupsSec.style.display = state.wbGroups ? 'block' : 'none';
        }
    };
    refresh();
    sel.addEventListener('change', refresh);
}

/** 按篇章生成世界书（一总多分）—— 由 runWorldbook 在「按篇章」模式下调用 */
async function runChapterWorldbook() {
    const nodes = timeline.getTimeline().nodes || [];
    const full = novel.getNovel();
    if (!nodes.length) { flash('ce_wb_msg', '请先在「时间线」页建立篇章', true); return; }
    if (!full.trim()) { flash('ce_wb_msg', '请先导入小说', true); return; }

    // 继承整本生成的选项
    const options = {
        extract: $('ce_wb_t_extract').checked,
        bg: $('ce_wb_t_bg').checked,
        minor: $('ce_wb_t_minor').checked,
        minorMode: $('ce_wb_minor_mode').value,
        plot: $('ce_wb_t_plot').checked,
        chars: $('ce_wb_t_chars').checked,
        plotlist: $('ce_wb_t_plotlist').checked,
    };
    if (!Object.entries(options).some(([k, v]) => k !== 'minorMode' && v)) {
        flash('ce_wb_msg', '请先勾选要生成的内容', true); return;
    }

    state.running = true;
    state.controller = new AbortController();
    const signal = state.controller.signal;
    clearLog('ce_wb_log');
    flash('ce_wb_msg', '按篇章生成中…', false, { persist: true });

    try {
        const groups = await wbByChapter.generateSplitWorldbook(nodes, {
            signal, logEl: 'ce_wb_log', options, fullText: full,
            onProgress: (i, total, name) => flash('ce_wb_msg', `生成 ${i + 1}/${total}：${name}…`, false, { persist: true }),
        });
        state.wbGroups = groups;
        renderGroups(groups);
        saveProducts();
        $('ce_wb_groups_sec').style.display = 'block';
        const total = (groups.general || []).length + (groups.chapters || []).reduce((s, c) => s + (c.entries || []).length, 0);
        flash('ce_wb_msg', signal.aborted ? '已停止' : `完成，总本 ${groups.general.length} 条，${groups.chapters.length} 本篇章本，共 ${total} 条`);
    } catch (e) {
        flash('ce_wb_msg', '生成失败：' + e.message, true);
        logTo('ce_wb_log', '生成失败：' + e.message, 'e');
    } finally {
        state.running = false;
    }
}

/** 归类：把条目分到通用本 / 各篇章本 */
async function doClassify() {
    if (!state.wbEntries.length) { flash('ce_wb_msg4', '没有条目可归类', true); return; }
    const nodes = timeline.getTimeline().nodes || [];
    if (!nodes.length) { flash('ce_wb_msg4', '请先在「时间线」页建立篇章', true); return; }
    flash('ce_wb_msg4', '归类中…', false, { persist: true });
    try {
        const groups = await worldbook.classifyEntries(state.wbEntries, nodes, {
            onLog: (m, c) => logTo('ce_wb_log', m, c),
        });
        state.wbGroups = groups;
        renderGroups(groups);
        saveProducts();
        flash('ce_wb_msg4', '归类完成');
    } catch (e) {
        flash('ce_wb_msg4', '归类失败：' + e.message, true);
    }
}

/** 渲染归类结果 */
function renderGroups(groups) {
    const box = $('ce_wb_groups');
    if (!box) return;
    const rows = [];
    rows.push(groupRowHtml('总本 / 通用设定本', groups.general || []));
    (groups.chapters || []).forEach((c) => rows.push(groupRowHtml(c.name + ' 篇章本', c.entries || [])));
    box.innerHTML = rows.join('');
}

function groupRowHtml(name, entries) {
    const items = entries.map((e) => `<span class="ce-tag">${escapeHtml(e.title)}</span>`).join('');
    return `<div class="ce-group">
        <div class="ce-group-head">${escapeHtml(name)} <span class="ce-faint">（${entries.length} 条）</span></div>
        <div class="ce-group-items">${items || '<span class="ce-faint">（空）</span>'}</div>
    </div>`;
}

/** 解耦写入：一次写入多本 */
async function doSplitWrite() {
    if (!state.wbGroups) { flash('ce_wb_msg3', '请先归类', true); return; }
    const base = $('ce_wb_name').value.trim();
    if (!base) { flash('ce_wb_msg3', '请填写世界书基础名（如《XX》）', true); return; }
    flash('ce_wb_msg3', '写入中…');
    try {
        const res = await worldbook.writeSplitWorldbooks(base, state.wbGroups, 'new');
        flash('ce_wb_msg3', res.message, !res.ok);
        if (res.ok) toast('已按篇章解耦写入多本世界书');
    } catch (e) {
        flash('ce_wb_msg3', '写入失败：' + e.message, true);
    }
}

async function runWorldbook() {
    const text = novel.getNovel().trim();
    if (!text) { flash('ce_wb_msg', '请先导入小说', true); return; }
    if (state.running) { stopRun(); return; }

    settings().nsfw = $('ce_wb_nsfw').checked;
    persist();

    // 生成方式：按篇章 → 走一总多分；整本 → 合并为一本
    if ($('ce_wb_mode').value === 'chapter') {
        await runChapterWorldbook();
        return;
    }

    const tasks = [];
    if ($('ce_wb_t_extract').checked) tasks.push(['提取条目', () => worldbook.wbExtractCore({ entries: state.wbEntries })]);
    if ($('ce_wb_t_bg').checked) tasks.push(['共享背景', () => worldbook.wbBgCore({})]);
    if ($('ce_wb_t_minor').checked) tasks.push(['配角群像', () => worldbook.wbMinorCore({ mode: $('ce_wb_minor_mode').value, cap: 20 })]);
    if ($('ce_wb_t_plot').checked) tasks.push(['剧情分段', () => worldbook.wbPlotCore({ entries: state.wbEntries })]);
    if ($('ce_wb_t_chars').checked) tasks.push(['人物列表', () => worldbook.wbConstantEntry({ kind: 'chars' })]);
    if ($('ce_wb_t_plotlist').checked) tasks.push(['剧情大纲', () => worldbook.wbConstantEntry({ kind: 'plot' })]);
    if (!tasks.length) { flash('ce_wb_msg', '请先勾选要生成的内容', true); return; }

    state.running = true;
    state.controller = new AbortController();
    clearLog('ce_wb_log');
    if ($('ce_wb_t_extract').checked) state.wbEntries = [];

    try {
        for (const [label, fn] of tasks) {
            if (state.controller.signal.aborted) break;
            logTo('ce_wb_log', '▶ ' + label);
            flash('ce_wb_msg', label + '…', false, { persist: true });
            const res = await fn();
            // 统一归一化：{entries,state} / 数组 / 单条目 三种返回形态
            const list = normalizeWbResult(res);
            list.forEach((e) => mergeWbEntry(e));
            state.wbPreview = worldbook.buildWbPreview(state.wbEntries, {});
            $('ce_wb_out').value = state.wbPreview;
            saveProducts();
        }
        flash('ce_wb_msg', state.controller.signal.aborted ? '已停止' : `完成，共 ${state.wbEntries.length} 条`);
    } catch (e) {
        flash('ce_wb_msg', '失败：' + e.message, true);
    } finally {
        state.running = false;
    }
}

/** 归一化世界书生成结果 */
function normalizeWbResult(res) {
    if (!res) return [];
    if (Array.isArray(res)) return res.filter(Boolean);
    if (res.entries && Array.isArray(res.entries)) return res.entries.filter(Boolean);
    if (res.title) return [res];
    return [];
}

/** 合并单条目（按 title 去重，保留更完整内容） */
function mergeWbEntry(e) {
    const i = state.wbEntries.findIndex((x) => x.title === e.title);
    if (i >= 0) {
        const ex = state.wbEntries[i];
        ex.keys = [...new Set([...(ex.keys || []), ...(e.keys || [])])];
        if ((e.content || '').length > (ex.content || '').length) ex.content = e.content;
        ex.constant = ex.constant || !!e.constant;
    } else {
        state.wbEntries.push(e);
    }
}

async function writeWorld(mode) {
    const name = $('ce_wb_name').value.trim();
    if (!name) { flash('ce_wb_msg2', '请填写世界书名称', true); return; }
    try {
        const parsed = worldbook.parseWbPreview($('ce_wb_out').value);
        if (parsed && parsed.length) state.wbEntries = parsed;
    } catch (e) { /* 保留原条目 */ }

    if (!state.wbEntries.length) { flash('ce_wb_msg2', '没有可写入的条目', true); return; }
    flash('ce_wb_msg2', '写入中…');
    const res = await worldbook.writeWorldbookToTavern(name, state.wbEntries, mode);
    if (res.ok) {
        flash('ce_wb_msg2', `已写入「${res.bookName}」，共 ${res.count} 条` + (res.conflicts?.length ? `（${res.conflicts.length} 处冲突已跳过）` : ''));
        toast('世界书已写入酒馆');
    } else {
        flash('ce_wb_msg2', res.message || '写入失败', true);
    }
}

export default { renderWorldTab };
