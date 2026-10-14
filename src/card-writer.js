/**
 * card-writer.js —— 角色卡写入酒馆
 *
 * 新增能力：把生成/编辑后的角色卡数据写入酒馆。
 * 策略：优先「直接创建角色」；失败或环境不支持时，回退「导出 .json 由用户手动导入」。
 */

import { ctx } from './st-bridge.js';
import { stripFence, stripThink } from './util.js';

/**
 * 把角色卡文本解析为结构化字段（对齐酒馆 Character Card V2）
 * 兼容「YAML 式模板文本」与「JSON」两种输入。
 * @param {string} text
 * @param {{name?:string}} fallback
 */
export function parseCard(text, fallback = {}) {
    const raw = stripThink(stripFence(text || '')).trim();
    const card = {
        name: fallback.name || '',
        description: '',
        personality: '',
        scenario: '',
        first_mes: '',
        mes_example: '',
        creator_notes: '',
        tags: [],
        // 原始模板正文，作为角色描述主体保留
        raw,
    };

    // 尝试 JSON
    if (/^[\[{]/.test(raw)) {
        try {
            const obj = JSON.parse(raw);
            const o = Array.isArray(obj) ? obj[0] : obj;
            return Object.assign(card, normalizeCardObject(o));
        } catch (e) { /* 非 JSON，按文本处理 */ }
    }

    // 文本解析：抽取常见字段
    const pick = (label) => {
        const re = new RegExp(label + '\\s*[:：]\\s*([^\\n]+)', 'i');
        const m = raw.match(re);
        return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
    };
    card.name = card.name || pick('Chinese name') || pick('char_name') || pick('name');
    card.personality = pick('archetype') || pick('personality');
    card.creator_notes = '由「角色卡提取工具」插件生成';
    return card;
}

/** 规范化酒馆角色对象字段 */
function normalizeCardObject(o) {
    if (!o || typeof o !== 'object') return {};
    return {
        name: o.name || o.char_name || '',
        description: o.description || '',
        personality: o.personality || '',
        scenario: o.scenario || '',
        first_mes: o.first_mes || '',
        mes_example: o.mes_example || '',
        creator_notes: o.creator_notes || '',
        tags: Array.isArray(o.tags) ? o.tags : [],
    };
}

/**
 * 写入酒馆角色
 * 依次尝试：① /char-create 斜杠命令 → ② /api/characters/create 接口 → ③ 导出 .json 兜底
 * @param {object} card 结构化角色卡
 * @param {{onLog?:(m:string,e?:boolean)=>void}} [opts]
 * @returns {Promise<{ok:boolean, mode:string, message:string, error?:string}>}
 */
export async function writeCharacterToTavern(card, { onLog } = {}) {
    const c = ctx();
    if (!c) return { ok: false, mode: 'none', message: '未检测到酒馆环境' };
    const log = (m, e) => { console.log('[card-extractor][char-write]', m); if (onLog) onLog(m, e); };
    const errs = [];

    // ① 斜杠命令 /char-create（酒馆官方推荐，兼容性最好）
    try {
        const ok = await trySlashCreate(c, card, log);
        if (ok) return { ok: true, mode: 'slash', message: '已创建角色：' + card.name };
    } catch (e) { errs.push('slash: ' + e.message); log('/char-create 失败：' + e.message, true); }

    // ② 直接调 API 接口
    try {
        const ok = await tryCreateCharacter(c, card, log);
        if (ok) return { ok: true, mode: 'direct', message: '已创建角色：' + card.name };
    } catch (e) { errs.push('api: ' + e.message); log('API 创建失败：' + e.message, true); }

    // ③ 兜底：导出 .json
    exportCardJson(card);
    return {
        ok: false, mode: 'export',
        message: '无法直接写入酒馆，已导出角色卡文件。请在酒馆「角色管理 → 导入角色」中手动导入。'
            + (errs.length ? '（原因：' + errs.join('；') + '）' : ''),
        error: errs.join('；'),
    };
}

/**
 * 用斜杠命令 /char-create 创建角色
 * 参数以转义后的字符串传入，避免逗号/引号破坏命令解析。
 */
async function trySlashCreate(c, card, log) {
    if (typeof c.executeSlashCommandsWithOptions !== 'function') return false;
    const esc = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const parts = ['/char-create'];
    parts.push('name="' + esc(card.name || '未命名角色') + '"');
    if (card.description || card.raw) parts.push('description="' + esc(card.description || card.raw) + '"');
    if (card.personality) parts.push('personality="' + esc(card.personality) + '"');
    if (card.scenario) parts.push('scenario="' + esc(card.scenario) + '"');
    if (card.first_mes) parts.push('first_mes="' + esc(card.first_mes) + '"');
    if (card.mes_example) parts.push('mes_example="' + esc(card.mes_example) + '"');
    if (card.creator_notes) parts.push('creator_notes="' + esc(card.creator_notes) + '"');
    const cmd = parts.join(' ');
    log('执行 ' + cmd.slice(0, 80) + '…');
    const res = await c.executeSlashCommandsWithOptions(cmd, { showOutput: false });
    // 命令执行成功一般返回 undefined 或字符串；抛错才是失败
    return res !== null && res !== false;
}

/**
 * 尝试直接创建角色（调 /api/characters/create 接口）
 */
async function tryCreateCharacter(c, card, log) {
    const payload = {
        name: card.name || '未命名角色',
        description: card.description || card.raw || '',
        personality: card.personality || '',
        scenario: card.scenario || '',
        first_mes: card.first_mes || '',
        mes_example: card.mes_example || '',
        creator_notes: card.creator_notes || '',
        tags: card.tags || [],
        ch_name: card.name || '未命名角色',
    };
    const headers = c.getRequestHeaders ? c.getRequestHeaders() : { 'Content-Type': 'application/json' };
    const resp = await fetch('/api/characters/create', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        body: JSON.stringify(payload),
        cache: 'no-cache',
    });
    if (!resp.ok) {
        let detail = '';
        try { detail = (await resp.text()).slice(0, 200); } catch (e) { /* ignore */ }
        throw new Error('HTTP ' + resp.status + (detail ? ' ' + detail : ''));
    }
    log('API 创建成功');
    return true;
}

/** 导出角色卡 JSON（兜底与手动导入用） */
export function exportCardJson(card) {
    const payload = buildCardPayload(card);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (card.name || '角色').replace(/[\\/:*?"<>|、]/g, '_') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 构造酒馆 Character Card V2 结构 */
export function buildCardPayload(card) {
    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: card.name || '未命名角色',
            description: card.description || card.raw || '',
            personality: card.personality || '',
            scenario: card.scenario || '',
            first_mes: card.first_mes || '',
            mes_example: card.mes_example || '',
            creator_notes: card.creator_notes || '',
            tags: card.tags || [],
            alternate_greetings: card.alternate_greetings || [],
            extensions: card.extensions || {},
        },
    };
}

export default { parseCard, writeCharacterToTavern, exportCardJson, buildCardPayload };
