import * as THREE from 'three';

// Rigid joint transforms blended as dual quaternions keep soft tissue from
// collapsing into a bent joint. Geometry, weights and rigid bones stay intact.
// CPU picking uses the same blend as the visible, highlight and shadow passes.
export function createDualQuaternionSkinning(skeleton){
  const count=skeleton.bones.length,real=new Float32Array(count*4),dual=new Float32Array(count*4);
  const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion();
  const update=skeleton.update.bind(skeleton);
  skeleton.update=function(){
    update();
    for(let i=0;i<count;i++){
      matrix.fromArray(this.boneMatrices,i*16);rotation.setFromRotationMatrix(matrix).normalize();
      const {x,y,z,w}=rotation,tx=matrix.elements[12],ty=matrix.elements[13],tz=matrix.elements[14],k=i*4;
      real[k]=x;real[k+1]=y;real[k+2]=z;real[k+3]=w;
      dual[k]=.5*(tx*w+ty*z-tz*y);dual[k+1]=.5*(-tx*z+ty*w+tz*x);
      dual[k+2]=.5*(tx*y-ty*x+tz*w);dual[k+3]=-.5*(tx*x+ty*y+tz*z);
    }
  };
  skeleton.update();
  const declarations=`
    uniform vec4 dqReal[${count}];
    uniform vec4 dqDual[${count}];
    vec3 dqRotate(vec4 q, vec3 p) { return p + 2.0 * cross(q.xyz, cross(q.xyz, p) + q.w * p); }
  `;
  const blend=`
    #ifdef USE_SKINNING
      vec4 dqR = vec4(0.0), dqD = vec4(0.0);
      int dqRef = 0;
      for (int k = 1; k < 4; k++) { if (skinWeight[k] > skinWeight[dqRef]) dqRef = k; }
      vec4 dqReference = dqReal[int(skinIndex[dqRef])];
      for (int k = 0; k < 4; k++) {
        int joint = int(skinIndex[k]);
        float weight = skinWeight[k] * (dot(dqReference, dqReal[joint]) < 0.0 ? -1.0 : 1.0);
        dqR += weight * dqReal[joint]; dqD += weight * dqDual[joint];
      }
      float dqLength = max(length(dqR), 0.000001);
      dqR /= dqLength; dqD /= dqLength;
    #endif
  `;
  function materialSkinning(material){
    material.onBeforeCompile=shader=>{
      shader.uniforms.dqReal={value:real};shader.uniforms.dqDual={value:dual};
      shader.vertexShader=shader.vertexShader
        .replace('#include <skinning_pars_vertex>','#include <skinning_pars_vertex>\n'+declarations)
        .replace('#include <skinbase_vertex>',blend)
        .replace('#include <skinnormal_vertex>',`
          #ifdef USE_SKINNING
            objectNormal = (bindMatrixInverse * vec4(dqRotate(dqR, (bindMatrix * vec4(objectNormal, 0.0)).xyz), 0.0)).xyz;
            #ifdef USE_TANGENT
              objectTangent = (bindMatrixInverse * vec4(dqRotate(dqR, (bindMatrix * vec4(objectTangent, 0.0)).xyz), 0.0)).xyz;
            #endif
          #endif
        `)
        .replace('#include <skinning_vertex>',`
          #ifdef USE_SKINNING
            vec3 dqTranslation = 2.0 * (dqR.w * dqD.xyz - dqD.w * dqR.xyz + cross(dqR.xyz, dqD.xyz));
            transformed = (bindMatrixInverse * vec4(dqRotate(dqR, (bindMatrix * vec4(transformed, 1.0)).xyz) + dqTranslation, 1.0)).xyz;
          #endif
        `);
    };
    material.customProgramCacheKey=()=>`anatomy-dq-v2-${count}`;
  }
  function applyBoneTransform(index,target){
    const indices=this.geometry.attributes.skinIndex,weights=this.geometry.attributes.skinWeight,offset=index*4;
    let reference=0;for(let k=1;k<4;k++)if(weights.array[offset+k]>weights.array[offset+reference])reference=k;
    const ref=indices.array[offset+reference]*4;let x=0,y=0,z=0,w=0,dx=0,dy=0,dz=0,dw=0;
    for(let k=0;k<4;k++){
      const b=indices.array[offset+k]*4;
      let weight=weights.array[offset+k];if(!weight)continue;
      if(real[ref]*real[b]+real[ref+1]*real[b+1]+real[ref+2]*real[b+2]+real[ref+3]*real[b+3]<0)weight=-weight;
      x+=weight*real[b];y+=weight*real[b+1];z+=weight*real[b+2];w+=weight*real[b+3];
      dx+=weight*dual[b];dy+=weight*dual[b+1];dz+=weight*dual[b+2];dw+=weight*dual[b+3];
    }
    const length=Math.max(Math.hypot(x,y,z,w),.000001);
    x/=length;y/=length;z/=length;w/=length;dx/=length;dy/=length;dz/=length;dw/=length;
    target.applyMatrix4(this.bindMatrix);
    const px=target.x,py=target.y,pz=target.z,cx=y*pz-z*py,cy=z*px-x*pz,cz=x*py-y*px;
    target.set(px+2*(y*cz-z*cy+w*cx)+2*(w*dx-dw*x+y*dz-z*dy),
      py+2*(z*cx-x*cz+w*cy)+2*(w*dy-dw*y+z*dx-x*dz),
      pz+2*(x*cy-y*cx+w*cz)+2*(w*dz-dw*z+x*dy-y*dx));
    return target.applyMatrix4(this.bindMatrixInverse);
  }
  const normalOrigin=new THREE.Vector3();
  return mesh=>{
    mesh.applyBoneTransform=applyBoneTransform;
    mesh.applyBoneNormal=function(index,target){
      // Cancelling two transformed points gives the same rotated direction as
      // the shader. Used by the offline preview exporter, outside the frame loop.
      applyBoneTransform.call(this,index,normalOrigin.set(0,0,0));
      return applyBoneTransform.call(this,index,target).sub(normalOrigin).normalize();
    };
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])materialSkinning(material);
    if(mesh.castShadow){
      mesh.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
      mesh.customDistanceMaterial=new THREE.MeshDistanceMaterial();
      materialSkinning(mesh.customDepthMaterial);materialSkinning(mesh.customDistanceMaterial);
    }
    return mesh;
  };
}
