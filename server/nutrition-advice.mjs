import { parseNutritionAdvice } from '../public/meal-contract.js';
import { complete, HttpError } from './providers.mjs';

// Keep validation and the single repair attempt inside the same request and AI limit.
export async function completeNutritionAdvice({ mealTiming, completeImpl = complete, ...options }) {
  const startedAt = performance.now();
  const timeoutMs = options.timeoutMs ?? 60000;
  let providerMs = 0;
  let failure;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const remainingMs = Math.floor(timeoutMs - (performance.now() - startedAt));
    if (remainingMs <= 0) throw new HttpError(504, 'AI 响应超时，请重试或切换模型。');
    const messages = attempt === 1 ? options.messages : [...options.messages, {
      role: 'user',
      content: `上一次结果未通过检查：${failure}。请根据原始上下文重新生成完整 JSON。version 必须是数字 3，brief 和 detailed 必须位于顶层；三餐及饮食分析的全部字段都要保留。每项说明尽量用一句短句，不要附加解释或 Markdown，不要省略结尾。`
    }];
    let response, data;
    try {
      response = await completeImpl({ ...options, messages, timeoutMs: remainingMs });
      providerMs += response.timing?.providerMs ?? 0;
      if (['length', 'max_tokens', 'MAX_TOKENS'].includes(response.finishReason)) {
        throw new Error('输出达到长度上限，内容可能被截断');
      }
      data = parseNutritionAdvice(response.content, mealTiming);
    } catch (error) {
      // Connection/authentication failures need user action, not another generation.
      if (!response && error.code !== 'AI_EMPTY_CONTENT') throw error;
      failure = error.message;
      if (attempt === 2) throw new HttpError(502, '营养建议连续两次未通过完整性检查，请重试或切换规划建议模型。');
      continue;
    }
    return { ...response, content: JSON.stringify(data), adviceAttempts: attempt,
      timing: { ...response.timing, providerMs, totalMs: Math.round(performance.now() - startedAt) } };
  }
}
