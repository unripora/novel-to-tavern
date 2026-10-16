/**
 * prompts.js —— 提示词与模板常量
 *
 * 迁移自原 index.html 的内置模板与提示词片段。
 * 保持内容一致，便于与网页版行为对齐。
 */

/** 主角色卡模板 */
export const TEMPLATE = `char_name:
  Chinese name:
  Nickname:
  age:
  gender:
  height:
  identity:
    -
  background_story:
    童年(0-12岁):
    少年(13-18岁):
    青年(19-35岁):
    中年(35-至今):
    现状:
  social_status:
    -
  appearance:
    hair:
    eyes:
    skin:
    face_style:
    build:
      -
  attire:
    business_formal:
    business_casual:
    casual_wear:
    home_wear:
  archetype:
  personality:
    core_traits:
      - : ""
    romantic_traits:
      - : ""
  lifestyle_behaviors:
    -
    -
  work_behaviors:
    -
  emotional_behaviors:
    angry:
    happy:
  goals:
    -
  weakness:
    -
  likes:
    -
  dislikes:
    -
  skills:
    - 工作: ["",""]
    - 生活: ["",""]
    - 爱好: ["",""]`;

/** NSFW 附加块 */
export const NSFW_BLOCK = `
  NSFW_information:
    Sex_related traits:
      experiences:
      sexual_orientation:
      sexual_role:
      sexual_habits:
        -
    Kinks:
    Limits:`;

/** 事件导向模板 */
export const EVENT_TPL = `char_name:
  Chinese name:
  Nickname:
  age:
  gender:
  identity:
    -
  key_events:            # 人生关键事件（按时间顺序，每条写具体：何时 / 发生何事 / 对其造成什么影响）
    - 时间:
      事件:
      影响:
    - 时间:
      事件:
      影响:
  relationships:         # 重要人物关系
    - 对象:
      关系:
      羁绊或纠葛:
  turning_points:        # 塑造其性格/命运的转折点（原文里真实发生的，避免空泛）
    -
  appearance:
    hair:
    eyes:
    build:
    识别特征:
  personality:
    core_traits:
      - : ""             # 特质: 原文中的具体体现（哪一段/哪件事表现出来）
  values_and_drives:     # 价值观与内在动机（TA 真正在乎/追求/害怕的）
    -
  hidden_motives:        # 深层动机 / 隐藏目的 / 伏笔（仅在原文有暗示时写，无则留空）
    -
  goals:
    -
  weakness:
    -
  likes:
    -
  dislikes:
    -
  skills:
    -
  speech_style:          # 说话风格 / 口癖 / 标志性台词
    -
  NSFW_information:
    Sex_related traits:
      experiences:
      sexual_orientation:
      sexual_role:
      sexual_habits:
        -
    Kinks:
    Limits:`;

/** 精简人设模板 */
export const SLIM_TPL = `char_name:
  Chinese name:
  Nickname:
  age:
  gender:
  identity:
    -
  appearance:
    hair:
    eyes:
    build:
    识别特征:
  archetype:
  personality:
    core_traits:
      - : ""             # 特质: 原文中的具体体现
  values_and_drives:     # 价值观 / 内在动机
    -
  goals:
    -
  weakness:
    -
  likes:
    -
  dislikes:
    -
  skills:
    -
  speech_style:          # 说话风格 / 口癖
    -
  NSFW_information:
    Sex_related traits:
      experiences:
      sexual_orientation:
      sexual_role:
      sexual_habits:
        -
    Kinks:
    Limits:`;

/** NPC 模板 */
export const NPC_TPL = `char_name:
  Chinese name:
  identity:
  personality:
  relationship_to_main:   # 与主角/主要人物的关系
  appearance:             # 一句话外貌
  role_in_story:          # 在剧情里的作用
  notes:                  # 其它值得一提的点`;

/** 空白模板 */
export const BLANK_TPL = `char_name:
  # 在这里自由编写你的模板字段，AI 会照此填写
  Chinese name:
  `;

/** 默认模板 = 主模板 + NSFW */
export const DEFAULT_TPL = TEMPLATE + NSFW_BLOCK;

/**
 * 多人卡（旁白制）整段 prompt 模板。
 *
 * 与单角色卡模板（字段结构）不同：多人卡模板是**整段提示词**，
 * 通过占位符注入本次生成的信息，用户可整段编辑：
 *   {characters} 角色列表（每行「· 名字」）
 *   {cardName}   卡名
 *   {detail}     篇幅要求行（由详细程度生成，可为空）
 *   {nsfw}       NSFW 要求行
 *   {text}       各角色相关的小说文本拼接
 * 说明：正文里出现的半角花括号请写成 {names} 等具名占位；其余花括号会被保留。
 */
export const ENSEMBLE_TPL =
    '你是严谨的角色卡抽取助手，负责把一部小说里的多个角色整合成**一张「多人卡」**。\n' +
    '这张卡的核心人格是**旁白 / 主持人（GM）**：用第三人称做环境与场景描写、推进剧情、引导玩家游玩。\n' +
    '工作原则：只依据原文，绝不臆造；严禁把某个角色的经历/设定安到别的角色头上；严禁 OOC。\n\n' +
    '请把下面这些角色整合成**一张多人卡**，卡名为「{cardName}」。\n\n' +
    '本卡的角色：\n{characters}\n\n' +
    '【核心：旁白制】\n' +
    '· 本卡的 {{char}} 是**旁白**，不是任何一个具体角色。旁白负责：环境/地点/动作描写、推动故事进展、引导玩家行动。\n' +
    '· 旁白**不替玩家做决定**、**不冒充角色发言**；角色台词交给角色自己说。\n' +
    '· 输出分为两层，泾渭分明：**旁白层**（叙述）与**对话层**（角色台词，明确标注是哪个角色说的）。\n\n' +
    '【塑造角色的唯一手法：对话示例（务必照做）】\n' +
    '· **不要**用「角色名：性格标签、背景…」这种**平铺档案**写法（AI 只会念标签，不会演）。\n' +
    '· **要**用**对话示例**来「演出」每个角色：让角色自己说话、做动作，性格从语气与动作里自然透出。\n' +
    '· 每个示例的动作/神态**必须带角色名**（如 `*亚丝娜放下碗，温和地笑。*`），帮助 AI 把动作和人绑定。\n' +
    '· 角色台词须**明确标注说话人**；对话交替进行（不同角色你来我往，可含 {{user}}）。\n' +
    '· 至少覆盖到每个选定角色，让 AI 学到「谁该怎么说话」。\n\n' +
    '【剧情推进与角色登场】\n' +
    '· 开场**只有旁白**铺陈场景与引导，**不要点名任何角色**、不要让其现身。\n' +
    '· 各角色的基本信息写进卡里（旁白心里知道），但**只有剧情推进到位时，旁白才安排该角色出场**，之后该角色才开口说话。\n' +
    '· 严禁一开场就让所有角色同时登场；也严禁剧透尚未出场角色的后续信息。\n\n' +
    '【填写要求】\n' +
    '· description：**世界观概括** + **旁白职责与约束** + **每个角色的对话示例**（用「角色名: 台词」+ 带名字的动作；这是本卡最重要、最详细的部分；依据原文、精炼生动）。\n' +
    '· personality：旁白的风格与准则（第三人称、简洁、推进剧情、不 OOC、不替玩家决定）。\n' +
    '· scenario：开局场景（玩家此刻所处环境，不点名角色）。\n' +
    '· first_mes：**旁白开场**——环境地点描写 + 引导玩家（示例口吻：「你身处……你可以……」），只出现旁白。\n' +
    '· mes_example：**至少 3 组**「旁白叙述 + 多角色台词」的分工示例，教 AI 如何分层与区分角色\n' +
    '  （旁白用叙述句；角色台词标注角色名；动作带角色名；`{{user}}` 与 `{{char}}` 交替）。\n' +
    '{detail}{nsfw}' +
    '· 只依据原文，不编造；原文未提及的填「（原文未提及）」。\n\n' +
    '【输出格式】严格输出**一个 JSON 对象**（不要代码块、不要解释），字段固定为：\n' +
    '{\n' +
    '  "name": "{cardName}",\n' +
    '  "description": "……",\n' +
    '  "personality": "……",\n' +
    '  "scenario": "……",\n' +
    '  "first_mes": "……",\n' +
    '  "mes_example": "……"\n' +
    '}\n\n' +
    '=== 小说文本（与这些角色相关）===\n{text}';

/** 多人卡模板的固定名（用于识别与弹窗判断） */
export const ENSEMBLE_TPL_NAME = '多人卡（旁白制）';

/** 内置模板列表 */
export const BUILTINS = [
    { name: '默认模板', text: DEFAULT_TPL },
    { name: '事件导向模板', text: EVENT_TPL },
    { name: '精简人设（无经历）', text: SLIM_TPL },
    { name: 'NPC 模板（配角简版）', text: NPC_TPL },
    { name: '空白模板（自定义）', text: BLANK_TPL },
    { name: ENSEMBLE_TPL_NAME, text: ENSEMBLE_TPL },
];

/** 世界书条目格式说明 */
export const WB_FMT = '每个条目严格用如下格式：\n========== 序号. 标题　[分类] ==========\n触发关键词: 关键词1、关键词2\n推荐模式: 常驻（蓝灯）  或  关键词触发（绿灯）\n内容:\n（该条目的设定内容）\n\n（条目之间空一行）';

/**
 * 构建「数值面板」提示词块（追加到角色卡 / user 人设模板末尾）
 *
 * @param {Object} o
 * @param {string} [o.fields]      用户自定义字段（字段名用 / 或顿号分隔）；留空则由 AI 依作品类型决定
 * @param {string} [o.refValues]   用户给定的参考数值（可空）
 * @param {boolean} [o.persona]    是否为 user 人设（true 时追加「与角色的相对强度对比」）
 * @returns {string}
 */
export function buildStatPanelBlock({ fields = '', refValues = '', persona = false } = {}) {
    const fieldsLine = fields && fields.trim()
        ? fields.trim()
        : '（未指定：请依据本作品类型自行选择合适的数值维度——战斗类可用 等级/HP/MP/装备/技能，' +
          '能力类可用 灵压/能力/招式，等等）';
    const refLine = refValues && refValues.trim()
        ? '\n· 用户给出的参考数值（请尽量采纳、与之一致）：\n' + refValues.trim()
        : '';

    const lines = [];
    lines.push('');
    lines.push('【数值面板】');
    lines.push('请在角色卡**末尾**追加一个数值面板，格式如下：');
    lines.push('');
    lines.push('```status');
    lines.push('强度评分: <1.0-10.0，保留一位小数>');
    lines.push('字段: <按下面的字段列表逐行填写>');
    lines.push('```');
    lines.push('');
    lines.push('要填写的字段：');
    lines.push(fieldsLine);
    if (persona) {
        lines.push('与 {{char}} 的相对强度: <说明 {{user}} 比该角色强 / 弱多少，' +
            '例如「比 {{char}} 弱 1.2 分」或「比 {{char}} 强 0.5 分」；同档则写「与 {{char}} 相当」>');
    }
    if (refLine) lines.push(refLine.trim());
    lines.push('');
    lines.push('生成规则：');
    lines.push('1. 先通读原文，找出该角色的实际战斗 / 能力表现，据此给出 1.0-10.0 的强度评分，' +
        '**保留一位小数**。同书角色之间必须有区分度：主角、反派首领、路人不可同分；' +
        '强弱接近的角色用小数体现细微差距（如 7.5 与 8.3）。');
    lines.push('2. 其余各字段的数值必须与强度评分相匹配：高分给高数值范围，低分给低数值范围；' +
        '具体数值范围由你依据本作品的设定体系自行把握（不强行统一）。');
    lines.push('3. 每个数值尽量附一句简短依据（如「原文第X章击败XX」），避免凭空编造。');
    lines.push('4. 原文未提及的维度填「（原文未提及）」，不要编造。');
    lines.push('5. 数值面板只追加在上述模板末尾，不要改动原有字段，也不要输出解释。');
    return lines.join('\n');
}

/**
 * 构建「分阶段」角色卡的阶段标题行（用于单卡分阶段模式）
 * @param {string} nodeName 篇章名
 * @param {string} summary 篇章摘要（可空）
 * @returns {string}
 */
export function buildStageHeader(nodeName, summary = '') {
    const head = '\n\n## 【' + nodeName + '】\n';
    return summary ? (head + '<!-- ' + summary + ' -->\n') : head;
}

export default {
    TEMPLATE, NSFW_BLOCK, EVENT_TPL, SLIM_TPL, NPC_TPL, BLANK_TPL,
    DEFAULT_TPL, ENSEMBLE_TPL, ENSEMBLE_TPL_NAME, BUILTINS, WB_FMT, buildStatPanelBlock, buildStageHeader,
};
