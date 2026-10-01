import * as THREE from 'three';

const V=()=>new THREE.Vector3();
function frame(direction,normal){
  const x=normal.clone().addScaledVector(direction,-normal.dot(direction)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,direction,x.clone().cross(direction)));
}

// A shared hinge plane removes the unrelated axial rolls introduced by two
// independent shortest-arc rotations. Positions and limb lengths are unchanged.
export function armRotations(rest,posed,chestRotation){
  const ru=rest.elbow.clone().sub(rest.shoulder).normalize(),rf=rest.wrist.clone().sub(rest.elbow).normalize();
  const u=posed.elbow.clone().sub(posed.shoulder).normalize(),f=posed.wrist.clone().sub(posed.elbow).normalize();
  const restNormal=ru.clone().cross(rf).normalize();
  const normal=u.clone().cross(f),bend=normal.length();
  // A nearly straight arm has an ill-conditioned bend plane. Blend from a
  // chest-relative rest frame instead of letting roundoff or a
  // tiny sideways bend rotate the elbow by ninety degrees in one frame.
  const fallback=restNormal.clone().applyQuaternion(chestRotation);
  fallback.addScaledVector(u,-fallback.dot(u));
  if(fallback.lengthSq()<1e-10){fallback.copy(V().set(0,0,1)).applyQuaternion(chestRotation);fallback.addScaledVector(u,-fallback.dot(u));}
  fallback.normalize();
  if(bend<1e-8)normal.copy(fallback);
  else{
    normal.divideScalar(bend);
    const t=THREE.MathUtils.smoothstep(bend,0,.25);
    const turn=new THREE.Quaternion().setFromUnitVectors(fallback,normal);
    normal.copy(fallback).applyQuaternion(new THREE.Quaternion().identity().slerp(turn,t));
  }
  const upper=frame(u,normal).multiply(frame(ru,restNormal).invert());
  const forearm=frame(f,normal).multiply(frame(rf,restNormal).invert());
  return {upper,forearm};
}

// Separate forearm roll from wrist flexion. Both frames map the imported
// forearm axis to the posed axis, so roll never bends or shortens the limb.
export function forearmRoll(rest,posed,handRotation){
  const original=rest.wrist.clone().sub(rest.elbow).normalize();
  const direction=posed.wrist.clone().sub(posed.elbow).normalize();
  const handX=new THREE.Vector3(1,0,0).applyQuaternion(handRotation);
  return frame(direction,handX).multiply(frame(original,new THREE.Vector3(1,0,0)).invert());
}
