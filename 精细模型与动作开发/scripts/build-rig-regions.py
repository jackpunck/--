"""Retain anatomical collection membership for reproducible skin binding."""
import json
from pathlib import Path
source=json.loads(Path('.qa/z-anatomy/Z-Anatomy-inventory.json').read_text())
included={m.get('sourceName',m['name']):m['name'] for m in json.loads(Path('assets/anatomy-manifest.json').read_text())}
regions={}
for item in source['objects']:
    if item['name'] not in included:continue
    c=item['collections']
    regions[included[item['name']]]='arm' if any('upper limb' in x for x in c) else 'leg' if any('lower limb' in x for x in c) else 'trunk'
Path('assets/anatomy-regions.json').write_text(json.dumps(regions,separators=(',',':')))
