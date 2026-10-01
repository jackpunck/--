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
    #ifdef SURFACE_GRADIENTS
      attribute vec3 skinGradient0;
      attribute vec3 skinGradient1;
      attribute vec3 skinGradient2;
      attribute vec3 skinGradient3;
      vec3 dqSurfaceDirection(vec3 direction, vec3 p, vec4 r, vec4 d, float magnitude, vec4 reference) {
        vec4 rates = vec4(dot(skinGradient0,direction),dot(skinGradient1,direction),dot(skinGradient2,direction),dot(skinGradient3,direction));
        vec4 dr = vec4(0.0), dd = vec4(0.0);
        for (int k = 0; k < 4; k++) {
          int joint = int(skinIndex[k]);
          float rate = rates[k] * (dot(reference,dqReal[joint]) < 0.0 ? -1.0 : 1.0);
          dr += rate * dqReal[joint]; dd += rate * dqDual[joint];
        }
        float lengthRate = dot(r,dr);
        dr = (dr-r*lengthRate)/magnitude; dd = (dd-d*lengthRate)/magnitude;
        return dqRotate(r,direction)
          + 2.0*cross(dr.xyz,cross(r.xyz,p)+r.w*p)
          + 2.0*cross(r.xyz,cross(dr.xyz,p)+dr.w*p)
          + 2.0*(dr.w*d.xyz+r.w*dd.xyz-dd.w*r.xyz-d.w*dr.xyz+cross(dr.xyz,d.xyz)+cross(r.xyz,dd.xyz));
      }
    #endif
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
            vec3 dqNormal = dqRotate(dqR, (bindMatrix * vec4(objectNormal, 0.0)).xyz);
            #ifdef SURFACE_GRADIENTS
            if (dot(skinGradient0,skinGradient0)+dot(skinGradient1,skinGradient1)+dot(skinGradient2,skinGradient2)+dot(skinGradient3,skinGradient3) > 0.00000001) {
              vec3 dqN = normalize(objectNormal);
              vec3 dqU = normalize(cross(dqN, abs(dqN.y) < 0.9 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));
              vec3 dqV = cross(dqN,dqU);
              vec3 dqP = (bindMatrix * vec4(position,1.0)).xyz;
              vec3 dqDu = dqSurfaceDirection(dqU,dqP,dqR,dqD,dqLength,dqReference);
              vec3 dqDv = dqSurfaceDirection(dqV,dqP,dqR,dqD,dqLength,dqReference);
              vec3 dqSurfaceNormal = cross(dqDu,dqDv);
              if (dot(dqSurfaceNormal,dqSurfaceNormal) > 0.00000001) dqNormal = normalize(dqSurfaceNormal);
            }
            #endif
            objectNormal = (bindMatrixInverse * vec4(dqNormal, 0.0)).xyz;
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
    material.customProgramCacheKey=()=>`anatomy-dq-v3-${count}`;
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
      if(this.geometry.hasAttribute('skinGradient0'))return surfaceNormal(this,index,target,real,dual);
      // Cancelling two transformed points gives the same rotated direction as
      // the shader. Used by the offline preview exporter, outside the frame loop.
      applyBoneTransform.call(this,index,normalOrigin.set(0,0,0));
      return applyBoneTransform.call(this,index,target).sub(normalOrigin).normalize();
    };
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
      if(mesh.geometry.hasAttribute('skinGradient0'))material.defines={...material.defines,SURFACE_GRADIENTS:1};
      materialSkinning(material);
    }
    if(mesh.castShadow){
      mesh.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
      mesh.customDistanceMaterial=new THREE.MeshDistanceMaterial();
      materialSkinning(mesh.customDepthMaterial);materialSkinning(mesh.customDistanceMaterial);
    }
    return mesh;
  };
}

// CPU equivalent of the differential above, for exports and numerical tests.
// The anatomical rig uses identity bind matrices and rigid joint transforms.
function surfaceNormal(mesh,index,target,real,dual){
  const g=mesh.geometry,offset=index*4,ids=g.attributes.skinIndex.array,w=g.attributes.skinWeight.array;
  let refSlot=0;for(let k=1;k<4;k++)if(w[offset+k]>w[offset+refSlot])refSlot=k;
  const ref=ids[offset+refSlot]*4,r=[0,0,0,0],d=[0,0,0,0],signs=[];
  for(let k=0;k<4;k++){
    const b=ids[offset+k]*4;let dot=0;for(let j=0;j<4;j++)dot+=real[ref+j]*real[b+j];
    signs[k]=dot<0?-1:1;
    for(let j=0;j<4;j++){r[j]+=w[offset+k]*signs[k]*real[b+j];d[j]+=w[offset+k]*signs[k]*dual[b+j];}
  }
  const length=Math.max(Math.hypot(...r),1e-6);for(let j=0;j<4;j++){r[j]/=length;d[j]/=length;}
  const rv=new THREE.Vector3(...r),dv=new THREE.Vector3(...d),q=new THREE.Quaternion(...r);
  const p=new THREE.Vector3().fromBufferAttribute(g.attributes.position,index),n=target.clone().normalize();
  const u=n.clone().cross(Math.abs(n.y)<.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0)).normalize(),v=n.clone().cross(u);
  function derivative(direction){
    const dr=[0,0,0,0],dd=[0,0,0,0],gradient=new THREE.Vector3();
    for(let k=0;k<4;k++){
      const rate=gradient.fromBufferAttribute(g.attributes['skinGradient'+k],index).dot(direction)*signs[k],b=ids[offset+k]*4;
      for(let j=0;j<4;j++){dr[j]+=rate*real[b+j];dd[j]+=rate*dual[b+j];}
    }
    const lengthRate=r.reduce((sum,x,j)=>sum+x*dr[j],0);
    for(let j=0;j<4;j++){dr[j]=(dr[j]-r[j]*lengthRate)/length;dd[j]=(dd[j]-d[j]*lengthRate)/length;}
    const drv=new THREE.Vector3(...dr),ddv=new THREE.Vector3(...dd);
    return direction.clone().applyQuaternion(q)
      .addScaledVector(drv.clone().cross(rv.clone().cross(p).addScaledVector(p,r[3])),2)
      .addScaledVector(rv.clone().cross(drv.clone().cross(p).addScaledVector(p,dr[3])),2)
      .addScaledVector(dv,2*dr[3]).addScaledVector(ddv,2*r[3]).addScaledVector(rv,-2*dd[3]).addScaledVector(drv,-2*d[3])
      .addScaledVector(drv.clone().cross(dv),2).addScaledVector(rv.clone().cross(ddv),2);
  }
  target.crossVectors(derivative(u),derivative(v));
  if(target.lengthSq()<1e-8)target.copy(n).applyQuaternion(q);
  return target.normalize();
}
