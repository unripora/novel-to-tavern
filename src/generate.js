/**
 * generate.js —— AI 生成封装
 *
 * 迁移自原 index.html 的 chat()/generate()/retry() 逻辑，
 * 底层改为酒馆 generateRaw（见 st-bridge.js）。
 */

import { aiRaw, looksTruncated } from './st-bridge.js';
import { stripThink, logTo } from './util.js';
import { settings } from './store.js';

/** 最近一次生成的 finish_reason（用于判断是否被截断，酒馆未必提供） */
let lastFinish = '';

/** 是否发生截断（finish_reason 精确判断） */
export function wasTruncated() {
    return /length|max_?tokens/i.test(lastFinish || '');
}

/**
 * 综合判断是否被截断：
 * ① finish_reason 明确为 length/max_tokens（若酒馆提供）
 * ② 启发式：结尾结构未闭合（YAML/JSON/代码块/括号）
 * @param {string} text
 * @param {number} maxTokens
 */
export function detectTruncated(text, maxTokens) {
    if (wasTruncated()) return true;
    return looksTruncated(text, maxTokens);
}

/** 判断错误是否为用户主动中止 */
export function isAbort(e, signal) {
    return (signal && signal.aborted) || (e && (e.name === 'AbortError' || /abort/i.test(e.message || '')));
}

/**
 * 带重试的底层生成（非流式）
 * @param {string|Array} prompt
 * @param {{signal?:AbortSignal, onWait?:Function, tries?:number, maxTokens?:number|string}} opts
 */
export async function chat(prompt, { signal, onWait, tries = 3, maxTokens, onDiag } = {}) {
    let attempt = 0;
    // 通过酒馆接口生成；不再抛 HTTP 状态码，重试针对网络/临时错误
    while (true) {
        attempt++;
        try {
            const out = await aiRaw(prompt, { signal, maxTokens, onDiag });
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
export async function chatStream(prompt, { signal, onDelta, onWait, tries = 3, maxTokens, onDiag } = {}) {
    let attempt = 0;
    while (true) {
        attempt++;
        try {
            const out = await aiRaw(prompt, { signal, onDelta, maxTokens, onDiag });
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
 *   maxTokens：传给酒馆的 max_tokens（数字；不传则用设置里的 maxTokens）
 */
export async function generate(prompt, {
    useStream = false, signal, onText, onWait, maxCont = 0, logEl, label, maxTokens, onDiag,
} = {}) {
    const s = settings();
    // 输出上限取值：
    //   显示传入 > 「使用酒馆全局设置」时用 'unset'（=不改酒馆） > 用插件自定义 maxTokens
    const mt = (maxTokens != null) ? maxTokens : (s.useGlobalResp ? 'unset' : s.maxTokens);
    // 长度判据用「数值」形式（'unset' 时不做长度判定，仅靠结构判定）
    const mtNum = (typeof mt === 'number') ? mt : 0;
    // 诊断回调：写控制台 + 面板日志区
    const diagCb = (msg, isErr) => {
        if (onDiag) { try { onDiag(msg, isErr); } catch (e) { /* ignore */ } }
        if (logEl) logTo(logEl, (label ? label + ' · ' : '') + '[调用] ' + msg, isErr ? 'e' : '');
    };
    let full = '';
    for (let round = 0; round <= maxCont; round++) {
        let part = '';
        const p = round === 0
            ? prompt
            : appendContinue(prompt, full);
        if (useStream) {
            try {
                part = await chatStream(p, { signal, onDelta: (f) => { onText && onText(full + f); }, onWait, maxTokens: mt, onDiag: diagCb });
            } catch (err) {
                if (isAbort(err, signal)) throw err;
                part = await chat(p, { signal, onWait, maxTokens: mt, onDiag: diagCb });
            }
        } else {
            part = await chat(p, { signal, onWait, maxTokens: mt, onDiag: diagCb });
        }
        full += part;
        onText && onText(full);
        // 综合判断是否截断：本轮的 finish/长度 + 结构未闭合
        // 注意：长度判据只看本轮输出（续写后 full 必然更长，用 full 会误判）
        const t1 = detectTruncated(part, mtNum);
        const t2 = looksTruncated(full);
        const diagMsg = '本轮长度:' + part.length + ' | max_tokens=' + mt +
            ' | 截断判定: 结构=' + t1 + ' 全文=' + t2 + ' | 轮次 ' + (round + 1) + '/' + (maxCont + 1);
        console.log('[card-extractor][generate]', label || '', diagMsg);
        if (logEl) logTo(logEl, (label ? label + ' ' : '') + diagMsg, (t1 || t2) ? 'w' : '');
        if (!t1 && !t2) break;
        if (round >= maxCont) break;
        if (logEl) logTo(logEl, (label ? label + ' ' : '') + '检测到截断，自动续写（第 ' + (round + 1) + ' 次）…', 'w');
    }
    return full;
}

/** 构造续写用的 prompt（在 Chat 数组或字符串间兼容） */
function appendContinue(prompt, full) {
    const rule = '上面的内容被截断了，请**从中断处直接接着写**：' +
        '不要重复已经写过的内容，不要重新开头，不要加任何解释或说明。' +
        '如果中断处在 YAML 结构内部，请**严格保持原有缩进层级**继续，把未写完的字段补完，并确保整体结构闭合。';
    if (Array.isArray(prompt)) {
        return prompt.concat([
            { role: 'assistant', content: stripThink(full) },
            { role: 'user', content: rule },
        ]);
    }
    return String(prompt) + '\n\n' + stripThink(full) + '\n\n' + rule;
}

export default { chat, chatStream, generate, wasTruncated, detectTruncated, isAbort };
