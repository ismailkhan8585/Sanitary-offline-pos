/**
 * Builds release/HaroonPOS-Server (+ .zip): a self-contained folder with node.exe, the server,
 * the client, production node_modules and install/uninstall scripts for the server PC.
 * Usage: npm run package:server
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'release', 'HaroonPOS-Server');
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' });
const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });

console.log('1/5 Building client and server…');
run('npm run build -w client');
run('npm run build -w server');

console.log('2/5 Preparing folder…');
fs.rmSync(out, { recursive: true, force: true });
copy('server/dist', 'app/server/dist');
copy('server/migrations', 'app/server/migrations');
copy('server/scripts/service.cjs', 'app/server/scripts/service.cjs');
copy('client/dist', 'app/client/dist');
copy('installer/server', '.');
const serverPkg = JSON.parse(fs.readFileSync(path.join(root, 'server/package.json'), 'utf8'));
fs.writeFileSync(
  path.join(out, 'app/server/package.json'),
  JSON.stringify({ name: 'haroon-pos-server', version: serverPkg.version, private: true, main: 'dist/index.js', dependencies: serverPkg.dependencies }, null, 2),
);

console.log('3/5 Installing production packages (needs internet once, here on the build PC)…');
run('npm install --omit=dev --no-audit --no-fund --no-package-lock', path.join(out, 'app/server'));

console.log('4/5 Adding node.exe', process.version, '…');
fs.mkdirSync(path.join(out, 'node'), { recursive: true });
fs.copyFileSync(process.execPath, path.join(out, 'node', 'node.exe'));
fs.mkdirSync(path.join(out, 'tools'), { recursive: true });

console.log('5/5 Zipping…');
const zip = path.join(root, 'release', 'HaroonPOS-Server.zip');
fs.rmSync(zip, { force: true });
run(`powershell -NoProfile -Command "Compress-Archive -Path '${out}\\*' -DestinationPath '${zip}'"`);
console.log(`\nDone:\n  ${out}\n  ${zip}`);
