// Perfil de la cuenta: nombre editable y fecha de registro (MongoDB en memoria, no toca la base real)
const { MongoMemoryServer } = require('mongodb-memory-server-core');
const { spawn } = require('child_process');
const path = require('path');
const BASE = 'http://localhost:3998';
let fallos = 0;
const ok = (c, m) => { console.log((c ? '  OK  ' : '  XX  ') + m); if (!c) fallos++; };
const req = async (method, p, body, token) => {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { s: r.status, j };
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const mem = await MongoMemoryServer.create();
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '3998', MONGO_URI: mem.getUri('dragmoto'), JWT_SECRET: 'prueba-local-0123456789' } });
  let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
  for (let i = 0; i < 40; i++) { try { const h = await req('GET', '/api/health'); if (h.j && h.j.db_conectada) break; } catch (_) {} await sleep(250); }
  try {
    console.log('Perfil');
    const a = await req('POST', '/api/auth/register', { email: 'admin@test.com', password: 'secreto1', name: 'Dueño' });
    const A = a.j.token;
    ok(!!a.j.user.creado && !isNaN(Date.parse(a.j.user.creado)), 'el registro devuelve la fecha de creación');
    ok(!!(await req('GET', '/api/auth/me', null, A)).j.creado, '/me también la devuelve');
    const p = await req('PATCH', '/api/auth/perfil', { name: '  Piloto   Rápido  ' }, A);
    ok(p.s === 200 && p.j.name === 'Piloto Rápido', 'cambia el nombre (sin espacios de más)');
    ok((await req('GET', '/api/auth/me', null, A)).j.name === 'Piloto Rápido', 'el nombre nuevo queda guardado');
    ok((await req('PATCH', '/api/auth/perfil', { name: 'x'.repeat(80) }, A)).j.name.length === 40, 'el nombre se corta a 40 caracteres');
    ok((await req('PATCH', '/api/auth/perfil', { nombre: 'mal' }, A)).s === 400, 'sin el campo name: rechazado');
    ok((await req('PATCH', '/api/auth/perfil', { name: 'Intruso' })).s === 401, 'sin sesión: rechazado');
    const b = await req('POST', '/api/auth/register', { email: 'beto@test.com', password: 'secreto2' });
    const pb = await req('PATCH', '/api/auth/perfil', { name: 'Beto' }, b.j.token);
    ok(pb.s === 200 && pb.j.estado === 'pendiente', 'una cuenta pendiente también puede poner su nombre');
    const lista = (await req('GET', '/api/admin/usuarios', null, A)).j;
    ok(lista.find(u => u.email === 'beto@test.com').name === 'Beto', 'el admin ve el nombre nuevo en el panel');
  } catch (e) { console.log('ERROR', e); fallos++; }
  srv.kill(); await mem.stop();
  if (fallos) console.log('\n--- log del servidor ---\n' + log);
  console.log(fallos ? `\n${fallos} FALLOS` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
