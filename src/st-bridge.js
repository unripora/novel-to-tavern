/**
 * st-bridge.js —— 与 SillyTavern 耦合的唯一适配层
 *
 * 设计原则：
 * 1. 所有对酒馆 API 的调用都收敛在本文件，便于版本适配与降级。
 * 2. 上层业务代码只依赖本文件导出的函数，不直接触碰 SillyTavern 内部 API。
 */

/** 获取酒馆上下文（每次实时获取，避免缓存失效） */
export function ctx() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

/** 是否运行在酒馆环境中 */
export function inTavern() {
    return !!ctx();
}

/**
 * 临时覆盖酒馆的「响应长度」设置，执行 fn，随后**必定还原**。
 *
 * 原理：generateRaw 会读取酒馆当前的连接配置来决定输出上限
 * （Chat Completion → oai_settings.openai_max_tokens；
 *   Text Completion → textgenerationwebui_settings.max_length）。
 * 这里在生成前临时改大、生成后立刻改回，从而：
 *   ✅ 插件内生成不受酒馆滑块限制
 *   ✅ 酒馆界面滑块数值不变、不影响正常对话
 *
 * @param {number|string|undefined} maxTokens 目标上限（数字；'unset'/undefined 时不改）
 * @param {() => Promise<any>} fn 要执行的生成逻辑
 * @returns {Promise<any>}
 */
export async function withLengthOverride(maxTokens, fn) {
    const n = Number(maxTokens);
    if (!Number.isFinite(n) || n <= 0) return fn();   // 'unset' 或无效值：不改设置

    const c = ctx();
    const oai = c?.chatCompletionSettings;             // = oai_settings
    const tgs = c?.textCompletionSettings;             // = textgenerationwebui_settings
    const saved = [];

    // 备份并覆盖（两个后端都改，兼容 Chat / Text Completion）
    try {
        if (oai && Object.hasOwn(oai, 'openai_max_tokens')) {
            saved.push(['oai', oai, 'openai_max_tokens', oai.openai_max_tokens]);
            oai.openai_max_tokens = n;
        }
    } catch (e) { /* 忽略 */ }
    try {
        if (tgs && Object.hasOwn(tgs, 'max_length')) {
            saved.push(['tgs', tgs, 'max_length', tgs.max_length]);
            tgs.max_length = n;
        }
    } catch (e) { /* 忽略 */ }

    try {
        return await fn();
    } finally {
        // 无条件还原，保证不影响酒馆正常对话
        for (const [, obj, key, val] of saved) {
            try { obj[key] = val; } catch (e) { /* 忽略 */ }
        }
    }
}

/**
 * 能力探测：检查某个 context 方法是否存在
 * @param {string} name 方法名
 */
export function hasApi(name) {
    const c = ctx();
    return !!(c && typeof c[name] === 'function');
}

/**
 * 裸生成：完全自定义 prompt，使用酒馆当前连接
 *
 * 兼容两种 generateRaw 签名：
 *   A) 对象形式 generateRaw({ prompt, max_tokens, onDelta })  —— JS-Slash-Runner 等
 *   B) 位置参数 generateRaw(prompt, ...)                     —— 原生酒馆
 * 先试 A（可携带 max_tokens 提升输出上限），失败再退 B。
 *
 * @param {string|Array} prompt 字符串提示词，或 Chat Completion 消息数组
 * @param {{signal?:AbortSignal, onDelta?:(t:string)=>void, maxTokens?:number|string}} opts
 *        maxTokens：传给酒馆的 max_tokens（数字，或 'unset' 表示不限制）
 * @returns {Promise<string>}
 */
export async function aiRaw(prompt, opts = {}) {
    const c = ctx();
    if (!c || typeof c.generateRaw !== 'function') {
        throw new Error('当前环境不支持 generateRaw，请在酒馆中使用本插件');
    }

    // 临时覆盖酒馆「响应长度」，绕过酒馆滑块限制（生成后自动还原）
    return withLengthOverride(opts.maxTokens, async () => {
        // —— 方案 A：对象形式（可带 max_tokens）——
        const objArgs = { prompt };
        if (opts.onDelta) objArgs.onDelta = opts.onDelta;
        if (opts.maxTokens != null) objArgs.max_tokens = opts.maxTokens;
        try {
            const out = await c.generateRaw(objArgs);
            diag(opts, 'A 对象形式成功', objArgs.max_tokens, out);
            return extractText(out);
        } catch (eA) {
            diag(opts, 'A 对象形式失败', objArgs.max_tokens, eA);
            // 对象形式失败，继续尝试其它签名（不要把致命错误吞掉：最后会重抛）
            // —— 方案 B：位置参数形式（原生酒馆）——
            try {
                const out = await c.generateRaw(prompt);
                diag(opts, 'B 位置参数成功', '(无 max_tokens)', out);
                return extractText(out);
            } catch (eB) {
                diag(opts, 'B 位置参数失败', '', eB);
                // —— 方案 C：回退到最简对象形式（不带 max_tokens / onDelta）——
                try {
                    const out = await c.generateRaw({ prompt });
                    diag(opts, 'C 最简对象成功', '(无 max_tokens)', out);
                    return extractText(out);
                } catch (eC) {
                    diag(opts, 'C 最简对象失败', '', eC);
                    // 三种都失败：抛出首个错误，便于定位
                    throw eA;
                }
            }
        }
    });
}

/** 诊断输出：写控制台 + 可选回调（面板日志区），不影响功能 */
function diag(opts, step, mt, payload) {
    let msg;
    try {
        const c = ctx();
        const oai = c?.chatCompletionSettings;
        const tgs = c?.textCompletionSettings;
        const cur = 'oai.openai_max_tokens=' + (oai ? oai.openai_max_tokens : 'N/A') +
            ' | tgs.max_length=' + (tgs ? tgs.max_length : 'N/A');
        if (payload instanceof Error) {
            msg = step + ' | max_tokens=' + mt + ' | ' + cur + ' | 错误: ' + payload.message;
        } else {
            const text = extractText(payload);
            msg = step + ' | max_tokens=' + mt + ' | ' + cur +
                ' | 返回长度:' + text.length + ' | 结尾:' + JSON.stringify(text.slice(-20));
        }
        console.log('[card-extractor][aiRaw]', msg);
        if (opts && typeof opts.onDiag === 'function') opts.onDiag(msg, payload instanceof Error);
    } catch (e) { /* 诊断不影响主流程 */ }
}

/**
 * 从 generateRaw 的返回值中提取文本
 * 兼容：字符串 / { content } / { text } / { message.content }
 */
function extractText(out) {
    if (out == null) return '';
    if (typeof out === 'string') return out;
    if (typeof out === 'object') {
        if (typeof out.content === 'string') return out.content;
        if (typeof out.text === 'string') return out.text;
        if (out.message && typeof out.message.content === 'string') return out.message.content;
    }
    return String(out);
}

/**
 * 探测最近一次生成的截断迹象（启发式）
 *
 * 背景：酒馆/上游 API 常常在固定长度硬截断（如 512 token ≈ 500 中文字），
 * 而不暴露 finish_reason，且 max_tokens='unset' 也可能被忽略。
 * 因此改为「结构完整性」为主的判定：
 *   ① 长度逼近本次请求的 max_tokens 上限（数值有效时）
 *   ② 结构化输出（YAML / JSON）是否闭合 —— 最强信号
 *   ③ 结尾未闭合的括号 / 代码块 / 占位词
 *
 * @param {string} text 生成文本
 * @param {number} maxTokens 本次请求的 max_tokens（数值；'unset'/0 时跳过长度判定）
 * @returns {boolean} 是否疑似被截断
 */
export function looksTruncated(text, maxTokens) {
    const t = String(text || '');
    if (!t.trim()) return false;
    const tail = t.trimEnd();

    // ① 长度逼近上限：中文约 1.5 字符/token，取 0.85 作为容差阈值
    if (Number.isFinite(maxTokens) && maxTokens > 0) {
        const capChars = maxTokens * 1.5;
        if (t.length >= capChars * 0.85) return true;
    }

    // ② 结构化输出未闭合（YAML / JSON）—— 关键判据
    if (looksIncomplete(t)) return true;

    // ③ 结尾是未闭合的结构字符
    if (/[:,|\-]$/.test(tail)) return true;
    if ((tail.match(/```/g) || []).length % 2 === 1) return true;
    if (/[（(\[【「『<]$/.test(tail)) return true;
    if (/[:：]\s*[未无]$/.test(tail)) return true;

    return false;
}

/**
 * 判断「结构化文本」（YAML 角色卡 / JSON 数组）是否疑似未写完
 *
 * 判定思路（不依赖结尾字符，而看整体结构）：
 *   - JSON：能提取到以 [ 或 { 开头但括号/引号未配平 → 未闭合
 *   - YAML：正常写完的卡片应「有多个顶层键且末尾不是半句」；
 *     若末尾行是缩进的 `key: 值` 且**值明显被切断**（无句末标点、且下一行不存在），
 *     或末尾行以列表项 `- ` 开头后无内容，则视为未写完
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksIncomplete(text) {
    const t = String(text || '').trim();
    if (!t) return false;

    // —— JSON 结构：括号/引号配平检测 ——
    if (/^[\[{]/.test(t)) {
        let depth = 0, inStr = false, esc = false;
        for (const ch of t) {
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '[' || ch === '{') depth++;
            else if (ch === ']' || ch === '}') depth--;
        }
        return depth > 0 || inStr;   // 括号未配平或字符串未闭合 → 未写完
    }

    const lines = t.split(/\r?\n/);
    // 去掉末尾空行，取最后一行有效内容
    let last = '';
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim()) { last = lines[i]; break; }
    }
    if (!last) return false;

    const lastTrim = last.trim();

    // —— YAML 列表项写到一半：`-` 后无内容 ——
    if (/^-\s*$/.test(lastTrim)) return true;

    // —— YAML 末尾是 `key:`（冒号后无值）——
    if (/^[\w\u4e00-\u9fa5"'\-\s]+:\s*$/.test(lastTrim)) return true;

    // —— YAML 末尾是 `key: 值` 但值是半句（无句末标点、且像被切断）——
    const kv = lastTrim.match(/^([\w\u4e00-\u9fa5"'\-\s]+)[:：]\s*(.+)$/);
    if (kv) {
        const val = kv[2].trim();
        // 值为空、或明显未结束（不以收尾符号结尾，且长度较长像被硬切）
        if (!val) return true;
        const closed = /[。！？.!?；;」』】）)\]}"'`~、，,]$/.test(val);
        if (!closed && val.length >= 12) return true;
    }

    return false;
}

/* ==================== 服务器落盘（Server Plugin） ==================== */

/**
 * 服务器落盘插件信息。
 *
 * 原理：UI 扩展运行在浏览器上下文，无法写服务器磁盘。真正的落盘由酒馆的
 * Server Plugin（card-extractor-save，运行在 Node 进程）完成，本层只是调用方。
 * 插件未安装 / 未开启时，这里的所有调用会失败，上层应自动回退到 localforage。
 */
const SAVE_PLUGIN_ID = 'card-extractor-save';
const SAVE_BASE = '/api/plugins/' + SAVE_PLUGIN_ID;

/** 是否具备服务器落盘插件（缓存探测结果） */
let _saveAvail = null;

/**
 * 探测服务器落盘插件是否可用（GET /ping）。
 * @param {boolean} [force] 是否强制重新探测
 * @returns {Promise<boolean>}
 */
export async function serverAvailable(force = false) {
    if (_saveAvail !== null && !force) return _saveAvail;
    try {
        const res = await fetch(SAVE_BASE + '/ping', { method: 'GET' });
        const data = await res.json();
        _saveAvail = !!(res.ok && data && data.ok);
    } catch (e) {
        _saveAvail = false;
    }
    return _saveAvail;
}

/**
 * 保存文本到酒馆服务器本地磁盘。
 * @param {string} relPath 相对落盘根目录的路径，如 'worldbook/ch01.json'
 * @param {string} content 文本内容
 * @returns {Promise<{ok:boolean, path?:string, message?:string}>}
 */
export async function serverSave(relPath, content) {
    try {
        const res = await fetch(SAVE_BASE + '/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: relPath, content: content == null ? '' : String(content) }),
        });
        const data = await res.json();
        return data && typeof data === 'object' ? data : { ok: res.ok };
    } catch (e) {
        return { ok: false, message: e.message };
    }
}

/**
 * 列出服务器已落盘的文件。
 * @param {string} [dir] 相对子目录（省略则列根目录下全部）
 * @returns {Promise<string[]>} 相对路径列表
 */
export async function serverList(dir) {
    try {
        const url = SAVE_BASE + '/list' + (dir ? ('?dir=' + encodeURIComponent(dir)) : '');
        const res = await fetch(url, { method: 'GET' });
        const data = await res.json();
        return (data && data.ok && Array.isArray(data.files)) ? data.files : [];
    } catch (e) {
        return [];
    }
}

/**
 * 读取服务器落盘的文件内容。
 * @param {string} relPath
 * @returns {Promise<string|null>}
 */
export async function serverRead(relPath) {
    try {
        const res = await fetch(SAVE_BASE + '/read?path=' + encodeURIComponent(relPath), { method: 'GET' });
        const data = await res.json();
        return (data && data.ok) ? String(data.content ?? '') : null;
    } catch (e) {
        return null;
    }
}

/**
 * 删除服务器落盘的文件。
 * @param {string} relPath
 * @returns {Promise<boolean>}
 */
export async function serverDel(relPath) {
    try {
        const res = await fetch(SAVE_BASE + '/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: relPath }),
        });
        const data = await res.json();
        return !!(data && data.ok);
    } catch (e) {
        return false;
    }
}

/**
 * 静默生成：借用酒馆的 prompt 构建流程（可选能力）
 * @param {string} quietPrompt
 */
export async function aiQuiet(quietPrompt) {
    const c = ctx();
    if (!c || typeof c.generateQuietPrompt !== 'function') {
        return aiRaw(quietPrompt);
    }
    const out = await c.generateQuietPrompt({ quietPrompt });
    return out ?? '';
}

/**
 * 宏替换：把 {{user}} / {{char}} 等替换为酒馆当前值
 * @param {string} text
 */
export function substitute(text) {
    const c = ctx();
    if (c && typeof c.substituteParams === 'function') {
        try { return c.substituteParams(text); } catch (e) { /* 忽略，回退原文本 */ }
    }
    return text;
}

/** 获取酒馆当前用户名（用于 {{user}} 兜底） */
export function currentUserName() {
    const c = ctx();
    return c?.name1 || 'user';
}

/** 获取酒馆当前角色名 */
export function currentCharName() {
    const c = ctx();
    return c?.name2 || 'char';
}

export default {
    ctx, inTavern, hasApi, aiRaw, aiQuiet, substitute,
    currentUserName, currentCharName,
    serverAvailable, serverSave, serverList, serverRead, serverDel,
};
