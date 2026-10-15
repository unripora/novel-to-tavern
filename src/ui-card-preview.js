/**
 * ui-card-preview.js —— 「角色卡」Tab 的预览与导入
 *
 * 与 ui-card.js 分离：预览面板可编辑后确认导入，调用 card-writer 写入酒馆。
 */

import { toast, flash, logTo } from './util.js';
import * as writer from './card-writer.js';
import { $, state, escapeHtml, escapeAttr } from './ui-context.js';

/** 打开预览面板（可编辑后「确认导入到酒馆」）
 * @param {number} [idx] 指定预览哪一张卡（对应 state.cardGroups 下标）；缺省用合并文本
 */
export function openCardPreview(idx) {
    const box = $('ce_card_preview');
    const groups = state.cardGroups || [];
    const hasIdx = Number.isInteger(idx) && idx >= 0 && idx < groups.length;
    const src = hasIdx ? groups[idx].text : state.cardText;
    if (!src || !String(src).trim()) { flash('ce_out_msg', '还没有可预览的内容', true); return; }
    const fallbackName = hasIdx ? (groups[idx].name || '') : (state.selectedNames[0] || '');
    const card = writer.parseCard(src, { name: fallbackName });
    box.style.display = 'block';
    box.innerHTML = `
        <div class="ce-preview-head">角色卡预览（可编辑后导入）</div>
        <label>名称</label><input type="text" id="ce_pv_name" class="text_pole" value="${escapeAttr(card.name)}">
        <label>描述 / 主体</label><textarea id="ce_pv_desc" class="text_pole" rows="10">${escapeHtml(card.description || card.raw || '')}</textarea>
        <label>性格</label><textarea id="ce_pv_personality" class="text_pole" rows="3">${escapeHtml(card.personality || '')}</textarea>
        <label>开场白（first_mes）</label><textarea id="ce_pv_first" class="text_pole" rows="4">${escapeHtml(card.first_mes || '')}</textarea>
        <div class="ce-rowline">
            <button type="button" class="menu_button" id="ce_pv_import">确认导入到酒馆</button>
            <button type="button" class="menu_button" id="ce_pv_cancel">取消</button>
            <span id="ce_pv_msg" class="ce-msg"></span>
        </div>`;

    $('ce_pv_cancel').addEventListener('click', () => { box.style.display = 'none'; });
    $('ce_pv_import').addEventListener('click', async () => {
        const desc = $('ce_pv_desc').value;
        const payload = {
            name: $('ce_pv_name').value.trim(),
            description: desc,
            raw: desc,                          // 兜底：确保主体内容不为空
            personality: $('ce_pv_personality').value,
            first_mes: $('ce_pv_first').value,
            creator_notes: '由「角色卡提取工具」插件生成',
        };
        flash('ce_pv_msg', '正在导入…');
        const res = await writer.writeCharacterToTavern(payload, {
            onLog: (m, e) => logTo('ce_gen_log', '[导入] ' + m, e ? 'e' : ''),
        });
        flash('ce_pv_msg', res.message, !res.ok);
        if (res.ok) {
            // 回写编辑后的主体到对应卡片
            if (hasIdx && state.cardGroups[idx]) {
                state.cardGroups[idx].text = desc;
                state.cardGroups[idx].name = payload.name;
                state.cardText = state.cardGroups.map((c) => c.text).join('\n\n\n');
                writeOutSafe();
            }
            toast('角色已创建到酒馆：' + payload.name);
            box.style.display = 'none';
        }
    });
}

/** 安全回写合并视图（ui-card 的输出框可能不在当前 DOM） */
function writeOutSafe() {
    const out = document.getElementById('ce_output');
    if (out) out.value = state.cardText;
}

export default { openCardPreview };
