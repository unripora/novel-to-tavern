/**
 * ui-novel.js —— 「小说」Tab
 */

import { flash } from './util.js';
import * as novel from './novel.js';
import { persistentAvailable, settings, persist, serverStatus } from './store.js';
import { $, state } from './ui-context.js';

export function renderNovelTab(box) {
    box.innerHTML = `
        <div class="ce-pane">
            <div class="ce-section">
                <label class="ce-label">导入小说正文</label>
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
            </div>
            <div class="ce-section">
                <label class="ce-label">已保存的记录</label>
                <div class="ce-rowline">
                    <select id="ce_novel_sel" class="text_pole" style="flex:1"></select>
                    <button type="button" class="menu_button" id="ce_novel_load">载入</button>
                    <button type="button" class="menu_button" id="ce_novel_save">保存当前</button>
                    <button type="button" class="menu_button" id="ce_novel_del">删除</button>
                </div>
                <p class="ce-tip">提示：导入后会自动保存到酒馆扩展存储（IndexedDB），刷新/重启不丢失。也可把文件直接拖到上方文本框。</p>
                <p class="ce-warn" id="ce_store_warn" style="display:none">
                    ⚠ 未检测到酒馆持久存储（localforage），当前数据仅存内存，刷新会丢失。
                </p>
            </div>
            <div class="ce-section">
                <label class="ce-label">服务器落盘（可选，需安装 Server Plugin）</label>
                <div class="ce-rowline">
                    <label class="checkbox_label">
                        <input type="checkbox" id="ce_srv_save"> 自动落盘到酒馆服务器
                    </label>
                    <button type="button" class="menu_button" id="ce_srv_check">检测插件</button>
                    <span id="ce_srv_msg" class="ce-msg"></span>
                </div>
                <p class="ce-tip">
                    开启后，小说正文与生成产物会同时写入酒馆服务器本地磁盘（<code>data/card-extractor-output/</code>）。
                    需在 NAS 上安装 Server Plugin「card-extractor-save」并开启 <code>enableServerPlugins</code>；
                    未安装或关闭时，本开关不生效，数据仍保存在 localforage。
                </p>
            </div>
        </div>`;

    const ta = $('ce_novel_text');
    const dz = $('ce_dropzone');
    ta.value = novel.previewOf(novel.getNovel());
    updateNovelStat();
    const cur = novel.getCurrentRecord();
    if (cur) flash('ce_novel_msg', '已恢复上次导入：' + cur);
    // 持久存储不可用时给出明确警告（否则用户无感知）
    if (!persistentAvailable()) {
        const w = $('ce_store_warn');
        if (w) w.style.display = 'block';
    }

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
    bindServerSaveUI();
}

/** 服务器落盘开关：绑定复选框、检测按钮与状态提示 */
function bindServerSaveUI() {
    const cb = $('ce_srv_save');
    const btn = $('ce_srv_check');
    if (!cb) return;
    cb.checked = !!settings().serverSaveEnabled;

    cb.addEventListener('change', async () => {
        const s = settings();
        s.serverSaveEnabled = cb.checked;
        persist();
        if (cb.checked) {
            flash('ce_srv_msg', '检测中…', false, { persist: true });
            const ok = await serverStatus(true);
            flash('ce_srv_msg', ok ? '已开启，产物将落盘到服务器' : '未检测到插件，开关已开启但不生效', !ok);
        } else {
            flash('ce_srv_msg', '已关闭服务器落盘');
        }
    });

    btn.addEventListener('click', async () => {
        flash('ce_srv_msg', '检测中…', false, { persist: true });
        const ok = await serverStatus(true);
        flash('ce_srv_msg', ok ? '插件可用 ✓' : '未检测到插件（请确认已安装并开启 enableServerPlugins）', !ok);
    });
}

async function importFile(f) {
    try {
        flash('ce_novel_msg', '读取中…');
        $('ce_load_prog').style.display = 'block';
        const { text, enc, record } = await novel.readNovelFile(f, (pct, label) => {
            $('ce_load_bar').style.width = pct + '%';
            const el = $('ce_novel_msg');
            if (el) el.textContent = label || '';
        });
        $('ce_novel_text').value = novel.previewOf(text);
        updateNovelStat();
        $('ce_load_prog').style.display = 'none';
        flash('ce_novel_msg', '已导入（编码 ' + enc + '），已自动存为记录「' + record + '」');
        refreshNovelList(record);
    } catch (e) {
        $('ce_load_prog').style.display = 'none';
        flash('ce_novel_msg', '读取失败：' + e.message, true);
    }
}

function updateNovelStat() {
    const el = $('ce_novel_stat');
    if (el) el.textContent = novel.getNovel().length.toLocaleString() + ' 字';
}

async function refreshNovelList(selectName) {
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
    const want = selectName || novel.getCurrentRecord();
    if (want && keys.includes(want)) sel.value = want;
}
