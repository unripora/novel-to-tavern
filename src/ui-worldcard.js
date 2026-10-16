/**
 * ui-worldcard.js —— 「角色 & 世界」Tab
 *
 * 三区块：
 *  1. 角色 → 世界书条目：选角色 → AI 生成角色条目 → 追加进目标世界书（不重跑已有）
 *  2. 绑定管理：把世界书绑到当前角色（主本 / 附属）
 *  3. 打包导出：把某张卡 + 主世界书内嵌为一张完整卡
 *
 * 复用：worldbook.genCharEntries / writeWorldbookToTavern、persist 落盘、card-writer 打包。
 */

import { flash, logTo, clearLog } from './util.js';
import * as scan from './scan.js';
import * as novel from './novel.js';
import * as worldbook from './worldbook.js';
import * as persistMod from './persist.js';
import * as writer from './card-writer.js';
import { bindPrimaryWorldbook, unbindPrimaryWorldbook, linkExtraWorldbook } from './st-bridge.js';
import { $, state, escapeHtml, escapeAttr } from './ui-context.js';

/** 本 Tab 的局部选择状态（与角色卡 Tab 解耦） */
const wc = {
    selected: [],       // 选中的角色名
    running: false,
    controller: null,
    lastEntries: [],    // 最近一次生成的角色条目（供绑定/打包参考）
};

/** 工作区记录名（与小说 Tab 一致，用于落盘分区） */
function currentRec() {
    return novel.getCurrentRecord() || '未命名';
}

export function renderWorldCardTab(box) {
    box.innerHTML = `
        <div class="ce-pane">
            <div class="ce-section">
                <label class="ce-label">① 角色 → 世界书条目</label>
                <p class="ce-faint">
                    选择角色，为每个角色生成一条**世界书条目**（绿灯），追加进目标世界书。
                    已有条目不会被覆盖，只做追加。
                </p>
                <div class="ce-rowline">
                    <label>关联人物强度</label>
                    <select id="ce_wc_related" class="text_pole">
                        <option value="none">不关联</option>
                        <option value="light" selected>轻（默认，附带 related/登场词）</option>
                        <option value="heavy">重（关系图谱，P3）</option>
                    </select>
                    <label class="checkbox_label"><input type="checkbox" id="ce_wc_nsfw"> 含 NSFW</label>
                </div>
                <div class="ce-rowline">
                    <label>目标世界书</label>
                    <select id="ce_wc_target" class="text_pole" style="flex:1"><option value="">（载入中…）</option></select>
                    <button type="button" class="menu_button" id="ce_wc_load">刷新列表</button>
                </div>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_wc_sel_all">全选角色</button>
                    <button type="button" class="menu_button" id="ce_wc_sel_none">全不选</button>
                    <span class="ce-faint">已选：<span id="ce_wc_sel_cnt">0</span></span>
                </div>
                <div class="ce-charlist" id="ce_wc_charlist"></div>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_wc_gen">生成角色条目</button>
                    <button type="button" class="menu_button" id="ce_wc_write">写入目标世界书</button>
                    <button type="button" class="menu_button" id="ce_wc_stop" style="display:none">停止</button>
                    <span id="ce_wc_msg" class="ce-msg"></span>
                </div>
                <div class="ce-log" id="ce_wc_log"></div>
                <p class="ce-faint" style="margin-top:8px">
                    关联查询：选一个角色，查看其关联的事件/地点（来自条目 related 或关系图谱）。
                    轻档改条目 related，重档另存关系图谱。
                </p>
                <div class="ce-rowline">
                    <label>查询角色</label>
                    <input type="text" id="ce_wc_q_name" class="text_pole" style="flex:1" placeholder="角色名">
                    <button type="button" class="menu_button" id="ce_wc_q_btn">查关联</button>
                </div>
                <textarea id="ce_wc_q_out" class="text_pole" rows="6" placeholder="关联结果会显示在这里…"></textarea>
            </div>

            <div class="ce-section">
                <label class="ce-label">② 绑定管理</label>
                <p class="ce-faint">
                    把世界书绑到**当前酒馆角色**：主本（1 本，随卡导出）＋ 附属（N 本，本地链接）。
                    请先在酒馆里切换到目标角色卡。
                </p>
                <div class="ce-rowline">
                    <label>主世界书</label>
                    <select id="ce_wc_primary" class="text_pole" style="flex:1"></select>
                    <button type="button" class="menu_button" id="ce_wc_bind">设为主本</button>
                    <button type="button" class="menu_button" id="ce_wc_unbind">解除绑定</button>
                </div>
                <div class="ce-rowline">
                    <label>附属世界书</label>
                    <select id="ce_wc_extra" class="text_pole" style="flex:1"></select>
                    <button type="button" class="menu_button" id="ce_wc_link">链接附属</button>
                </div>
                <span id="ce_wc_bind_msg" class="ce-msg"></span>
            </div>

            <div class="ce-section">
                <label class="ce-label">③ 打包导出</label>
                <p class="ce-faint">
                    选一张卡（角色卡 Tab 的生成结果）＋ 一本主世界书，内嵌为**一张完整可导入卡**。
                </p>
                <div class="ce-rowline">
                    <label>角色卡</label>
                    <select id="ce_wc_card" class="text_pole" style="flex:1"></select>
                    <label>主世界书</label>
                    <select id="ce_wc_packbook" class="text_pole" style="flex:1"></select>
                </div>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_wc_pack">导出完整卡 .json</button>
                    <span id="ce_wc_pack_msg" class="ce-msg"></span>
                </div>
            </div>
        </div>`;

    bindAll();
    renderCharList();
    refreshBookLists();
    refreshCardList();
}

/* ==================== ① 角色 → 条目 ==================== */

function bindAll() {
    $('ce_wc_sel_all')?.addEventListener('click', () => { wc.selected = scan.getCharacters().map((c) => c.name); renderCharList(); });
    $('ce_wc_sel_none')?.addEventListener('click', () => { wc.selected = []; renderCharList(); });
    $('ce_wc_load')?.addEventListener('click', () => { refreshBookLists(); flash('ce_wc_msg', '已刷新'); });
    $('ce_wc_gen')?.addEventListener('click', runGenCharEntries);
    $('ce_wc_write')?.addEventListener('click', writeEntriesToTarget);
    $('ce_wc_stop')?.addEventListener('click', () => { if (wc.controller) { try { wc.controller.abort(); } catch (e) { /* 忽略 */ } } wc.running = false; });
    $('ce_wc_bind')?.addEventListener('click', doBind);
    $('ce_wc_unbind')?.addEventListener('click', doUnbind);
    $('ce_wc_link')?.addEventListener('click', doLink);
    $('ce_wc_pack')?.addEventListener('click', doPack);
    $('ce_wc_q_btn')?.addEventListener('click', doQueryRelation);
}

function renderCharList() {
    const box = $('ce_wc_charlist');
    if (!box) return;
    const chars = scan.getCharacters();
    if (!chars.length) { box.innerHTML = '<div class="ce-tip">还没有角色。请先到「角色卡」页扫描 / 添加角色。</div>'; return; }
    box.innerHTML = '';
    chars.forEach((c) => {
        const on = wc.selected.includes(c.name);
        const d = document.createElement('div');
        d.className = 'ce-chip' + (on ? ' sel' : '');
        d.innerHTML = `<div class="ce-chip-n">${escapeHtml(c.name)}</div>
            <div class="ce-chip-r">${escapeHtml(c.role || '')}</div>`;
        d.addEventListener('click', () => {
            const i = wc.selected.indexOf(c.name);
            if (i >= 0) wc.selected.splice(i, 1); else wc.selected.push(c.name);
            renderCharList();
        });
        box.appendChild(d);
    });
    const cnt = $('ce_wc_sel_cnt');
    if (cnt) cnt.textContent = String(wc.selected.length);
}

async function runGenCharEntries() {
    if (!wc.selected.length) { flash('ce_wc_msg', '请先选择角色', true); return; }
    if (wc.running) { if (wc.controller) { try { wc.controller.abort(); } catch (e) { /* 忽略 */ } } wc.running = false; return; }
    wc.running = true;
    wc.controller = new AbortController();
    const signal = wc.controller.signal;
    $('ce_wc_gen').style.display = 'none';
    $('ce_wc_stop').style.display = 'inline-block';
    clearLog('ce_wc_log');

    const related = $('ce_wc_related')?.value || 'light';
    const nsfw = !!$('ce_wc_nsfw')?.checked;
    try {
        flash('ce_wc_msg', '生成角色条目…', false, { persist: true });
        const entries = await worldbook.genCharEntries({
            names: wc.selected.slice(),
            relatedMode: related,
            nsfw, signal,
            onProgress: (i, total, nm) => { flash('ce_wc_msg', `生成角色条目 ${i + 1}/${total} · ${nm}…`, false, { persist: true }); },
        });
        wc.lastEntries = entries;
        logTo('ce_wc_log', '✅ 共生成 ' + entries.length + ' 条角色条目，可点「写入目标世界书」追加。', 'g');
        // 重档：同时做一次关系抽取并落盘
        if (related === 'heavy' && !signal.aborted) {
            flash('ce_wc_msg', '关系抽取中…', false, { persist: true });
            const graph = await worldbook.relExtractCore({ signal });
            try { await persistMod.saveRelations(currentRec(), graph); } catch (e) { /* 忽略 */ }
            logTo('ce_wc_log', '关系图谱已落盘：实体 ' + graph.entities.length + '、关系 ' + graph.relations.length, 'g');
        }
        flash('ce_wc_msg', '已生成 ' + entries.length + ' 条');
    } catch (e) {
        logTo('ce_wc_log', '生成失败：' + e.message, 'e');
        flash('ce_wc_msg', '生成失败', true);
    } finally {
        wc.running = false;
        $('ce_wc_gen').style.display = 'inline-block';
        $('ce_wc_stop').style.display = 'none';
    }
}

/** 把 lastEntries 追加写入目标世界书（酒馆已有书则合并，否则本地落盘） */
async function writeEntriesToTarget() {
    const entries = wc.lastEntries || [];
    if (!entries.length) { flash('ce_wc_msg', '请先生成角色条目', true); return; }
    const target = $('ce_wc_target')?.value || '';
    // 目标为酒馆已有书 → 直接追加写入酒馆
    if (target) {
        try {
            const r = await worldbook.writeWorldbookToTavern(target, entries, 'append');
            logTo('ce_wc_log', r.message, r.ok ? 'g' : 'e');
            flash('ce_wc_msg', r.ok ? ('已追加 ' + r.count + ' 条到「' + target + '」') : r.message, !r.ok);
        } catch (e) {
            logTo('ce_wc_log', '写入失败：' + e.message, 'e');
            flash('ce_wc_msg', '写入失败', true);
        }
        return;
    }
    // 无目标：落盘到工作区（新建角色条目文件）
    const rec = currentRec();
    try {
        const existing = await persistMod.loadChapterBook(rec, '角色条目');
        const merged = existing ? mergeEntries(existing.entries || [], entries) : entries;
        await persistMod.saveChapterBook(rec, '角色条目', merged);
        logTo('ce_wc_log', '已落盘到工作区「角色条目」（共 ' + merged.length + ' 条）。可在酒馆里导入或用于打包。', 'g');
        flash('ce_wc_msg', '已落盘角色条目');
        refreshBookLists();
    } catch (e) {
        logTo('ce_wc_log', '落盘失败：' + e.message, 'e');
        flash('ce_wc_msg', '落盘失败', true);
    }
}

/** 按标题合并条目（同标题合并关键词，内容取长） */
function mergeEntries(base, add) {
    const map = new Map((base || []).map((e) => [e.title, e]));
    for (const e of (add || [])) {
        if (map.has(e.title)) {
            const ex = map.get(e.title);
            for (const k of (e.keys || [])) if (!ex.keys.includes(k)) ex.keys.push(k);
            for (const k of (e.relatedKeys || [])) { ex.relatedKeys = ex.relatedKeys || []; if (!ex.relatedKeys.includes(k)) ex.relatedKeys.push(k); }
            if ((e.content || '').length > (ex.content || '').length) ex.content = e.content;
        } else map.set(e.title, e);
    }
    return [...map.values()];
}

/* ==================== 关联查询 ==================== */

/**
 * 查询某角色的关联（双向）：
 *  - 轻档：扫描已生成条目里的 `related`（含本 Tab 刚生成 + 工作区已落盘的）
 *  - 重档：查关系图谱（从角色 → 找相关事件/地点，以及哪些角色与 TA 有共同事件）
 */
async function doQueryRelation() {
    const name = ($('ce_wc_q_name')?.value || '').trim();
    const out = $('ce_wc_q_out');
    if (!name) { flash('ce_wc_msg', '请输入角色名', true); return; }
    const lines = ['# 角色「' + name + '」的关联', ''];

    // 1) 轻档：条目 related
    const sources = [];
    if (wc.lastEntries && wc.lastEntries.length) sources.push(...wc.lastEntries);
    try {
        const book = await persistMod.loadChapterBook(currentRec(), '角色条目');
        if (book && Array.isArray(book.entries)) sources.push(...book.entries);
    } catch (e) { /* 忽略 */ }
    const hit = sources.filter((e) => Array.isArray(e.related) && e.related.includes(name));
    lines.push('## 条目关联（轻档）');
    if (hit.length) {
        hit.forEach((e) => lines.push('· ' + e.title + '｜相关关键词: ' + (e.keys || []).join('、')));
    } else {
        lines.push('（无：条目 related 里未出现该角色，或尚未生成相关条目）');
    }
    lines.push('');

    // 2) 重档：关系图谱（双向）
    try {
        const graph = await persistMod.loadRelations(currentRec());
        const ents = graph.entities || [];
        const rels = graph.relations || [];
        const byId = new Map(ents.map((e) => [e.id, e]));
        const selfIds = new Set(ents.filter((e) => e.type === '角色' && e.name === name).map((e) => e.id));
        const relatedEnts = new Set();
        const coChars = new Set();
        for (const r of rels) {
            if (selfIds.has(r.from)) relatedEnts.add(r.to);
            if (selfIds.has(r.to)) relatedEnts.add(r.from);
        }
        // 共同事件里的其他角色
        for (const r of rels) {
            if (selfIds.has(r.from) && byId.get(r.to)?.type === '事件') {
                for (const r2 of rels) if (r2.to === r.to && !selfIds.has(r2.from) && byId.get(r2.from)?.type === '角色') coChars.add(byId.get(r2.from).name);
            }
        }
        lines.push('## 关系图谱（重档）');
        if (selfIds.size || relatedEnts.size) {
            lines.push('· 直接相关：' + ([...relatedEnts].map((id) => { const e = byId.get(id); return e ? (e.type + ':' + e.name) : id; }).join('、') || '（无）'));
            if (coChars.size) lines.push('· 同事件其他角色：' + [...coChars].join('、'));
        } else {
            lines.push('（无：未生成关系图谱，或图谱中没有该角色）');
        }
    } catch (e) {
        lines.push('## 关系图谱（重档）');
        lines.push('（读取失败：' + e.message + '）');
    }

    if (out) out.value = lines.join('\n');
    logTo('ce_wc_log', '已查询角色关联：' + name, 'g');
}

/* ==================== ② 绑定管理 ==================== */

/** 刷新世界书下拉（酒馆已有书 + 工作区已落盘书） */
async function refreshBookLists() {
    const tavern = await worldbook.listWorldbooks();
    const rec = currentRec();
    let local = [];
    try { local = await persistMod.listChapterBooks(rec); } catch (e) { /* 忽略 */ }
    // 目标世界书：只能选**酒馆已有书**（用于「追加写入酒馆」）；空则落盘到工作区
    fillSelect('ce_wc_target', tavern, true);
    // 绑定/打包：主本与附属只能是酒馆书
    fillSelect('ce_wc_primary', tavern, false);
    fillSelect('ce_wc_extra', tavern, false);
    // 打包的主世界书：酒馆书 + 本地落盘卷（都可作为内嵌来源）
    fillSelect('ce_wc_packbook', [...new Set([...tavern, ...local])], false);
}

function fillSelect(id, names, allowEmpty) {
    const sel = $(id);
    if (!sel) return;
    const cur = sel.value;
    const opts = (allowEmpty ? ['<option value="">（落盘到工作区，不写酒馆）</option>'] : ['<option value="">（未选择）</option>'])
        .concat((names || []).map((n) => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`));
    sel.innerHTML = opts.join('');
    if (cur && (names || []).includes(cur)) sel.value = cur;
}

async function doBind() {
    const name = $('ce_wc_primary')?.value || '';
    if (!name) { flash('ce_wc_bind_msg', '请选择主世界书', true); return; }
    const r = await bindPrimaryWorldbook(name);
    flash('ce_wc_bind_msg', r.message, !r.ok);
}

async function doUnbind() {
    const r = await unbindPrimaryWorldbook();
    flash('ce_wc_bind_msg', r.message, !r.ok);
}

async function doLink() {
    const name = $('ce_wc_extra')?.value || '';
    if (!name) { flash('ce_wc_bind_msg', '请选择附属世界书', true); return; }
    const r = await linkExtraWorldbook(name);
    flash('ce_wc_bind_msg', r.message, !r.ok);
}

/* ==================== ③ 打包导出 ==================== */

function refreshCardList() {
    fillSelect('ce_wc_card', (state.cardGroups || []).map((c) => c.name), false);
}

async function doPack() {
    const cardName = $('ce_wc_card')?.value || '';
    const bookName = $('ce_wc_packbook')?.value || '';
    const group = (state.cardGroups || []).find((c) => c.name === cardName);
    if (!group) { flash('ce_wc_pack_msg', '请选择角色卡（先在角色卡页生成）', true); return; }
    const card = writer.parseCard(group.text, { name: group.name });
    // 取主世界书条目：先试酒馆书，再试工作区落盘卷
    let entries = [];
    if (bookName) {
        try { entries = (await worldbook.loadWorldbookEntries(bookName)) || []; } catch (e) { /* 忽略 */ }
        if (!entries.length) {
            try {
                const local = await persistMod.loadChapterBook(currentRec(), bookName);
                if (local && Array.isArray(local.entries)) entries = local.entries;
            } catch (e) { /* 忽略 */ }
        }
    }
    const full = writer.buildFullCard(card, entries, { bookName: bookName || undefined });
    writer.exportFullCardJson(full);
    const parts = [];
    if (full.data.character_book) parts.push('世界书 ' + full.data.character_book.entries.length + ' 条');
    if (full.data.first_mes) parts.push('开场白');
    flash('ce_wc_pack_msg', '已导出' + (parts.length ? ('（含' + parts.join('、') + '）') : '（仅角色卡）'));
    logTo('ce_wc_log', '已导出完整卡：' + card.name + (entries.length ? (' + 世界书 ' + entries.length + ' 条') : ''), 'g');
}
