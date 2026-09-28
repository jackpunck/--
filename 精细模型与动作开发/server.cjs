const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const allowed = new Set(['index.html','style.css','demo.bundle.js','embed-bootstrap.js','THIRD_PARTY_LICENSES.txt']);
const port = Number(process.env.PORT || 4174);
http.createServer((req,res) => {
  try {
    const filename = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//,'') || 'index.html';
    if (!allowed.has(filename)) { res.writeHead(404); res.end('Not found'); return; }
    fs.readFile(path.join(root,filename),(error,data)=>{
      if(error){res.writeHead(404);res.end('Not found');return;}
      res.writeHead(200,{'Content-Type':types[path.extname(filename)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(data);
    });
  } catch {res.writeHead(400);res.end('Bad request');}
}).listen(port,'127.0.0.1',()=>console.log(`3D demo: http://127.0.0.1:${port}`));
