const mongoose = require('mongoose');

// Registro de actividad para el panel de administración (se borra solo a los 90 días)
const ActividadSchema = new mongoose.Schema({
    en:       { type: Date, default: Date.now },
    actor:    { type: String, default: '' },    // correo de quien lo hizo
    accion:   { type: String, required: true }, // registro, sesion, aprobada, bloqueada, permisos, rol, eliminada…
    objetivo: { type: String, default: '' },    // correo de la cuenta afectada
    detalle:  { type: String, default: '' }
});
ActividadSchema.index({ en: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model('Actividad', ActividadSchema);
