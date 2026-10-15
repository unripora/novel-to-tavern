/**
 * ui-card.js —— 「角色卡」Tab（生成 / 预览 / 导入酒馆）
 */

import { flash, logTo, clearLog, stripFence, stripThink } from './util.js';
import { settings, persist } from './store.js';
import * as scan from './scan.js';
import * as extras from './extras.js';
import * as writer from './card-writer.js';
import { generate } from './generate.js';
import { DEFAULT_TPL, buildStatPanelBlock, buildStageHeader } from './prompts.js';
import * as timeline from './timeline.js';
import { openCardPreview as openCardPreviewPanel } from './ui-card-preview.js';
import { $, state, escapeHtml, stopRun, saveProducts } from './ui-context.js';
import * as stBridge from './st-bridge.js';

export function renderCardTab(box) {
    const tpls = state.templates.map((t, i) =>
        `<option value="${i}" ${i === state.curTpl ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
    box.innerHTML = `
        <div class="ce-pane">
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
                    <label>已选角色：<span id="ce_sel_names">${escapeHtml(state.selectedNames.join('、') || '（无，去「角色」页选择）')}</span></label>
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
                    <button type="button" class="menu_button" id="ce_stop" style="display:none">停止</button>
                    <span id="ce_gen_msg" class="ce-msg"></span>
                </div>
            </div>
            <div class="ce-section">
                <label class="ce-label">生成结果</label>
                <div class="ce-log" id="ce_gen_log"></div>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_pv_all">全部导入酒馆</button>
                    <button type="button" class="menu_button" id="ce_export_all">导出全部 .json</button>
                    <button type="button" class="menu_button" id="ce_cards_clear">清空结果</button>
                    <span id="ce_cards_msg" class="ce-msg"></span>
                </div>
                <div id="ce_card_list" class="ce-cardlist"></div>
                <textarea id="ce_output" class="text_pole" rows="8" placeholder="生成的角色卡会显示在这里（合并视图，可编辑）…"></textarea>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_preview">预览 / 导入酒馆</button>
                    <button type="button" class="menu_button" id="ce_export">导出 .json</button>
                    <button type="button" class="menu_button" id="ce_cont">继续续写</button>
                    <span id="ce_out_msg" class="ce-msg"></span>
                </div>
                <div class="ce-preview" id="ce_card_preview" style="display:none"></div>
            </div>
        </div>`;

    bindTemplateUI();
    bindStatPanelUI();
    bindTimelineUI();
    $('ce_output').value = state.cardText;
    $('ce_output').addEventListener('input', (e) => { state.cardText = e.target.value; saveProducts(); });

    $('ce_gen').addEventListener('click', runGenerate);
    $('ce_stop').addEventListener('click', stopRun);
    $('ce_preview').addEventListener('click', () => {
        // 单张预览：优先预览列表中最后一张（最近生成），无列表则用合并文本
        const n = (state.cardGroups || []).length;
        openCardPreview(n ? n - 1 : undefined);
    });
    $('ce_export').addEventListener('click', () => {
        const card = writer.parseCard(state.cardText, { name: state.selectedNames[0] });
        writer.exportCardJson(card);
        flash('ce_out_msg', '已导出 .json');
    });
    $('ce_cont').addEventListener('click', continueGenerate);
    $('ce_pv_all').addEventListener('click', importAllCards);
    $('ce_export_all').addEventListener('click', exportAllCards);
    $('ce_cards_clear').addEventListener('click', clearCards);
    renderCardList();
}

/** 渲染角色卡分组列表：每张卡可编辑 / 导入 / 导出 */
function renderCardList() {
    const box = $('ce_card_list');
    if (!box) return;
    const list = state.cardGroups || [];
    if (!list.length) { box.innerHTML = '<span class="ce-faint">（暂无卡片，先点「生成角色卡」）</span>'; return; }
    box.innerHTML = list.map((c, i) => `
        <div class="ce-cardgroup" data-idx="${i}">
            <div class="ce-cardgroup-head">
                <input type="text" class="text_pole ce_card_title" style="flex:1" value="${escapeHtml(c.name || '')}" data-idx="${i}" placeholder="角色卡名字">
                <button type="button" class="menu_button ce_card_edit" data-idx="${i}">编辑</button>
                <button type="button" class="menu_button ce_card_import" data-idx="${i}">导入酒馆</button>
                <button type="button" class="menu_button ce_card_export" data-idx="${i}">导出</button>
                <button type="button" class="menu_button ce_card_del" data-idx="${i}">删除</button>
            </div>
        </div>`).join('');

    box.querySelectorAll('.ce_card_title').forEach((inp) => {
        inp.addEventListener('input', (e) => {
            const i = Number(e.target.dataset.idx);
            if (state.cardGroups[i]) { state.cardGroups[i].name = e.target.value; saveProducts(); }
        });
    });
    box.querySelectorAll('.ce_card_edit').forEach((b) => b.addEventListener('click', () => editCardPopup(Number(b.dataset.idx))));
    box.querySelectorAll('.ce_card_import').forEach((b) => b.addEventListener('click', () => importOneCard(Number(b.dataset.idx))));
    box.querySelectorAll('.ce_card_export').forEach((b) => b.addEventListener('click', () => exportOneCard(Number(b.dataset.idx))));
    box.querySelectorAll('.ce_card_del').forEach((b) => b.addEventListener('click', () => {
        const i = Number(b.dataset.idx);
        state.cardGroups.splice(i, 1);
        state.cardText = state.cardGroups.map((c) => c.text).join('\n\n\n');
        $('ce_output').value = state.cardText;
        saveProducts(); renderCardList();
    }));
}

/** 弹窗编辑单张角色卡（完整文本） */
async function editCardPopup(idx) {
    const c = state.cardGroups[idx];
    if (!c) return;
    const ok = await stBridge.popupForm({
        title: '编辑角色卡：' + (c.name || ''),
        bodyHtml: '<textarea id="ce_ed_card" class="text_pole" rows="16" style="width:100%">' + escapeHtml(c.text || '') + '</textarea>',
        onOpen: (root) => { const t = root.querySelector('#ce_ed_card'); if (t) t.focus(); },
    });
    if (!ok) return;
    const el = document.getElementById('ce_ed_card');
    const text = el ? el.value : c.text;
    c.text = text;
    // 名字以标题框为准；若为空则尝试从文本解析
    if (!c.name) c.name = writer.parseCard(text, {}).name || c.name;
    state.cardText = state.cardGroups.map((x) => x.text).join('\n\n\n');
    $('ce_output').value = state.cardText;
    saveProducts(); renderCardList();
    flash('ce_cards_msg', '已更新卡片');
}

/** 导入单张卡 */
async function importOneCard(idx) {
    const c = state.cardGroups[idx];
    if (!c) return;
    const card = writer.parseCard(c.text, { name: c.name });
    flash('ce_cards_msg', '导入中…', false, { persist: true });
    const res = await writer.writeCharacterToTavern(card, {
        onLog: (m, e) => logTo('ce_gen_log', '[导入] ' + m, e ? 'e' : ''),
    });
    flash('ce_cards_msg', res.message, !res.ok);
    if (res.ok) toast('已导入：' + card.name);
}

/** 全部导入 */
async function importAllCards() {
    const list = state.cardGroups || [];
    if (!list.length) { flash('ce_cards_msg', '没有卡片可导入', true); return; }
    flash('ce_cards_msg', '全部导入中…', false, { persist: true });
    let okN = 0;
    for (let i = 0; i < list.length; i++) {
        const card = writer.parseCard(list[i].text, { name: list[i].name });
        const res = await writer.writeCharacterToTavern(card, {
            onLog: (m, e) => logTo('ce_gen_log', '[导入] ' + m, e ? 'e' : ''),
        });
        if (res.ok) okN++;
    }
    flash('ce_cards_msg', `导入完成：成功 ${okN}/${list.length}`);
}

/** 导出单张卡 */
function exportOneCard(idx) {
    const c = state.cardGroups[idx];
    if (!c) return;
    writer.exportCardJson(writer.parseCard(c.text, { name: c.name }));
}

/** 导出全部卡（逐张下载） */
function exportAllCards() {
    const list = state.cardGroups || [];
    if (!list.length) { flash('ce_cards_msg', '没有卡片可导出', true); return; }
    list.forEach((c) => writer.exportCardJson(writer.parseCard(c.text, { name: c.name })));
    flash('ce_cards_msg', `已导出 ${list.length} 张 .json`);
}

/** 清空结果 */
function clearCards() {
    state.cardGroups = []; state.cardText = '';
    $('ce_output').value = '';
    saveProducts(); renderCardList();
    flash('ce_cards_msg', '已清空');
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

    /** 每完成一张：入列表 + 刷新合并视图 */
    const pushCard = (name, text) => {
        state.cardGroups.push({ name, text });
        state.cardText = state.cardGroups.map((c) => c.text).join('\n\n\n');
        $('ce_output').value = state.cardText;
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
                        onText: (t) => { $('ce_output').value = state.cardText + '\n\n\n' + t; },
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
    flash('ce_gen_msg', signal.aborted ? '已停止' : `生成完成（${state.cardGroups.length} 张）`);
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

async function continueGenerate() {
    if (!state.cardText) { flash('ce_out_msg', '还没有内容', true); return; }
    flash('ce_out_msg', '续写中…');
    const cont = '\n\n（请从上面中断处直接继续，不要重复已写内容。）';
    try {
        const raw = await generate([{ role: 'user', content: state.cardText + cont }], {
            useStream: !!settings().useStream, maxCont: 2,
            onText: (t) => { $('ce_output').value = state.cardText + '\n' + t; },
        });
        state.cardText = state.cardText + '\n' + stripThink(stripFence(raw)).trim();
        $('ce_output').value = state.cardText;
        saveProducts();
        flash('ce_out_msg', '续写完成');
    } catch (e) {
        flash('ce_out_msg', '续写失败：' + e.message, true);
    }
}

function openCardPreview() {
    openCardPreviewPanel();
}
