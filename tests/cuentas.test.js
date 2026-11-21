const { MongoMemoryServer } = require('mongodb-memory-server-core');
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const mongoose = require('mongoose');
const BASE = 'http://localhost:3998';
let fallos = 0;
const ok = (c, m) => { console.log((c ? '  OK  ' : '  XX  ') + m); if (!c) fallos++; };
const req = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { s: r.status, j };
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const run = (n) => ({ created_at: Date.now(), top_speed: 100 + n, total_distance: 400, vehicle_name: 'Moto ' + n, quarter_mile: 14 + n / 10 });

(async () => {
  const mem = await MongoMemoryServer.create();
  const uri = mem.getUri('dragmoto');
  // carrera "vieja" sin cuenta
  await mongoose.connect(uri);
  await mongoose.connection.db.collection('runs').insertOne({ created_at: 1, top_speed: 90, total_distance: 400, user_id: 'anonymous', valid_run: true });
  await mongoose.disconnect();

  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '3998', MONGO_URI: uri, JWT_SECRET: 'prueba-local-0123456789' } });
  let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
  for (let i = 0; i < 40; i++) { try { const h = await req('GET', '/api/health'); if (h.j && h.j.db_conectada) break; } catch (_) {} await sleep(250); }

  try {
    console.log('Cuentas');
    const a = await req('POST', '/api/auth/register', { email: 'Ana@Test.com', password: 'secreto1', name: 'Ana' });
    ok(a.s === 201 && a.j.token, 'registro A');
    const b = await req('POST', '/api/auth/register', { email: 'beto@test.com', password: 'secreto2' });
    ok(b.s === 201, 'registro B');
    ok((await req('POST', '/api/auth/register', { email: 'ana@test.com', password: 'otro123' })).s === 409, 'correo repetido rechazado (sin importar mayusculas)');
    ok((await req('POST', '/api/auth/register', { email: 'x@test.com', password: '123' })).s === 400, 'contrasena corta rechazada');
    ok((await req('POST', '/api/auth/login', { email: 'ana@test.com', password: 'mal' })).s === 401, 'contrasena incorrecta rechazada');
    const la = await req('POST', '/api/auth/login', { email: 'ana@test.com', password: 'secreto1' });
    ok(la.s === 200 && la.j.user.email === 'ana@test.com', 'login A');
    const A = la.j.token, B = b.j.token;
    // Con el panel de administración la segunda cuenta queda pendiente: A (admin) la aprueba
    ok((await req('PATCH', '/api/admin/usuarios/' + b.j.user.id, { estado: 'activo' }, A)).s === 200, 'A (admin) aprueba a B');
    ok((await req('GET', '/api/auth/me', null, A)).j.name === 'Ana', '/me devuelve la cuenta');
    ok((await req('GET', '/api/runs')).s === 401, 'historial sin sesion -> 401');
    ok((await req('GET', '/api/runs', null, 'basura')).s === 401, 'token falso -> 401');
    ok((await req('GET', '/api/telemetry/command')).s === 401, 'polling sin sesion -> 401');

    console.log('Carreras separadas');
    const ra = await req('POST', '/api/runs', { ...run(1), user_id: 'otro' }, A);
    ok(ra.s === 201, 'A sube carrera');
    const rb = await req('POST', '/api/runs', run(2), B);
    ok(rb.s === 201, 'B sube carrera');
    const ha = await req('GET', '/api/runs?user_id=x', null, A), hb = await req('GET', '/api/runs', null, B);
    ok(ha.j.length === 2, 'A ve 2 (la suya + la vieja, por ser la primera cuenta): ' + ha.j.length);
    ok(hb.j.length === 1 && hb.j[0].vehicle_name === 'Moto 2', 'B ve solo la suya');
    ok((await req('DELETE', '/api/runs/' + ra.j.id, null, B)).s === 404, 'B no puede borrar la de A');
    ok((await req('DELETE', '/api/runs/no-es-id', null, B)).s === 404, 'id invalido -> 404');
    ok((await req('GET', '/api/runs/stats', null, B)).j.totalRuns === 1, 'estadisticas de B solo cuentan lo suyo');
    ok((await req('DELETE', '/api/runs/' + ra.j.id, null, A)).s === 200, 'A borra la suya');

    console.log('Tiempo real separado');
    ok(await new Promise(r => { const s = io(BASE, { transports: ['websocket'] }); s.on('connect', () => { s.close(); r(false); }); s.on('connect_error', () => { s.close(); r(true); }); }), 'socket sin sesion rechazado');
    const ev = { A: [], B: [] };
    const sock = (t, k) => new Promise(r => { const s = io(BASE, { transports: ['websocket'], auth: { token: t } }); s.onAny((e, d) => ev[k].push([e, d])); s.on('connect', () => r(s)); });
    const sA = await sock(A, 'A'), sB = await sock(B, 'B');
    await sleep(200);
    await req('POST', '/api/telemetry/cdi', { rpm: 7100, advance: 26, volts: 13.9 }, A);
    await req('POST', '/api/runs/live', { speed_kmh: 88, acceleration: 3, distance: 120, timestamp: 1 }, B);
    await req('GET', '/api/telemetry/command', null, A);
    await sleep(300);
    const tipos = (k, e) => ev[k].filter(x => x[0] === e);
    ok(tipos('A', 'cdi_point').length === 1 && tipos('A', 'cdi_point')[0][1].rpm === 7100, 'A recibe sus RPM');
    ok(tipos('B', 'cdi_point').length === 0, 'B no recibe las RPM de A');
    ok(tipos('B', 'live_point').length === 1 && tipos('A', 'live_point').length === 0, 'el punto GPS de B solo le llega a B');
    ok(tipos('A', 'moto_status').some(x => x[1].conectada), 'A ve su moto conectada');
    ok(!tipos('B', 'moto_status').some(x => x[1].conectada), 'B sigue viendo su moto desconectada');
    ok((await req('GET', '/api/telemetry/status', null, A)).j.cdi_conectado === true, 'estado: CDI de A conectado');
    ok((await req('GET', '/api/telemetry/status', null, B)).j.cdi_conectado === false, 'estado: CDI de B no conectado');
    sB.emit('web_trigger_prepare'); await sleep(200);
    ok((await req('GET', '/api/telemetry/command', null, A)).j.command === null, 'PREPARAR de B no le llega a la moto de A');
    ok((await req('GET', '/api/telemetry/command', null, B)).j.command === 'start', 'PREPARAR de B le llega a la moto de B');
    ok((await req('GET', '/api/telemetry/command', null, B)).j.command === null, 'el comando se consume una vez');
    await req('POST', '/api/runs', run(3), B); await sleep(200);
    ok(tipos('B', 'run_completed').length === 1 && tipos('A', 'run_completed').length === 0, 'carrera terminada solo avisa a su dueno');
    sA.close(); sB.close();
  } catch (e) { console.log('ERROR', e); fallos++; }
  srv.kill(); await mem.stop();
  if (fallos) console.log('\n--- log del servidor ---\n' + log);
  console.log(fallos ? `\n${fallos} FALLOS` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
