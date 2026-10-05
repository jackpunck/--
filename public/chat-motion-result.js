const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

// Keep the full report in the record store, rather than duplicating it in every
// chat receipt. The receipt remains useful if the assistant's final text fails.
export function compactChatMotionResult(result) {
  if (result?.name !== 'assess_motion_video') return result;
  const {record, records, ...receipt} = result;
  return receipt;
}

export function renderChatMotionResult(result) {
  const labels = {standard:'动作较标准', 'needs-improvement':'建议调整', uncertain:'暂时无法确认'};
  const verdict = result.verdict || {};
  const status = Object.hasOwn(labels, verdict.status) ? verdict.status : 'uncertain';
  const feedback = Array.isArray(result.feedback) ? result.feedback.slice(0, 3) : [];
  const hasReport = result.ok && typeof result.reportId === 'string' && result.reportId.startsWith('motion:');
  return `<article class="chat-motion-result ${result.ok ? 'success' : 'failed'}" aria-label="动作评估结果"><header><strong>${escape(result.exerciseName || '动作评估')}</strong><span class="chat-motion-verdict is-${status}">${result.ok ? labels[status] : '评估未完成'}</span></header><p>${escape(verdict.summary || result.message || '动作评估已结束。')}</p>${result.ok && feedback.length ? `<ul>${feedback.map(item => `<li><strong>${escape(item.title)}</strong>${item.evidence ? `<p>${escape(item.evidence)}</p>` : ''}${item.correction ? `<p class="chat-motion-correction">${escape(item.correction)}</p>` : ''}</li>`).join('')}</ul>` : ''}${hasReport ? `<button type="button" class="button small" data-action="chat-motion-detail" data-report-id="${escape(result.reportId)}">查看详细结果 <span aria-hidden="true">↗</span></button>` : ''}</article>`;
}
