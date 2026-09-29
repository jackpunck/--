"""Reproducible, reduced quasi-static force estimates, NOT measured human forces.

Run export-force-poses.mjs first. Requires opensim==4.6, scipy==1.18.1.
OpenSim supplies muscle paths/moment arms and capacities. Ideal force actuators
are allocated by min sum(a**2), R Fmax a = required moments, 0 <= a <= 1.
Inertia, passive force, force-length-velocity and co-contraction are excluded.
"""
import hashlib
import json
import os
from pathlib import Path
import numpy as np
import opensim as osim
from scipy.optimize import least_squares, linprog, minimize

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'assets/force-models'
POSES = json.loads((ROOT / '.qa/force-poses.json').read_text())
osim.Logger.setLevelString('error')
G = 9.80665

def vec(v):
    return np.array([v.get(i) for i in range(3)])

def rotation(body, state):
    r = body.getTransformInGround(state).R().asMat33()
    return np.array([[r.get(i,j) for j in range(3)] for i in range(3)])

def body_com(body, state):
    return vec(body.findStationLocationInGround(state, body.getMassCenter()))

def station(body, state, point):
    return vec(body.findStationLocationInGround(state, osim.Vec3(*map(float,point))))

def unit(v):
    return v/np.linalg.norm(v)

def rig_to_local(v, pitch):
    x,y,z=v
    return np.array([-np.sin(pitch)*y+np.cos(pitch)*z,np.cos(pitch)*y+np.sin(pitch)*z,-x])

def load_model(filename):
    # OpenSim's Windows file API cannot open a Unicode absolute path.
    previous=Path.cwd()
    try:
        os.chdir(MODELS);m=osim.Model(filename);s=m.initSystem()
    finally:os.chdir(previous)
    return m,s

def set_coords(m,s,values):
    for key,value in values.items(): m.getCoordinateSet().get(key).setValue(s,float(value),False)
    m.assemble(s);m.realizePosition(s)

def generalized_external(m,s,keys,forces):
    """Virtual work from point forces; force/attachment frozen during derivatives."""
    result=[]
    h=1e-5
    for key in keys:
        c=m.getCoordinateSet().get(key);base=c.getValue(s)
        positions=[]
        for delta in [h,-h]:
            set_coords(m,s,{key:base+delta})
            positions.append([station(b,s,p) for b,p,f in forces])
        set_coords(m,s,{key:base})
        result.append(sum(np.dot(f,(plus-minus)/(2*h)) for (b,p,f),plus,minus in zip(forces,*positions)))
    return np.array(result)

def gravity_forces(m,s,gravity):
    return [(b,vec(b.getMassCenter()),b.getMass()*gravity) for b in m.getBodySet() if b.getMass()>0]

def moment_matrix(m,s,keys,muscles):
    return np.array([[muscle.computeMomentArm(s,m.getCoordinateSet().get(key)) for muscle in muscles] for key in keys])

def group_for(name):
    if name.startswith('glut_'):return 'glutes'
    if name.startswith(('vas_','rect_fem')):return 'quads'
    if name.startswith(('bifem','semimem','semiten')):return 'hamstrings'
    if name.startswith(('med_gas','lat_gas','soleus')):return 'calves'
    if name.startswith('BIC'):return 'biceps'
    if name.startswith('TRI'):return 'triceps'
    if name.startswith('PEC'):return 'chest'
    if name.startswith('DELT'):return 'deltoids'
    if name.startswith('LAT'):return 'lats'
    return None

def muscle_meta(muscles):
    return [dict(id=m.getName(),group=group_for(m.getName()),capacity=round(m.getMaxIsometricForce(),6)) for m in muscles]

def squat_samples():
    m,s=load_model('gait2392.osim')
    keys=['hip_flexion_r','knee_angle_r','ankle_angle_r']
    muscles=[x for x in m.getMuscles() if x.getName().endswith('_r') and x.getName() not in ['ercspn_r','intobl_r','extobl_r']]
    samples=[]
    mass=m.getTotalMass(s)
    for pose in POSES['poses']['squat']:
        q=pose['q'];j={k:np.array(v) for k,v in pose['joints'].items()}
        thigh=np.arctan2(j['knee'][2]-j['hip'][2],j['hip'][1]-j['knee'][1])
        shin=np.arctan2(j['knee'][2]-j['ankle'][2],j['knee'][1]-j['ankle'][1])
        pitch=pose['torsoPitch']
        values={'pelvis_tilt':-pitch,'lumbar_extension':0}
        for side in ['r','l']:
            values.update({f'hip_flexion_{side}':thigh+pitch,f'knee_angle_{side}':-thigh-shin,f'ankle_angle_{side}':shin})
        set_coords(m,s,values)
        com=vec(m.calcMassCenterPosition(s))
        torso=m.getBodySet().get('torso');loadpoint=np.array([0,.45,0])
        loadworld=station(torso,s,loadpoint)
        # The assumed COP moves with the total COM. Its contribution to joint
        # torque is affine in load: F*(COM-foot) = sum(W_i*(COM_i-foot)).
        gravity=gravity_forces(m,s,np.array([0,-G,0]))
        moments=[]
        for load in [0,1]:
            total=mass+load;cop=(mass*com+load*loadworld)/total
            external=list(gravity)+[(torso,loadpoint,np.array([0,-load*G,0]))]
            for side in ['r','l']:
                foot=m.getBodySet().get('calcn_'+side);origin=vec(foot.getPositionInGround(s))
                world=np.array([cop[0],origin[1],origin[2]])
                local=rotation(foot,s).T@(world-origin)
                external.append((foot,local,np.array([0,total*G/2,0])))
            moments.append(-generalized_external(m,s,keys,external))
        samples.append(dict(q=q,R=moment_matrix(m,s,keys,muscles).tolist(),base=moments[0].tolist(),load=(moments[1]-moments[0]).tolist()))
    return dict(model='Gait2392 / ideal actuators',mass=mass,keys=keys,muscles=muscle_meta(muscles),samples=samples,maxLoad=60,loadStep=3)

def arm_samples(exercise,initial_coordinates=None):
    m,s=load_model('mobl.osim')
    keys=['elv_angle','shoulder_elv','shoulder_rot','elbow_flexion']
    # Remaining wrist/pronation coordinates are constrained in this reduced model.
    set_coords(m,s,{'r_x':0,'r_y':0,'r_z':0,'pro_sup':0 if exercise=='curl' else 1.57})
    muscles=list(m.getMuscles())
    upper=m.getBodySet().get('humerus');lower=m.getBodySet().get('ulna');hand=m.getBodySet().get('hand')
    bounds=([-1.65,.025,-1.57,0],[2.26,3.14,2.09,2.269])
    previous=np.array([1.57,.3,0,.2] if initial_coordinates is None else initial_coordinates);samples=[];max_error=0;max_angle_error=0
    for index,pose in enumerate(POSES['poses'][exercise]):
        q=pose['q'];j={k:np.array(v) for k,v in pose['joints'].items()}
        pitch=pose['torsoPitch']
        targets=[unit(rig_to_local(j['elbow']-j['shoulder'],pitch)),unit(rig_to_local(j['wrist']-j['elbow'],pitch))]
        def residual(x):
            set_coords(m,s,dict(zip(keys,x)))
            sh=vec(upper.getPositionInGround(s));el=vec(lower.getPositionInGround(s));wr=vec(hand.getPositionInGround(s))
            return np.r_[unit(el-sh)-targets[0],unit(wr-el)-targets[1]]
        fit=least_squares(residual,previous,bounds=bounds,xtol=1e-10,ftol=1e-10,gtol=1e-10,max_nfev=100)
        if not fit.success:
            # Near extension, shoulder axial rotation is weakly constrained.
            # Continue the fit before deciding whether the pose is usable.
            fit=least_squares(residual,fit.x,bounds=bounds,xtol=1e-10,ftol=1e-10,gtol=1e-10,max_nfev=500)
        previous=fit.x;residual(fit.x)
        error=float(np.max(np.abs(fit.fun)));max_error=max(max_error,error)
        fitted=np.array(targets)+fit.fun.reshape(2,3)
        angle_error=float(np.max(np.degrees(np.arccos(np.clip(np.sum(fitted*np.array(targets),axis=1),-1,1)))))
        max_angle_error=max(max_angle_error,angle_error)
        if not fit.success or angle_error>5:
            raise RuntimeError(f'{exercise} q={q}: pose fit is not reliable ({angle_error:.3f} deg)')
        gravity=gravity_forces(m,s,rig_to_local(np.array([0,-G,0]),pitch))
        # Curl: actual rendered weight center attached to the hand.
        scale=POSES['height']/POSES['displayHeight']
        if exercise=='curl':
            offset=rig_to_local((np.array(pose['dumbbell'])-j['wrist'])*scale,pitch)
            point=rotation(hand,s).T@offset
            base=-generalized_external(m,s,keys,gravity)
            perkg=-generalized_external(m,s,keys,[(hand,point,rig_to_local(np.array([0,-G,0]),pitch))])
        else:
            # Symmetric plank: vertical reactions balance total weight and its
            # sagittal moment. Standard segment masses from Gait2392 + arm model.
            bodymass=75.1646;armmass=m.getTotalMass(s);scale=POSES['height']/POSES['displayHeight']
            torso_com=j['hip']+.4*(j['shoulder']-j['hip'])
            thigh_com=j['hip']+.433*(j['knee']-j['hip'])
            shin_com=j['knee']+.433*(j['ankle']-j['knee'])
            arm_com=(j['shoulder']+j['elbow']+j['wrist'])/3
            weights=[(45.914-2*armmass,torso_com),(18.6028,thigh_com),(7.415,shin_com),(3.2328,j['ankle']),(2*armmass,arm_com)]
            distance=j['wrist'][2]-j['ankle'][2]
            hand_force=G*sum(mass*(p[2]-j['ankle'][2]) for mass,p in weights)/distance/2
            load_pos=j['hip']+.65*(j['shoulder']-j['hip'])
            perkg_force=G*(load_pos[2]-j['ankle'][2])/distance/2
            point=np.zeros(3)
            base=-generalized_external(m,s,keys,gravity+[(hand,point,rig_to_local(np.array([0,hand_force,0]),pitch))])
            perkg=-generalized_external(m,s,keys,[(hand,point,rig_to_local(np.array([0,perkg_force,0]),pitch))])
        samples.append(dict(q=q,R=moment_matrix(m,s,keys,muscles).tolist(),base=base.tolist(),load=perkg.tolist(),poseError=error,poseErrorDegrees=angle_error,coordinates=fit.x.tolist()))
        if index%25==0:print(exercise,'pose',index,'/',len(POSES['poses'][exercise])-1,flush=True)
    print(exercise,'max direction fit error (degrees)',max_angle_error,flush=True)
    return dict(model='MoBL-ARMS / ideal actuators',mass=75.1646,keys=keys,muscles=muscle_meta(muscles),samples=samples,maxLoad=20 if exercise=='curl' else 30,loadStep=1 if exercise=='curl' else 1.5,maxPoseError=max_error,maxPoseErrorDegrees=max_angle_error)

def solve(R,capacities,target,initial=None):
    B=R*capacities
    # Scale constraint rows for solver conditioning, keep residual in Nm.
    scale=np.maximum(np.linalg.norm(B,axis=1),1)
    A=B/scale[:,None];b=target/scale
    def optimize(start):
        return minimize(lambda a:.5*np.dot(a,a),start,jac=lambda a:a,
                    constraints={'type':'eq','fun':lambda a:A@a-b,'jac':lambda a:A},bounds=[(0,1)]*len(capacities),
                    method='SLSQP',options={'ftol':1e-11,'maxiter':150})
    def checked(result):
        residual=float(np.max(np.abs(B@result.x-target)))
        valid=bool(result.success and residual<.02 and np.all(np.isfinite(result.x)) and np.all(result.x>=-1e-9) and np.all(result.x<=1+1e-9))
        return valid,residual
    result=optimize(np.zeros(len(capacities)) if initial is None else initial)
    valid,residual=checked(result)
    if not valid:
        # A numerical optimizer failure does not prove physical infeasibility.
        # First check the same bounded linear constraints with an independent LP.
        feasible=linprog(np.zeros(len(capacities)),A_eq=A,b_eq=b,bounds=(0,1),method='highs')
        if feasible.status==2:return result.x,False,residual
        if not feasible.success:raise RuntimeError('Muscle feasibility check failed: '+feasible.message)
        result=optimize(feasible.x);valid,residual=checked(result)
        if not valid:raise RuntimeError(f'Feasible muscle allocation failed to converge: {result.message}; residual {residual}')
    return result.x,True,residual

def main():
    result={'version':2,'engine':osim.GetVersionAndDate(),'method':'quasi-static ideal-muscle minimum squared activation','gravity':G,'referenceMassKg':75.1646,'referenceHeightM':1.75,'colorMaxN':3000,'poseSourceSha256':hashlib.sha256((ROOT/'.qa/force-poses.json').read_bytes()).hexdigest(),'exercises':{}}
    for name,build in [('squat',squat_samples),('curl',lambda:arm_samples('curl')),('pushup',lambda:arm_samples('pushup'))]:
        data=build();capacities=np.array([x['capacity'] for x in data['muscles']]);loads=np.arange(0,data['maxLoad']+.001,data['loadStep'])
        data['loads']=loads.tolist();failures=0;max_residual=0
        for index,sample in enumerate(data['samples']):
            R=np.array(sample['R']);base=np.array(sample['base']);unitload=np.array(sample['load'])
            rows=[];initial=None
            for load in loads:
                a,valid,residual=solve(R,capacities,base+unitload*load,initial)
                initial=a if valid else None;failures+=not valid
                if valid:max_residual=max(max_residual,residual)
                rows.append([round(float(f),4) for f in a*capacities] if valid else None)
            sample['forces']=rows
            if index%25==0:print(name,'force grid',index,'/',len(data['samples'])-1,flush=True)
        data['validation']={'invalidNodes':failures,'maxEquilibriumResidualNm':max_residual}
        print(name,data['validation'],flush=True)
        result['exercises'][name]=data
    result['sources']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in MODELS.glob('*.osim')}
    output=ROOT/'assets/muscle-force-tables.json'
    output.write_text(json.dumps(result,separators=(',',':')),encoding='utf8')
    print(output,output.stat().st_size,flush=True)

if __name__=='__main__':main()
