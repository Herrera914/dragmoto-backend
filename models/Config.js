const mongoose = require('mongoose');

// Ajustes generales del servidor que cambia el admin (p. ej. la última versión de la app)
const ConfigSchema = new mongoose.Schema({
    clave: { type: String, required: true, unique: true },
    valor: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Config', ConfigSchema);
