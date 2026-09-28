import { sumFoods } from './domain.js?v=9';

/** Parse the shared meal JSON contract. All four nutrient fields are per 100 g. */
export function parseMealEstimate(content) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型没有返回餐食估算，请补充说明后重试。');
  const raw = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('模型没有返回有效的餐食 JSON，请重试。');
  let parsed;
  try { parsed = JSON.parse(raw.slice(start, end + 1)); }
  catch { throw new Error('模型返回的餐食 JSON 无法解析，请重试或手动填写。'); }
  if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length || parsed.items.length > 50) throw new Error('模型须返回1–50项食物，且使用 items 列表与每100克营养值。');
  const items = parsed.items.map(item => {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.trim()) throw new Error('模型返回的食物缺少名称，请手动修订或重新估算。');
    const normalized = { name: item.name.trim().slice(0, 100) };
    for (const key of ['grams', 'kcal', 'protein', 'carbs', 'fat']) {
      const value = item[key];
      if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) throw new Error('模型返回的份量或每100克营养值不完整，请手动修订或重新估算。');
      normalized[key] = Number(value);
    }
    if (normalized.grams <= 0) throw new Error('实际吃掉的食物份量必须大于0克。');
    // Uses the same domain validation as manual entries and actual accounting.
    sumFoods([normalized]);
    return normalized;
  });
  return { items, note: typeof parsed.note === 'string' ? parsed.note.slice(0, 4000) : '已生成每100克营养估算，请核对食物状态和实际份量后确认。' };
}
