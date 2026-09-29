// Share the exact display poses between table generation and regression checks.
// In particular, the solver must not carry its own copy of the torso animation.
export function forcePosePositions(id){
  const positions=Array.from({length:101},(_,i)=>i/100);
  // Near elbow extension, the push-up arm directions change rapidly. Resolve
  // that small interval more finely instead of enlarging interpolation limits.
  if(id==='pushup')positions.push(...Array.from({length:20},(_,i)=>i/500));
  return [...new Set(positions)].sort((a,b)=>a-b);
}
export const forceReferencePositions=[.001,.003,.005,.095,.335,.555,.895,.995];
export function captureForcePoses(atlas,positionsFor=forcePosePositions){
  const poses={};
  for(const id of ['squat','curl','pushup']){
    poses[id]=[];
    for(const q of positionsFor(id)){
      atlas.rig.pose(q,id);
      const j=atlas.rig.poseJoints.r,rotation=atlas.rig.map.chest.quaternion;
      poses[id].push({q,torsoPitch:2*Math.atan2(rotation.x,rotation.w),joints:Object.fromEntries(Object.entries(j).map(([k,p])=>[k,p.toArray()])),dumbbell:atlas.rig.weights[0].position.toArray()});
    }
  }
  return {height:1.75,mass:75.1646,displayHeight:3.158875,poses};
}
