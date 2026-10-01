import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Generic commercial gym equipment, sized to this teaching rig (not manufacturer CAD).
// Static parts are merged by material. Moving parts reuse their geometry every frame.
export const gymEquipmentNames=Object.freeze({
  'chest-press':'坐姿配重推胸机（中立握把）',
  'lat-pulldown':'配重式高位下拉机（长拉杆）',
  row:'坐姿低位绳索划船机（双握把）',
  triceps:'高位滑轮训练器（双头绳）',
  'leg-extension':'坐姿腿屈伸机',
  'leg-curl':'坐姿腿弯举机',
  pullup:'配重辅助引体向上机',
});
const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z),Y=V(0,1,0),X=V(1,0,0);

export function createGymEquipment(parent){
  const materials={
    frame:new T.MeshStandardMaterial({color:'#85928f',metalness:.55,roughness:.4}),
    dark:new T.MeshStandardMaterial({color:'#303a38',metalness:.25,roughness:.65}),
    pad:new T.MeshStandardMaterial({color:'#354d45',roughness:.93}),
    chrome:new T.MeshStandardMaterial({color:'#bec9c6',metalness:.8,roughness:.28}),
    accent:new T.MeshStandardMaterial({color:'#c79b4f',metalness:.3,roughness:.5}),
  };
  const boxGeometry=new T.BoxGeometry(1,1,1),rodGeometry=new T.CylinderGeometry(1,1,1,12);
  const variants={};
  function mesh(group,name,material='frame',cylinder=false){const m=new T.Mesh(cylinder?rodGeometry:boxGeometry,materials[material]);m.name=name;m.castShadow=true;m.receiveShadow=true;group.add(m);return m;}
  function box(group,name,p,size,material='frame'){const m=mesh(group,name,material);m.position.set(...p);m.scale.set(...size);return m;}
  function rod(group,name,a,b,r=.045,material='frame'){const m=mesh(group,name,material,true);connect(m,V(...a),V(...b),r);return m;}
  function connect(m,a,b,r=.045){m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(Y,b.clone().sub(a).normalize());m.scale.set(r,a.distanceTo(b),r);m.userData.ends=[a.toArray(),b.toArray()];}
  function pulley(group,p){const m=box(group,'pulley-bracket',p,[.12,.31,.31],'frame');const wheel=mesh(group,'pulley','dark',true);wheel.position.set(...p);wheel.rotation.z=Math.PI/2;wheel.scale.set(.125,.14,.125);return m;}
  function consolidate(group){
    group.updateMatrixWorld(true);
    for(const [key,material] of Object.entries(materials)){
      const parts=group.children.filter(n=>n.isMesh&&n.material===material);if(!parts.length)continue;
      const geometries=parts.map(n=>n.geometry.clone().applyMatrix4(n.matrix));
      const merged=new T.Mesh(mergeGeometries(geometries),material);merged.name='fixed-'+key;merged.castShadow=true;merged.receiveShadow=true;
      group.remove(...parts);group.add(merged);geometries.forEach(g=>g.dispose());
    }
  }
  for(const id of Object.keys(gymEquipmentNames)){
    const group=new T.Group();group.name=id+'-machine';group.userData.equipment=gymEquipmentNames[id];group.visible=false;parent.add(group);
    const fixed=new T.Group();group.add(fixed);
    const tall=['lat-pulldown','triceps','pullup'].includes(id),height=tall?3.95:id==='row'?2.35:2.45;
    const z=id==='row'?2.1:id==='triceps'?1.15:id==='lat-pulldown'?.55:-.65,x=-1.13;
    for(const sx of [x-.34,x+.34])box(fixed,'tower-post',[sx,height/2,z],[.085,height,.09]);
    box(fixed,'tower-cap',[x,height,z],[.83,.12,.48],'dark');
    box(fixed,'tower-rear-guard',[x,height*.49,z-.20],[.78,height*.90,.055],'dark');
    for(const sx of [x-.21,x+.21])rod(fixed,'stack-guide',[sx,.18,z],[sx,height-.18,z],.014,'chrome');
    for(let i=0;i<12;i++)box(fixed,'weight-plate',[x,.22+i*.067,z],[.59,.055,.27],'dark');
    box(fixed,'selector-pin',[x,.43,z+.17],[.075,.045,.08],'accent');
    const baseFront=id==='row'?2.4:id==='triceps'?1.5:1.05,baseBack=id==='row'?-1.6:-.95;
    for(const sx of [-1.13,.72]){
      box(fixed,'floor-rail',[sx,.085,(baseFront+baseBack)/2],[.12,.12,baseFront-baseBack]);
      for(const bz of [baseFront,baseBack])box(fixed,'rubber-foot',[sx,.035,bz],[.24,.07,.25],'dark');
    }
    for(const bz of [baseFront-.1,baseBack+.1])box(fixed,'base-crossmember',[-.2,.085,bz],[1.95,.1,.10]);
    const dynamic={stack:box(group,'moving-weight-stack',[x,1.08,z],[.59,.35,.27],'dark'),stackCable:mesh(group,'stack-cable','dark',true),stackTop:V(x,height-.1,z)};
    if(id==='lat-pulldown'||id==='triceps'){
      const outlet=V(0,3.8,id==='lat-pulldown'?.3:.8);
      rod(fixed,'overhead-boom',[x,height,z],outlet.toArray(),.065);pulley(fixed,outlet.toArray());
      rod(fixed,'top-cable',[x,3.82,z],outlet.toArray(),.009,'dark');
      if(id==='lat-pulldown'){
        rod(fixed,'thigh-rest-post',[.52,.12,.60],[.52,1.04,.60],.045);
        rod(fixed,'thigh-rest',[-.45,1.04,.60],[.45,1.04,.60],.105,'pad');
      }else{
        dynamic.rope=['r','l'].map(side=>mesh(group,'rope-'+side,'dark',true));
        dynamic.stops=['r','l'].map(side=>mesh(group,'rope-stop-'+side,'dark',true));
      }
      dynamic.cable=mesh(group,'working-cable','dark',true);dynamic.outlet=outlet;
    }
    if(id==='row'){
      dynamic.outlet=V(0,.66,2.1);pulley(fixed,dynamic.outlet.toArray());
      rod(fixed,'low-pulley-support',[0,.15,2.1],[0,.66,2.1],.06);
      rod(fixed,'cable-return',[0,.66,2.1],[x,.66,2.1],.009,'dark');
      for(const sx of [-.20,.20]){
        const plate=box(fixed,'footplate',[sx,.14,.28],[.32,.42,.075],'dark');plate.rotation.x=-.45;
        rod(fixed,'footplate-support',[sx,.09,.60],[sx,.18,.28],.045);
      }
      dynamic.cable=mesh(group,'working-cable','dark',true);
      dynamic.links=['r','l'].map(side=>mesh(group,'handle-link-'+side,'chrome',true));
    }
    if(id==='chest-press'){
      for(const sign of [-1,1]){
        rod(fixed,'press-pivot-post',[sign*.85,.10,-.50],[sign*.85,2.45,-.50],.055);
        rod(fixed,'press-pivot-axle',[sign*.78,2.40,-.50],[sign*.98,2.40,-.50],.095,'dark');
      }
      box(fixed,'press-top-crossmember',[0,2.43,-.50],[1.9,.10,.10]);
      dynamic.arms=['r','l'].map(side=>mesh(group,'press-arm-'+side,'frame',true));
      dynamic.links=['r','l'].map(side=>mesh(group,'grip-stem-'+side,'chrome',true));
    }
    if(id==='leg-curl'||id==='leg-extension'){
      rod(fixed,'knee-pivot-post',[.55,.10,.80],[.55,.81,.80],.06);
      rod(fixed,'knee-pivot', [.48,.81,.80],[.65,.81,.80],.14,'dark');
      if(id==='leg-curl'){
        rod(fixed,'thigh-rest-post',[.55,.10,.38],[.55,1.04,.38],.045);
        rod(fixed,'thigh-rest',[-.42,1.04,.38],[.48,1.04,.38],.095,'pad');
      }
      dynamic.arm=mesh(group,'leg-lever','frame',true);
      dynamic.axle=mesh(group,'roller-axle','chrome',true);
    }
    if(id==='pullup'){
      for(const sx of [-.95,.95]){
        rod(fixed,'pullup-upright',[sx,.10,-.30],[sx,3.72,-.30],.055);
        rod(fixed,'chinbar-support',[sx,3.72,-.30],[sx,3.72,.10],.055);
        box(fixed,'entry-step',[sx,.42,.35],[.38,.09,.55],'dark');
      }
      for(const sx of [-.40,.40])rod(fixed,'assistance-guide',[sx,.15,-.40],[sx,2.7,-.40],.02,'chrome');
      dynamic.carriage=box(group,'knee-carriage',[0,1,-.40],[.92,.14,.16]);
      dynamic.bracket=mesh(group,'knee-platform-support','frame',true);
    }
    consolidate(fixed);variants[id]={group,dynamic};
  }
  function update(id,q,{palms,joints,bar,roller,assistance,handles}){
    for(const [key,variant] of Object.entries(variants))variant.group.visible=key===id;
    const variant=variants[id];if(!variant)return;
    const d=variant.dynamic,mid=palms[0].clone().add(palms[1]).multiplyScalar(.5);
    d.stack.position.y=1.08+(id==='pullup'?1-q:q)*.38;
    connect(d.stackCable,d.stackTop,d.stack.position.clone().add(V(0,.175,0)),.009);
    if(id==='chest-press')for(let i=0;i<2;i++){
      const sign=i?1:-1,axis=Y.clone().applyQuaternion(handles[i].quaternion),end=palms[i].clone().addScaledVector(axis,-.16);
      connect(d.arms[i],V(sign*.85,2.40,-.50),end,.055);
      connect(d.links[i],end,palms[i],.026);
    }
    if(id==='lat-pulldown')connect(d.cable,d.outlet,bar.position,.009);
    if(id==='triceps'){
      // One upper cable branches into the familiar two-ended rope attachment.
      const apex=mid.clone().add(V(0,.37,.06));connect(d.cable,d.outlet,apex,.009);
      for(let i=0;i<2;i++){
        const axis=Y.clone().applyQuaternion(handles[i].quaternion),tip=palms[i].clone().addScaledVector(axis,.12),bottom=palms[i].clone().addScaledVector(axis,-.14);
        connect(d.rope[i],apex,tip,.025);d.stops[i].position.copy(bottom);d.stops[i].quaternion.copy(handles[i].quaternion);d.stops[i].scale.set(.06,.065,.06);
      }
    }
    if(id==='row'){
      const apex=mid.clone().add(V(0,0,.26));connect(d.cable,d.outlet,apex,.009);
      for(let i=0;i<2;i++)connect(d.links[i],apex,palms[i],.023);
    }
    if(id==='leg-curl'||id==='leg-extension'){
      const knee=joints.l.knee.clone().add(joints.r.knee).multiplyScalar(.5),ankle=joints.l.ankle.clone().add(joints.r.ankle).multiplyScalar(.5);
      const lower=ankle.clone().sub(knee).normalize(),front=new T.Vector3().crossVectors(X,lower).negate();
      // Extension pad presses the front of the lower shin; curl pad supports behind it.
      roller.position.copy(ankle).addScaledVector(lower,-.09).addScaledVector(front,id==='leg-curl'?-.15:.15);
      const pivot=knee.clone();pivot.x=.55;const end=roller.position.clone();end.x=.55;
      connect(d.arm,pivot,end,.055);connect(d.axle,V(-.48,end.y,end.z),end,.026);
    }
    if(id==='pullup'){
      d.carriage.position.y=assistance.position.y-.07;
      connect(d.bracket,d.carriage.position,assistance.position,.065);
    }
  }
  return {update,variants,materials};
}
