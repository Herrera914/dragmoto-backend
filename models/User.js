const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
    name:          { type: String, default: '', trim: true },
    // Solo el hash (bcrypt); la contraseña nunca se guarda
    password_hash: { type: String, required: true },

    // Administración: la primera cuenta es admin; las demás esperan aprobación.
    // Las cuentas creadas antes de existir estos campos se tratan como activas.
    rol:      { type: String, enum: ['admin', 'usuario'], default: 'usuario' },
    estado:   { type: String, enum: ['pendiente', 'activo', 'bloqueado'], default: 'pendiente' },
    permisos: {
        web: { type: Boolean, default: true },   // usar la página
        app: { type: Boolean, default: true }    // usar la app (subir carreras, datos en vivo)
    },
    aprobado_en:    { type: Date, default: null },
    nota:           { type: String, default: '', maxlength: 200 },   // nota interna del admin
    ultimo_uso:     { type: Date, default: null },
    ultimo_cliente: { type: String, default: null }                   // 'web' | 'app'
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
