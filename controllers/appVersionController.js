const mongoose = require('mongoose');
const Config   = require('../models/Config');
const cuentas  = require('../lib/cuentas');

// Última versión de la app Android que publica el admin. La app la consulta al
// abrirse y avisa si hay una más nueva, con el enlace para descargarla.
const CLAVE = 'app_version';
const VACIA = { code: 0, nombre: '', enlace: '', notas: '', obligatoria: false };
const dbLista = () => mongoose.connection.readyState === 1;

async function leer() {
    if (!dbLista()) return VACIA;
    const c = await Config.findOne({ clave: CLAVE }).lean();
    return { ...VACIA, ...(c && c.valor ? c.valor : {}), actualizada: c ? c.updatedAt : null };
}

// GET /api/app/version — pública (la app la consulta aunque no haya iniciado sesión)
const obtener = async (req, res) => {
    try { res.json(await leer()); } catch (e) { res.json(VACIA); }
};

// PUT /api/admin/app-version  { code, nombre, enlace, notas, obligatoria }
const guardar = async (req, res) => {
    if (!dbLista()) return res.status(503).json({ message: 'La base de datos no está disponible' });
    const b = req.body || {};
    const code = Number(b.code);
    if (!Number.isInteger(code) || code < 1 || code > 100000) {
        return res.status(400).json({ message: 'El número de versión debe ser un entero (por ejemplo 2)' });
    }
    const nombre = String(b.nombre || '').trim().slice(0, 20);
    if (!nombre) return res.status(400).json({ message: 'Escribe el nombre de la versión (por ejemplo 1.1)' });
    const enlace = String(b.enlace || '').trim();
    let ok = false;
    try { ok = new URL(enlace).protocol === 'https:'; } catch (_) { ok = false; }
    if (!ok) return res.status(400).json({ message: 'El enlace de descarga debe empezar por https://' });
    const valor = { code, nombre, enlace: enlace.slice(0, 500), notas: String(b.notas || '').trim().slice(0, 500), obligatoria: b.obligatoria === true };
    try {
        await Config.updateOne({ clave: CLAVE }, { $set: { valor } }, { upsert: true });
        cuentas.anotar('version', { actor: req.user.email, detalle: `app ${nombre} (${code})${valor.obligatoria ? ', obligatoria' : ''}` });
        res.json(await leer());
    } catch (e) {
        console.error('❌ app-version:', e.message);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = { obtener, guardar };
