/**
 * ui-card.js —— 「角色卡」Tab（生成 / 预览 / 导入酒馆）
 */

import { flash, logTo, clearLog, stripFence, stripThink } from './util.js';
import { settings, persist } from './store.js';
import * as scan from './scan.js';
import * as extras from './extras.js';
import * as writer from './card-writer.js';
import { generate } from './generate.js';
import { DEFAULT_TPL, ENSEMBLE_TPL, ENSEMBLE_TPL_NAME, buildStatPanelBlock, buildStageHeader } from './prompts.js';
import * as timeline from './timeline.js';
import { popupForm } from './st-bridge.js';
import { $, state, escapeHtml, stopRun, saveProducts } from './ui-context.js';

export function renderCardTab(box) {
    const tpls = state.templates.map((t, i) =>
        `<option value="${i}" ${i === state.curTpl ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
    box.innerHTML = `
        <div class="ce-pane">
            <div class="ce-section">
                <label class="ce-label">角色（点击圆角矩形选择，用于生成；可多选）</label>
                <div class="ce-rowline">
                    <input type="text" id="ce_manual" class="text_pole" style="flex:1" placeholder="手动添加角色，多个用逗号/空格分隔">
                    <button type="button" class="menu_button" id="ce_add_names">添加</button>
                    <button type="button" class="menu_button" id="ce_scan">扫描全书</button>
                    <button type="button" class="menu_button" id="ce_merge">合并所选</button>
                    <button type="button" class="menu_button" id="ce_clear_chars">清空列表</button>
                    <span id="ce_scan_msg" class="ce-msg"></span>
                </div>
                <div class="ce-log" id="ce_scan_log"></div>
                <div class="ce-charlist" id="ce_charlist"></div>
            </div>
            <div class="ce-section">
                <label class="ce-label">角色卡模板</label>
                <div class="ce-rowline">
                    <select id="ce_tpl_sel" class="text_pole" style="flex:1">${tpls}</select>
                    <button type="button" class="menu_button" id="ce_tpl_toggle">显示/编辑</button>
                </div>
                <textarea id="ce_tpl_editor" class="text_pole" rows="10" style="display:none"></textarea>
                <div class="ce-rowline" id="ce_tpl_ops" style="display:none">
                    <button type="button" class="menu_button" id="ce_tpl_new">新建</button>
                    <button type="button" class="menu_button" id="ce_tpl_save">保存</button>
                    <button type="button" class="menu_button" id="ce_tpl_reset">恢复默认</button>
                    <button type="button" class="menu_button" id="ce_tpl_del">删除</button>
                    <span id="ce_tpl_msg" class="ce-msg"></span>
                </div>
            </div>
            <div class="ce-section">
                <label class="ce-label">生成设置</label>
                <div class="ce-rowline">
                    <label>已选角色：<span id="ce_sel_names">${escapeHtml(state.selectedNames.join('、') || '（无，请在上方角色区点击选择）')}</span></label>
                </div>
                <div class="ce-rowline">
                    <label>详细程度</label>
                    <select id="ce_detail" class="text_pole">
                        <option value="concise">精简</option>
                        <option value="medium" selected>适中</option>
                        <option value="rich">详尽</option>
                    </select>
                    <label class="checkbox_label"><input type="checkbox" id="ce_nsfw"> 含 NSFW</label>
                    <label class="checkbox_label"><input type="checkbox" id="ce_full_ctx"> 用全文</label>
                </div>
                <div class="ce-rowline">
                    <label class="checkbox_label"><input type="checkbox" id="ce_stat_panel"> 数值面板模式</label>
                    <span class="ce-faint">开启后在角色卡末尾追加数值面板（含 1-10 强度评分）</span>
                </div>
                <div id="ce_stat_box" style="display:none">
                    <div class="ce-rowline">
                        <input type="text" id="ce_stat_fields" class="text_pole"
                            placeholder="数值字段（留空由 AI 依作品类型决定），如：等级/HP/MP/装备/技能">
                    </div>
                    <div class="ce-rowline">
                        <input type="text" id="ce_stat_refs" class="text_pole"
                            placeholder="参考数值（可空），如：等级 75 · HP 1200">
                    </div>
                </div>
                <div class="ce-rowline">
                    <label>时间线模式</label>
                    <select id="ce_tl_mode" class="text_pole">
                        <option value="off">不使用（整本抽取）</option>
                        <option value="single">单卡分阶段（一张卡内含各篇章）</option>
                        <option value="split">按篇章拆多卡</option>
                    </select>
                    <span id="ce_tl_hint" class="ce-faint"></span>
                </div>
                <div class="ce-rowline" id="ce_tl_pick_row" style="display:none">
                    <label>限定篇章</label>
                    <select id="ce_tl_pick" class="text_pole"><option value="">（全部篇章）</option></select>
                </div>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_gen">生成角色卡</button>
                    <button type="button" class="menu_button" id="ce_gen_ensemble">生成多人卡</button>
                    <button type="button" class="menu_button" id="ce_stop" style="display:none">停止</button>
                    <span id="ce_gen_msg" class="ce-msg"></span>
                </div>
                <p class="ce-faint" style="margin:4px 0 0">
                    多人卡：把所选的多个角色合成**一张**卡（旁白主导、角色随剧情登场），整张卡只用一个卡名。
                </p>
            </div>
            <div class="ce-section">
                <label class="ce-label">生成结果</label>
                <div class="ce-log" id="ce_gen_log"></div>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_import_sel">导入酒馆（选中）</button>
                    <button type="button" class="menu_button" id="ce_export_sel">导出 .json（选中）</button>
                    <span id="ce_cards_msg" class="ce-msg"></span>
                </div>
                <div id="ce_card_list" class="ce-cardlist"></div>
                <div id="ce_card_edit_box" style="display:none">
                    <label class="ce-label">卡片预览 / 编辑（点上方圆角矩形切换）</label>
                    <div class="ce-rowline">
                        <input type="text" id="ce_card_name" class="text_pole" style="flex:1" placeholder="角色卡名字">
                    </div>
                    <textarea id="ce_card_text" class="text_pole" rows="12" placeholder="该角色的角色卡内容，可直接编辑…"></textarea>
                    <div class="ce-rowline">
                        <button type="button" class="menu_button" id="ce_card_cont">继续续写</button>
                        <span id="ce_card_msg" class="ce-msg"></span>
                    </div>
                </div>
            </div>
        </div>`;

    bindTemplateUI();
    bindStatPanelUI();
    bindTimelineUI();
    bindCharsArea();

    $('ce_gen').addEventListener('click', runGenerate);
    $('ce_gen_ensemble').addEventListener('click', runGenerateEnsemble);
    $('ce_stop').addEventListener('click', stopRun);
    $('ce_import_sel').addEventListener('click', importSelectedCards);
    $('ce_export_sel').addEventListener('click', exportSelectedCards);

    // 卡片预览/编辑框绑定
    $('ce_card_name').addEventListener('input', (e) => {
        const i = state.cardViewIdx;
        if (i != null && state.cardGroups[i]) { state.cardGroups[i].name = e.target.value; saveProducts(); renderCardList(); }
    });
    $('ce_card_text').addEventListener('input', (e) => {
        const i = state.cardViewIdx;
        if (i != null && state.cardGroups[i]) { state.cardGroups[i].text = e.target.value; state.cardText = groupsText(); saveProducts(); }
    });
    $('ce_card_cont').addEventListener('click', continueCard);

    renderCardList();
}

/* ==================== 角色选择区（原「角色」Tab 融合） ==================== */

function bindCharsArea() {
    if (!$('ce_charlist')) return;
    renderCharChips();

    $('ce_add_names').addEventListener('click', () => {
        const raw = $('ce_manual').value.trim();
        if (!raw) return;
        const names = raw.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
        const list = scan.getCharacters();
        let added = 0;
        for (const nm of names) {
            if (list.some((c) => c.name === nm)) continue;
            list.push({ name: nm, role: '（手动添加）', count: 0, aliases: [] });
            if (!state.selectedNames.includes(nm)) state.selectedNames.push(nm);
            added++;
        }
        scan.setCharacters(list);
        $('ce_manual').value = '';
        renderCharChips();
        flash('ce_scan_msg', added ? '已添加 ' + added + ' 个' : '没有新增');
    });

    $('ce_clear_chars').addEventListener('click', () => {
        scan.clearCharacters();
        state.selectedNames = [];
        renderCharChips();
    });

    $('ce_merge').addEventListener('click', () => {
        if (state.selectedNames.length < 2) { flash('ce_scan_msg', '请至少选两个角色', true); return; }
        const names = [...state.selectedNames];
        const main = names[0];
        const list = scan.getCharacters();
        const target = list.find((c) => c.name === main);
        if (!target) return;
        const others = names.slice(1);
        const aliasMeta = {};
        others.forEach((n) => {
            const o = list.find((c) => c.name === n);
            if (o) {
                target.aliases = (target.aliases || []).concat(o.aliases || [], [n]);
                target.count = (target.count || 0) + (o.count || 0);
                aliasMeta[n] = o.count || 0;
            }
        });
        target.aliases = [...new Set(target.aliases.filter((x) => x !== main))];
        target.aliasMeta = aliasMeta;
        scan.setCharacters(list.filter((c) => !others.includes(c.name)));
        state.selectedNames = [main];
        renderCharChips();
        flash('ce_scan_msg', '已合并为「' + main + '」');
    });

    $('ce_scan').addEventListener('click', runScan);
}

/** 渲染角色圆角矩形（选中/未选中），选中即用于生成 */
function renderCharChips() {
    const box = $('ce_charlist');
    settings().selectedNames = state.selectedNames;
    persist();
    if (!box) return;
    const chars = scan.getCharacters();
    box.innerHTML = '';
    if (!chars.length) {
        box.innerHTML = '<div class="ce-tip">还没有角色。可手动添加，或点「扫描全书」。</div>';
        return;
    }
    chars.forEach((c) => {
        const on = state.selectedNames.includes(c.name);
        const d = document.createElement('div');
        d.className = 'ce-chip' + (on ? ' sel' : '');
        const alias = (c.aliases && c.aliases.length) ? ' · 别名: ' + c.aliases.join('、') : '';
        const src = c.count > 0 ? ('出现于 ' + c.count + ' 段') : '手动添加';
        d.innerHTML = `<div class="ce-chip-n">${escapeHtml(c.name)}</div>
            <div class="ce-chip-r">${escapeHtml(c.role || '')}</div>
            <div class="ce-chip-c">${escapeHtml(src + alias)}</div>`;
        d.addEventListener('click', () => {
            const i = state.selectedNames.indexOf(c.name);
            if (i >= 0) state.selectedNames.splice(i, 1);
            else state.selectedNames.push(c.name);
            renderCharChips();
        });
        box.appendChild(d);
    });
}

async function runScan() {
    const text = novel.getNovel().trim();
    if (!text) { flash('ce_scan_msg', '请先导入小说', true); return; }
    if (state.running) { stopRun(); return; }

    const s = settings();
    const chunk = Math.max(10000, Number(s.chunkSize) || 40000);
    const cap = Math.max(1, Number(s.scanCap) || 40);
    const chunks = [];
    for (let i = 0; i < text.length && chunks.length < cap; i += chunk) {
        chunks.push(text.slice(i, i + chunk));
    }

    state.running = true;
    state.controller = new AbortController();
    const signal = state.controller.signal;
    clearLog('ce_scan_log');

    const found = new Map();
    try {
        for (let i = 0; i < chunks.length; i++) {
            if (signal.aborted) break;
            flash('ce_scan_msg', `扫描 ${i + 1}/${chunks.length}…`, false, { persist: true });
            const prompt = buildScanPrompt(chunks[i]);
            let raw = '';
            try {
                raw = await generate(prompt, { signal, useStream: false, maxCont: settings().autoCont ? 3 : 0, logEl: 'ce_scan_log', label: `扫描第${i + 1}段` });
            } catch (e) {
                if (signal.aborted) break;
                logTo('ce_scan_log', `第 ${i + 1} 段失败：${e.message}`, 'e');
                continue;
            }
            const arr = extractNames(raw);
            arr.forEach((item) => {
                const nm = typeof item === 'string' ? item : item.name;
                if (!nm) return;
                const prev = found.get(nm) || { name: nm, role: '', count: 0, aliases: [] };
                prev.count += 1;
                if (item && item.role && !prev.role) prev.role = item.role;
                found.set(nm, prev);
            });
            logTo('ce_scan_log', `第 ${i + 1} 段：累计 ${found.size} 个角色`, 'g');
        }
    } finally {
        state.running = false;
    }

    const list = scan.getCharacters();
    found.forEach((v, k) => {
        if (!list.some((c) => c.name === k)) list.push(v);
    });
    scan.setCharacters(list);
    renderCharChips();
    logTo('ce_scan_log', signal.aborted ? '⏹ 已停止' : '✅ 所有任务已完成', 'g');
    flash('ce_scan_msg', signal.aborted ? '已停止' : `扫描完成，共 ${list.length} 个角色`);
}

function buildScanPrompt(chunk) {
    const sys = settings().sysPrefix ? settings().sysPrefix + '\n\n' : '';
    return sys + '请从下面的小说片段中提取出现的**人物角色**。\n'
        + '只输出 JSON 数组，每个元素形如 {"name":"角色名","role":"一句话身份说明"}。\n'
        + '只写确实出现的角色，不要编造，不要输出解释或代码块。\n\n=== 片段 ===\n' + chunk;
}

function extractNames(raw) {
    const t = stripThink(stripFence(raw));
    const start = t.indexOf('[');
    const end = t.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    try {
        const arr = JSON.parse(t.slice(start, end + 1));
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}

/* ==================== 结果列表（圆角矩形 + 预览编辑） ==================== */

/** 合并视图文本 */
function groupsText() {
    return (state.cardGroups || []).map((c) => c.text).join('\n\n\n');
}

/** 渲染结果圆角矩形：选中/未选中，选择状态存于 c.picked */
function renderCardList() {
    const box = $('ce_card_list');
    if (!box) return;
    const list = state.cardGroups || [];
    if (!list.length) {
        box.innerHTML = '<span class="ce-faint">（暂无卡片，先点「生成角色卡」）</span>';
        renderCardView();
        return;
    }
    box.innerHTML = list.map((c, i) => {
        const on = !!c.picked;
        const viewing = state.cardViewIdx === i;
        return `<div class="ce-chip card${on ? ' sel' : ''}${viewing ? ' view' : ''}" data-idx="${i}">
            <div class="ce-chip-n">${escapeHtml(c.name || '未命名')}</div>
            <div class="ce-chip-c">${on ? '已选中' : '未选中'}</div>
        </div>`;
    }).join('');
    box.querySelectorAll('.ce-chip.card').forEach((el) => {
        el.addEventListener('click', (e) => {
            const i = Number(el.dataset.idx);
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                // 修饰键：只切换选中，不切预览
                if (state.cardGroups[i]) state.cardGroups[i].picked = !state.cardGroups[i].picked;
            } else {
                // 普通点击：切换「预览目标」；同时默认把它设为选中
                state.cardViewIdx = (state.cardViewIdx === i) ? null : i;
                if (state.cardViewIdx === i && state.cardGroups[i]) state.cardGroups[i].picked = true;
            }
            saveProducts(); renderCardList();
        });
        el.addEventListener('dblclick', (e) => {
            // 双击：切换选中态
            e.preventDefault();
            const i = Number(el.dataset.idx);
            if (state.cardGroups[i]) state.cardGroups[i].picked = !state.cardGroups[i].picked;
            saveProducts(); renderCardList();
        });
    });
    renderCardView();
}

/** 渲染下方预览编辑框：只显示 state.cardViewIdx 指向的一张 */
function renderCardView() {
    const wrap = $('ce_card_edit_box');
    if (!wrap) return;
    const i = state.cardViewIdx;
    const c = (i != null && state.cardGroups[i]) ? state.cardGroups[i] : null;
    if (!c) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    $('ce_card_name').value = c.name || '';
    $('ce_card_text').value = c.text || '';
}

/** 当前选中的卡片下标列表 */
function pickedIdxs() {
    return (state.cardGroups || []).map((c, i) => (c.picked ? i : -1)).filter((i) => i >= 0);
}

/** 导入酒馆（选中的卡；无选中则提示） */
async function importSelectedCards() {
    const idxs = pickedIdxs();
    if (!idxs.length) { flash('ce_cards_msg', '请先点击圆角矩形选中要导入的角色卡', true); return; }
    flash('ce_cards_msg', `导入 ${idxs.length} 张中…`, false, { persist: true });
    let okN = 0;
    for (const i of idxs) {
        const c = state.cardGroups[i];
        const card = writer.parseCard(c.text, { name: c.name });
        const res = await writer.writeCharacterToTavern(card, {
            onLog: (m, e) => logTo('ce_gen_log', '[导入] ' + m, e ? 'e' : ''),
        });
        if (res.ok) okN++;
    }
    logTo('ce_gen_log', '✅ 所有任务已完成', 'g');
    flash('ce_cards_msg', `导入完成：成功 ${okN}/${idxs.length}` + (okN ? '' : ''));
}

/** 导出 .json（选中的卡） */
function exportSelectedCards() {
    const idxs = pickedIdxs();
    if (!idxs.length) { flash('ce_cards_msg', '请先点击圆角矩形选中要导出的角色卡', true); return; }
    idxs.forEach((i) => {
        const c = state.cardGroups[i];
        writer.exportCardJson(writer.parseCard(c.text, { name: c.name }));
    });
    logTo('ce_gen_log', '✅ 所有任务已完成', 'g');
    flash('ce_cards_msg', `已导出 ${idxs.length} 张 .json`);
}

/** 对当前预览的卡片续写 */
async function continueCard() {
    const i = state.cardViewIdx;
    const c = (i != null) ? state.cardGroups[i] : null;
    if (!c) { flash('ce_card_msg', '请先选择一张卡', true); return; }
    const cont = '\n\n（请从上面中断处直接继续，不要重复已写内容。）';
    flash('ce_card_msg', '续写中…');
    try {
        const raw = await generate([{ role: 'user', content: c.text + cont }], {
            useStream: !!settings().useStream, maxCont: 2,
            onText: (t) => { $('ce_card_text').value = c.text + '\n' + t; },
        });
        c.text = c.text + '\n' + stripThink(stripFence(raw)).trim();
        state.cardText = groupsText();
        $('ce_card_text').value = c.text;
        saveProducts();
        flash('ce_card_msg', '✅ 所有任务已完成');
    } catch (e) {
        flash('ce_card_msg', '续写失败：' + e.message, true);
    }
}

function bindStatPanelUI() {
    const cb = $('ce_stat_panel');
    const box = $('ce_stat_box');
    const fields = $('ce_stat_fields');
    const refs = $('ce_stat_refs');
    if (!cb) return;

    // 回填设置
    const s = settings();
    cb.checked = !!s.statPanelCard;
    fields.value = s.statPanelFields || '';
    refs.value = s.statPanelRefs || '';
    box.style.display = cb.checked ? 'block' : 'none';

    cb.addEventListener('change', () => {
        box.style.display = cb.checked ? 'block' : 'none';
        saveStatPanel();
    });
    fields.addEventListener('input', saveStatPanel);
    refs.addEventListener('input', saveStatPanel);

    function saveStatPanel() {
        const st = settings();
        st.statPanelCard = cb.checked;
        st.statPanelFields = fields.value;
        st.statPanelRefs = refs.value;
        persist();
    }
}

function bindTimelineUI() {
    const modeSel = $('ce_tl_mode');
    const pickRow = $('ce_tl_pick_row');
    const pick = $('ce_tl_pick');
    const hint = $('ce_tl_hint');
    if (!modeSel) return;

    const tl = timeline.getTimeline();
    const nodes = tl.nodes || [];

    // 回填篇章下拉
    pick.innerHTML = '<option value="">（全部篇章）</option>' +
        nodes.map((n, i) => `<option value="${i}">${escapeHtml(n.name)}</option>`).join('');

    // 回填模式
    modeSel.value = settings().tlMode || 'off';

    const refresh = () => {
        const m = modeSel.value;
        settings().tlMode = m;
        persist();
        pickRow.style.display = (m === 'off') ? 'none' : 'flex';
        if (m === 'off') hint.textContent = '';
        else if (!nodes.length) hint.textContent = '（尚未建立时间线，请去「时间线」页划分）';
        else if (m === 'single') hint.textContent = `将在卡内按 ${nodes.length} 个篇章分段`;
        else hint.textContent = `将为每个篇章各生成一张卡`;
    };
    refresh();
    modeSel.addEventListener('change', refresh);
}

function bindTemplateUI() {
    const sel = $('ce_tpl_sel');
    const editor = $('ce_tpl_editor');
    const ops = $('ce_tpl_ops');
    if (!sel) return;

    const load = () => {
        const t = state.templates[state.curTpl];
        editor.value = (t && t.text) || DEFAULT_TPL;
    };

    sel.addEventListener('change', () => {
        state.curTpl = Number(sel.value);
        settings().curTpl = state.templates[state.curTpl].name;
        persist();
        if (editor.style.display !== 'none') load();
    });

    $('ce_tpl_toggle').addEventListener('click', () => {
        const show = editor.style.display === 'none';
        editor.style.display = show ? 'block' : 'none';
        ops.style.display = show ? 'flex' : 'none';
        if (show) load();
    });
    $('ce_tpl_save').addEventListener('click', () => {
        state.templates[state.curTpl].text = editor.value;
        settings().templates = state.templates;
        persist();
        flash('ce_tpl_msg', '已保存模板');
    });
    $('ce_tpl_reset').addEventListener('click', () => {
        editor.value = DEFAULT_TPL;
        flash('ce_tpl_msg', '已恢复默认（记得点保存）');
    });
    $('ce_tpl_new').addEventListener('click', () => {
        const name = prompt('新模板名称：', '模板' + (state.templates.length + 1));
        if (!name) return;
        state.templates.push({ name: name.trim(), text: editor.value || DEFAULT_TPL });
        settings().templates = state.templates;
        persist();
        window.__ce_rerender('card');
    });
    $('ce_tpl_del').addEventListener('click', () => {
        if (state.templates.length <= 1) { flash('ce_tpl_msg', '至少保留一个模板', true); return; }
        if (!confirm('确认删除模板「' + state.templates[state.curTpl].name + '」？')) return;
        state.templates.splice(state.curTpl, 1);
        state.curTpl = 0;
        settings().templates = state.templates;
        persist();
        window.__ce_rerender('card');
    });
}

async function runGenerate() {
    if (!state.selectedNames.length) { flash('ce_gen_msg', '请先选择角色', true); return; }
    if (state.running) { stopRun(); return; }
    state.running = true;
    state.controller = new AbortController();
    const signal = state.controller.signal;
    $('ce_gen').style.display = 'none';
    $('ce_stop').style.display = 'inline-block';
    clearLog('ce_gen_log');

    const detail = $('ce_detail').value;
    const nsfw = $('ce_nsfw').checked;
    const fullCtx = $('ce_full_ctx').checked;
    const tmpl = state.templates[state.curTpl]?.text || DEFAULT_TPL;
    const statPanel = $('ce_stat_panel')?.checked
        ? { fields: $('ce_stat_fields')?.value || '', refs: $('ce_stat_refs')?.value || '' }
        : null;
    // 时间线模式：off / single / split
    const tlMode = $('ce_tl_mode')?.value || 'off';
    const tlNodes = timeline.getTimeline().nodes || [];
    const pickIdx = $('ce_tl_pick')?.value;
    const activeNodes = (tlMode !== 'off' && tlNodes.length)
        ? (pickIdx !== '' && pickIdx != null ? [tlNodes[Number(pickIdx)]] : tlNodes)
        : [];
    // 本次生成清空旧列表，队列式重新生成，每完成一张即时入列表
    state.cardGroups = [];
    renderCardList();

    /** 每完成一张：入列表（默认选中） + 刷新 */
    const pushCard = (name, text) => {
        state.cardGroups.push({ name, text, picked: true });
        state.cardText = groupsText();
        saveProducts();
        renderCardList();
    };

    try {
        for (const nm of state.selectedNames) {
            if (signal.aborted) break;

            if (!activeNodes.length) {
                // 模式 off：整本抽取
                flash('ce_gen_msg', '生成 ' + nm + '…', false, { persist: true });
                const cctx = scan.collectContext(nm, [], fullCtx);
                const prompt = buildCardPrompt(nm, tmpl, cctx, { detail, nsfw, statPanel });
                let raw = '';
                try {
                    raw = await generate(prompt, {
                        signal, useStream: !!settings().useStream,
                        maxCont: settings().autoCont ? 5 : 0,
                        logEl: 'ce_gen_log', label: nm,
                    });
                } catch (e) {
                    if (signal.aborted) break;
                    logTo('ce_gen_log', nm + ' 失败：' + e.message, 'e');
                    continue;
                }
                pushCard(nm, postProcessCard(stripThink(stripFence(raw)).trim(), nm));
                logTo('ce_gen_log', nm + ' 完成', 'g');
                continue;
            }

            if (tlMode === 'single') {
                // 单卡分阶段：遍历篇章，卡内按篇章分段，合成一张卡
                let whole = '';
                for (const node of activeNodes) {
                    if (signal.aborted) break;
                    flash('ce_gen_msg', `生成 ${nm} · ${node.name}…`, false, { persist: true });
                    const ctx = timeline.contextInNode(nm, scan.charNames(nm), node);
                    const prompt = buildStagePrompt(nm, tmpl, ctx, node, { detail, nsfw, statPanel });
                    let raw = '';
                    try {
                        raw = await generate(prompt, {
                            signal, useStream: !!settings().useStream,
                            maxCont: settings().autoCont ? 5 : 0, logEl: 'ce_gen_log', label: `${nm}·${node.name}`,
                        });
                    } catch (e) {
                        if (signal.aborted) break;
                        logTo('ce_gen_log', `${nm}·${node.name} 失败：${e.message}`, 'e');
                        continue;
                    }
                    whole += buildStageHeader(node.name, node.summary) + stripThink(stripFence(raw)).trim();
                    logTo('ce_gen_log', `${nm}·${node.name} 完成`, 'g');
                }
                if (whole) pushCard(nm, whole);
                continue;
            }

            // split：按篇章拆多卡，每篇章一张
            for (const node of activeNodes) {
                if (signal.aborted) break;
                const label = `${nm}（${node.name}）`;
                flash('ce_gen_msg', '生成 ' + label + '…', false, { persist: true });
                const ctx = timeline.contextInNode(nm, scan.charNames(nm), node);
                const prompt = buildStagePrompt(nm, tmpl, ctx, node, { detail, nsfw, statPanel });
                let raw = '';
                try {
                    raw = await generate(prompt, {
                        signal, useStream: !!settings().useStream,
                        maxCont: settings().autoCont ? 5 : 0, logEl: 'ce_gen_log', label,
                    });
                } catch (e) {
                    if (signal.aborted) break;
                    logTo('ce_gen_log', label + ' 失败：' + e.message, 'e');
                    continue;
                }
                pushCard(label, postProcessCard(stripThink(stripFence(raw)).trim(), nm));
                logTo('ce_gen_log', label + ' 完成', 'g');
            }
        }
    } finally {
        state.running = false;
        $('ce_gen').style.display = 'inline-block';
        $('ce_stop').style.display = 'none';
    }
    if (signal.aborted) {
        logTo('ce_gen_log', '⏹ 已停止', 'e');
        flash('ce_gen_msg', '已停止');
    } else {
        logTo('ce_gen_log', '✅ 所有任务已完成', 'g');
        flash('ce_gen_msg', `生成完成（${state.cardGroups.length} 张）`);
    }
    flash('ce_cards_msg', `共 ${state.cardGroups.length} 张卡`);

    if (state.cardText) {
        extras.saveHistory({
            id: Date.now(), type: 'card',
            time: new Date().toLocaleString(),
            title: '角色卡 · ' + state.selectedNames.join('、'),
            text: state.cardText,
        });
    }
}

/* ==================== 多人卡（旁白制，一张卡） ==================== */

/**
 * 多人卡：把所选的多个角色合成一张卡。
 * 卡人格 = 纯旁白（叙述/推进/引导，不替玩家决定、不冒充角色）；
 * 输出直接为 Character Card V2 字段的 JSON，便于 parseCard 解析。
 */
async function runGenerateEnsemble() {
    if (!state.selectedNames.length) { flash('ce_gen_msg', '请先选择角色（至少 1 个）', true); return; }
    if (state.running) { stopRun(); return; }

    const names = state.selectedNames.slice();
    // 卡名：弹框让用户填一个（留空自动拼）
    const autoName = names.join('、');
    let cardName = await askEnsembleName(autoName);
    if (cardName == null) return;            // 用户取消
    cardName = cardName.trim() || autoName;

    // 模板选择：默认用「多人卡（旁白制）」模板；若当前选中的是别的模板，让用户选
    const curTpl = state.templates[state.curTpl];
    const ensembleTpl = state.templates.find((t) => t.name === ENSEMBLE_TPL_NAME);
    let tmplText = (ensembleTpl && ensembleTpl.text) || ENSEMBLE_TPL;
    if (!curTpl || curTpl.name !== ENSEMBLE_TPL_NAME) {
        const pickEnsemble = await askEnsembleTemplate(curTpl ? curTpl.name : '（无）');
        if (pickEnsemble == null) return;    // 取消
        if (!pickEnsemble) {
            // 用户选择「跑当前选定的模板」
            tmplText = (curTpl && curTpl.text) || ENSEMBLE_TPL;
        }
    }

    state.running = true;
    state.controller = new AbortController();
    const signal = state.controller.signal;
    $('ce_gen').style.display = 'inline-block';
    $('ce_gen_ensemble').style.display = 'none';
    $('ce_stop').style.display = 'inline-block';
    clearLog('ce_gen_log');

    const detail = $('ce_detail').value;
    const nsfw = $('ce_nsfw').checked;
    const fullCtx = $('ce_full_ctx').checked;

    // cctx：各角色各自相关段落，拼接（过长由 collectContext 内部按上限裁剪）
    const cctx = names
        .map((nm) => scan.collectContext(nm, [], fullCtx))
        .join('\n\n========== 以上为一位角色的相关片段，以下为另一位 ==========\n\n');

    let raw = '';
    try {
        flash('ce_gen_msg', '生成多人卡「' + cardName + '」…', false, { persist: true });
        const prompt = buildEnsemblePrompt(names, cardName, cctx, { detail, nsfw, tmpl: tmplText });
        raw = await generate(prompt, {
            signal, useStream: !!settings().useStream,
            maxCont: settings().autoCont ? 5 : 0,
            logEl: 'ce_gen_log', label: '多人卡·' + cardName,
        });
    } catch (e) {
        if (!signal.aborted) logTo('ce_gen_log', '多人卡失败：' + e.message, 'e');
    } finally {
        state.running = false;
        $('ce_gen').style.display = 'inline-block';
        $('ce_gen_ensemble').style.display = 'inline-block';
        $('ce_stop').style.display = 'none';
    }

    if (signal.aborted) { logTo('ce_gen_log', '⏹ 已停止', 'e'); flash('ce_gen_msg', '已停止'); return; }
    const text = stripThink(stripFence(raw)).trim();
    if (!text) { logTo('ce_gen_log', '多人卡：未生成内容', 'e'); flash('ce_gen_msg', '未生成内容', true); return; }

    // 作为一张新卡**追加**进列表（不清空已有的单角色卡，复用列表/预览/导入逻辑）
    state.cardGroups = state.cardGroups || [];
    state.cardGroups.push({ name: cardName, text, picked: true });
    state.cardText = groupsText();
    state.cardViewIdx = state.cardGroups.length - 1;
    saveProducts();
    renderCardList();
    logTo('ce_gen_log', '✅ 多人卡「' + cardName + '」已生成（共 ' + state.cardGroups.length + ' 张）', 'g');
    flash('ce_gen_msg', '多人卡已生成');
    flash('ce_cards_msg', '共 ' + state.cardGroups.length + ' 张卡');

    extras.saveHistory({
        id: Date.now(), type: 'card',
        time: new Date().toLocaleString(),
        title: '多人卡 · ' + cardName,
        text,
    });
}

/** 弹框询问多人卡卡名；返回 null 表示取消，返回字符串（可空）表示确认 */
async function askEnsembleName(autoName) {
    const html =
        '<p class="ce-faint" style="margin:0 0 8px">给这张多人卡起一个卡名（整张卡只用这个名字）。留空则用：' +
        escapeHtml(autoName) + '</p>' +
        '<input type="text" id="ce_ens_name" class="text_pole" style="width:100%" placeholder="' +
        escapeHtml(autoName) + '">';
    let inputEl = null;             // 弹窗关闭后 DOM 可能被移除，先存引用
    const ok = await popupForm({
        title: '多人卡 · 卡名',
        bodyHtml: html,
        okLabel: '生成',
        cancelLabel: '取消',
        onOpen: (root) => {
            inputEl = root.querySelector('#ce_ens_name');
            if (inputEl) { inputEl.value = autoName; inputEl.focus(); inputEl.select(); }
        },
    });
    if (!ok) return null;
    return inputEl ? String(inputEl.value || '') : autoName;
}

/**
 * 弹窗：当前选中的不是多人卡模板时，让用户选择跑哪个模板。
 * @param {string} curName 当前选中的模板名
 * @returns {Promise<null|boolean>} null=取消；true=用多人卡模板；false=用当前选定模板
 */
async function askEnsembleTemplate(curName) {
    const html =
        '<p class="ce-faint" style="margin:0 0 8px">你当前选中的角色卡模板是「' + escapeHtml(curName) + '」，' +
        '它不是多人卡专用模板。请选择本次多人卡要使用的模板：</p>' +
        '<label class="checkbox_label" style="display:block;margin:6px 0">' +
        '<input type="radio" name="ce_ens_tpl" value="ensemble" checked> ' +
        '使用多人卡模板「' + escapeHtml(ENSEMBLE_TPL_NAME) + '」（推荐）</label>' +
        '<label class="checkbox_label" style="display:block;margin:6px 0">' +
        '<input type="radio" name="ce_ens_tpl" value="current"> ' +
        '使用当前选定的模板「' + escapeHtml(curName) + '」</label>';
    let radios = [];
    const ok = await popupForm({
        title: '多人卡 · 选择模板',
        bodyHtml: html,
        okLabel: '确定',
        cancelLabel: '取消',
        onOpen: (root) => { radios = [...root.querySelectorAll('input[name="ce_ens_tpl"]')]; },
    });
    if (!ok) return null;
    const chosen = radios.find((r) => r.checked);
    return !chosen || chosen.value === 'ensemble';
}

/**
 * 多人卡提示词：渲染多人卡模板（整段 prompt）。
 * @param {string[]} names 所选角色名
 * @param {string} cardName 卡名（整张卡一个名字）
 * @param {string} cctx 各角色相关片段拼接
 * @param {{detail?:string, nsfw?:boolean, tmpl?:string}} opts
 */
function buildEnsemblePrompt(names, cardName, cctx, { detail, nsfw, tmpl } = {}) {
    const tpl = String(tmpl || ENSEMBLE_TPL);

    const list = names.map((n) => '· ' + n).join('\n');
    const detailRule = detail === 'concise'
        ? '· 【篇幅：精简】各字段尽量简短，角色精要每人 2~4 句。\n'
        : detail === 'rich'
            ? '· 【篇幅：详尽】忠于原文的前提下尽量丰富具体。\n'
            : '· 【篇幅：适中】各字段详略得当。\n';
    const nsfwRule = nsfw
        ? '· 若原文涉及成人向内容，只依据原文，不编造。\n'
        : '· 不要输出任何性相关内容。\n';

    // 只替换具名占位符，保留 {{char}} 等其它花括号写法
    const body = tpl
        .replace(/\{characters\}/g, list)
        .replace(/\{cardName\}/g, cardName)
        .replace(/\{detail\}/g, detailRule)
        .replace(/\{nsfw\}/g, nsfwRule)
        .replace(/\{text\}/g, cctx);

    // 输出**纯字符串** prompt（而非消息数组）：
    // 消息数组仅在 generateRaw 的对象形式下有效，而部分环境对象形式会失败、
    // 回退到位置参数时数组无法被酒馆正确解析（导致 AI 收不到内容）。字符串在三种回退下都稳。
    const sys = '你是严谨的角色卡抽取助手，负责把多个角色整合成一张「多人卡」（核心人格为旁白/GM）。只依据原文，绝不臆造；严禁张冠李戴；严禁 OOC。';
    const sysPrefix = settings().sysPrefix ? settings().sysPrefix + '\n\n' + sys : sys;
    return sysPrefix + '\n\n' + body;
}

function buildCardPrompt(nm, tmpl, cctx, { detail, nsfw, statPanel }) {
    const sys = '你是严谨的角色卡抽取助手。工作原则：只依据原文，绝不臆造；动笔前先在思考中理清该角色从头到尾的完整生平与性格，确认哪些经历真正属于 TA；严禁把别的角色的经历或设定安到该角色身上；严禁 OOC；也绝不用放之四海皆准的空泛套话敷衍。';
    const withSys = settings().sysPrefix ? settings().sysPrefix + '\n\n' + sys : sys;
    const nsfwRule = nsfw
        ? '· 模板里若有 NSFW_information 段落，只依据原文填写，原文未涉及则填「（原文未提及）」，严禁编造。'
        : '· 若模板含 NSFW_information 段落，请整段省略，且不要输出任何性相关内容。';
    const detailRule = detail === 'concise'
        ? '· 【篇幅：精简】每个字段尽量简短，列表类字段只保留最重要的 2~3 项。'
        : detail === 'rich' ? '· 【篇幅：详尽】忠于原文的前提下尽量丰富具体。' : '';
    // 数值面板：开启时在模板末尾追加面板提示词
    const statBlock = statPanel ? buildStatPanelBlock({ fields: statPanel.fields, refValues: statPanel.refs }) : '';
    const user =
        '请为角色「' + nm + '」抽取信息，填入下面的模板。\n\n要求：\n' +
        '· 【先分析后填卡】动笔前先在思考中梳理该角色完整生平脉络与性格，确认哪些属于 TA，再填。\n' +
        '· 【严禁张冠李戴】只写属于「' + nm + '」的经历与设定。\n' +
        '· 【严禁 OOC】所有描写必须与原文一致。\n' +
        '· 只依据原文，可合理推断但绝不编造。\n' +
        (detailRule ? detailRule + '\n' : '') +
        '· 经历/背景类字段要写出原文里具体的事件、时间点、转折、关系变化，覆盖全程。\n' +
        '· 顶层 key 用该角色的中文名，不要写 char_name。\n' +
        nsfwRule + '\n' +
        statBlock +
        '\n· 最终只输出填好的角色卡内容，不要分析过程，不要代码块。\n\n' +
        '模板：\n' + tmpl + '\n\n=== 小说文本（与该角色相关）===\n' + cctx;
    return [{ role: 'system', content: withSys }, { role: 'user', content: user }];
}

/**
 * 分阶段角色卡提示词（时间线模式）
 * 限定只写该角色在「指定篇章」内的状态，避免跨篇章串线
 */
function buildStagePrompt(nm, tmpl, cctx, node, { detail, nsfw, statPanel }) {
    const sys = '你是严谨的角色卡抽取助手。工作原则：只依据原文，绝不臆造；动笔前先在思考中理清该角色在**指定篇章**内的状态与经历，确认哪些属于 TA；严禁把其他篇章或其他角色的经历安进来；严禁 OOC。';
    const withSys = settings().sysPrefix ? settings().sysPrefix + '\n\n' + sys : sys;
    const nsfwRule = nsfw
        ? '· 模板里若有 NSFW_information 段落，只依据原文填写，原文未涉及则填「（原文未提及）」，严禁编造。'
        : '· 若模板含 NSFW_information 段落，请整段省略，且不要输出任何性相关内容。';
    const detailRule = detail === 'concise'
        ? '· 【篇幅：精简】每个字段尽量简短，列表类字段只保留最重要的 2~3 项。'
        : detail === 'rich' ? '· 【篇幅：详尽】忠于原文的前提下尽量丰富具体。' : '';
    const statBlock = statPanel ? buildStatPanelBlock({ fields: statPanel.fields, refValues: statPanel.refs }) : '';
    const stageLine = '· 【限定篇章】本次只写该角色在《' + node.name + '》这一篇章内的状态与经历' +
        (node.summary ? ('（该篇章概要：' + node.summary + '）') : '') +
        '。年龄、身份、能力、人际关系、是否在场等都要**以该篇章为准**；' +
        '严禁把其他篇章（更早或更晚）的经历、状态写进来，也不要剧透后续篇章。\n';
    const user =
        '请为角色「' + nm + '」抽取信息，填入下面的模板。\n\n要求：\n' +
        stageLine +
        '· 【严禁张冠李戴】只写属于「' + nm + '」在指定篇章内的经历与设定。\n' +
        '· 【严禁 OOC】所有描写必须与原文一致。\n' +
        '· 只依据原文，可合理推断但绝不编造。\n' +
        (detailRule ? detailRule + '\n' : '') +
        '· 经历/背景类字段要写出该篇章内具体的事件、时间点、转折、关系变化。\n' +
        '· 顶层 key 用该角色的中文名，不要写 char_name。\n' +
        nsfwRule + '\n' +
        statBlock +
        '\n· 最终只输出填好的角色卡内容，不要分析过程，不要代码块。\n\n' +
        '模板：\n' + tmpl + '\n\n=== 小说文本（《' + node.name + '》内与该角色相关的段落）===\n' + cctx;
    return [{ role: 'system', content: withSys }, { role: 'user', content: user }];
}

function postProcessCard(text, fallback) {
    let name = (fallback || '').trim();
    const m = text.match(/Chinese name:\s*(.+)/);
    if (m) {
        const v = m[1].trim().replace(/^["']|["']$/g, '');
        if (v && !/原文未提及/.test(v)) name = v;
    }
    if (!name) return text;
    let key = name.trim();
    if (/[:#\{\}\[\]&\*!\|>%@`"'\n,]/.test(key)) key = '"' + key.replace(/"/g, '\\"') + '"';
    return text.replace(/^\s*char_name\s*:/, key + ':');
}

export default { renderCardTab };
