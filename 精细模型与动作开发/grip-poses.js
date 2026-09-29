// Hand frames are independent of world-axis Euler angles. The hand's long axis
// follows the forearm while its palm normal defines neutral/overhand grip.
import * as THREE from 'three';
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const closedFlexion=[[.3666,.4151,.4146],[.4664,.6195,.4486],[.3229,.4117,.5382],[.1863,.4706,.143]];
// Calibrated to this anatomical hand and a 0.025–0.027 radius handle.
export const gripOffset=(sign)=>V(-sign*.015,-.165,.17);
export function alignedGrip(elbow,wrist,palmNormal){
  const y=elbow.clone().sub(wrist).normalize();
  let z=palmNormal.clone().addScaledVector(y,-palmNormal.dot(y));
  if(z.lengthSq()<1e-8){z=V(0,0,1).addScaledVector(y,-y.z);if(z.lengthSq()<1e-8)z=V(1,0,0).addScaledVector(y,-y.x);}
  z.normalize();const x=y.clone().cross(z).normalize();z=x.clone().cross(y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
}
export function gripNormal(exercise,side,forearm){
  const sign=side==='l'?1:-1;
  if(['chest-press','row','dumbbell-row','hammer-curl','triceps'].includes(exercise))return V(-sign,0,0);
  if(['lateral-raise','reverse-fly'].includes(exercise))return V(forearm.y*sign,-forearm.x*sign,0);
  if(exercise==='rdl')return V(0,0,-1);
  return V(0,0,1);
}
export function fingerFlexion(finger,joint,sign,kind='closed'){
  if(kind==='support')return new THREE.Quaternion().setFromAxisAngle(V(1,0,0),joint===0?.40:.10);
  if(kind==='relaxed')return new THREE.Quaternion().setFromAxisAngle(V(1,0,0),-.10);
  if(finger===0)return new THREE.Quaternion().setFromAxisAngle(V(0,0,1),-sign*(joint===0?.571:.075)).multiply(new THREE.Quaternion().setFromAxisAngle(V(1,0,0),joint===0?-.40:-1.056));
  return new THREE.Quaternion().setFromAxisAngle(V(1,0,0),-closedFlexion[finger-1][joint]);
}

// A straight bar fixes the grip axis. Solve in the sagittal plane, accounting
// for the palm offset as part of the distal link, instead of bending the wrist.
export function horizontalBarGrip(shoulder,palm,upper,fore,sign){
  const wristX=palm.x-sign*.015,dx=wristX-shoulder.x;
  const first=Math.sqrt(upper*upper-dx*dx),long=fore+.165,second=Math.hypot(long,.17);
  const start=shoulder.clone();start.x=wristX;
  const target=palm.clone();target.x=wristX;
  const delta=target.clone().sub(start),distance=delta.length(),axis=delta.normalize();
  const along=(first*first-second*second+distance*distance)/(2*distance);
  const height=Math.sqrt(Math.max(0,first*first-along*along));
  const pole=V(0,-1,-.1).addScaledVector(axis,-V(0,-1,-.1).dot(axis)).normalize();
  const elbow=start.clone().addScaledVector(axis,along).addScaledVector(pole,height);
  const direction=target.clone().sub(elbow).normalize().applyAxisAngle(V(1,0,0),-Math.atan2(.17,long));
  const wrist=elbow.clone().addScaledVector(direction,fore);
  const normal=V(1,0,0).cross(direction);
  return {elbow,wrist,rotation:alignedGrip(elbow,wrist,normal)};
}

// Compile against the imported phalanx axes once. Closed fingers adduct into
// parallel planes instead of retaining the anatomical asset's spread pose.
export function createGripRotations(chains,sign,kind='closed'){
  const result=new Map();
  for(const [finger,chain] of chains.entries()){
    let cumulative=0,rotation=new THREE.Quaternion();
    for(const [joint,segment] of chain.entries()){
      if(finger===0){rotation=rotation.clone().multiply(fingerFlexion(finger,joint,sign));}
      else{
        const delta=(chain[joint+1]?.top||segment.bottom).clone().sub(segment.top);
        const flex=kind==='cup'?[.35,.65,.40][joint]:closedFlexion[finger-1][joint];
        cumulative+=flex;const angle=Math.atan2(delta.z,delta.y)-cumulative;
        rotation=new THREE.Quaternion().setFromUnitVectors(delta.normalize(),V(0,Math.cos(angle),Math.sin(angle)));
      }
      result.set(segment.bone,rotation);
    }
  }
  return result;
}
