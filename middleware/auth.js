const crypto = require('crypto');
const jwt    = require('jsonwebtoken');

// ── Clave para firmar las sesiones ─────────────────────────────────
// Lo correcto es definir JWT_SECRET en Railway → Variables. Si falta, se
// deriva de MONGO_URI para que las sesiones sigan valiendo tras reiniciar.
function resolverClave() {
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
        return process.env.JWT_SECRET;
    }
    if (process.env.MONGO_URI) {
        console.warn('⚠️  Falta JWT_SECRET (mínimo 16 caracteres): se usa una clave derivada de MONGO_URI. Configúrala en Railway → Variables.');
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

/** Devuelve { id, email } si el token es válido; null si no. */
function verificarToken(token) {
    if (!token || typeof token !== 'string') return null;
    try {
        const p = jwt.verify(token, SECRET);
        return p && p.sub ? { id: p.sub, email: p.email } : null;
    } catch (_) {
        return null;
    }
}

function tokenDe(req) {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

/** Middleware: exige sesión y deja el usuario en req.user. */
function requireAuth(req, res, next) {
    const user = verificarToken(tokenDe(req));
    if (!user) return res.status(401).json({ message: 'Inicia sesión para continuar' });
    req.user = user;
    next();
}

module.exports = { firmarToken, verificarToken, requireAuth };
