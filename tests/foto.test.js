// Foto de perfil: subir, ver (solo dueño o admin), quitar y validaciones (MongoDB en memoria)
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
const raw = (p, token) => fetch(BASE + p, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// JPEG mínimo válido (1×1 px) y un PNG de 1×1
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const dataUrl = (tipo, buf) => `data:${tipo};base64,${buf.toString('base64')}`;

(async () => {
  const mem = await MongoMemoryServer.create();
  const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '3998', MONGO_URI: mem.getUri('dragmoto'), JWT_SECRET: 'prueba-local-0123456789' } });
  let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
  for (let i = 0; i < 40; i++) { try { const h = await req('GET', '/api/health'); if (h.j && h.j.db_conectada) break; } catch (_) {} await sleep(250); }
  try {
    console.log('Foto de perfil');
    const a = await req('POST', '/api/auth/register', { email: 'admin@test.com', password: 'secreto1' });
    const A = a.j.token, idA = a.j.user.id;
    const b = await req('POST', '/api/auth/register', { email: 'beto@test.com', password: 'secreto2' });
    const B = b.j.token, idB = b.j.user.id;
    const c = await req('POST', '/api/auth/register', { email: 'caro@test.com', password: 'secreto3' });
    const C = c.j.token;
    await req('PATCH', '/api/admin/usuarios/' + c.j.user.id, { estado: 'activo' }, A);
    ok(a.j.user.foto === null, 'sin foto: foto = null');

    const sub = await req('PUT', '/api/auth/foto', { imagen: dataUrl('image/jpeg', JPG) }, B);
    ok(sub.s === 200 && /^\/api\/usuarios\/[0-9a-f]{24}\/foto\?v=\d+$/.test(sub.j.foto), 'B (aunque esté pendiente) sube su foto y recibe la URL');
    const url = sub.j.foto;
    const propia = await raw(url, B);
    const bytes = Buffer.from(await propia.arrayBuffer());
    ok(propia.status === 200 && propia.headers.get('content-type') === 'image/jpeg' && bytes.equals(JPG), 'B ve su foto (mismos bytes, image/jpeg)');
    ok((await raw(url, A)).status === 200, 'el admin ve la foto de B');
    ok((await raw(url, C)).status === 403, 'otra cuenta normal NO puede ver la foto de B');
    ok((await raw(url)).status === 401, 'sin sesión no se ve');
    ok((await raw('/api/usuarios/' + idA + '/foto', A)).status === 404, 'sin foto: 404');
    ok((await req('GET', '/api/auth/me', null, B)).j.foto === url, '/me trae la URL de la foto');
    const lista = (await req('GET', '/api/admin/usuarios', null, A)).j;
    ok(lista.find(u => u.id === idB).foto === url, 'el panel recibe la URL de la foto');
    ok(!JSON.stringify(lista).includes(JPG.toString('base64').slice(0, 20)), 'el panel no recibe los bytes de las fotos en la lista');

    await sleep(5);
    const png = await req('PUT', '/api/auth/foto', { imagen: dataUrl('image/png', PNG) }, B);
    ok(png.s === 200 && png.j.foto !== url, 'cambiar la foto cambia la versión de la URL');
    ok((await raw(png.j.foto, B)).headers.get('content-type') === 'image/png', 'acepta PNG');

    console.log('Validaciones');
    ok((await req('PUT', '/api/auth/foto', { imagen: dataUrl('image/gif', JPG) }, B)).s === 400, 'GIF u otros tipos: rechazado');
    ok((await req('PUT', '/api/auth/foto', { imagen: dataUrl('image/jpeg', Buffer.from('no soy una imagen')) }, B)).s === 400, 'texto disfrazado de JPEG: rechazado');
    ok((await req('PUT', '/api/auth/foto', { imagen: dataUrl('image/png', JPG) }, B)).s === 400, 'JPEG etiquetado como PNG: rechazado');
    const grande = Buffer.concat([JPG, Buffer.alloc(210 * 1024)]);
    ok((await req('PUT', '/api/auth/foto', { imagen: dataUrl('image/jpeg', grande) }, B)).s === 413, 'más de 200 KB: rechazado');
    ok((await req('PUT', '/api/auth/foto', { imagen: 'hola' }, B)).s === 400, 'sin formato data URL: rechazado');
    ok((await req('PUT', '/api/auth/foto', { imagen: dataUrl('image/jpeg', JPG) })).s === 401, 'sin sesión: rechazado');

    console.log('Quitar');
    const q = await req('DELETE', '/api/auth/foto', null, B);
    ok(q.s === 200 && q.j.foto === null, 'quita su foto');
    ok((await raw(png.j.foto, B)).status === 404, 'la foto ya no se sirve');
  } catch (e) { console.log('ERROR', e); fallos++; }
  srv.kill(); await mem.stop();
  if (fallos) console.log('\n--- log del servidor ---\n' + log);
  console.log(fallos ? `\n${fallos} FALLOS` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
