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
        return out ?? '';
    } catch (e) {
        // 若因携带未知参数（如 onDelta）失败，退化为不带回调的调用
        if (opts.onDelta) {
            const out = await c.generateRaw({ prompt });
            return out ?? '';
        }
        throw e;
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
};
