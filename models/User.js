const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
    name:          { type: String, default: '', trim: true },
    // Solo el hash (bcrypt); la contraseña nunca se guarda
    password_hash: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
