"""Direct OpenSim checks between table nodes; no interpolation of reference R/tau.

Run export-force-poses.mjs and build-force-tables.py first. The small resulting
fixture lets npm test check interpolation against the source model without Python.
These are numerical reference checks, not experimental human validation.
"""
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('force_builder',ROOT/'scripts/build-force-tables.py')
builder=importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
tables=json.loads((ROOT/'assets/muscle-force-tables.json').read_text())
pose_hash=hashlib.sha256((ROOT/'.qa/force-poses.json').read_bytes()).hexdigest()
assert pose_hash==tables['poseSourceSha256'],'Regenerate the force tables first'
sources={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in builder.MODELS.glob('*.osim')}
assert sources==tables['sources'],'Reference models changed'
builder.POSES=json.loads((ROOT/'.qa/force-reference-poses.json').read_text())
data=builder.arm_samples('pushup',initial_coordinates=tables['exercises']['pushup']['samples'][0]['coordinates'])
result={'engine':builder.osim.GetVersionAndDate(),'poseSourceSha256':pose_hash,'sources':sources,
        'method':'Direct source-model R and external moments at actual display poses between force-table nodes',
        'samples':[{key:s[key] for key in ['q','R','base','load','poseErrorDegrees']} for s in data['samples']]}
output=ROOT/'scripts/fixtures/pushup-force-reference.json'
output.parent.mkdir(exist_ok=True)
output.write_text(json.dumps(result,separators=(',',':')),encoding='utf8')
print('Saved',len(result['samples']),'direct reference poses',flush=True)
