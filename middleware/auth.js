const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const cuentas = require('../lib/cuentas');

// ── Clave para firmar las sesiones ─────────────────────────────────
// Lo correcto es definir JWT_SECRET en Railway → Variables (32+ caracteres al
// azar). Si falta, es corta o es una de las de ejemplo publicadas en el
// repositorio, se deriva de MONGO_URI (que es secreta) para no quedar expuestos.
const CLAVES_DE_EJEMPLO = [
    'dragmoto_clave_secreta_2025',
    'cambia-esto-por-una-clave-larga-al-azar'
];
function resolverClave() {
    const env = process.env.JWT_SECRET || '';
    const deEjemplo = CLAVES_DE_EJEMPLO.includes(env);
    if (env.length >= 16 && !deEjemplo) return env;
    if (deEjemplo) console.warn('⚠️  JWT_SECRET es la clave de ejemplo del repositorio: se ignora. Pon una clave larga al azar en Railway → Variables.');
    if (process.env.MONGO_URI) {
        if (!deEjemplo) console.warn('⚠️  Falta JWT_SECRET (mínimo 16 caracteres): se usa una clave derivada de MONGO_URI. Configúrala en Railway → Variables.');
        return crypto.createHash('sha256').update('dragmoto-jwt|' + process.env.MONGO_URI).digest('hex');
    }
    console.warn('⚠️  Sin JWT_SECRET ni MONGO_URI: las sesiones se pierden al reiniciar el servidor.');
    return crypto.randomBytes(32).toString('hex');
}

const SECRET     = resolverClave();
const EXPIRACION = '90d';   // la app y la página no piden contraseña cada día

function firmarToken(user) {
    return jwt.sign({ sub: user._id.toString(), email: user.email }, SECRET, { expiresIn: EXPIRACION });
}

/** Devuelve { id, email, iat } si el token es válido; null si no. */
function verificarToken(token) {
    if (!token || typeof token !== 'string') return null;
    try {
        const p = jwt.verify(token, SECRET);
        return p && p.sub ? { id: p.sub, email: p.email, iat: p.iat || 0 } : null;
    } catch (_) {
        return null;
    }
}

function tokenDe(req) {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

/** 'app' si la petición viene de la app Android (encabezado X-DragMoto-Client), si no 'web'. */
function clienteDe(valor) {
    return String(valor || '').toLowerCase() === 'app' ? 'app' : 'web';
}

/**
 * Valida la sesión sin mirar si la cuenta está aprobada (para /api/auth/me y
 * cambiar la contraseña). Sí rechaza cuentas borradas y sesiones anteriores
 * a un cambio de contraseña.
 */
async function requireSesion(req, res, next) {
    const user = verificarToken(tokenDe(req));
    if (!user) return res.status(401).json({ message: 'Inicia sesión para continuar' });
    try {
        const cuenta = await cuentas.estadoDe(user.id);
        if (cuenta === null) return res.status(401).json({ code: 'sin_cuenta', message: 'La cuenta ya no existe' });
        if (cuenta && cuentas.sesionVieja(cuenta, user.iat)) {
            return res.status(401).json({ code: 'sesion_vieja', message: 'La contraseña cambió: vuelve a iniciar sesión' });
        }
    } catch (_) { /* sin base de datos: se deja pasar */ }
    req.user = user;
    next();
}

/**
 * Exige sesión y una cuenta activa con permiso para este cliente (página o app).
 * Deja en req.user { id, email, rol, estado, permisos } y en req.cliente 'web' | 'app'.
 */
async function requireAuth(req, res, next) {
    const user = verificarToken(tokenDe(req));
    if (!user) return res.status(401).json({ message: 'Inicia sesión para continuar' });
    const cliente = clienteDe(req.headers['x-dragmoto-client']);
    try {
        const cuenta = await cuentas.estadoDe(user.id);
        if (cuenta !== undefined) {   // undefined = base de datos caída: no se bloquea a nadie
            const no = cuentas.motivoBloqueo(cuenta, cliente, user.iat);
            if (no) return res.status(no.status).json({ code: no.code, message: no.message });
            Object.assign(user, cuenta);
            cuentas.registrarUso(user.id, cliente);
        }
    } catch (e) {
        console.error('❌ Revisando la cuenta:', e.message);
    }
    req.user = user;
    req.cliente = cliente;
    next();
}

/** Solo administradores (va después de requireAuth). */
function requireAdmin(req, res, next) {
    if (req.user && req.user.rol === 'admin') return next();
    res.status(403).json({ code: 'no_admin', message: 'Solo el administrador puede hacer esto' });
}

module.exports = { firmarToken, verificarToken, requireAuth, requireSesion, requireAdmin, clienteDe };
