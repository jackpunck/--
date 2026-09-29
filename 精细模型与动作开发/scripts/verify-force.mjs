import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import tables from '../assets/muscle-force-tables.json' with {type:'json'};
import directReference from './fixtures/pushup-force-reference.json' with {type:'json'};
import {estimateForces,forceToLevel,forceProfiles} from '../muscle-force.js';
import {sampleMotion} from '../motion-timeline.js';
// Archived force estimator is checked independently of the teaching UI.
const activityAt=(id,motion)=>estimateForces(id,motion.position,forceProfiles[id].defaultLoad);
import {createAnatomyAtlas} from '../atlas-model.js';
import {captureForcePoses} from './force-pose-data.mjs';

test('force tables match the actual displayed poses, including torso rotation',()=>{
  const atlas=createAnatomyAtlas({rigged:true});
  const data=captureForcePoses(atlas);
  assert.equal(createHash('sha256').update(JSON.stringify(data)).digest('hex'),tables.poseSourceSha256,'Regenerate force tables after changing the animation');
  assert(tables.exercises.pushup.maxPoseErrorDegrees<1,'Push-up retargeting must remain within one degree of the display limb directions');
});

test('all precomputed force solutions satisfy torque balance and capacity bounds',()=>{
  let checked=0;
  for(const [id,data] of Object.entries(tables.exercises)){
    for(const sample of data.samples)for(const [index,forces] of sample.forces.entries()){
      if(!forces)continue;
      checked++;
      forces.forEach((force,j)=>assert(force>=0&&force<=data.muscles[j].capacity+.001,`${id}: invalid muscle capacity`));
      sample.R.forEach((row,j)=>{
        const actual=row.reduce((sum,r,i)=>sum+r*forces[i],0);
        const expected=sample.base[j]+sample.load[j]*data.loads[index];
        assert(Math.abs(actual-expected)<.02,`${id} q=${sample.q}: torque residual ${actual-expected}`);
      });
    }
    assert(data.validation.maxEquilibriumResidualNm<.02);
  }
  assert(checked>5000);
});

test('loads affect Newton values on one absolute color scale; direction never recolors equal force',()=>{
  for(const [id,profile] of Object.entries(forceProfiles)){
    const low=estimateForces(id,.5,0),high=estimateForces(id,.5,5);
    assert(low.valid&&high.valid,id);
    assert(Object.keys(high.forces).some(group=>high.forces[group]>low.forces[group]+1),`${id} must respond to added load`);
    for(const [group,value] of Object.entries(high.forces))assert.equal(high.muscles[group],forceToLevel(value));
    const a=activityAt(id,sampleMotion(id,.335)),b=activityAt(id,sampleMotion(id,.75));
    assert(a.valid&&b.valid);
    for(const group of Object.keys(a.forces))assert(Math.abs(a.forces[group]-b.forces[group])<1e-8);
    assert(!Object.hasOwn(high.forces,'core'),'Unmodeled core force must not be invented');
    assert.equal(estimateForces(id,.5,-1).valid,false);
    assert.equal(estimateForces(id,.5,profile.maxLoad+1).valid,false);
    assert.equal(estimateForces(id,NaN,0).valid,false);
  }
  assert.equal(forceToLevel(0),0);assert.equal(forceToLevel(3000),1);assert.equal(forceToLevel(6000),1);
  assert(forceToLevel(100)<forceToLevel(500));assert.equal(forceToLevel(NaN),null);
  assert.equal(estimateForces('bench',.5,0).valid,false);
});

test('interpolated loads and poses meet runtime equilibrium tolerance without extrapolation',()=>{
  let valid=0;
  for(const [id,profile] of Object.entries(forceProfiles))for(let i=0;i<100;i++){
    const result=estimateForces(id,(i+.5)/100,profile.defaultLoad);
    if(result.valid){valid++;assert(Number.isFinite(result.residualNm));}
    else {assert.deepEqual(result.forces,{});assert.deepEqual(result.muscles,{});}
  }
  assert(valid>250,'Most sampled standard poses must have usable solutions');
  const overloaded=estimateForces('pushup',.95,30);
  assert.equal(overloaded.valid,false,'Capacity failure must be visible instead of silently increasing muscle strength');
  assert.deepEqual(overloaded.forces,{});
});

test('a full push-up with zero or 5 kg added load never drops its estimated forces',()=>{
  for(const load of [0,.5,2.5,5])for(let i=0;i<=1000;i++){
    const q=i/1000,result=estimateForces('pushup',q,load);
    assert(result.valid,`pushup q=${q}, load=${load}: ${result.reason}`);
    assert(result.rows.every(row=>Number.isFinite(row.forceN)&&row.forceN>=0));
  }
  const overloaded=estimateForces('pushup',1,30);
  assert(!overloaded.valid);
  assert.match(overloaded.reason,/不代表你无法完成动作/);
  assert.deepEqual(overloaded.rows,[]);
});

test('nonuniform pose intervals return the stored solution exactly at each node',()=>{
  const data=tables.exercises.pushup;
  assert(data.samples.some(sample=>sample.q===.002),'Near-extension poses need finer sampling');
  for(const sample of data.samples)for(const k of [0,3]){
    const result=estimateForces('pushup',sample.q,data.loads[k]);
    assert(result.valid,`pushup q=${sample.q}`);
    result.rows.forEach((row,j)=>assert(Math.abs(row.forceN-sample.forces[k][j])<1e-8));
  }
});

test('interpolation also balances directly recomputed OpenSim moments between nodes',()=>{
  assert.equal(directReference.poseSourceSha256,tables.poseSourceSha256,'Rebuild the direct reference fixture after changing poses');
  assert.deepEqual(directReference.sources,tables.sources);
  for(const sample of directReference.samples)for(const load of [0,5]){
    const result=estimateForces('pushup',sample.q,load);
    assert(result.valid);
    const target=sample.base.map((value,j)=>value+load*sample.load[j]);
    const tolerance=Math.max(.1,...target.map(value=>Math.abs(value)*.01));
    sample.R.forEach((row,j)=>{
      const moment=row.reduce((sum,r,k)=>sum+r*result.rows[k].forceN,0);
      assert(Math.abs(moment-target[j])<=tolerance,`Direct reference mismatch at q=${sample.q}, load=${load}`);
    });
  }
});

test('real materials use the force scale, restore fixed colors, and preserve GPU resources',()=>{
  const atlas=createAnatomyAtlas(),meshes=atlas.pickableMeshes;
  const resources=meshes.map(m=>[m.geometry,m.material]);
  const snapshot=()=>meshes.map(m=>[m.material.color.getHex(),m.material.emissive.getHex()]);
  atlas.setAppearance('neutral',[['quads'],['glutes'],['core','','','secondary']],'quads');
  const fixed=snapshot();
  atlas.setActivity(estimateForces('squat',.5,0));const light=snapshot();
  atlas.setActivity(estimateForces('squat',.5,30));assert.notDeepEqual(snapshot(),light);
  const unknown=meshes.find(m=>m.userData.muscle==='core');assert.equal(unknown.material.color.getHex(),0x807b71);
  const quads=meshes.find(m=>m.userData.muscle==='quads'),glutes=meshes.find(m=>m.userData.muscle==='glutes');
  atlas.setActivity({muscles:{quads:forceToLevel(500),glutes:forceToLevel(500)}});
  assert.equal(quads.material.color.getHex(),glutes.material.color.getHex(),'Equal force means equal color despite selected/primary role');
  atlas.setActivity(null);assert.deepEqual(snapshot(),fixed);
  atlas.setAppearance('neutral',[],null,false);const hidden=snapshot();atlas.setActivity(estimateForces('squat',.5,30));assert.deepEqual(snapshot(),hidden);
  atlas.setAppearance('neutral',[],null,true);atlas.selectStructure('Soleus muscle.l');
  assert(atlas.body.children.some(m=>m.userData.selectionOverlay));
  meshes.forEach((m,i)=>{assert.equal(m.geometry,resources[i][0]);assert.equal(m.material,resources[i][1]);});
});

test('timeline classifies contraction and holds without imposing a force waveform',()=>{
  for(const id of Object.keys(forceProfiles)){
    assert.equal(sampleMotion(id,.335).contraction,id==='curl'?'concentric':'eccentric');
    assert.equal(sampleMotion(id,.75).contraction,id==='curl'?'eccentric':'concentric');
    assert.equal(sampleMotion(id,.55).position,1);
    assert.equal(sampleMotion(id,.96).phaseIndex,0);
    assert.deepEqual(activityAt(id,sampleMotion(id,0)),activityAt(id,sampleMotion(id,1)));
  }
});
