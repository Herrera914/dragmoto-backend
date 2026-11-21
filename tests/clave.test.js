// Pruebas de contraseñas y de la clave de sesión (MongoDB en memoria, no toca la base real)
const { MongoMemoryServer } = require('mongodb-memory-server-core');
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const BASE = 'http://localhost:3998';
let fallos = 0;
const ok = (c, m) => { console.log((c ? '  OK  ' : '  XX  ') + m); if (!c) fallos++; };
const req = async (method, path, body, token) => {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { s: r.status, j };
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function arrancar(uri, secret) {
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '3998', MONGO_URI: uri, JWT_SECRET: secret } });
  let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
  for (let i = 0; i < 40; i++) { try { const h = await req('GET', '/api/health'); if (h.j && h.j.db_conectada) break; } catch (_) {} await sleep(250); }
  return { srv, log: () => log };
}

(async () => {
  const mem = await MongoMemoryServer.create();
  const uri = mem.getUri('dragmoto');
  let s = await arrancar(uri, 'dragmoto_clave_secreta_2025');
  try {
    console.log('Clave de sesión de ejemplo');
    const a = await req('POST', '/api/auth/register', { email: 'admin@test.com', password: 'secreto1' });
    const idA = a.j.user.id;
    ok(s.log().includes('clave de ejemplo'), 'el servidor avisa que JWT_SECRET es la de ejemplo');
    const falso = jwt.sign({ sub: idA, email: 'admin@test.com' }, 'dragmoto_clave_secreta_2025', { expiresIn: '1h' });
    ok((await req('GET', '/api/admin/resumen', null, falso)).s === 401, 'un token fabricado con la clave de ejemplo NO sirve');
    ok((await req('GET', '/api/admin/resumen', null, a.j.token)).s === 200, 'el token real sí sirve');
    s.srv.kill(); await sleep(500);

    s = await arrancar(uri, 'una-clave-larga-al-azar-de-prueba-0123456789');
    console.log('Cambiar la propia contraseña');
    const A1 = (await req('POST', '/api/auth/login', { email: 'admin@test.com', password: 'secreto1' })).j.token;
    await sleep(1100);
    const A2 = (await req('POST', '/api/auth/login', { email: 'admin@test.com', password: 'secreto1' })).j.token;   // "otro equipo"
    const sockOtro = await new Promise(r => { const k = io(BASE, { transports: ['websocket'], auth: { token: A2 } }); k.on('connect', () => r(k)); k.on('connect_error', () => r(null)); });
    ok(!!sockOtro, 'el otro equipo tiene la página conectada');
    await sleep(1100);
    ok((await req('POST', '/api/auth/clave', { actual: 'mala', nueva: 'nueva123' }, A1)).s === 400, 'contraseña actual incorrecta: rechazado');
    ok((await req('POST', '/api/auth/clave', { actual: 'secreto1', nueva: '123' }, A1)).s === 400, 'nueva muy corta: rechazado');
    ok((await req('POST', '/api/auth/clave', { actual: 'secreto1', nueva: 'secreto1' }, A1)).s === 400, 'nueva igual a la actual: rechazado');
    ok((await req('POST', '/api/auth/clave', { actual: 'x', nueva: 'nueva123' })).s === 401, 'sin sesión: 401');
    const c = await req('POST', '/api/auth/clave', { actual: 'secreto1', nueva: 'nueva123' }, A1);
    ok(c.s === 200 && c.j.token, 'cambia la contraseña y recibe una sesión nueva');
    const A3 = c.j.token;
    ok((await req('GET', '/api/runs', null, A3)).s === 200, 'la sesión nueva funciona');
    const viejo = await req('GET', '/api/runs', null, A2);
    ok(viejo.s === 401 && viejo.j.code === 'sesion_vieja', 'la sesión del otro equipo deja de valer (401 sesion_vieja)');
    ok((await req('GET', '/api/auth/me', null, A2)).s === 401, '/me también la rechaza');
    ok(await new Promise(r => { const k = io(BASE, { transports: ['websocket'], auth: { token: A2 } }); k.on('connect', () => { k.close(); r(false); }); k.on('connect_error', (e) => { k.close(); r(e.message === 'auth'); }); }),
      'la sesión vieja no puede reconectar el tiempo real');
    if (sockOtro) sockOtro.close();
    ok((await req('POST', '/api/auth/login', { email: 'admin@test.com', password: 'secreto1' })).s === 401, 'la contraseña vieja ya no entra');
    ok((await req('POST', '/api/auth/login', { email: 'admin@test.com', password: 'nueva123' })).s === 200, 'la nueva sí entra');

    console.log('Restablecer por el admin');
    const b = await req('POST', '/api/auth/register', { email: 'beto@test.com', password: 'secreto2' });
    const idB = b.j.user.id;
    await req('PATCH', '/api/admin/usuarios/' + idB, { estado: 'activo' }, A3);
    await sleep(1100);
    const B1 = (await req('POST', '/api/auth/login', { email: 'beto@test.com', password: 'secreto2' })).j.token;
    await sleep(1100);
    ok((await req('POST', '/api/admin/usuarios/' + idB + '/clave', null, B1)).s === 403, 'un usuario normal no puede restablecer claves');
    ok((await req('POST', '/api/admin/usuarios/' + idA + '/clave', null, A3)).s === 400, 'el admin no restablece la suya por aquí');
    const r = await req('POST', '/api/admin/usuarios/' + idB + '/clave', null, A3);
    ok(r.s === 200 && /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(r.j.clave), 'el admin recibe una contraseña temporal (' + (r.j && r.j.clave ? 'formato xxxxx-xxxxx' : 'nada') + ')');
    ok((await req('GET', '/api/runs', null, B1)).s === 401, 'la sesión abierta de B se cierra');
    ok((await req('POST', '/api/auth/login', { email: 'beto@test.com', password: 'secreto2' })).s === 401, 'la contraseña olvidada ya no entra');
    const lt = await req('POST', '/api/auth/login', { email: 'beto@test.com', password: r.j.clave });
    ok(lt.s === 200, 'B entra con la temporal');
    ok((await req('POST', '/api/auth/clave', { actual: r.j.clave, nueva: 'propia456' }, lt.j.token)).s === 200, 'y la cambia por una suya');
    const act = (await req('GET', '/api/admin/actividad', null, A3)).j;
    ok(act.some(x => x.accion === 'clave' && x.objetivo === 'beto@test.com' && x.actor === 'admin@test.com'), 'actividad: el admin restableció la de B');
    ok(act.some(x => x.accion === 'clave' && x.actor === 'admin@test.com' && x.objetivo === 'admin@test.com'), 'actividad: el admin cambió la suya');
    ok(!JSON.stringify(act).includes(r.j.clave), 'la temporal no queda guardada en la actividad');
  } catch (e) { console.log('ERROR', e); fallos++; }
  s.srv.kill(); await mem.stop();
  if (fallos) console.log('\n--- log del servidor ---\n' + s.log());
  console.log(fallos ? `\n${fallos} FALLOS` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
