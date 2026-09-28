"""Offline geometry QA, independent of the browser. Not a WebGL UI screenshot."""
import json,sys
from pathlib import Path
import moderngl
import numpy as np
from PIL import Image, ImageDraw

root = Path(sys.argv[1] if len(sys.argv)>1 else '.qa')
ctx = moderngl.create_standalone_context()
ctx.enable(moderngl.DEPTH_TEST)
width, height = 900, 1100
target = ctx.simple_framebuffer((width, height), components=4)
depth = ctx.depth_texture((2048, 2048))
depth.compare_func = ''
depth.repeat_x = depth.repeat_y = False
shadow = ctx.framebuffer(depth_attachment=depth)

def look_at(eye, point):
    eye, point = np.array(eye), np.array(point)
    f = (point-eye) / np.linalg.norm(point-eye)
    s = np.cross(f, [0, 1, 0]); s /= np.linalg.norm(s)
    u = np.cross(s, f)
    result = np.eye(4, dtype='f4')
    result[:3,:3] = np.array([s,u,-f])
    result[:3,3] = -result[:3,:3] @ eye
    return result

light_view = look_at([-3,6,4], [0,1.3,0])
ortho = np.array([[1/3,0,0,0],[0,1/3,0,0],[0,0,-2/15,-1],[0,0,0,1]],dtype='f4')
light_matrix = ortho @ light_view
shadow_program = ctx.program(vertex_shader='''#version 330
in vec3 position; uniform mat4 light_matrix;
void main(){gl_Position=light_matrix*vec4(position,1.0);}
''',fragment_shader='''#version 330
void main(){}
''')
program = ctx.program(vertex_shader='''#version 330
in vec3 position; in vec3 normal; in vec3 color; in vec2 uv; in float muscle;
uniform mat4 projection; uniform mat4 view; uniform mat4 light_matrix;
out vec3 world; out vec3 norm; out vec3 tint; out vec2 tex; out float fiber; out vec4 shadow_pos;
void main(){world=position;norm=normal;tint=color;tex=uv;fiber=muscle;
shadow_pos=light_matrix*vec4(position,1.0);gl_Position=projection*view*vec4(position,1.0);}
''',fragment_shader='''#version 330
in vec3 world; in vec3 norm; in vec3 tint; in vec2 tex; in float fiber; in vec4 shadow_pos;
uniform vec3 camera; uniform sampler2D shadow_map;
out vec4 out_color;
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.0,1.0);}
void main(){
 vec3 n=normalize(norm), l=normalize(vec3(-3,6,4)-world), v=normalize(camera-world);
 vec3 p=shadow_pos.xyz/shadow_pos.w*.5+.5;
 float visibility=0.0;
 for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
  float d=texture(shadow_map,p.xy+vec2(x,y)/2048.0).r;
  visibility += p.z-.001<d?1.0:.20;
 }
 visibility/=9.0;
 float diffuse=max(dot(n,l),0.0), rim=max(dot(n,normalize(vec3(3,3,-3))),0.0);
 float lines=1.0-fiber*.055*(.5+.5*sin(tex.x*282.74+sin(tex.y*6.283)*1.4));
 vec3 lit=tint*lines*(.45+.20*n.y+1.65*diffuse*visibility+.45*rim);
 lit+=vec3(.10)*pow(max(dot(n,normalize(l+v)),0.0),38.0)*visibility;
 out_color=vec4(pow(aces(lit),vec3(1.0/2.2)),1.0);
}
''')
program['light_matrix'].write(light_matrix.T.tobytes())
shadow_program['light_matrix'].write(light_matrix.T.tobytes())
program['shadow_map'].value = 0
images = []
for scene in json.loads((root/'scenes.json').read_text()):
    data = (root/(scene['filename']+'.bin')).read_bytes()
    buffer = ctx.buffer(data)
    shadow_vao = ctx.vertex_array(shadow_program,[(buffer,'3f 36x','position')])
    vao = ctx.vertex_array(program,[(buffer,'3f 3f 3f 2f 1f','position','normal','color','uv','muscle')])
    shadow.use(); ctx.viewport=(0,0,2048,2048); shadow.clear(depth=1);shadow_vao.render()
    target.use(); ctx.viewport=(0,0,width,height);target.clear(.918,.941,.906,1,depth=1)
    program['projection'].write(np.array(scene['projection'],dtype='f4').tobytes())
    program['view'].write(np.array(scene['viewMatrix'],dtype='f4').tobytes())
    program['camera'].value = tuple(scene['camera'])
    depth.use(0);vao.render()
    image = Image.frombytes('RGBA',(width,height),target.read(components=4)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).convert('RGB')
    image.save(root/(scene['filename']+'.png'))
    small=image.resize((450,550));ImageDraw.Draw(small).text((15,15),scene['filename'],fill='#384f3b');images.append(small)
    vao.release();shadow_vao.release();buffer.release()
sheet=Image.new('RGB',(450*3,550*2+(35 if root.name in ('atlas','rig') else 0)),'white')
for i,image in enumerate(images):sheet.paste(image,((i%3)*450,(i//3)*550))
if root.name in ('atlas','rig'):
    ImageDraw.Draw(sheet).text((15,1112),'Z-Anatomy / BodyParts3D | Adapted geometry: CC BY-SA 4.0 | Offline render; not a browser screenshot',fill='#384f3b')
sheet.save(root/'model-review.png')
print('Offline previews saved to',root/'model-review.png')
