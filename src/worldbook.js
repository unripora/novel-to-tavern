/**
 * worldbook.js —— 世界书（Lorebook / World Info）逻辑
 *
 * 迁移自原 index.html 的世界书逻辑，含两部分：
 * 1. 生成：6 类任务的 AI 生成（提取条目 / 共享背景 / 配角群像 / 剧情分段 / 常驻条目）+ 预览/JSON/回读等纯数据处理。
 * 2. 写入酒馆：writeWorldbookToTavern 把内部条目写入酒馆世界书文件（新建或合并）。
 * AI 调用统一走 generate.js；DOM 相关交由上层 UI，本模块只做纯逻辑与酒馆写入。
 */

import { ctx } from './st-bridge.js';
import { getNovel } from './novel.js';
import { settings } from './store.js';
import { sampleForStyle, sampleText, getCharacters, collectContext } from './scan.js';
import { generate, isAbort } from './generate.js';
import { stripFence, stripThink, extractJsonArray, logTo, uniq, normalizeRange } from './util.js';

/** 世界书条目格式说明（迁移自 prompts.js） */
import { WB_FMT as _WB_FMT, CHAR_ENTRY_TPL } from './prompts.js';
export { WB_FMT } from './prompts.js';
const WB_FMT = _WB_FMT;

/** 睡眠：用于分段请求之间的小间隔，避免触发限流 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ===== 一、纯数据处理：user 替换 / 预览 / JSON / 回读 ===== */

/** 让 user 替换书中某角色：参数化传入（不直接读 DOM），返回被替换的角色名 */
function replaceNameOf(opt) {
    if (!opt || !opt.enabled) return '';
    return String(opt.name || '').trim();
}

/** 替换单个文本（标题 / 内容）中的角色名 → {{user}} */
export function wbSub(s, rn) {
    return (rn && s) ? String(s).split(rn).join('{{user}}') : s;
}

/** 从关键词里剔除被替换的角色名 */
export function wbSubKeys(keys, rn) {
    return rn ? (keys || []).filter((k) => k !== rn) : (keys || []);
}

/** 生成人可读的世界书预览文本（带推荐设置） */
export function buildWbPreview(entries, userReplace = {}) {
    const rn = replaceNameOf(userReplace);
    const lines = [];
    lines.push('# 世界书条目预览（共 ' + entries.length + ' 条）');
    lines.push('# 通用推荐：位置＝角色定义之前 · 深度 4 · 顺序 100（酒馆默认即可）');
    lines.push('');
    entries.forEach((e, i) => {
        const mode = e.constant ? '常驻（蓝灯）— 始终注入，适合核心世界观' : '关键词触发（绿灯）— 被提到时才注入';
        const keys = wbSubKeys(e.keys, rn);
        lines.push('========== ' + (i + 1) + '. ' + wbSub(e.title, rn) + '　[' + e.category + '] ==========');
        lines.push('触发关键词: ' + (keys.length ? keys.join('、') : '（无，建议手动补）'));
        lines.push('推荐模式: ' + mode);
        lines.push('内容:');
        lines.push(wbSub(e.content, rn) || '（原文未提及）');
        lines.push('');
    });
    return lines.join('\n');
}

/** 生成可导入酒馆的世界书 JSON（字符串） */
export function buildWbJson(entries, userReplace = {}) {
    const rn = replaceNameOf(userReplace);
    const out = { entries: {} };
    entries.forEach((e, i) => {
        out.entries[String(i)] = {
            uid: i,
            key: wbSubKeys(e.keys, rn),
            keysecondary: [],
            comment: wbSub(e.title, rn),
            content: '【' + wbSub(e.title, rn) + '】' + (e.category ? ('（' + e.category + '）') : '') + '\n' + wbSub(e.content, rn),
            constant: e.constant,
            selective: !e.constant,
            selectiveLogic: 0,
            order: 100,
            position: 0,            // 0 = 角色定义之前
            depth: 4,
            probability: 100,
            useProbability: true,
            disable: false,
            addMemo: true,
            excludeRecursion: false,
            group: '',
            groupOverride: false,
            scanDepth: null,
            caseSensitive: null,
            matchWholeWords: null,
            automationId: '',
            role: null,
            vectorized: false,
            displayIndex: i,
        };
    });
    return JSON.stringify(out, null, 2);
}

/** 把预览文本回读成结构化条目（供下载/打包/写入酒馆用） */
export function parseWbPreview(text) {
    const lines = String(text).split(/\r?\n/);
    const entries = [];
    let cur = null;
    let mode = null;
    const headerRe = /^={4,}\s*\d+\.\s*(.+?)\s*={4,}\s*$/;
    for (const line of lines) {
        const hm = line.match(headerRe);
        if (hm) {
            if (cur) entries.push(cur);
            const head = hm[1].trim();
            let category = '设定';
            let title = head;
            // 贪心吃前缀，只认结尾的 [分类]，且分类内不含括号
            const cm = head.match(/^(.+)[　\s]+[\[［]([^\[\]［］]+)[\]］]$/);
            if (cm && cm[1].trim()) { title = cm[1].trim(); category = cm[2].trim(); }
            if (!title) title = head;   // 兜底：绝不让标题为空（否则条目会被过滤丢失）
            cur = { title, category, keys: [], content: '', constant: false };
            mode = null;
            continue;
        }
        if (!cur) continue;
        if (/^触发关键词\s*[:：]/.test(line)) {
            const v = line.replace(/^触发关键词\s*[:：]\s*/, '').trim();
            const isNone = !v || /^[（(]?无/.test(v) || v.indexOf('建议手动补') >= 0;   // 识别「（无，建议手动补）」占位符
            cur.keys = isNone ? [] : v.split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
            mode = null; continue;
        }
        if (/^推荐模式\s*[:：]/.test(line)) { cur.constant = /常驻|蓝灯|constant/i.test(line); mode = null; continue; }
        if (/^内容\s*[:：]/.test(line)) {
            mode = 'content';
            const rest = line.replace(/^内容\s*[:：]\s*/, '');
            if (rest.trim()) cur.content += rest + '\n';
            continue;
        }
        if (mode === 'content') cur.content += line + '\n';
    }
    if (cur) entries.push(cur);
    entries.forEach((e) => { e.content = e.content.trim(); });
    return entries.filter((e) => e.title);
}

/** 同步回条目：把用户手动编辑过的预览文本解析回条目数组（原 syncWbFromPreview，去掉 confirm/DOM）。 */
export function syncWbFromPreview(previewText, entries, onShrink) {
    const txt = String(previewText || '');
    if (!txt.trim()) return entries;
    if (entries.length && txt.trim() === buildWbPreview(entries).trim()) return entries;   // 没动过
    const parsed = parseWbPreview(txt);
    if (!parsed.length) { logTo('ce_wb_log', '预览框内容无法解析成条目（格式需保持「===== 序号. 标题 =====」那套），导出将沿用上次的结果', 'e'); return entries; }
    // 防丢失：解析结果比原来少很多时，多半是手滑删坏了预览，交由上层确认，避免静默丢条目
    if (entries.length >= 5 && parsed.length < entries.length * 0.6 && !(onShrink ? onShrink(parsed, entries) : true)) return entries;
    // 预览文本不含内部字段（related/relatedKeys/enterSticky），按 title 从原条目回填，避免编辑预览后丢失
    const byTitle = new Map((entries || []).map((e) => [e.title, e]));
    for (const e of parsed) {
        const old = byTitle.get(e.title);
        if (!old) continue;
        if (old.related && old.related.length) e.related = old.related;
        if (old.relatedKeys && old.relatedKeys.length) e.relatedKeys = old.relatedKeys;
        if (old.enterSticky) e.enterSticky = old.enterSticky;
    }
    return parsed;
}

/* ===== 二、生成：6 类世界书任务 ===== */

/** 从设置读取分块大小（原 els.chunkSize） */
function chunkSizeOf() { return Math.max(10000, Number(settings().chunkSize) || 40000); }
/** 从设置读取扫描上限段数（原 els.scanCap） */
function scanCapOf() { return Math.max(1, Number(settings().scanCap) || 40); }
/** 构造 Chat 消息数组（对齐原 userMsgs：有系统前缀时插入 system 消息） */
function userMsgs(prompt, sys) {
    return sys ? [{ role: 'system', content: sys }, { role: 'user', content: prompt }] : [{ role: 'user', content: prompt }];
}

/** NSFW 提示行（原 $("wbNsfw").checked） */
function nsfwLineWorld() {
    return settings().nsfw ? '可包含成人向的世界观/设定条目，同样只依据原文，不编造。' : '不要提取成人 / 性相关内容。';
}

/** 【任务1】提取世界书条目：分段逐段提取世界观/势力/地点/设定/历史/物品（原 wbExtractCore，支持断点续跑） */
export async function wbExtractCore({ signal, entries = [], state = null, onProgress, onSegment, relatedMode = 'none' } = {}) {
    const text = getNovel().trim();
    const size = chunkSizeOf();
    const totalChunks = Math.ceil(text.length / size);
    const chunkAt = (i) => text.slice(i * size, (i + 1) * size);
    const resuming = state && state.len === text.length && state.next < state.cap;
    let cap, map, startI;
    if (resuming) {
        cap = state.cap; map = state.map; startI = state.next;
        logTo('ce_wb_log', '从第 ' + (startI + 1) + '/' + cap + ' 段继续提取…');
    } else {
        cap = Math.min(totalChunks, scanCapOf());
        map = new Map(); startI = 0;
        state = { len: text.length, size, cap, next: 0, map };
        if (totalChunks > cap) logTo('ce_wb_log', '小说较长（共 ' + totalChunks + ' 段），仅提取前 ' + cap + ' 段。', 'e');
        logTo('ce_wb_log', '共 ' + cap + ' 段，开始提取…');
    }
    const nsfw = nsfwLineWorld();
    const wantRelated = relatedMode === 'light' || relatedMode === 'heavy';
    for (let i = startI; i < cap; i++) {
        if (signal && signal.aborted) break;
        const chunk = chunkAt(i);
        if (onProgress) onProgress(i, cap);
        if (i > startI) await sleep(400);
        const prompt =
            '下面是小说的一段。提取其中的「世界观 / 设定」类信息，做成世界书条目。\n' +
            '关注：世界观背景、势力/组织、地点、种族/体系设定、重要概念或规则、历史事件、关键物品等。\n' +
            '不要提取具体角色的个人档案（那属于角色卡）；群体性的身份/种族/阵营设定可以。\n' +
            nsfw + '\n' +
            '输出 JSON 数组，每个元素：\n' +
            '{"category":"分类(世界观/势力/地点/设定/历史/物品 之一)","title":"条目标题","keys":["触发关键词，用原文里会出现的名称/术语，2~5个"],"content":"该设定的说明，依据原文、简洁准确、不编造","constant":true 或 false' +
            (wantRelated ? ',"related":["与该条目相关的人物名，2~5个（事件/势力/地点尤其要标出涉及哪些角色）"]' : '') + '}\n' +
            'constant：整体世界观/总背景 → true（建议常驻）；具体的势力/地点/术语/物品 → false（关键词触发）。\n' +
            (wantRelated ? 'related：列出与该条目紧密相关的人物姓名（仅原文出现的角色名，不要编造）。\n' : '') +
            '只输出 JSON 数组，不要代码块、不要解释。该段没有明确设定就输出 []。\n\n文本：\n' + chunk;
        let raw = '';
        const onWait = (n, code, w) => logTo('ce_wb_log', '第' + (i + 1) + '段 HTTP ' + code + '，' + (w / 1000) + 's 后重试(' + n + ')', 'e');
        try {
            raw = await generate(userMsgs(prompt), {
                signal, onWait, useStream: false,
                maxCont: settings().autoCont ? 3 : 0, logEl: 'ce_wb_log', label: `第${i + 1}段`,
            });
        } catch (err) {
            if (isAbort(err, signal)) { logTo('ce_wb_log', '已停止', 'e'); break; }
            logTo('ce_wb_log', '第' + (i + 1) + '段请求失败：' + err.message, 'e');
            state.next = i + 1; if (onSegment) onSegment(state); continue;
        }
        const arr = extractJsonArray(raw);
        if (!Array.isArray(arr) || !arr.length) {
            const snip = String(raw).trim().replace(/\s+/g, ' ').slice(0, 90);
            logTo('ce_wb_log', '第' + (i + 1) + '段解析失败，模型返回：' + (snip ? '「' + snip + '」' : '（空，可能被安全过滤挡了）'), 'e');
            state.next = i + 1; if (onSegment) onSegment(state); continue;
        }
        for (const e of arr) {
            if (!e || !e.title) continue;
            const title = String(e.title).trim();
            if (!title) continue;
            const keys = Array.isArray(e.keys) ? e.keys.map((k) => String(k).trim()).filter(Boolean) : [];
            const content = String(e.content || '').trim();
            const related = Array.isArray(e.related) ? e.related.map((s) => String(s).trim()).filter(Boolean) : [];
            if (map.has(title)) {
                const ex = map.get(title);
                for (const k of keys) if (!ex.keys.includes(k)) ex.keys.push(k);
                for (const r of related) { ex.related = ex.related || []; if (!ex.related.includes(r)) ex.related.push(r); }
                if (content.length > ex.content.length) ex.content = content;
                ex.constant = ex.constant || !!e.constant;
            } else {
                const item = { category: String(e.category || '设定').trim(), title, keys, content, constant: !!e.constant };
                if (wantRelated && related.length) item.related = related;
                map.set(title, item);
            }
        }
        state.next = i + 1;
        if (onSegment) onSegment(state);
        logTo('ce_wb_log', '第' + (i + 1) + '段 → 累计 ' + map.size + ' 条', 'g');
    }
    const merged = [...map.values()];
    const done = state.next >= cap;
    return { entries: merged, state: done ? null : state, done };
}

/** 【任务2】共享背景 / 世界大纲：抽取多角色共享的时代背景，做成一条常驻条目（原 wbBgCore） */
export async function wbBgCore({ signal, onText } = {}) {
    const text = getNovel().trim();
    const sample = sampleForStyle(text);
    const prompt =
        '通读下面这部小说（节选），总结所有角色共享的时代背景、世界大环境、社会规则、集体经历与公共设定——不要写任何单一角色的个人档案。\n' +
        '浓缩成一段适合做「常驻世界书条目」的背景大纲，让 AI 始终了解故事发生的大框架，从而角色卡里不必重复这些共同信息。\n' +
        '只依据原文，简洁准确，不编造。直接输出这段背景大纲正文，不要标题、不要解释、不要代码块。\n\n=== 小说节选 ===\n' + sample;
    const raw = await generate(userMsgs(prompt), { signal, useStream: !!settings().useStream, onText, maxCont: settings().autoCont ? 5 : 0, logEl: 'ce_wb_log', label: '共享背景' });
    const content = stripFence(stripThink(raw)).trim();
    if (!content) { logTo('ce_wb_log', '共享背景：没提取到内容', 'e'); return null; }
    return { category: '共享背景', title: '共享背景 / 世界大纲', keys: [], content, constant: true };
}

/**
 * 【任务3】配角群像：mode='each' 逐个配角各一条 | 其它合成一条群像合集（迁移自原 wbMinorCore）。
 */
export async function wbMinorCore({ signal, onText, mode = 'each', cap = 20, maxTokens } = {}) {
    const characters = getCharacters();
    if (!characters.length) { logTo('ce_wb_log', '配角：请先扫描/添加角色，跳过', 'e'); return []; }
    const maxT = Math.max(4000, Number(maxTokens) || 4000);
    const sample = sampleText(getNovel().trim());
    const capN = Math.max(1, Number(cap) || 20);
    const list = characters.map((c) => '· ' + c.name + (c.aliases && c.aliases.length ? ('（' + c.aliases.join('、') + '）') : '') + (c.role ? ('：' + c.role) : '')).join('\n');
    const stream = !!settings().useStream;
    const cont = settings().autoCont ? 5 : 0;
    if (mode === 'each') {
        // 每个配角单独一条绿灯条目
        const prompt =
            '下面是这部小说的角色清单和节选。请为其中的**配角**逐个生成世界书条目（主角/核心角色略过，他们单独出卡）。\n' +
            '从配角里挑最重要的，**最多 ' + capN + ' 个**。每个配角一条，写清身份、性格、地位、与主角及彼此的关系，有戏份的尽量详细。\n' +
            '只依据原文、不编造。输出 JSON 数组 [{"name":"配角名","keys":["触发关键词2~4个"],"content":"介绍"}]，只输出 JSON，不要代码块、不要解释。\n\n' +
            '角色清单：\n' + list + '\n\n=== 小说节选 ===\n' + sample;
        const raw = await generate(userMsgs(prompt), { maxTokens: Math.max(maxT, 12000), useStream: stream, signal, onText, maxCont: cont, logEl: 'ce_wb_log', label: '逐个配角' });
        const arr = extractJsonArray(stripFence(stripThink(raw)));
        if (!Array.isArray(arr) || !arr.length) { logTo('ce_wb_log', '逐个配角：没解析出条目', 'e'); return []; }
        const out = [];
        for (const e of arr) {
            if (!e || !e.name || !e.content) continue;
            const nm = String(e.name).trim();
            const keys = Array.isArray(e.keys) ? e.keys.map((k) => String(k).trim()).filter(Boolean) : [];
            if (!keys.includes(nm)) keys.unshift(nm);
            out.push({ category: '配角', title: '配角·' + nm, keys, content: String(e.content).trim(), constant: false });
        }
        return out;
    }
    // 合成一条群像
    const prompt =
        '下面是这部小说的角色清单和节选。请把其中的**配角**归纳成一条「群像合集」世界书条目。\n' +
        '主角 / 核心角色请略过（他们会单独出卡）。从配角里挑出最重要的，**最多收录 ' + capN + ' 个**（按重要性取舍，超出的舍去）。\n' +
        '写法分层：真正跑龙套、出场极少的，可以一两句带过；**其余有戏份的配角，每人至少 100 字**，写清身份、性格、地位、与主角及彼此的关系——他们是这个世界里活生生的人，不是工具人，别糊弄。\n' +
        '只依据原文、不编造，原文没写的就不写。用「· 名字：介绍」的形式，直接输出正文，不要解释、不要代码块。\n\n' +
        '角色清单：\n' + list + '\n\n=== 小说节选 ===\n' + sample;
    const raw = await generate(userMsgs(prompt), { maxTokens: maxT, useStream: stream, signal, onText, maxCont: cont, logEl: 'ce_wb_log', label: '配角群像' });
    const content = stripFence(stripThink(raw)).trim();
    if (!content) { logTo('ce_wb_log', '配角群像：没归纳出内容', 'e'); return []; }
    const keys = [];
    characters.forEach((c) => { keys.push(c.name); (c.aliases || []).forEach((a) => keys.push(a)); });
    return [{ category: '人物', title: '配角群像合集', keys: uniq(keys).slice(0, 80), content, constant: false }];
}

/**
 * 在指定正文范围内抽样（沿用「等距分段」策略，受总上限约束）。
 * 用于「角色 & 世界」按目标世界书自带范围生成角色条目。
 * @param {number} start 起始字符位置
 * @param {number} end 结束字符位置
 * @param {number} [perChunk] 每段字符数
 * @param {number} [slices] 采样段数
 * @param {number} [cap] 总字符上限
 * @returns {string}
 */
function sampleRange(start, end, perChunk = 8000, slices = 6, cap = 52000) {
    const text = getNovel();
    if (!text) return '';
    const s = Math.max(0, Math.min(Number(start) || 0, text.length));
    const e = Math.max(s, Math.min(Number(end) || text.length, text.length));
    const seg = text.slice(s, e);
    if (!seg) return '';
    if (seg.length <= cap) return seg;
    const out = [];
    const step = Math.floor(seg.length / slices);
    for (let i = 0; i < slices; i++) {
        const st = Math.floor(i * step);
        out.push(seg.slice(st, st + perChunk));
    }
    return out.join('\n\n…\n\n').slice(0, cap);
}

/**
 * 【角色 & 世界专用】为指定的**任意角色**逐个生成世界书条目（绿灯）。
 *
 * 与 wbMinorCore 的区别：
 *  - wbMinorCore 只做配角；本函数接受任意角色（含主角），由调用方选。
 *  - 每条附带 `related`（关联事件/地点）与 `relatedKeys`（登场触发词），
 *    供「角色 & 世界」Tab 的关联/登场用途（内部字段，写酒馆时不直接落库）。
 *
 * @param {object} o
 * @param {string[]} o.names 角色名数组（必填）
 * @param {'none'|'light'|'heavy'} [o.relatedMode='none'] 关联人物强度（light/heavy 均产出 related/relatedKeys）
 * @param {'brief'|'detail'} [o.detail='detail'] 条目详略：
 *        brief＝三五句概述（旧行为）；detail＝按角色卡档案模板逐字段填写（含生平、关系、口癖等，条目很长）
 * @param {string} [o.tmpl] 详细条目所用的档案模板（默认 prompts.CHAR_ENTRY_TPL）
 * @param {boolean} [o.fullCtx] 详细模式下是否使用该角色的全文相关段落（默认按上限采样）
 * @param {AbortSignal} [o.signal]
 * @param {boolean} [o.nsfw]
 * @param {{start:number,end:number}} [o.range] 原文范围（由「原文范围」下拉指定）；给了则只在该段原文内生成（未给回退全书抽样）
 * @param {(cur:number,total:number,name:string)=>void} [o.onProgress]
 * @returns {Promise<Array>} 条目数组
 */
export async function genCharEntries({
    names = [], relatedMode = 'none', detail = 'detail', tmpl = '', fullCtx = false, signal, nsfw = false, onProgress, range,
} = {}) {
    const list = (names || []).map((n) => String(n).trim()).filter(Boolean);
    if (!list.length) { logTo('ce_wc_log', '角色条目：未选择角色', 'e'); return []; }
    const rg = normalizeRange(range);
    const wantDetail = detail === 'detail';
    const tpl = String(tmpl || CHAR_ENTRY_TPL).trim();
    // 详细模式按角色名检索各自相关段落（与单人卡一致）；简要模式用全书抽样
    let sample = '';
    if (rg) {
        sample = sampleRange(rg.start, rg.end);
        logTo('ce_wc_log', `角色条目：按原文范围（${rg.start}~${rg.end}）取原文 ${sample.length} 字`, 'g');
    }
    if (!sample) {
        sample = sampleText(getNovel().trim());
        if (!rg) logTo('ce_wc_log', wantDetail ? '角色条目：未限定范围，详细模式改用各角色的相关段落' : '角色条目：未限定范围，改用全书抽样', 'g');
    }
    const wantRelated = relatedMode === 'light' || relatedMode === 'heavy';
    const out = [];
    for (let i = 0; i < list.length; i++) {
        if (signal && signal.aborted) break;
        const nm = list[i];
        if (onProgress) onProgress(i, list.length, nm);
        if (i > 0) await sleep(300);
        // 详细模式：每个角色单独取与其相关的段落（限定范围时在该范围内检索）
        const ctx = (wantDetail && !rg) ? (collectContext(nm, [], !!fullCtx) || sample) : sample;
        const prompt = wantDetail
            ? charEntryDetailPrompt(nm, tpl, ctx, { wantRelated, nsfw })
            : charEntryBriefPrompt(nm, ctx, { wantRelated, nsfw });
        let raw = '';
        try {
            raw = await generate(userMsgs(prompt), {
                signal, useStream: !!settings().useStream,
                maxCont: settings().autoCont ? (wantDetail ? 5 : 3) : 0,
                logEl: 'ce_wc_log', label: '角色条目·' + nm,
            });
        } catch (err) {
            if (isAbort(err, signal)) break;
            logTo('ce_wc_log', nm + ' 生成失败：' + err.message, 'e');
            continue;
        }
        const obj = extractJsonObject(raw);
        if (!obj || (!obj.content && !obj.title)) { logTo('ce_wc_log', nm + '：解析失败，已跳过', 'e'); continue; }
        const title = String(obj.title || nm).trim() || nm;
        const keys = Array.isArray(obj.keys) ? obj.keys.map((k) => String(k).trim()).filter(Boolean) : [];
        if (!keys.includes(nm)) keys.unshift(nm);
        const entry = { category: '人物', title, keys, content: String(obj.content || '').trim(), constant: false, enterSticky: 3 };
        if (wantDetail) entry.detail = true;
        if (wantRelated) {
            entry.related = Array.isArray(obj.related) ? obj.related.map((s) => String(s).trim()).filter(Boolean) : [];
            entry.relatedKeys = Array.isArray(obj.relatedKeys) ? obj.relatedKeys.map((s) => String(s).trim()).filter(Boolean) : [];
        }
        out.push(entry);
        logTo('ce_wc_log', `已生成角色条目：${title}（${entry.content.length} 字）`, 'g');
    }
    return out;
}

/** 简要角色条目提示词（旧行为：三五句概述） */
function charEntryBriefPrompt(nm, sample, { wantRelated, nsfw }) {
    return '下面是小说节选。请为角色「' + nm + '」写**一条世界书条目**（用于多人卡：让 AI 知道 TA 是谁、何时该登场）。\n' +
        '要求：写清身份、性格、与主角及他人的关系、重要经历；依据原文、简洁准确、不编造。\n' +
        'keys：该角色会被提到的名称/别名/称呼，2~5 个。\n' +
        (wantRelated
            ? 'related：与该角色紧密相关的**事件/地点/势力**名称，2~5 个（用于判断剧情何时该让 TA 登场）。\n' +
              'relatedKeys：从 related 里提炼出的**登场触发词**（读者/旁白会提到的词），2~6 个。\n'
            : '') +
        (nsfw ? '可包含成人向设定，同样只依据原文。\n' : '不要涉及成人 / 性相关内容。\n') +
        '输出 JSON 对象（不要数组、不要代码块、不要解释）：\n' +
        '{"title":"' + nm + '","keys":[],' + (wantRelated ? '"related":[],"relatedKeys":[],' : '') + '"content":"该角色的世界书条目正文"}\n\n' +
        '=== 小说节选 ===\n' + sample;
}

/**
 * 详细角色条目提示词：沿用单人角色卡的档案模板逐字段填写，
 * 让世界书条目里带上完整生平 / 关系 / 口癖，而不是标签式概述。
 */
function charEntryDetailPrompt(nm, tpl, ctx, { wantRelated, nsfw }) {
    const nsfwRule = nsfw
        ? '· 模板里的 NSFW_information 段落只依据原文填写，原文未涉及则填「（原文未提及）」，严禁编造。'
        : '· 若模板含 NSFW_information 段落，请整段省略，且不要输出任何性相关内容。';
    return '请为角色「' + nm + '」填写下面的档案模板，填好的内容将作为**一条世界书条目**的正文（多人卡全靠它认识 TA）。\n\n' +
        '要求：\n' +
        '· 【完整档案】按模板逐字段填写，字段一个都不要漏；不要退化成几句概述，也不要只写身份 + 性格标签。\n' +
        '· 【经历要具体】背景 / 关键事件 / 转折点写清**何时、发生何事、对 TA 造成了什么影响**，覆盖原文全程。\n' +
        '· 【关系要落到人】relationships 里写清对象、关系、羁绊或纠葛，别写「与众人关系良好」这类空话。\n' +
        '· 【口癖可辨识】speech_style 写出语癖、惯用语、语气特点，让 AI 能照着演。\n' +
        '· 【严禁张冠李戴】只写属于「' + nm + '」的经历与设定；【严禁 OOC】所有描写与原文一致。\n' +
        '· 只依据原文，可合理推断但绝不编造；原文确实没有的字段填「（原文未提及）」。\n' +
        nsfwRule + '\n\n' +
        '模板：\n' + tpl + '\n\n' +
        '输出 JSON 对象（不要代码块、不要解释）：\n' +
        '{"title":"' + nm + '","keys":["该角色会被提到的名称/别名/称呼，2~5 个"],' +
        (wantRelated ? '"related":["紧密相关的事件/地点/势力名，2~5 个"],"relatedKeys":["登场触发词，2~6 个"],' : '') +
        '"content":"上面这份档案的完整正文（可保留模板的缩进与字段名，便于 AI 逐个字段读取）"}\n\n' +
        '=== 小说文本（与「' + nm + '」相关）===\n' + ctx;
}

/** 容错：从模型返回里取出一个 JSON 对象 */
function extractJsonObject(s) {
    const t = stripFence(stripThink(String(s || '')));
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < 0 || b < a) return null;
    let body = t.slice(a, b + 1);
    try { return JSON.parse(body); }
    catch (e) {
        body = body.replace(/,(\s*[\]}])/g, '$1');
        try { return JSON.parse(body); } catch (e2) { return null; }
    }
}

/**
 * 【重档】实体-关系抽取：产出「人物-事件-地点」关系图谱（entities/relations）。
 * 用于「角色 & 世界」Tab 的双向查询（从角色找事件 / 从事件找角色）。
 *
 * @param {object} o
 * @param {AbortSignal} [o.signal]
 * @param {number} [o.maxTokens]
 * @returns {Promise<{entities:Array, relations:Array}>}
 */
export async function relExtractCore({ signal, maxTokens } = {}) {
    const text = getNovel().trim();
    // 抽样：用 sampleText（接受文本），不能用 sampleForStyle（它固定读全文，首参是数值）
    const sample = sampleText(text);
    if (!sample) {
        logTo('ce_wc_log', '关系抽取：请先导入小说', 'e');
        return { entities: [], relations: [], error: '请先导入小说' };
    }
    const prompt =
        '请从下面的小说节选中，抽取「实体」与它们之间的「关系」，构建一张关系图谱。\n' +
        '实体类型：角色 / 事件 / 地点 / 势力。\n' +
        '关系示例：角色-参与-事件、角色-隶属-势力、事件-发生地-地点、角色-位于-地点。\n' +
        '只依据原文，不编造。\n\n' +
        '输出 JSON 对象（不要代码块、不要解释）：\n' +
        '{\n' +
        '  "entities": [{"id":"e1","type":"角色","name":"桐人"}],\n' +
        '  "relations": [{"from":"e1","rel":"参与","to":"e2"}]\n' +
        '}\n' +
        'id 自行编号（同一实体只出现一次）；relations 的 from/to 必须是 entities 里出现过的 id。\n' +
        '必须只输出上述 JSON，不要询问、不要要求补充材料——原文就在下面。\n\n' +
        '=== 小说节选 ===\n' + sample;
    logTo('ce_wc_log', '关系抽取：提交原文 ' + sample.length.toLocaleString() + ' 字');
    let raw = '';
    try {
        raw = await generate(userMsgs(prompt), {
            signal, useStream: !!settings().useStream,
            // 关系图谱输出量大（数十实体 + 关系），4k 远远不够，会截断后解析失败
            maxTokens: Number(maxTokens) > 0 ? Number(maxTokens) : Math.max(16000, Number(settings().maxTokens) || 16000),
            maxCont: settings().autoCont ? 3 : 0, logEl: 'ce_wc_log', label: '关系抽取',
        });
    } catch (err) {
        if (isAbort(err, signal)) return { entities: [], relations: [], aborted: true };
        logTo('ce_wc_log', '关系抽取失败：' + err.message, 'e');
        return { entities: [], relations: [], error: err.message };
    }
    const obj = extractJsonObject(raw);
    if (!obj || !Array.isArray(obj.entities)) {
        // 不再静默返回空：把 AI 实际返回的内容摘要打到日志，能直接看出是"没给原文"还是"格式跑偏"
        const head = stripThink(String(raw || '')).trim().slice(0, 120).replace(/\s+/g, ' ');
        logTo('ce_wc_log', '关系抽取：解析失败（AI 未按要求返回 JSON）。返回开头：' + (head || '（空）'), 'e');
        return { entities: [], relations: [], error: 'AI 未返回合法 JSON，请重试或检查模型输出能力' };
    }
    const entities = obj.entities.filter((e) => e && e.id && e.name).map((e) => ({ id: String(e.id), type: String(e.type || '角色'), name: String(e.name).trim() }));
    const rels = Array.isArray(obj.relations) ? obj.relations.filter((r) => r && r.from && r.to) : [];
    if (!entities.length) {
        logTo('ce_wc_log', '关系抽取：AI 返回的 entities 为空', 'e');
        return { entities: [], relations: [], error: 'AI 未抽到任何实体' };
    }
    logTo('ce_wc_log', '关系抽取完成：实体 ' + entities.length + '、关系 ' + rels.length, 'g');
    return { entities, relations: rels };
}


/** 【任务4】剧情分段：每阶段/副本一条绿灯条目（≥300字）。迁移自原 wbPlotCore；支持断点续跑。 */
export async function wbPlotCore({ signal, entries = [], state = null, onProgress, onSegment, relatedMode = 'none' } = {}) {
    const text = getNovel().trim();
    const size = Math.max(50000, Number(settings().chunkSize) || 40000);
    const totalChunks = Math.ceil(text.length / size);
    const chunkAt = (i) => text.slice(i * size, (i + 1) * size);
    const cap = Math.min(totalChunks, scanCapOf());
    const resuming = state && state.len === text.length && state.cap === cap && state.next < cap;
    const startI = resuming ? state.next : 0;
    if (resuming) logTo('ce_wb_log', '剧情分段：从第 ' + (startI + 1) + '/' + cap + ' 段继续…');
    else { state = { len: text.length, cap, next: 0 }; logTo('ce_wb_log', '剧情分段：共 ' + cap + ' 段，开始…'); }
    const nsfw = settings().nsfw ? '可包含成人向剧情。' : '不必回避剧情，但不要展开露骨性描写。';
    const wantRelated = relatedMode === 'light' || relatedMode === 'heavy';
    let addedTotal = 0;
    for (let i = startI; i < cap; i++) {
        if (signal && signal.aborted) break;
        const chunk = chunkAt(i);
        if (onProgress) onProgress(i, cap);
        if (i > startI) await sleep(400);
        const prompt =
            '下面是小说按顺序的第 ' + (i + 1) + '/' + cap + ' 段。请把这段的剧情按「阶段 / 副本」切分并逐段总结。\n' +
            '每个阶段一条，包含：\n' +
            '- title：阶段 / 副本的名称\n' +
            '- keys：触发关键词（该阶段会被提到的名称、地点、副本名等，2~5个）\n' +
            '- content：该阶段的剧情总结，**不少于 300 字**，必须包含【重要出场角色、事件的前因后果、重要道具、时间线】，**不可遗漏任何剧情和伏笔**。\n' +
            (wantRelated ? '- related：该阶段**出场/涉及的人物姓名**列表（2~6个，仅原文出现的角色名）。\n' : '') +
            nsfw + '\n' +
            '只依据原文、不编造。输出 JSON 数组 [{"title":"","keys":[],"content":""' + (wantRelated ? ',"related":[]' : '') + '}]，只输出 JSON，不要代码块、不要解释。该段无实质剧情就输出 []。\n\n文本：\n' + chunk;
        let raw = '';
        const onWait = (n, code, w) => logTo('ce_wb_log', '第' + (i + 1) + '段 HTTP ' + code + '，' + (w / 1000) + 's 后重试(' + n + ')', 'e');
        try {
            raw = await generate(userMsgs(prompt), {
                signal, onWait, useStream: false,
                maxCont: settings().autoCont ? 3 : 0, logEl: 'ce_wb_log', label: `第${i + 1}段`,
            });
        } catch (err) {
            if (isAbort(err, signal)) { logTo('ce_wb_log', '已停止', 'e'); break; }
            logTo('ce_wb_log', '第' + (i + 1) + '段请求失败：' + err.message, 'e');
            state.next = i + 1; if (onSegment) onSegment(state); continue;
        }
        const arr = extractJsonArray(raw);
        if (!Array.isArray(arr)) {
            const snip = String(raw).trim().replace(/\s+/g, ' ').slice(0, 90);
            logTo('ce_wb_log', '第' + (i + 1) + '段解析失败，模型返回：' + (snip ? '「' + snip + '」' : '（空，多半被安全过滤挡了，或 max_tokens 被思考用光）'), 'e');
            state.next = i + 1; if (onSegment) onSegment(state); continue;
        }
        // 即时写入，停了也保留已生成的
        for (const e of arr) {
            if (!e || !e.title || !e.content) continue;
            const rawTitle = String(e.title).trim();
            const keys = Array.isArray(e.keys) ? e.keys.map((k) => String(k).trim()).filter(Boolean) : [];
            if (!keys.includes(rawTitle)) keys.unshift(rawTitle);
            const entry = { category: '剧情', title: '剧情·' + rawTitle, keys, content: String(e.content).trim(), constant: false };
            if (wantRelated) {
                const related = Array.isArray(e.related) ? e.related.map((s) => String(s).trim()).filter(Boolean) : [];
                if (related.length) entry.related = related;
            }
            const idx = entries.findIndex((x) => x.title === entry.title);
            if (idx >= 0) entries[idx] = entry; else entries.push(entry);
            addedTotal++;
        }
        state.next = i + 1;
        if (onSegment) onSegment(state);
        logTo('ce_wb_log', '第' + (i + 1) + '段 → 剧情条目累计 ' + addedTotal, 'g');
    }
    const done = state.next >= cap;
    if (done) logTo('ce_wb_log', '剧情分段完成，新增 ' + addedTotal + ' 条（共 ' + entries.length + ' 条）', addedTotal ? 'g' : 'e');
    return { entries, state: done ? null : state, done, added: addedTotal };
}

/** 【任务5/6】常驻条目（蓝灯）：kind='chars' 人物列表 | 'plot' 剧情大纲。迁移自原 wbConstantEntry。 */
export async function wbConstantEntry({ signal, onText, kind = 'chars', maxTokens } = {}) {
    const characters = getCharacters();
    const maxT = Math.max(6000, Number(maxTokens) || 4000);
    const sample = sampleText(getNovel().trim());
    const stream = !!settings().useStream;
    const cont = settings().autoCont ? 5 : 0;
    let prompt, title;
    if (kind === 'chars') {
        title = '人物列表';
        const list = characters.length ? ('已知角色：\n' + characters.map((c) => '· ' + c.name).join('\n') + '\n\n') : '';
        prompt = '下面是小说节选' + (characters.length ? '和已知角色清单' : '') + '。请生成一份**人物列表**，作为始终注入的常驻设定：把主要人物逐个列出，每人一行到两行，标明身份、与主角关系、核心性格。只依据原文、不编造。直接输出列表正文，不要解释、不要代码块。\n\n' + list + '=== 小说节选 ===\n' + sample;
    } else {
        title = '剧情大纲';
        prompt = '下面是小说节选。请生成一份**剧情大纲**，作为始终注入的常驻设定：按时间顺序概述主线走向与关键转折（几段即可），让 AI 始终了解故事全貌。只依据原文、不编造。直接输出大纲正文，不要解释、不要代码块。\n\n=== 小说节选 ===\n' + sample;
    }
    const raw = await generate(userMsgs(prompt), { maxTokens: maxT, useStream: stream, signal, onText, maxCont: cont, logEl: 'ce_wb_log', label: title });
    const content = stripFence(stripThink(raw)).trim();
    if (!content) {
        const snip = String(raw).trim().replace(/\s+/g, ' ').slice(0, 90);
        logTo('ce_wb_log', title + '：没生成内容。模型返回：' + (snip ? '「' + snip + '」' : '（空，多半被安全过滤挡了，或 max_tokens 被思考用光）'), 'e');
        return null;
    }
    return { category: '总纲', title, keys: [], content, constant: true };   // 蓝灯常驻
}

/* ===== 三、写入酒馆世界书 ===== */

/** uid：时间戳 + 随机数，避免与酒馆已有条目撞号 */
function genUid() { return Date.now() + Math.floor(Math.random() * 100000); }

/**
 * 默认插入顺序（酒馆 order）。
 * 总本 / 通用本 = 100；篇章本 = 200。酒馆把多本世界书的条目放在一起排序，
 * order 越大越靠上下文末尾、对输出影响越强，故篇章本（当前卷状态）会盖过总本（基础设定）。
 */
export const DEFAULT_ORDER = 100;

/** 由书名推断插入顺序：总本 / 通用本 → 100，其余（篇章本）→ 200 */
export function orderForBook(bookName) {
    const n = String(bookName || '').trim();
    if (!n || n === '总本' || n === '通用' || /总本|通用/.test(n)) return DEFAULT_ORDER;
    return 200;
}

/** 书名前缀（去掉文件里常见的书名号与「世界书」后缀）：《SAO》世界书 → SAO */
export function bookPrefix(bookName) {
    const n = String(bookName || '').trim()
        .replace(/^[《【\[]+/, '')
        .replace(/[》】\]]+$/, '')
        .replace(/世界书$/, '')
        .replace(/^[《【\[]+|[》】\]]+$/g, '')
        .trim();
    return n;
}

/**
 * 给条目标题加书卷前缀：「亚丝娜」+《SAO篇》→「SAO篇·亚丝娜」。
 * 为什么加：酒馆里同名条目不会去重、会一起注入，标题虽不参与触发，
 * 但前缀能让人一眼分清这条来自哪本书，也便于手动删改。
 * @param {string} title
 * @param {string} prefix
 * @returns {string}
 */
export function prefixTitle(title, prefix) {
    const t = String(title || '').trim();
    const p = String(prefix || '').trim();
    if (!t || !p) return t;
    if (t.startsWith(p + '·') || t.startsWith(p + '：') || t.startsWith(p + ' ')) return t;   // 已有前缀不重复加
    return p + '·' + t;
}

/**
 * 写入前按书卷加工条目（不改动传入对象）：
 *  - 加标题前缀（decorate.prefix 非空时），并把原标题记到 _bareTitle
 *    （覆盖写入时据此认出「上次的无前缀旧条目」，避免同名两份）
 *  - 补插入顺序（entry.order 未显式指定时按书名推断）
 * @param {Array} entries 内部条目
 * @param {{prefix?:string, order?:number}} [decorate]
 * @returns {Array}
 */
export function decorateEntries(entries, decorate = {}) {
    const prefix = String(decorate.prefix || '').trim();
    const order = Number(decorate.order);
    if (!prefix && !Number.isFinite(order)) return (entries || []).slice();
    return (entries || []).map((e) => {
        const out = { ...e };
        if (prefix) {
            out._bareTitle = String(e.title || '').trim();   // 原标题，供覆盖写入识别旧条目
            out.title = prefixTitle(e.title, prefix);
        }
        if (Number.isFinite(order)) out.order = order;
        return out;
    });
}

/** 把内部条目转换为酒馆 World Info 条目结构（保留 key/comment/content/constant 等核心字段） */
export function toTavernEntry(e, userReplace = {}, idx = 0) {
    const rn = replaceNameOf(userReplace);
    // 登场触发词（relatedKeys）并入 key，实现「剧情命中关键词即登场」
    const extraKeys = Array.isArray(e.relatedKeys) ? e.relatedKeys : [];
    const key = uniq([...wbSubKeys(e.keys, rn), ...extraKeys]);
    const order = Number(e.order);
    return {
        uid: genUid() + idx,
        key,
        keysecondary: [],
        comment: wbSub(e.title, rn) || '',
        content: wbSub(e.content, rn) || '',
        constant: !!e.constant,
        selective: true,
        order: Number.isFinite(order) ? order : DEFAULT_ORDER,
        position: 0,             // 0 = 角色定义之前
        depth: 4,                // 与 buildWbJson 一致（论坛：插入 @ 深度 4）
        sticky: Number(e.enterSticky) > 0 ? Number(e.enterSticky) : 0,  // 出场后留场轮数（>0 生效）
        disable: false,
    };
}

/* 写入酒馆 / 列表面板逻辑已拆分至 worldbook-write.js，此处转发以保持兼容 */
export { writeWorldbookToTavern, listWorldbooks, boundWorldbookName, loadWorldbookEntries } from './worldbook-write.js';

/* 世界书解耦（通用本 + 各篇章本）逻辑已拆分至 worldbook-split.js，此处转发以保持兼容 */
export { classifyEntries, writeSplitWorldbooks } from './worldbook-split.js';

export default {
    WB_FMT, CHAR_ENTRY_TPL, DEFAULT_ORDER,
    wbSub, wbSubKeys, buildWbPreview, buildWbJson, parseWbPreview, syncWbFromPreview,
    wbExtractCore, wbBgCore, wbMinorCore, wbPlotCore, wbConstantEntry,
    genCharEntries, relExtractCore,
    orderForBook, bookPrefix, prefixTitle, decorateEntries, toTavernEntry,
};
