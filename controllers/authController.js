const bcrypt   = require('bcryptjs');
const mongoose = require('mongoose');
const User     = require('../models/User');
const Run      = require('../models/Run');
const { firmarToken } = require('../middleware/auth');
const cuentas  = require('../lib/cuentas');

const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASS   = 6;
const MAX_PASS   = 128;

// ── Límite de intentos (por IP) contra prueba de contraseñas ───────
const VENTANA_MS = 15 * 60 * 1000;
const MAX_INTENTOS = 20;
const intentos = new Map();   // ip -> { n, desde }

function demasiadosIntentos(req) {
    const ip = req.ip || 'desconocida';
    const ahora = Date.now();
    const r = intentos.get(ip);
    if (!r || ahora - r.desde > VENTANA_MS) {
        intentos.set(ip, { n: 1, desde: ahora });
        return false;
    }
    r.n += 1;
    return r.n > MAX_INTENTOS;
}
setInterval(() => {
    const ahora = Date.now();
    for (const [ip, r] of intentos) if (ahora - r.desde > VENTANA_MS) intentos.delete(ip);
}, VENTANA_MS).unref();

const dbLista = () => mongoose.connection.readyState === 1;
// Lo que ve el cliente de su propia cuenta (incluye estado y permisos para mostrar avisos)
const publico = (u) => {
    const c = cuentas.normalizar(u);
    return { id: c.id, email: c.email, name: u.name || '', rol: c.rol, estado: c.estado, permisos: c.permisos };
};

// POST /api/auth/register  { email, password, name }
const register = async (req, res) => {
    if (demasiadosIntentos(req)) return res.status(429).json({ message: 'Demasiados intentos, espera unos minutos' });
    if (!dbLista()) return res.status(503).json({ message: 'La base de datos no está disponible' });

    const email    = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name     = String(req.body?.name || '').trim().slice(0, 40);

    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Correo inválido' });
    if (password.length < MIN_PASS || password.length > MAX_PASS) {
        return res.status(400).json({ message: `La contraseña debe tener al menos ${MIN_PASS} caracteres` });
    }

    try {
        if (await User.exists({ email })) return res.status(409).json({ message: 'Ese correo ya tiene una cuenta' });

        const primera = (await User.estimatedDocumentCount()) === 0;
        // La primera cuenta es el administrador; las demás esperan su aprobación
        const user = await User.create({
            email, name, password_hash: await bcrypt.hash(password, 10),
            rol: primera ? 'admin' : 'usuario',
            estado: primera ? 'activo' : 'pendiente',
            aprobado_en: primera ? new Date() : null
        });
        cuentas.anotar('registro', { actor: email, objetivo: email, detalle: primera ? 'administrador' : 'pendiente de aprobación' });

        // Las carreras que se subieron antes de existir las cuentas pasan a la primera cuenta
        if (primera) {
            const r = await Run.updateMany(
                { $or: [{ user_id: 'anonymous' }, { user_id: { $exists: false } }, { user_id: '' }] },
                { $set: { user_id: user._id.toString() } }
            );
            console.log(`👤 Primera cuenta ${email}: ${r.modifiedCount} carreras anteriores asignadas`);
        } else {
            console.log(`👤 Cuenta creada: ${email}`);
        }

        res.status(201).json({ token: firmarToken(user), user: publico(user) });
    } catch (e) {
        if (e && e.code === 11000) return res.status(409).json({ message: 'Ese correo ya tiene una cuenta' });
        console.error('❌ Error creando cuenta:', e.message);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// POST /api/auth/login  { email, password }
const login = async (req, res) => {
    if (demasiadosIntentos(req)) return res.status(429).json({ message: 'Demasiados intentos, espera unos minutos' });
    if (!dbLista()) return res.status(503).json({ message: 'La base de datos no está disponible' });

    const email    = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    try {
        const user = await User.findOne({ email });
        const ok = user && await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(401).json({ message: 'Correo o contraseña incorrectos' });
        const cuenta = cuentas.normalizar(user.toObject());
        if (cuenta.estado === 'bloqueado') {
            return res.status(403).json({ code: 'bloqueado', message: 'Tu cuenta está bloqueada. Habla con el administrador' });
        }
        cuentas.anotar('sesion', { actor: email, objetivo: email,
            detalle: String(req.headers['x-dragmoto-client'] || '').toLowerCase() === 'app' ? 'app' : 'página' });
        res.json({ token: firmarToken(user), user: publico(user) });
    } catch (e) {
        console.error('❌ Error iniciando sesión:', e.message);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// GET /api/auth/me
const me = async (req, res) => {
    if (!dbLista()) return res.json({ id: req.user.id, email: req.user.email, name: '', rol: 'usuario', estado: 'activo', permisos: { web: true, app: true } });
    try {
        const user = await User.findById(req.user.id).lean();
        if (!user) return res.status(401).json({ message: 'La cuenta ya no existe' });
        res.json(publico(user));
    } catch (e) {
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = { register, login, me };
