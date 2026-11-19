/**
 * Installs / removes the Haroon POS server as a Windows service (auto-start, auto-restart).
 * Run with the bundled node:  node\node.exe app\server\scripts\service.cjs install|uninstall|start|stop
 */
const path = require('node:path');
const { Service } = require('node-windows');

const serverRoot = path.resolve(__dirname, '..');
const installRoot = path.resolve(serverRoot, '..', '..');

const svc = new Service({
  name: 'HaroonPOS',
  description: 'Haroon Electric & Sanitary Store — POS server (data, backups, counters).',
  script: path.join(serverRoot, 'dist', 'index.js'),
  execPath: process.execPath,
  workingDirectory: serverRoot,
  // Restart quickly after a crash or after a restore (the server exits on purpose then).
  wait: 2,
  grow: 0.25,
  maxRestarts: 1000,
  env: [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'POS_DATA_DIR', value: process.env.POS_DATA_DIR || path.join(installRoot, 'data') },
  ],
});

const cmd = process.argv[2];
svc.on('install', () => {
  console.log('Service installed. Starting…');
  svc.start();
});
svc.on('alreadyinstalled', () => {
  console.log('Service already installed. Starting…');
  svc.start();
});
svc.on('start', () => console.log('Service started.'));
svc.on('stop', () => console.log('Service stopped.'));
svc.on('uninstall', () => console.log('Service removed.'));
svc.on('error', (e) => console.error('Service error:', e));

if (cmd === 'install') svc.install();
else if (cmd === 'uninstall') svc.uninstall();
else if (cmd === 'start') svc.start();
else if (cmd === 'stop') svc.stop();
else console.log('Usage: service.cjs install | uninstall | start | stop');
