import {motionExercises, motionFamilies, getMotionExercise} from './motion-catalog.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/** A real user click is required before the chat job can submit its assessment.
 * The dialog owns its lifetime so navigation or another editor cannot confirm it. */
export function confirmChatMotionAction(recognition, {signal, videoName='', canShow=()=>true} = {}) {
  signal?.throwIfAborted();
  const suggested = getMotionExercise(recognition?.action?.exerciseId);
  const dialog = document.createElement('dialog');
  dialog.className = 'chat-motion-confirm';
  dialog.setAttribute('aria-labelledby', 'chat-motion-confirm-title');
  dialog.innerHTML = `<form method="dialog"><h2 id="chat-motion-confirm-title">确认视频中的动作</h2><p>${suggested ? `AI 识别为「${escape(suggested.name)}」。如有误，可以修改。` : '请选择这段视频中的动作。'}</p><label for="chat-motion-exercise">动作类型</label><select id="chat-motion-exercise" required><option value="">请选择动作</option>${Object.entries(motionFamilies).map(([family,name]) => `<optgroup label="${escape(name)}">${motionExercises.filter(item => item.family === family).map(item => `<option value="${escape(item.id)}"${item.id === suggested?.id ? ' selected' : ''}>${escape(item.name)}</option>`).join('')}</optgroup>`).join('')}</select><p>确认后，AI 才会评价动作并给出纠正建议。</p><div class="form-footer"><button type="button" class="button" data-chat-motion-cancel>取消</button><button type="submit" class="button primary" data-chat-motion-confirm${suggested ? '' : ' disabled'}>确认并评价</button></div></form>`;
  return new Promise((resolve,reject) => {
    const listeners = new AbortController();
    let settled = false, visibilityTimer;
    if(videoName){const caption=document.createElement('p');caption.textContent=`视频：${videoName}`;dialog.querySelector('h2').after(caption);}
    const finish = (id,error) => {
      if (settled) return;
      settled = true;
      clearTimeout(visibilityTimer);
      listeners.abort(); signal?.removeEventListener('abort', onAbort);
      dialog.close(); dialog.remove();
      if (error) reject(error); else resolve(id);
    };
    const cancel = () => finish(null,new DOMException('已取消动作确认。','AbortError'));
    const onAbort = () => finish(null,signal.reason || new DOMException('已取消动作确认。','AbortError'));
    const select = dialog.querySelector('select'), confirm = dialog.querySelector('[data-chat-motion-confirm]');
    dialog.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      const exercise = getMotionExercise(select.value);
      if (exercise && !signal?.aborted) finish(exercise.id);
    }, {signal:listeners.signal});
    select.addEventListener('change', () => { confirm.disabled = !getMotionExercise(select.value); }, {signal:listeners.signal});
    dialog.querySelector('[data-chat-motion-cancel]').addEventListener('click',cancel,{signal:listeners.signal});
    dialog.addEventListener('cancel',event => {event.preventDefault();cancel();},{signal:listeners.signal});
    dialog.addEventListener('close',cancel,{signal:listeners.signal});
    signal?.addEventListener('abort',onAbort,{once:true});
    const showWhenVisible=()=>{
      if(settled)return;
      if(signal?.aborted){onAbort();return;}
      if(!canShow()){visibilityTimer=setTimeout(showWhenVisible,250);return;}
      document.body.append(dialog);dialog.showModal();select.focus();
    };
    showWhenVisible();
    if (signal?.aborted) onAbort();
  });
}
