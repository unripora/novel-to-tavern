/**
 * generate.js —— AI 生成封装
 *
 * 迁移自原 index.html 的 chat()/generate()/retry() 逻辑，
 * 底层改为酒馆 generateRaw（见 st-bridge.js）。
 */

import { aiRaw } from './st-bridge.js';
import { stripThink } from './util.js';

/** 最近一次生成的 finish_reason（用于判断是否被截断） */
let lastFinish = '';

/** 是否发生截断 */
export function wasTruncated() {
    return /length|max_?tokens/i.test(lastFinish || '');
}

/** 判断错误是否为用户主动中止 */
export function isAbort(e, signal) {
    return (signal && signal.aborted) || (e && (e.name === 'AbortError' || /abort/i.test(e.message || '')));
}

/**
 * 带重试的底层生成（非流式）
 * @param {string|Array} prompt
 * @param {{signal?:AbortSignal, onWait?:(n:number,code:number,wait:number)=>void, tries?:number}} opts
 */
export async function chat(prompt, { signal, onWait, tries = 3 } = {}) {
    let attempt = 0;
    // 通过酒馆接口生成；不再抛 HTTP 状态码，重试针对网络/临时错误
    while (true) {
        attempt++;
        try {
            const out = await aiRaw(prompt, { signal });
            lastFinish = '';
            return out ?? '';
        } catch (e) {
            if (isAbort(e, signal)) throw e;
            if (attempt >= tries) throw e;
            const wait = Math.min(30000, 1000 * Math.pow(2, attempt));
            if (onWait) onWait(attempt, 0, wait);
            await new Promise((r) => setTimeout(r, wait));
        }
    }
}

/** 带重试的流式生成 */
export async function chatStream(prompt, { signal, onDelta, onWait, tries = 3 } = {}) {
    let attempt = 0;
    while (true) {
        attempt++;
        try {
            const out = await aiRaw(prompt, { signal, onDelta });
            lastFinish = '';
            return out ?? '';
        } catch (e) {
            if (isAbort(e, signal)) throw e;
            if (attempt >= tries) throw e;
            const wait = Math.min(30000, 1000 * Math.pow(2, attempt));
            if (onWait) onWait(attempt, 0, wait);
            await new Promise((r) => setTimeout(r, wait));
        }
    }
}

/**
 * 生成（支持流式 + 截断自动续写）
 * @param {string|Array} prompt
 * @param {Object} opts
 */
export async function generate(prompt, {
    useStream = false, signal, onText, onWait, maxCont = 0, logEl, label,
} = {}) {
    let full = '';
    for (let round = 0; round <= maxCont; round++) {
        let part = '';
        const p = round === 0
            ? prompt
            : appendContinue(prompt, full);
        if (useStream) {
            try {
                part = await chatStream(p, { signal, onDelta: (f) => { onText && onText(full + f); }, onWait });
            } catch (err) {
                if (isAbort(err, signal)) throw err;
                part = await chat(p, { signal, onWait });
            }
        } else {
            part = await chat(p, { signal, onWait });
        }
        full += part;
        onText && onText(full);
        if (!wasTruncated()) break;
        if (round < maxCont && logEl && onWait) {
            // 续写提示由调用方决定是否记录
        }
    }
    return full;
}

/** 构造续写用的 prompt（在 Chat 数组或字符串间兼容） */
function appendContinue(prompt, full) {
    if (Array.isArray(prompt)) {
        return prompt.concat([
            { role: 'assistant', content: stripThink(full) },
            { role: 'user', content: '上面的内容被截断了，请从中断处直接接着写，不要重复已经写过的内容，也不要重新开头或加任何说明。' },
        ]);
    }
    return String(prompt) + '\n\n' + stripThink(full)
        + '\n\n上面的内容被截断了，请从中断处直接接着写，不要重复已经写过的内容，也不要重新开头或加任何说明。';
}

export default { chat, chatStream, generate, wasTruncated, isAbort };
