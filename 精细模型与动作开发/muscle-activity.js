import {activityProfiles} from './activity-profiles.js';

const clamp=x=>Math.max(0,Math.min(1,x));
// Monotone interpolation preserves authored extrema without overshooting them.
function interpolate(points,q){
  let index=0;
  while(index<points.length-2&&q>points[index+1][0])index++;
  const [x0,y0]=points[index],[x1,y1]=points[index+1];
  const t=clamp((q-x0)/(x1-x0)),s=t*t*(3-2*t);
  return y0+(y1-y0)*s;
}

// Add exercise profiles, not solver branches. Ranges are compiled once per
// whole movement, never normalized against the visible frame or other muscles.
export function createActivityModel(profiles){
  const compiled=new Map();
  for(const [id,profile] of Object.entries(profiles)){
    if(!profile.muscles||!Object.keys(profile.muscles).length)throw new Error(`${id}: missing muscles`);
    const rows=Object.entries(profile.muscles).map(([group,definition])=>{
      const points=definition.curve?.map(point=>[...point]);
      if(!points||points.length<2||points[0][0]!==0||points.at(-1)[0]!==1||points.some(([x,y],i)=>!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||(i>0&&x<=points[i-1][0])))throw new Error(`${id}/${group}: invalid activity curve`);
      const min=Math.min(...points.map(p=>p[1])),max=Math.max(...points.map(p=>p[1]));
      const steady=max-min<=Number.EPSILON*Math.max(1,max)*16;
      return {...definition,group,points,min,max,steady};
    });
    compiled.set(id,{profile,rows});
  }
  return {
    has:id=>compiled.has(id),
    groups:id=>compiled.get(id)?.rows.map(row=>row.group)||[],
    at(id,motion){
      const entry=compiled.get(id),q=motion?.position;
      if(!entry||!Number.isFinite(q)||q<0||q>1)return null;
      const muscles={};
      const rows=entry.rows.map(row=>{
        const value=interpolate(row.points,q);
        // Constant support is a stable middle tint, not a force percentage.
        const relative=row.steady?(row.max>0?.45:0):clamp((value-row.min)/(row.max-row.min));
        muscles[row.group]=relative;
        return {group:row.group,role:row.role,relative,steady:row.steady,peak:row.peak,low:row.low};
      });
      return {valid:true,kind:'illustration',muscles,rows,note:entry.profile.note,phaseNote:entry.profile.phases?.[motion.contraction]||entry.profile.note||''};
    },
  };
}

const model=createActivityModel(activityProfiles);
export const hasActivityProfile=model.has;
export const activityGroups=model.groups;
export const activityAt=(exercise,motion)=>model.at(exercise,motion);
