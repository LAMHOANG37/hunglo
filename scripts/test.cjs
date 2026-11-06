const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let failed = 0;
for (const name of fs.readdirSync(path.join(root, 'engine')).filter(n => n.endsWith('.test.js')).sort()) {
  if (name === 'chrome.test.js' && !process.argv.includes('--integration')) continue;
  const file = path.join(root, 'engine', name);
  const bootstrap = `const Module=require('node:module');const original=Module._load;Module._load=function(id,...args){if(id==='electron')return {app:{getPath:()=>require('node:os').tmpdir()}};return original.call(this,id,...args)};require(${JSON.stringify(file)});`;
  const result = spawnSync(process.execPath, ['-e', bootstrap], { stdio: 'inherit', cwd: root });
  if (result.status !== 0) { console.error('FAILED:', name); failed++; }
}
process.exitCode = failed ? 1 : 0;
