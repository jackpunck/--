const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14" stroke="currentColor" stroke-width="1.5"/></svg>';
const crosses = '<span>＋</span><span>＋</span><span>＋</span><span>＋</span>';

export function landingMarkup(auth, icon) {
  return `<div class="landing" id="landing-top">
    <a class="landing-skip" href="#auth-entry">跳到登录与注册</a>
    <header class="landing-nav">
      <a class="landing-brand" href="#landing-top" aria-label="循序首页">循序<span>XUNXU</span></a>
      <div class="landing-nav-actions"><button type="button" class="landing-motion" aria-pressed="false" aria-label="暂停动态效果" title="暂停动态效果">Ⅱ</button><button type="button" class="landing-login" data-action="auth-jump" data-mode="login">进入循序 <i></i></button><button type="button" class="landing-menu-toggle" aria-haspopup="dialog" aria-controls="landing-menu">菜单 <span>••</span></button></div>
      <span class="landing-scroll-progress" aria-hidden="true"></span>
    </header>
    <dialog class="landing-menu" id="landing-menu" aria-labelledby="landing-menu-title"><div class="landing-menu-top"><span id="landing-menu-title">探索循序</span><button type="button" class="landing-menu-close" aria-label="关闭菜单">关闭 ×</button></div><nav aria-label="页面导航"><a href="#landing-top">首页 <span>HOME</span></a><a href="#landing-story">关于循序 <span>OUR APPROACH</span></a><a href="#landing-features">探索功能 <span>EXPERIENCES</span></a><a href="#auth-entry">开始使用 <span>LET’S BEGIN</span></a></nav><p>训练 · 饮食 · AI 陪伴<br>MAKE EVERY MOVE COUNT.</p></dialog>
    <main>
      <section class="landing-hero" aria-labelledby="landing-heading">
        <div class="landing-hero-copy"><h1 id="landing-heading">把训练、饮食与 AI 连接，<br>让每一份努力，<br>成为看得见的改变。</h1></div>
        <button type="button" class="landing-scene" aria-label="互动三维场景，点击切换聚合与展开" aria-pressed="false"><div class="scene-fallback" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="scene-caption"><span>MOVE. EAT. EVOLVE.</span><span class="scene-instruction">移动探索 · 点击展开 ${arrow}</span></div></button>
        <div class="landing-cross-line"><span aria-hidden="true">＋</span><span aria-hidden="true">＋</span><a href="#landing-story">向下探索 <span>SCROLL TO EXPLORE</span></a><span aria-hidden="true">＋</span><span aria-hidden="true">＋</span></div>
      </section>
      <section class="landing-intro" id="landing-story" aria-labelledby="landing-intro-title">
        <h2 class="landing-display landing-reveal" id="landing-intro-title"><span>每一步，</span><span>都让改变发生。</span></h2>
        <div class="landing-intro-bottom"><p class="landing-side-label">你的生活，你的节奏。<br>YOUR OWN PACE.</p><div><p class="landing-story-text">${['从今天认真练的一组，','到好好吃下的每一餐。','循序把训练计划、营养记录、','动作知识与 AI 陪伴连接起来，','让进步有方向，','也让坚持更轻松。'].map(s=>`<span>${s}</span>`).join('')}</p><a class="landing-round-link" href="#landing-features">探索我们的方式 <i>${arrow}</i></a></div></div>
      </section>
      <section class="landing-reel landing-reveal" aria-label="循序项目概览"><div class="reel-grid" aria-hidden="true"></div><div class="reel-orbits" aria-hidden="true"><i></i><i></i><i></i></div><span class="reel-small">A LITTLE BETTER. EVERY DAY.</span><h2>MAKE YOUR<br><em>MOVE.</em></h2><a href="#landing-features" class="reel-play" aria-label="探索循序功能">${arrow}</a><span class="reel-bottom">身体的每一次改变，都从一个开始出发。</span></section>
      <div class="landing-crosses" aria-hidden="true">${crosses}</div>
      <section class="landing-features" id="landing-features" aria-labelledby="landing-features-title">
        <header class="landing-section-heading"><h2 id="landing-features-title" class="landing-reveal">为你的<br>每一天。</h2><p>从计划到行动，从记录到理解。<br>四种方式，让成长发生在日常。</p></header>
        <div class="landing-project-grid">
          <article class="landing-project" id="landing-training">
            <div class="project-visual project-training landing-reveal"><span class="project-overline">YOUR DAILY MOMENTUM</span><div class="training-orb" aria-hidden="true"></div><div class="landing-workout-demo"><div class="demo-head"><span>循序 / TODAY</span>${icon('dumbbell')}</div><h3>全身唤醒计划</h3><div class="demo-week">${['M','T','W','T','F','S','S'].map((d,i)=>`<span class="${i===3?'selected':''}"><small>${d}</small>${12+i}</span>`).join('')}</div><div class="landing-demo-tasks">${[['深蹲','3 组 × 12 次'],['俯卧撑','3 组 × 10 次'],['平板支撑','3 组 × 30 秒']].map(([name,sets])=>`<button class="landing-demo-task" type="button" aria-pressed="false"><i>${icon('check')}</i><span>${name}<small>${sets}</small></span><span>↗</span></button>`).join('')}</div><div class="landing-demo-progress"><span aria-live="polite">完成 0 / 3 个动作</span><div><i></i></div></div></div><span class="project-note">交互示例 · 点击勾选动作</span></div>
            <div class="project-meta"><p>训练日程 · 动作记录 · 阶段回顾</p><button type="button" data-action="auth-jump" data-mode="register"><h3 id="landing-training-title">把计划，练成日常。</h3>${arrow}</button></div>
          </article>
          <article class="landing-project" id="landing-nutrition">
            <div class="project-visual project-nutrition landing-reveal"><span class="project-overline">FIND YOUR BALANCE</span><div class="nutrition-type" aria-hidden="true">EAT<br>WELL.</div><div class="nutrition-plate" aria-hidden="true"><div class="salad-leaf leaf-a"></div><div class="salad-leaf leaf-b"></div><div class="salad-leaf leaf-c"></div><div class="salad-leaf leaf-d"></div><div class="tomato tomato-a"></div><div class="tomato tomato-b"></div><div class="food-egg"></div><div class="food-avocado"></div></div><div class="nutrition-facts"><div><span data-meal-name>均衡午餐</span><strong data-meal-calories>620 <small>kcal</small></strong></div><p data-meal-macros>蛋白质 35 g · 碳水 75 g · 脂肪 20 g</p><button class="demo-cycle" type="button" data-demo="meal">换一餐看看 ${arrow}</button></div><span class="project-note">营养示例 · 实际记录可核对修改</span></div>
            <div class="project-meta"><p>照片记餐 · 营养目标 · 食物替换</p><button type="button" data-action="auth-jump" data-mode="register"><h3 id="landing-nutrition-title">好好吃，心中有数。</h3>${arrow}</button></div>
          </article>
          <article class="landing-project" id="landing-companion">
            <div class="project-visual project-chat landing-reveal"><span class="project-overline">A MIND ON YOUR SIDE</span><div class="chat-orb" aria-hidden="true">✳</div><div class="demo-conversation" aria-live="polite"><p class="demo-question">这周只有三天时间，可以怎么练？</p><div class="demo-answer"><span>循序 AI</span><h3>从你的时间出发。</h3><p>结合目标、可用器械与训练记录，<br>一起安排适合你的训练日程。</p><div class="demo-chat-dots" aria-hidden="true"><i></i><i></i><i></i></div></div></div><button type="button" class="demo-cycle" data-demo="chat">换个问题 ${arrow}</button><span class="project-note">对话示例 · 连接自己的 AI 服务后使用</span></div>
            <div class="project-meta"><p>对话规划 · 训练建议 · 成长陪伴</p><button type="button" data-action="auth-jump" data-mode="register"><h3 id="landing-companion-title">一起想，下一步。</h3>${arrow}</button></div>
          </article>
          <article class="landing-project" id="landing-knowledge">
            <div class="project-visual project-knowledge landing-reveal"><span class="project-overline">UNDERSTAND EVERY MOVE</span><div class="knowledge-grid" aria-hidden="true"></div><div class="knowledge-cover"><img src="/assets/exercises/squat.jpg" alt="深蹲动作预览" loading="lazy" width="400" height="400"><span data-exercise-name>深蹲 / SQUAT</span></div><div class="knowledge-label label-top">动作 · 发力 · 理解</div><button type="button" class="demo-cycle" data-demo="exercise">下一个动作 ${arrow}</button><span class="project-note">进入知识库，查看 3D 肌群与动作演示</span></div>
            <div class="project-meta"><p>3D 动作 · 肌群定位 · 训练知识</p><button type="button" data-action="auth-jump" data-mode="register"><h3>看懂每一次发力。</h3>${arrow}</button></div>
          </article>
        </div>
      </section>
      <section class="landing-journey" aria-labelledby="journey-title"><div class="journey-orbit" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><p>STEP INTO YOUR NEXT CHAPTER</p><h2 id="journey-title" class="landing-reveal">让今天，<br>成为新的起点。</h2><button type="button" class="landing-pill" data-action="auth-jump" data-mode="register">开启我的循序 <i>${arrow}</i></button></section>
      <section class="landing-start" id="start"><div class="landing-start-copy"><p>READY TO MAKE YOUR MOVE?</p><h2>下一步，<br>一起开始。<span>↗</span></h2><p>记录你的训练、饮食与每一次进步。</p></div><div class="landing-auth-panel" id="auth-entry" data-auth-panel>${auth}</div></section>
    </main><footer class="landing-footer"><a class="landing-brand" href="#landing-top">循序<span>XUNXU</span></a><p>每一步，都算数。<br>MAKE EVERY MOVE COUNT.</p><a href="#landing-top">回到顶部 ${arrow}</a><div>© ${new Date().getFullYear()} 循序 · AI 健身助手</div></footer>
  </div>`;
}

export function mountLanding(root) {
  const controller=new AbortController();const {signal}=controller;
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const motionButton=root.querySelector('.landing-motion');
  const menu=root.querySelector('.landing-menu');
  const sceneHost=root.querySelector('.landing-scene');
  const {gsap,ScrollTrigger}=window;
  let paused=false,frame=0,scene=null,motionContext=null,mealIndex=0,questionIndex=0,exerciseIndex=0;
  const isReduced=()=>paused||media.matches;
  const paint=()=>{frame=0;const max=document.documentElement.scrollHeight-innerHeight;root.style.setProperty('--landing-progress',String(max>0?Math.min(1,scrollY/max):0));root.classList.toggle('is-scrolled',scrollY>50);scene?.setScroll(isReduced()?0:Math.min(1,scrollY/innerHeight));};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(paint);};
  const updateMotion=()=>{
    motionContext?.revert();motionContext=null;
    root.querySelectorAll('.landing-story-text span').forEach(el=>el.style.removeProperty('opacity'));
    root.classList.toggle('motion-paused',isReduced());
    motionButton.setAttribute('aria-pressed',String(isReduced()));motionButton.setAttribute('aria-label',media.matches?'已跟随系统减少动态效果':paused?'开启动态效果':'暂停动态效果');
    motionButton.title=motionButton.getAttribute('aria-label');motionButton.textContent=isReduced()?'▷':'Ⅱ';motionButton.disabled=media.matches;scene?.setMotion(!isReduced());
    if(!isReduced()&&gsap&&ScrollTrigger){
      gsap.registerPlugin(ScrollTrigger);motionContext=gsap.matchMedia();
      motionContext.add('(min-width: 0px)',()=>{
        gsap.fromTo('.landing-story-text span',{opacity:.22},{opacity:1,stagger:.12,ease:'none',scrollTrigger:{trigger:root.querySelector('.landing-story-text'),start:'top 85%',end:'bottom 60%',scrub:true}});
        for(const visual of root.querySelectorAll('.project-visual'))gsap.fromTo(visual,{scale:.94},{scale:1,ease:'none',scrollTrigger:{trigger:visual,start:'top bottom',end:'top 38%',scrub:true}});
        gsap.fromTo('.journey-orbit',{scale:.75,rotation:-20},{scale:1.2,rotation:35,ease:'none',scrollTrigger:{trigger:root.querySelector('.landing-journey'),start:'top bottom',end:'bottom top',scrub:true}});
      },root);
    }schedule();
  };
  import('./landing-scene.js?v=1').then(({createLandingScene})=>{if(signal.aborted)return;try{scene=createLandingScene(sceneHost);scene.setMotion(!isReduced());paint();}catch{sceneHost.dataset.sceneReady='false';sceneHost.querySelector('canvas')?.remove();}}).catch(()=>{sceneHost.dataset.sceneReady='false';});
  motionButton.addEventListener('click',()=>{paused=!paused;updateMotion();},{signal});media.addEventListener('change',updateMotion,{signal});
  window.addEventListener('scroll',schedule,{passive:true,signal});window.addEventListener('resize',schedule,{passive:true,signal});
  const resize=new ResizeObserver(schedule);resize.observe(root);
  root.querySelector('.landing-menu-toggle').addEventListener('click',()=>menu.showModal(),{signal});root.querySelector('.landing-menu-close').addEventListener('click',()=>menu.close(),{signal});
  menu.addEventListener('click',event=>{if(event.target===menu){const r=menu.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)menu.close();}},{signal});
  root.addEventListener('click',event=>{
    const anchor=event.target.closest('a[href^="#"]');if(anchor){const target=root.querySelector(anchor.getAttribute('href'));if(target){event.preventDefault();if(menu.open)menu.close();target.scrollIntoView({behavior:isReduced()?'instant':'smooth'});const focusTarget=target.querySelector('h1,h2,h3')||target;focusTarget.setAttribute('tabindex','-1');focusTarget.focus({preventScroll:true});}}
    if(event.target.closest('[data-action=auth-jump]')&&menu.open)menu.close();
    const task=event.target.closest('.landing-demo-task');if(task){task.setAttribute('aria-pressed',String(task.getAttribute('aria-pressed')!=='true'));const count=root.querySelectorAll('.landing-demo-task[aria-pressed=true]').length;root.querySelector('.landing-demo-progress>span').textContent=count===3?'今天的练习，完成！':`完成 ${count} / 3 个动作`;root.querySelector('.landing-demo-progress i').style.width=`${count/3*100}%`;}
    const demo=event.target.closest('[data-demo]')?.dataset.demo;
    if(demo==='meal'){
      const meals=[['均衡午餐',620,'蛋白质 35 g · 碳水 75 g · 脂肪 20 g'],['轻盈早餐',380,'蛋白质 22 g · 碳水 46 g · 脂肪 12 g'],['训练后的一餐',540,'蛋白质 42 g · 碳水 66 g · 脂肪 12 g']];const [name,calories,macros]=meals[++mealIndex%meals.length];root.querySelector('[data-meal-name]').textContent=name;root.querySelector('[data-meal-calories]').innerHTML=`${calories} <small>kcal</small>`;root.querySelector('[data-meal-macros]').textContent=macros;root.querySelector('.nutrition-plate').style.rotate=`${mealIndex*30-12}deg`;
    }
    if(demo==='chat'){
      const questions=[['这周只有三天时间，可以怎么练？','从你的时间出发。','结合目标、可用器械与训练记录，一起安排适合你的训练日程。'],['今天想练腿，从哪里开始？','先找到适合你的强度。','说说你的训练经验、可用器械与身体状态，我们一起规划。'],['晚餐想吃得均衡一点。','从你喜欢的食物开始。','聊聊今天吃了什么，一起找更适合你的搭配与份量。']];const [q,h,p]=questions[++questionIndex%questions.length];root.querySelector('.demo-question').textContent=q;root.querySelector('.demo-answer h3').textContent=h;root.querySelector('.demo-answer p').textContent=p;
    }
    if(demo==='exercise'){
      const exercises=[['squat','深蹲 / SQUAT'],['pushup','俯卧撑 / PUSH UP'],['plank','平板支撑 / PLANK']];const [id,name]=exercises[++exerciseIndex%exercises.length];const img=root.querySelector('.knowledge-cover img');img.src=`/assets/exercises/${id}.jpg`;img.alt=name+'动作预览';root.querySelector('[data-exercise-name]').textContent=name;
    }
  },{signal});
  const reveal=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('is-visible');reveal.unobserve(entry.target);}},{threshold:.08});root.querySelectorAll('.landing-reveal').forEach(el=>reveal.observe(el));
  root.classList.add('motion-ready');updateMotion();paint();document.fonts.ready.then(()=>{if(!signal.aborted)ScrollTrigger?.refresh();});
  return ()=>{controller.abort();if(menu.open)menu.close();scene?.dispose();motionContext?.revert();resize.disconnect();reveal.disconnect();if(frame)cancelAnimationFrame(frame);};
}
