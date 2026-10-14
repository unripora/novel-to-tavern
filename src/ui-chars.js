/**
 * ui-chars.js —— 「角色」Tab（扫描 / 手动添加 / 合并）
 */

import { flash, logTo, clearLog, stripFence, stripThink } from './util.js';
import { settings } from './store.js';
import * as novel from './novel.js';
import * as scan from './scan.js';
import { generate } from './generate.js';
import { $, state, escapeHtml, stopRun } from './ui-context.js';

export function renderCharsTab(box) {
    box.innerHTML = `
        <div class="ce-pane">
            <div class="ce-section">
                <label class="ce-label">添加角色</label>
                <div class="ce-rowline">
                    <input type="text" id="ce_manual" class="text_pole" style="flex:1" placeholder="手动添加角色，多个用逗号/空格分隔">
                    <button type="button" class="menu_button" id="ce_add_names">添加</button>
                </div>
            </div>
            <div class="ce-section">
                <label class="ce-label">扫描与操作</label>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_scan">扫描全书</button>
                    <button type="button" class="menu_button" id="ce_merge">合并所选</button>
                    <button type="button" class="menu_button" id="ce_clear_chars">清空列表</button>
                    <span id="ce_scan_msg" class="ce-msg"></span>
                </div>
                <div class="ce-log" id="ce_scan_log"></div>
            </div>
            <div class="ce-section">
                <label class="ce-label">角色列表（点击选择，用于生成）</label>
                <div class="ce-charlist" id="ce_charlist"></div>
            </div>
        </div>`;

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

function renderCharChips() {
    const box = $('ce_charlist');
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
            flash('ce_scan_msg', `扫描 ${i + 1}/${chunks.length}…`);
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
