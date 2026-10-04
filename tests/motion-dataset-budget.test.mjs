import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBudgetedFetch} from '../scripts/motion-dataset-provider.mjs';

const endpoint='https://api.deepseek.com/chat/completions';
const options={method:'POST',headers:{Authorization:'Bearer test-secret'},body:JSON.stringify({model:'deepseek-flash',thinking:{type:'disabled'},max_tokens:2400,messages:[{role:'user',content:[{type:'text',text:'动作测试'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,test-image'}}]}]})};

test('a persistent budget blocks spending before a call and never writes credentials or input media',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'motion-budget-')),ledgerPath=join(directory,'ledger.json');
  let requests=0;
  try {
    const send=createBudgetedFetch({ledgerPath,budgetCny:.035,fetchImpl:async()=>{requests++;throw new Error('network interruption');}});
    await assert.rejects(send(endpoint,options),/network interruption/);
    const resumed=createBudgetedFetch({ledgerPath,budgetCny:.035,fetchImpl:async()=>{requests++;return new Response('{}');}});
    await assert.rejects(resumed(endpoint,options),error=>error.code==='DATASET_BUDGET_EXCEEDED');
    assert.equal(requests,1);
    const saved=readFileSync(ledgerPath,'utf8');
    assert.doesNotMatch(saved,/test-secret|test-image|动作测试|Bearer/);
    const ledger=JSON.parse(saved);assert.equal(ledger.calls[0].status,'transport-error');assert(ledger.committedCny>0);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('verified usage settles a reservation at conservative peak rates and rejects other models/destinations',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'motion-budget-')),ledgerPath=join(directory,'ledger.json');
  let requests=0;
  try {
    const send=createBudgetedFetch({ledgerPath,budgetCny:1,fetchImpl:async(_url,request)=>{
      requests++;assert.equal(request.redirect,'error');return Response.json({usage:{prompt_tokens:1000,completion_tokens:100}});
    }});
    await send(endpoint,options);
    const ledger=JSON.parse(readFileSync(ledgerPath,'utf8'));
    assert.equal(ledger.committedCny,.0028);
    await assert.rejects(send('https://example.com/chat/completions',options),/destination/);
    await assert.rejects(send(endpoint,{...options,body:options.body.replace('deepseek-flash','other-model')}),/bounded/);
    await assert.rejects(send(endpoint,{...options,body:JSON.stringify({...JSON.parse(options.body),n:10})}),/unbounded/);
    await assert.rejects(send(endpoint,{...options,body:JSON.stringify({...JSON.parse(options.body),thinking:{type:'enabled'},reasoning_effort:'max',max_tokens:100000})}),/bounded/);
    assert.equal(requests,1);
    writeFileSync(ledgerPath,JSON.stringify({version:1,budgetCny:1,calls:[{}]}));
    await assert.rejects(send(endpoint,options),/Invalid budget ledger/);
    assert.equal(requests,1);
    assert.throws(()=>createBudgetedFetch({ledgerPath,budgetCny:51}),/0–50/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('reasoning requests reserve their entire bounded output including reasoning tokens',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'motion-budget-')),ledgerPath=join(directory,'ledger.json');
 try{
  const send=createBudgetedFetch({ledgerPath,budgetCny:1,fetchImpl:async()=>Response.json({})});
  await send(endpoint,{...options,body:JSON.stringify({...JSON.parse(options.body),thinking:{type:'enabled'},reasoning_effort:'low',max_tokens:4096})});
  const ledger=JSON.parse(readFileSync(ledgerPath,'utf8')),call=ledger.calls[0];
  assert.equal(call.thinking,'enabled');assert.equal(call.maxOutputTokens,4096);assert(call.committedCny>=4096*8/1e6);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
