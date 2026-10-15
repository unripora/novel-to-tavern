/**
 * timeline-synopsis.js —— 「故事梗概」解析与篇章划分
 *
 * 从 timeline.js 拆出（避免单文件超 500 行）。
 * 职责：解析梗概、清洗篇名、抽取检索候选、模糊检索正文、按梗概划分（含 AI 边界细化）。
 */

import { getNovel } from './novel.js';
import { generate } from './generate.js';
import { stripFence, stripThink, extractJsonArray, logTo } from './util.js';
import { enforceOrder } from './timeline-core.js';

/**
 * 解析「故事梗概」文本，提取篇章清单
 *
 * 支持用户常见的 markdown 梗概格式，如：
 *   ## 1. 艾恩葛朗特篇（Aincrad / SAO 篇，第 1 卷）
 *   （正文描述若干行……）
 *   **七玄门风云 / 初入黄枫谷（1~217章）｜炼气→筑基**
 *
 * 解析规则：
 *   - 以行首的 markdown 标题（# / ## / ###）或以「数字.」「数字、」「数字)」开头的行，或**整行加粗**的行作为篇章起点
 *   - 篇章名做清洗：去掉序号、markdown 标记（**、*、`）、行尾括号补充、以及「｜/ | 」后的阶段说明
 *   - 自篇章名起，直到下一个篇章标题之间的所有非空行，拼成该篇章 summary
 *
 * @param {string} raw 梗概原文
 * @returns {Array<{name:string, summary:string}>}
 */
export function parseSynopsis(raw) {
    const lines = String(raw || '').split(/\r?\n/);
    const items = [];
    let cur = null;

    const isHeading = (ln) => {
        const t = ln.trim();
        if (!t) return false;
        if (/^#{1,6}\s+/.test(t)) return true;                        // markdown 标题
        if (/^\d+\s*[.、)．]\s*\S/.test(t)) return true;               // 序号行：1. / 1、 / 1)
        if (/^\*\*.+\*\*[（(]?/.test(t)) return true;                 // 整行加粗：**篇名**
        return false;
    };

    for (const ln of lines) {
        if (isHeading(ln)) {
            if (cur) items.push(cur);
            const t = ln.trim();
            cur = {
                name: cleanName(ln),
                summary: '',
                // 记录来源类型：markdown 标题可能是「大类」，无概述时可丢弃
                md: /^#{1,6}\s+/.test(t),
            };
        } else if (cur) {
            const t = ln.trim().replace(/^>\s?/, '');        // 去掉引用块前缀
            if (t && !/^-{3,}$/.test(t)) {
                cur.summary += (cur.summary ? '\n' : '') + t;
            }
        }
    }
    if (cur) items.push(cur);

    // 丢弃「markdown 大类标题且无任何概述」的项（如「## 一、人界篇」下面直接是子篇章）
    const kept = items.filter((it) => !(it.md && !it.summary.trim()));
    return (kept.length ? kept : items).map(({ name, summary }) => ({ name, summary }));
}

/**
 * 清洗篇章名：去序号、markdown 标记、括号补充、阶段说明
 * 例：`**七玄门风云 / 初入黄枫谷（1~217章）｜炼气→筑基**` → `七玄门风云 / 初入黄枫谷`
 * @param {string} ln 原始行
 * @returns {string}
 */
function cleanName(ln) {
    let s = String(ln || '').trim();
    s = s.replace(/^#{1,6}\s+/, '');                       // 去 markdown 标题号
    s = s.replace(/^\d+\s*[.、)．]\s*/, '');                // 去行首阿拉伯序号
    s = s.replace(/^[一二三四五六七八九十百]+\s*[、.)）]\s*/, '');   // 去行首中文序号（如「一、」）
    s = s.replace(/^[\s*_`]+|[\s*_`]+$/g, '');             // 去行首尾 **、*、_、`
    s = s.replace(/^[\s*_`]+|[\s*_`]+$/g, '');             // 再跑一次（多层标记）
    s = s.replace(/[（(].*$/, '').trim();                  // 去括号补充（如「（1~217章）」）
    s = s.replace(/[｜|].*$/, '').trim();                  // 去「｜」后的阶段说明（如「｜炼气→筑基」）
    s = s.replace(/[:：]\s*$/, '').trim();                 // 去结尾冒号
    return s.trim();
}

/**
 * 从篇章名中抽取用于检索的候选关键词（按优先级返回数组）
 *   例：「艾恩葛朗特篇」→ ['艾恩葛朗特']
 *       「七玄门风云 / 初入黄枫谷」→ ['七玄门风云', '初入黄枫谷']
 *       「Alicization 篇」→ ['Alicization']
 * @param {string} name
 * @returns {string[]}
 */
export function coreKeywords(name) {
    let s = String(name || '').trim();
    s = s.replace(/[（(].*$/, '').trim();                    // 去括号补充
    // 按 / ／、+、＋、·、顿号等分隔符拆成多个候选
    const parts = s.split(/[/／+＋·、]+/).map((p) => p.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
        const q = p.replace(/[篇卷部章季]$/, '').trim();      // 去结尾的「篇/卷/部/章/季」
        if (q) out.push(q);
    }
    if (!out.length) out.push(s);
    return out;
}

/** 兼容旧调用：取第一个候选 */
export function coreKeyword(name) {
    return coreKeywords(name)[0] || String(name || '').trim();
}

/**
 * 用 AI 把「不规范的梗概」整理成标准格式
 *
 * 标准格式（每篇两行以上，便于 parseSynopsis 解析）：
 *   ## 篇名
 *   概述文字……
 *
 * @param {string} raw 用户原始梗概
 * @param {{signal?:AbortSignal}} [opts]
 * @returns {Promise<string>} 规范化后的梗概
 */
export async function normalizeSynopsisText(raw, { signal } = {}) {
    const src = String(raw || '').trim();
    if (!src) throw new Error('请先粘贴故事梗概');
    const prompt =
        '下面是一份**写法不规范**的作品梗概。请把它整理成规范格式，用于后续按篇章切分小说正文。\n\n' +
        '整理要求：\n' +
        '1. 每一篇章输出为两行：第一行是 `## 篇名`（篇名要**干净**：不要序号、不要 markdown 加粗符号、不要括号里的章节范围、不要「｜」后的说明、不要「/」并用多个名字）；' +
        '第二行起是该篇章的概述（保留原文关键事件、人物、时间线信息）。\n' +
        '2. **严格保持原有篇章的先后顺序**，不要合并、不要重新划分。\n' +
        '3. **只保留真正的篇章，丢掉纯分类性质的「大类标题」**：如果某个标题下面还套着若干子篇章（例如「人界篇」下面有「七玄门风云」「乱星海篇」…），则**不要**把它单独作为一个篇章，只输出它的子篇章。' +
        '判断依据：大类标题通常只有一句概括、没有独立剧情，且紧跟其后就是带序号的子篇章。\n' +
        '4. 只保留属于「本篇」的内容；若原文明确说明某部分是「另一本书 / 独立续作 / 不算本篇」，则删去该部分。\n' +
        '5. 若原文给了章节范围（如「1~217章」），把它保留在**概述**开头（写成「[1~217章] ……」），但**不要写进篇名**。\n' +
        '6. 不要输出任何解释、前言、代码块，只输出整理后的梗概正文。\n\n' +
        '示例输入：\n' +
        '## 一、人界篇（第1～1568章）\n' +
        '1. **七玄门风云 / 初入黄枫谷（1~217章）｜炼气→筑基**\n' +
        '韩立出身山村，遇墨大夫，得到掌天瓶。\n' +
        '2. **乱星海篇（218~692章）｜筑基→结丹**\n' +
        '魔道入侵越国，韩立逃亡乱星海。\n\n' +
        '示例输出：\n' +
        '## 七玄门风云\n' +
        '[1~217章] 韩立出身山村，遇墨大夫，得到掌天瓶。\n' +
        '## 乱星海篇\n' +
        '[218~692章] 魔道入侵越国，韩立逃亡乱星海。\n\n' +
        '=== 原始梗概 ===\n' + src;
    const out = await generate([
        { role: 'system', content: '你是严谨的文本整理助手，只做格式规范化：保持篇章顺序、只剔除纯分类的大类标题，绝不改动剧情内容、不合并、不重新划分。' },
        { role: 'user', content: prompt },
    ], { signal, useStream: false, maxCont: 3, logEl: 'ce_tl_log', label: '梗概优化' });
    const text = stripThink(stripFence(out)).trim();
    if (!text) throw new Error('AI 未返回内容，请重试');
    return text;
}

/**
 * 在正文中模糊检索一个关键词的「分界位置」
 *
 * 策略（按优先级）：
 *   1. 卷标志行：正文形如「第X卷 关键词 …」的标志行（取**最早**一处的行首位置）
 *      —— 优先于散落提及，因为标志行才是篇章真正的起点
 *   2. 反向包含：正文里「第X卷 <卷名>」标志行，卷名与关键词互相包含
 *   3. 精确包含：正文含关键词本身（兜底，可能命中正文中间的散落提及）
 *
 * @param {string} text 正文
 * @param {string} kw   关键词
 * @returns {{pos:number, hit:string}|null}
 */
export function fuzzyFind(text, kw) {
    if (!kw) return null;

    // ① 「第X卷 关键词」标志行（取最早一处）
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reVol = new RegExp('^第[0-9一二三四五六七八九十百千]+卷\\s*' + esc, 'gm');
    const m = reVol.exec(text);
    if (m) return { pos: m.index, hit: m[0] };

    // ② 反向：正文里的「第X卷 <卷名>」标志行，卷名与关键词互相包含
    const reAnyVol = /^第[0-9一二三四五六七八九十百千]+卷\s+(\S+)/gm;
    let mm;
    while ((mm = reAnyVol.exec(text)) !== null) {
        const volName = (mm[1] || '').trim();
        if (volName && (volName.includes(kw) || kw.includes(volName))) {
            return { pos: mm.index, hit: mm[0] };
        }
    }

    // ③ 精确包含（兜底）
    const p0 = text.indexOf(kw);
    if (p0 >= 0) return { pos: p0, hit: kw };

    return null;
}

/**
 * 按「故事梗概」划分篇章
 *
 * 流程：
 *   1. 解析梗概得到篇章清单（篇名 + 概述）——**顺序以梗概为准，不由 AI 决定**
 *   2. 模糊检索：从篇名抽关键词，在正文中模糊定位（卷标志行 → 反向包含 → 精确包含）
 *   3. AI 复核边界：把「梗概 + 参考文档 + 抽样正文」交给 AI，请它为**每个篇章**（含本地已命中者）
 *      给出「正文中可检索的关键词」，再回正文模糊检索；AI 定位成功则覆盖本地结果以校正偏差
 *   4. 按梗概原顺序切分；仅对「最终仍无位置」的篇章按序插值兜底，不再打乱顺序
 *
 * @param {string} raw 梗概原文
 * @param {{signal?:AbortSignal, onLog?:(msg:string,cls?:string)=>void, refDoc?:string}} [opts]
 *        refDoc：本地参考文档（作品资料 / 目录 / 设定），用于辅助 AI 细化边界
 * @returns {Promise<{nodes:Array, missed:string[], refined:boolean}>}
 */
export async function divideBySynopsis(raw, { signal, onLog, refDoc } = {}) {
    const text = getNovel();
    if (!text) throw new Error('请先导入小说');
    if (!String(raw || '').trim()) throw new Error('请先粘贴故事梗概');

    const log = (m, c) => { if (onLog) onLog(m, c); else logTo('ce_tl_log', m, c); };
    const textLen = text.length;
    const ref = String(refDoc || '').trim();
    const items = parseSynopsis(raw);
    if (!items.length) throw new Error('未能从梗概中解析出篇章，请检查格式（每篇以标题或「1.」开头）');
    log('梗概解析出 ' + items.length + ' 个篇章（顺序以梗概为准），开始模糊检索篇名…' +
        (ref ? '（已附带参考文档 ' + ref.length + ' 字）' : ''));

    // ① 模糊检索（篇名 → 候选关键词 → 正文定位；多候选依次尝试）
    const missed = [];
    for (const it of items) {
        it.kws = coreKeywords(it.name);
        let hit = null;
        for (const kw of it.kws) {
            hit = fuzzyFind(text, kw);
            if (hit) break;
        }
        if (hit) {
            it.pos = hit.pos;
            log('篇章「' + it.name + '」命中「' + hit.hit + '」于 ' + (hit.pos / textLen * 100).toFixed(1) + '%', 'g');
        } else {
            missed.push(it.name);
            log('篇章「' + it.name + '」未命中，将交由 AI 复核定位', 'e');
        }
    }

    // ② AI 复核边界：对**全部篇章**（不只未命中）请 AI 给出「正文中可检索的关键词」，
    //    回正文模糊检索；AI 定位成功则覆盖本地结果（含校正已命中的偏差）。
    let refined = false;
    try {
        log('提交 AI 复核全部篇章的边界…' + (missed.length ? ('（其中 ' + missed.length + ' 个本地未命中）') : ''));
        const sample = sampleForTimeline(text);
        const prompt = buildSynopsisPrompt(items);
        const userMsg = prompt +
            (ref ? ('\n\n=== 参考文档（作品资料，供定位参考）===\n' + ref) : '') +
            '\n\n=== 小说内容（抽样）===\n' + sample;
        const rawAi = await generate([
            { role: 'system', content: '你是精通叙事结构与文本检索的文学分析师。' },
            { role: 'user', content: userMsg },
        ], { signal, useStream: false, maxCont: 2 });

        const arr = extractJsonArray(stripThink(stripFence(rawAi)));
        if (arr.length) {
            for (let i = 0; i < items.length; i++) {
                const kw = String((arr[i] && (arr[i].keyword || arr[i].key || arr[i].name)) || '').trim();
                if (!kw) continue;      // AI 未给出关键词：保留本地结果（已命中保留，未命中留给插值）
                const hit = fuzzyFind(text, kw);
                if (!hit) { log('AI 关键词「' + kw + '」未能在正文检索到，保留原结果', 'e'); continue; }
                const prevPos = items[i].pos;
                const moved = prevPos != null && prevPos !== hit.pos;
                items[i].pos = hit.pos;
                delete items[i].estimated;      // 已被 AI 定位，取消插值标记
                log('篇章「' + items[i].name + '」' + (moved ? '边界经 AI 校正' : 'AI 定位') +
                    '，命中「' + hit.hit + '」于 ' + (hit.pos / textLen * 100).toFixed(1) + '%' +
                    (moved ? '（原 ' + (prevPos / textLen * 100).toFixed(1) + '%）' : ''), 'g');
            }
            refined = true;
        }
    } catch (e) {
        log('AI 边界复核失败（' + e.message + '），未命中的篇章将按顺序插值', 'e');
    }

    // ③ 按「梗概原顺序」切分：保持 items 顺序，仅对无位置者按前后已知位置插值
    fillMissingPositions(items, textLen);

    // 强制单调有序：后一篇开头不早于前一篇末尾（容差内允许略早，因篇章边界本身模糊）
    const nodes = enforceOrder(items.map((it, i) => ({
        name: it.name,
        summary: it.summary,
        start: it.pos,
        end: (i + 1 < items.length) ? items[i + 1].pos : textLen,
    })), textLen);

    // 首篇章起点归零（正文开头可能早于第一个标志行）
    if (nodes.length && nodes[0].start > 0) nodes[0].start = 0;

    const fallback = items.filter((it) => it.estimated).length;
    log('梗概划分完成，共 ' + nodes.length + ' 个篇章' + (fallback ? '（' + fallback + ' 个按顺序插值）' : ''), 'g');
    return { nodes, missed, refined };
}

/**
 * 为缺失位置的篇章按「梗概原顺序」插值
 * 仅在前后已有已知位置之间线性均分，保持整体顺序不被打乱。
 */
function fillMissingPositions(items, textLen) {
    let prev = 0;
    for (let i = 0; i < items.length; i++) {
        if (items[i].pos != null) { prev = items[i].pos; continue; }
        // 找下一个已知位置
        let next = textLen;
        let nextIdx = items.length;
        for (let j = i + 1; j < items.length; j++) {
            if (items[j].pos != null) { next = items[j].pos; nextIdx = j; break; }
        }
        const gapCount = nextIdx - i + 1;   // 本段未知数 + 1（含终点）
        let k = 1;
        for (let j = i; j < nextIdx; j++) {
            items[j].pos = Math.round(prev + (next - prev) * (k / gapCount));
            items[j].estimated = true;
            k++;
        }
        i = nextIdx - 1;
        if (nextIdx < items.length) prev = items[nextIdx].pos;
    }
}

/** 梗概划分的 AI 边界复核提示词（顺序已由梗概锁定，只求可检索关键词） */
function buildSynopsisPrompt(items) {
    const list = items.map((it, i) =>
        (i + 1) + '. 「' + it.name + '」：' + (it.summary || '（无概述）').replace(/\n+/g, ' ')
    ).join('\n');
    return '下面给出这部小说的**篇章清单**（顺序已确定，请勿改动顺序）以及小说抽样内容。\n' +
        '你的任务**不是重新划分篇章**，而是为**每一个篇章**给出一个**能在这部小说正文里直接检索到的关键词**' +
        '（例如卷名、篇章标题、专有名词），用于在正文中定位该篇章的起始位置。\n' +
        '关键词要简短、唯一，优先取正文中原样出现的词（如卷名「妖精之舞」）。\n' +
        '该关键词应尽量指向**该篇章在正文中的起始处**；由于篇章按时间先后排列，' +
        '后一个篇章的起始必须晚于前一个篇章。若确实无法确定，留空字符串。\n\n' +
        '篇章清单（顺序固定）：\n' + list + '\n\n' +
        '只输出 JSON 数组，元素顺序与篇章清单**完全一致**，形如：\n' +
        '[{"keyword":"艾恩葛朗特"},{"keyword":"妖精之舞"},{"keyword":""}]\n' +
        '不要输出解释、不要代码块。';
}

/**
 * 抽样全书：头、中、尾各取一段 + 等距多段，控制总长度
 */
export function sampleForTimeline(text, cap = 60000) {
    if (text.length <= cap) return text;
    const pieces = [];
    const seg = 6000;
    const slices = 8;
    pieces.push(text.slice(0, seg));                 // 头部
    for (let i = 1; i < slices - 1; i++) {
        const start = Math.floor(i * text.length / slices);
        pieces.push(text.slice(start, start + seg));
    }
    pieces.push(text.slice(text.length - seg));       // 尾部
    return pieces.join('\n\n…（此处省略）…\n\n').slice(0, cap);
}
