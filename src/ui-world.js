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
import * as stBridge from './st-bridge.js';

export function renderWorldTab(box) {
    const nodes = timeline.getTimeline().nodes || [];
    box.innerHTML = `
        <div class="ce-pane">
            <div class="ce-section">
                <label class="ce-label">生成世界书</label>
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
                <div id="ce_wb_vol_area" style="display:none">
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
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_wb_run">生成世界书</button>
                    <span id="ce_wb_msg" class="ce-msg"></span>
                </div>
                <div class="ce-log" id="ce_wb_log"></div>
            </div>
            <div class="ce-section" id="ce_wb_write_sec">
                <label class="ce-label">世界书结果</label>
                <div id="ce_wb_single">
                    <div class="ce-rowline">
                        <input type="text" id="ce_wb_name" class="text_pole" style="flex:1" placeholder="世界书名称，如：《XX》">
                    </div>
                    <textarea id="ce_wb_out" class="text_pole" rows="12" placeholder="提取的世界书条目会显示在这里…"></textarea>
                    <div class="ce-rowline">
                        <button type="button" class="menu_button" id="ce_wb_write_new">写入酒馆（新建文件）</button>
                        <button type="button" class="menu_button" id="ce_wb_write_append">写入酒馆（追加到角色绑定）</button>
                        <button type="button" class="menu_button" id="ce_wb_dl">导出 .json</button>
                        <button type="button" class="menu_button" id="ce_wb_clear">清空</button>
                        <span id="ce_wb_msg2" class="ce-msg"></span>
                    </div>
                    <div class="ce-rowline" id="ce_wb_classify_row">
                        <button type="button" class="menu_button" id="ce_wb_classify">解耦</button>
                        <span class="ce-faint">把上面这一本条目按「时间线」篇章拆成多本（AI 判断每条归属）</span>
                        <span id="ce_wb_msg4" class="ce-msg"></span>
                    </div>
                </div>
                <div id="ce_wb_multi" style="display:none">
                    <p class="ce-faint">下列每本世界书均可单独改名，名字默认取解析出的篇章名；点「导入酒馆」按各自名字分别写入。</p>
                    <div class="ce-rowline">
                        <button type="button" class="menu_button" id="ce_wb_chapter_write">导入酒馆</button>
                        <button type="button" class="menu_button" id="ce_wb_load_index">载入已落盘结果</button>
                        <button type="button" class="menu_button" id="ce_wb_back_single">返回单本</button>
                        <span id="ce_wb_msg3" class="ce-msg"></span>
                    </div>
                    <div id="ce_wb_groups"></div>
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
    $('ce_wb_back_single').addEventListener('click', () => { state.wbGroups = null; saveProducts(); showWbMode('single'); flash('ce_wb_msg2', '已返回单本'); });
    $('ce_wb_sel_all').addEventListener('click', () => toggleAllVols(true));
    $('ce_wb_sel_none').addEventListener('click', () => toggleAllVols(false));
    $('ce_wb_sel_undone').addEventListener('click', selectUndoneVols);
    bindWorldModeUI(nodes);
    renderVolList(nodes);
    // 刷新 / 切 Tab 后回填上次的结果：有多本分组则直接进多本形态
    if (state.wbGroups) {
        renderGroups(state.wbGroups);
        showWbMode('multi');
    } else {
        showWbMode('single');
    }
}

/** 切换「世界书结果」区的形态：single=单本预览 / multi=多本分组 */
function showWbMode(mode) {
    const single = $('ce_wb_single');
    const multi = $('ce_wb_multi');
    if (!single || !multi) return;
    const isMulti = mode === 'multi';
    single.style.display = isMulti ? 'none' : 'block';
    multi.style.display = isMulti ? 'block' : 'none';
}

/** 生成方式切换：整本 / 按卷（选项共用） */
function bindWorldModeUI(nodes) {
    const sel = $('ce_wb_mode');
    const hint = $('ce_wb_mode_hint');
    const tip = $('ce_wb_opt_tip');
    const volArea = $('ce_wb_vol_area');
    if (!sel) return;

    sel.value = settings().wbMode || 'whole';
    const refresh = async () => {
        const m = sel.value;
        settings().wbMode = m;
        persist();
        if (m === 'chapter') {
            hint.textContent = nodes.length ? `（已建立 ${nodes.length} 个卷）` : '（尚未建立时间线，请去「时间线」页划分）';
            tip.textContent = '按卷生成：总本 = 全局世界观 + 角色总表 + 剧情大纲；各卷中「提取条目」「剧情分段」限定在该卷正文范围内，其余任务为全书范围。';
            volArea.style.display = 'block';
            // 按篇章的结果本就是多本：有多本分组则进多本形态
            showWbMode(state.wbGroups ? 'multi' : 'single');
            await renderVolList(nodes);
        } else {
            hint.textContent = '';
            tip.textContent = '整本生成：把所选任务在全书范围内执行一次，结果合并为一本世界书。';
            volArea.style.display = 'none';
            // 整本模式：未解耦时用单本预览，已解耦则展示多本
            showWbMode(state.wbGroups ? 'multi' : 'single');
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
    // 总本（固定项）：已生成不勾选，未生成勾选
    const wholeDone = !!done['_whole'];
    rows.push(`<label class="ce-volline">
        <input type="checkbox" class="ce_wb_vol" data-name="_whole" ${wholeDone ? '' : 'checked'}>
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
            // 未勾选总本时不构建总本（避免「只选了卷却在生成总本」）
            genGeneral: wantGenWhole,
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
                showWbMode('multi');
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
        showWbMode('multi');
        await renderVolList(allNodes);
        if (signal.aborted) logTo('ce_wb_log', '⏹ 已停止（已完成卷均已落盘）', 'e');
        else logTo('ce_wb_log', '✅ 所有任务已完成', 'g');
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
        showWbMode('multi');
        saveProducts();
        flash('ce_wb_msg4', '解耦完成：' + (groups.chapters || []).length + ' 本 + 总本，可在下方改名后「导入酒馆」');
    } catch (e) {
        flash('ce_wb_msg4', '归类失败：' + e.message, true);
    }
}

/** 渲染归类结果：每本一个可编辑名字框，默认名 总本=「总本」、卷=卷名 */
function renderGroups(groups) {
    const box = $('ce_wb_groups');
    if (!box) return;
    const rows = [];
    rows.push(groupRowHtml('_whole', '总本', groups.general || []));
    (groups.chapters || []).forEach((c) => rows.push(groupRowHtml(c.name, c.name, c.entries || [])));
    box.innerHTML = rows.join('');
    bindGroupNameInputs();
    bindEntryClicks();
}

function groupRowHtml(key, defaultName, entries) {
    // 每条 tag 可点击 → 弹窗编辑；携带所属书 key + 该条下标
    const items = entries.map((e, i) =>
        `<span class="ce-tag ce-tag-edit" data-book="${escapeHtml(key)}" data-idx="${i}" title="点击编辑">${escapeHtml(e.title)}</span>`
    ).join('');
    const total = entries.length;
    return `<div class="ce-group" data-key="${escapeHtml(key)}">
        <div class="ce-group-head">
            <input type="text" class="text_pole ce_group_name" style="flex:1" value="${escapeHtml(groupsName(key) || defaultName)}" placeholder="世界书名字">
            <span class="ce-faint">（${total} 条）</span>
        </div>
        <div class="ce-group-items">${items || '<span class="ce-faint">（空）</span>'}</div>
    </div>`;
}

/** 绑定「点击条目 → 弹窗编辑」 */
function bindEntryClicks() {
    document.querySelectorAll('#ce_wb_groups .ce-tag-edit').forEach((el) => {
        el.addEventListener('click', () => editEntryPopup(el.dataset.book, Number(el.dataset.idx)));
    });
}

/** 按书 key 取该本的条目数组（直接引用，便于就地修改） */
function entriesOfBook(key) {
    const g = state.wbGroups;
    if (!g) return null;
    if (key === '_whole') return g.general || [];
    const ch = (g.chapters || []).find((c) => c.name === key);
    return ch ? (ch.entries || []) : null;
}

/** 弹窗编辑单条：标题 / 关键词 / 内容；确定后写回并重渲染 */
async function editEntryPopup(bookKey, idx) {
    const list = entriesOfBook(bookKey);
    const entry = list && list[idx];
    if (!entry) { flash('ce_wb_msg3', '条目不存在', true); return; }
    const keys = (entry.keys || []).join('、');
    const html =
        '<div style="display:flex;flex-direction:column;gap:8px">' +
        '<label>标题<input id="ce_ed_title" class="text_pole" style="width:100%" value="' + escapeHtml(entry.title || '') + '"></label>' +
        '<label>关键词（用「、」或逗号分隔）<input id="ce_ed_keys" class="text_pole" style="width:100%" value="' + escapeHtml(keys) + '"></label>' +
        '<label>内容<textarea id="ce_ed_content" class="text_pole" rows="10" style="width:100%">' + escapeHtml(entry.content || '') + '</textarea></label>' +
        '</div>';
    const ok = await stBridge.popupForm({
        title: '编辑条目', bodyHtml: html,
        onOpen: (root) => { const t = root.querySelector('#ce_ed_title'); if (t) t.focus(); },
    });
    if (!ok) return;
    // 从弹窗（可能在 document 或酒馆弹窗容器内）取回值
    const get = (id) => {
        const el = document.getElementById(id) || document.querySelector('#' + id);
        return el ? String(el.value || '') : '';
    };
    const title = get('ce_ed_title').trim();
    if (!title) { flash('ce_wb_msg3', '标题不能为空', true); return; }
    entry.title = title;
    entry.keys = get('ce_ed_keys').split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean);
    entry.content = get('ce_ed_content');
    renderGroups(state.wbGroups);
    saveProducts();
    flash('ce_wb_msg3', '已更新条目');
}

/** 读取 / 记录「生成结果」区各本的用户自定义名字（按卷名存于 state.wbGroupNames） */
function groupsName(key) {
    const m = state.wbGroupNames || {};
    return m[key] || '';
}
function bindGroupNameInputs() {
    document.querySelectorAll('#ce_wb_groups .ce_group_name').forEach((inp) => {
        inp.addEventListener('input', (e) => {
            const key = e.target.closest('.ce-group')?.dataset.key;
            if (!key) return;
            state.wbGroupNames = state.wbGroupNames || {};
            state.wbGroupNames[key] = e.target.value;
            saveProducts();
        });
    });
}

/** 取「生成结果」各本的最终名字：用户自定义 > 默认（总本「总本」，卷=卷名） */
function finalGroupNames() {
    const m = state.wbGroupNames || {};
    const pick = (key, def) => (m[key] && m[key].trim()) || def;
    return {
        whole: pick('_whole', '总本'),
        chapter: (name) => pick(name, name),
    };
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
        showWbMode('multi');
        saveProducts();
        await renderVolList(timeline.getTimeline().nodes || []);
        flash('ce_wb_msg3', `已载入：总本 ${whole ? whole.entries.length : 0} 条，${chapters.length} 卷`);
    } catch (e) {
        flash('ce_wb_msg3', '载入失败：' + e.message, true);
    }
}

/** 导入酒馆：把「生成结果」的多本按各自名字写入酒馆 */
async function doSplitWrite() {
    if (!state.wbGroups) { flash('ce_wb_msg3', '请先按篇章生成或解耦', true); return; }
    const names = finalGroupNames();
    // 组装带名字的写入清单：总本 + 各卷，各自用「生成结果」区里的名字
    const books = [];
    if ((state.wbGroups.general || []).length) books.push({ name: names.whole, entries: state.wbGroups.general });
    (state.wbGroups.chapters || []).forEach((c) => {
        if ((c.entries || []).length) books.push({ name: names.chapter(c.name), entries: c.entries });
    });
    if (!books.length) { flash('ce_wb_msg3', '没有可写入的条目', true); return; }
    flash('ce_wb_msg3', '写入中…');
    try {
        const res = await worldbook.writeSplitWorldbooks(books, 'new');
        flash('ce_wb_msg3', res.message, !res.ok);
        if (res.ok) toast('已按各自名字写入 ' + books.length + ' 本世界书');
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
        if (state.controller.signal.aborted) {
            logTo('ce_wb_log', '⏹ 已停止', 'e');
            flash('ce_wb_msg', '已停止');
        } else {
            logTo('ce_wb_log', '✅ 所有任务已完成', 'g');
            flash('ce_wb_msg', `完成，共 ${state.wbEntries.length} 条`);
        }
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
