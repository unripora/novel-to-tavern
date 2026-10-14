/**
 * ui-misc.js —— 其余 Tab：user 人设 / 世界书 / 文风 / 开场白 / 自检 / 历史
 */

import { toast, flash, logTo, clearLog } from './util.js';
import { settings, persist } from './store.js';
import * as novel from './novel.js';
import * as worldbook from './worldbook.js';
import * as wbByChapter from './worldbook-by-chapter.js';
import * as extras from './extras.js';
import * as timeline from './timeline.js';
import { $, state, escapeHtml, copyText, downloadText, stopRun } from './ui-context.js';

/* ============ Tab 4：user 人设 ============ */

export function renderPersonaTab(box) {
    box.innerHTML = `
        <div class="ce-pane">
            <div class="ce-section">
                <label class="ce-label">人设设定</label>
                <label>你希望的设定</label>
                <textarea id="ce_pn_desc" class="text_pole" rows="4"
                    placeholder="例：名字叫江离，女，24 岁，INFP，在城南开一家花店…"></textarea>
                <div class="ce-rowline">
                    <input type="text" id="ce_pn_char" class="text_pole" placeholder="与哪个角色产生关系（可空）">
                    <select id="ce_pn_detail" class="text_pole">
                        <option value="concise">精简</option>
                        <option value="medium" selected>适中</option>
                        <option value="rich">详尽</option>
                    </select>
                </div>
                <textarea id="ce_pn_rel" class="text_pole" rows="3" placeholder="你和 TA 的关系、共同经历（可空）"></textarea>
                <div class="ce-rowline">
                    <label class="checkbox_label"><input type="checkbox" id="ce_pn_use_novel" checked> 结合小说世界观</label>
                    <label class="checkbox_label"><input type="checkbox" id="ce_pn_nsfw"> 含 NSFW</label>
                </div>
                <div class="ce-rowline">
                    <label class="checkbox_label"><input type="checkbox" id="ce_pn_stat"> 数值面板模式</label>
                    <span class="ce-faint">追加数值面板（含与角色的相对强度对比）</span>
                </div>
                <div id="ce_pn_stat_box" style="display:none">
                    <div class="ce-rowline">
                        <input type="text" id="ce_pn_stat_fields" class="text_pole"
                            placeholder="数值字段（留空由 AI 依作品类型决定）">
                    </div>
                    <div class="ce-rowline">
                        <input type="text" id="ce_pn_stat_refs" class="text_pole"
                            placeholder="参考数值（可空）">
                    </div>
                </div>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_pn_run">生成 user 人设</button>
                    <span id="ce_pn_msg" class="ce-msg"></span>
                </div>
            </div>
            <div class="ce-section">
                <label class="ce-label">生成结果</label>
                <textarea id="ce_pn_out" class="text_pole" rows="10" placeholder="生成的 user 人设会显示在这里…"></textarea>
                <div class="ce-rowline"><button type="button" class="menu_button" id="ce_pn_copy">复制</button></div>
                <p class="ce-tip">用法：复制后粘贴到酒馆「用户角色（Persona）」里。</p>
            </div>
        </div>`;

    $('ce_pn_out').value = state.personaText;
    bindPersonaStatUI();
    $('ce_pn_run').addEventListener('click', async () => {
        flash('ce_pn_msg', '生成中…');
        try {
            const statPanel = $('ce_pn_stat')?.checked
                ? { fields: $('ce_pn_stat_fields')?.value || '', refs: $('ce_pn_stat_refs')?.value || '', persona: true }
                : null;
            const text = await extras.generatePersona({
                desc: $('ce_pn_desc').value,
                charName: $('ce_pn_char').value.trim(),
                rel: $('ce_pn_rel').value,
                detail: $('ce_pn_detail').value,
                useNovel: $('ce_pn_use_novel').checked,
                nsfw: $('ce_pn_nsfw').checked,
                statPanel,
            });
            state.personaText = text;
            $('ce_pn_out').value = text;
            flash('ce_pn_msg', '完成');
        } catch (e) { flash('ce_pn_msg', '失败：' + e.message, true); }
    });
    $('ce_pn_copy').addEventListener('click', () => copyText(state.personaText, 'ce_pn_msg'));
}

/** user 人设的数值面板开关绑定 */
function bindPersonaStatUI() {
    const cb = $('ce_pn_stat');
    const box = $('ce_pn_stat_box');
    const fields = $('ce_pn_stat_fields');
    const refs = $('ce_pn_stat_refs');
    if (!cb) return;
    const s = settings();
    cb.checked = !!s.statPanelPersona;
    fields.value = s.statPanelFields || '';
    refs.value = s.statPanelRefs || '';
    box.style.display = cb.checked ? 'block' : 'none';
    const save = () => {
        const st = settings();
        st.statPanelPersona = cb.checked;
        st.statPanelFields = fields.value;
        st.statPanelRefs = refs.value;
        persist();
    };
    cb.addEventListener('change', () => { box.style.display = cb.checked ? 'block' : 'none'; save(); });
    fields.addEventListener('input', save);
    refs.addEventListener('input', save);
}

/* ============ Tab 5：世界书 ============ */

export function renderWorldTab(box) {
    box.innerHTML = `
        <div class="ce-pane">
            <div class="ce-section">
                <label class="ce-label">生成世界书</label>
                <div class="ce-rowline">
                    <input type="text" id="ce_wb_name" class="text_pole" style="flex:1" placeholder="世界书名称，如：《XX》世界观">
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
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_wb_run">生成所选世界书</button>
                    <span id="ce_wb_msg" class="ce-msg"></span>
                </div>
                <div class="ce-log" id="ce_wb_log"></div>
            </div>
            <div class="ce-section">
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
            <div class="ce-section">
                <label class="ce-label">按篇章生成（一总多分，推荐）</label>
                <p class="ce-faint">
                    按「时间线」篇章分别生成：总本 = 全局世界观 + 角色总表 + 剧情大纲（3 条常驻）；
                    各篇章本 = 在该篇章正文范围内提取的势力/地点/设定/剧情（内容按篇章真实切分，不混线）。
                </p>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_wb_chapter_gen">按篇章生成</button>
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
        flash('ce_wb_msg2', '已清空');
    });
    $('ce_wb_classify').addEventListener('click', doClassify);
    $('ce_wb_chapter_gen').addEventListener('click', doChapterGen);
    $('ce_wb_chapter_write').addEventListener('click', doSplitWrite);
}

/** 按篇章生成世界书（一总多分） */
async function doChapterGen() {
    const nodes = timeline.getTimeline().nodes || [];
    if (!nodes.length) { flash('ce_wb_msg3', '请先在「时间线」页建立篇章', true); return; }
    if (!novel.getNovel().trim()) { flash('ce_wb_msg3', '请先导入小说', true); return; }
    if (state.running) { flash('ce_wb_msg3', '正在生成，请稍候', true); return; }

    settings().nsfw = $('ce_wb_nsfw').checked;
    persist();

    state.running = true;
    state.controller = new AbortController();
    const signal = state.controller.signal;
    clearLog('ce_wb_log');
    flash('ce_wb_msg3', '按篇章生成中…');

    try {
        const groups = await wbByChapter.generateSplitWorldbook(nodes, {
            signal, logEl: 'ce_wb_log',
            onProgress: (i, total, name) => flash('ce_wb_msg3', `生成 ${i + 1}/${total}：${name}…`),
        });
        state.wbGroups = groups;
        renderGroups(groups);
        flash('ce_wb_msg3', '生成完成，请检查后「解耦写入酒馆（多本）」');
    } catch (e) {
        flash('ce_wb_msg3', '生成失败：' + e.message, true);
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
    flash('ce_wb_msg4', '归类中…');
    try {
        const groups = await worldbook.classifyEntries(state.wbEntries, nodes, {
            onLog: (m, c) => logTo('ce_wb_log', m, c),
        });
        state.wbGroups = groups;
        renderGroups(groups);
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
    rows.push(groupRowHtml('通用设定本', groups.general || []));
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
            flash('ce_wb_msg', label + '…');
            const res = await fn();
            // 统一归一化：{entries,state} / 数组 / 单条目 三种返回形态
            const list = normalizeWbResult(res);
            list.forEach((e) => mergeWbEntry(e));
            state.wbPreview = worldbook.buildWbPreview(state.wbEntries, {});
            $('ce_wb_out').value = state.wbPreview;
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

/* ============ Tab 6：文风 ============ */

export function renderStyleTab(box) {
    box.innerHTML = `
        <div class="ce-pane">
            <div class="ce-section">
                <label class="ce-label">文风设置</label>
                <div class="ce-rowline">
                    <label class="checkbox_label"><input type="checkbox" id="ce_style_nsfw"> 含情欲描写文风</label>
                </div>
                <textarea id="ce_style_extra" class="text_pole" rows="3" placeholder="额外要求 / 侧重点（可空）"></textarea>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_style_run">蒸馏文风</button>
                    <span id="ce_style_msg" class="ce-msg"></span>
                </div>
            </div>
            <div class="ce-section">
                <label class="ce-label">生成结果</label>
                <textarea id="ce_style_out" class="text_pole" rows="10" placeholder="文风分析 + 可复用文风提示词会显示在这里…"></textarea>
                <div class="ce-rowline"><button type="button" class="menu_button" id="ce_style_copy">复制</button></div>
            </div>
        </div>`;

    $('ce_style_out').value = state.styleText;
    $('ce_style_run').addEventListener('click', async () => {
        flash('ce_style_msg', '分析中…');
        try {
            const text = await extras.distillStyle({ nsfw: $('ce_style_nsfw').checked, extra: $('ce_style_extra').value });
            state.styleText = text;
            $('ce_style_out').value = text;
            flash('ce_style_msg', '完成');
        } catch (e) { flash('ce_style_msg', '失败：' + e.message, true); }
    });
    $('ce_style_copy').addEventListener('click', () => copyText(state.styleText, 'ce_style_msg'));
}

/* ============ Tab 7：开场白 ============ */

export function renderFirstTab(box) {
    box.innerHTML = `
        <div class="ce-pane">
            <div class="ce-section">
                <label class="ce-label">开场白设置</label>
                <div class="ce-rowline">
                    <input type="text" id="ce_fm_char" class="text_pole" placeholder="给谁写（留空用当前角色卡）">
                    <select id="ce_fm_view" class="text_pole">
                        <option value="second" selected>第二人称</option>
                        <option value="first">第一人称</option>
                        <option value="third">第三人称</option>
                    </select>
                </div>
                <textarea id="ce_fm_scene" class="text_pole" rows="2" placeholder="开场情境（留空由 AI 自拟）"></textarea>
                <div class="ce-rowline">
                    <label class="checkbox_label"><input type="checkbox" id="ce_fm_use_novel" checked> 结合世界观与文风</label>
                    <label class="checkbox_label"><input type="checkbox" id="ce_fm_nsfw"> 含 NSFW</label>
                </div>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_fm_run">生成开场白</button>
                    <span id="ce_fm_msg" class="ce-msg"></span>
                </div>
            </div>
            <div class="ce-section">
                <label class="ce-label">生成结果</label>
                <textarea id="ce_fm_out" class="text_pole" rows="10" placeholder="生成的开场白会显示在这里…"></textarea>
                <div class="ce-rowline"><button type="button" class="menu_button" id="ce_fm_copy">复制</button></div>
            </div>
        </div>`;

    $('ce_fm_out').value = state.firstText;
    $('ce_fm_run').addEventListener('click', async () => {
        flash('ce_fm_msg', '生成中…');
        try {
            const text = await extras.generateFirstMessage({
                charName: $('ce_fm_char').value.trim() || state.selectedNames[0] || '',
                view: $('ce_fm_view').value,
                scene: $('ce_fm_scene').value,
                useNovel: $('ce_fm_use_novel').checked,
                nsfw: $('ce_fm_nsfw').checked,
                cardText: state.cardText,
                styleText: state.styleText,
            });
            state.firstText = text;
            $('ce_fm_out').value = text;
            flash('ce_fm_msg', '完成');
        } catch (e) { flash('ce_fm_msg', '失败：' + e.message, true); }
    });
    $('ce_fm_copy').addEventListener('click', () => copyText(state.firstText, 'ce_fm_msg'));
}

/* ============ Tab 8：自检 ============ */

export function renderCheckTab(box) {
    const items = [];
    splitCards(state.cardText).forEach((c) => items.push({ type: 'card', label: c.label, name: c.name, content: c.content }));
    state.wbEntries.forEach((e) => items.push({ type: 'wb', label: '世界书·' + e.title, name: e.title, keys: e.keys, content: e.content }));

    const listHtml = items.length
        ? items.map((it, i) => `<label class="checkbox_label">
            <input type="checkbox" class="ce_check_item" data-i="${i}" checked>
            <span>${escapeHtml(it.label)}</span></label>`).join('')
        : '<div class="ce-tip">没有可检查的内容，请先生成角色卡或世界书。</div>';

    box.innerHTML = `
        <div class="ce-pane">
            <div class="ce-section">
                <label class="ce-label">选择检查项</label>
                <div class="ce-rowline"><button type="button" class="menu_button" id="ce_check_run">开始自检</button>
                    <span id="ce_check_msg" class="ce-msg"></span></div>
                <div class="ce-checklist" id="ce_checklist">${listHtml}</div>
                <div class="ce-log" id="ce_check_log"></div>
            </div>
            <div class="ce-section">
                <label class="ce-label">自检结果</label>
                <textarea id="ce_check_out" class="text_pole" rows="12" placeholder="自检结果会显示在这里…"></textarea>
                <div class="ce-rowline"><button type="button" class="menu_button" id="ce_check_copy">复制</button></div>
            </div>
        </div>`;

    $('ce_check_run').addEventListener('click', async () => {
        const picked = [];
        box.querySelectorAll('.ce_check_item').forEach((cb) => {
            if (cb.checked) picked.push(items[Number(cb.dataset.i)]);
        });
        if (!picked.length) { flash('ce_check_msg', '请先勾选要检查的项', true); return; }
        flash('ce_check_msg', '检查中…');
        clearLog('ce_check_log');
        try {
            const text = await extras.selfCheck({
                items: picked,
                onItem: (cur, total, label, partial) => {
                    flash('ce_check_msg', `${cur}/${total} · ${label}`);
                    $('ce_check_out').value = partial;
                },
            });
            $('ce_check_out').value = text;
            flash('ce_check_msg', '完成');
        } catch (e) { flash('ce_check_msg', '失败：' + e.message, true); }
    });
    $('ce_check_copy').addEventListener('click', () => copyText($('ce_check_out').value, 'ce_check_msg'));
}

function splitCards(text) {
    const out = [];
    if (!text || !text.trim()) return out;
    const parts = text.split(/# =+\s*(.+?)\s*=+\n/);
    if (parts.length <= 1) return [{ label: '角色卡', name: '', content: text }];
    for (let i = 1; i < parts.length; i += 2) {
        const name = parts[i];
        const body = parts[i + 1] || '';
        out.push({ label: name, name, content: name + ':\n' + body });
    }
    return out;
}

/* ============ Tab 9：历史 ============ */

export function renderHistoryTab(box, rerender) {
    const hist = extras.getHistory();
    const listHtml = hist.length
        ? hist.map((h, i) => `<div class="ce-hist-item">
            <span>${escapeHtml(h.title || '')}</span>
            <span class="ce-faint">${escapeHtml(h.time || '')}</span>
            <button type="button" class="menu_button ce_hist_view" data-i="${i}">查看</button></div>`).join('')
        : '<div class="ce-tip">暂无历史记录。</div>';

    box.innerHTML = `
        <div class="ce-pane">
            <div class="ce-section">
                <label class="ce-label">历史记录</label>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_hist_clear">清空全部</button>
                    <span id="ce_hist_msg" class="ce-msg"></span>
                </div>
                <div class="ce-histlist">${listHtml}</div>
            </div>
        </div>`;

    box.querySelectorAll('.ce_hist_view').forEach((btn) => {
        btn.addEventListener('click', () => {
            const rec = extras.getHistory()[Number(btn.dataset.i)];
            if (!rec) return;
            state.cardText = rec.text || '';
            if (rerender) rerender('card');
            toast('已读回角色卡页');
        });
    });
    $('ce_hist_clear').addEventListener('click', () => {
        extras.clearHistory();
        if (rerender) rerender('history');
        flash('ce_hist_msg', '已清空');
    });
}
