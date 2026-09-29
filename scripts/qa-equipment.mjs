import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),model=join(root,'精细模型与动作开发');
const {build}=await import(pathToFileURL(join(model,'node_modules/esbuild/lib/main.js')));
const {chromium}=await import(pathToFileURL(process.env.QA_PLAYWRIGHT||'C:/Users/link/Desktop/健身助手1/精细模型与动作开发/node_modules/playwright/index.mjs'));
await mkdir(join(root,'.qa'),{recursive:true});const output=await mkdtemp(join(root,'.qa/equipment-'));
const entry=join(output,'preview.js');
await writeFile(entry,`
import * as THREE from '../../精细模型与动作开发/node_modules/three/build/three.module.js';
import {createAnatomyAtlas} from '../../精细模型与动作开发/atlas-model.js';
const scene=new THREE.Scene();scene.background=new THREE.Color('#edf1eb');
const atlas=createAnatomyAtlas({rigged:true});scene.add(atlas.body);atlas.setAppearance('neutral',[],null,false);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(700,700);renderer.setPixelRatio(1);document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight('#ffffff','#697769',2));const light=new THREE.DirectionalLight('#fff5e7',3);light.position.set(3,5,4);scene.add(light);
const camera=new THREE.PerspectiveCamera(36,1,.01,30);
window.inspectEquipment=(id,q,view)=>{
 atlas.rig.pose(q,id);const target=new THREE.Vector3(.25,1.85,.2);
 camera.position.copy(target).add(view==='side'?new THREE.Vector3(7,1.4,.3):new THREE.Vector3(4,2.0,6.5));
 camera.lookAt(target);renderer.render(scene,camera);return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
};window.inspectEquipment('chest-press',0,'body');
`);
await build({entryPoints:[entry],bundle:true,format:'iife',outfile:join(output,'preview.bundle.js'),logLevel:'silent'});
await writeFile(join(output,'index.html'),'<html><body style="margin:0"><script src="preview.bundle.js"></script></body></html>');
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:700,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(join(output,'index.html')).href);await page.waitForFunction(()=>!!window.inspectEquipment);
 for(const id of ['chest-press','lat-pulldown','pullup','row','triceps','leg-curl','leg-extension'])for(const q of [0,.5,1])for(const view of ['body','side']){
  await page.evaluate(([id,q,view])=>window.inspectEquipment(id,q,view),[id,q,view]);await page.screenshot({path:join(output,id+'-'+q+'-'+view+'.png')});
 }
 const render=await page.evaluate(()=>window.inspectEquipment('lat-pulldown',.5,'body'));console.log(JSON.stringify({output,errors,render}));if(errors.length)process.exitCode=1;
}finally{await browser.close();}
