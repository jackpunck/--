import {HttpError} from './providers.mjs';
import {compactMotionAnalysis, MOTION_COACH_LIMITS} from '../public/motion-contract.js';
import {validateMotionPoseData, validateFullMotionAnalysis} from '../public/motion-pose-data.js';
import {completeFullMotionCoach} from './motion-coach-full.mjs';
import {completeTemporalMotionCoach} from './motion-coach-temporal.mjs';
import {completeVisualMotionCoach} from './motion-coach-visual.mjs';
import {completeGuidedMotionCoach} from './motion-coach-guided.mjs';
import {getMotionExercise} from '../public/motion-catalog.js';

export const MOTION_COACH_REQUEST_BYTES = 40 * 1024 * 1024;
const finite = value => typeof value === 'number' && Number.isFinite(value);

function imageDimensions(bytes, type) {
  if(type==='image/png') {
    if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')return null;
    return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  }
  if(bytes.length<16||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff||bytes.at(-2)!==0xff||bytes.at(-1)!==0xd9)return null;
  for(let offset=2;offset+3<bytes.length;) {
    if(bytes[offset++]!==0xff)return null;
    while(bytes[offset]===0xff)offset++;
    const marker=bytes[offset++];
    if(marker===0xda||marker===0xd9)return null;
    if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    if(offset+2>bytes.length)return null;
    const length=bytes.readUInt16BE(offset);
    if(length<2||offset+length>bytes.length)return null;
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if(length<8)return null;
      return {height:bytes.readUInt16BE(offset+3),width:bytes.readUInt16BE(offset+5)};
    }
    offset+=length;
  }
  return null;
}

/** Frames are transient request data: this endpoint never creates attachments. */
export function validateMotionCoachRequest(body) {
  if(body?.reviewMode!==undefined&&!['full','efficient','temporal','guided'].includes(body.reviewMode))throw new HttpError(400,'动作评估模式无效。');
  if(body?.reviewMode==='guided'&&(typeof body.selectedExerciseId!=='string'||!getMotionExercise(body.selectedExerciseId)))throw new HttpError(400,'请先选择有效的动作类型。');
  if(body?.selectedExerciseId!==undefined&&body.reviewMode!=='guided')throw new HttpError(400,'所选动作只能用于按动作类型评价。');
  if(body?.stream!==undefined&&typeof body.stream!=='boolean')throw new HttpError(400,'动作评价进度设置无效。');
  if(!body||typeof body!=='object'||Array.isArray(body)||!finite(body.duration)||body.duration<=0||body.duration>120)throw new HttpError(400,'请提供 120 秒以内视频的有效时长。');
  if(!body.poseData||!body.fullAnalysis)throw new HttpError(400,'请刷新页面并重新提取完整骨架数据后评估。');
  if(body.analysis!==undefined&&(!body.analysis||typeof body.analysis!=='object'||Array.isArray(body.analysis)))throw new HttpError(400,'动作数据格式无效。');
  if(Buffer.byteLength(JSON.stringify(body.analysis||{}))>MOTION_COACH_LIMITS.maxAnalysisBytes)throw new HttpError(413,'本地分析摘要过大，请缩短视频或精简摘要。');
  const supplied=body.keyframes??[];
  if(!Array.isArray(supplied)||supplied.length>MOTION_COACH_LIMITS.maxFrames)throw new HttpError(400,'一次最多发送 6 张关键帧。');
  if(!supplied.length)throw new HttpError(400,'动作评估需要关键截图，请重新提取视频画面。');
  let bytes=0;
  const times=new Set();
  const keyframes=supplied.map(frame=>{
    if(!frame||!finite(frame.time)||frame.time<0||frame.time>body.duration||times.has(frame.time))throw new HttpError(400,'关键帧时间须位于视频内且不能重复。');
    times.add(frame.time);
    if(!['image/jpeg','image/png'].includes(frame.mimeType)||typeof frame.data!=='string'||!frame.data.length||frame.data.length>Math.ceil(MOTION_COACH_LIMITS.maxFrameBytes/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(frame.data))throw new HttpError(400,'关键帧须为不超过 512 KB 的 JPEG 或 PNG 图片。');
    const decoded=Buffer.from(frame.data,'base64');
    if(decoded.length>MOTION_COACH_LIMITS.maxFrameBytes||decoded.toString('base64')!==frame.data)throw new HttpError(400,'关键帧编码或大小无效。');
    bytes+=decoded.length;
    if(bytes>MOTION_COACH_LIMITS.maxImageBytes)throw new HttpError(413,'关键帧合计不能超过 2 MB。');
    const dimensions=imageDimensions(decoded,frame.mimeType);
    if(!dimensions||dimensions.width<1||dimensions.height<1||Math.max(dimensions.width,dimensions.height)>1280)throw new HttpError(400,'关键帧图像无效或分辨率过大，请重新提取关键帧。');
    return {time:frame.time,mimeType:frame.mimeType,data:frame.data,...dimensions};
  });
  let poseData,fullAnalysis;
  try {
    poseData=validateMotionPoseData(body.poseData,{duration:body.duration});
    fullAnalysis=validateFullMotionAnalysis(body.fullAnalysis,{duration:body.duration});
  } catch(error){throw new HttpError(/超过.*MiB/.test(error.message)?413:400,error.message);}
  if(fullAnalysis.quality.totalFrames!==poseData.frameCount||fullAnalysis.measurements.length!==poseData.frames.length)throw new HttpError(400,'客观测量与骨架帧数不一致，请重新分析当前视频。');
  if(fullAnalysis.measurements.some((row,index)=>row.frameIndex!==index||Math.abs(row.time-poseData.frames[index].time)>0.000001))throw new HttpError(400,'客观测量与骨架时间不一致，请重新分析当前视频。');
  const analysis=compactMotionAnalysis({...body.analysis,quality:fullAnalysis.quality});
  return {duration:body.duration,analysis,keyframes,poseData,fullAnalysis,...(body.reviewMode?{reviewMode:body.reviewMode}:{}),...(body.reviewMode==='guided'?{selectedExerciseId:body.selectedExerciseId}:{}),...(body.stream===true?{stream:true}:{})};
}

/** Guided reviews use the user's selection; existing automatic routes remain compatible. */
export async function completeMotionCoach(options){
  if(options.input?.reviewMode==='guided')return completeGuidedMotionCoach(options);
  if(options.input?.reviewMode==='efficient')return completeVisualMotionCoach(options);
  if(options.input?.reviewMode==='temporal')return completeTemporalMotionCoach(options);
  return completeFullMotionCoach(options);
}
