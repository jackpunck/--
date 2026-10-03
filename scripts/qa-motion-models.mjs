// Real inference verifies model choice through decoder and GPU fallbacks.
// Uses a short copy of the fixture, a temporary database and no AI calls.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../server.mjs';

const root=process.cwd(),dataDir=await mkdtemp(join(root,'.qa/motion-models-'));
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||'.qa/browser-tools/node_modules/playwright/index.mjs')));
const ffmpeg=process.env.QA_FFMPEG||join(root,'.qa/motion-fixtures/qa-codecs/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
const clip=join(dataDir,'short.mp4');
await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-i',resolve(process.argv[2]||'.qa/motion-fixtures/squat.mp4'),'-t','0.4','-an','-vf','scale=480:-2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',clip],{windowsHide:true});
const server=await startServer({host:'127.0.0.1',port:0,dataDir});
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const worker=await readFile(join(root,'public/motion-worker.js'),'utf8');
const media=await readFile(join(root,'public/motion-media.js'),'utf8');
const cases=[
  {name:'parser-cpu',cpu:true,fail:'prepare-mp4',decoder:'html-video'},
  {name:'decoder-gpu',fail:'decode-mp4',decoder:'html-video'},
  {name:'software-cpu',cpu:true,software:true,decoder:'ffmpeg-direct'},
];
const results=[];
try {
  for(const config of cases)for(const model of ['heavy','full']){
    const context=await browser.newContext({serviceWorkers:'block'}),errors=[],external=[],assets=[];
    context.on('request',request=>{const url=request.url();if(/^https?:/.test(url)&&!url.startsWith(origin))external.push(url);if(url.endsWith('.task'))assets.push(url);});
    await context.route('**/model-qa.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><input type="file" id="clip">'}));
    await context.route('**/motion-worker.js',route=>route.fulfill({contentType:'text/javascript',body:worker+`
const actualHandler=self.onmessage;
self.onmessage=event=>{
  if((${JSON.stringify(config.cpu||false)}&&event.data.type==='init'&&event.data.delegate==='GPU')||event.data.type===${JSON.stringify(config.fail||'none')})self.postMessage({id:event.data.id,error:'QA: unavailable delegate or decoder'});
  else actualHandler(event);
};`}));
    if(config.software){
      assert(media.includes('metadata = await readPlayableMetadata(file, signal);'));
      await context.route('**/motion-media.js',route=>route.fulfill({contentType:'text/javascript',body:media.replace('metadata = await readPlayableMetadata(file, signal);','throw Object.assign(new Error("QA: unsupported native codec"),{code:"MOTION_VIDEO_DECODE"});')}));
    }
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/model-qa.html');await page.locator('#clip').setInputFiles(clip);
    const result=await page.evaluate(async model=>{
      const {analyzeVideo}=await import('/motion-video.js');
      const {buildMotionPoseData}=await import('/motion-pose-data.js');
      const output=await analyzeVideo(document.querySelector('#clip').files[0],{model});
      return {modelVersion:output.modelVersion,aiModelVersion:buildMotionPoseData(output).modelVersion,decoder:output.decoder,delegate:output.delegate,frames:output.frames.length,expectedFrames:Math.ceil(output.duration*15),landmarkFrames:output.frames.filter(frame=>frame.landmarks.length===33).length};
    },model);
    assert.match(result.modelVersion,model==='heavy'?/Heavy float16/:/Full float16/);
    assert.equal(result.aiModelVersion,result.modelVersion);
    assert.equal(result.decoder,config.decoder);
    assert.equal(result.delegate,config.cpu?'CPU':'GPU');
    assert.equal(result.frames,result.expectedFrames);assert(result.landmarkFrames>0);
    assert(assets.some(url=>url.endsWith(`pose_landmarker_${model}.task`)));
    assert(assets.every(url=>url.endsWith(`pose_landmarker_${model}.task`)),'Fallback must preserve the chosen model');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    results.push({case:config.name,model,...result});console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
  await writeFile(join(dataDir,'results.json'),JSON.stringify({results},null,2));
  console.log('QA artifacts:',dataDir);
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
