require('dotenv').config();

const express   = require('express');
const http      = require('http');
const { Server} = require('socket.io');
const cors      = require('cors');
const path      = require('path');
const mongoose  = require('mongoose');
const connectDB = require('./config/database');
const runRoutes  = require('./routes/runs');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const cuentas    = require('./lib/cuentas');
const { requireAuth, verificarToken, clienteDe } = require('./middleware/auth');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);   // Railway va detrás de un proxy: req.ip = IP real

// ── Estado en vivo por usuario ─────────────────────────────────────
// Cada cuenta tiene su propia moto, su comando pendiente y su CDI, así
// dos personas pueden registrar a la vez sin mezclar datos. Cada página
// abierta se une a la sala 'u:<id>' y solo recibe los eventos de su cuenta.
const POLL_TIMEOUT_MS = 15000;   // la app hace polling de comandos cada ~2 s
const CDI_TIMEOUT_MS  = 3000;

const motos = new Map();   // userId -> estado
function motoDe(userId) {
    let m = motos.get(userId);
    if (!m) {
        m = { androidSocketId: null, pendingCommand: null, lastPollAt: 0, lastCdiAt: 0, conectadaAvisada: false };
        motos.set(userId, m);
    }
    return m;
}
const sala = (userId) => 'u:' + userId;
const motoConectada = (m) => m.androidSocketId !== null || Date.now() - m.lastPollAt < POLL_TIMEOUT_MS;

function notificarEstadoMoto(userId) {
    const m = motoDe(userId);
    const ahora = motoConectada(m);
    if (ahora !== m.conectadaAvisada) {
        m.conectadaAvisada = ahora;
        console.log(`${ahora ? '📱 Moto conectada' : '📴 Moto desconectada'} (${userId})`);
        io.to(sala(userId)).emit('moto_status', { conectada: ahora });
    }
}
setInterval(() => {
    for (const userId of motos.keys()) notificarEstadoMoto(userId);
}, 5000);

// ── Base de datos ──────────────────────────────────────────────────
connectDB();

// ── Middleware ─────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
// El trazado de una carrera (gráficas de la página) puede pesar unos cientos de KB
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.set('io', io);
// Para el panel de administración: quién tiene la página o la app abierta y qué motos están conectadas
app.set('enVivo', () => {
    const enLinea = new Set();
    for (const [room, socks] of io.sockets.adapter.rooms) {
        if (room.startsWith('u:') && socks.size) enLinea.add(room.slice(2));
    }
    const motosOn = new Set();
    for (const [id, m] of motos) if (motoConectada(m)) motosOn.add(id);
    return { enLinea, motosOn };
});

// ── Rutas API ──────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/runs', runRoutes);   // exige sesión (ver routes/runs.js)
app.use('/api/admin', adminRoutes); // solo administradores

app.get('/api/health', (req, res) => {
    res.json({
        status       : 'ok',
        server       : 'DragMoto API v2',
        // Commit desplegado (Railway lo define) — para comprobar que el despliegue llegó
        version      : (process.env.RAILWAY_GIT_COMMIT_SHA || 'local').slice(0, 7),
        cdi_api      : true,
        cuentas      : true,
        admin        : true,
        timestamp    : new Date().toISOString(),
        db_conectada : mongoose.connection.readyState === 1
    });
});

// ── POST /api/telemetry/prepare — activa el comando de inicio ─────
app.post('/api/telemetry/prepare', requireAuth, (req, res) => {
    motoDe(req.user.id).pendingCommand = 'start';
    console.log(`⚡ prepare HTTP → start (${req.user.id})`);
    res.json({ ok: true, mensaje: 'Comando encolado — la moto lo recibirá en el próximo poll' });
});

// ── GET /api/telemetry/command — la moto hace polling aquí ────────
// Devuelve el comando pendiente de su cuenta y lo consume (one-shot).
app.get('/api/telemetry/command', requireAuth, (req, res) => {
    const m   = motoDe(req.user.id);
    const cmd = m.pendingCommand;
    m.pendingCommand = null;
    m.lastPollAt     = Date.now();
    notificarEstadoMoto(req.user.id);
    res.json({ command: cmd });
});

// ── POST /api/telemetry/cdi — lecturas en vivo del CDI (RPM, avance, voltaje) ─
// La app las envía varias veces por segundo mientras está conectada al CDI;
// la página solo muestra la tarjeta de RPM si llegan.
const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

app.post('/api/telemetry/cdi', requireAuth, (req, res) => {
    const { rpm, advance, volts } = req.body || {};
    if (!finite(rpm, 0, 30000)) {
        return res.status(400).json({ message: 'rpm inválido' });
    }
    const m = motoDe(req.user.id);
    m.lastCdiAt = Date.now();
    io.to(sala(req.user.id)).emit('cdi_point', {
        rpm:     Math.round(rpm),
        advance: finite(advance, -20, 80) ? advance : null,
        volts:   finite(volts, 0, 30) ? volts : null,
        at:      m.lastCdiAt
    });
    res.json({ received: true });
});

// ── GET /api/telemetry/status — estado de conexión de la moto ─────
app.get('/api/telemetry/status', requireAuth, (req, res) => {
    const m = motoDe(req.user.id);
    res.json({
        moto_conectada: motoConectada(m),
        ultimo_poll   : m.lastPollAt || null,
        cdi_conectado : Date.now() - m.lastCdiAt < CDI_TIMEOUT_MS
    });
});

// Rutas /api desconocidas: 404 en JSON (no la página)
app.use('/api', (req, res) => res.status(404).json({ message: 'Ruta no encontrada' }));

// Panel de administración (la página revisa el rol; los datos los protege /api/admin)
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Dashboard — cualquier ruta no-API sirve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── WebSockets ─────────────────────────────────────────────────────
// Toda conexión debe traer la sesión: io({ auth: { token } })
// y una cuenta activa con permiso para ese cliente: io({ auth: { token, client: 'app' } })
io.use(async (socket, next) => {
    const auth = socket.handshake.auth || {};
    const user = verificarToken(auth.token);
    if (!user) return next(new Error('auth'));
    try {
        const cuenta = await cuentas.estadoDe(user.id);
        if (cuenta !== undefined) {
            const no = cuentas.motivoBloqueo(cuenta, clienteDe(auth.client), user.iat);
            if (no) {
                const err = new Error(no.status === 401 ? 'auth' : 'acceso');
                err.data = { code: no.code, message: no.message };
                return next(err);
            }
        }
    } catch (_) { /* sin base de datos: se deja pasar */ }
    socket.data.user = user;
    next();
});

io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    socket.join(sala(userId));

    // Estado actual de su moto al conectarse
    const m = motoDe(userId);
    socket.emit('moto_status', { conectada: motoConectada(m) });

    // ── Registro de cliente ────────────────────────────────────────
    // La app Android emite 'register' con tipo 'android' al conectarse.
    socket.on('register', (data) => {
        if (data && data.tipo === 'android') {
            motoDe(userId).androidSocketId = socket.id;
            console.log(`📱 Moto registrada: ${socket.id} (${userId})`);
            socket.emit('register_ok', { mensaje: 'Moto registrada en el servidor' });
            notificarEstadoMoto(userId);
        }
    });

    // ── Botón PREPARAR desde la página ─────────────────────────────
    socket.on('web_trigger_prepare', () => {
        motoDe(userId).pendingCommand = 'start';
        console.log(`⚡ web_trigger_prepare → start (${userId})`);
        socket.emit('prepare_ok', { mensaje: 'Comando enviado — la moto lo recibirá en segundos' });
    });

    // ── Puntos GPS en vivo desde la moto (por socket) ──────────────
    socket.on('live_point_from_android', (data) => {
        socket.to(sala(userId)).emit('live_point', data);
    });

    // ── Desconexión ────────────────────────────────────────────────
    socket.on('disconnect', () => {
        const mm = motoDe(userId);
        if (socket.id === mm.androidSocketId) {
            mm.androidSocketId = null;
            notificarEstadoMoto(userId);   // sigue "conectada" si hace polling HTTP
        }
    });
});

// ── Arrancar ───────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`   Dashboard: http://localhost:${PORT}`);
    console.log(`   API:       http://localhost:${PORT}/api/runs`);
});
