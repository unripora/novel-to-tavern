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
import * as persistMod from './persist.js';

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
            <div class="ce-section" id="ce_wb_vol_sec" style="display:none">
                <label class="ce-label">按卷生成（来自时间线）</label>
                <p class="ce-faint">
                    总本 = 全局世界观 + 角色总表 + 剧情大纲（必定生成，可取消跳过）；
                    各卷按上面勾选的任务生成：「提取条目」「剧情分段」限定在该卷正文范围内，
                    其余（共享背景 / 配角群像 / 人物列表 / 剧情大纲）为全书范围。
                    每卷完成即独立落盘为 <code>&lt;记录名&gt;/worldbook/&lt;卷名&gt;.json</code>，可单独导入酒馆。
                    「已生成」以落盘文件是否存在为准。
                </p>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_wb_sel_all">全选</button>
                    <button type="button" class="menu_button" id="ce_wb_sel_none">全不选</button>
                    <button type="button" class="menu_button" id="ce_wb_sel_undone">只选未生成</button>
                    <span id="ce_wb_msg_vol" class="ce-msg"></span>
                </div>
                <div class="ce-rowline">
                    <label class="checkbox_label"><input type="checkbox" id="ce_wb_force"> 强制重跑（覆盖已生成的卷）</label>
                </div>
                <div class="ce-vollist" id="ce_wb_vols"></div>
            </div>
            <div class="ce-section" id="ce_wb_groups_sec" style="display:none">
                <label class="ce-label">生成结果（总本 + 各卷）</label>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_wb_chapter_write">解耦写入酒馆（多本）</button>
                    <button type="button" class="menu_button" id="ce_wb_load_index">载入已落盘结果</button>
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
        // 先回读预览框（用户可能手改过），与「写入酒馆」保持一致，避免导出过期条目
        try {
            const parsed = worldbook.parseWbPreview($('ce_wb_out').value);
            if (parsed && parsed.length) state.wbEntries = parsed;
        } catch (e) { /* 解析失败：沿用原条目 */ }
        // buildWbJson 已返回 JSON 字符串，直接下载，切勿再次 JSON.stringify
        const json = worldbook.buildWbJson(state.wbEntries, {});
        downloadText(json, ($('ce_wb_name').value || '世界书') + '.json', 'application/json');
    });
    $('ce_wb_clear').addEventListener('click', () => {
        state.wbEntries = []; state.wbPreview = ''; $('ce_wb_out').value = '';
        state.wbGroups = null;
        saveProducts();
        flash('ce_wb_msg2', '已清空');
    });
    $('ce_wb_classify').addEventListener('click', doClassify);
    $('ce_wb_chapter_write').addEventListener('click', doSplitWrite);
    $('ce_wb_load_index').addEventListener('click', doLoadIndex);
    $('ce_wb_sel_all').addEventListener('click', () => toggleAllVols(true));
    $('ce_wb_sel_none').addEventListener('click', () => toggleAllVols(false));
    $('ce_wb_sel_undone').addEventListener('click', selectUndoneVols);
    bindWorldModeUI(nodes);
    renderVolList(nodes);
    // 刷新 / 切 Tab 后回填上次的生成结果
    if (state.wbGroups) {
        renderGroups(state.wbGroups);
        $('ce_wb_groups_sec').style.display = 'block';
    }
}

/** 生成方式切换：整本 / 按卷（选项共用） */
function bindWorldModeUI(nodes) {
    const sel = $('ce_wb_mode');
    const hint = $('ce_wb_mode_hint');
    const tip = $('ce_wb_opt_tip');
    const writeSec = $('ce_wb_write_sec');
    const volSec = $('ce_wb_vol_sec');
    const groupsSec = $('ce_wb_groups_sec');
    if (!sel) return;

    sel.value = settings().wbMode || 'whole';
    const refresh = async () => {
        const m = sel.value;
        settings().wbMode = m;
        persist();
        if (m === 'chapter') {
            hint.textContent = nodes.length ? `（已建立 ${nodes.length} 个卷）` : '（尚未建立时间线，请去「时间线」页划分）';
            tip.textContent = '按卷生成：总本 = 全局世界观 + 角色总表 + 剧情大纲；各卷中「提取条目」「剧情分段」限定在该卷正文范围内，其余任务为全书范围。';
            writeSec.style.display = 'none';
            volSec.style.display = 'block';
            groupsSec.style.display = state.wbGroups ? 'block' : 'none';
            await renderVolList(nodes);
        } else {
            hint.textContent = '';
            tip.textContent = '整本生成：把所选任务在全书范围内执行一次，结果合并为一本世界书。';
            writeSec.style.display = 'block';
            volSec.style.display = 'none';
            groupsSec.style.display = state.wbGroups ? 'block' : 'none';
        }
    };
    refresh();
    sel.addEventListener('change', refresh);
}

/** 当前工作区记录名（小说记录名；无则用兜底名） */
function currentRec() {
    return novel.getCurrentRecord() || '未命名';
}

/** 渲染「按卷生成」的卷列表（总本固定 + 各卷，带已生成标记） */
async function renderVolList(nodes) {
    const box = $('ce_wb_vols');
    if (!box) return;
    const rec = currentRec();
    const done = await persistMod.doneChapterSet(rec, (nodes || []).map((n) => n.name));
    const rows = [];
    // 总本（固定项，默认勾选）
    const wholeDone = !!done['_whole'];
    rows.push(`<label class="ce-volline">
        <input type="checkbox" class="ce_wb_vol" data-name="_whole" checked>
        <span>总本（全局世界观 + 角色总表 + 剧情大纲）</span>
        <span class="ce-faint">${wholeDone ? '[已生成]' : '[未生成]'}</span>
    </label>`);
    (nodes || []).forEach((n) => {
        const isDone = !!done[n.name];
        rows.push(`<label class="ce-volline">
            <input type="checkbox" class="ce_wb_vol" data-name="${escapeHtml(n.name)}" ${isDone ? '' : 'checked'}>
            <span>${escapeHtml(n.name)}</span>
            <span class="ce-faint">${isDone ? '[已生成]' : '[未生成]'}</span>
        </label>`);
    });
    box.innerHTML = rows.join('') || '<div class="ce-tip">尚未建立时间线，请去「时间线」页划分卷。</div>';
}

/** 全选 / 全不选 */
function toggleAllVols(on) {
    document.querySelectorAll('.ce_wb_vol').forEach((c) => { c.checked = on; });
}

/** 只选未生成的卷（总本一并选中，除非已生成） */
async function selectUndoneVols() {
    const rec = currentRec();
    const names = (timeline.getTimeline().nodes || []).map((n) => n.name);
    const done = await persistMod.doneChapterSet(rec, names);
    document.querySelectorAll('.ce_wb_vol').forEach((c) => {
        c.checked = !done[c.dataset.name];
    });
}

/** 读取当前勾选的卷名数组 */
function pickedVols() {
    return [...document.querySelectorAll('.ce_wb_vol')].filter((c) => c.checked).map((c) => c.dataset.name);
}

/** 按卷生成世界书（一总多分）—— 由 runWorldbook 在「按卷」模式下调用 */
async function runChapterWorldbook() {
    const allNodes = timeline.getTimeline().nodes || [];
    const full = novel.getNovel();
    if (!allNodes.length) { flash('ce_wb_msg', '请先在「时间线」页建立卷', true); return; }
    if (!full.trim()) { flash('ce_wb_msg', '请先导入小说', true); return; }

    const rec = currentRec();
    const picked = pickedVols();
    const force = !!$('ce_wb_force')?.checked;
    const wantWhole = picked.includes('_whole');
    const wantVols = allNodes.filter((n) => picked.includes(n.name));
    if (!wantWhole && !wantVols.length) { flash('ce_wb_msg', '请先勾选要生成的卷', true); return; }

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

    // 跳过已生成（除非强制重跑）——判定以落盘文件为准（本地键优先，插件关闭也生效）
    const done = await persistMod.doneChapterSet(rec, allNodes.map((n) => n.name));
    const skipWhole = !force && !!done['_whole'];
    const runNodes = force ? wantVols : wantVols.filter((n) => !done[n.name]);
    const skipped = wantVols.length - runNodes.length + (wantWhole && skipWhole ? 1 : 0);
    if (!runNodes.length && !(wantWhole && !skipWhole)) {
        flash('ce_wb_msg', '所选卷均已生成（如需覆盖请勾选「强制重跑」）', true);
        return;
    }

    state.running = true;
    state.controller = new AbortController();
    const signal = state.controller.signal;
    clearLog('ce_wb_log');
    flash('ce_wb_msg', `按卷生成中…（跳过已生成 ${skipped} 项）`, false, { persist: true });

    try {
        const idx = await persistMod.loadWbIndex(rec);
        const doneChapters = (idx.chapters || []).slice();

        // 总本：勾选且需要跑时才跑（engine 内建总本；这里用变量控制）
        const wantGenWhole = wantWhole && !skipWhole;
        const groups = await wbByChapter.generateSplitWorldbook(runNodes, {
            signal, logEl: 'ce_wb_log', options, fullText: full,
            // 只有需要总本时，才让引擎构建并落盘总本
            onGeneralDone: wantGenWhole ? async (general) => {
                await persistMod.saveChapterBook(rec, '_whole', general);
                const cur = state.wbGroups || { general: [], chapters: [] };
                state.wbGroups = { general, chapters: cur.chapters };
                renderGroups(state.wbGroups);
                saveProducts();
            } : undefined,
            onProgress: (i, total, name) => flash('ce_wb_msg', `生成 ${i + 1}/${total}：${name}…`, false, { persist: true }),
            // 每卷完成：独立落盘 + 即时进预览 + 更新索引
            onChapterDone: async (item, i, total) => {
                await persistMod.saveChapterBook(rec, item.name, item.entries);
                const di = doneChapters.findIndex((c) => c.name === item.name);
                const rc = { name: item.name, count: item.entries.length };
                if (di >= 0) doneChapters[di] = rc; else doneChapters.push(rc);
                await persistMod.saveWbIndex(doneChapters, rec);
                const cur = state.wbGroups || { general: [], chapters: [] };
                const rest = cur.chapters.filter((c) => c.name !== item.name);
                state.wbGroups = { general: cur.general, chapters: [...rest, item] };
                renderGroups(state.wbGroups);
                $('ce_wb_groups_sec').style.display = 'block';
                saveProducts();
                flash('ce_wb_msg', `已完成 ${i + 1}/${total}：${item.name}（${item.entries.length} 条，已落盘）`, false, { persist: true });
            },
        });
        // 引擎返回的总本：仅当需要时并入结果
        state.wbGroups = {
            general: wantGenWhole ? groups.general : (state.wbGroups?.general || []),
            chapters: mergeChapters(state.wbGroups?.chapters || [], groups.chapters || []),
        };
        renderGroups(state.wbGroups);
        saveProducts();
        $('ce_wb_groups_sec').style.display = 'block';
        await renderVolList(allNodes);
        flash('ce_wb_msg', signal.aborted ? '已停止（已完成卷均已落盘）' : `完成：本次生成 ${runNodes.length} 卷${wantGenWhole ? ' + 总本' : ''}${skipped ? `，跳过 ${skipped} 项` : ''}`);
    } catch (e) {
        flash('ce_wb_msg', '生成失败：' + e.message, true);
        logTo('ce_wb_log', '生成失败：' + e.message, 'e');
    } finally {
        state.running = false;
    }
}

/** 合并卷列表（同名的用新结果覆盖，其余保留） */
function mergeChapters(oldList, newList) {
    const map = new Map(oldList.map((c) => [c.name, c]));
    for (const c of newList) map.set(c.name, c);
    // 按时间线顺序输出
    const order = (timeline.getTimeline().nodes || []).map((n) => n.name);
    return [...map.values()].sort((a, b) => {
        const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    });
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
    const total = entries.length;
    return `<div class="ce-group">
        <div class="ce-group-head">
            <b>${escapeHtml(name)}</b>
            <span class="ce-faint">（${total} 条）</span>
        </div>
        <div class="ce-group-items">${items || '<span class="ce-faint">（空）</span>'}</div>
    </div>`;
}

/** 载入已落盘结果：从工作区文件恢复（刷新 / 换设备后可用） */
async function doLoadIndex() {
    flash('ce_wb_msg3', '载入中…', false, { persist: true });
    try {
        const rec = currentRec();
        const whole = await persistMod.loadChapterBook(rec, '_whole');
        // 候选卷名 = 时间线卷名 ∪ 服务器文件清单：
        // 前者覆盖「无 Server Plugin，仅本地缓存」；后者可发现不在当前时间线里的历史卷
        const serverNames = await persistMod.listChapterBooks(rec);
        const tlNames = (timeline.getTimeline().nodes || []).map((n) => n.name);
        const names = [...new Set([...tlNames, ...serverNames])];
        const chapters = [];
        for (const name of names) {
            const book = await persistMod.loadChapterBook(rec, name);
            if (book) chapters.push({ name: book.name || name, entries: book.entries || [] });
        }
        if (!chapters.length && !whole) { flash('ce_wb_msg3', '未发现该小说已落盘的结果', true); return; }
        state.wbGroups = { general: whole ? whole.entries : [], chapters: mergeChapters([], chapters) };
        renderGroups(state.wbGroups);
        $('ce_wb_groups_sec').style.display = 'block';
        saveProducts();
        await renderVolList(timeline.getTimeline().nodes || []);
        flash('ce_wb_msg3', `已载入：总本 ${whole ? whole.entries.length : 0} 条，${chapters.length} 卷`);
    } catch (e) {
        flash('ce_wb_msg3', '载入失败：' + e.message, true);
    }
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

    const novelName = novel.getCurrentRecord() || '未命名';
    const tasks = [];
    if ($('ce_wb_t_extract').checked) {
        tasks.push(['提取条目', () => runWithResume('extract', novelName, (st) => worldbook.wbExtractCore({
            entries: state.wbEntries, state: st,
            onSegment: (s) => persistMod.saveProgress('extract', s, novelName),
        }))]);
    }
    if ($('ce_wb_t_bg').checked) tasks.push(['共享背景', () => worldbook.wbBgCore({})]);
    if ($('ce_wb_t_minor').checked) tasks.push(['配角群像', () => worldbook.wbMinorCore({ mode: $('ce_wb_minor_mode').value, cap: 20 })]);
    if ($('ce_wb_t_plot').checked) {
        tasks.push(['剧情分段', () => runWithResume('plot', novelName, (st) => worldbook.wbPlotCore({
            entries: state.wbEntries, state: st,
            onSegment: (s) => persistMod.saveProgress('plot', s, novelName),
        }))]);
    }
    if ($('ce_wb_t_chars').checked) tasks.push(['人物列表', () => worldbook.wbConstantEntry({ kind: 'chars' })]);
    if ($('ce_wb_t_plotlist').checked) tasks.push(['剧情大纲', () => worldbook.wbConstantEntry({ kind: 'plot' })]);
    if (!tasks.length) { flash('ce_wb_msg', '请先勾选要生成的内容', true); return; }

    // 记录本次生成选项到工作区（中间状态）
    persistMod.saveOpts(novelName, { mode: 'whole', options: { nsfw: settings().nsfw } }).catch(() => { });

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

/**
 * 带断点续跑地执行分段任务。
 * 先从工作区读回断点 state（若有且正文未变则续跑），执行内核，任务完成后清断点。
 * @param {string} kind 'extract' | 'plot'
 * @param {string} rec 记录名（工作区）
 * @param {(state:object|null) => Promise<any>} run 执行内核（传入 state）
 */
async function runWithResume(kind, rec, run) {
    let st = await persistMod.loadProgress(kind, rec);
    const res = await run(st);
    // 内核返回 { entries, state, done }：done=true 或 state=null 表示跑完
    if (res && res.done) {
        await persistMod.clearProgress(kind, rec);
    } else if (res && res.state) {
        await persistMod.saveProgress(kind, res.state, rec);
    }
    return res;
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
