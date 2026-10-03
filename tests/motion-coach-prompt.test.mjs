import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMotionCoachMessages} from '../server/motion-coach.mjs';

const input = {duration:3, analysis:{evidenceFrames:[{time:1,framing:'equipment-context'},{time:2,framing:'target-detail'}]}, keyframes:[{time:1,mimeType:'image/jpeg',data:'fixture'},{time:2,mimeType:'image/jpeg',data:'fixture'}]};

test('visual request asks for verifiable apparatus, support and trajectory observations', () => {
  const [system, user] = buildMotionCoachMessages(input, {visual:true});
  const schema = JSON.parse(system.content.match(/结构为(.*?)。最多/s)[1]);
  assert.deepEqual(Object.keys(schema.action.observations).sort(), ['equipment','evidence','evidenceTimes','laterality','movement','support']);
  assert.match(system.content, /recognitionRules/);
  assert.match(system.content, /导轨/);
  assert.match(system.content, /绳索/);
  assert.match(system.content, /两个/);
  assert.equal(user.content.filter(part => part.type === 'image_url').length, 2);
  assert.equal(JSON.parse(user.content[0].text).analysis.evidenceFrames[0].framing, 'equipment-context');
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
