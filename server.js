require('dotenv').config();

const express   = require('express');
const http      = require('http');
const { Server} = require('socket.io');
const cors      = require('cors');
const path      = require('path');
const connectDB = require('./config/database');
const runRoutes = require('./routes/runs');

const app    = express();
const server = http.createServer(app);   // servidor HTTP base
const io     = new Server(server, {      // Socket.io sobre el mismo servidor
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

// ── Base de datos ──────────────────────────────────────────────────
connectDB();

// ── Middleware ─────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'DELETE'] }));
app.use(express.json());

// Sirve el dashboard como página estática
app.use(express.static(path.join(__dirname, 'public')));

// Logger de peticiones
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Pasa la instancia de io a los controladores vía app
app.set('io', io);

// ── Rutas API ──────────────────────────────────────────────────────
app.use('/api/runs', runRoutes);

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', server: 'DragMoto API v2', timestamp: new Date().toISOString() });
});

// Dashboard — sirve index.html para cualquier ruta no-API
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── WebSockets ─────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`📡 Dashboard conectado: ${socket.id}`);

    socket.on('disconnect', () => {
        console.log(`📴 Dashboard desconectado: ${socket.id}`);
    });
});

// ── Arrancar ───────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`   Dashboard: http://localhost:${PORT}`);
    console.log(`   API:       http://localhost:${PORT}/api/runs`);
});
