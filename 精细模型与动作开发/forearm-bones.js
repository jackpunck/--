import * as THREE from 'three';

// Source-derived joint-end landmarks. The short end sections are averaged so
// an individual styloid tip cannot set the center of the whole articulation.
export function forearmLandmarks(sources,side){
  return ['Ulna','Radius'].map(name=>{
    const source=sources.find(s=>s.item.name===`${name}.${side}`),p=source.geometry.attributes.position;
    let low=Infinity,high=-Infinity;
    for(let i=0;i<p.count;i++){low=Math.min(low,p.getY(i));high=Math.max(high,p.getY(i));}
    const proximal=new THREE.Vector3(),distal=new THREE.Vector3(),v=new THREE.Vector3();let np=0,nd=0;
    for(let i=0;i<p.count;i++){
      v.fromBufferAttribute(p,i);
      if(v.y>high-(high-low)*.06){proximal.add(v);np++;}
      if(v.y<low+(high-low)*.06){distal.add(v);nd++;}
    }
    proximal.divideScalar(np);distal.divideScalar(nd);
    return {name:name.toLowerCase()+'.'+side,proximal,distal};
  });
}

// Keep each bone rigid, connect its distal end to the rolling wrist, and point
// its shaft towards the elbow attachment. Small residual proximal distances
// are measured in tests; this is an attachment fit, not a joint simulation.
export function fitForearmBone(landmark,proximal,distal,baseRotation){
  const original=landmark.proximal.clone().sub(landmark.distal);
  const direction=proximal.clone().sub(distal).normalize();
  const swing=new THREE.Quaternion().setFromUnitVectors(original.clone().applyQuaternion(baseRotation).normalize(),direction);
  return {position:distal,rotation:swing.multiply(baseRotation)};
}
