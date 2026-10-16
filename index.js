/**
 * index.js —— 插件入口
 *
 * 职责：
 * 1. 初始化扩展设置
 * 2. 渲染设置面板并挂载到酒馆扩展设置区
 * 3. 绑定设置项与主面板开关
 *
 * 注意：本文件保持精简，业务逻辑分散在 src/ 各模块。
 */

import { MODULE_NAME, settings, persist } from './src/store.js';
import { ctx, inTavern } from './src/st-bridge.js';
import { restoreLastNovel } from './src/novel.js';

/** 绑定设置面板输入项 */
function bindSettings() {
    const s = settings();
    const $ = (id) => document.getElementById(id);

    const map = {
        ce_chunk_size: 'chunkSize',
        ce_scan_cap: 'scanCap',
        ce_ctx_cap: 'ctxCap',
        ce_full_cap: 'fullCap',
        ce_sys_prefix: 'sysPrefix',
        ce_max_tokens: 'maxTokens',
    };

    // 回填
    for (const [id, key] of Object.entries(map)) {
        const el = $(id);
        if (el) el.value = s[key] ?? '';
    }
    const think = $('ce_show_think');
    if (think) think.checked = !!s.showThink;
    const useGlobal = $('ce_use_global_resp');
    const customBox = $('ce_custom_resp_box');
    if (useGlobal) useGlobal.checked = !!s.useGlobalResp;
    // 勾选「使用酒馆全局设置」时隐藏自定义输入框
    const syncRespBox = () => {
        if (customBox) customBox.style.display = (useGlobal && useGlobal.checked) ? 'none' : 'block';
    };
    syncRespBox();
    if (useGlobal) useGlobal.addEventListener('change', () => {
        s.useGlobalResp = useGlobal.checked;
        persist();
        syncRespBox();
    });
    const autoCont = $('ce_auto_cont');
    if (autoCont) autoCont.checked = !!s.autoCont;

    // 保存
    const save = $('ce_save_settings');
    if (save) {
        save.addEventListener('click', () => {
            for (const [id, key] of Object.entries(map)) {
                const el = $(id);
                if (!el) continue;
                s[key] = el.type === 'number' ? Number(el.value) : el.value;
            }
            if (think) s.showThink = think.checked;
            if (useGlobal) s.useGlobalResp = useGlobal.checked;
            if (autoCont) s.autoCont = autoCont.checked;
            persist();
            flash('ce_settings_msg', '已保存', false);
        });
    }
}

function flash(id, msg, isErr) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className = 'ce-msg ' + (isErr ? 'err' : 'ok');
    setTimeout(() => { el.textContent = ''; el.className = 'ce-msg'; }, 2600);
}

/** 绑定主面板开关 */
function bindModal() {
    const open = document.getElementById('ce_open_panel');
    const modal = document.getElementById('ce_modal');
    const close = document.getElementById('ce_modal_close');
    if (open && modal) {
        open.addEventListener('click', () => {
            modal.style.display = 'block';
            // 面板内容延迟加载，避免拖慢启动
            import('./src/ui.js').then((m) => m.mountUI()).catch((e) => {
                console.error('[card-extractor] 面板加载失败', e);
            });
        });
    }
    if (close && modal) {
        close.addEventListener('click', () => { modal.style.display = 'none'; });
    }
    if (modal) {
        const mask = modal.querySelector('.ce-modal-mask');
        if (mask) mask.addEventListener('click', () => { modal.style.display = 'none'; });
    }
}

/** 探测本扩展在酒馆中的真实文件夹名（如 third-party/novel-to-tavern） */
function detectExtensionFolder() {
    try {
        const url = import.meta.url || '';
        // .../scripts/extensions/third-party/<folder>/index.js
        const m = url.match(/extensions\/(.+)\/[^/]+\.js(?:\?|$)/);
        if (m && m[1]) return m[1];
    } catch (e) { /* ignore */ }
    return '';
}

/** 内联设置面板 HTML（不依赖模板文件路径，作为兜底与首选） */
const SETTINGS_HTML = `
<div class="ce-settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>角色卡提取工具</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <p class="ce-hint">
                导入小说 · 扫描角色 · 按模板抽取角色卡 / 世界书 / 人设 / 文风。
                <b>使用酒馆当前接口</b>，无需另填 API。
            </p>
            <div class="ce-btnrow">
                <button type="button" class="menu_button" id="ce_open_panel">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> 打开角色卡提取工具
                </button>
            </div>
            <div class="ce-section">
                <label class="ce-label">扫描参数</label>
                <div class="ce-grid">
                    <div class="ce-field">
                        <span>扫描分段大小（字符）</span>
                        <input type="number" id="ce_chunk_size" class="text_pole" step="5000" min="10000">
                    </div>
                    <div class="ce-field">
                        <span>扫描段数上限</span>
                        <input type="number" id="ce_scan_cap" class="text_pole" step="5" min="1">
                    </div>
                    <div class="ce-field">
                        <span>相关段落上下文上限</span>
                        <input type="number" id="ce_ctx_cap" class="text_pole" step="10000" min="10000">
                    </div>
                    <div class="ce-field">
                        <span>全文模式上下文上限</span>
                        <input type="number" id="ce_full_cap" class="text_pole" step="10000" min="10000">
                    </div>
                </div>
                <label class="checkbox_label">
                    <input type="checkbox" id="ce_show_think">
                    <span>显示思考过程（保留思考型模型的 &lt;think&gt; 内容）</span>
                </label>
            </div>
            <div class="ce-section">
                <label class="ce-label">生成参数</label>
                <label class="checkbox_label">
                    <input type="checkbox" id="ce_use_global_resp">
                    <span>使用酒馆全局设置</span>
                </label>
                <div id="ce_custom_resp_box">
                    <p class="ce-hint" style="margin:4px 0 8px">
                        未勾选时，插件会在生成时**临时**把酒馆的响应长度设为下面的值，生成后立即还原，
                        因此不受酒馆「最大回复长度」滑块限制，也不影响酒馆正常对话。
                    </p>
                    <div class="ce-grid">
                        <div class="ce-field">
                            <span>插件内输出上限（tokens）</span>
                            <input type="number" id="ce_max_tokens" class="text_pole" step="500" min="256">
                        </div>
                    </div>
                </div>
                <label class="checkbox_label">
                    <input type="checkbox" id="ce_auto_cont">
                    <span>截断时自动续写补全</span>
                </label>
            </div>
            <div class="ce-section">
                <label class="ce-label">附加系统提示（可选）</label>
                <textarea id="ce_sys_prefix" class="text_pole" rows="3"
                    placeholder="会加在每次请求最前面，对扫描 / 生成 / 世界书 / 文风都生效。留空则用工具内置提示词。"></textarea>
            </div>
            <div class="ce-btnrow">
                <button type="button" class="menu_button" id="ce_save_settings">保存设置</button>
                <span class="ce-msg" id="ce_settings_msg"></span>
            </div>
        </div>
    </div>
</div>

<div class="ce-modal" id="ce_modal" style="display:none">
    <div class="ce-modal-mask"></div>
    <div class="ce-modal-body">
        <div class="ce-modal-head">
            <b>角色卡提取工具</b>
            <span class="ce-modal-close" id="ce_modal_close"><i class="fa-solid fa-xmark"></i></span>
        </div>
        <div class="ce-modal-tabs" id="ce_tabs">
            <button type="button" class="ce-tab active" data-tab="novel">小说</button>
            <button type="button" class="ce-tab" data-tab="timeline">时间线</button>
            <button type="button" class="ce-tab" data-tab="card">角色卡</button>
            <button type="button" class="ce-tab" data-tab="persona">人设</button>
            <button type="button" class="ce-tab" data-tab="world">世界书</button>
            <button type="button" class="ce-tab" data-tab="worldcard">角色 &amp; 世界</button>
            <button type="button" class="ce-tab" data-tab="style">文风</button>
            <button type="button" class="ce-tab" data-tab="first">开场白</button>
            <button type="button" class="ce-tab" data-tab="check">自检</button>
            <button type="button" class="ce-tab" data-tab="history">历史</button>
        </div>
        <div class="ce-modal-content" id="ce_content">
            <div class="ce-placeholder">面板加载中…</div>
        </div>
    </div>
</div>`;

/** 把设置面板挂载到酒馆扩展设置区 */
async function mountSettings(context) {
    let html = '';
    // 优先用酒馆模板渲染（能正确本地化）；用探测到的真实文件夹名
    const folder = detectExtensionFolder();
    if (context?.renderExtensionTemplateAsync && folder) {
        try {
            html = await context.renderExtensionTemplateAsync(folder, 'settings');
        } catch (e) {
            console.warn('[card-extractor] 模板渲染失败，改用内联模板', e);
        }
    }
    // 兜底：内联模板
    if (!html) html = SETTINGS_HTML;

    const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (target) target.insertAdjacentHTML('beforeend', html);
    else console.warn('[card-extractor] 未找到扩展设置容器，跳过挂载');
}

/** 入口 */
jQuery(async () => {
    try {
        const context = ctx();
        if (!context) {
            console.warn('[card-extractor] 未检测到酒馆上下文，插件可能未在酒馆中运行');
        }
        // 初始化设置
        settings();

        // 渲染并挂载设置面板
        await mountSettings(context);

        bindSettings();
        bindModal();

        // 恢复上次导入的正文（刷新/重启后不丢）
        restoreLastNovel().then((text) => {
            if (text) console.log('[card-extractor] 已恢复上次正文 ' + text.length + ' 字');
        }).catch(() => {});

        console.log('[card-extractor] 初始化完成', inTavern() ? '(酒馆环境)' : '(非酒馆环境)');
    } catch (e) {
        console.error('[card-extractor] 初始化异常', e);
    }
});
