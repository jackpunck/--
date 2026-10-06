import {MOTION_POSE_MODELS} from './motion-models.js';
import {MOTION_NO_ISSUES_SUMMARY} from './motion-verdict.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

// Keep the full report in the record store, rather than duplicating it in every
// chat receipt. The receipt remains useful if the assistant's final text fails.
export function compactChatMotionResult(result) {
  if (result?.name !== 'assess_motion_video') return result;
  const {record, records, ...receipt} = result;
  return receipt;
}

export function renderChatMotionResult(result) {
  const labels = {standard:'暂时找不出问题', 'needs-improvement':'建议调整', uncertain:'暂时找不出问题'};
  const verdict = result.verdict || {};
  const status = Object.hasOwn(labels, verdict.status) ? verdict.status : 'uncertain';
  const feedback = status === 'needs-improvement' && Array.isArray(result.feedback)
    ? result.feedback.filter(item => item?.status === 'improve' && item.evidence && item.correction).slice(0, 3) : [];
  const hasIssues = result.ok && status === 'needs-improvement' && feedback.length > 0;
  const summary = result.ok ? (hasIssues ? verdict.summary || '发现了具体的动作问题，请按下面的建议调整。' : MOTION_NO_ISSUES_SUMMARY)
    : result.message || verdict.summary || '评估未完成，请重试。';
  const hasReport = result.ok && typeof result.reportId === 'string' && result.reportId.startsWith('motion:');
  const poseModel = MOTION_POSE_MODELS.find(model=>model.id===result.poseModel);
  return `<article class="chat-motion-result ${result.ok ? 'success' : 'failed'}" aria-label="动作评估结果"><header><strong>${escape(result.exerciseName || '动作评估')}</strong><span class="chat-motion-verdict is-${status}">${result.ok ? labels[hasIssues ? status : 'uncertain'] : '评估未完成'}</span></header>${poseModel?`<p class="chat-motion-model">骨架模型：${escape(poseModel.tier)} · ${escape(poseModel.label)}</p>`:''}<p>${escape(summary)}</p>${hasIssues ? `<ul>${feedback.map(item => `<li><strong>${escape(item.title)}</strong>${item.evidence ? `<p>${escape(item.evidence)}</p>` : ''}${item.correction ? `<p class="chat-motion-correction">${escape(item.correction)}</p>` : ''}</li>`).join('')}</ul>` : ''}${hasReport ? `<button type="button" class="button small" data-action="chat-motion-detail" data-report-id="${escape(result.reportId)}">查看详细结果 <span aria-hidden="true">↗</span></button>` : ''}</article>`;
}
