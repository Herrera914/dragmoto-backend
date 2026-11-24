const mongoose = require('mongoose');
const User     = require('../models/User');
const cuentas  = require('../lib/cuentas');

// Foto de perfil. La sube la propia cuenta; la ven esa cuenta y los administradores.
const MAX_BYTES = 200 * 1024;
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const dbLista = () => mongoose.connection.readyState === 1;
const esId = (id) => /^[0-9a-f]{24}$/i.test(String(id));

/** URL versionada de la foto de una cuenta (null si no tiene). */
const urlFoto = (u) => (u && u.foto_v ? `/api/usuarios/${u._id.toString()}/foto?v=${u.foto_v}` : null);

/** Comprueba que los bytes sean de verdad del tipo declarado (no solo la etiqueta). */
function firmaValida(buf, tipo) {
    if (tipo === 'image/jpeg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (tipo === 'image/png') return buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (tipo === 'image/webp') return buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
    return false;
}

// PUT /api/auth/foto  { imagen: "data:image/jpeg;base64,..." }
const subir = async (req, res, publico) => {
    if (!dbLista()) return res.status(503).json({ message: 'La base de datos no está disponible' });
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(req.body?.imagen || ''));
    if (!m || !TIPOS.includes(m[1])) return res.status(400).json({ message: 'La foto debe ser una imagen JPG, PNG o WebP' });
    const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    if (buf.length === 0) return res.status(400).json({ message: 'La foto está vacía' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ message: 'La foto es muy pesada (máximo 200 KB)' });
    if (!firmaValida(buf, m[1])) return res.status(400).json({ message: 'El archivo no es una imagen válida' });
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(401).json({ message: 'La cuenta ya no existe' });
        user.foto = buf;
        user.foto_tipo = m[1];
        user.foto_v = Date.now();
        await user.save();
        res.json(publico(user));
    } catch (e) {
        console.error('❌ Subiendo foto:', e.message);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// DELETE /api/auth/foto
const quitar = async (req, res, publico) => {
    if (!dbLista()) return res.status(503).json({ message: 'La base de datos no está disponible' });
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(401).json({ message: 'La cuenta ya no existe' });
        user.foto = null;
        user.foto_tipo = null;
        user.foto_v = null;
        await user.save();
        res.json(publico(user));
    } catch (e) {
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// GET /api/usuarios/:id/foto — solo la propia cuenta o un administrador
const ver = async (req, res) => {
    if (!dbLista()) return res.status(503).json({ message: 'La base de datos no está disponible' });
    const id = req.params.id;
    if (!esId(id)) return res.status(404).json({ message: 'Sin foto' });
    try {
        if (id !== req.user.id) {
            const yo = await cuentas.estadoDe(req.user.id);
            if (!yo || yo.rol !== 'admin') return res.status(403).json({ message: 'No puedes ver esta foto' });
        }
        const u = await User.findById(id).select('+foto foto_tipo foto_v').lean();
        if (!u || !u.foto || !u.foto_tipo) return res.status(404).json({ message: 'Sin foto' });
        const buf = Buffer.isBuffer(u.foto) ? u.foto : Buffer.from(u.foto.buffer || u.foto);
        res.set('Content-Type', u.foto_tipo);
        res.set('Cache-Control', 'private, max-age=31536000, immutable');   // la URL lleva ?v=versión
        res.set('X-Content-Type-Options', 'nosniff');
        res.send(buf);
    } catch (e) {
        console.error('❌ Leyendo foto:', e.message);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = { subir, quitar, ver, urlFoto };
