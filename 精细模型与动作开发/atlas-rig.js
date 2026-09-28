import * as THREE from 'three';
import regions from './assets/anatomy-regions.json' with {type:'json'};
import {staticPoseProfiles} from './static-poses.js';

const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const X=V(1,0,0),Z=V(0,0,1);
const smooth=(a,b,x)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const mix=(a,b,t)=>[[a,1-t],[b,t]];

// Anatomical geometry is CC BY-SA 4.0 (Z-Anatomy / BodyParts3D).
// This is a manually defined teaching rig with spatial skin weights, not a
// physiological muscle-force or volume-conserving soft-tissue simulation.
export function createAtlasRig(body,sources){
  const bones=[],map={},rest={},fingers={};
  function add(name,p){const b=new THREE.Bone();b.name=name;b.position.copy(p);b.userData.index=bones.length;rest[name]=p.clone();bones.push(b);map[name]=b;body.add(b);return name;}
  add('pelvis',V(0,1.60,-.06));add('spine',V(0,1.99,-.06));add('chest',V(0,2.40,-.06));add('head',V(0,2.78,-.06));
  const joints={};
  const ordinal=['first','second','third','fourth','fifth'];
  for(const sign of [-1,1]){
    const side=sign===1?'l':'r';
    const j=joints[side]={hip:V(sign*.168,1.60,-.06),knee:V(sign*.153,.80,-.055),ankle:V(sign*.14,.155,-.075),shoulder:V(sign*.31,2.56,-.058),elbow:V(sign*.423,2.025,-.060),wrist:V(sign*.51,1.59,.005)};
    for(const [name,point] of [['upper',j.shoulder],['forearm',j.elbow],['hand',j.wrist],['thigh',j.hip],['shin',j.knee],['foot',j.ankle],['patella',j.knee]])add(name+'.'+side,point);
    fingers[side]=[];
    for(let f=0;f<5;f++){
      const chain=[];
      for(const part of ['Proximal','Middle','Distal']){
        const name=`${part} phalanx of ${ordinal[f]} finger of hand.${side}`;
        const source=sources.find(s=>s.item.name===name);if(!source)continue;
        const p=source.geometry.attributes.position;let hi=-Infinity,lo=Infinity;
        for(let i=0;i<p.count;i++){hi=Math.max(hi,p.getY(i));lo=Math.min(lo,p.getY(i));}
        const top=V(),bottom=V();let nt=0,nb=0;
        for(let i=0;i<p.count;i++){const v=V().fromBufferAttribute(p,i);if(v.y>hi-(hi-lo)*.22){top.add(v);nt++;}if(v.y<lo+(hi-lo)*.22){bottom.add(v);nb++;}}
        top.divideScalar(nt);bottom.divideScalar(nb);
        const bone=add(`finger${f}-${chain.length}.${side}`,top);
        chain.push({bone,top,bottom,source:name});
      }
      fingers[side].push(chain);
    }
  }
  body.updateMatrixWorld(true);const skeleton=new THREE.Skeleton(bones);skeleton.calculateInverses();
  function fingerWeights(p,side,rigidName){
    const chains=fingers[side];
    if(rigidName){for(const chain of chains)for(const segment of chain)if(segment.source===rigidName)return [[segment.bone,1]];}
    let best=null,dist=Infinity;
    for(const chain of chains){
      for(let i=0;i<chain.length;i++){
        const s=chain[i],line=new THREE.Line3(s.top,s.bottom),point=line.closestPointToPoint(p,true,V()),d=point.distanceToSquared(p);
        if(d<dist){dist=d;best={chain,index:i};}
      }
    }
    const {chain,index}=best,seg=chain[index],parent=index?chain[index-1].bone:'hand.'+side;
    if(index===0&&p.y>seg.top.y+.025)return [['hand.'+side,1]];
    const t=1-smooth(seg.top.y-.025,seg.top.y+.02,p.y);
    return mix(parent,seg.bone,t);
  }
  function skinWeights(p,item){
    const n=item.name.toLowerCase(),side=p.x>=0?'l':'r',y=p.y,x=Math.abs(p.x),suffix='.'+side;
    const region=regions[item.name];
    if(item.kind==='bone'){
      if(n.startsWith('humerus'))return [['upper'+suffix,1]];
      if(n.startsWith('ulna')||n.startsWith('radius'))return [['forearm'+suffix,1]];
      if(n.startsWith('femur'))return [['thigh'+suffix,1]];
      if(n.startsWith('tibia')||n.startsWith('fibula'))return [['shin'+suffix,1]];
      if(n.startsWith('patella'))return [['patella'+suffix,1]];
      if(n.startsWith('hip bone')||n==='sacrum'||n==='coccyx')return [['pelvis',1]];
      if(region==='arm'&&y<1.65){if(n.includes('phalanx')&&n.includes('hand'))return fingerWeights(p,side,item.name);return [['hand'+suffix,1]];}
      if(region==='leg'&&y<.28)return [['foot'+suffix,1]];
      const center=item.rigCenterY;
      return [[center>2.74?'head':center>2.20?'chest':center>1.80?'spine':'pelvis',1]];
    }
    if(region==='trunk'&&/pectoralis|latissimus/.test(n))return mix('chest','upper'+suffix,smooth(.22,.39,x)*smooth(2.28,2.52,y));
    if(region==='arm'){
      if(y<1.46)return fingerWeights(p,side);
      if(y<1.66)return mix('hand'+suffix,'forearm'+suffix,smooth(1.535,1.65,y));
      if(y<2.16)return mix('forearm'+suffix,'upper'+suffix,smooth(1.95,2.10,y));
      return mix('chest','upper'+suffix,1-(1-smooth(.225,.39,x))*smooth(2.28,2.53,y));
    }
    if(region==='leg'){
      if(y<.23)return mix('foot'+suffix,'shin'+suffix,smooth(.115,.22,y));
      if(y<.92)return mix('shin'+suffix,'thigh'+suffix,smooth(.735,.895,y));
      return mix('thigh'+suffix,'pelvis',smooth(1.37,1.74,y));
    }
    if(y>2.61)return mix('chest','head',smooth(2.65,2.85,y));
    if(y>2.08)return mix('spine','chest',smooth(2.08,2.4,y));
    return mix('pelvis','spine',smooth(1.64,2.08,y));
  }
  function bindGeometry(geometry,item){
    geometry.computeBoundingBox();item={...item,rigCenterY:(geometry.boundingBox.min.y+geometry.boundingBox.max.y)*.5};
    const p=geometry.attributes.position,indices=new Uint16Array(p.count*4),weights=new Float32Array(p.count*4),v=V();
    for(let i=0;i<p.count;i++){
      v.fromBufferAttribute(p,i);const influences=skinWeights(v,item);
      for(let k=0;k<influences.length;k++){indices[i*4+k]=map[influences[k][0]].userData.index;weights[i*4+k]=influences[k][1];}
    }
    geometry.setAttribute('skinIndex',new THREE.BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new THREE.BufferAttribute(weights,4));
  }
  const weights=[];
  for(const side of ['r','l']){
    const dumbbell=new THREE.Group();dumbbell.name='Dumbbell '+side;dumbbell.userData.prop=true;
    const metal=new THREE.MeshStandardMaterial({color:'#393f3b',metalness:.6,roughness:.35});
    const grip=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.27,16),metal);grip.rotation.z=Math.PI/2;dumbbell.add(grip);
    for(const x of [-.155,.155]){const plate=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,.09,24),metal);plate.rotation.z=Math.PI/2;plate.position.x=x;plate.castShadow=true;dumbbell.add(plate);}
    body.add(dumbbell);weights.push(dumbbell);
  }
  function transform(name,position,rotation){map[name].position.copy(position);map[name].quaternion.copy(rotation);}
  function segment(name,a,b,ra,rb){transform(name,a,new THREE.Quaternion().setFromUnitVectors(rb.clone().sub(ra).normalize(),b.clone().sub(a).normalize()));}
  function rigidPoint(p,bone){return p.clone().sub(rest[bone]).applyQuaternion(map[bone].quaternion).add(map[bone].position);}
  function reset(){for(const b of bones){b.position.copy(rest[b.name]);b.quaternion.identity();}weights.forEach(w=>w.visible=false);if(staticProps)staticProps.visible=false;body.updateMatrixWorld(true);skeleton.update();}
  function elbowIK(s,w,l1,l2,sign){
    const delta=w.clone().sub(s),d=delta.length(),dir=delta.normalize();
    const along=(l1*l1-l2*l2+d*d)/(2*d),h=Math.sqrt(Math.max(0,l1*l1-along*along));
    const bend=V(sign*.55,0,-.83);bend.addScaledVector(dir,-bend.dot(dir)).normalize();
    return s.clone().addScaledVector(dir,along).addScaledVector(bend,h);
  }
  const poseJoints={};
  function pose(progress,exercise){
    if(!['squat','pushup','curl'].includes(exercise))return staticPose(exercise);
    if(staticProps)staticProps.visible=false;
    const q=THREE.MathUtils.clamp(progress,0,1),push=exercise==='pushup',squat=exercise==='squat'?q:0;
    const ref=joints.l,thighLength=ref.hip.distanceTo(ref.knee),shinLength=ref.knee.distanceTo(ref.ankle),upperLength=ref.shoulder.distanceTo(ref.elbow),foreLength=ref.elbow.distanceTo(ref.wrist);
    let hip,bodyAngle;
    const kneeY=.155+shinLength*Math.cos(.02+squat*.38),kneeZ=-.075+shinLength*Math.sin(.02+squat*.38);
    const thighPlanar=Math.sqrt(thighLength**2-(.24-.168)**2);
    if(push){bodyAngle=Math.PI/2-(.065+.263*(1-q));hip=V(0,.327,-1.18).add(V(0,thighLength+shinLength,0).applyAxisAngle(X,bodyAngle));}
    else {bodyAngle=squat*.5;hip=exercise==='curl'?rest.pelvis.clone():V(0,kneeY+thighPlanar*Math.cos(.045+squat*1.12),kneeZ-thighPlanar*Math.sin(.045+squat*1.12));}
    const rotation=new THREE.Quaternion().setFromAxisAngle(X,bodyAngle);
    const pelvisRotation=new THREE.Quaternion().setFromAxisAngle(X,push?bodyAngle:bodyAngle*.55);
    transform('pelvis',hip,pelvisRotation);
    for(const name of ['spine','chest','head'])transform(name,rest[name].clone().sub(rest.pelvis).applyQuaternion(rotation).add(hip),rotation);
    for(const sign of [-1,1]){
      const side=sign===1?'l':'r',suffix='.'+side,r=joints[side];
      const h=r.hip.clone().sub(rest.pelvis).applyQuaternion(pelvisRotation).add(hip);
      let a,k;
      if(push){a=V(sign*.14,.327,-1.18);k=a.clone().add(V(0,shinLength,0).applyQuaternion(rotation));}
      else if(exercise==='curl'){a=r.ankle.clone();k=r.knee.clone();}
      else {a=V(sign*.24,.155,-.075);k=V(sign*.24,kneeY,kneeZ);}
      segment('thigh'+suffix,h,k,r.hip,r.knee);segment('shin'+suffix,k,a,r.knee,r.ankle);
      transform('patella'+suffix,k,map['thigh'+suffix].quaternion.clone().slerp(map['shin'+suffix].quaternion,.5));
      transform('foot'+suffix,a,new THREE.Quaternion().setFromEuler(new THREE.Euler(push?.75:0,0,0)));
      const s=r.shoulder.clone().sub(rest.pelvis).applyQuaternion(rotation).add(hip);
      let e,w,handRotation;
      if(push){w=V(sign*.45,.12,1.13);e=elbowIK(s,w,upperLength,foreLength,sign);handRotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2,0,Math.PI));}
      else if(exercise==='curl'){e=r.elbow.clone();w=r.wrist.clone().sub(r.elbow).applyAxisAngle(X,-2.0*q).add(e);}
      else {e=s.clone().add(V(sign*.025,-upperLength*Math.cos(.40+q*.65),upperLength*Math.sin(.40+q*.65)));w=e.clone().add(V(0,-foreLength*Math.cos(1.2+q*.2),foreLength*Math.sin(1.2+q*.2)));}
      segment('upper'+suffix,s,e,r.shoulder,r.elbow);segment('forearm'+suffix,e,w,r.elbow,r.wrist);
      handRotation ||= map['forearm'+suffix].quaternion.clone();transform('hand'+suffix,w,handRotation);
      for(let f=0;f<5;f++){
        const chain=fingers[side][f];let parent='hand'+suffix;
        for(let i=0;i<chain.length;i++){
          const seg=chain[i],position=rigidPoint(seg.top,parent);
          const flex=exercise==='curl'?(f===0?.65:[.85,1.05,.65][i]):push?(i===0?-.40:-.10):.16;
          const rotation=map[parent].quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(X,-flex));
          if(f===0&&exercise==='curl')rotation.multiply(new THREE.Quaternion().setFromAxisAngle(Z,-sign*.30));
          transform(seg.bone,position,rotation);parent=seg.bone;
        }
      }
      const weight=weights[sign===-1?0:1];weight.visible=exercise==='curl';
      weight.position.copy(rigidPoint(r.wrist.clone().add(V(-sign*.015,-.165,.12)),'hand'+suffix));weight.quaternion.copy(handRotation);
      poseJoints[side]={hip:h,knee:k,ankle:a,shoulder:s,elbow:e,wrist:w};
    }
    body.updateMatrixWorld(true);skeleton.update();
  }
  const staticProps=new THREE.Group();staticProps.userData.prop=true;staticProps.name='Static exercise equipment schematic';body.add(staticProps);
  const propMaterial=new THREE.MeshStandardMaterial({color:'#526257',roughness:.75});
  const pad=new THREE.Mesh(new THREE.BoxGeometry(.72,.15,1.95),propMaterial);pad.castShadow=true;pad.receiveShadow=true;staticProps.add(pad);
  const uprights=[];
  for(const x of [-.25,.25])for(const z of [-.72,.72]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.07,.8,.07),propMaterial);leg.userData.supportCorner={x,z};staticProps.add(leg);uprights.push(leg);}
  const bar=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,1.4,12),propMaterial);bar.rotation.z=Math.PI/2;staticProps.add(bar);
  const cables=[];
  for(let i=0;i<2;i++){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(),V()]),new THREE.LineBasicMaterial({color:'#71867a'}));staticProps.add(line);cables.push(line);}
  function staticPose(exercise){
    const profile=staticPoseProfiles[exercise];if(!profile){reset();return false;}
    reset();let holdCenter=null;
    if(profile.base){
      pose(profile.q??.25,profile.base==='plank'?'pushup':profile.base);
      if(profile.base==='plank')for(const sign of [-1,1]){
        const side=sign===1?'l':'r',r=joints[side],s=poseJoints[side].shoulder;
        const e=V(sign*.32,.20,s.z),w=e.clone().add(V(0,0,.44));
        segment('upper.'+side,s,e,r.shoulder,r.elbow);segment('forearm.'+side,e,w,r.elbow,r.wrist);transform('hand.'+side,w,new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2,0,Math.PI)));
        poseJoints[side].elbow=e;poseJoints[side].wrist=w;
      }
    }else{
      const hip=profile.hip?V(...profile.hip):rest.pelvis.clone(),rotation=new THREE.Quaternion().setFromAxisAngle(X,profile.torso||0);
      transform('pelvis',hip,rotation);
      for(const name of ['spine','chest','head'])transform(name,rest[name].clone().sub(rest.pelvis).applyQuaternion(rotation).add(hip),rotation);
      for(const sign of [-1,1]){
        const side=sign===1?'l':'r',suffix='.'+side,r=joints[side];
        const h=r.hip.clone().sub(rest.pelvis).add(hip);
        const thighAngle=sign===-1?(profile.rightThigh??profile.thigh??0):(profile.thigh??0),shinAngle=sign===-1?(profile.rightShin??profile.shin??0):(profile.shin??0);
        const k=h.clone().add(V(0,-r.hip.distanceTo(r.knee),0).applyAxisAngle(X,thighAngle));
        const a=k.clone().add(V(0,-r.knee.distanceTo(r.ankle),0).applyAxisAngle(X,shinAngle));
        segment('thigh'+suffix,h,k,r.hip,r.knee);segment('shin'+suffix,k,a,r.knee,r.ankle);
        transform('patella'+suffix,k,map['thigh'+suffix].quaternion.clone().slerp(map['shin'+suffix].quaternion,.5));
        transform('foot'+suffix,a,new THREE.Quaternion().setFromAxisAngle(X,profile.footAngle||0));
        const s=r.shoulder.clone().sub(rest.pelvis).applyQuaternion(rotation).add(hip);
        const upper=sign===1?(profile.leftUpper??profile.upper):(profile.upper),fore=sign===1?(profile.leftFore??profile.fore):(profile.fore);
        const dir=values=>V(sign*values[0],values[1],values[2]).normalize().applyQuaternion(rotation);
        const e=s.clone().addScaledVector(dir(upper||[.1,-1,0]),r.shoulder.distanceTo(r.elbow));
        const w=e.clone().addScaledVector(dir(fore||[0,-1,0]),r.elbow.distanceTo(r.wrist));
        segment('upper'+suffix,s,e,r.shoulder,r.elbow);segment('forearm'+suffix,e,w,r.elbow,r.wrist);
        const handRotation=map['forearm'+suffix].quaternion.clone();if(profile.hammer)handRotation.multiply(new THREE.Quaternion().setFromAxisAngle(V(0,1,0),sign*Math.PI/2));
        transform('hand'+suffix,w,handRotation);poseJoints[side]={hip:h,knee:k,ankle:a,shoulder:s,elbow:e,wrist:w};
      }
    }
    function placeArm(side,e,w,handRotation){
      const r=joints[side],s=poseJoints[side].shoulder;
      segment('upper.'+side,s,e,r.shoulder,r.elbow);segment('forearm.'+side,e,w,r.elbow,r.wrist);transform('hand.'+side,w,handRotation);
      poseJoints[side].elbow=e;poseJoints[side].wrist=w;
    }
    if(exercise==='dumbbell-row'){
      const r=joints.l,s=poseJoints.l.shoulder,handRotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2,0,Math.PI));
      const w=V(.50,1.40,.30).sub(V(-.015,-.165,.12).applyQuaternion(handRotation));
      placeArm('l',elbowIK(s,w,r.shoulder.distanceTo(r.elbow),r.elbow.distanceTo(r.wrist),1),w,handRotation);
    }
    if(exercise==='glute-bridge'){
      transform('head',V(0,.21,-1.21),new THREE.Quaternion().setFromAxisAngle(X,-Math.PI/2));
      for(const sign of [-1,1]){
        const side=sign===1?'l':'r',s=poseJoints[side].shoulder;
        const e=s.clone().add(V(sign*.12,.17-s.y,.52)),w=e.clone().add(V(sign*.03,0,.44));
        placeArm(side,e,w,new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2,0,Math.PI)));
      }
    }
    if(['single','goblet'].includes(profile.weights)){
      holdCenter=profile.weights==='goblet'?rigidPoint(V(0,2.13,.28),'chest'):V(0,2.87,-.45);
      for(const sign of [-1,1]){
        const side=sign===1?'l':'r',r=joints[side],s=poseJoints[side].shoulder;
        const handRotation=new THREE.Quaternion().setFromAxisAngle(Z,-sign*Math.PI/2);
        const palm=holdCenter.clone().add(V(sign*.11,.12,0)),w=palm.sub(V(-sign*.015,-.165,.12).applyQuaternion(handRotation));
        let e;
        if(profile.weights==='single'){
          const delta=w.clone().sub(s),distance=delta.length(),direction=delta.normalize(),l1=r.shoulder.distanceTo(r.elbow),l2=r.elbow.distanceTo(r.wrist);
          const along=(l1*l1-l2*l2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
          const bend=V(0,1,0).addScaledVector(direction,-direction.y).normalize();e=s.clone().addScaledVector(direction,along).addScaledVector(bend,height);
        }else e=elbowIK(s,w,r.shoulder.distanceTo(r.elbow),r.elbow.distanceTo(r.wrist),sign);
        placeArm(side,e,w,handRotation);
      }
    }
    for(const sign of [-1,1]){
      const side=sign===1?'l':'r',suffix='.'+side;
      for(const chain of fingers[side]){let parent='hand'+suffix;for(const seg of chain){const position=rigidPoint(seg.top,parent),rotation=map[parent].quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(X,profile.weights?-.8:-.10));transform(seg.bone,position,rotation);parent=seg.bone;}}
      const weight=weights[sign===-1?0:1];weight.visible=Boolean(profile.weights)&&(profile.weights!=='right'||sign===-1);
      weight.position.copy(rigidPoint(joints[side].wrist.clone().add(V(-sign*.015,-.165,.12)),'hand'+suffix));weight.quaternion.copy(map['hand'+suffix].quaternion);
    }
    if(['single','goblet'].includes(profile.weights)){
      weights[1].visible=false;weights[0].position.copy(holdCenter);weights[0].quaternion.setFromAxisAngle(Z,Math.PI/2);
    }
    staticProps.visible=Boolean(profile.support||profile.bar||profile.cable);
    pad.visible=Boolean(profile.support);uprights.forEach(leg=>leg.visible=Boolean(profile.support));
    pad.rotation.set(0,0,0);pad.position.set(0,.70,-.55);pad.scale.set(1,1,1);
    if(profile.support==='incline'){pad.rotation.x=Math.PI/6;pad.position.set(0,1.13,-.55);}
    if(profile.support==='seat'){pad.scale.z=.4;pad.position.set(0,.65,.1);}
    if(profile.support==='side')pad.position.set(.5,1.3,.3);
    uprights.forEach(leg=>{const corner=leg.userData.supportCorner,top=V(corner.x,-.075,corner.z*pad.scale.z).applyQuaternion(pad.quaternion).add(pad.position);leg.position.set(top.x,top.y/2,top.z);leg.scale.y=top.y/.8;});
    bar.visible=Boolean(profile.bar);bar.position.copy(poseJoints.l.wrist).add(poseJoints.r.wrist).multiplyScalar(.5);
    bar.scale.y=poseJoints.l.wrist.distanceTo(poseJoints.r.wrist)/1.4;
    cables.forEach((line,index)=>{line.visible=Boolean(profile.cable);const hand=poseJoints[index?'l':'r'].wrist;const target=exercise==='row'?V(hand.x,.8,2):exercise==='chest-press'?V(hand.x,hand.y,-.65):V(hand.x,3.9,.45);line.geometry.setFromPoints([hand,target]);});
    body.updateMatrixWorld(true);skeleton.update();return true;
  }
  function attach(point,boneName){const a=new THREE.Object3D();a.position.copy(point).sub(rest[boneName]);map[boneName].add(a);return a;}
  reset();
  return {bones,map,rest,skeleton,bindGeometry,pose,staticPose,reset,attach,poseJoints,joints,weights,staticProps};
}
