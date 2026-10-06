// COCO-WholeBody indices: body/feet 0–22, face 23–90, hands 91–111/112–132.
const BODY_LINKS = [[0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16],[15,17],[15,19],[17,18],[18,19],[16,20],[16,22],[20,21],[21,22]];
// fitness-body17 matches the temporal coaching evidence: nose, shoulders,
// elbows, wrists, hips, knees, ankles, heels and front-foot support points.
// Indices refer to the raw COCO WholeBody output, never the mapped 33 slots.
export const MOTION_FITNESS_BODY_INDICES = Object.freeze([0,5,6,7,8,9,10,11,12,13,14,15,16,19,22,17,20]);
const MEDIAPIPE_BODY_INDICES = [0,11,12,13,14,15,16,23,24,25,26,27,28,29,30,31,32];
const FITNESS_BODY_LINKS = [...BODY_LINKS.filter(([a,b])=>MOTION_FITNESS_BODY_INDICES.includes(a)&&MOTION_FITNESS_BODY_INDICES.includes(b)),[17,19],[20,22]];
const HAND_LINKS = [91,112].flatMap(root=>Array.from({length:5},(_,finger)=>{
  const start=root+finger*4+1;
  return [[root,start],[start,start+1],[start+1,start+2],[start+2,start+3]];
}).flat());
const finite = value => typeof value==='number'&&Number.isFinite(value);
const styles = {
  body:{radius:3.3,color:'#ffffff'},
  face:{radius:1.05,color:'#c4ceff'},
  leftHand:{radius:2,color:'#ffe0a3'},
  rightHand:{radius:2,color:'#ffe0a3'},
};

export function buildMotionOverlay(points,width,height,{detail='body'}={}) {
  // Convert only real anatomical matches for drawing; this display-only table
  // never enters the inference output or the AI evidence.
  if(Array.isArray(points)&&points.length===33){
    const mapped=Array(133).fill(null);
    MEDIAPIPE_BODY_INDICES.forEach((source,index)=>{const point=points[source];if(point)mapped[MOTION_FITNESS_BODY_INDICES[index]]={x:point.x,y:point.y,score:point.visibility};});
    points=mapped;detail='body';
  }
  if(!Array.isArray(points)||points.length!==133||!finite(width)||!finite(height)||width<=0||height<=0)return {points:[],lines:[]};
  const scale=Math.max(1,Math.min(width,height)/450);
  const visible=new Map();
  const indices=detail==='wholebody'?Array.from({length:133},(_,index)=>index):MOTION_FITNESS_BODY_INDICES;
  indices.forEach(index=>{
    const point=points[index];
    // SimCC scores are raw responses, not probabilities. Never clamp them to 1.
    if(!point||![point.x,point.y,point.score].every(finite)||point.score<=0||point.x<0||point.x>1||point.y<0||point.y>1)return;
    const group=index<23?'body':index<91?'face':index<112?'leftHand':'rightHand';
    const style=styles[group];
    visible.set(index,{index,group,x:point.x*width,y:point.y*height,radius:style.radius*scale,color:style.color});
  });
  const lines=[];
  const linksToDraw=detail==='wholebody'?[[BODY_LINKS,false],[HAND_LINKS,true]]:[[FITNESS_BODY_LINKS,false]];
  for(const [links,hand]of linksToDraw)for(const [a,b]of links){
    if(visible.has(a)&&visible.has(b))lines.push({a:visible.get(a),b:visible.get(b),width:(hand?1.25:2.4)*scale,color:hand?'#ffe0a3':'#91ffcd'});
  }
  return {points:[...visible.values()],lines};
}

export function drawMotionOverlay(context,points,width,height,options) {
  const geometry=buildMotionOverlay(points,width,height,options);
  if(!geometry.points.length)return;
  context.save();context.lineCap='round';context.shadowColor='#111827';context.shadowBlur=1;
  for(const line of geometry.lines){
    context.strokeStyle=line.color;context.lineWidth=line.width;context.beginPath();context.moveTo(line.a.x,line.a.y);context.lineTo(line.b.x,line.b.y);context.stroke();
  }
  for(const point of geometry.points){
    context.fillStyle=point.color;context.beginPath();context.arc(point.x,point.y,point.radius,0,Math.PI*2);context.fill();
  }
  context.restore();
}
