// Pruebas del panel de administración con MongoDB en memoria (no toca la base real)
const { MongoMemoryServer } = require('mongodb-memory-server-core');
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const mongoose = require('mongoose');
const BASE = 'http://localhost:3998';
let fallos = 0;
const ok = (c, m) => { console.log((c ? '  OK  ' : '  XX  ') + m); if (!c) fallos++; };
const req = async (method, path, body, token, client) => {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  if (client) h['X-DragMoto-Client'] = client;
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { s: r.status, j };
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const run = (n) => ({ created_at: Date.now(), top_speed: 100 + n, total_distance: 400, vehicle_name: 'Moto ' + n, quarter_mile: 14 + n / 10 });

(async () => {
  const mem = await MongoMemoryServer.create();
  const uri = mem.getUri('dragmoto');
  // Una cuenta "vieja" creada antes del panel (sin estado ni rol): debe quedar activa y ser admin
  await mongoose.connect(uri);
  await mongoose.connection.db.collection('users').insertOne({ email: 'vieja@test.com', name: 'Vieja', password_hash: 'x', createdAt: new Date(1000) });
  await mongoose.disconnect();

  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '3998', MONGO_URI: uri, JWT_SECRET: 'prueba-local-0123456789' } });
  let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
  for (let i = 0; i < 40; i++) { try { const h = await req('GET', '/api/health'); if (h.j && h.j.db_conectada) break; } catch (_) {} await sleep(250); }
  await sleep(500);   // migración al conectar

  try {
    console.log('Migración');
    await mongoose.connect(uri);
    const vieja = await mongoose.connection.db.collection('users').findOne({ email: 'vieja@test.com' });
    ok(vieja.estado === 'activo' && vieja.rol === 'admin', 'cuenta anterior al panel: activa y admin (no había admin)');
    // se elimina para probar el flujo de "primera cuenta"
    await mongoose.connection.db.collection('users').deleteMany({});
    await mongoose.disconnect();

    console.log('Registro y aprobación');
    const a = await req('POST', '/api/auth/register', { email: 'admin@test.com', password: 'secreto1', name: 'Dueño' }, null, 'web');
    ok(a.s === 201 && a.j.user.rol === 'admin' && a.j.user.estado === 'activo', 'la primera cuenta queda admin y activa');
    const A = a.j.token;
    const b = await req('POST', '/api/auth/register', { email: 'beto@test.com', password: 'secreto2' }, null, 'app');
    ok(b.s === 201 && b.j.user.estado === 'pendiente' && b.j.user.rol === 'usuario', 'la segunda cuenta queda pendiente');
    const B = b.j.token, idB = b.j.user.id;
    const c = await req('POST', '/api/auth/register', { email: 'caro@test.com', password: 'secreto3' });
    const C = c.j.token, idC = c.j.user.id;

    const pend = await req('GET', '/api/runs', null, B, 'app');
    ok(pend.s === 403 && pend.j.code === 'pendiente', 'pendiente: 403 con code "pendiente"');
    ok((await req('POST', '/api/runs', run(1), B, 'app')).s === 403, 'pendiente: no puede subir carreras');
    ok((await req('GET', '/api/telemetry/command', null, B, 'app')).s === 403, 'pendiente: polling de la moto rechazado');
    const meB = await req('GET', '/api/auth/me', null, B);
    ok(meB.s === 200 && meB.j.estado === 'pendiente', '/me sí responde a la cuenta pendiente (para mostrar el aviso)');
    ok(await new Promise(r => { const s = io(BASE, { transports: ['websocket'], auth: { token: B, client: 'web' } });
      s.on('connect', () => { s.close(); r(false); }); s.on('connect_error', (e) => { s.close(); r(e.message === 'acceso' && e.data && e.data.code === 'pendiente'); }); }),
      'pendiente: socket rechazado con "acceso"');

    ok((await req('GET', '/api/admin/usuarios', null, B)).s === 403, 'una cuenta normal no entra al panel');
    ok((await req('GET', '/api/admin/usuarios')).s === 401, 'sin sesión no entra al panel');
    const apr = await req('PATCH', '/api/admin/usuarios/' + idB, { estado: 'activo' }, A);
    ok(apr.s === 200 && apr.j.estado === 'activo', 'el admin aprueba a B');
    ok((await req('GET', '/api/runs', null, B, 'app')).s === 200, 'B ya puede usar la app (al momento, sin esperar caché)');
    ok((await req('POST', '/api/runs', run(2), B, 'app')).s === 201, 'B sube una carrera');
    await req('POST', '/api/runs', run(5), B, 'app');
    await req('POST', '/api/runs', run(9), A, 'app');

    console.log('Permisos por cliente');
    ok((await req('PATCH', '/api/admin/usuarios/' + idB, { permisos: { app: false } }, A)).s === 200, 'quitar permiso App a B');
    const sinApp = await req('GET', '/api/runs', null, B, 'app');
    ok(sinApp.s === 403 && sinApp.j.code === 'sin_permiso', 'B sin permiso App: la app recibe 403 "sin_permiso"');
    ok((await req('GET', '/api/runs', null, B, 'web')).s === 200, 'B sigue usando la página');
    ok((await req('GET', '/api/runs', null, B)).s === 200, 'sin encabezado cuenta como página');
    await req('PATCH', '/api/admin/usuarios/' + idB, { permisos: { app: true, web: false } }, A);
    ok((await req('GET', '/api/runs', null, B, 'web')).s === 403, 'sin permiso Página: la página recibe 403');
    ok((await req('GET', '/api/runs', null, B, 'app')).s === 200, 'y la app sí funciona');
    await req('PATCH', '/api/admin/usuarios/' + idB, { permisos: { web: true } }, A);

    console.log('Bloqueo en vivo');
    const sB = await new Promise(r => { const s = io(BASE, { transports: ['websocket'], auth: { token: B, client: 'web' } }); s.on('connect', () => r(s)); });
    const corte = new Promise(r => sB.on('disconnect', (why) => r(why)));
    ok((await req('PATCH', '/api/admin/usuarios/' + idB, { estado: 'bloqueado' }, A)).s === 200, 'el admin bloquea a B');
    const why = await Promise.race([corte, sleep(2000).then(() => 'no')]);
    ok(why === 'io server disconnect', 'B con la página abierta queda desconectado al momento (' + why + ')');
    sB.close();
    const bl = await req('GET', '/api/runs', null, B, 'web');
    ok(bl.s === 403 && bl.j.code === 'bloqueado', 'B bloqueado: 403 "bloqueado"');
    const lb = await req('POST', '/api/auth/login', { email: 'beto@test.com', password: 'secreto2' });
    ok(lb.s === 403 && lb.j.code === 'bloqueado', 'B bloqueado no puede iniciar sesión');
    await req('PATCH', '/api/admin/usuarios/' + idB, { estado: 'activo' }, A);
    ok((await req('POST', '/api/auth/login', { email: 'beto@test.com', password: 'secreto2' })).s === 200, 'desbloqueado: vuelve a entrar');

    console.log('Protecciones');
    const idA = a.j.user.id;
    ok((await req('PATCH', '/api/admin/usuarios/' + idA, { estado: 'bloqueado' }, A)).s === 400, 'el admin no puede bloquearse a sí mismo');
    ok((await req('PATCH', '/api/admin/usuarios/' + idA, { rol: 'usuario' }, A)).s === 400, 'no puede quitarse el rol de admin');
    ok((await req('PATCH', '/api/admin/usuarios/' + idA, { permisos: { web: false } }, A)).s === 400, 'no puede quitarse la página');
    ok((await req('DELETE', '/api/admin/usuarios/' + idA, null, A)).s === 400, 'no puede eliminar su propia cuenta');
    ok((await req('PATCH', '/api/admin/usuarios/' + idB, { estado: 'raro' }, A)).s === 400, 'estado inválido rechazado');
    ok((await req('PATCH', '/api/admin/usuarios/123', { estado: 'activo' }, A)).s === 404, 'id inválido -> 404');
    ok((await req('PATCH', '/api/admin/usuarios/' + idB, { rol: 'admin' }, A)).s === 200, 'B pasa a admin');
    ok((await req('GET', '/api/admin/resumen', null, B)).s === 200, 'B (admin) ya entra al panel');
    ok((await req('PATCH', '/api/admin/usuarios/' + idA, { rol: 'usuario' }, B)).s === 200, 'B le quita el admin a A (quedan 1)');
    ok((await req('PATCH', '/api/admin/usuarios/' + idB, { rol: 'usuario' }, B)).s === 400, 'el último admin no puede dejar de serlo');
    ok((await req('GET', '/api/admin/resumen', null, A)).s === 403, 'A ya no entra al panel');
    await req('PATCH', '/api/admin/usuarios/' + idA, { rol: 'admin' }, B);

    console.log('Cifras y actividad');
    const lista = (await req('GET', '/api/admin/usuarios', null, A)).j;
    const uB = lista.find(u => u.email === 'beto@test.com'), uC = lista.find(u => u.email === 'caro@test.com');
    ok(uB.carreras === 2 && uB.vmax === 105 && Math.abs(uB.mejor_402 - 14.2) < 1e-9, 'cifras de B: 2 carreras, Vmáx 105, mejor 402 m 14,20 s');
    ok(uC.estado === 'pendiente' && uC.carreras === 0, 'C sigue pendiente sin carreras');
    ok(!('password_hash' in uB) && !('trace' in uB), 'el panel no recibe contraseñas ni trazados');
    ok(lista.find(u => u.email === 'admin@test.com').yo === true, 'marca cuál es la cuenta propia');
    const res = (await req('GET', '/api/admin/resumen', null, A)).j;
    ok(res.cuentas === 3 && res.pendiente === 1 && res.activo === 2 && res.carreras === 3, 'resumen: 3 cuentas, 1 pendiente, 3 carreras');
    const act = (await req('GET', '/api/admin/actividad', null, A)).j;
    ok(act.some(x => x.accion === 'registro' && x.objetivo === 'caro@test.com'), 'actividad: registro de C');
    ok(act.some(x => x.accion === 'bloqueada' && x.objetivo === 'beto@test.com' && x.actor === 'admin@test.com'), 'actividad: quién bloqueó a quién');
    ok(act.some(x => x.accion === 'sesion'), 'actividad: inicios de sesión');

    console.log('Eliminar');
    const d1 = await req('DELETE', '/api/admin/usuarios/' + idC, null, A);
    ok(d1.s === 200 && d1.j.carreras_borradas === 0, 'elimina a C');
    ok((await req('GET', '/api/runs', null, C)).s === 401, 'el token de C ya no sirve');
    const d2 = await req('DELETE', '/api/admin/usuarios/' + idB + '?carreras=1', null, A);
    ok(d2.s === 200 && d2.j.carreras_borradas === 2, 'elimina a B con sus 2 carreras');
    const res2 = (await req('GET', '/api/admin/resumen', null, A)).j;
    ok(res2.cuentas === 1 && res2.carreras === 1, 'quedan 1 cuenta y la carrera de A');
    const reg = await req('POST', '/api/auth/register', { email: 'beto@test.com', password: 'secreto2' });
    ok(reg.s === 201 && reg.j.user.estado === 'pendiente', 'B puede volver a registrarse y queda pendiente');
  } catch (e) { console.log('ERROR', e); fallos++; }
  srv.kill(); await mem.stop();
  if (fallos) console.log('\n--- log del servidor ---\n' + log);
  console.log(fallos ? `\n${fallos} FALLOS` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
