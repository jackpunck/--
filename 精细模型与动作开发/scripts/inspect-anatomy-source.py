"""Inspect downloaded anatomy data without enabling its embedded scripts."""
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path('.qa/bpy_runtime').resolve()))
import bpy
from mathutils import Vector
bpy.context.preferences.filepaths.use_scripts_auto_execute=False
source=Path(sys.argv[1]).resolve()
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
objects=[]
for o in bpy.data.objects:
    record={'name':o.name,'type':o.type,'hidden':o.hide_viewport,'render_hidden':o.hide_render,'collections':[c.name for c in o.users_collection]}
    if o.type=='MESH':
        record.update(vertices=len(o.data.vertices),faces=len(o.data.polygons),materials=[m.name for m in o.data.materials if m],bounds=[list(o.matrix_world@Vector(p)) for p in o.bound_box],modifiers=[{'name':m.name,'type':m.type,'target':getattr(getattr(m,'object',None),'name',None)} for m in o.modifiers],vertex_groups=[g.name for g in o.vertex_groups])
    if o.type=='ARMATURE':record['bones']=[{'name':b.name,'head':list(b.head_local),'tail':list(b.tail_local),'parent':b.parent.name if b.parent else None} for b in o.data.bones]
    objects.append(record)
out=Path('.qa/z-anatomy')/(source.parent.name+'-inventory.json')
out.write_text(json.dumps({'objects':objects,'actions':[a.name for a in bpy.data.actions],'collections':[c.name for c in bpy.data.collections]},ensure_ascii=False))
from collections import Counter
print('Objects:',Counter(o['type'] for o in objects))
print('Meshes:',[(o['name'],o['vertices']) for o in objects if o['type']=='MESH'][:50])
print('Armatures:',[(o['name'],len(o['bones'])) for o in objects if o['type']=='ARMATURE'])
print('Actions:',[a.name for a in bpy.data.actions])
print('Wrote',out)
