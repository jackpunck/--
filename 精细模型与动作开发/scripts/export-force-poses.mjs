import {writeFileSync,mkdirSync} from 'node:fs';
import {createAnatomyAtlas} from '../atlas-model.js';
import {captureForcePoses,forceReferencePositions} from './force-pose-data.mjs';
const atlas=createAnatomyAtlas({rigged:true}),data=captureForcePoses(atlas);
mkdirSync('.qa',{recursive:true});
writeFileSync('.qa/force-poses.json',JSON.stringify(data));
writeFileSync('.qa/force-reference-poses.json',JSON.stringify(captureForcePoses(atlas,id=>id==='pushup'?forceReferencePositions:[])));
