import tables from './assets/muscle-force-tables.json' with {type:'json'};

export const forceScaleN=tables.colorMaxN;
export const referenceMassKg=tables.referenceMassKg;
export const forceProfiles={
  squat:{label:'肩部附加负重（总重 kg）',defaultLoad:0,maxLoad:60},
  curl:{label:'每只哑铃（kg）',defaultLoad:5,maxLoad:20},
  pushup:{label:'躯干附加负重（总重 kg）',defaultLoad:0,maxLoad:30},
};
export const forceGroups=id=>[...new Set(tables.exercises[id]?.muscles.map(m=>m.group).filter(Boolean)||[])];
// A single absolute scale, shared by every action and muscle group. No per-frame
// or per-action normalization, so adding load can never secretly rescale colors.
export const forceToLevel=force=>Number.isFinite(force)&&force>=0?Math.sqrt(Math.min(force/forceScaleN,1)):null;
const lerp=(a,b,t)=>a+(b-a)*t;
export function estimateForces(exercise,position,load){
  const data=tables.exercises[exercise];
  const invalid=reason=>({valid:false,reason,muscles:{},forces:{},rows:[]});
  if(!data)return invalid('此动作尚无肌力仿真');
  if(!Number.isFinite(position)||position<0||position>1||!Number.isFinite(load)||load<0||load>data.maxLoad)return invalid('负重或姿态超出模型范围');
  let i=0,right=data.samples.length-1;
  while(right-i>1){const mid=Math.floor((i+right)/2);if(data.samples[mid].q<=position)i=mid;else right=mid;}
  const u=(position-data.samples[i].q)/(data.samples[i+1].q-data.samples[i].q);
  const y=load/data.loadStep,k=Math.min(Math.floor(y),data.loads.length-2),v=y-k;
  const a=data.samples[i],b=data.samples[i+1];
  const corners=[[a.forces[k],(1-u)*(1-v)],[a.forces[k+1],(1-u)*v],[b.forces[k],u*(1-v)],[b.forces[k+1],u*v]].filter(([,w])=>w>1e-12);
  if(corners.some(([forces])=>!forces))return invalid('当前姿态与负重超出此模型的可解范围，不代表你无法完成动作');
  const values=data.muscles.map((_,j)=>corners.reduce((sum,[forces,w])=>sum+forces[j]*w,0));
  let residualNm=0,peakTorque=0;
  for(let row=0;row<data.keys.length;row++){
    const target=lerp(a.base[row]+a.load[row]*load,b.base[row]+b.load[row]*load,u);
    const actual=values.reduce((sum,f,j)=>sum+f*lerp(a.R[row][j],b.R[row][j],u),0);
    residualNm=Math.max(residualNm,Math.abs(target-actual));peakTorque=Math.max(peakTorque,Math.abs(target));
  }
  if(residualNm>Math.max(.1,peakTorque*.01))return invalid('此处插值误差超过显示阈值');
  const forces={},muscles={},rows=[];let otherForceN=0;
  data.muscles.forEach((m,j)=>{
    const forceN=values[j];rows.push({id:m.id,group:m.group,forceN});
    if(m.group)forces[m.group]=(forces[m.group]||0)+forceN;
    else otherForceN+=forceN;
  });
  for(const [group,forceN] of Object.entries(forces))muscles[group]=forceToLevel(forceN);
  return {valid:true,reason:'',forces,muscles,rows,otherForceN,residualNm,model:data.model};
}
