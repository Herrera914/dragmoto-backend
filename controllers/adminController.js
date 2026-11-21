const mongoose  = require('mongoose');
const User      = require('../models/User');
const Run       = require('../models/Run');
const Actividad = require('../models/Actividad');
const cuentas   = require('../lib/cuentas');

const dbLista  = () => mongoose.connection.readyState === 1;
const ACTIVO_MS = 2 * 60 * 1000;   // usó la página o la app en los últimos 2 minutos = en línea
const esId = (id) => /^[0-9a-f]{24}$/i.test(String(id));

function enVivo(req) {
    const f = req.app.get('enVivo');
    return f ? f() : { enLinea: new Set(), motosOn: new Set() };
}

const sinBase = (res) => res.status(503).json({ message: 'La base de datos no está disponible' });

// GET /api/admin/resumen
const resumen = async (req, res) => {
    if (!dbLista()) return sinBase(res);
    try {
        const hace7 = Date.now() - 7 * 24 * 3600 * 1000;
        const [porEstado, carreras, carreras7, recientes] = await Promise.all([
            User.aggregate([{ $group: { _id: { $ifNull: ['$estado', 'activo'] }, n: { $sum: 1 } } }]),
            Run.countDocuments(),
            Run.countDocuments({ created_at: { $gte: hace7 } }),
            User.countDocuments({ ultimo_uso: { $gte: new Date(Date.now() - ACTIVO_MS) } })
        ]);
        const estados = { pendiente: 0, activo: 0, bloqueado: 0 };
        porEstado.forEach((e) => { estados[e._id] = e.n; });
        const vivo = enVivo(req);
        res.json({
            cuentas: estados.pendiente + estados.activo + estados.bloqueado,
            ...estados,
            carreras,
            carreras_7d: carreras7,
            en_linea: Math.max(vivo.enLinea.size, recientes),
            motos_conectadas: vivo.motosOn.size
        });
    } catch (e) {
        console.error('❌ admin/resumen:', e.message);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// GET /api/admin/usuarios — cuentas con cifras de sus carreras (sin el detalle)
const usuarios = async (req, res) => {
    if (!dbLista()) return sinBase(res);
    try {
        const [lista, cifras] = await Promise.all([
            User.find().select('-password_hash -__v').sort({ createdAt: -1 }).lean(),
            Run.aggregate([{ $group: {
                _id: '$user_id',
                carreras: { $sum: 1 },
                vmax: { $max: '$top_speed' },
                mejor_402: { $min: '$quarter_mile' },
                ultima: { $max: '$created_at' }
            } }])
        ]);
        const porUsuario = new Map(cifras.map((c) => [String(c._id), c]));
        const vivo = enVivo(req);
        const ahora = Date.now();
        res.json(lista.map((u) => {
            const c = cuentas.normalizar(u);
            const k = porUsuario.get(c.id) || {};
            return {
                ...c,
                name: u.name || '',
                nota: u.nota || '',
                creado: u.createdAt,
                aprobado_en: u.aprobado_en || null,
                ultimo_uso: u.ultimo_uso || null,
                ultimo_cliente: u.ultimo_cliente || null,
                en_linea: vivo.enLinea.has(c.id) || (u.ultimo_uso && ahora - new Date(u.ultimo_uso) < ACTIVO_MS) || false,
                moto_conectada: vivo.motosOn.has(c.id),
                carreras: k.carreras || 0,
                vmax: k.vmax ?? null,
                mejor_402: k.mejor_402 ?? null,
                ultima_carrera: k.ultima ?? null,
                yo: c.id === req.user.id
            };
        }));
    } catch (e) {
        console.error('❌ admin/usuarios:', e.message);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

/** Corta en el momento la conexión en vivo (página y app) de una cuenta. */
function desconectar(req, id) {
    const io = req.app.get('io');
    if (io) io.in('u:' + id).disconnectSockets(true);
}

// PATCH /api/admin/usuarios/:id  { estado?, permisos?: { web?, app? }, rol?, nota? }
const actualizar = async (req, res) => {
    if (!dbLista()) return sinBase(res);
    const id = req.params.id;
    if (!esId(id)) return res.status(404).json({ message: 'Cuenta no encontrada' });
    const b = req.body || {};
    try {
        const u = await User.findById(id);
        if (!u) return res.status(404).json({ message: 'Cuenta no encontrada' });
        const antes = cuentas.normalizar(u.toObject());
        const yo = id === req.user.id;
        const cambios = [];

        if (b.estado !== undefined) {
            if (!['pendiente', 'activo', 'bloqueado'].includes(b.estado)) return res.status(400).json({ message: 'Estado inválido' });
            if (yo && b.estado !== 'activo') return res.status(400).json({ message: 'No puedes bloquear ni dejar en espera tu propia cuenta' });
            if (b.estado !== antes.estado) {
                u.estado = b.estado;
                if (b.estado === 'activo' && !u.aprobado_en) u.aprobado_en = new Date();
                cambios.push(b.estado === 'activo' ? 'aprobada' : b.estado === 'bloqueado' ? 'bloqueada' : 'en espera');
            }
        }
        if (b.permisos && typeof b.permisos === 'object') {
            for (const k of ['web', 'app']) {
                if (typeof b.permisos[k] !== 'boolean' || b.permisos[k] === antes.permisos[k]) continue;
                if (yo && k === 'web' && !b.permisos[k]) return res.status(400).json({ message: 'No puedes quitarte el permiso de la página: perderías el panel' });
                u.set('permisos.' + k, b.permisos[k]);
                cambios.push(`${k === 'web' ? 'página' : 'app'} ${b.permisos[k] ? 'permitida' : 'quitada'}`);
            }
        }
        if (b.rol !== undefined) {
            if (!['admin', 'usuario'].includes(b.rol)) return res.status(400).json({ message: 'Rol inválido' });
            if (b.rol !== antes.rol) {
                if (b.rol === 'usuario') {
                    if (yo) return res.status(400).json({ message: 'No puedes quitarte el rol de administrador' });
                    const admins = await User.countDocuments({ rol: 'admin' });
                    if (admins <= 1) return res.status(400).json({ message: 'Debe quedar al menos un administrador' });
                }
                u.rol = b.rol;
                if (b.rol === 'admin') { u.estado = 'activo'; u.set('permisos.web', true); }
                cambios.push(b.rol === 'admin' ? 'ahora es administrador' : 'ya no es administrador');
            }
        }
        if (typeof b.nota === 'string') {
            const nota = b.nota.trim().slice(0, 200);
            if (nota !== (u.nota || '')) { u.nota = nota; cambios.push('nota'); }
        }

        if (cambios.length) {
            await u.save();
            cuentas.invalidar(id);
            const despues = cuentas.normalizar(u.toObject());
            const pierdeAcceso = despues.estado !== 'activo' || !despues.permisos.web || !despues.permisos.app;
            if (pierdeAcceso) desconectar(req, id);   // al reconectar se revisa el permiso de cada cliente
            cuentas.anotar(cambios.includes('aprobada') ? 'aprobada' : cambios.includes('bloqueada') ? 'bloqueada' : 'cambio', {
                actor: req.user.email, objetivo: u.email, detalle: cambios.join(', ')
            });
        }
        const out = cuentas.normalizar(u.toObject());
        res.json({ ...out, name: u.name || '', nota: u.nota || '', aprobado_en: u.aprobado_en, cambios });
    } catch (e) {
        console.error('❌ admin/actualizar:', e.message);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// DELETE /api/admin/usuarios/:id?carreras=1
const eliminar = async (req, res) => {
    if (!dbLista()) return sinBase(res);
    const id = req.params.id;
    if (!esId(id)) return res.status(404).json({ message: 'Cuenta no encontrada' });
    if (id === req.user.id) return res.status(400).json({ message: 'No puedes eliminar tu propia cuenta' });
    try {
        const u = await User.findById(id).lean();
        if (!u) return res.status(404).json({ message: 'Cuenta no encontrada' });
        if (u.rol === 'admin' && (await User.countDocuments({ rol: 'admin' })) <= 1) {
            return res.status(400).json({ message: 'Debe quedar al menos un administrador' });
        }
        const conCarreras = req.query.carreras === '1';
        await User.deleteOne({ _id: id });
        const borradas = conCarreras ? (await Run.deleteMany({ user_id: id })).deletedCount : 0;
        cuentas.invalidar(id);
        desconectar(req, id);
        cuentas.anotar('eliminada', { actor: req.user.email, objetivo: u.email,
            detalle: conCarreras ? `con ${borradas} carreras` : 'carreras conservadas' });
        res.json({ eliminada: true, carreras_borradas: borradas });
    } catch (e) {
        console.error('❌ admin/eliminar:', e.message);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// GET /api/admin/actividad
const actividad = async (req, res) => {
    if (!dbLista()) return sinBase(res);
    try {
        const lista = await Actividad.find().sort({ en: -1 }).limit(200).select('-_id -__v').lean();
        res.json(lista);
    } catch (e) {
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = { resumen, usuarios, actualizar, eliminar, actividad };
