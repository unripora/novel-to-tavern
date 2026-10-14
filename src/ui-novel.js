/**
 * ui-novel.js —— 「小说」Tab
 */

import { flash } from './util.js';
import * as novel from './novel.js';
import { $, state } from './ui-context.js';

export function renderNovelTab(box) {
    box.innerHTML = `
        <div class="ce-pane">
            <div class="ce-rowline">
                <button type="button" class="menu_button" id="ce_pick_btn">
                    <i class="fa-solid fa-file-import"></i> 选择文件导入
                </button>
                <button type="button" class="menu_button" id="ce_novel_list">刷新记录</button>
                <input type="file" id="ce_file" accept=".txt,.text,.md,text/plain" style="display:none">
            </div>
            <div class="ce-dropzone" id="ce_dropzone">
                <textarea id="ce_novel_text" class="text_pole" rows="8"
                    placeholder="在此粘贴小说正文，或把 .txt 文件拖到这里…"></textarea>
                <div class="ce-drop-hint" id="ce_drop_hint">松开鼠标即可导入 .txt 文件</div>
            </div>
            <div class="ce-meta"><span id="ce_novel_stat">0 字</span> <span id="ce_novel_msg" class="ce-msg"></span></div>
            <div class="ce-prog" id="ce_load_prog" style="display:none"><div class="ce-prog-bar" id="ce_load_bar"></div></div>
            <div class="ce-rowline">
                <select id="ce_novel_sel" class="text_pole"></select>
                <button type="button" class="menu_button" id="ce_novel_load">载入</button>
                <button type="button" class="menu_button" id="ce_novel_save">保存当前</button>
                <button type="button" class="menu_button" id="ce_novel_del">删除</button>
            </div>
            <p class="ce-tip">提示：正文保存在酒馆扩展存储中，刷新不丢失。也可把文件直接拖到上方文本框。</p>
        </div>`;

    const ta = $('ce_novel_text');
    const dz = $('ce_dropzone');
    ta.value = novel.previewOf(novel.getNovel());
    updateNovelStat();

    // 显式按钮触发隐藏的 file input（原生 input 在酒馆主题下不可见）
    $('ce_pick_btn').addEventListener('click', () => $('ce_file').click());
    $('ce_file').addEventListener('change', async (e) => {
        const f = e.target.files?.[0];
        if (f) await importFile(f);
        e.target.value = '';
    });

    // 拖拽覆盖整个 dropzone（含 textarea），并在拖入时高亮
    ['dragenter', 'dragover'].forEach((ev) => {
        dz.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dz.classList.add('ce-drop');
        });
    });
    ['dragleave', 'dragend'].forEach((ev) => {
        dz.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            // 仅在真正离开 dropzone 时取消高亮
            if (!dz.contains(e.relatedTarget)) dz.classList.remove('ce-drop');
        });
    });
    dz.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.remove('ce-drop');
        const f = e.dataTransfer?.files?.[0];
        if (f) await importFile(f);
    });

    ta.addEventListener('input', () => { novel.setNovel(ta.value); updateNovelStat(); });

    $('ce_novel_list').addEventListener('click', refreshNovelList);
    $('ce_novel_save').addEventListener('click', async () => {
        const name = prompt('小说名称：', '小说' + new Date().toLocaleDateString());
        if (!name) return;
        await novel.saveNovelRecord(name.trim());
        flash('ce_novel_msg', '已保存：' + name.trim());
        refreshNovelList();
    });
    $('ce_novel_load').addEventListener('click', async () => {
        const name = $('ce_novel_sel').value;
        if (!name) return;
        const text = await novel.loadNovelRecord(name);
        ta.value = novel.previewOf(text);
        updateNovelStat();
        flash('ce_novel_msg', '已载入：' + name);
    });
    $('ce_novel_del').addEventListener('click', async () => {
        const name = $('ce_novel_sel').value;
        if (!name) return;
        if (!confirm('确认删除记录「' + name + '」？')) return;
        await novel.deleteNovelRecord(name);
        refreshNovelList();
        flash('ce_novel_msg', '已删除');
    });

    refreshNovelList();
}

async function importFile(f) {
    try {
        flash('ce_novel_msg', '读取中…');
        $('ce_load_prog').style.display = 'block';
        const { text, enc } = await novel.readNovelFile(f, (pct, label) => {
            $('ce_load_bar').style.width = pct + '%';
            const el = $('ce_novel_msg');
            if (el) el.textContent = label || '';
        });
        $('ce_novel_text').value = novel.previewOf(text);
        updateNovelStat();
        $('ce_load_prog').style.display = 'none';
        flash('ce_novel_msg', '已导入（编码 ' + enc + '）');
    } catch (e) {
        $('ce_load_prog').style.display = 'none';
        flash('ce_novel_msg', '读取失败：' + e.message, true);
    }
}

function updateNovelStat() {
    const el = $('ce_novel_stat');
    if (el) el.textContent = novel.getNovel().length.toLocaleString() + ' 字';
}

async function refreshNovelList() {
    const sel = $('ce_novel_sel');
    if (!sel) return;
    const keys = await novel.listNovelRecords();
    sel.innerHTML = '';
    if (!keys.length) {
        const o = document.createElement('option');
        o.value = ''; o.textContent = '（暂无记录）';
        sel.appendChild(o);
        return;
    }
    keys.forEach((k) => {
        const o = document.createElement('option');
        o.value = k; o.textContent = k;
        sel.appendChild(o);
    });
}
