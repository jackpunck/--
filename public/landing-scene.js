import * as THREE from './vendor/three.module.js';

// A single articulated surface is shaded as a luminous triangular network.
// Bone transforms, tunnel travel and particle drift run on the GPU; no bloom passes.
export function createLandingScene(host) {
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});
  const baseRatio=Math.min(devicePixelRatio,innerWidth<700?1.5:1.75);
  renderer.setPixelRatio(baseRatio);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.setClearColor(0x03051d,0);
  renderer.domElement.setAttribute('aria-hidden','true');host.prepend(renderer.domElement);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(42,1,.1,100);
  const geometries=[],materials=[];
  const skeleton=new THREE.Group();scene.add(skeleton);
  const bones=[];
  const bone=(parent,x,y,z)=>{const node=new THREE.Object3D();node.position.set(x,y,z);parent.add(node);bones.push(node);return node;};
  const pelvis=bone(skeleton,0,0,0),chest=bone(pelvis,0,.1,0),neck=bone(chest,0,1.05,.035),head=bone(neck,0,.22,0);
  const limbs=[];
  for(const side of [-1,1]){
    const hip=bone(pelvis,side*.225,-.08,0),knee=bone(hip,0,-.92,0),ankle=bone(knee,0,-.91,0);
    const shoulder=bone(chest,side*.43,.83,0),elbow=bone(shoulder,0,-.65,0),hand=bone(elbow,0,-.59,0);
    limbs.push({side,hip,knee,ankle,shoulder,elbow,hand});
  }
  const vertices=[],indices=[],boneIds=[];
  // Staggered rings produce irregular triangular facets instead of latitude lines.
  const loft=(joint,rows,segments=12)=>{
    const offset=vertices.length/3,id=bones.indexOf(joint);
    rows.forEach(([y,rx,rz,z=0],row)=>{
      for(let col=0;col<segments;col++){
        const angle=col/segments*Math.PI*2+(row%2)*.13;
        const ripple=1+.035*Math.sin(col*13.7+row*4.1);
        vertices.push(Math.cos(angle)*rx*ripple,y,Math.sin(angle)*rz*ripple+z);boneIds.push(id);
        if(row<rows.length-1){const a=offset+row*segments+col,b=offset+row*segments+(col+1)%segments,c=a+segments,d=b+segments;indices.push(a,c,b,b,c,d);}
      }
    });
  };
  loft(pelvis,[[-.22,.17,.15],[-.15,.28,.22],[0,.31,.235],[.2,.265,.19],[.3,.25,.17]],14);
  loft(chest,[[.03,.26,.18],[.22,.26,.18],[.4,.29,.2],[.62,.36,.24],[.82,.41,.235],[.96,.35,.2],[1.06,.19,.135]],16);
  loft(neck,[[0,.13,.125],[.12,.115,.12],[.25,.12,.13]],10);
  loft(head,[[0,.08,.1,.045],[.06,.145,.155,.05],[.16,.2,.19,.025],[.29,.225,.215],[.41,.2,.195,-.015],[.5,.13,.13,-.015],[.54,.015,.02]],14);
  for(const {hip,knee,ankle,shoulder,elbow,hand} of limbs){
    loft(hip,[[.06,.19,.19],[-.15,.205,.205],[-.38,.18,.18],[-.62,.145,.15],[-.85,.115,.125],[-.96,.1,.11]]);
    loft(knee,[[.07,.12,.125],[-.1,.135,.14],[-.3,.145,.15],[-.52,.11,.12],[-.76,.075,.085],[-.94,.07,.08]]);
    loft(ankle,[[.03,.075,.085],[-.06,.1,.16,.07],[-.13,.11,.24,.13],[-.2,.095,.24,.13],[-.23,.02,.16,.14]],10);
    loft(shoulder,[[.07,.15,.155],[-.07,.175,.17],[-.27,.14,.14],[-.47,.11,.115],[-.68,.09,.095]],10);
    loft(elbow,[[.035,.095,.095],[-.14,.115,.11],[-.33,.09,.09],[-.55,.062,.067],[-.63,.065,.07]],10);
    loft(hand,[[.025,.07,.07],[-.075,.088,.07,.025],[-.19,.073,.06,.055],[-.23,.035,.035,.045]],8);
  }
  const indexed=new THREE.BufferGeometry();indexed.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));indexed.setAttribute('aBone',new THREE.Float32BufferAttribute(boneIds,1));indexed.setIndex(indices);indexed.computeVertexNormals();
  const bodyGeometry=indexed.toNonIndexed();indexed.dispose();
  const bary=new Float32Array(bodyGeometry.attributes.position.count*3);
  for(let i=0;i<bary.length;i+=9){bary[i]=1;bary[i+4]=1;bary[i+8]=1;}
  bodyGeometry.setAttribute('aBary',new THREE.BufferAttribute(bary,3));geometries.push(bodyGeometry);
  const boneMatrices=bones.map(()=>new THREE.Matrix4());
  const shared={uBones:{value:boneMatrices},uTime:{value:.4},uTravel:{value:0},uPixelRatio:{value:baseRatio}};
  const skinVertex=`
    attribute float aBone;
    uniform mat4 uBones[${bones.length}];
    uniform float uTime;
    varying vec3 vPosition;
    vec4 skinPosition(){return uBones[int(aBone)]*vec4(position,1.0);}
  `;
  const bodyMaterial=new THREE.ShaderMaterial({uniforms:{...shared,uGlow:{value:0}},transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    vertexShader:skinVertex+`
      uniform float uGlow; attribute vec3 aBary; varying vec3 vBary; varying vec3 vNormal; varying vec3 vEye;
      void main(){vec4 world=skinPosition();world.xyz+=mat3(uBones[int(aBone)])*normal*uGlow*.016;vPosition=world.xyz;vBary=aBary;vNormal=normalize(mat3(uBones[int(aBone)])*normal);vEye=cameraPosition-world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}
    `,
    fragmentShader:`
      varying vec3 vBary; varying vec3 vNormal; varying vec3 vEye; varying vec3 vPosition; uniform float uTime; uniform float uGlow;
      void main(){
        vec3 width=fwidth(vBary);vec3 grid=smoothstep(vec3(0.0),width*(1.0+uGlow*3.0),vBary);
        float edge=1.0-min(min(grid.x,grid.y),grid.z);
        float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(vEye))),2.2);
        float pulse=.5+.5*sin(vPosition.y*3.2+vPosition.z*4.0-uTime*2.0);
        vec3 color=mix(vec3(.045,.65,1.0),vec3(.8,.13,.9),pulse*.7);
        color=mix(color,vec3(.5,1.0,1.0),rim*.7);
        float alpha=(.065+edge*.55+rim*.23)*mix(1.0,.18,uGlow);
        gl_FragColor=vec4(color*(.8+edge*.7+rim*.5),alpha);
      }
    `});materials.push(bodyMaterial);
  const body=new THREE.Mesh(bodyGeometry,bodyMaterial);body.frustumCulled=false;scene.add(body);
  const haloMaterial=bodyMaterial.clone();haloMaterial.uniforms={...shared,uGlow:{value:1}};materials.push(haloMaterial);
  const halo=new THREE.Mesh(bodyGeometry,haloMaterial);halo.frustumCulled=false;scene.add(halo);
  const particleGeometry=new THREE.BufferGeometry();particleGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));particleGeometry.setAttribute('aBone',new THREE.Float32BufferAttribute(boneIds,1));geometries.push(particleGeometry);
  const pointMaterial=(ghost)=>{
    const material=new THREE.ShaderMaterial({uniforms:{...shared,uGhost:{value:ghost}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:skinVertex+`
        uniform float uGhost; uniform float uPixelRatio; varying float vAlpha;
        void main(){vec4 world=skinPosition();float seed=fract(sin(position.x*127.1+position.y*311.7+aBone*7.3)*43758.5);
          world.z-=uGhost*(.55+seed*2.2);world.x+=uGhost*sin(seed*33.0+uTime)*.25;
          world.y+=uGhost*sin(seed*41.0+uTime)*.17;vPosition=world.xyz;
          vec4 mv=viewMatrix*world;gl_Position=projectionMatrix*mv;
          gl_PointSize=clamp((uGhost>.5?18.0:12.0)*uPixelRatio/-mv.z,1.0,5.0);
          vAlpha=(uGhost>.5?.45:.7)*(.5+.5*sin(seed*13.0+uTime*2.0));}
      `,
      fragmentShader:`varying float vAlpha;uniform float uGhost;void main(){float d=length(gl_PointCoord-.5)*2.0;if(d>1.0)discard;vec3 c=mix(vec3(.4,.9,1.0),vec3(.8,.3,1.0),uGhost*.65);gl_FragColor=vec4(c,pow(1.0-d,1.5)*vAlpha);}`});materials.push(material);return material;
  };
  for(const ghost of [0,1]){const points=new THREE.Points(particleGeometry,pointMaterial(ghost));points.frustumCulled=false;scene.add(points);}
  // One draw call for the whole tunnel. Travel is +Z; the environment retreats -Z.
  const streakVertices=[],streakColors=[],streakSeeds=[],streakSides=[];
  for(let i=0;i<160;i++){
    const angle=i*2.39996,radius=3+(i%17)*.35,x=Math.cos(angle)*radius,y=Math.sin(angle)*radius*.68+.7;
    const color=new THREE.Color(i%4===0?0xff4dd2:i%3===0?0x8c72ff:0x55bdff);
    for(const [end,side] of [[0,-1],[0,1],[1,1],[0,-1],[1,1],[1,-1]]){
      streakVertices.push(x,y,end*(1.2+(i%7)*.5));streakColors.push(color.r,color.g,color.b);streakSeeds.push(i/160);streakSides.push(side);
    }
  }
  const streakGeometry=new THREE.BufferGeometry();streakGeometry.setAttribute('position',new THREE.Float32BufferAttribute(streakVertices,3));streakGeometry.setAttribute('color',new THREE.Float32BufferAttribute(streakColors,3));streakGeometry.setAttribute('aSeed',new THREE.Float32BufferAttribute(streakSeeds,1));streakGeometry.setAttribute('aSide',new THREE.Float32BufferAttribute(streakSides,1));geometries.push(streakGeometry);
  const resolution=new THREE.Vector2(1,1);
  const streakMaterial=new THREE.ShaderMaterial({uniforms:{...shared,uResolution:{value:resolution}},vertexColors:true,side:THREE.DoubleSide,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`attribute float aSeed;attribute float aSide;uniform float uTime;uniform float uTravel;uniform vec2 uResolution;varying vec3 vColor;varying float vAlpha;varying float vAcross;
      void main(){vec3 p=position;p.z+=8.0-mod(aSeed*65.0+uTime*12.0,65.0);vColor=color;vAlpha=smoothstep(-57.0,-18.0,p.z)*.8;vAcross=aSide;p.z+=uTravel;
        vec4 clip=projectionMatrix*modelViewMatrix*vec4(p,1.0);vec4 next=projectionMatrix*modelViewMatrix*vec4(p+vec3(0.,0.,.1),1.);
        vec2 direction=normalize((next.xy/next.w-clip.xy/clip.w)*uResolution);vec2 perpendicular=vec2(-direction.y,direction.x);
        clip.xy+=perpendicular*aSide*(3.0+pow(fract(aSeed*13.0),4.0)*18.0)/uResolution*clip.w;gl_Position=clip;}`,
    fragmentShader:`varying vec3 vColor;varying float vAlpha;varying float vAcross;void main(){float core=exp(-abs(vAcross)*5.0),halo=exp(-vAcross*vAcross*4.0);gl_FragColor=vec4(vColor*1.5,vAlpha*(core+halo*.3));}`});materials.push(streakMaterial);
  const streaks=new THREE.Mesh(streakGeometry,streakMaterial);streaks.frustumCulled=false;scene.add(streaks);
  const floorGeometry=new THREE.PlaneGeometry(55,90);geometries.push(floorGeometry);
  const floorMaterial=new THREE.ShaderMaterial({uniforms:shared,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying vec2 vUv;uniform float uTime;void main(){vec2 p=(vUv-.5)*vec2(55.0,90.0);float lane=exp(-pow((abs(p.x)-.8)*18.0,2.0));float crossLine=pow(max(0.0,cos((p.y+uTime*12.0)*1.7)),48.0)*exp(-abs(p.x)*.45);float pool=exp(-p.x*p.x*1.4-p.y*p.y*.025);float fade=exp(-abs(p.y)*.055);vec3 c=mix(vec3(.06,.18,.65),vec3(.12,.65,1.0),pool);gl_FragColor=vec4(c,(lane*.3+crossLine*.13+pool*.19)*fade);}`});materials.push(floorMaterial);
  const floor=new THREE.Mesh(floorGeometry,floorMaterial);floor.rotation.x=-Math.PI/2;floor.position.set(0,-2.09,-18);scene.add(floor);
  // Soft contact light, rendered as a small plane rather than a full-screen blur.
  const glowGeometry=new THREE.PlaneGeometry(2.8,3.2);geometries.push(glowGeometry);
  const glowMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying vec2 vUv;void main(){float a=exp(-length((vUv-.5)*vec2(5.0,4.0))*3.0);gl_FragColor=vec4(.2,.7,1.0,a*.8);}`});materials.push(glowMaterial);
  const glow=new THREE.Mesh(glowGeometry,glowMaterial);glow.rotation.x=-Math.PI/2;glow.position.y=-2.07;scene.add(glow);

  let raf=0,enabled=true,visible=true,disposed=false,contextLost=false,elapsed=.4,lastTime=0,speed=1,targetSpeed=1,scroll=0;
  let frameAverage=16.7,qualityFrames=0,ratio=baseRatio,cameraDistance=6.9;
  const pointer=new THREE.Vector2(),smoothPointer=new THREE.Vector2();
  const controller=new AbortController(),{signal}=controller;
  const render=(now=0)=>{
    raf=0;if(disposed||contextLost)return;
    const rawDt=lastTime?(now-lastTime)/1000:0,dt=Math.min(rawDt,.1);lastTime=now;
    speed=THREE.MathUtils.lerp(speed,targetSpeed,1-Math.exp(-dt*5));
    if(enabled)elapsed+=dt*speed;
    shared.uTime.value=elapsed;
    const travel=elapsed*3.6;shared.uTravel.value=travel;
    camera.position.set(cameraDistance*.37,.9,travel+cameraDistance);camera.lookAt(0,.05,travel-.25);
    floor.position.z=travel-18;glow.position.z=travel;
    smoothPointer.lerp(pointer,enabled?1-Math.exp(-dt*7):1);
    // The camera tracks forward travel; feet drive forward while trails fall behind.
    const gait=elapsed*8.6;
    skeleton.position.set(Math.sin(gait)*.025,.06+Math.cos(gait*2)*.065,travel+.13*Math.sin(elapsed*.7));
    skeleton.rotation.y=-.12+smoothPointer.x*.24+scroll*.15;
    pelvis.rotation.set(.1,Math.sin(gait)*.08,Math.sin(gait)*.035);
    chest.rotation.set(.07,-Math.sin(gait)*.13,Math.sin(gait)*.03);
    head.rotation.x=-.09+Math.sin(gait*2)*.025;
    for(const limb of limbs){const phase=gait+(limb.side===1?0:Math.PI);
      limb.hip.rotation.x=-Math.sin(phase)*.87-.08;
      limb.knee.rotation.x=.22+Math.max(0,Math.cos(phase))*1.6;
      limb.ankle.rotation.x=-.15-limb.knee.rotation.x*.12;
      limb.shoulder.rotation.set(Math.sin(phase)*.73+.08,0,limb.side*.08);
      limb.elbow.rotation.x=-1.35-Math.cos(phase)*.2;
    }
    skeleton.updateMatrixWorld(true);bones.forEach((joint,i)=>boneMatrices[i].copy(joint.matrixWorld));
    glow.scale.setScalar(1+Math.cos(gait*2)*.1);
    renderer.render(scene,camera);host.dataset.sceneReady='true';
    // Sustained slow frames lower fill cost without dropping animation frames.
    if(enabled&&rawDt>0&&rawDt<.2){frameAverage=frameAverage*.96+rawDt*1000*.04;if(++qualityFrames>180){
      const next=frameAverage>22?Math.max(.85,ratio-.2):frameAverage<15?Math.min(baseRatio,ratio+.1):ratio;
      if(Math.abs(next-ratio)>.01){ratio=next;renderer.setPixelRatio(ratio);shared.uPixelRatio.value=ratio;}qualityFrames=0;
    }}
    if(enabled&&visible&&!document.hidden)raf=requestAnimationFrame(render);
  };
  const requestRender=()=>{if(!disposed&&!contextLost&&!raf)raf=requestAnimationFrame(render);};
  const resize=()=>{const {width,height}=host.getBoundingClientRect();if(!width||!height)return;
    renderer.setSize(width,height,false);camera.aspect=width/height;resolution.set(width,height);
    cameraDistance=camera.aspect<1?8.1:6.9;camera.updateProjectionMatrix();requestRender();
  };
  const observer=new ResizeObserver(resize);observer.observe(host);
  const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;lastTime=0;if(!visible){cancelAnimationFrame(raf);raf=0;}else requestRender();});intersection.observe(host);
  host.addEventListener('pointermove',event=>{if(!enabled||event.pointerType!=='mouse')return;const r=host.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width-.5,(event.clientY-r.top)/r.height-.5);},{passive:true,signal});
  host.addEventListener('pointerleave',()=>pointer.set(0,0),{signal});
  host.addEventListener('click',()=>{targetSpeed=targetSpeed===1?1.65:1;host.setAttribute('aria-pressed',String(targetSpeed>1));host.querySelector('.scene-instruction').firstChild.textContent=targetSpeed>1?'正在加速 · 点击慢跑 ':'向前奔跑 · 点击加速 ';requestRender();},{signal});
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;cancelAnimationFrame(raf);raf=0;host.dataset.sceneReady='false';},{signal});
  renderer.domElement.addEventListener('webglcontextrestored',()=>{contextLost=false;lastTime=0;requestRender();},{signal});
  document.addEventListener('visibilitychange',()=>{lastTime=0;if(document.hidden){cancelAnimationFrame(raf);raf=0;}else if(visible)requestRender();},{signal});
  resize();
  return {
    setMotion(value){enabled=value;pointer.set(0,0);lastTime=0;cancelAnimationFrame(raf);raf=0;requestRender();},
    setScroll(value){if(scroll===value)return;scroll=value;if(visible)requestRender();},
    dispose(){disposed=true;controller.abort();observer.disconnect();intersection.disconnect();cancelAnimationFrame(raf);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}
  };
}
