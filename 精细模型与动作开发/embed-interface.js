import { supportedExercises, animatedExercises } from './exercise-catalog.js';
import { isSupportedMuscle, isSupportedStructure } from './muscle-data.js';
export { supportedExercises, animatedExercises };

export function isSupportedExercise(value) {
  return typeof value === 'string' && supportedExercises.includes(value);
}

export function readModelOptions(search) {
  const params = new URLSearchParams(search);
  const requested = params.get('exercise');
  return {
    exercise: requested === null ? 'squat' : isSupportedExercise(requested) ? requested : null,
    invalidExercise: requested !== null && !isSupportedExercise(requested),
    mode: params.get('mode')==='atlas'||params.has('muscle')||params.has('structure')?'atlas':'motion',
    muscle: isSupportedMuscle(params.get('muscle'))?params.get('muscle'):null,
    structure: isSupportedStructure(params.get('structure'))?params.get('structure'):null,
    embed: params.get('embed') === '1',
    compact: params.get('compact') === '1',
  };
}

// The bridge is deliberately limited to the actual, same-origin parent window.
// A standalone file:// demo still works; opaque origins cannot control it.
export function createModelBridge(host, onExercise, onMuscle=()=>{}, onStructure=()=>{}, onVisibility=()=>{}) {
  const origin = host.location.origin;
  const embedded = host.parent !== host && /^https?:\/\//.test(origin);
  const send = (type, exercise, title, extra = {}) => {
    if (embedded) host.parent.postMessage({ type, exercise, title, ...extra }, origin);
  };
  const receive = (event) => {
    if (!embedded || event.source !== host.parent || event.origin !== origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const requestId=Number.isSafeInteger(data.requestId)&&data.requestId>=0?data.requestId:null;
    if (data.type === 'fitness:exercise' && isSupportedExercise(data.exercise)) {
      onExercise(data.exercise,requestId);
    }
    if (data.type === 'fitness:muscle' && isSupportedMuscle(data.muscle)) onMuscle(data.muscle,requestId);
    if (data.type === 'fitness:structure' && isSupportedStructure(data.structure)) onStructure(data.structure,requestId);
    if (data.type === 'fitness:visibility' && typeof data.visible === 'boolean') onVisibility(data.visible,requestId);
  };
  host.addEventListener('message', receive);
  return {
    ready: (exercise, title, webgl, selection = {}) => send('fitness:ready', exercise, title, { webgl, ...selection }),
    selected: (exercise, title, requestId=null) => send('fitness:selected', exercise, title, {mode:'motion',...(requestId===null?{}:{requestId})}),
    muscleSelected: (muscle, name, structure=null, mode='atlas', requestId=null) => { if(embedded)host.parent.postMessage({type:'fitness:muscle-selected',muscle,name,structure,mode,...(requestId===null?{}:{requestId})},origin); },
    rendered: (exercise, title, selection) => send('fitness:rendered', exercise, title, selection),
    destroy: () => host.removeEventListener('message', receive),
  };
}
