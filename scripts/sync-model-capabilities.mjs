import {writeFile} from 'node:fs/promises';
import {exerciseDetails, animatedExercises} from '../精细模型与动作开发/exercise-catalog.js';
const capabilities=Object.fromEntries(Object.keys(exerciseDetails).map(id=>[id,{motion:animatedExercises.includes(id),isometric:id==='plank'}]));
await writeFile(new URL('../public/model-capabilities.js',import.meta.url),`// Generated from the standalone viewer catalog by scripts/sync-model-capabilities.mjs.\nexport const modelCapabilities = Object.freeze(${JSON.stringify(capabilities,null,2)});\n`);
