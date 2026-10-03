import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMotionCoachMessages} from '../server/motion-coach.mjs';

const input = {duration:3, analysis:{evidenceFrames:[{time:1,framing:'equipment-context'},{time:2,framing:'target-detail'}]}, keyframes:[{time:1,mimeType:'image/jpeg',data:'fixture'},{time:2,mimeType:'image/jpeg',data:'fixture'}]};

test('visual request asks for verifiable apparatus, support and trajectory observations', () => {
  const [system, user] = buildMotionCoachMessages(input, {visual:true});
  const schema = JSON.parse(system.content.match(/结构为(.*?)。最多/s)[1]);
  assert.deepEqual(Object.keys(schema.action.observations).sort(), ['assistance','equipment','evidence','evidenceTimes','laterality','movement','support']);
  assert.match(system.content, /recognitionRules/);
  assert.match(system.content, /导轨/);
  assert.match(system.content, /绳索/);
  assert.match(system.content, /两个/);
  assert.equal(user.content.filter(part => part.type === 'image_url').length, 2);
  assert.equal(JSON.parse(user.content[0].text).analysis.evidenceFrames[0].framing, 'equipment-context');
});

test('recognition requests preserve unlisted names and distinguish unassisted pull-ups from teaching matches', () => {
  const [system] = buildMotionCoachMessages(input, {visual:true});
  const schema = JSON.parse(system.content.match(/结构为(.*?)。最多/s)[1]);
  assert.equal(schema.action.name, null);
  assert.equal(schema.action.family, null);
  assert.equal(schema.action.evidence, '');
  assert.equal(schema.action.observations.assistance, 'unknown');
  assert.match(system.content, /目录外/);
  assert.match(system.content, /弹力带/);
  assert.match(system.content, /普通引体/);
  assert.doesNotMatch(system.content, /识别范围为下方动作目录/);
});

test('text request cannot confirm an equipment variant even when image data exists on input', () => {
  const [system, user] = buildMotionCoachMessages(input, {visual:false});
  assert.match(system.content, /action必须unknown/);
  assert.equal(user.content.filter(part => part.type === 'image_url').length, 0);
  assert.deepEqual(JSON.parse(user.content[0].text).frames, []);
  const schema = JSON.parse(system.content.match(/结构为(.*?)。最多/s)[1]);
  assert.equal(schema.action.status, 'unknown');
  assert.equal(schema.action.observations.equipment, null);
});

test('visual request separates bench pressing from rowing when projected arm motion overlaps', () => {
  const [system] = buildMotionCoachMessages(input, {visual:true});
  assert.match(system.content, /仰卧.*胸部.*推离/s);
  assert.match(system.content, /划船.*拉近.*放回/s);
  assert.match(system.content, /手腕.*画面.*上下.*不能/s);
  assert.match(system.content, /推拉.*无法确认.*unknown/s);
});
