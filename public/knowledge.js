/** Small source-checked reference catalog; none of these entries is professionally reviewed. */
const checked = () => Object.freeze({ status: 'source-checked', date: '2026-09-28', note: '来源已核对，尚未专业审核' });

export const knowledgeCards = Object.freeze([
  {
    id: 'regular-resistance-training',
    title: '先建立规律的阻力训练',
    summary: 'ACSM的2026年资料强调规律参与、覆盖主要肌群，并按个人能力和目标安排训练。徒手、弹力带和居家训练也可有效；普通健康成人不必每组都练到完全力竭。先选择能持续完成的训练，再根据恢复情况调整。',
    keywords: ['阻力训练', '力量训练', '力训', '训练计划', '新手', '居家', '力竭', '循序', '增肌', '分化'],
    sourceUrl: 'https://acsm.org/resistance-training-guidelines-update-2026/',
    sourceName: 'ACSM：2026年阻力训练指南更新',
    review: checked(),
  },
  {
    id: 'track-weight-food-and-activity',
    title: '把体重、饮食和活动记录放在一起看',
    summary: 'NIDDK建议定期称重并记录变化，也可用日记或应用记录饮食和身体活动，以跟踪进展。应用里的阶段复盘依赖这些实际记录；漏记的餐食或训练会限制判断，不能把缺失记录当作真实的零摄入或零活动。',
    keywords: ['体重', '趋势', '复盘', '记录', '称重', '进展', '平台期', '减重', '反弹'],
    sourceUrl: 'https://www.niddk.nih.gov/health-information/weight-management/adult-overweight-obesity/eating-physical-activity',
    sourceName: 'NIH NIDDK：饮食、活动与体重管理',
    review: checked(),
  },
  {
    id: 'energy-estimate-is-prediction',
    title: '代谢公式给出估算起点',
    summary: 'Mifflin–St Jeor方程根据体重、身高、年龄和性别估计静息能量消耗。它来自人群研究中的预测模型，不能当作你的间接测热实测结果。应用还会加入活动假设，因此总消耗和营养目标也需要结合个人记录判断。',
    keywords: ['代谢', '基础代谢', '静息', 'BMR', 'TDEE', 'Mifflin', '总消耗', '营养目标', '热量目标', '卡路里', '热量'],
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/2305711/',
    sourceName: 'Mifflin等：健康成人静息能量消耗预测方程（1990）',
    review: checked(),
  },
  {
    id: 'raw-and-cooked-weight',
    title: '生重与熟重要对应食物状态',
    summary: 'USDA的烹调得率资料说明，烹饪时失水、吸水及脂肪增减都会改变食物重量。记餐时应让称量状态与营养条目一致，并核对烹调方式。应用的整批生熟重量换算只估计份量比例，不能测出烹饪中损失或新增的全部营养。',
    keywords: ['生重', '熟重', '生熟', '生米', '熟饭', '吸水', '失水', '烹饪', '烹调', '换算'],
    sourceUrl: 'https://www.ars.usda.gov/ARSUserFiles/80400525/Data/retn/USDA_CookingYields_MeatPoultry.pdf',
    sourceName: 'USDA ARS：肉类与禽类烹调得率表',
    review: checked(),
  },
  {
    id: 'per-100g-and-edible-portion',
    title: '每100克数值要乘以实际可食份量',
    summary: 'USDA Foundation Foods以每100克可食部分提供营养数值，可据实际食物重量换算份量营养。例如每100克含130千卡，实际吃200克即按260千卡计。骨、壳等未吃部分不应算进可食重量；包装标签若按每份标示，应先核对每份克数。',
    keywords: ['每100', '每 100', '100g', '100克', '份量', '分量', '份数', '标签', '可食', '克数', '食物替换'],
    sourceUrl: 'https://fdc.nal.usda.gov/Foundation_Foods_Documentation/',
    sourceName: 'USDA FoodData Central：Foundation Foods数据说明',
    review: checked(),
  },
].map(card => Object.freeze({ ...card, keywords: Object.freeze(card.keywords) })));

/** Keyword retrieval only: zero matches yields zero cards, never an invented reference. */
export function findKnowledge(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const query = text.normalize('NFKC').toLocaleLowerCase();
  return knowledgeCards
    .map((card, index) => ({ card, index, score: card.keywords.reduce((score, keyword) => score + (query.includes(keyword.normalize('NFKC').toLocaleLowerCase()) ? 1 : 0), 0) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .map(match => match.card);
}
