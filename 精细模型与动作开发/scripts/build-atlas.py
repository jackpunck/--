"""Extract only skeletal/muscular geometry; never execute downloaded Blender scripts.

Derived geometry: CC BY-SA 4.0, Z-Anatomy / BodyParts3D. See assets/ANATOMY-SOURCE.md.
Run from 3d-demo after installing bpy into .qa/bpy_runtime.
"""
import sys,json,zlib,base64,array,re
from pathlib import Path
sys.path.insert(0,str(Path('.qa/bpy_runtime').resolve()))
import bpy
from mathutils import Vector

inventory=json.loads(Path('.qa/z-anatomy/Z-Anatomy-inventory.json').read_text())
name_corrections=json.loads(Path('assets/anatomy-name-corrections.json').read_text())
excluded=('arytenoid','pharynge','thyro','crico','glossus','anal','pubo','coccyge','levator ani','tarsus','rectus muscle','superior oblique muscle','inferior oblique muscle','palpebrae','tendinous ring','trochlea','intercostal','transversus thoracis','diaphragm','stapes','incus','malleus')
selected=[]
for o in inventory['objects']:
    if o['type']!='MESH' or o['faces']<3 or o['name'].endswith(('.g','.j')):continue
    cols=o['collections']; name=o['name'].lower()
    kind='muscle' if 'Muscles' in cols else 'bone' if '1: Skeletal system' in cols else None
    if not kind or any(k in name for k in excluded):continue
    if kind=='bone' and any(k in name for k in ['suture','fontanel','cavity','line','foramen']):continue
    selected.append((o['name'],kind))
bpy.context.preferences.filepaths.use_scripts_auto_execute=False
bpy.ops.wm.read_factory_settings(use_empty=True)
with bpy.data.libraries.load(str(Path('.qa/z-anatomy/Z-Anatomy/Startup.blend').resolve())) as (src,dst):
    dst.objects=[n for n,k in selected]
for o in dst.objects:
    if o:bpy.context.scene.collection.objects.link(o)
bpy.context.view_layer.update()
payload=bytearray(); manifest=[]
roles={'chest':['pectoralis'],'biceps':['biceps brachii'],'triceps':['triceps brachii'],'deltoids':['deltoid'],'lats':['latissimus dorsi'],'traps':['trapezius'],'core':['rectus abdominis','transversus abdominis'],'obliques':['abdominal oblique'],'quads':['vastus','rectus femoris'],'hamstrings':['biceps femoris','semitendinosus','semimembranosus'],'glutes':['gluteus'],'calves':['gastrocnemius','soleus','plantaris muscle'],'forearms':['carpi ','brachioradialis','pronator ','supinator','palmaris longus','flexor digitorum profundus','flexor digitorum superficialis','extensor digitorum.','extensor digiti minimi','extensor indicis','flexor pollicis longus','extensor pollicis longus','abductor pollicis longus','extensor pollicis brevis']}
deps=bpy.context.evaluated_depsgraph_get()
for number,(name,kind) in enumerate(selected):
    o=bpy.data.objects.get(name)
    # Atlas is unrigged. Preserve its anatomical rest pose instead of inventing motion.
    for m in list(o.modifiers):o.modifiers.remove(m)
    faces=len(o.data.polygons)
    if faces>1200:
        m=o.modifiers.new('Web detail reduction','DECIMATE');m.ratio=max(.12,min(1,1800/faces))
    deps.update()
    evaluated=o.evaluated_get(deps);mesh=evaluated.to_mesh();mesh.calc_loop_triangles()
    coords=[o.matrix_world@v.co for v in mesh.vertices]
    positions=array.array('h'); normals=array.array('b'); indices=array.array('H')
    # Quantization step: 0.1mm in original anatomical coordinates.
    nmat=o.matrix_world.to_3x3().inverted().transposed()
    for v,p in zip(mesh.vertices,coords):
        positions.extend(round(c*10000) for c in (p.x,p.z,-p.y))
        n=(nmat@v.normal).normalized();normals.extend(round(c*127) for c in (n.x,n.z,-n.y))
    mirrored=o.matrix_world.to_3x3().determinant()<0
    for t in mesh.loop_triangles:
        a,b,c=t.vertices
        indices.extend((a,c,b) if mirrored else (a,b,c))
    role=next((r for r,keys in roles.items() if any(k in name.lower() for k in keys)),None)
    canonical_name=name_corrections.get(name,name)
    manifest.append({'name':canonical_name,**({'sourceName':name} if canonical_name!=name else {}),'kind':kind,'role':role,'vertices':len(coords),'indices':len(indices),'offset':len(payload)})
    payload.extend(positions.tobytes());payload.extend(normals.tobytes());payload.extend(indices.tobytes())
    evaluated.to_mesh_clear()
    if number%100==0:print('Extracted',number,flush=True)
data={'source':'Z-Anatomy / BodyParts3D','license':'CC-BY-SA-4.0','scale':1.85,'positionScale':.0001,'meshes':manifest,'data':base64.b64encode(zlib.compress(payload,9)).decode('ascii')}
Path('assets/anatomy-atlas.json').write_text(json.dumps(data,separators=(',',':')))
Path('assets/anatomy-manifest.json').write_text(json.dumps(manifest,indent=2))
print('Exported',len(manifest),'structures;',sum(m['indices']//3 for m in manifest),'triangles;',len(data['data']),'base64 bytes',flush=True)
