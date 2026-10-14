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
    };

    // 回填
    for (const [id, key] of Object.entries(map)) {
        const el = $(id);
        if (el) el.value = s[key] ?? '';
    }
    const think = $('ce_show_think');
    if (think) think.checked = !!s.showThink;

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
        let html = '';
        if (context?.renderExtensionTemplateAsync) {
            html = await context.renderExtensionTemplateAsync('third-party/card-extractor', 'settings');
        }
        if (!html) {
            // 兜底：直接内联模板（便于非酒馆环境调试）
            html = '<div class="ce-settings">角色卡提取工具已加载（模板渲染不可用）</div>';
        }
        jQuery('#extensions_settings2').append(html);

        bindSettings();
        bindModal();

        console.log('[card-extractor] 初始化完成', inTavern() ? '(酒馆环境)' : '(非酒馆环境)');
    } catch (e) {
        console.error('[card-extractor] 初始化异常', e);
    }
});
