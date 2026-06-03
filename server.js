require('dotenv').config();

const express   = require('express');
const http      = require('http');
const { Server} = require('socket.io');
const cors      = require('cors');
const path      = require('path');
const connectDB = require('./config/database');
const runRoutes = require('./routes/runs');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

// ── Registro de la moto (Android) ─────────────────────────────────
// Guarda el socket.id de la app Android cuando se conecta.
// Solo puede haber una moto registrada a la vez.
let androidSocketId = null;
let pendingCommand   = null; // 'start' cuando el dashboard presiona PREPARAR

// ── Base de datos ──────────────────────────────────────────────────
connectDB();

// ── Middleware ─────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'DELETE'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.set('io', io);

// ── Rutas API ──────────────────────────────────────────────────────
app.use('/api/runs', runRoutes);

app.get('/api/health', (req, res) => {
    res.json({
        status       : 'ok',
        server       : 'DragMoto API v2',
        timestamp    : new Date().toISOString(),
        moto_conectada: androidSocketId !== null
    });
});

// ── POST /api/telemetry/prepare — activa el comando de inicio ─────
app.post('/api/telemetry/prepare', (req, res) => {
    pendingCommand = 'start';
    console.log('⚡ prepare HTTP → pendingCommand = start');
    res.json({ ok: true, mensaje: 'Comando encolado — la moto lo recibirá en el próximo poll' });
});

// ── GET /api/telemetry/command — la moto hace polling aquí ────────
// Devuelve el comando pendiente y lo consume (one-shot).
app.get('/api/telemetry/command', (req, res) => {
    const cmd    = pendingCommand;
    pendingCommand = null;
    res.json({ command: cmd });
});

// ── GET /api/telemetry/status — estado de conexión de la moto ─────
app.get('/api/telemetry/status', (req, res) => {
    res.json({
        moto_conectada: androidSocketId !== null,
        socket_id     : androidSocketId
    });
});

// Dashboard — cualquier ruta no-API sirve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── WebSockets ─────────────────────────────────────────────────────
io.on('connection', (socket) => {

    // ── Registro de cliente ────────────────────────────────────────
    // La app Android emite 'register' con tipo 'android' al conectarse.
    // El dashboard web no emite 'register' — solo escucha eventos.
    socket.on('register', (data) => {
        if (data && data.tipo === 'android') {
            androidSocketId = socket.id;
            console.log(`📱 Moto registrada: ${socket.id}`);

            // Confirma el registro a la moto
            socket.emit('register_ok', { mensaje: 'Moto registrada en el servidor' });

            // Notifica al dashboard que la moto está conectada
            socket.broadcast.emit('moto_status', { conectada: true });
        } else {
            console.log(`🖥️  Dashboard conectado: ${socket.id}`);
        }
    });

    // ── Botón PREPARADO desde el dashboard web ─────────────────────
    // El dashboard emite 'web_trigger_prepare' cuando el operador
    // presiona el botón PREPARADO desde los pits.
    socket.on('web_trigger_prepare', () => {
        pendingCommand = 'start';
        console.log('⚡ web_trigger_prepare → pendingCommand = start');
        // Confirma al dashboard inmediatamente; la moto lo recoge en el siguiente poll
        socket.emit('prepare_ok', { mensaje: 'Comando enviado — la moto lo recibirá en segundos' });
    });

    // ── Puntos GPS en vivo desde la moto ──────────────────────────
    // La moto emite 'live_point' con cada lectura del GPS.
    // El servidor lo retransmite a todos los dashboards conectados.
    socket.on('live_point_from_android', (data) => {
        socket.broadcast.emit('live_point', data);
    });

    // ── Desconexión ────────────────────────────────────────────────
    socket.on('disconnect', () => {
        if (socket.id === androidSocketId) {
            androidSocketId = null;
            console.log(`📴 Moto desconectada: ${socket.id}`);
            // Notifica al dashboard
            io.emit('moto_status', { conectada: false });
        } else {
            console.log(`📴 Dashboard desconectado: ${socket.id}`);
        }
    });
});

// ── Arrancar ───────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`   Dashboard: http://localhost:${PORT}`);
    console.log(`   API:       http://localhost:${PORT}/api/runs`);
    console.log(`   Status:    http://localhost:${PORT}/api/telemetry/status`);
});
