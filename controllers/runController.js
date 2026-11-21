const Run = require('../models/Run');

// Cada usuario recibe sus eventos en su propia sala de Socket.io
const CANALES = ['t', 'speed', 'dist', 'g', 'lat', 'lon', 'rpm', 'adv', 'volts'];
const MAX_MUESTRAS = 20000;

/** Deja solo arreglos de números (o null) del mismo largo que t; si algo no cuadra, sin trazado. */
function limpiarTrazado(tr) {
    if (!tr || typeof tr !== 'object' || !Array.isArray(tr.t)) return null;
    const n = tr.t.length;
    if (n < 2 || n > MAX_MUESTRAS) return null;
    const out = { v: 1 };
    for (const c of CANALES) {
        const a = tr[c];
        if (a == null) continue;
        if (!Array.isArray(a) || a.length !== n) return null;
        if (!a.every(x => x === null || (typeof x === 'number' && Number.isFinite(x)))) return null;
        out[c] = a;
    }
    if (!out.speed) return null;
    out.marks = Array.isArray(tr.marks)
        ? tr.marks.slice(0, 30).filter(m => m && typeof m.label === 'string' && Number.isFinite(m.t))
                  .map(m => ({ label: m.label.slice(0, 20), t: m.t }))
        : [];
    return out;
}
const salaDe = (req) => 'u:' + req.user.id;

// POST /api/runs — guarda run completo al finalizar
const uploadRun = async (req, res) => {
    try {
        const data = req.body;

        if (data.created_at === undefined || data.top_speed === undefined || data.total_distance === undefined) {
            return res.status(400).json({ message: 'Faltan campos requeridos' });
        }
        if (data.valid_run === false) {
            return res.status(422).json({ message: 'Run inválido, no se guardó' });
        }

        // El dueño sale de la sesión, nunca del cuerpo de la petición
        const trace = limpiarTrazado(data.trace);
        // Textos con tope: nombre de la moto y su configuración (JSON de la app)
        const texto = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
        const run = new Run({
            ...data,
            vehicle_name: texto(data.vehicle_name, 60),
            setup_notes:  texto(data.setup_notes, 1000),
            trace, has_trace: !!trace, user_id: req.user.id, synced_at: new Date()
        });
        const saved = await run.save();

        console.log(`✅ Run guardado: ${saved._id} | ${data.vehicle_name} | top: ${data.top_speed} km/h`);

        // Emitir evento solo a las páginas abiertas de este usuario
        const io = req.app.get('io');
        if (io) {
            io.to(salaDe(req)).emit('run_completed', {
                id:                saved._id,
                vehicle_name:      data.vehicle_name,
                top_speed:         data.top_speed,
                total_distance:    data.total_distance,
                peak_acceleration: data.peak_acceleration,
                zero_to_30:        data.zero_to_30,
                zero_to_60:        data.zero_to_60,
                zero_to_80:        data.zero_to_80,
                zero_to_100:       data.zero_to_100,
                zero_to_120:       data.zero_to_120,
                sixty_to_hundred:  data.sixty_to_hundred,
                hundred_meters:    data.hundred_meters,
                eighth_mile:       data.eighth_mile,
                quarter_mile:      data.quarter_mile,
                one_km:            data.one_km,
                custom_speed_results:    data.custom_speed_results,
                custom_distance_results: data.custom_distance_results,
                trap_speed_quarter:data.trap_speed_quarter,
                launch_quality:    data.launch_quality,
                max_rpm:           data.max_rpm ?? null,
                synced_at:         saved.synced_at
            });
        }

        res.status(201).json({
            id:        saved._id.toString(),
            message:   'Run guardado correctamente',
            synced_at: saved.synced_at.getTime()
        });

    } catch (error) {
        console.error('❌ Error guardando run:', error.message);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// POST /api/runs/live — recibe puntos GPS en tiempo real durante el run
const livePoint = (req, res) => {
    try {
        const { speed_kmh, acceleration, distance, timestamp, session_id, lat, lon } = req.body;
        // Posición para el mapa en vivo: solo si es una coordenada real
        const coord = (v, max) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? v : null);
        const la = coord(lat, 90), lo = coord(lon, 180);
        const conPosicion = la !== null && lo !== null && !(la === 0 && lo === 0);

        // Reemite el punto al instante, solo a las páginas de este usuario
        const io = req.app.get('io');
        if (io) {
            io.to(salaDe(req)).emit('live_point', {
                speed_kmh:   speed_kmh   || 0,
                acceleration:acceleration || 0,
                distance:    distance    || 0,
                timestamp:   timestamp   || Date.now(),
                session_id:  session_id  || 'unknown',
                lat:         conPosicion ? la : null,
                lon:         conPosicion ? lo : null
            });
        }

        // No se guarda en BD (son datos transitorios de telemetría en vivo)
        res.status(200).json({ received: true });

    } catch (error) {
        res.status(500).json({ message: 'Error procesando punto en vivo' });
    }
};

// GET /api/runs/:id — una carrera completa, con su trazado (solo el dueño)
const getRun = async (req, res) => {
    try {
        if (!/^[0-9a-f]{24}$/i.test(req.params.id)) return res.status(404).json({ message: 'Run no encontrado' });
        const run = await Run.findOne({ _id: req.params.id, user_id: req.user.id }).select('+trace -__v');
        if (!run) return res.status(404).json({ message: 'Run no encontrado' });
        res.json(run);
    } catch (error) {
        res.status(500).json({ message: 'Error consultando el run' });
    }
};

// GET /api/runs — historial
const getRuns = async (req, res) => {
    try {
        // Solo las carreras del usuario con sesión (se ignora ?user_id)
        const filter = { user_id: req.user.id };

        const runs = await Run.find(filter)
            .sort({ created_at: -1 })
            .limit(50)
            .select('-__v');

        res.json(runs);
    } catch (error) {
        res.status(500).json({ message: 'Error consultando runs' });
    }
};

// La app guarda 0 cuando el run no llegó a esa marca: para los mejores
// tiempos se cuenta como "sin dato" ($min ignora null, pero no 0)
const mejorTiempo = (campo) => ({
    $min: { $cond: [{ $gt: [campo, 0] }, campo, null] }
});

// GET /api/runs/stats — estadísticas del usuario
const getStats = async (req, res) => {
    try {
        const stats = await Run.aggregate([
            { $match: { valid_run: true, user_id: req.user.id } },
            {
                $group: {
                    _id:                null,
                    totalRuns:          { $sum: 1 },
                    bestTopSpeed:       { $max: '$top_speed' },
                    bestZeroTo100:      mejorTiempo('$zero_to_100'),
                    bestHundredMeters:  mejorTiempo('$hundred_meters'),
                    bestEighthMile:     mejorTiempo('$eighth_mile'),
                    bestQuarterMile:    mejorTiempo('$quarter_mile'),
                    avgTopSpeed:        { $avg: '$top_speed' }
                }
            }
        ]);
        res.json(stats[0] || { totalRuns: 0, bestTopSpeed: 0 });
    } catch (error) {
        res.status(500).json({ message: 'Error calculando estadísticas' });
    }
};

// DELETE /api/runs/:id
const deleteRun = async (req, res) => {
    try {
        // Solo puede borrar sus propias carreras
        if (!/^[0-9a-f]{24}$/i.test(req.params.id)) return res.status(404).json({ message: 'Run no encontrado' });
        const deleted = await Run.findOneAndDelete({ _id: req.params.id, user_id: req.user.id });
        if (!deleted) return res.status(404).json({ message: 'Run no encontrado' });
        res.json({ message: 'Run eliminado' });
    } catch (error) {
        res.status(500).json({ message: 'Error eliminando run' });
    }
};

module.exports = { uploadRun, livePoint, getRuns, getRun, getStats, deleteRun };
