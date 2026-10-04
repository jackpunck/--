const angles = ['elbowAngle', 'shoulderAngle', 'hipAngle', 'kneeAngle', 'bodyAlignmentAngle', 'torsoLean'];
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** Bounded navigation facts from the complete observed timeline. These do not
 * classify an exercise, estimate repetitions or evaluate form. Every extremum
 * retains its exact source measurement and can be checked against the packets.
 * The source observations remain unchanged; callers decide which evidence is
 * actually transmitted and must report that coverage separately. */
export function buildMotionSequenceContext(input) {
  const measurements = input.fullAnalysis?.measurements || [];
  const trajectories = [];
  for (const side of ['left', 'right']) for (const angle of angles) {
    let first, last, minimum, maximum, sampleCount = 0;
    for (let index = 0; index < measurements.length; index++) {
      const row = measurements[index], value = row?.[side]?.[angle];
      if (row?.frameIndex !== index || !finite(row.time) || !finite(value)) continue;
      const point = {frameIndex: index, time: row.time, value};
      first ||= point;
      last = point;
      if (!minimum || value < minimum.value) minimum = point;
      if (!maximum || value > maximum.value) maximum = point;
      sampleCount++;
    }
    if (sampleCount) trajectories.push({path: [side, angle], sampleCount, first, last, minimum, maximum});
  }
  return {measurementCount: measurements.length, trajectories};
}
