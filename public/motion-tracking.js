const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = value => Math.max(0, Math.min(1, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mean = points => ({ x: points.reduce((sum,p)=>sum+p.x,0)/points.length, y: points.reduce((sum,p)=>sum+p.y,0)/points.length });
const visible = point => point && finite(point.x) && finite(point.y) && point.x>=0 && point.x<=1 && point.y>=0 && point.y<=1 && (point.visibility ?? 1) >= .45 && (point.presence ?? 1) >= .45;
const limbPairs = [[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28]];

export function validateTargetPoint(point) {
  if (point == null) return null;
  if (typeof point !== 'object' || !finite(point.x) || !finite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) throw new Error('请选择视频画面内的训练者位置。');
  return { x: point.x, y: point.y };
}

function candidateFeatures(landmarks, index) {
  if (!Array.isArray(landmarks)) return null;
  const shoulders = [landmarks[11],landmarks[12]].filter(visible), hips = [landmarks[23],landmarks[24]].filter(visible);
  const body = landmarks.slice(11,33).filter(visible);
  if (!shoulders.length || !hips.length || body.length < 6) return null;
  const shoulder = mean(shoulders), hip = mean(hips), scale = distance(shoulder, hip);
  if (scale < .025) return null;
  const anchor = mean([shoulder,hip]);
  const lengths = limbPairs.map(([a,b])=>visible(landmarks[a])&&visible(landmarks[b])?distance(landmarks[a],landmarks[b])/scale:null);
  const silhouette=landmarks.filter(visible);
  const bbox = { xMin:clamp(Math.min(...silhouette.map(p=>p.x))), yMin:clamp(Math.min(...silhouette.map(p=>p.y))), xMax:clamp(Math.max(...silhouette.map(p=>p.x))), yMax:clamp(Math.max(...silhouette.map(p=>p.y))) };
  return { index, anchor, scale, lengths, bbox, orientation:Math.atan2(shoulder.y-hip.y,shoulder.x-hip.x) };
}
const orientationDistance=(a,b)=>Math.abs(Math.atan2(Math.sin(a.orientation-b.orientation),Math.cos(a.orientation-b.orientation)));

function geometryDistance(a,b) {
  const differences = a.lengths.map((value,index)=>finite(value)&&finite(b.lengths[index])?Math.min(1,Math.abs(Math.log((value+.05)/(b.lengths[index]+.05)))):null).filter(finite);
  return differences.length ? differences.reduce((sum,value)=>sum+value,0)/differences.length : .2;
}

/** Crop coordinates and pose points always refer back to the original frame. */
export function targetDetectionCrop({bbox,point}={}) {
  if(bbox) {
    const width=Math.max(.3,(bbox.xMax-bbox.xMin)*1.65),height=Math.max(.5,(bbox.yMax-bbox.yMin)*1.35);
    const x=(bbox.xMin+bbox.xMax)/2,y=(bbox.yMin+bbox.yMax)/2;
    return {xMin:clamp(x-width/2),yMin:clamp(y-height/2),xMax:clamp(x+width/2),yMax:clamp(y+height/2)};
  }
  if(point) return {xMin:clamp(point.x-.23),yMin:clamp(point.y-.48),xMax:clamp(point.x+.23),yMax:clamp(point.y+.48)};
  return null;
}

export function mapCropLandmarks(landmarks,crop) {
  return (landmarks||[]).map(point=>({...point,x:crop.xMin+point.x*(crop.xMax-crop.xMin),y:crop.yMin+point.y*(crop.yMax-crop.yMin),z:finite(point.z)?point.z*(crop.xMax-crop.xMin):point.z,...(point.x<0||point.x>1||point.y<0||point.y>1?{visibility:0,presence:0}:{})}));
}

/** Discovery must not reinterpret the limbs of an already detected person as
 * another body. This mask is only for finding additional people; the global
 * pass and selected-target region always retain the original image pixels. */
export function knownPersonRegions(poses) {
  return (poses||[]).map((points,index)=>({points,feature:candidateFeatures(points,index)}))
    .filter(({points,feature})=>feature&&points.slice(11,33).filter(p=>visible(p)&&(p.visibility??1)>=.65).length>=10)
    .map(({feature:{bbox}})=>({xMin:clamp(bbox.xMin-.015),yMin:clamp(bbox.yMin-.015),xMax:clamp(bbox.xMax+.015),yMax:clamp(bbox.yMax+.015)}));
}

/** Deduplicate different detector passes, never two people from the same pass. */
export function mergePoseCandidates(groups) {
  const merged=[];
  const reliableIndices=[11,12,13,14,15,16,23,24,25,26,27,28];
  const quality=points=>points.slice(11,33).filter(p=>visible(p)&&(p.visibility??1)>=.65).length;
  const containsReliableBody=(crop,points)=>!crop||points.filter(p=>visible(p)&&(p.visibility??1)>=.65).every(p=>p.x>=crop.xMin&&p.x<=crop.xMax&&p.y>=crop.yMin&&p.y<=crop.yMax);
  const sameObservation=(item,landmarks,feature,crop)=>{
    const scale=Math.max(item.feature.scale,feature.scale);
    if(distance(item.feature.anchor,feature.anchor)>scale*.5||Math.abs(Math.log(item.feature.scale/feature.scale))>.6)return false;
    if(distance(item.feature.anchor,feature.anchor)<Math.min(item.feature.scale,feature.scale)*.32&&Math.abs(Math.log(item.feature.scale/feature.scale))<.32&&geometryDistance(item.feature,feature)<.32)return true;
    const inside=(point,region)=>!region||(point.x>=region.xMin&&point.x<=region.xMax&&point.y>=region.yMin&&point.y<=region.yMax);
    const common=reliableIndices.filter(i=>visible(item.landmarks[i])&&visible(landmarks[i])&&inside(item.landmarks[i],crop)&&inside(landmarks[i],item.crop)&&Math.min(item.landmarks[i].visibility??1,landmarks[i].visibility??1)>=.6);
    const matching=common.filter(i=>distance(item.landmarks[i],landmarks[i])<=scale*.45);
    // Partially occluded full-frame predictions can distort the torso while a
    // crop resolves it. Require several aligned torso AND limb observations.
    return matching.length>=5&&matching.filter(i=>[11,12,23,24].includes(i)).length>=3&&matching.some(i=>![11,12,23,24].includes(i))&&common.reduce((sum,i)=>sum+distance(item.landmarks[i],landmarks[i]),0)/common.length<=scale*.32;
  };
  groups.forEach((group,source)=>{
    const used=new Set();
    for(let index=0;index<(group.landmarks||[]).length;index++) {
      const landmarks=group.landmarks[index],feature=candidateFeatures(landmarks,index);
      if(!feature)continue;
      const duplicate=merged.findIndex((item,i)=>!used.has(i)&&item.sources.every(existing=>existing!==source)&&sameObservation(item,landmarks,feature,group.crop));
      if(duplicate>=0){const item=merged[duplicate];item.sources.push(source);if(quality(landmarks)>quality(item.landmarks)+2&&containsReliableBody(group.crop,item.landmarks))Object.assign(item,{landmarks,worldLandmarks:group.worldLandmarks?.[index]||[],feature,crop:group.crop});used.add(duplicate);}
      else {merged.push({landmarks,worldLandmarks:group.worldLandmarks?.[index]||[],feature,crop:group.crop,sources:[source]});used.add(merged.length-1);}
    }
  });
  return {landmarks:merged.map(item=>item.landmarks),worldLandmarks:merged.map(item=>item.worldLandmarks)};
}

/** A spatial continuity tracker, not biometric identification. Never reselect a
 * new central person after the original target is lost or a crossing is ambiguous. */
export function createSubjectTracker({ targetPoint=null }={}) {
  const point=validateTargetPoint(targetPoint), trackId='motion-target-1';
  let previous, previousTime, velocity={x:0,y:0}, halted;
  const missing = (status,reason) => ({index:null,subjectTracking:{status,trackId,confidence:0,reason}});
  return {
    update(poses,time) {
      if(!finite(time)||time<0)throw new Error('人物跟踪时间无效。');
      if(halted)return missing(halted.status,halted.reason);
      const candidates=(Array.isArray(poses)?poses:[]).map(candidateFeatures).filter(Boolean);
      if(!previous) {
        if(!candidates.length)return missing('lost','no-visible-target');
        const target=point||{x:.5,y:.5};
        // Point selection must actually be near that person's visible body.
        const eligible=point?candidates.filter(candidate=>point.x>=candidate.bbox.xMin-.04&&point.x<=candidate.bbox.xMax+.04&&point.y>=candidate.bbox.yMin-.04&&point.y<=candidate.bbox.yMax+.04):candidates;
        if(!eligible.length)return missing('lost','selected-point-has-no-person');
        const ranked=eligible.map(candidate=>({candidate,cost:distance(candidate.anchor,target)})).sort((a,b)=>a.cost-b.cost);
        if(point&&ranked.length>1)return missing('ambiguous','selected-point-overlapping-people');
        if(ranked.length>1&&ranked[1].cost-ranked[0].cost<Math.max(.045,ranked[0].candidate.scale*.25))return missing('ambiguous','initial-target-ambiguous');
        previous=ranked[0].candidate;previousTime=time;
        return {index:previous.index,subjectTracking:{status:'locked',trackId,confidence:.9,bbox:previous.bbox}};
      }
      const elapsed=time-previousTime;
      if(elapsed<0)throw new Error('人物跟踪时间必须递增。');
      if(elapsed>.8){halted={status:'lost',reason:'target-lost-retry-selection'};return missing(halted.status,halted.reason);}
      if(!candidates.length)return missing('lost','no-visible-target');
      const predicted={x:previous.anchor.x+velocity.x*Math.min(elapsed,.2),y:previous.anchor.y+velocity.y*Math.min(elapsed,.2)};
      const ranked=candidates.map(candidate=>{
        const position=distance(candidate.anchor,predicted)/previous.scale;
        const scale=Math.abs(Math.log(candidate.scale/previous.scale));
        const geometry=geometryDistance(candidate,previous);
        const orientation=orientationDistance(candidate,previous);
        return {candidate,position,scale,geometry,orientation,cost:position+.65*scale+.35*geometry+.35*orientation};
      }).filter(match=>match.position<.65+Math.min(elapsed,.4)*1.4&&match.scale<.5&&match.geometry<.65&&match.orientation<1).sort((a,b)=>a.cost-b.cost);
      if(!ranked.length)return missing('lost','target-continuity-lost');
      const best=ranked[0],rival=ranked[1];
      const closeOther=ranked.find(match=>match!==best&&match.cost-best.cost<.35&&match.orientation<.65&&match.geometry<.35&&Math.abs(Math.log(match.candidate.scale/best.candidate.scale))<.45&&distance(match.candidate.anchor,best.candidate.anchor)<Math.min(match.candidate.scale,best.candidate.scale)*.65);
      if((rival&&rival.cost-best.cost<.22)||closeOther){
        // After an unresolved crossing these landmarks cannot prove identity.
        // Requiring a new run is safer than resuming on the other person's path.
        halted={status:'ambiguous',reason:'overlapping-targets-retry-selection'};
        return missing(halted.status,halted.reason);
      }
      const confidence=clamp(.98-best.cost*.25-(elapsed>.2?.12:0));
      if(confidence<.65)return missing('lost','target-match-uncertain');
      const dt=Math.max(.04,elapsed);
      const nextVelocity={x:(best.candidate.anchor.x-previous.anchor.x)/dt,y:(best.candidate.anchor.y-previous.anchor.y)/dt};
      velocity={x:velocity.x*.5+nextVelocity.x*.5,y:velocity.y*.5+nextVelocity.y*.5};
      previous=best.candidate;previousTime=time;
      return {index:previous.index,subjectTracking:{status:'locked',trackId,confidence:Math.round(confidence*1000)/1000,bbox:previous.bbox}};
    },
  };
}

export function summarizeTargetTracking(frames,{targetPoint=null}={}) {
  const point=validateTargetPoint(targetPoint),totalFrames=frames.length;
  const lockedFrames=frames.filter(frame=>frame.subjectTracking?.status==='locked'&&frame.subjectTracking.confidence>=.65).length;
  const ambiguousFrames=frames.filter(frame=>frame.subjectTracking?.status==='ambiguous').length;
  const lostFrames=totalFrames-lockedFrames-ambiguousFrames;
  return {mode:point?'point':'center',point,trackId:'motion-target-1',coverage:totalFrames?lockedFrames/totalFrames:0,lockedFrames,ambiguousFrames,lostFrames,totalFrames,maxPeople:frames.reduce((max,frame)=>Math.max(max,frame.personCount||0),0),
    summary:ambiguousFrames?'目标与其他人接近或重叠，身份无法持续确认；不确定帧未计分，请裁剪或重新点选训练者。':lostFrames?'部分画面未能可靠跟踪同一位训练者，丢失帧未计分。':'已连续跟踪选中的训练者；背景人物不参与评分。'};
}
