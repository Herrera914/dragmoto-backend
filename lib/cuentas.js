const mongoose  = require('mongoose');
const User      = require('../models/User');
const Actividad = require('../models/Actividad');

// ── Estado de las cuentas para cada petición ───────────────────────
// El JWT dura 90 días, así que el estado (aprobada, bloqueada, permisos) se
// consulta en la base con un caché corto. Al cambiar algo desde el panel se
// invalida el caché y el cambio se aplica al momento.
const CACHE_MS = 30 * 1000;
const USO_MS   = 60 * 1000;
const cache = new Map();   // id -> { datos, hasta }
const usoGuardado = new Map();   // id -> ms de la última escritura de ultimo_uso

const dbLista = () => mongoose.connection.readyState === 1;

/** Normaliza una cuenta leída con lean(). */
function normalizar(u) {
    return {
        id: u._id.toString(),
        email: u.email,
        rol: u.rol === 'admin' ? 'admin' : 'usuario',
        estado: u.estado || 'activo',
        permisos: { web: u.permisos?.web !== false, app: u.permisos?.app !== false },
        claveDesde: u.clave_cambiada_en ? new Date(u.clave_cambiada_en).getTime() : 0
    };
}

/** La sesión se emitió antes del último cambio de contraseña (iat en segundos). */
function sesionVieja(cuenta, iat) {
    return !!(cuenta && cuenta.claveDesde && (iat || 0) * 1000 + 1000 < cuenta.claveDesde);
}

/** { id, email, rol, estado, permisos } | null si la cuenta no existe. Sin base de datos: null-safe. */
async function estadoDe(id) {
    const c = cache.get(id);
    if (c && c.hasta > Date.now()) return c.datos;
    if (!dbLista()) return c ? c.datos : undefined;   // sin base: no se puede decidir
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const u = await User.findById(id).select('email rol estado permisos clave_cambiada_en').lean();
    const datos = u ? normalizar(u) : null;
    cache.set(id, { datos, hasta: Date.now() + CACHE_MS });
    return datos;
}

function invalidar(id) { cache.delete(String(id)); }

/** Guarda el último uso (como mucho una vez por minuto por cuenta). */
function registrarUso(id, cliente) {
    const ahora = Date.now();
    if (!dbLista() || ahora - (usoGuardado.get(id) || 0) < USO_MS) return;
    usoGuardado.set(id, ahora);
    User.updateOne({ _id: id }, { $set: { ultimo_uso: new Date(ahora), ultimo_cliente: cliente } })
        .catch(() => {});
}

/** ¿Puede esta cuenta usar este cliente? Devuelve null si sí, o { code, message } si no. */
function motivoBloqueo(cuenta, cliente, iat) {
    if (!cuenta) return { status: 401, code: 'sin_cuenta', message: 'La cuenta ya no existe' };
    if (iat !== undefined && sesionVieja(cuenta, iat)) {
        return { status: 401, code: 'sesion_vieja', message: 'La contraseña cambió: vuelve a iniciar sesión' };
    }
    if (cuenta.estado === 'pendiente') return { status: 403, code: 'pendiente', message: 'Tu cuenta espera aprobación del administrador' };
    if (cuenta.estado === 'bloqueado') return { status: 403, code: 'bloqueado', message: 'Tu cuenta está bloqueada. Habla con el administrador' };
    if (!cuenta.permisos[cliente]) {
        return { status: 403, code: 'sin_permiso',
            message: cliente === 'app' ? 'Tu cuenta no tiene permiso para usar la app' : 'Tu cuenta no tiene permiso para usar la página' };
    }
    return null;
}

function anotar(accion, { actor = '', objetivo = '', detalle = '' } = {}) {
    if (!dbLista()) return;
    Actividad.create({ accion, actor, objetivo, detalle }).catch(() => {});
}

/**
 * Migración al conectar: las cuentas creadas antes del panel quedan activas y,
 * si no hay ningún admin, la cuenta más antigua pasa a serlo.
 */
async function migrar() {
    try {
        await User.updateMany({ estado: { $exists: false } }, { $set: { estado: 'activo' } });
        await User.updateMany({ rol: { $exists: false } }, { $set: { rol: 'usuario' } });
        if (!(await User.exists({ rol: 'admin' }))) {
            const primera = await User.findOne().sort({ createdAt: 1 });
            if (primera) {
                await User.updateOne({ _id: primera._id }, { $set: { rol: 'admin', estado: 'activo' } });
                console.log(`🛡️  ${primera.email} queda como administrador`);
            }
        }
    } catch (e) {
        console.error('❌ Migración de cuentas:', e.message);
    }
}
mongoose.connection.on('connected', migrar);
if (dbLista()) migrar();

module.exports = { estadoDe, invalidar, registrarUso, motivoBloqueo, anotar, normalizar, sesionVieja };
