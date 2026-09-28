"""Restore four real abdominal oblique meshes excluded by an old name filter.

Pass the original .blend and bpy runtime directory. Source is read without
executing embedded scripts; only this model directory's derived assets change.
"""
import array, base64, json, sys, zlib
from pathlib import Path
model_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(sys.argv[2]).resolve()))
import bpy
bpy.context.preferences.filepaths.use_scripts_auto_execute = False
bpy.ops.wm.read_factory_settings(use_empty=True)
all_names = [f'{part} abdominal oblique muscle.{side}' for part in ('External', 'Internal') for side in ('l', 'r')]
asset_path = model_dir / 'assets/anatomy-atlas.json'
asset = json.loads(asset_path.read_text())
names = [name for name in all_names if not any(item['name'] == name for item in asset['meshes'])]
with bpy.data.libraries.load(str(Path(sys.argv[1]).resolve())) as (src, dst):
    dst.objects = list(names)
for obj in dst.objects:
    bpy.context.scene.collection.objects.link(obj)
bpy.context.view_layer.update()
payload = bytearray(zlib.decompress(base64.b64decode(asset['data'])))
deps = bpy.context.evaluated_depsgraph_get()
for obj in dst.objects:
    for modifier in list(obj.modifiers): obj.modifiers.remove(modifier)
    modifier = obj.modifiers.new('Web detail reduction', 'DECIMATE')
    modifier.ratio = max(.12, min(1, 1800 / len(obj.data.polygons)))
    deps.update()
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    positions, normals, indices = array.array('h'), array.array('b'), array.array('H')
    nmat = obj.matrix_world.to_3x3().inverted().transposed()
    for vertex in mesh.vertices:
        p = obj.matrix_world @ vertex.co
        positions.extend(round(c * 10000) for c in (p.x, p.z, -p.y))
        n = (nmat @ vertex.normal).normalized()
        normals.extend(round(c * 127) for c in (n.x, n.z, -n.y))
    mirrored = obj.matrix_world.to_3x3().determinant() < 0
    for triangle in mesh.loop_triangles:
        a, b, c = triangle.vertices
        indices.extend((a, c, b) if mirrored else (a, b, c))
    asset['meshes'].append({'name': obj.name, 'kind': 'muscle', 'role': 'obliques', 'vertices': len(mesh.vertices), 'indices': len(indices), 'offset': len(payload)})
    payload.extend(positions.tobytes()); payload.extend(normals.tobytes()); payload.extend(indices.tobytes())
    evaluated.to_mesh_clear()
asset['data'] = base64.b64encode(zlib.compress(payload, 9)).decode('ascii')
asset_path.write_text(json.dumps(asset, separators=(',', ':')))
(model_dir / 'assets/anatomy-manifest.json').write_text(json.dumps(asset['meshes'], indent=2))
region_path = model_dir / 'assets/anatomy-regions.json'
regions = json.loads(region_path.read_text())
regions.update({name: 'trunk' for name in all_names})
region_path.write_text(json.dumps(regions, separators=(',', ':')))
print(f'Restored {len(names)} abdominal oblique structures; total {len(asset["meshes"])}.')
