import * as THREE from 'three';
import {createAnatomyAtlas} from '../atlas-model.js';
import {animatedExercises} from '../exercise-catalog.js';

// Render sampled deformed positions to a floating-point target, then compare
// them with CPU picking. This exercises the actual shader on WebGL, including
// the same skinning chunks used by surface, selection and shadow materials.
try{
  const atlas=createAnatomyAtlas({rigged:true}),samples=[];
  for(const mesh of atlas.pickableMeshes)for(let i=0;i<mesh.geometry.attributes.position.count;i+=503)samples.push({mesh,i});
  const geometry=new THREE.BufferGeometry();
  for(const [name,size,Type] of [['position',3,Float32Array],['skinIndex',4,Uint16Array],['skinWeight',4,Float32Array]]){
    const values=new Type(samples.length*size);
    samples.forEach(({mesh,i},j)=>values.set(mesh.geometry.attributes[name].array.subarray(i*size,(i+1)*size),j*size));
    geometry.setAttribute(name,new THREE.BufferAttribute(values,size));
  }
  geometry.setAttribute('sampleIndex',new THREE.Float32BufferAttribute(samples.map((_,i)=>i),1));
  const material=new THREE.ShaderMaterial({vertexShader:`
    #include <common>
    #include <skinning_pars_vertex>
    attribute float sampleIndex;
    varying vec3 resultPosition;
    void main(){
      #include <skinbase_vertex>
      #include <begin_vertex>
      #include <skinning_vertex>
      resultPosition=transformed;
      gl_Position=vec4((sampleIndex+.5)/${samples.length}.0*2.0-1.0,0.0,0.0,1.0);
      gl_PointSize=1.0;
    }`,fragmentShader:'varying vec3 resultPosition; void main(){gl_FragColor=vec4(resultPosition,1.0);}',depthTest:false,depthWrite:false});
  const mesh=new THREE.SkinnedMesh(geometry,material);mesh.bind(atlas.rig.skeleton,new THREE.Matrix4());atlas.rig.skinMesh(mesh);mesh.frustumCulled=false;
  // WebGLRenderer selects its point primitive from isPoints; retaining the
  // SkinnedMesh also keeps Three's skeleton updates and USE_SKINNING define.
  mesh.isPoints=true;mesh.isMesh=false;
  const scene=new THREE.Scene();scene.add(mesh);scene.add(atlas.body);atlas.pickableMeshes.forEach(m=>m.visible=false);
  atlas.rig.staticProps.visible=false;
  const renderer=new THREE.WebGLRenderer();renderer.setSize(samples.length,1);document.body.append(renderer.domElement);
  if(!renderer.extensions.has('EXT_color_buffer_float'))throw new Error('Float render targets unavailable');
  const target=new THREE.WebGLRenderTarget(samples.length,1,{type:THREE.FloatType,format:THREE.RGBAFormat,depthBuffer:false});
  const camera=new THREE.Camera(),pixels=new Float32Array(samples.length*4),expected=new THREE.Vector3();let maxError=0,vertices=0;
  for(const id of animatedExercises)for(const q of [0,.5,1]){
    atlas.rig.pose(q,id);atlas.rig.staticProps.visible=false;atlas.rig.weights.forEach(m=>m.visible=false);
    renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,samples.length,1,pixels);
    for(let j=0;j<samples.length;j++){
      const {mesh:source,i}=samples[j];source.getVertexPosition(i,expected);
      const error=Math.hypot(pixels[j*4]-expected.x,pixels[j*4+1]-expected.y,pixels[j*4+2]-expected.z);
      if(pixels[j*4+3]!==1||error>5e-6)throw new Error(`${id} ${q} sample ${j}: GPU / CPU mismatch ${error}, GPU ${pixels.slice(j*4,j*4+4)}, CPU ${expected.toArray()}`);
      maxError=Math.max(maxError,error);vertices++;
    }
  }
  window.qaResult={actions:animatedExercises.length,poses:animatedExercises.length*3,vertices,maxError};
  target.dispose();renderer.dispose();
}catch(error){window.qaResult={error:error.stack||String(error)};}
