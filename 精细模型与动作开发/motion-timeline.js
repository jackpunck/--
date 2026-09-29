// One timeline for the rig, color direction and phase captions.
import {animatedExercises} from './exercise-catalog.js';
import {activityProfiles} from './activity-profiles.js';
export const cycleSeconds = 6;
export function sampleMotion(exercise, progress) {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (!animatedExercises.includes(exercise)) return null;
  if (activityProfiles[exercise]?.isometric) return {position:.5,phaseIndex:1,contraction:'isometric'};
  if (p <= .12 || p >= .95) return {position:0, phaseIndex:0, contraction:'hold'};
  const first = p < .55;
  const t = first ? (p - .12) / .43 : (p - .55) / .4;
  const eased = .5 - .5 * Math.cos(Math.PI * t);
  return {
    position:first ? eased : 1 - eased,
    phaseIndex:first ? 1 : 2,
    contraction:p === .55 ? 'turn' : (activityProfiles[exercise]?.firstContraction==='concentric' ? first : !first) ? 'concentric' : 'eccentric',
  };
}
