import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {animatedExercises} from '../精细模型与动作开发/exercise-catalog.js';
const root=process.cwd(),model=join(root,'精细模型与动作开发');
const {build}=await import(pathToFileURL(join(model,'node_modules/esbuild/lib/main.js')));
const {chromium}=await import(pathToFileURL(process.env.QA_PLAYWRIGHT||'C:/Users/link/Desktop/健身助手1/精细模型与动作开发/node_modules/playwright/index.mjs'));
await mkdir(join(root,'.qa'),{recursive:true});const output=await mkdtemp(join(root,'.qa/grips-'));console.log(output);
const entry=join(output,'preview.js');
await writeFile(entry,`
import * as THREE from '../../精细模型与动作开发/node_modules/three/build/three.module.js';
import {createAnatomyAtlas} from '../../精细模型与动作开发/atlas-model.js';
const scene=new THREE.Scene();scene.background=new THREE.Color('#edf1eb');
const atlas=createAnatomyAtlas({rigged:true});scene.add(atlas.body);atlas.setAppearance('neutral',[],null,false);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(700,700);renderer.setPixelRatio(1);document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight('#ffffff','#697769',2));const light=new THREE.DirectionalLight('#fff5e7',3);light.position.set(3,5,4);scene.add(light);
const camera=new THREE.PerspectiveCamera(36,1,.01,30);
window.inspectGrip=(id,q,view)=>{
 atlas.rig.pose(q,id);const hand=atlas.rig.map['hand.'+(id==='dumbbell-row'?'r':'l')],target=hand.position.clone();
 if(view==='body'){target.copy(atlas.rig.poseJoints.l.shoulder).add(atlas.rig.poseJoints.r.shoulder).multiplyScalar(.5).add(new THREE.Vector3(0,-.35,0));camera.position.copy(target).add(new THREE.Vector3(2,.8,3));}
 else if(['shoulder','elbow','hip','knee','ankle'].includes(view)){
  target.copy(atlas.rig.poseJoints.l[view]);
  const bone=atlas.rig.map[view==='shoulder'?'chest':view==='elbow'?'upper.l':view==='hip'?'pelvis':view==='knee'?'thigh.l':'foot.l'];
  const offset=new THREE.Vector3(.42,.10,view==='ankle'?.62:.9).applyQuaternion(bone.quaternion);camera.position.copy(target).add(offset);
 }
 else {target.add(new THREE.Vector3(0,-.15,.08).applyQuaternion(hand.quaternion));const offset=new THREE.Vector3(view==='palm'?.55:-.55,-.06,view==='palm'?.85:-.85).applyQuaternion(hand.quaternion);camera.position.copy(target).add(offset);}
 camera.lookAt(target);renderer.render(scene,camera);return true;
};window.inspectGrip('chest-press',0,'body');
`);
await build({entryPoints:[entry],bundle:true,format:'iife',outfile:join(output,'preview.bundle.js'),logLevel:'silent'});
await writeFile(join(output,'index.html'),'<html><body style="margin:0"><script src="preview.bundle.js"></script></body></html>');
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:700,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(join(output,'index.html')).href);await page.waitForFunction(()=>!!window.inspectGrip);
 const ids=process.argv.find(arg=>arg.startsWith('--ids='))?.slice(6).split(',')||animatedExercises;
 const sheets=process.argv.includes('--joints')?await browser.newPage({viewport:{width:1050,height:1200}}):null;
 for(const id of ids){
  const lower=['squat','goblet-squat','rdl','lunge','leg-curl','leg-extension','calf-raise','glute-bridge','crunch'].includes(id);
  const jointViews=lower?['hip','knee','ankle']:['shoulder','elbow'];
  const views=['body','palm','back',...(sheets?jointViews:[])];
  for(const q of [0,.5,1])for(const view of views){
   await page.evaluate(([id,q,view])=>window.inspectGrip(id,q,view),[id,q,view]);await page.screenshot({path:join(output,id+'-'+q+'-'+view+'.png')});
  }
  if(sheets){
   const images=[];for(const view of [...jointViews,...(lower?[]:['palm','back'])])for(const q of [0,.5,1])images.push(`<div>${view} / ${q}<img style="width:100%" src="data:image/png;base64,${(await readFile(join(output,id+'-'+q+'-'+view+'.png'))).toString('base64')}"></div>`);
   await sheets.setContent(`<body style="margin:0;background:#edf1eb;font:16px sans-serif"><h2>${id}</h2><main style="display:grid;grid-template-columns:repeat(3,1fr)">${images.join('')}</main></body>`);
   await sheets.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));await sheets.screenshot({path:join(output,id+'-joints.png'),fullPage:true});
  }
 }
 await writeFile(join(output,'result.json'),JSON.stringify({ids,errors},null,2));
 console.log(JSON.stringify({output,errors}));if(errors.length)process.exitCode=1;
}finally{await browser.close();}
