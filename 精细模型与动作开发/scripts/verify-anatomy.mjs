import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import * as THREE from 'three';
import asset from '../assets/anatomy-atlas.json' with {type:'json'};
import {createAnatomyAtlas} from '../atlas-model.js';
import {muscleRole,structures,structureLabel,structureView} from '../muscle-data.js';
import {muscleCatalog} from '../../public/visuals.js';

const raw=inflateSync(Buffer.from(asset.data,'base64'));
const centers=new Map(asset.meshes.map(item=>{
  const sum=[0,0,0];
  for(let i=0;i<item.vertices;i++)for(let axis=0;axis<3;axis++)sum[axis]+=raw.readInt16LE(item.offset+i*6+axis*2)*asset.scale*asset.positionScale;
  return [item.name,sum.map(v=>v/item.vertices)];
}));
const point=name=>centers.get(name+'.l');

test('every selectable structure has a distinct Chinese name and correct anatomical side',()=>{
  const labels=new Set();
  for(const name of structures){
    const label=structureLabel(name);
    assert.match(label.replace(/左侧|右侧/g,''),/[\u3400-\u9fff]/,name);
    assert(!/[a-z]/i.test(label),name);
    assert(!labels.has(label),`Different source structures collapsed into ${label}`);labels.add(label);
    if(name.endsWith('.l')){assert(label.startsWith('左侧'));assert(centers.get(name)[0]>0,name);}
    if(name.endsWith('.r')){assert(label.startsWith('右侧'));assert(centers.get(name)[0]<0,name);}
  }
});

test('names preserve anatomical distinctions instead of partial word matches',()=>{
  assert.equal(structureLabel('Coracobrachialis muscle.l'),'左侧 · 喙肱肌');
  assert.equal(structureLabel('Brachialis muscle.l'),'左侧 · 肱肌');
  assert.equal(structureLabel('Semispinalis thoracis muscle.r'),'右侧 · 胸半棘肌');
  assert.equal(structureLabel('Spinalis thoracis muscle.r'),'右侧 · 胸棘肌');
  assert.equal(structureLabel('Longissimus thoracis muscle.l'),'左侧 · 胸最长肌');
  assert.equal(structureLabel('(Abdominal part of pectoralis major muscle).l'),'左侧 · 胸大肌 · 腹部');
  assert.equal(structureLabel('Tendon of extensor digitorum longus.l'),'左侧 · 趾长伸肌腱');
  assert.equal(structureLabel('Deep head of pronator teres.r'),'右侧 · 旋前圆肌 · 深头');
  assert.equal(structureLabel('Unrecognized structure.l'),'左侧 · Unrecognized structure');
});

test('public atlas entries occupy expected body regions in the imported anatomy',()=>{
  // Broad independent rest-pose regions, not medical tolerances. The source
  // model is 3.2 units tall; this catches swapped assets and catalogue IDs.
  const regions={chest:[2.2,2.7],biceps:[2,2.5],triceps:[2,2.5],deltoids:[2.3,2.7],lats:[1.8,2.5],traps:[2.3,2.9],core:[1.7,2.3],obliques:[1.7,2.3],quads:[.8,1.5],hamstrings:[.8,1.5],glutes:[1.4,1.9],calves:[.3,.9],forearms:[1.4,2],
    'serratus-anterior':[2.1,2.7],'rhomboid-major':[2.3,2.7],'rhomboid-minor':[2.4,2.8],'tibialis-anterior':[.2,.8],
    'adductor-longus':[1,1.6],'adductor-magnus':[.9,1.6],'adductor-brevis':[1.1,1.6],longissimus:[1.8,2.5],iliocostalis:[1.7,2.3],brachialis:[1.9,2.4],
    'rectus-abdominis':[1.7,2.3],'transversus-abdominis':[1.7,2.3],'deltoid-anterior':[2.3,2.7],'deltoid-middle':[2.3,2.7],'deltoid-posterior':[2.3,2.7],
    'gluteus-maximus':[1.4,1.9],'gluteus-medius':[1.4,1.9],'gluteus-minimus':[1.4,1.9],soleus:[.3,.8],
    'rectus-femoris':[.8,1.5],'vastus-lateralis':[.8,1.5],'vastus-medialis':[.8,1.5],'vastus-intermedius':[.8,1.5],
    supraspinatus:[2.4,2.8],infraspinatus:[2.3,2.7],'teres-major':[2.1,2.7],'teres-minor':[2.3,2.7],subscapularis:[2.3,2.7]};
  Object.assign(regions,{'traps-upper':[2.65,2.85],'traps-middle':[2.55,2.7],'traps-lower':[2.2,2.5]});
  for(const item of muscleCatalog){
    const meshes=asset.meshes.filter(m=>m.kind==='muscle'&&(item.structure?m.name===item.structure:muscleRole(m.name)===item.id));
    assert(meshes.length,item.id);const [min,max]=regions[item.id];
    const y=meshes.reduce((sum,m)=>sum+centers.get(m.name)[1]*m.vertices,0)/meshes.reduce((sum,m)=>sum+m.vertices,0);
    assert(y>=min&&y<=max,`${item.id} is outside its expected region: ${y}`);
  }
  assert(point('Vastus lateralis muscle')[0]>point('Vastus medialis muscle')[0],'lateral vs medial quadriceps');
  assert(point('Scapular spinal part of deltoid muscle')[2]<point('Clavicular part of deltoid muscle')[2],'posterior vs anterior deltoid');
  assert(point('Supraspinatus muscle')[1]>point('Infraspinatus muscle')[1],'above vs below scapular spine');
  assert(point('Rectus abdominis muscle')[2]>point('Transversus abdominis muscle')[2],'superficial vs deep abdomen');
  assert(point('Gluteus maximus muscle')[2]<point('Gluteus minimus muscle')[2],'superficial posterior vs deep gluteals');
});

test('both trapezius sides have correctly ordered upper, middle and lower geometry',()=>{
  for(const side of ['l','r']){
    const names=['Descending','Transverse','Ascending'].map(part=>`${part} part of trapezius muscle.${side}`);
    const [upper,middle,lower]=names.map(name=>centers.get(name));
    assert(upper[1]>middle[1]&&middle[1]>lower[1],`${side}: upper/middle/lower labels must follow the actual superior-inferior positions`);
    assert.equal(structureLabel(names[0]),`${side==='l'?'左':'右'}侧 · 斜方肌 · 上部`);
    assert.equal(structureLabel(names[1]),`${side==='l'?'左':'右'}侧 · 斜方肌 · 中部`);
    assert.equal(structureLabel(names[2]),`${side==='l'?'左':'右'}侧 · 斜方肌 · 下部`);
    const upperMesh=asset.meshes.find(m=>m.name===names[0]),lowerMesh=asset.meshes.find(m=>m.name===names[2]);
    assert.equal(upperMesh.sourceName,names[2],'Original imported identifier is preserved');
    assert.equal(lowerMesh.sourceName,names[0],'Original imported identifier is preserved');
  }
});

test('posterior shoulder structures open from the back, anterior ones from the front',()=>{
  for(const name of ['Scapular spinal part of deltoid muscle.l','Supraspinatus muscle.r','Infraspinatus muscle.l','Teres minor muscle.l'])assert.equal(structureView(name),'back');
  for(const name of ['Clavicular part of deltoid muscle.l','Subscapularis muscle.l','Tibialis anterior muscle.l'])assert.equal(structureView(name),'front');
});

test('see-through highlights reveal the selected group and picking returns its actual structure',()=>{
  const atlas=createAnatomyAtlas();
  atlas.setAppearance('neutral',[['core']], 'core',true,true);
  let overlay=atlas.body.children.find(m=>m.userData.selectionOverlay);
  assert(overlay);assert.equal(overlay.userData.group,'core');assert.equal(overlay.material.depthTest,false);
  const core=atlas.muscleMeshes.find(m=>m.userData.muscle==='core');assert.equal(overlay.geometry.drawRange.count,core.geometry.index.count);
  const ray=new THREE.Raycaster(new THREE.Vector3(.07,2.05,5),new THREE.Vector3(0,0,-1));
  assert.equal(atlas.raycastStructure(ray,true).structure,'Rectus abdominis muscle.l','Orange abdomen must identify the highlighted rectus, not its covering');
  atlas.selectStructure('Transversus abdominis muscle.l');
  assert.equal(atlas.raycastStructure(ray,true).structure,'Transversus abdominis muscle.l','Deep selected muscle wins over occluding surface');
  atlas.selectStructure(null);atlas.setAppearance('neutral',[['core']],'core',true,true);
  atlas.setAppearance('neutral',[['core']],'core',false,true);
  assert(!atlas.body.children.some(m=>m.userData.selectionOverlay),'Hide highlight removes the group overlay');
  atlas.setAppearance('neutral',[['chest']],'chest',true,false);
  assert(!atlas.body.children.some(m=>m.userData.selectionOverlay),'Motion mode retains surface shading');
});
