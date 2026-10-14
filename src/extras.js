/**
 * extras.js —— 其余功能（纯逻辑，不含 UI 渲染）
 *
 * 迁移自原 index.html 的四项生成能力 + 历史记录管理：
 *   1. generatePersona       生成 user 人设（原 pnBtn）
 *   2. generateFirstMessage  生成开场白（原 fmBtn / first_mes）
 *   3. distillStyle          文风蒸馏（原 styleBtn）
 *   4. selfCheck             内容自检（原 checkRunBtn）
 *   5. saveHistory / getHistory / clearHistory  历史记录（原 saveHistory 的数据部分）
 *
 * 设计要点：
 *   - 参数一律通过「选项对象」传入，不读写任何 DOM；
 *   - AI 调用统一走 generate.js 的 generate()；
 *   - 提示词内容与原 HTML 保持一致，不确定处以原文为准。
 */

import { generate, isAbort } from './generate.js';
import { settings, persist } from './store.js';
import { getNovel } from './novel.js';
import { collectContext, sampleForStyle } from './scan.js';
import { stripFence, stripThink } from './util.js';
import { buildStatPanelBlock } from './prompts.js';
import { currentUserName } from './st-bridge.js';

/** 自定义系统提示（原 customSys：拼到每次请求最前） */
function customSys() {
    return String(settings().sysPrefix || '').trim();
}

/**
 * 包装系统提示：在原 system 前附加用户自定义系统提示（对齐 withSys）
 * @param {string} base
 */
function withSys(base) {
    const c = customSys();
    return c ? c + '\n\n' + base : base;
}

/** 取当前默认模型名（原 els.model.value，迁移为设置项） */
function currentModel() {
    return String(settings().model || '').trim();
}

/** 组装历史模型字段所需的时间字符串 */
function nowStr() {
    return new Date().toLocaleString();
}

/** 生成时统一使用的 max_tokens 下限（与原 maxT 逻辑一致） */
function maxTokensAtLeast(n) {
    return Math.max(n, parseInt(settings().maxTokens, 10) || n);
}

// ==================== 1. 生成 user 人设（persona） ====================

/**
 * 生成「你」在这本小说里的人设
 * @param {{desc:string, charName?:string, rel?:string, detail?:'concise'|'rich'|'', useNovel?:boolean, nsfw?:boolean, statPanel?:{fields?:string, refs?:string, persona?:boolean}|null}} o
 * @returns {Promise<string>} 人设文本（清洗后）
 */
export async function generatePersona({ desc, charName = '', rel = '', detail = '', useNovel = false, nsfw = false, statPanel = null } = {}) {
    const detailRule = detail === 'concise'
        ? '· 篇幅精简，几句话到一小段即可。'
        : detail === 'rich'
            ? '· 尽量写得丰富具体，有细节和层次。'
            : '';

    // 参考原文：优先取指定角色的相关段落，否则用全书抽样
    let ref = '';
    if (useNovel) {
        ref = charName ? collectContext(charName) : sampleForStyle();
    }

    // 数值面板：开启时在人设末尾追加面板提示词（含与角色的相对强度对比）
    const statBlock = statPanel
        ? buildStatPanelBlock({
            fields: statPanel.fields || '',
            refValues: statPanel.refs || '',
            persona: true,
        })
        : '';

    const sys = '你是角色卡撰写者，为用户本人撰写一份「用户角色（persona）」。用户给的设定是硬设定，必须完整保留、不得篡改；你的工作是把它写得自然、有血肉，并让它贴合故事世界。';
    const user =
        '请为「{{user}}」（也就是用户本人）写一份人设。\n\n' +
        '【用户给定的设定 —— 必须严格保留，不得擅自更改或删减】\n' + desc + '\n\n' +
        (rel ? ('【与角色的关系 / 对方的态度 —— 必须体现】\n' + (charName ? ('对象角色：' + charName + '\n') : '') + rel + '\n\n')
            : (charName ? ('【关系】请合理写出 {{user}} 与「' + charName + '」的关系。\n\n') : '')) +
        (useNovel ? ('【故事原文（节选，供你贴合世界观）】\n' + ref + '\n\n') : '') +
        '要求：\n' +
        '· 以 {{user}} 指代用户本人，不要另起别的代称。\n' +
        '· 用户给的名字、性别、年龄、性格、MBTI 等硬设定原样保留，只做润色和扩写，绝不改动。\n' +
        (useNovel ? '· 结合原文的时代背景、社会环境与设定，让 {{user}} 像是本来就活在这个世界里的人；可合理演绎，但不得与原文设定冲突，也不要编造原文没有的重大事件。\n' : '') +
        (charName ? ('· 写清 {{user}} 与「' + charName + '」的关系、相处方式，以及「' + charName + '」对 {{user}} 的态度，要与原文中该角色的性格一致，严禁 OOC。\n') : '') +
        (nsfw ? '· 可包含成人向设定（性向、癖好、边界等），依据用户给的设定来写，不编造用户没提的取向。\n' : '· 不要写任何性相关内容。\n') +
        (detailRule ? detailRule + '\n' : '') +
        statBlock +
        '· 输出结构化人设，包含：基本信息（名字/性别/年龄/身份等）、外貌、性格、与主要角色的关系、日常与习惯等；用户没提且原文也无依据的，不要硬编。\n' +
        '· 直接输出人设正文，不要额外解释，不要用代码块包裹。';

    const messages = [
        { role: 'system', content: withSys(sys) },
        { role: 'user', content: user },
    ];

    const raw = await generate(messages, {
        maxTokens: maxTokensAtLeast(4000),
        useStream: !!settings().useStream,
        maxCont: settings().autoCont ? 5 : 0,
        label: 'user 人设',
    });
    return stripFence(stripThink(raw)).trim();
}

// ==================== 2. 生成开场白（first_mes） ====================

/**
 * 生成角色卡开场白
 * @param {{charName:string, view?:'second'|'first'|'third', scene?:string, useNovel?:boolean, nsfw?:boolean, cardText?:string, styleText?:string}} o
 * @returns {Promise<string>} 开场白正文（清洗后）
 */
export async function generateFirstMessage({ charName, view = 'second', scene = '', useNovel = false, nsfw = false, cardText = '', styleText = '' } = {}) {
    const viewRule = view === 'first' ? '· 用角色第一人称「我」的口吻来写。'
        : view === 'third' ? '· 用第三人称旁白视角来写。'
            : '· 用第二人称：以角色的动作、语言、神态来对着 {{user}} 展开，可穿插对 {{user}} 的称呼与描写。';

    // 参考：角色卡本身 + 相关原文（贴合性格与文风）
    let ref = '';
    if (useNovel) ref = collectContext(charName).slice(0, 60000);

    const sys = '你是角色扮演开场白撰写者，为角色卡写 first_mes（每次开聊时角色发出的第一条消息）。开场白要有代入感、有画面、留出让对方接话的空间。';
    const user =
        '请为角色「' + charName + '」写一段开场白（first_mes）。\n\n' +
        (cardText ? ('【角色卡（务必贴合其身份与性格，严禁 OOC）】\n' + cardText.slice(0, 8000) + '\n\n') : '') +
        (scene ? ('【开场情境】\n' + scene + '\n\n') : '【开场情境】请依据角色设定，安排一个自然的初见 / 开场场景。\n\n') +
        (styleText ? ('【文风参考（尽量贴近这种笔法）】\n' + styleText.slice(0, 2000) + '\n\n') : '') +
        (useNovel ? ('【原文节选（供你贴合世界观与语气）】\n' + ref + '\n\n') : '') +
        '要求：\n' +
        viewRule + '\n' +
        '· 用 {{user}} 指代使用者、{{char}} 或角色名指代角色；不要替 {{user}} 说话或做决定，留出接话空间。\n' +
        '· 有场景、有动作、有神态，能立刻把人带入；篇幅适中（一般两三段）。\n' +
        (useNovel ? '· 贴合原文的时代背景与设定，不要写出与原著冲突的情节。\n' : '') +
        (nsfw ? '· 可包含成人向氛围，但开场白重在铺场景与代入，不必一上来就露骨。\n' : '· 不要写露骨的性内容。\n') +
        '· 直接输出开场白正文，不要额外解释，不要用代码块包裹。';

    const messages = [
        { role: 'system', content: withSys(sys) },
        { role: 'user', content: user },
    ];

    const raw = await generate(messages, {
        maxTokens: maxTokensAtLeast(2000),
        useStream: !!settings().useStream,
        maxCont: settings().autoCont ? 5 : 0,
        label: '开场白',
    });
    return stripFence(stripThink(raw)).trim();
}

// ==================== 3. 文风蒸馏（style） ====================

/**
 * 分析小说文风，产出可复用的文风说明
 * @param {{nsfw?:boolean, extra?:string}} o
 * @returns {Promise<string>} 文风分析文本（清洗后）
 */
export async function distillStyle({ nsfw = false, extra = '' } = {}) {
    const text = getNovel().trim();
    if (!text) throw new Error('请先导入小说');

    const sample = sampleForStyle();
    const eroLine = nsfw
        ? '- 亲密/情欲描写：尺度、笔法、常用词与留白方式、身体与情绪的着墨比例'
        : '';

    const sys = '你是资深文学编辑和文风分析师，擅长把一位作者的笔法抽象成可执行的写作指令。';
    const user =
        '分析下面这部小说（节选）的写作风格，目标是让另一个 AI 能照这份说明写出高度贴近原作风味的文字。\n\n' +
        '重要：只做风格层面的抽象分析，不要复述情节，不要摘抄原文句子；需要举例时请你自己仿写一句以内的极短示例，不得直接搬运原文。\n\n' +
        '请用中文按以下结构输出：\n\n' +
        '## 文风速览\n（3~4 句概括整体气质）\n\n' +
        '## 详细拆解\n' +
        '- 叙事视角：人称 / 全知或限知 / 叙述距离\n' +
        '- 语气基调\n' +
        '- 句式节奏：长短句偏好、断句、节奏快慢\n' +
        '- 用词偏好：文白程度、爱用的词类与意象、忌用的\n' +
        '- 对话风格：对话比重、人物口吻、标点习惯\n' +
        '- 描写习惯：环境/心理/动作描写的方式与比重\n' +
        '- 修辞习惯：常用的比喻/通感/反讽等\n' +
        '- 情感表达：直白还是含蓄，如何推进情绪\n' +
        '- 标志性特征：这位作者最容易辨认的笔法\n' +
        (eroLine ? eroLine + '\n' : '') +
        '\n## 可复用文风提示词\n（写一段能直接粘贴给 AI 的第二人称写作指令，开头「请以如下文风写作：」，把上面最关键的几点浓缩成可执行的指令。）\n\n' +
        ((extra && extra.trim()) ? ('【用户的额外要求，请优先满足】\n' + extra.trim() + '\n\n') : '') +
        '=== 小说节选 ===\n' + sample;

    const messages = [
        { role: 'system', content: withSys(sys) },
        { role: 'user', content: user },
    ];

    const raw = await generate(messages, {
        maxTokens: maxTokensAtLeast(4000),
        useStream: !!settings().useStream,
        maxCont: settings().autoCont ? 5 : 0,
        label: '文风',
    });
    return stripFence(stripThink(raw)).trim();
}

// ==================== 4. 内容自检（check） ====================

/**
 * 对选中的角色卡 / 世界书条目逐项对照原文自检，返回拼接后的修正成品
 * @param {{items:Array<{type:'card'|'wb', label:string, name:string, content:string, keys?:string[]}>, cardText?:string, worldText?:string, onItem?:(cur:number,total:number,label:string,partial:string)=>void}} o
 * @returns {Promise<string>} 修正后成品文本（各项以 ========== 标题 ========== 分隔）
 */
export async function selfCheck({ items = [], onItem } = {}) {
    const picks = (items || []).filter(Boolean);
    if (!picks.length) throw new Error('请先勾选要检查的项');

    const results = [];
    for (let i = 0; i < picks.length; i++) {
        const it = picks[i];
        if (onItem) onItem(i + 1, picks.length, it.label, results.join('\n\n\n'));

        // 取参考原文
        let ref = '';
        if (it.type === 'card') {
            // 去掉角色名尾部的括号注释再检索
            const b = String(it.name || '').replace(/[（(].+?[)）]\s*$/, '').trim();
            ref = collectContext(b || it.name);
        } else {
            const names = (it.keys && it.keys.length) ? it.keys : [it.name];
            const paras = getNovel().split(/\n\s*\n|\n/).filter((p) => p.trim());
            ref = paras.filter((p) => names.some((n) => n && p.includes(n))).join('\n\n').slice(0, 80000);
            // 蓝灯/总纲类条目（人物列表、剧情大纲、共享背景）没有关键词，
            // 关键词搜不到时兜底用全书抽样，否则模型会回「未提供原文无法对照」
            if (ref.replace(/\s/g, '').length < 200) {
                const t = getNovel().trim();
                if (t) ref = sampleForStyle();
            }
        }

        const sys = '你是严谨的校对员，对照原文检查角色卡/世界书条目的准确性，只依据原文判断。';
        const user =
            '请对照原文，检查下面这份' + (it.type === 'card' ? '角色卡' : '世界书条目') + '是否存在问题：\n' +
            '重点查：① OOC（与原文性格/言行矛盾）；② 经历互串（把别的角色/别的阶段的经历安到这里）；③ 与原文冲突的事实错误、张冠李戴、时间线错乱；④ 编造原文没有的设定。\n\n' +
            '【待检查内容】\n' + it.content + '\n\n' +
            (ref ? ('【参考原文（相关片段）】\n' + ref + '\n\n') : '') +
            '请按如下格式输出：\n' +
            '问题日志：\n（逐条列出发现的问题；若没问题就写「无」）\n\n' +
            '修正后成品：\n（给出修正后的完整' + (it.type === 'card' ? '角色卡' : '条目内容') + '，保持原有结构与格式；若无需修改则原样输出）\n\n' +
            '不要额外解释，不要用代码块包裹。';

        const messages = [
            { role: 'system', content: withSys(sys) },
            { role: 'user', content: user },
        ];

        const header = '========== ' + it.label + ' ==========\n';
        let raw = '';
        try {
            raw = await generate(messages, {
                maxTokens: maxTokensAtLeast(4000),
                useStream: !!settings().useStream,
                maxCont: settings().autoCont ? 5 : 0,
                label: it.label,
            });
        } catch (err) {
            if (isAbort(err)) break;
            throw err;
        }
        results.push(header + stripFence(stripThink(raw)).trim());
        if (onItem) onItem(i + 1, picks.length, it.label, results.join('\n\n\n'));
    }
    return results.join('\n\n\n');
}

// ==================== 5. 历史记录管理（数据部分） ====================

/** 历史记录条数上限（与原 HTML 一致） */
const HISTORY_MAX = 30;

/**
 * 读取历史记录（拷贝，避免外部误改内部数组）
 * @returns {Array<{id:number,type:string,time:string,title:string,model:string,text:string}>}
 */
export function getHistory() {
    const arr = settings().history;
    return Array.isArray(arr) ? arr.slice() : [];
}

/**
 * 追加一条历史记录（最新在前，最多保留 30 条），并持久化
 * @param {{id?:number,type?:string,time?:string,title?:string,model?:string,text:string}} rec
 */
export function saveHistory(rec) {
    if (!rec || typeof rec !== 'object') return;
    const entry = {
        id: rec.id != null ? rec.id : Date.now(),
        type: rec.type || 'card',
        time: rec.time || nowStr(),
        title: rec.title || '',
        model: rec.model != null ? rec.model : currentModel(),
        text: rec.text || '',
    };
    const s = settings();
    const history = Array.isArray(s.history) ? s.history : [];
    history.unshift(entry);
    s.history = history.slice(0, HISTORY_MAX);
    persist();
}

/** 清空历史记录，并持久化 */
export function clearHistory() {
    settings().history = [];
    persist();
}

export default {
    generatePersona,
    generateFirstMessage,
    distillStyle,
    selfCheck,
    getHistory,
    saveHistory,
    clearHistory,
};
