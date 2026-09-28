import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {exercises} from '../public/domain.js';
import {findVisuals, muscleCatalog, modelUrl} from '../public/visuals.js';

test('questions resolve Chinese/English aliases to actual muscle and exercise URLs', () => {
  assert.equal(findVisuals('肱二头肌在哪里')[0].url,'/model/index.html?mode=atlas&muscle=biceps&embed=1&compact=1');
  assert.equal(findVisuals('讲解哑铃卧推')[0].id,'bench');
  assert.equal(findVisuals('给我 HAMMER CURL 的3D')[0].id,'hammer-curl');
  assert.equal(findVisuals('看高脚杯深蹲')[0].id,'goblet-squat');
  assert.equal(findVisuals('三头下压')[0].type,'exercise');
  assert.equal(findVisuals('股二头肌')[0].id,'hamstrings');
  assert.deepEqual(findVisuals('哑铃锤式弯举，哑铃锤式弯举，然后普通弯举').map(v=>v.id),['hammer-curl','curl']);
  assert.deepEqual(findVisuals('高脚杯深蹲'.repeat(4000)).map(v=>v.id),['goblet-squat']);
  assert.equal(findVisuals('不要看胸肌，看看肱二头肌')[0].id,'biceps');
  assert.deepEqual(findVisuals('不要锤式弯举，只看胸大肌').map(v=>v.id),['chest']);
  assert.deepEqual(findVisuals('不要哑铃卧推，看前锯肌').map(v=>v.id),['serratus-anterior']);
  assert.deepEqual(findVisuals('今天有云，sculpture absolute只是单词'),[]);
  assert.deepEqual(findVisuals('抓举和跳箱'),[]);
  assert.deepEqual(findVisuals(null),[]);
});

test('visuals are bounded, deduplicated and unknown IDs cannot build viewer URLs', () => {
  const result=findVisuals('胸肌、胸大肌、俯卧撑、三角肌',{limit:10});
  assert.equal(result.length,2);assert.deepEqual(result.map(x=>x.id),['chest','pushup']);
  assert.equal(findVisuals('胸肌',{limit:0}).length,0);
  assert.equal(modelUrl('exercise','<script>'),null);
  assert.equal(modelUrl('muscle','unknown'),null);
  for(const exercise of exercises)assert.ok(modelUrl('exercise',exercise.id).includes(`exercise=${exercise.id}`));
});

test('individual muscle deep links refer to exact source mesh names', () => {
  const manifest=JSON.parse(fs.readFileSync(new URL('../精细模型与动作开发/assets/anatomy-manifest.json',import.meta.url)));
  for(const muscle of muscleCatalog.filter(m=>m.structure)) {
    assert.ok(manifest.some(m=>m.name===muscle.structure&&m.kind==='muscle'),muscle.structure);
    assert.equal(new URL(modelUrl('muscle',muscle.id),'http://localhost').searchParams.get('structure'),muscle.structure);
  }
  assert.equal(findVisuals('前锯肌在哪里')[0].id,'serratus-anterior');
  assert.equal(findVisuals('我想看三角肌前束')[0].id,'deltoid-anterior');
  assert.equal(findVisuals('股内侧肌')[0].id,'vastus-medialis');
  assert.equal(findVisuals('臀中肌')[0].id,'gluteus-medius');
  for(const [query,id,part]of [['斜方肌上部','traps-upper','Descending'],['斜方肌中束','traps-middle','Transverse'],['下斜方肌','traps-lower','Ascending']]){
    const result=findVisuals(query)[0];assert.equal(result.id,id);
    assert.equal(new URL(result.url,'http://localhost').searchParams.get('structure'),`${part} part of trapezius muscle.l`);
  }
});
