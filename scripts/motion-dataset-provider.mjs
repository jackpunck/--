// Opt-in adapter for an explicitly authorized, already configured provider.
// It never exports credentials, sessions, profiles, or application records.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {createDecipheriv} from 'node:crypto';
import {providerFromRow} from '../server/storage.mjs';

export function loadDatasetProvider({providerId, dataDir=resolve('.data'), model='deepseek-flash'}={}) {
  if (!providerId || model !== 'deepseek-flash') throw new Error('Specify the authorized stored DeepSeek Flash provider ID.');
  const db=new DatabaseSync(join(dataDir,'fitness.sqlite'),{readOnly:true});
  let row;
  try {
    const rows=db.prepare('SELECT * FROM providers WHERE id = ?').all(providerId);
    if(rows.length!==1)throw new Error('Stored provider ID must identify exactly one configuration.');
    [row]=rows;
  } finally {db.close();}
  const provider=providerFromRow(row), url=new URL(provider.baseUrl);
  if(url.origin!=='https://api.deepseek.com'||!['/','/v1','/v1/'].includes(url.pathname)||url.search||url.hash||url.username||url.password||provider.protocol!=='openai')throw new Error('Only the authorized official DeepSeek API is allowed.');
  if(!provider.models.some(item=>item.id===model&&item.vision===true)||!row.api_key)throw new Error('Configure DeepSeek Flash with image input and a saved key in the app first.');
  const key=readFileSync(join(dataDir,'server.key')), data=Buffer.from(row.api_key,'base64');
  let apiKey;
  try {
    const decipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));
    decipher.setAuthTag(data.subarray(12,28));
    apiKey=Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');
  } finally {key.fill(0);data.fill(0);}
  provider.model=model;
  // Accidental JSON serialization or object logging must not disclose the key.
  Object.defineProperty(provider,'apiKey',{value:apiKey,enumerable:false});
  return provider;
}

// Official prices checked 2026-10-04: peak 2 CNY/M input and 8 CNY/M output.
// Always use peak/cache-miss rates as a conservative upper estimate. Images
// have an official maximum of 1,024 tokens each. Failed/unknown requests retain
// their full reservation; restarting a run never resets money already reserved.
export function createBudgetedFetch({ledgerPath,budgetCny=50,fetchImpl=fetch}={}) {
  if(!ledgerPath||!Number.isFinite(budgetCny)||budgetCny<=0||budgetCny>50)throw new Error('A persistent ledger and budget of 0–50 CNY are required.');
  mkdirSync(dirname(resolve(ledgerPath)),{recursive:true});
  const update=mutate=>{
    const lock=ledgerPath+'.lock';
    writeFileSync(lock,'locked',{flag:'wx'});
    try {
      const ledger=existsSync(ledgerPath)?JSON.parse(readFileSync(ledgerPath,'utf8')):{version:1,budgetCny,rateBasis:'peak-cache-miss-upper-estimate',calls:[]};
      if(ledger.version!==1||!Number.isFinite(ledger.budgetCny)||ledger.budgetCny<=0||ledger.budgetCny>50||!Array.isArray(ledger.calls)||ledger.calls.some(call=>!Number.isFinite(call.committedCny)||call.committedCny<0))throw new Error('Invalid budget ledger; refusing to spend.');
      ledger.budgetCny=Math.min(ledger.budgetCny,budgetCny);
      const result=mutate(ledger);
      ledger.committedCny=ledger.calls.reduce((sum,call)=>sum+call.committedCny,0);
      writeFileSync(ledgerPath,JSON.stringify(ledger,null,2));
      return result;
    } finally {unlinkSync(lock);}
  };
  return async function budgetedFetch(endpoint,options) {
    const url=new URL(endpoint);
    if(url.origin!=='https://api.deepseek.com'||!['/chat/completions','/v1/chat/completions'].includes(url.pathname)||url.search||url.hash)throw new Error('Budget adapter refuses an unapproved destination.');
    const body=JSON.parse(options.body);
    const thinking=body.thinking?.type==='enabled';
    if(body.model!=='deepseek-flash'||body.stream||!['enabled','disabled'].includes(body.thinking?.type)||thinking&&!['low','high'].includes(body.reasoning_effort)||!Number.isSafeInteger(body.max_tokens)||body.max_tokens<1||body.max_tokens>(thinking?8192:2400))throw new Error('Budget adapter requires bounded DeepSeek Flash requests.');
    if(Object.keys(body).some(key=>!['model','messages','stream','thinking','reasoning_effort','response_format','max_tokens','temperature','top_p'].includes(key))||body.response_format&&body.response_format.type!=='json_object'||!Array.isArray(body.messages))throw new Error('Budget adapter refuses unbounded request parameters.');
    let images=0;
    const textOnly=JSON.stringify({...body,messages:body.messages.map(message=>({...message,content:Array.isArray(message.content)?message.content.map(part=>{
      if(part.type==='image_url'){
        if(!/^data:image\/(jpeg|png);base64,/.test(part.image_url?.url||''))throw new Error('Budget adapter accepts only bounded inline evidence images.');
        images++;return {type:'image_url'};
      }return part;
    }):message.content}))});
    const inputUpperTokens=Buffer.byteLength(textOnly)+images*1024+4096;
    const reservedCny=(inputUpperTokens*2+body.max_tokens*8)/1e6;
    const id=update(ledger=>{
      const committed=ledger.calls.reduce((sum,call)=>sum+call.committedCny,0);
      if(committed+reservedCny>ledger.budgetCny){const error=new Error('Dataset AI budget reached; no further request was sent.');error.code='DATASET_BUDGET_EXCEEDED';throw error;}
      const id=ledger.calls.length;
      ledger.calls.push({id,startedAt:new Date().toISOString(),images,inputUpperTokens,thinking:body.thinking.type,reasoningEffort:body.reasoning_effort||null,maxOutputTokens:body.max_tokens,temperature:body.temperature??null,reservedCny,committedCny:reservedCny,status:'reserved'});
      return id;
    });
    let response;
    try {response=await fetchImpl(endpoint,{...options,redirect:'error'});}
    catch(error){update(ledger=>{ledger.calls[id].status='transport-error';});throw error;}
    let usage;
    try {usage=(await response.clone().json()).usage;}catch{}
    update(ledger=>{
      const call=ledger.calls[id];call.status=response.ok?'completed':'http-error';call.httpStatus=response.status;
      if(response.ok&&Number.isSafeInteger(usage?.prompt_tokens)&&usage.prompt_tokens>=0&&Number.isSafeInteger(usage?.completion_tokens)&&usage.completion_tokens>=0){
        call.usage={promptTokens:usage.prompt_tokens,completionTokens:usage.completion_tokens};
        call.committedCny=(usage.prompt_tokens*2+usage.completion_tokens*8)/1e6;
      }
    });
    return response;
  };
}
