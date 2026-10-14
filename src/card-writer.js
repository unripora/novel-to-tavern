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
 * @param {object} card 结构化角色卡
 * @returns {Promise<{ok:boolean, mode:string, message:string}>}
 */
export async function writeCharacterToTavern(card) {
    const c = ctx();
    if (!c) return { ok: false, mode: 'none', message: '未检测到酒馆环境' };

    // 主路径：尝试直接创建角色
    try {
        const created = await tryCreateCharacter(c, card);
        if (created) return { ok: true, mode: 'direct', message: '已创建角色：' + card.name };
    } catch (e) {
        console.warn('[card-extractor] 直接创建角色失败，回退导出', e);
    }

    // 兜底：导出 .json
    exportCardJson(card);
    return { ok: true, mode: 'export', message: '已导出角色卡文件，请在酒馆「角色管理 → 导入角色」中导入' };
}

/**
 * 尝试直接创建角色
 * 兼容酒馆不同版本：优先 createCharacterData + 内部保存；失败返回 null 触发兜底。
 */
async function tryCreateCharacter(c, card) {
    // 酒馆通过 /api/characters/create 接口创建角色（内部函数封装不一），
    // 这里保守处理：仅当存在明确可用的创建入口时才走主路径。
    if (typeof c.createCharacterData !== 'function') return null;

    const payload = {
        name: card.name || '未命名角色',
        description: card.description || card.raw || '',
        personality: card.personality || '',
        scenario: card.scenario || '',
        first_mes: card.first_mes || '',
        mes_example: card.mes_example || '',
        creator_notes: card.creator_notes || '',
        tags: card.tags || [],
    };

    // 调用酒馆内部创建接口
    const headers = c.getRequestHeaders ? c.getRequestHeaders() : { 'Content-Type': 'application/json' };
    const resp = await fetch('/api/characters/create', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        body: JSON.stringify(payload),
        cache: 'no-cache',
    });
    if (!resp.ok) throw new Error('创建角色失败 HTTP ' + resp.status);
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
