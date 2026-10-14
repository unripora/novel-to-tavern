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
 * 能力探测：检查某个 context 方法是否存在
 * @param {string} name 方法名
 */
export function hasApi(name) {
    const c = ctx();
    return !!(c && typeof c[name] === 'function');
}

/**
 * 裸生成：完全自定义 prompt，使用酒馆当前连接
 * @param {string|Array} prompt 字符串提示词，或 Chat Completion 消息数组
 * @param {{signal?:AbortSignal, onDelta?:(t:string)=>void}} opts
 * @returns {Promise<string>}
 */
export async function aiRaw(prompt, opts = {}) {
    const c = ctx();
    if (!c || typeof c.generateRaw !== 'function') {
        throw new Error('当前环境不支持 generateRaw，请在酒馆中使用本插件');
    }
    // 不同版本 generateRaw 参数略有差异，做兼容处理
    const args = { prompt };
    if (opts.onDelta) args.onDelta = opts.onDelta;
    try {
        const out = await c.generateRaw(args);
        // 部分版本 generateRaw 返回对象（含 content / finish_reason），统一取文本
        return extractText(out);
    } catch (e) {
        // 若因携带未知参数（如 onDelta）失败，退化为不带回调的调用
        if (opts.onDelta) {
            const out = await c.generateRaw({ prompt });
            return extractText(out);
        }
        throw e;
    }
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
 * 酒馆未稳定暴露 finish_reason，这里用多信号综合判断：
 *   ① 输出长度逼近本次请求的 max_tokens 上限（最强信号）
 *   ② 结尾结构未闭合（YAML 冒号/逗号/连字符、未闭合代码块、未闭合括号）
 *   ③ 结尾是明显的「未写完」词（如单字「未」、以逗号后的短片段收尾）
 * @param {string} text 生成文本
 * @param {number} maxTokens 本次请求的 max_tokens（可空）
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

    // ② 结尾结构未闭合
    if (/[:,|\-]$/.test(tail)) return true;
    if ((tail.match(/```/g) || []).length % 2 === 1) return true;
    if (/[（(\[【「『<]$/.test(tail)) return true;

    // ③ 结尾是「未」「无」等单字占位、或极短片段收尾（常为截断特征）
    if (/[:：]\s*[未无]$/.test(tail)) return true;

    return false;
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
};
