// Explicit dataset-to-catalog mapping and prediction-independent guided development selection.
import {getMotionExercise} from '../public/motion-catalog.js';

export const DATASET_GUIDED_EXERCISES = Object.freeze({
  'bodyweight-squat':'squat', 'push-up':'pushup', 'dumbbell-curl':'alternating-dumbbell-curl',
  'dumbbell-row':'bilateral-dumbbell-row', 'dumbbell-shoulder-press':'standing-dumbbell-press',
  'dumbbell-side-bend':'dumbbell-side-bend', 'overhead-triceps-extension':'overhead-triceps',
  'barbell-deadlift':'barbell-deadlift', 'barbell-squat':'barbell-squat', 'barbell-row':'barbell-row',
  'barbell-shoulder-press':'barbell-shoulder-press', 'barbell-bench-press':'barbell-bench',
  'incline-bench-press':'incline-barbell-bench', 'dumbbell-bench-press':'bench',
  'lat-pulldown':'lat-pulldown', 'pull-up':'bodyweight-pullup', 'seated-cable-row':'row',
  'hanging-knee-raise':'hanging-knee-raise', 'hanging-leg-raise':'hanging-leg-raise',
  'seated-calf-raise':'seated-calf-raise', 'standing-calf-raise':'calf-raise',
  'romanian-deadlift':'barbell-romanian-deadlift', 'front-squat':'front-squat',
  'barbell-lunge':'barbell-lunge', 'dumbbell-lunge':'dumbbell-lunge', 'walking-lunge':'walking-lunge',
  'lying-leg-curl':'lying-leg-curl', 'seated-leg-curl':'seated-leg-curl', 'smith-squat':'smith-squat',
  'leg-press':'leg-press', 'barbell-curl':'barbell-curl', 'hammer-curl':'hammer-curl',
  'cable-triceps-extension':'triceps', 'dumbbell-triceps-extension':'dumbbell-kickback',
  'lateral-raise':'lateral-raise', 'dumbbell-skullcrusher':'dumbbell-skullcrusher',
  dip:'dip', 'hip-thrust':'barbell-hip-thrust', 'face-pull':'face-pull',
});

export function requireGuidedSelection(item) {
  if (!item.selectedExerciseId || !getMotionExercise(item.selectedExerciseId)) throw new Error(`Guided manifest needs a valid explicit selectedExerciseId for ${item.id}.`);
  if (DATASET_GUIDED_EXERCISES[item.exercise] !== item.selectedExerciseId) throw new Error(`Guided manifest equipment/variation mapping disagrees for ${item.id}.`);
  return item.selectedExerciseId;
}

export function selectGuidedRepresentatives(items) {
  const result=[];
  for(const exercise of [...new Set(items.map(item=>item.exercise))].sort()) {
    const candidates=items.filter(item=>item.exercise===exercise);
    const labeled=candidates.filter(item=>['author_good','author_bad'].includes(item.qualityLabel));
    const rank=item=>[item.subject==='001'||item.subject==='01'?0:1,item.view==='side'?0:1,item.id];
    const byRank=(a,b)=>rank(a)[0]-rank(b)[0]||rank(a)[1]-rank(b)[1]||a.id.localeCompare(b.id);
    if(labeled.length) {
      for(const label of exercise==='barbell-deadlift'?['GB','PB','LLK']:['good','bad']) {
        const item=labeled.filter(item=>item.sourceLabel===label).sort(byRank)[0];
        if(!item)throw new Error(`Missing planned author label ${exercise}/${label}.`);
        result.push(item);
      }
    } else result.push(candidates.sort((a,b)=>(a.sourceGroup==='commons'?0:1)-(b.sourceGroup==='commons'?0:1)||a.id.localeCompare(b.id))[0]);
  }
  return result.map(item=>{
    const selected={...item,selectedExerciseId:DATASET_GUIDED_EXERCISES[item.exercise]};
    requireGuidedSelection(selected);return selected;
  });
}

export function guidedRequestFields(item) {
  // This is the complete added model-input surface. No ground-truth fields.
  return {reviewMode:'guided',selectedExerciseId:requireGuidedSelection(item)};
}
