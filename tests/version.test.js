// Última versión de la app que publica el admin (MongoDB en memoria, no toca la base real)
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
    console.log('Versión de la app');
    const sinPublicar = await req('GET', '/api/app/version');
    ok(sinPublicar.s === 200 && sinPublicar.j.code === 0, 'sin versión publicada: code 0 (la app no avisa)');
    const A = (await req('POST', '/api/auth/register', { email: 'admin@test.com', password: 'secreto1' })).j.token;
    const B = (await req('POST', '/api/auth/register', { email: 'beto@test.com', password: 'secreto2' })).j.token;
    const v = { code: 3, nombre: '1.2', enlace: 'https://ejemplo.test/dragmoto.apk', notas: 'Tableros nuevos', obligatoria: false };
    ok((await req('PUT', '/api/admin/app-version', v, B)).s === 403, 'una cuenta normal no puede publicar');
    ok((await req('PUT', '/api/admin/app-version', v)).s === 401, 'sin sesión no puede publicar');
    ok((await req('PUT', '/api/admin/app-version', { ...v, enlace: 'http://inseguro.test/a.apk' }, A)).s === 400, 'enlace sin https rechazado');
    ok((await req('PUT', '/api/admin/app-version', { ...v, code: 1.5 }, A)).s === 400, 'número de versión no entero rechazado');
    ok((await req('PUT', '/api/admin/app-version', { ...v, nombre: '' }, A)).s === 400, 'sin nombre rechazado');
    const pub = await req('PUT', '/api/admin/app-version', v, A);
    ok(pub.s === 200 && pub.j.code === 3 && pub.j.nombre === '1.2', 'el admin publica la versión 1.2 (3)');
    const leida = await req('GET', '/api/app/version');
    ok(leida.j.code === 3 && leida.j.enlace === v.enlace && leida.j.notas === 'Tableros nuevos' && leida.j.obligatoria === false,
      'la app (sin sesión) lee la versión publicada');
    await req('PUT', '/api/admin/app-version', { ...v, code: 4, nombre: '1.3', obligatoria: true }, A);
    const ob = (await req('GET', '/api/app/version')).j;
    ok(ob.code === 4 && ob.obligatoria === true, 'se puede reemplazar y marcar como obligatoria');
    const act = (await req('GET', '/api/admin/actividad', null, A)).j;
    ok(act.some(x => x.accion === 'version' && /1\.3/.test(x.detalle)), 'queda en la actividad');
  } catch (e) { console.log('ERROR', e); fallos++; }
  srv.kill(); await mem.stop();
  if (fallos) console.log('\n--- log del servidor ---\n' + log);
  console.log(fallos ? `\n${fallos} FALLOS` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
