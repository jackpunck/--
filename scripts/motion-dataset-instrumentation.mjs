import {createHash} from 'node:crypto';

// QA-only hardware selection. Keep the production sampling, decoding, model,
// tracking, observations and evidence code byte-identical around these literals.
export function forceMotionDatasetCpu(source) {
  const declarations = ["let engine, delegate = 'GPU', previewStride = 1, previewBytes = 0;", "let delegate = 'GPU', sourceFps = null;"];
  let body = source;
  for (const declaration of declarations) {
    if (body.split(declaration).length !== 2) throw new Error('CPU QA instrumentation no longer matches the production delegate declaration.');
    body = body.replace(declaration, declaration.replace("'GPU'", "'CPU'"));
  }
  const hash = text => createHash('sha256').update(text).digest('hex');
  return {body, audit: {type: 'browser-route-cpu-delegate-only', module: 'public/motion-video.js', originalSha256: hash(source), servedSha256: hash(body),
    changedLiterals: 2, delegate: 'CPU', scope: 'Only the initial hardware delegate changes in both production decoder branches. Sampling, frames, inference model, tracking and evidence logic are unchanged. Actual output delegate is asserted CPU.'}};
}
