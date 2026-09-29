import test from 'node:test';
import assert from 'node:assert/strict';
import {activityProfiles} from '../activity-profiles.js';
import {activityAt,activityGroups,createActivityModel} from '../muscle-activity.js';
import {animatedExercises} from '../exercise-catalog.js';
import {muscleIds} from '../muscle-data.js';
import {sampleMotion} from '../motion-timeline.js';
import {createAnatomyAtlas} from '../atlas-model.js';

test('every animated exercise has an explicit profile using real muscle groups',()=>{
  assert.deepEqual(Object.keys(activityProfiles).sort(),[...animatedExercises].sort());
  for(const id of animatedExercises){
    assert(activityGroups(id).length>0);
    for(const group of activityGroups(id))assert(muscleIds.includes(group));
    assert(activityAt(id,{position:0}).rows.some(row=>row.role==='primary'));
  }
  assert.equal(activityAt('unknown',{position:.5}),null,'No invented curve for an unconfigured action');
  for(const position of [NaN,Infinity,-.1,1.1])assert.equal(activityAt('curl',{position}),null);
});

test('new actions use full-motion min/max normalization regardless of force scale or offset',()=>{
  const profile=points=>({muscles:{biceps:{role:'primary',curve:points}}});
  const points=[[0,10],[.5,30],[1,20]];
  const model=createActivityModel({newAction:profile(points),scaled:profile(points.map(([x,y])=>[x,700+100*y]))});
  for(let i=0;i<=100;i++){
    const q=i/100,a=model.at('newAction',{position:q}),b=model.at('scaled',{position:q});
    assert(Math.abs(a.muscles.biceps-b.muscles.biceps)<1e-12);
    assert(a.muscles.biceps>=0&&a.muscles.biceps<=1);
  }
  assert.equal(model.at('newAction',{position:0}).muscles.biceps,0);
  assert.equal(model.at('newAction',{position:.5}).muscles.biceps,1);
  assert.equal(model.at('newAction',{position:1}).muscles.biceps,.5);
});

test('full cycles remain continuous, synced to pose, and valid at turns and holds',()=>{
  for(const id of animatedExercises){
    let previous;
    for(let i=0;i<=1000;i++){
      const result=activityAt(id,sampleMotion(id,i/1000));
      assert(result.valid);assert.equal(result.kind,'illustration');assert(!('forces' in result));
      for(const [group,level] of Object.entries(result.muscles)){
        assert(Number.isFinite(level)&&level>=0&&level<=1);
        if(previous)assert(Math.abs(level-previous[group])<.03,`${id}/${group}: abrupt color jump`);
      }
      previous=result.muscles;
    }
    const outward=activityAt(id,sampleMotion(id,.335)),returning=activityAt(id,sampleMotion(id,.75));
    for(const group of activityGroups(id))assert(Math.abs(outward.muscles[group]-returning.muscles[group])<1e-12);
    assert.deepEqual(activityAt(id,sampleMotion(id,0)),activityAt(id,sampleMotion(id,1)));
    if(activityProfiles[id].isometric){
      assert.equal(sampleMotion(id,.55).contraction,'isometric');
      assert(activityAt(id,sampleMotion(id,.55)).rows.every(row=>row.steady));
      continue;
    }
    assert.equal(sampleMotion(id,.55).contraction,'turn');
    assert.equal(sampleMotion(id,.335).contraction,activityProfiles[id].firstContraction);
    assert.equal(sampleMotion(id,.96).contraction,'hold');
    assert(Object.values(activityAt(id,sampleMotion(id,.55)).muscles).some(level=>level>0));
  }
});

test('peaks are action-specific and support muscles keep a steady tint',()=>{
  const middle=activityAt('curl',{position:.72}),top=activityAt('curl',{position:1}),start=activityAt('curl',{position:0});
  assert.equal(middle.muscles.biceps,1);assert(top.muscles.biceps<1);assert.equal(start.muscles.biceps,0);
  for(const group of ['core','forearms']){
    assert.equal(start.muscles[group],top.muscles[group]);assert(start.muscles[group]>0);
    assert(start.rows.find(row=>row.group===group).steady);
  }
  assert.equal(activityAt('squat',{position:1}).muscles.quads,1);
  const zero=createActivityModel({zero:{muscles:{core:{curve:[[0,0],[1,0]]}}}});
  assert.equal(zero.at('zero',{position:.4}).muscles.core,0);
  for(const curve of [[[0,1],[0,2]],[[.2,1],[1,2]],[[0,1],[1,NaN]],[[0,-1],[1,1]]])assert.throws(()=>createActivityModel({bad:{muscles:{core:{curve}}}}));
});

test('materials show pale-to-deep relative colors and restore anatomical selection without allocations',()=>{
  const atlas=createAnatomyAtlas(),meshes=atlas.pickableMeshes;
  const resources=meshes.map(m=>[m.geometry,m.material]);
  const snapshot=()=>meshes.map(m=>[m.material.color.getHex(),m.material.emissive.getHex()]);
  atlas.setAppearance('neutral',[['quads'],['glutes'],['core','','','secondary']],'quads');
  const fixed=snapshot(),quads=meshes.find(m=>m.userData.muscle==='quads'),core=meshes.find(m=>m.userData.muscle==='core');
  atlas.setActivity(activityAt('squat',{position:0}));assert.equal(quads.material.color.getHex(),0xfae6c7);
  const stable=core.material.color.getHex();atlas.setActivity(activityAt('squat',{position:1}));
  assert.equal(quads.material.color.getHex(),0xa92f21);assert.equal(core.material.color.getHex(),stable);
  assert.equal(meshes.find(m=>m.userData.muscle==='lats').material.color.getHex(),0x807b71);
  atlas.setActivity(null);assert.deepEqual(snapshot(),fixed);
  atlas.setAppearance('neutral',[],null,false);const hidden=snapshot();atlas.setActivity(activityAt('squat',{position:1}));assert.deepEqual(snapshot(),hidden);
  meshes.forEach((m,i)=>{assert.equal(m.geometry,resources[i][0]);assert.equal(m.material,resources[i][1]);});
});

test('primary core activity remains visible through covering anatomy and reuses its overlay',()=>{
  const atlas=createAnatomyAtlas({rigged:true});
  atlas.setAppearance('neutral',[['core']],'core');atlas.rig.pose(0,'crunch');
  atlas.setActivity(activityAt('crunch',{position:0}));
  const overlay=atlas.body.children.find(mesh=>mesh.userData.activityOverlay);
  assert(overlay?.visible);assert.equal(overlay.material.depthTest,false);
  assert.equal(overlay.geometry,atlas.muscleMeshes.find(mesh=>mesh.userData.muscle==='core').geometry);
  const pale=overlay.material.color.getHex();
  atlas.rig.pose(1,'crunch');atlas.setActivity(activityAt('crunch',{position:1}));
  assert.notEqual(overlay.material.color.getHex(),pale);
  assert.equal(atlas.body.children.filter(mesh=>mesh.userData.activityOverlay).length,1);
  atlas.setActivity(null);assert.equal(overlay.visible,false);
  atlas.setActivity(activityAt('crunch',{position:1}));assert(overlay.visible);
  atlas.setAppearance('neutral',[],null,false);atlas.setActivity(activityAt('crunch',{position:1}));assert.equal(overlay.visible,false);
});
