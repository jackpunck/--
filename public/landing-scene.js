import * as THREE from './vendor/three.module.js';

// Locally built hollow forms. No remote models, textures, or animation requests.
export function createLandingScene(host) {
  const renderer = new THREE.WebGLRenderer({alpha:true, antialias:true, powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 700 ? 1.2 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.domElement.setAttribute('aria-hidden','true');
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(37,1,.1,60);
  camera.position.set(0,0,13);
  const group = new THREE.Group(); group.scale.setScalar(1.15); scene.add(group);
  const studio = document.createElement('canvas'); studio.width=1024; studio.height=512;
  const ctx=studio.getContext('2d');
  ctx.fillStyle='#20222a';ctx.fillRect(0,0,1024,512);
  const wash=ctx.createLinearGradient(0,0,0,512);
  wash.addColorStop(0,'#b1b5c9');wash.addColorStop(.4,'#353641');wash.addColorStop(1,'#07080c');
  ctx.fillStyle=wash;ctx.fillRect(0,0,1024,512);
  ctx.fillStyle='#ffffff';ctx.fillRect(110,90,65,310);ctx.fillRect(460,50,290,60);
  ctx.fillStyle='#969fff';ctx.fillRect(880,140,36,235);
  const env=new THREE.CanvasTexture(studio);env.mapping=THREE.EquirectangularReflectionMapping;env.colorSpace=THREE.SRGBColorSpace;
  const pmrem=new THREE.PMREMGenerator(renderer);const envTarget=pmrem.fromEquirectangular(env);
  scene.environment=envTarget.texture;pmrem.dispose();env.dispose();
  const key=new THREE.DirectionalLight(0xffffff,3.3);key.position.set(-4,6,6);scene.add(key);
  const rim=new THREE.DirectionalLight(0x8b9dff,1.4);rim.position.set(6,-1,-2);scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xc8d2ff,0x17171f,1.1));
  const materials=[
    new THREE.MeshPhysicalMaterial({color:0x1033f4,metalness:.08,roughness:.22,clearcoat:1,clearcoatRoughness:.1}),
    new THREE.MeshPhysicalMaterial({color:0xe7e8ee,metalness:.02,roughness:.36,clearcoat:.45}),
    new THREE.MeshPhysicalMaterial({color:0x15151c,metalness:.45,roughness:.22,clearcoat:1})
  ];
  const profile=[[.17,.32],[.17,1.04],[.18,1.09],[.22,1.12],[.35,1.12],[.40,1.09],[.42,1.04],[.42,.46],[.40,.32]].reverse().map(([x,y])=>new THREE.Vector2(x,y));
  const tubeGeometry=new THREE.LatheGeometry(profile,32);
  const centerGeometry=new THREE.SphereGeometry(.54,24,16);
  const directions=[new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0),new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1)];
  const positions=[[-3,1,-.6],[-1.5,1.7,-1.2],[.1,1.3,-1.7],[1.8,1.6,-1.2],[3.3,.7,-1.3],[-3.3,-.9,-1],[-1.7,-.2,-.4],[0,.1,.9],[1.9,.1,.1],[3,-1,-.2],[-2,-1.8,.2],[-.2,-1.6,-.7],[1.5,-1.8,.8],[-1.2,2.5,-2],[1,2.9,-2.3],[-.4,-3,-2]];
  const forms=positions.map((position,i)=>{
    const form=new THREE.Group();const material=materials[i===7?0:i%3];
    form.add(new THREE.Mesh(centerGeometry,material));
    directions.forEach(direction=>{
      const tube=new THREE.Mesh(tubeGeometry,material);
      tube.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);form.add(tube);
    });
    form.position.set(...position);form.rotation.set(i*.71,i*1.13,i*.42);
    form.scale.setScalar(i===7?1.1:.82+(i%4)*.065);
    group.add(form);return {form,base:new THREE.Vector3(...position),rotation:form.rotation.clone()};
  });
  let raf=0,enabled=true,visible=true,disposed=false,elapsed=0,lastTime=0,spread=0,targetSpread=0,scroll=0;
  const pointer=new THREE.Vector2(),smoothPointer=new THREE.Vector2();
  const controller=new AbortController();const {signal}=controller;
  const render=(now=0)=>{
    raf=0;if(disposed)return;
    const dt=lastTime?Math.min((now-lastTime)/1000,.04):0;lastTime=now;
    if(enabled)elapsed+=dt;
    spread=enabled?THREE.MathUtils.lerp(spread,targetSpread,.065):targetSpread;
    smoothPointer.lerp(pointer,enabled?.045:1);
    group.rotation.set(smoothPointer.y*.18+scroll*.15,smoothPointer.x*.28+Math.sin(elapsed*.12)*.12,Math.sin(elapsed*.09)*.055);
    for(const {form,base,rotation} of forms){
      form.position.copy(base).multiplyScalar(1+spread*.32);
      form.position.y+=Math.sin(elapsed*.55+base.x)*.11;
      form.rotation.set(rotation.x+elapsed*.025,rotation.y+elapsed*.035+spread*.5,rotation.z+Math.sin(elapsed*.4+base.y)*.055);
    }
    renderer.render(scene,camera);
    host.dataset.sceneReady='true';
    if(enabled&&visible&&!document.hidden)raf=requestAnimationFrame(render);
  };
  const requestRender=()=>{if(!disposed&&!raf)raf=requestAnimationFrame(render);};
  const resize=()=>{
    const {width,height}=host.getBoundingClientRect();
    if(!width||!height)return;
    renderer.setSize(width,height,false);camera.aspect=width/height;
    camera.position.z=camera.aspect<1?16.5:7.9;camera.updateProjectionMatrix();requestRender();
  };
  const observer=new ResizeObserver(resize);observer.observe(host);
  const intersection=new IntersectionObserver(([entry])=>{
    visible=entry.isIntersecting;lastTime=0;
    if(!visible){cancelAnimationFrame(raf);raf=0;}else requestRender();
  });intersection.observe(host);
  host.addEventListener('pointermove',event=>{
    if(!enabled||event.pointerType!=='mouse')return;
    const r=host.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width-.5,(event.clientY-r.top)/r.height-.5);requestRender();
  },{passive:true,signal});
  host.addEventListener('pointerleave',()=>{pointer.set(0,0);},{signal});
  host.addEventListener('click',()=>{targetSpread=targetSpread?0:1;host.setAttribute('aria-pressed',String(Boolean(targetSpread)));requestRender();},{signal});
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();cancelAnimationFrame(raf);raf=0;host.dataset.sceneReady='false';},{signal});
  renderer.domElement.addEventListener('webglcontextrestored',requestRender,{signal});
  document.addEventListener('visibilitychange',()=>{
    lastTime=0;if(document.hidden){cancelAnimationFrame(raf);raf=0;}else if(visible)requestRender();
  },{signal});
  resize();
  return {
    setMotion(value){enabled=value;pointer.set(0,0);lastTime=0;cancelAnimationFrame(raf);raf=0;requestRender();},
    setScroll(value){if(scroll===value)return;scroll=value;if(visible)requestRender();},
    dispose(){disposed=true;controller.abort();observer.disconnect();intersection.disconnect();cancelAnimationFrame(raf);tubeGeometry.dispose();centerGeometry.dispose();materials.forEach(m=>m.dispose());envTarget.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}
  };
}
