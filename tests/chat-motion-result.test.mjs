import test from 'node:test';
import assert from 'node:assert/strict';
import {compactChatMotionResult,renderChatMotionResult} from '../public/chat-motion-result.js';

test('chat motion receipts retain the detail link without duplicating the saved report',()=>{
 const result={name:'assess_motion_video',ok:true,readOnly:true,reportId:'motion:123',exerciseName:'深蹲',verdict:{status:'needs-improvement',summary:'起身时需要调整'},feedback:[{title:'膝部控制',evidence:'画面中膝盖向内移动',correction:'起身时保持膝盖沿脚尖方向移动'}],record:{data:{private:'full report'}},records:[{}]};
 const receipt=compactChatMotionResult(result);
 assert.equal(receipt.record,undefined);assert.equal(receipt.records,undefined);
 const html=renderChatMotionResult(receipt);
 assert.match(html,/查看详细结果/);assert.match(html,/data-report-id="motion:123"/);assert.match(html,/膝盖沿脚尖方向/);assert.doesNotMatch(html,/full report/);
 assert.doesNotMatch(renderChatMotionResult({...receipt,ok:false}),/data-action="chat-motion-detail"/);
});

test('model text and report IDs cannot inject active markup into motion result cards',()=>{
 const html=renderChatMotionResult({ok:true,reportId:'motion:" onclick="alert(1)',exerciseName:'<img src=x onerror=alert(1)>',verdict:{status:'<script>',summary:'<script>alert(1)</script>'},feedback:[{title:'<b>x</b>',correction:'<iframe src=x>'}]});
 assert.doesNotMatch(html,/<script|<img|<iframe| onclick="/);
 assert.match(html,/&lt;script&gt;/);assert.match(html,/is-uncertain/);
});
