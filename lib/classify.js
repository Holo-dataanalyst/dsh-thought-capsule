/**
 * 固定分类表：一份常量同时供宿主（存储/工具）、浏览器（下拉框与标签）使用。
 * 分类不做用户自定义（见已批准计划的「明确不做」），所以这里是唯一真源。
 */

/** @typedef {{ id: string, zh: string, en: string, keywords: string[] }} Category */

/** @type {Category[]} */
export const CATEGORIES = [
  {
    id: 'tools',
    zh: '插件/工具',
    en: 'Plugins & tools',
    keywords: ['插件', '工具', '软件', '应用', '脚本', '扩展', '主题', '皮肤', '组件', '命令', 'mcp', 'plugin', 'tool', 'extension', 'cli', 'skill', 'api', 'sdk', 'dsh', 'npm', 'repo'],
  },
  {
    id: 'work',
    zh: '工作',
    en: 'Work',
    keywords: ['工作', '项目', '会议', '老板', '领导', '客户', '汇报', '需求', '排期', '上线', '同事', '评审', '加班', '面试', '合同', 'deadline', 'work', 'meeting', 'project', 'review', 'pr', 'okr', 'kpi'],
  },
  {
    id: 'idea',
    zh: '灵感',
    en: 'Ideas',
    keywords: ['想法', '点子', '灵感', '设想', '脑洞', '方案', '思路', '设计', '创意', '如果', '做个', 'idea', 'thought', 'concept', 'what if'],
  },
  {
    id: 'read',
    zh: '阅读/资料',
    en: 'Reading',
    keywords: ['文章', '书', '链接', '论文', '博客', '文档', '教程', '阅读', '视频', '资料', '课程', '播客', 'article', 'book', 'link', 'blog', 'docs', 'tutorial', 'paper', 'video', 'podcast', 'http'],
  },
  {
    id: 'life',
    zh: '生活',
    en: 'Life',
    keywords: ['生活', '买', '吃', '电影', '旅行', '健身', '家人', '家务', '锻炼', '睡觉', '看病', '房租', '快递', 'life', 'buy', 'movie', 'trip', 'gym', 'food'],
  },
  { id: 'other', zh: '其他', en: 'Other', keywords: [] },
];

/** @type {string[]} */
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/**
 * @param {string} id
 * @param {boolean} [zh]
 * @returns {string}
 */
export function categoryLabel(id, zh = true) {
  const found = CATEGORIES.find((c) => c.id === id);
  if (found) return zh ? found.zh : found.en;
  // 用户自建分组的 id 不在内置表里：显示 id 本身，比谎报「其他」有用。
  return id ? String(id) : zh ? '其他' : 'Other';
}

/**
 * 关键词打分挑分类：每个命中关键词 +1，取严格最大者；没有命中或平手 → other。
 * 只做启发式，用户可以随时手改分类。
 *
 * @param {string} text
 * @returns {string}
 */
export function inferCategory(text) {
  const raw = typeof text === 'string' ? text.toLowerCase() : '';
  if (!raw.trim()) return 'other';
  let best = 'other';
  let bestScore = 0;
  for (const category of CATEGORIES) {
    if (!category.keywords.length) continue;
    let score = 0;
    for (const keyword of category.keywords) {
      if (matchesKeyword(raw, keyword)) score += 1;
    }
    if (score > bestScore) {
      best = category.id;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 中文关键词按子串匹配；纯 ASCII 关键词按词边界匹配，避免 'pr' 命中 'project'。
 *
 * @param {string} haystack 已 lowercase 的文本
 * @param {string} keyword
 * @returns {boolean}
 */
function matchesKeyword(haystack, keyword) {
  const needle = keyword.toLowerCase();
  if (!/^[a-z0-9 _-]+$/.test(needle)) return haystack.includes(needle);
  if (needle.includes(' ') || needle.includes('-')) return haystack.includes(needle);
  const index = haystack.indexOf(needle);
  if (index === -1) return false;
  const before = index === 0 ? '' : haystack[index - 1];
  const after = index + needle.length >= haystack.length ? '' : haystack[index + needle.length];
  const isWord = (ch) => /[a-z0-9]/i.test(ch);
  return !isWord(before) && !isWord(after);
}
