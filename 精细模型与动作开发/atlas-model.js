import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {decodeAtlasData} from './atlas-decode.js';
import asset from './assets/anatomy-atlas.json' with { type: 'json' };
import {createAtlasRig} from './atlas-rig.js';
import {muscleGroups,muscleRole,structureLabel} from './muscle-data.js';

// Geometry is derived from Z-Anatomy / BodyParts3D, CC BY-SA 4.0.
// Optional teaching rig preserves the imported geometry and adds GPU skinning.
export function createAnatomyAtlas({rigged=false,decoded=null}={}){
  const meshes=decoded||decodeAtlasData(asset);
  const body=new THREE.Group();body.name='Z-Anatomy anatomical atlas';
  const batches=new Map(),anchors={},muscleMeshes=[],sources=[],structureMap=new Map(),pickableMeshes=[];
  for(const [meshIndex,item] of asset.meshes.entries()){
    const {position,normal,index}=meshes[meshIndex];
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(position,3));
    g.setAttribute('normal',new THREE.BufferAttribute(normal,3));
    g.setIndex(new THREE.BufferAttribute(index,1));
    sources.push({item,geometry:g});
  }
  const rig=rigged?createAtlasRig(body,sources):null;
  for(const {item,geometry:g} of sources){
    if(rig)rig.bindGeometry(g,item);
    const key=(item.kind==='muscle'&&muscleRole(item.name))||item.kind;
    if(!batches.has(key))batches.set(key,[]);batches.get(key).push({geometry:g,item});
  }
  for(const [key,entries] of batches){
    const geometries=entries.map(entry=>entry.geometry);
    const geometry=mergeGeometries(geometries);geometry.computeBoundingSphere();
    const material=new THREE.MeshStandardMaterial({color:'#807b71',roughness:.69,metalness:.08,side:THREE.DoubleSide});
    material.shadowSide=THREE.FrontSide;
    const mesh=rig?new THREE.SkinnedMesh(geometry,material):new THREE.Mesh(geometry,material);mesh.name=key;mesh.castShadow=true;mesh.receiveShadow=true;
    if(rig){mesh.bind(rig.skeleton,new THREE.Matrix4());rig.skinMesh(mesh);mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,1.3,0),5);mesh.frustumCulled=false;}
    mesh.userData.kind=key==='bone'?'bone':'muscle';
    if(!['muscle','bone'].includes(key)){mesh.userData.muscle=key;muscleMeshes.push(mesh);}
    let firstFace=0;mesh.userData.structures=[];
    for(const {geometry:g,item} of entries){
      const info={structure:item.name,name:structureLabel(item.name),kind:item.kind,muscle:item.kind==='muscle'?muscleRole(item.name):null,mesh,firstFace,faceCount:g.index.count/3};
      mesh.userData.structures.push(info);structureMap.set(item.name,info);firstFace+=info.faceCount;
    }
    body.add(mesh);pickableMeshes.push(mesh);geometries.forEach(g=>g.dispose());
  }
  for(const [key,{anchor:xyz,bone}] of Object.entries(muscleGroups)){
    if(rig)anchors[key]=rig.attach(new THREE.Vector3(...xyz),bone);
    else {const a=new THREE.Object3D();a.position.set(...xyz);anchors[key]=a;body.add(a);}
  }
  const focus=rig?{upper:rig.attach(new THREE.Vector3(0,2.40,0),'chest'),lower:rig.attach(new THREE.Vector3(0,1.0,0),'thigh.l')}:null;
  // Keep materials and geometry stable. Only their color values change per frame.
  let activityMaterials=[],activityApplied=false,activityOverlay=null;
  const coreMesh=muscleMeshes.find(mesh=>mesh.userData.muscle==='core');
  function updateActivityOverlay(levels){
    const visible=activityMaterials.length>0&&levels?.rows?.some(row=>row.group==='core'&&row.role==='primary');
    if(visible&&!activityOverlay){
      const material=coreMesh.material.clone();material.transparent=true;material.opacity=.8;material.depthTest=false;material.depthWrite=false;
      activityOverlay=rig?new THREE.SkinnedMesh(coreMesh.geometry,material):new THREE.Mesh(coreMesh.geometry,material);
      activityOverlay.userData={...coreMesh.userData,selectionOverlay:true,activityOverlay:true};
      activityOverlay.renderOrder=1;activityOverlay.frustumCulled=false;
      if(rig){activityOverlay.bind(rig.skeleton,new THREE.Matrix4());rig.skinMesh(activityOverlay);}
      body.add(activityOverlay);
    }
    if(activityOverlay){
      activityOverlay.visible=!!visible;
      activityOverlay.material.color.copy(coreMesh.material.color);
      activityOverlay.material.emissive.copy(coreMesh.material.emissive);
    }
  }
  const activityLow=new THREE.Color('#fae6c7'),activityMid=new THREE.Color('#ea9651'),activityHigh=new THREE.Color('#a92f21');
  const activityGlow=new THREE.Color('#4b1004');
  function setActivity(levels){
    if(!levels&&!activityApplied)return;
    for(const {material,muscle,color,emissive,neutral} of activityMaterials){
      const level=levels?.muscles[muscle];
      if(!levels){material.color.copy(color);material.emissive.copy(emissive);continue;}
      if(!Number.isFinite(level)){material.color.copy(neutral);material.emissive.set('#000000');continue;}
      const intensity=THREE.MathUtils.clamp(level,0,1);
      if(intensity<=.5)material.color.lerpColors(activityLow,activityMid,intensity/.5);
      else material.color.lerpColors(activityMid,activityHigh,(intensity-.5)/.5);
      material.emissive.copy(activityGlow).multiplyScalar(intensity*.25);
    }
    updateActivityOverlay(levels);activityApplied=!!levels;
  }
  function setAppearance(mode,active=[],selected=null,highlight=true,seeThrough=false){
    activityMaterials=[];activityApplied=false;if(activityOverlay)activityOverlay.visible=false;
    const roles=new Map(active.map(([id,,,role])=>[id,role||'primary']));
    for(const mesh of body.children){
      if(!mesh.isMesh||mesh.userData.selectionOverlay)continue;
      const role=roles.get(mesh.userData.muscle),isBone=mesh.userData.kind==='bone';
      let color=mode==='neutral'?(isBone?'#a19d90':'#807b71'):(isBone?'#d9c9b1':'#a8695a');
      const neutral=new THREE.Color(color);
      if(highlight&&role)color=role==='secondary'?'#d9ad5c':selected===mesh.userData.muscle?'#dc6347':'#c97553';
      mesh.material.color.set(color);mesh.material.emissive.set(highlight&&selected===mesh.userData.muscle?'#2b1005':'#000000');
      if(highlight&&mesh.userData.muscle)activityMaterials.push({material:mesh.material,muscle:mesh.userData.muscle,color:mesh.material.color.clone(),emissive:mesh.material.emissive.clone(),neutral});
    }
    if(seeThrough&&selected&&highlight)selectGroup(selected);
    else if(selectedMesh?.userData.group)selectStructure(null);
  }
  let selectedMesh=null;
  const selectionMeshes=new Map();
  const selectionMaterial=new THREE.MeshStandardMaterial({color:'#ed714c',emissive:'#421608',roughness:.65,side:THREE.DoubleSide,transparent:true,opacity:.88,depthTest:false,depthWrite:false});
  function selectStructure(name){
    if(selectedMesh&&!selectedMesh.userData.group&&selectedMesh.userData.structure===name)return publicInfo(structureMap.get(name));
    if(selectedMesh){body.remove(selectedMesh);selectedMesh=null;}
    const info=structureMap.get(name);if(!info||info.kind!=='muscle')return null;
    selectedMesh=selectionMeshes.get(info.mesh);
    if(!selectedMesh){
      // Reuse the batch's GPU attributes and index; disposing a temporary shared
      // geometry would also delete those buffers and force a full upload again.
      const geometry=new THREE.BufferGeometry(),source=info.mesh.geometry;
      for(const [key,attribute] of Object.entries(source.attributes))geometry.setAttribute(key,attribute);
      geometry.setIndex(source.index);
      selectedMesh=rig?new THREE.SkinnedMesh(geometry,selectionMaterial):new THREE.Mesh(geometry,selectionMaterial);
      selectedMesh.userData.selectionOverlay=true;selectedMesh.renderOrder=2;selectedMesh.frustumCulled=false;
      if(rig){selectedMesh.bind(rig.skeleton,new THREE.Matrix4());rig.skinMesh(selectedMesh);selectedMesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,1.3,0),5);}
      selectionMeshes.set(info.mesh,selectedMesh);
    }
    selectedMesh.geometry.setDrawRange(info.firstFace*3,info.faceCount*3);
    selectedMesh.userData.structure=name;selectedMesh.userData.group=null;
    selectedMesh.userData.structures=info.mesh.userData.structures;
    body.add(selectedMesh);return publicInfo(info);
  }
  function selectGroup(id){
    if(selectedMesh?.userData.group===id)return;
    const mesh=muscleMeshes.find(item=>item.userData.muscle===id);
    if(!mesh)return;
    selectStructure(mesh.userData.structures[0].structure);
    selectedMesh.geometry.setDrawRange(0,mesh.geometry.index.count);
    selectedMesh.userData.structure=null;selectedMesh.userData.group=id;
  }
  function publicInfo(info){return info?{structure:info.structure,name:info.name,muscle:info.muscle,kind:info.kind}:null;}
  function pickStructure(hit){
    if(!hit?.object?.userData.structures||!Number.isInteger(hit.faceIndex))return null;
    const info=hit.object.userData.structures.find(item=>hit.faceIndex>=item.firstFace&&hit.faceIndex<item.firstFace+item.faceCount);
    return publicInfo(info);
  }
  // Anatomical rest exactly matches the imported vertices. Picking its static
  // surface avoids evaluating skinning again for every candidate triangle.
  const restPickers=pickableMeshes.map(mesh=>{
    const picker=new THREE.Mesh(mesh.geometry,mesh.material);picker.userData=mesh.userData;return picker;
  });
  let selectionPicker=null;
  function raycastStructure(raycaster,anatomicalRest=false){
    body.updateMatrixWorld(true);
    // A see-through highlight is visibly on top. Hit-test that exact geometry
    // first so clicking the highlighted deep muscle does not name its covering.
    if(selectedMesh){
      let target=selectedMesh;
      if(anatomicalRest){
        if(!selectionPicker)selectionPicker=new THREE.Mesh(selectedMesh.geometry,selectedMesh.material);
        selectionPicker.geometry=selectedMesh.geometry;selectionPicker.userData=selectedMesh.userData;
        selectionPicker.matrixWorld.copy(selectedMesh.matrixWorld);target=selectionPicker;
      }
      const selected=pickStructure(raycaster.intersectObject(target,false)[0]);
      if(selected)return selected;
    }
    if(activityOverlay?.visible&&!anatomicalRest){
      const selected=pickStructure(raycaster.intersectObject(activityOverlay,false)[0]);
      if(selected)return selected;
    }
    if(anatomicalRest)restPickers.forEach((mesh,index)=>mesh.matrixWorld.copy(pickableMeshes[index].matrixWorld));
    return pickStructure(raycaster.intersectObjects(anatomicalRest?restPickers:pickableMeshes,false)[0]);
  }
  return {body,anchors,muscleMeshes,pickableMeshes,setAppearance,setActivity,selectStructure,pickStructure,raycastStructure,structureInfo:name=>publicInfo(structureMap.get(name)),structureCount:asset.meshes.length,rig,focus};
}
