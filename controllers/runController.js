const Run = require('../models/Run');

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

        const run = new Run({ ...data, synced_at: new Date() });
        const saved = await run.save();

        console.log(`✅ Run guardado: ${saved._id} | ${data.vehicle_name} | top: ${data.top_speed} km/h`);

        // Emitir evento a todos los clientes del dashboard
        const io = req.app.get('io');
        if (io) {
            io.emit('run_completed', {
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
                quarter_mile:      data.quarter_mile,
                trap_speed_quarter:data.trap_speed_quarter,
                launch_quality:    data.launch_quality,
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
        const { speed_kmh, acceleration, distance, timestamp, session_id } = req.body;

        // Reemite el punto a todos los clientes del dashboard al instante
        const io = req.app.get('io');
        if (io) {
            io.emit('live_point', {
                speed_kmh:   speed_kmh   || 0,
                acceleration:acceleration || 0,
                distance:    distance    || 0,
                timestamp:   timestamp   || Date.now(),
                session_id:  session_id  || 'unknown'
            });
        }

        // No se guarda en BD (son datos transitorios de telemetría en vivo)
        res.status(200).json({ received: true });

    } catch (error) {
        res.status(500).json({ message: 'Error procesando punto en vivo' });
    }
};

// GET /api/runs — historial
const getRuns = async (req, res) => {
    try {
        const filter = {};
        if (req.query.user_id) filter.user_id = req.query.user_id;

        const runs = await Run.find(filter)
            .sort({ created_at: -1 })
            .limit(50)
            .select('-__v');

        res.json(runs);
    } catch (error) {
        res.status(500).json({ message: 'Error consultando runs' });
    }
};

// GET /api/runs/stats — estadísticas globales
const getStats = async (req, res) => {
    try {
        const stats = await Run.aggregate([
            { $match: { valid_run: true } },
            {
                $group: {
                    _id:                null,
                    totalRuns:          { $sum: 1 },
                    bestTopSpeed:       { $max: '$top_speed' },
                    bestZeroTo100:      { $min: '$zero_to_100' },
                    bestHundredMeters:  { $min: '$hundred_meters' },
                    bestEighthMile:     { $min: '$eighth_mile' },
                    bestQuarterMile:    { $min: '$quarter_mile' },
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
        const deleted = await Run.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: 'Run no encontrado' });
        res.json({ message: 'Run eliminado' });
    } catch (error) {
        res.status(500).json({ message: 'Error eliminando run' });
    }
};

module.exports = { uploadRun, livePoint, getRuns, getStats, deleteRun };
