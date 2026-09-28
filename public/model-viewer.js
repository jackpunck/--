/** One same-origin detail viewer. Closing its dialog keeps the WebGL scene alive. */
export class ModelViewer {
  constructor({timeoutMs=45000}={}) {
    this.timeoutMs=timeoutMs;
    this.dialog=null;this.frame=null;this.desired=null;this.currentKey=null;this.renderedKey=null;
    this.ready=false;this.state='idle';this.revision=0;this.timer=null;this.opener=null;
    this.receive=event=>this.onMessage(event);
  }
  ensureDialog() {
    if(this.dialog)return;
    const dialog=document.createElement('dialog');
    dialog.id='model-dialog';dialog.className='model-dialog modal-wide';
    dialog.setAttribute('aria-labelledby','model-dialog-title');
    dialog.innerHTML='<div class="modal-head"><h2 id="model-dialog-title"></h2><button type="button" class="icon-button" data-model-close aria-label="关闭3D查看器" autofocus>×</button></div><div class="model-dialog-content"><div class="model-viewer-stage" aria-busy="true"><div id="model-viewer-status" class="model-viewer-status" role="status" aria-live="polite"><span class="model-loading-mark" aria-hidden="true"></span><strong></strong><p></p><button type="button" class="button primary small" data-model-retry hidden>重新加载</button></div></div><div id="model-viewer-details"></div></div>';
    document.body.append(dialog);this.dialog=dialog;
    dialog.querySelector('[data-model-close]').addEventListener('click',()=>this.close());
    dialog.querySelector('[data-model-retry]').addEventListener('click',()=>this.retry());
    dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});
    dialog.addEventListener('close',()=>{
      // A native close event may be delivered after a rapid reopen.
      if(this.dialog!==dialog||dialog.open)return;
      clearTimeout(this.timer);this.post({type:'fitness:visibility',visible:false});
      if(this.opener?.isConnected)this.opener.focus({preventScroll:true});
    });
    window.addEventListener('message',this.receive);
  }
  open(target) {
    const url=new URL(target.url,location.href);
    if(url.origin!==location.origin||url.pathname!=='/model/index.html')throw new Error('3D 查看地址无效。');
    if(!['exercise','muscle','structure'].includes(target.type)||typeof target.id!=='string'||!target.id)throw new Error('3D 查看对象无效。');
    this.ensureDialog();
    const changed=this.desired?.key!==`${target.type}:${target.id}`;
    this.desired={...target,url:url.href,key:`${target.type}:${target.id}`};
    this.revision++;
    this.dialog.dataset.targetKey=this.desired.key;
    this.dialog.querySelector('#model-dialog-title').textContent=target.title;
    this.dialog.querySelector('#model-viewer-details').innerHTML=target.detailsHtml||'';
    if(this.frame)this.frame.title=target.title+' 3D 查看器';
    if(!this.dialog.open){this.opener=document.activeElement;this.dialog.showModal();}
    if(changed)this.dialog.scrollTop=0;
    if(!this.frame){this.loadFrame();return;}
    if(this.state==='error'){this.setState('error',this.error);return;}
    if(!this.ready){this.setState('loading');this.post({type:'fitness:visibility',visible:true,requestId:this.revision});this.startTimer();return;}
    this.selectLatest();
  }
  loadFrame() {
    clearTimeout(this.timer);this.ready=false;this.currentKey=null;this.renderedKey=null;
    this.frame?.remove();
    const frame=document.createElement('iframe');this.frame=frame;
    frame.id='model-detail-frame';frame.className='model-frame';frame.title=this.desired.title+' 3D 查看器';frame.allow='fullscreen';
    frame.addEventListener('error',()=>{if(this.frame===frame)this.fail('3D 页面加载失败，请重新加载。');});
    frame.addEventListener('load',()=>{
      if(this.frame!==frame)return;
      try{if(!frame.contentDocument?.querySelector('#viewport')){this.fail('3D 页面加载失败，请重新加载。');return;}}catch{this.fail('3D 页面无法访问，请重新加载。');return;}
      this.post({type:'fitness:visibility',visible:this.dialog.open,requestId:this.revision});
    });
    this.setState('loading');
    frame.src=this.desired.url;
    this.dialog.querySelector('.model-viewer-stage').prepend(frame);
    this.startTimer();
  }
  post(message) {this.frame?.contentWindow?.postMessage(message,location.origin);}
  selectLatest() {
    if(!this.ready||!this.desired)return;
    this.setState('loading');this.renderedKey=null;
    if(this.currentKey===this.desired.key){
      this.post({type:'fitness:visibility',visible:this.dialog.open,requestId:this.revision});this.startTimer();return;
    }
    this.currentKey=null;
    this.post({type:'fitness:visibility',visible:false});
    this.post({type:'fitness:'+this.desired.type,[this.desired.type]:this.desired.id,requestId:this.revision});
    this.startTimer();
  }
  matchesTarget(data) {
    const target=this.desired;
    return target&&(target.type==='exercise'?data.mode==='motion'&&data.exercise===target.id:
      data.mode==='atlas'&&(target.type==='structure'?data.structure===target.id:data.muscle===target.id&&!data.structure));
  }
  onMessage(event) {
    if(event.origin!==location.origin||event.source!==this.frame?.contentWindow)return;
    const data=event.data;if(!data||typeof data!=='object'||Array.isArray(data))return;
    if(this.state==='error')return;
    if(data.type==='fitness:ready'){
      if(data.webgl!==true){this.fail('当前浏览器无法启动 3D，请重新加载或检查浏览器的图形加速设置。');return;}
      this.ready=true;
      // Ready is emitted after the first real child draw, so a matching cold
      // target can be shown without sending the same selection a second time.
      if(this.matchesTarget(data)){
        this.currentKey=this.desired.key;this.renderedKey=this.desired.key;
        this.post({type:'fitness:visibility',visible:this.dialog.open,requestId:this.revision});this.finishSelection();
      }else{this.currentKey=null;this.renderedKey=null;this.selectLatest();}
      return;
    }
    if(!this.ready||!this.desired)return;
    // A late draw from an earlier A→B→A request must not uncover the canvas.
    if(data.requestId!==this.revision)return;
    if(data.type==='fitness:rendered'){
      this.renderedKey=this.matchesTarget(data)?this.desired.key:null;
      if(this.renderedKey){this.currentKey=this.desired.key;this.finishSelection();}
      else{
        this.currentKey=null;
        // A user pick can reach the child just before its acknowledgement
        // reaches us. Reopening during that gap must select the requested card.
        if(this.state==='loading')this.selectLatest();
      }
      return;
    }
    const target=this.desired;
    const selection=data.type==='fitness:selected'||data.type==='fitness:muscle-selected';
    const matches=data.type===(target.type==='exercise'?'fitness:selected':'fitness:muscle-selected')&&this.matchesTarget(data);
    if(matches){this.currentKey=target.key;this.renderedKey=null;this.post({type:'fitness:visibility',visible:this.dialog.open,requestId:this.revision});}
    // A muscle picked inside an exercise still has that exercise's pose. Only
    // cache a confirmed requested target; a different pick must be reselected
    // when its card is opened so motion and atlas modes cannot be confused.
    else if(selection){this.currentKey=null;this.renderedKey=null;}
  }
  finishSelection() {
    if(this.currentKey!==this.desired?.key||this.renderedKey!==this.desired?.key)return;
    clearTimeout(this.timer);this.setState('ready');
  }
  setState(state,error='') {
    this.state=state;this.error=error;
    if(!this.dialog)return;
    this.dialog.dataset.state=state;
    const status=this.dialog.querySelector('#model-viewer-status');status.dataset.state=state;status.hidden=state==='ready';
    this.dialog.querySelector('.model-viewer-stage').setAttribute('aria-busy',String(state==='loading'));
    status.querySelector('strong').textContent=state==='error'?error:this.ready?'正在切换 3D…':'正在加载 3D 模型…';
    status.querySelector('p').textContent=state==='error'?'文字要领仍可查看。':this.ready?'':'首次加载可能需要几秒，请稍候。';
    status.querySelector('[data-model-retry]').hidden=state!=='error';
  }
  startTimer() {
    clearTimeout(this.timer);if(!this.dialog?.open)return;
    const frame=this.frame;
    this.timer=setTimeout(()=>{if(this.frame===frame&&this.state==='loading')this.fail('3D 加载超时，请重新加载。');},this.timeoutMs);
  }
  fail(message) {clearTimeout(this.timer);this.post({type:'fitness:visibility',visible:false});this.setState('error',message);}
  retry() {if(!this.dialog?.open||!this.desired)return;this.revision++;this.loadFrame();}
  close() {
    if(!this.dialog?.open)return;
    clearTimeout(this.timer);this.post({type:'fitness:visibility',visible:false});this.dialog.close();
    if(this.opener?.isConnected)this.opener.focus({preventScroll:true});
  }
  destroy() {
    clearTimeout(this.timer);this.revision++;
    window.removeEventListener('message',this.receive);
    this.post({type:'fitness:visibility',visible:false});
    this.dialog?.remove();this.dialog=null;this.frame=null;this.desired=null;this.currentKey=null;this.renderedKey=null;
    this.ready=false;this.state='idle';this.opener=null;
  }
}
