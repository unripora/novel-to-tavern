/**
 * ui-misc.js —— 其余 Tab：user 人设 / 文风 / 开场白 / 自检 / 历史
 * （世界书 Tab 已拆至 ui-world.js）
 */

import { toast, flash, clearLog } from './util.js';
import { settings, persist } from './store.js';
import * as extras from './extras.js';
import * as persistMod from './persist.js';
import { $, state, escapeHtml, copyText, saveProducts, downloadText } from './ui-context.js';

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
                <div class="ce-log" id="ce_pn_log"></div>
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
        clearLog('ce_pn_log');
        flash('ce_pn_msg', '生成中…', false, { persist: true });
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
            saveProducts();
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
                <div class="ce-log" id="ce_style_log"></div>
            </div>
            <div class="ce-section">
                <label class="ce-label">生成结果</label>
                <textarea id="ce_style_out" class="text_pole" rows="10" placeholder="文风分析 + 可复用文风提示词会显示在这里…"></textarea>
                <div class="ce-rowline"><button type="button" class="menu_button" id="ce_style_copy">复制</button></div>
            </div>
        </div>`;

    $('ce_style_out').value = state.styleText;
    $('ce_style_run').addEventListener('click', async () => {
        clearLog('ce_style_log');
        flash('ce_style_msg', '分析中…', false, { persist: true });
        try {
            const text = await extras.distillStyle({ nsfw: $('ce_style_nsfw').checked, extra: $('ce_style_extra').value });
            state.styleText = text;
            $('ce_style_out').value = text;
            saveProducts();
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
                <div class="ce-log" id="ce_fm_log"></div>
            </div>
            <div class="ce-section">
                <label class="ce-label">生成结果</label>
                <textarea id="ce_fm_out" class="text_pole" rows="10" placeholder="生成的开场白会显示在这里…"></textarea>
                <div class="ce-rowline"><button type="button" class="menu_button" id="ce_fm_copy">复制</button></div>
            </div>
        </div>`;

    $('ce_fm_out').value = state.firstText;
    $('ce_fm_run').addEventListener('click', async () => {
        clearLog('ce_fm_log');
        flash('ce_fm_msg', '生成中…', false, { persist: true });
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
            saveProducts();
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
        flash('ce_check_msg', '检查中…', false, { persist: true });
        clearLog('ce_check_log');
        try {
            const text = await extras.selfCheck({
                items: picked,
                onItem: (cur, total, label, partial) => {
                    flash('ce_check_msg', `${cur}/${total} · ${label}`, false, { persist: true });
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

/** 备份分区：导出/导入事件绑定 */
function bindBackupUI() {
    const exportBtn = $('ce_bk_export');
    const importBtn = $('ce_bk_import_btn');
    const fileEl = $('ce_bk_file');
    if (!exportBtn) return;

    exportBtn.addEventListener('click', async () => {
        flash('ce_bk_msg', '打包中…', false, { persist: true });
        try {
            const json = await persistMod.exportAll();
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            downloadText(json, 'card-extractor-backup-' + stamp + '.json', 'application/json');
            flash('ce_bk_msg', '已导出备份文件');
        } catch (e) {
            flash('ce_bk_msg', '导出失败：' + e.message, true);
        }
    });

    importBtn.addEventListener('click', () => fileEl.click());
    fileEl.addEventListener('change', async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        if (!confirm('导入会覆盖当前产物与配置，确认继续？')) return;
        flash('ce_bk_msg', '导入中…', false, { persist: true });
        try {
            const text = await f.text();
            const res = await persistMod.importAll(text);
            if (res.ok) {
                flash('ce_bk_msg', '导入成功，即将刷新面板');
                setTimeout(() => location.reload(), 800);
            } else {
                flash('ce_bk_msg', '导入失败：' + res.message, true);
            }
        } catch (err) {
            flash('ce_bk_msg', '导入失败：' + err.message, true);
        }
    });
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
                <label class="ce-label">产物备份（导出 / 导入）</label>
                <p class="ce-faint">把全部产物（角色卡 / 人设 / 文风 / 开场白 / 世界书 / 篇章本 / 日志）打包为一个 .json，用于换设备或清缓存前留档。</p>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_bk_export">导出全部（.json）</button>
                    <button type="button" class="menu_button" id="ce_bk_import_btn">导入备份</button>
                    <input type="file" id="ce_bk_file" accept=".json,application/json" style="display:none">
                    <span id="ce_bk_msg" class="ce-msg"></span>
                </div>
            </div>
            <div class="ce-section">
                <label class="ce-label">历史记录</label>
                <div class="ce-rowline">
                    <button type="button" class="menu_button" id="ce_hist_clear">清空全部</button>
                    <span id="ce_hist_msg" class="ce-msg"></span>
                </div>
                <div class="ce-histlist">${listHtml}</div>
            </div>
        </div>`;

    bindBackupUI();

    box.querySelectorAll('.ce_hist_view').forEach((btn) => {
        btn.addEventListener('click', () => {
            const rec = extras.getHistory()[Number(btn.dataset.i)];
            if (!rec) return;
            state.cardText = rec.text || '';
            saveProducts();
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
