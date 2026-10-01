"""Re-export the existing muscle structures from the official anatomical source.

Keep source surface/thickness modifiers and more of the original contour. Bone
bytes, canonical names, picking boundaries and anatomical parts are preserved.
Derived assets: CC BY-SA 4.0, Z-Anatomy / BodyParts3D.
"""
import argparse, array, base64, hashlib, json, sys, zlib
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--bpy', type=Path, required=True)
parser.add_argument('--output', type=Path)
args = parser.parse_args()
model = Path(__file__).resolve().parents[1]
out = args.output or model / 'assets'
out.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(args.bpy.resolve()))
import bpy

bpy.context.preferences.filepaths.use_scripts_auto_execute = False
bpy.ops.wm.read_factory_settings(use_empty=True)
asset = json.loads((model / 'assets/anatomy-atlas.json').read_text())
old = zlib.decompress(base64.b64decode(asset['data']))
names = [m.get('sourceName', m['name']) for m in asset['meshes'] if m['kind'] == 'muscle']
with bpy.data.libraries.load(str(args.source.resolve())) as (src, dst):
    missing = set(names) - set(src.objects)
    if missing:
        raise ValueError(f'Source structures missing: {sorted(missing)}')
    dst.objects = names
for obj in dst.objects:
    bpy.context.scene.collection.objects.link(obj)
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get()
payload, manifest, report = bytearray(), [], []
bone_hash = hashlib.sha256()
for item in asset['meshes']:
    entry = dict(item)
    entry['offset'] = len(payload)
    if item['kind'] != 'muscle':
        size = item['vertices'] * 9 + item['indices'] * 2
        payload.extend(old[item['offset']:item['offset'] + size])
        bone_hash.update(old[item['offset']:item['offset'] + size])
    else:
        obj = bpy.data.objects[item.get('sourceName', item['name'])]
        modifiers = []
        for modifier in list(obj.modifiers):
            if modifier.type not in {'SOLIDIFY', 'SUBSURF'}:
                raise ValueError(f'Unexpected source modifier: {obj.name}/{modifier.type}')
            modifiers.append(modifier.type)
        # Small muscles and wrist tendons retain their full source resolution.
        # Large surfaces get a larger budget instead of the old blanket 1800.
        evaluated = obj.evaluated_get(deps)
        surface = evaluated.to_mesh()
        surface.calc_loop_triangles()
        source_faces = len(surface.loop_triangles)
        evaluated.to_mesh_clear()
        if source_faces > 6000:
            modifier = obj.modifiers.new('Anatomical surface budget', 'DECIMATE')
            modifier.ratio = 6000 / source_faces
        deps.update()
        evaluated = obj.evaluated_get(deps)
        surface = evaluated.to_mesh()
        surface.calc_loop_triangles()
        if len(surface.vertices) > 65535:
            raise ValueError(f'16-bit index budget exceeded: {obj.name}')
        positions, normals, indices = array.array('h'), array.array('b'), array.array('H')
        normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
        for vertex in surface.vertices:
            p = obj.matrix_world @ vertex.co
            positions.extend(round(c * 10000) for c in (p.x, p.z, -p.y))
            n = (normal_matrix @ vertex.normal).normalized()
            normals.extend(round(c * 127) for c in (n.x, n.z, -n.y))
        mirrored = obj.matrix_world.to_3x3().determinant() < 0
        for triangle in surface.loop_triangles:
            a, b, c = triangle.vertices
            indices.extend((a, c, b) if mirrored else (a, b, c))
        entry.update(vertices=len(surface.vertices), indices=len(indices))
        payload.extend(positions.tobytes())
        payload.extend(normals.tobytes())
        payload.extend(indices.tobytes())
        report.append({'name': item['name'], 'sourceTriangles': source_faces,
                       'triangles': len(indices) // 3,
                       'preservedModifiers': modifiers})
        evaluated.to_mesh_clear()
    manifest.append(entry)
asset.update(meshes=manifest, data=base64.b64encode(zlib.compress(payload, 9)).decode('ascii'))
(out / 'anatomy-atlas.json').write_text(json.dumps(asset, separators=(',', ':')))
(out / 'anatomy-manifest.json').write_text(json.dumps(manifest, indent=2))
(out / 'muscle-surface-source.json').write_text(json.dumps({
    'source': 'https://github.com/Z-Anatomy/Models-of-human-anatomy',
    'sourceFile': 'Z-Anatomy/Startup.blend',
    'sourceSha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
    'license': 'CC-BY-SA-4.0', 'triangleBudgetPerMuscle': 6000,
    'preservedBoneSha256': bone_hash.hexdigest(), 'structures': report,
}, indent=2))
print(json.dumps({'muscles': len(report), 'structures': len(manifest),
                  'triangles': sum(m['indices'] // 3 for m in manifest),
                  'compressedBytes': len(base64.b64decode(asset['data'])),
                  'restoredModifiers': sum(len(r['preservedModifiers']) for r in report)}))
