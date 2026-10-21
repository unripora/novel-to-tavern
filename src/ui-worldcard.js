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
import * as timeline from './timeline.js';
import { screenCharacters, verifyCharactersInChapter } from './char-presence.js';
import { bindPrimaryWorldbook, unbindPrimaryWorldbook, linkExtraWorldbook, popupForm } from './st-bridge.js';
import { $, state, escapeHtml, escapeAttr } from './ui-context.js';

/** 本 Tab 的局部选择状态（与角色卡 Tab 解耦） */
const wc = {
    selected: [],       // 选中的角色名
    running: false,
    controller: null,
    lastEntries: [],    // 最近一次生成的角色条目（供绑定/打包参考）
    lastRange: null,    // 最近一次生成所用的原文范围（由「原文范围」下拉决定，非世界书自带）
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
                    选择角色，为每个角色生成一条**世界书条目**（绿灯），追加进「目标世界书」。
                    已有条目不会被覆盖（按所选冲突策略处理）。
                    「原文范围」决定角色从此处检索原文：<b>全书</b>＝全书抽样；<b>选某卷</b>＝只在该卷正文范围内找（与目标世界书叫什么无关，改名也不受影响）。
                </p>
                <div class="ce-rowline">
                    <label>条目详略</label>
                    <select id="ce_wc_detail" class="text_pole">
                        <option value="detail" selected>详细档案（推荐，逐字段填写）</option>
                        <option value="brief">简要概述（三五句）</option>
                    </select>
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
                    <label class="checkbox_label" title="多本世界书同名条目会一起注入；加前缀后一眼能分清来自哪本">
                        <input type="checkbox" id="ce_wc_prefix" checked> 标题加书卷前缀（如「SAO篇·亚丝娜」）
                    </label>
                    <span class="ce-faint">写入时自动加，总本=100 / 篇章本=200 插入顺序</span>
                </div>
                <div class="ce-rowline">
                    <label>原文范围</label>
                    <select id="ce_wc_range" class="text_pole" style="flex:1"><option value="">全书</option></select>
                    <label>冲突策略</label>
                    <select id="ce_wc_conflict" class="text_pole">
                        <option value="append">追加（保留已有）</option>
                        <option value="skip">跳过重复</option>
                        <option value="overwrite" selected>覆盖（替换同名旧条目）</option>
                    </select>
                </div>
                <div class="ce-rowline">
                    <label>出场判断</label>
                    <select id="ce_wc_presence" class="text_pole" style="flex:1">
                        <option value="auto" selected>自动剔除（本卷未出场的不写条目）</option>
                        <option value="report">仅报告（不过滤，只列名单）</option>
                        <option value="off">不判断（全部生成）</option>
                    </select>
                </div>
                <p class="ce-faint">
                    用于「晚出场 / 只在某篇章登场」的角色：选了具体卷后，名字在本卷没出现、
                    或只被提及（传闻 / 回忆 / 预告）而本人未登场的角色，**不写进本卷条目**，
                    避免一提到名字就把 TA 的完整档案注入而提前剧透。选「全书」时该判断不生效。
                </p>
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
    // 清洗选中项：角色被删/合并或换过小说后，旧名字不能留着，
    // 否则会为已经不存在的角色生成条目。
    const names = new Set(chars.map((c) => c.name));
    wc.selected = wc.selected.filter((n) => names.has(n));
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

/**
 * 出场判断：把「在本卷内没有实际戏份」的角色从本次生成名单里剔掉。
 *
 * 两级：
 *  1. 程序粗筛——名字/别名在本卷正文里 0 次出现 → 直接判定未出场，不花 AI 调用。
 *  2. AI 复核——粗筛命中的，区分「本人登场」与「仅被提及（传闻/回忆/预告）」。
 *
 * @param {string[]} names 本次要生成条目的角色名
 * @param {{name:string,start:number,end:number}} range 当前选中的卷范围
 * @param {'auto'|'report'} mode auto=剔除；report=只报告不剔除
 * @param {AbortSignal} signal
 * @returns {Promise<string[]>} 过滤后仍需生成的角色名
 */
async function filterByPresence(names, range, mode, signal) {
    const text = novel.getNovel().slice(range.start, range.end);
    const chars = names.map((n) => {
        const c = scan.getCharacters().find((x) => x.name === n);
        return { name: n, aliases: (c && c.aliases) || [] };
    });
    const { absent, candidates } = screenCharacters(text, chars);
    if (absent.length) {
        logTo('ce_wc_log', `本卷未出现（${absent.length}）：` + absent.map((c) => c.name).join('、'), 'g');
    }
    let presentNames = candidates.map((x) => x.char.name);
    if (candidates.length && !signal.aborted) {
        flash('ce_wc_msg', '判断出场情况…', false, { persist: true });
        const v = await verifyCharactersInChapter({
            text, chapterName: range.name, candidates, signal, logEl: 'ce_wc_log',
        });
        presentNames = v.present.map((c) => c.name);
        if (v.mentionedOnly.length) {
            logTo('ce_wc_log', `仅被提及、本人未登场（${v.mentionedOnly.length}）：` + v.mentionedOnly.map((c) => c.name).join('、'), 'g');
        }
    }
    const removed = names.filter((n) => !presentNames.includes(n));
    if (mode === 'report') {
        logTo('ce_wc_log', `仅报告模式：本卷应剔除 ${removed.length} 个角色（本次不过滤，仍全部生成）`, 'e');
        return names;
    }
    if (removed.length) logTo('ce_wc_log', `已剔除本卷未出场的角色 ${removed.length} 个，不写进条目。`, 'g');
    return presentNames;
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
    const detail = $('ce_wc_detail')?.value || 'detail';
    const nsfw = !!$('ce_wc_nsfw')?.checked;
    const target = $('ce_wc_target')?.value || '';
    const rangeVal = $('ce_wc_range')?.value || '';
    const presence = $('ce_wc_presence')?.value || 'auto';
    try {
        // 原文范围：由「原文范围」下拉决定（手动指定，独立于目标世界书；不选=全书抽样）
        wc.lastRange = resolveRangeByNodeId(rangeVal);
        if (wc.lastRange) logTo('ce_wc_log', `原文范围：卷「${wc.lastRange.name}」${wc.lastRange.start}~${wc.lastRange.end}，将只在该段正文内检索角色。`, 'g');
        else logTo('ce_wc_log', '原文范围：全书（未指定卷，按全书抽样）。', 'g');
        if (detail === 'detail') logTo('ce_wc_log', '条目详略：详细档案（按单人卡模板逐字段填写，条目较长）。', 'g');

        // 出场判断：只在指定了具体卷、且开启了过滤时生效
        // 目的：晚出场 / 只在特定篇章登场的角色，不要写进本卷的条目里，否则一提到名字就剧透
        let names = wc.selected.slice();
        if (presence !== 'off' && wc.lastRange) {
            names = await filterByPresence(names, wc.lastRange, presence, signal);
            if (signal.aborted) return;
            if (!names.length) {
                logTo('ce_wc_log', '本卷所选角色均未出场，已跳过生成。', 'e');
                flash('ce_wc_msg', '所选角色在本卷均未出场');
                return;
            }
        } else if (presence !== 'off' && !wc.lastRange) {
            logTo('ce_wc_log', '出场判断已跳过：原文范围为「全书」，无法判断登场卷。选具体卷后再生效。', 'e');
        }

        flash('ce_wc_msg', '生成角色条目…', false, { persist: true });
        const entries = await worldbook.genCharEntries({
            names,
            relatedMode: related,
            detail,
            nsfw, signal,
            range: wc.lastRange ? { start: wc.lastRange.start, end: wc.lastRange.end } : null,
            onProgress: (i, total, nm) => { flash('ce_wc_msg', `生成角色条目 ${i + 1}/${total} · ${nm}…`, false, { persist: true }); },
        });
        wc.lastEntries = entries;
        logTo('ce_wc_log', '✅ 共生成 ' + entries.length + ' 条角色条目，可点「写入目标世界书」追加。', 'g');
        // 重档：同时做一次关系抽取并落盘
        if (related === 'heavy' && !signal.aborted) {
            flash('ce_wc_msg', '关系抽取中…', false, { persist: true });
            const graph = await worldbook.relExtractCore({ signal });
            if (graph.error) {
                // 失败要明确报错，不能打印「实体 0、关系 0」冒充成功
                logTo('ce_wc_log', '❌ 关系图谱失败：' + graph.error, 'e');
                flash('ce_wc_msg', '关系图谱失败：' + graph.error, true);
            } else if (graph.aborted) {
                logTo('ce_wc_log', '关系抽取已停止', 'e');
            } else {
                try { await persistMod.saveRelations(currentRec(), graph); } catch (e) { /* 忽略 */ }
                logTo('ce_wc_log', '关系图谱已落盘：实体 ' + graph.entities.length + '、关系 ' + graph.relations.length, 'g');
            }
        }
        flash('ce_wc_msg', '已生成 ' + entries.length + ' 条角色条目');
    } catch (e) {
        logTo('ce_wc_log', '生成失败：' + e.message, 'e');
        flash('ce_wc_msg', '生成失败', true);
    } finally {
        wc.running = false;
        $('ce_wc_gen').style.display = 'inline-block';
        $('ce_wc_stop').style.display = 'none';
    }
}

/**
 * 「写入目标世界书」：
 *  - 本地（工作区）若有同名卷 → 写本地那本，同时也写酒馆同名书（两者都写）。
 *  - 冲突策略：
 *      append    追加，保留已有全部
 *      skip      跳过与已有条目标题重复的新条目
 *      overwrite 覆盖：删掉目标书里同名旧条目，再写入新条目（默认）
 *  - 覆盖/跳过会先 dry-run 统计，再弹窗确认后才真正落盘。
 */
async function writeEntriesToTarget() {
    const entries = wc.lastEntries || [];
    if (!entries.length) { flash('ce_wc_msg', '请先生成角色条目', true); return; }
    const target = ($('ce_wc_target')?.value || '').trim();
    const strategy = $('ce_wc_conflict')?.value || 'overwrite';
    const usePrefix = !!$('ce_wc_prefix')?.checked;
    const rec = currentRec();
    const prefix = usePrefix ? worldbook.bookPrefix(target) : '';
    const order = worldbook.orderForBook(target);

    // 0) 有目标书时先 dry-run，把「将删 / 将跳过」摆给用户确认（覆盖会永久删除酒馆条目）
    if (target && strategy !== 'append') {
        let plan = null;
        try {
            plan = await worldbook.writeWorldbookToTavern(target, entries, 'append', { strategy, prefix, order, dryRun: true });
        } catch (e) { /* 预览失败则不拦，直接走写入 */ }
        if (plan && plan.conflicts && plan.conflicts.length) {
            const shown = plan.removedTitles.slice(0, 20);
            const html =
                '<p style="margin:0 0 8px">目标世界书「' + escapeHtml(target) + '」里有 <b>' + plan.conflicts.length + '</b> 条与新条目同名：</p>' +
                '<div style="max-height:180px;overflow:auto;font-size:12px;line-height:1.7;margin-bottom:8px">' +
                shown.map((t) => '· ' + escapeHtml(t)).join('<br>') +
                (plan.removedTitles.length > shown.length ? '<br>…等共 ' + plan.removedTitles.length + ' 条' : '') +
                '</div>' +
                (strategy === 'overwrite'
                    ? '<p style="margin:0">确认后<b>删除这些旧条目</b>，再写入 ' + entries.length + ' 条新条目。此操作不可撤销。</p>'
                    : '<p style="margin:0">确认后<b>跳过</b>这些同名条目，只写入其余 ' + Math.max(0, entries.length - plan.conflicts.length) + ' 条。</p>');
            const ok = await popupForm({ title: strategy === 'overwrite' ? '确认覆盖？' : '确认跳过？', bodyHtml: html, okLabel: '确认写入', cancelLabel: '取消' });
            if (!ok) { flash('ce_wc_msg', '已取消写入'); logTo('ce_wc_log', '已取消写入。', 'e'); return; }
        }
    }

    // 1) 本地那份：若已有同名卷则合并进去，否则新建
    let localBook = null;
    if (target) { try { localBook = await persistMod.loadChapterBook(rec, target); } catch (e) { /* 忽略 */ } }
    const baseEntries = (localBook && Array.isArray(localBook.entries)) ? localBook.entries : [];
    const mergedLocal = mergeEntries(baseEntries, entries, { strategy });
    const skippedLocal = mergedLocal.skipped || 0;
    const removedLocal = mergedLocal.removed || 0;
    const bookName = target || '角色条目';
    try {
        await persistMod.saveChapterBook(rec, bookName, mergedLocal);
        logTo('ce_wc_log', `已写入本地工作区「${bookName}」：${localBook ? '合并进已有卷' : '新建卷'}，共 ${mergedLocal.length} 条`
            + (removedLocal ? `（覆盖 ${removedLocal} 条）` : '') + (skippedLocal ? `（跳过重复 ${skippedLocal} 条）` : '') + '。', 'g');
    } catch (e) {
        logTo('ce_wc_log', '本地落盘失败：' + e.message, 'e');
    }

    // 2) 酒馆那份：有目标书就按所选策略写酒馆同名，无目标书则跳过
    if (target) {
        try {
            const r = await worldbook.writeWorldbookToTavern(target, entries, 'append', { strategy, prefix, order });
            logTo('ce_wc_log', r.message, r.ok ? 'g' : 'e');
            if (prefix) logTo('ce_wc_log', '条目标题已加前缀「' + prefix + '·」，插入顺序 ' + order + '（总本 100 / 篇章本 200）。', 'g');
            flash('ce_wc_msg', r.ok ? `已写入「${target}」（本地＋酒馆）` : r.message, !r.ok);
        } catch (e) {
            logTo('ce_wc_log', '写入酒馆失败：' + e.message, 'e');
            flash('ce_wc_msg', '已写本地；酒馆写入失败', true);
        }
    } else {
        flash('ce_wc_msg', '已落盘工作区「' + bookName + '」（未指定目标世界书，未写酒馆）');
        logTo('ce_wc_log', '未指定目标世界书，仅落盘工作区。', 'g');
    }
    refreshBookLists();
}

/**
 * 按标题合并条目（同标题合并关键词，内容取长）。
 * opts.strategy：
 *  - 'append'（默认）同标题合并关键词，内容取长
 *  - 'skip'    同标题的旧条目保留，新条目丢弃
 *  - 'overwrite' 同标题的旧条目被新条目整条替换
 */
function mergeEntries(base, add, opts = {}) {
    const strategy = opts.strategy || 'append';
    const map = new Map((base || []).map((e) => [e.title, e]));
    let skipped = 0;
    let removed = 0;
    for (const e of (add || [])) {
        if (map.has(e.title)) {
            if (strategy === 'skip') { skipped++; continue; }
            if (strategy === 'overwrite') { map.set(e.title, e); removed++; continue; }
            const ex = map.get(e.title);
            for (const k of (e.keys || [])) if (!ex.keys.includes(k)) ex.keys.push(k);
            for (const k of (e.relatedKeys || [])) { ex.relatedKeys = ex.relatedKeys || []; if (!ex.relatedKeys.includes(k)) ex.relatedKeys.push(k); }
            if ((e.content || '').length > (ex.content || '').length) ex.content = e.content;
        } else map.set(e.title, e);
    }
    const arr = [...map.values()];
    arr.skipped = skipped;
    arr.removed = removed;
    return arr;
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
    // 目标世界书：酒馆已有书 ∪ 本地已生成卷。目标书决定「条目写到哪」，与「原文范围」解耦。
    fillSelect('ce_wc_target', [...new Set([...tavern, ...local])], true);
    // 原文范围：时间线各卷（手动指定，独立于目标世界书）
    fillRangeSelect();
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

/**
 * 解析「原文范围」下拉值 → 实际范围。
 * 下拉 value 为时间线节点 id；空串（全书）返回 null。
 * 该卷未划范围（end<=start）时返回 null（等同全书）。
 * @param {string} nodeId
 * @returns {{name:string,start:number,end:number}|null}
 */
function resolveRangeByNodeId(nodeId) {
    const id = String(nodeId || '').trim();
    if (!id) return null;
    const nodes = (timeline.getTimeline().nodes || []);
    const node = nodes.find((n) => String(n.id) === id);
    if (!node) return null;
    const start = Number(node.start);
    const end = Number(node.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return { name: node.name || id, start, end };
}

/** 填充「原文范围」下拉：全书 + 时间线各卷（带范围/未带范围都列出，未带范围的标注提示） */
function fillRangeSelect() {
    const sel = $('ce_wc_range');
    if (!sel) return;
    const nodes = (timeline.getTimeline().nodes || []);
    const cur = sel.value;
    const opts = ['<option value="">全书（不限定范围）</option>'];
    nodes.forEach((n) => {
        const has = Number.isFinite(Number(n.start)) && Number.isFinite(Number(n.end)) && Number(n.end) > Number(n.start);
        opts.push(`<option value="${escapeAttr(String(n.id))}">${escapeHtml(n.name || n.id)}${has ? '' : '（未划范围）'}</option>`);
    });
    sel.innerHTML = opts.join('');
    if (cur && nodes.some((n) => String(n.id) === cur)) sel.value = cur;
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
