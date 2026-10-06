const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed=value=>`${value>0?'+':''}${value}`;
export function nutritionFeedbackView(feedback={},target={},historical=false) {
  const last=feedback.history?.at(-1),enabled=feedback.enabled!==false;
  const states={'waiting-baseline':'等待起点',collecting:'积累记录中',due:'可以校准',active:'已自动校准',stale:'待更新体重',unavailable:'暂不可用'};
  return `<div class="card-head"><div><h3>两周热量校准</h3><small>${historical?'所选日期的目标与校准记录':'记录两周体重变化，自动调整下一周期'}</small></div><span class="badge neutral">${enabled?esc(states[feedback.status]||'等待计算'):'自动校准已关闭'}</span></div>
  <div class="nutrition-feedback-summary"><strong>当前修正 <output data-feedback-offset>${signed(feedback.adjustmentKcal||0)}</output> kcal / 天</strong><span>基础目标 ${esc(target.baseKcal||0)} → 当前目标 ${esc(target.kcal||0)} kcal</span>${historical?'':'<button type="button" class="button small subtle" data-action="profile">记录体重</button>'}</div>
  <p class="muted" role="status">${esc(feedback.message)}</p>
  ${last?.status==='evaluated'?`<p class="nutrition-feedback-comparison">${esc(last.startDate)} — ${esc(last.date)}（${last.days} 天）：实际 ${signed(last.actualChangeKg)} kg · 理论 ${signed(last.theoreticalChangeKg)} kg · 偏差 ${signed(last.errorKg)} kg · 本轮自动修正 ${signed(last.stepKcal)} kcal / 天</p>`:''}
  <details><summary>查看依据${historical?'':'与修改'}</summary><p class="muted">${esc(feedback.basis||'需要有效的个人资料和体重记录。')}</p><p class="muted">每满 14 天并记录体重后计算；相隔超过 21 天重新开始观察。偏差不超过 0.2 kg 时不调整；否则按偏差热量的 25% 逐步修正，每轮最多 100 kcal / 天。累计修正不超过 300 kcal / 天及基础目标的 15%，并保留原有热量下限。</p>
  <p>自动计算 ${signed(feedback.automaticAdjustmentKcal||0)} kcal / 天 · 额外修正 ${signed(feedback.manualAdjustmentKcal||0)} kcal / 天${feedback.limited?' · 已按目标边界限制最终修正':''}</p>
  ${historical?'':`<form id="nutrition-feedback-form" class="nutrition-feedback-form"><label><input type="checkbox" name="enabled" ${enabled?'checked':''}> 应用自动校准</label><label for="nutrition-feedback-manual">额外热量修正（kcal / 天）<input id="nutrition-feedback-manual" name="manualAdjustmentKcal" type="number" min="-300" max="300" step="1" value="${esc(feedback.manualAdjustmentKcal||0)}" required></label><button type="submit" class="button small">保存修改</button><small>正数增加目标，负数减少目标；0 表示无额外修正。修改从今天起生效，关闭自动校准仍保留额外修正。</small></form>`}
  ${feedback.history?.length?`<ul class="nutrition-feedback-history">${[...feedback.history].reverse().map(item=>`<li>${esc(item.date)} · ${item.status==='evaluated'?`自动修正累计 ${signed(item.adjustmentKcal)} kcal / 天${item.limited?'（达到边界）':''}`:esc(item.reason)}</li>`).join('')}</ul>`:''}</details>`;
}
