'use strict';
// This candidate is an internal Preview. Production needs a separate release review.
const fs = require('fs');
const path = require('path');

if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'preview') {
  throw new Error('REFUSED: this candidate is approved for Preview only. Production release gates remain open.');
}
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'public');
const output = path.join(root, 'preview-public');
const pages = ['home.html','services.html','how-we-work.html','request-status.html',
  'intake.html','manage.html','v2-intake-review.html','v2-workspace.html',
  'client.html','admin.html','portal.html','questions.html'];
const assets = ['hv.css','hv-ui.js','hv-ops.js','hv-journey.js','hv-intake-copy.js',
  'hv-icons.js','hv-i18n.js','hv-copy.js','hv-client-copy.js','hv-case-view.js','hv-admin-copy.js'];
const allowed = new Set([...pages, 'index.html', ...assets.map(n => 'assets/' + n)]);

// Refuse unexpected old output instead of deleting files or publishing leftovers.
function checkExisting(dir, prefix = '') {
  if (!fs.existsSync(dir)) return;
  for (const item of fs.readdirSync(dir, {withFileTypes:true})) {
    const rel = prefix + item.name;
    if (item.isSymbolicLink()) throw new Error('Unexpected output symlink: ' + rel);
    if (item.isDirectory()) {
      if (rel !== 'assets') throw new Error('Unexpected output directory: ' + rel);
      checkExisting(path.join(dir,item.name),rel + '/');
    } else if (!allowed.has(rel)) throw new Error('Unexpected output file: ' + rel);
  }
}
checkExisting(output);

// Prepare every file before writing, so a changed source contract fails early.
const artifact = new Map();
for (const name of pages) {
  let text = fs.readFileSync(path.join(source,name),'utf8');
  text = text.replace(/<script\s+src="\/assets\/hv-demo\.js"><\/script>\s*/g,'');
  if (/src=["'][^"']*hv-demo\.js/.test(text)) throw new Error('Fixture import not removed: ' + name);
  artifact.set(name,text);
}
for (const name of assets) {
  let text = fs.readFileSync(path.join(source,'assets',name),'utf8');
  if (name === 'hv-ui.js') {
    const marker = 'var DEMO = isLocalHost() && demoRequested();';
    if (text.split(marker).length !== 2) throw new Error('Demo boundary source contract changed');
    text = text.replace(marker,'var DEMO = false; // Published Preview has no fixture data.');
  }
  artifact.set('assets/' + name,text);
}
artifact.set('index.html',artifact.get('home.html'));
fs.mkdirSync(path.join(output,'assets'),{recursive:true});
for (const [name,text] of artifact) fs.writeFileSync(path.join(output,name),text,'utf8');
console.log('Preview static artifact prepared: ' + artifact.size + ' files; redesigned root; no fixture asset or local session issuer.');
