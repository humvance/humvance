'use strict';
/**
 * A local static server for reviewing the Humvance front end.
 *
 *     npm run dev        →  http://localhost:4173
 *
 * This is a REVIEW TOOL, not a second website and not a deployment. It serves
 * public/ exactly as Vercel does for static files, and it applies the same
 * route aliases as vercel.json so that /home, /services, /intake and the rest
 * resolve here the way they will there.
 *
 * It does NOT run the serverless functions under api/. Anything that calls one
 * gets a 501 with a note saying so, rather than a confusing 404 — a screen that
 * needs a real endpoint should say it needs one.
 *
 * Node only, zero dependencies, consistent with the rest of this repository.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 4173;

const ROUTES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8')).routes || [];
const ALIAS = Object.create(null);
for (const r of ROUTES) if (r.src && r.dest) ALIAS[r.src] = r.dest;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/home.html';              // the redesigned home, for review
  if (ALIAS[p]) p = ALIAS[p];
  if (p.endsWith('/')) p += 'index.html';
  if (!path.extname(p)) p += '.html';

  if (p.startsWith('/api/')) {
    res.writeHead(501, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      error: 'This is a static review server. Serverless functions under api/ are not run here.',
      code: 'dev_server_no_functions'
    }));
  }

  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found: ' + p); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log('\n  Humvance — local review server');
  console.log('  ------------------------------');
  console.log('  http://localhost:' + PORT + '/                 home (redesigned)');
  console.log('  http://localhost:' + PORT + '/services');
  console.log('  http://localhost:' + PORT + '/how-we-work');
  console.log('  http://localhost:' + PORT + '/intake');
  console.log('  http://localhost:' + PORT + '/client?demo=1    client workspace (fixtures)');
  console.log('  http://localhost:' + PORT + '/v2-intake-review?demo=1');
  console.log('  http://localhost:' + PORT + '/v2-workspace?demo=1');
  console.log('\n  Demo mode needs ?demo=1 AND localhost. It is off everywhere else.');
  console.log('  api/ functions are not served here.\n');
});
