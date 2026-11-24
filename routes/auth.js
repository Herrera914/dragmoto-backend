const express = require('express');
const router  = express.Router();
const { register, login, me, cambiarClave, actualizarPerfil, subirFoto, quitarFoto } = require('../controllers/authController');
const { requireSesion } = require('../middleware/auth');

router.post('/register', register);
router.post('/login',    login);
router.get('/me',        requireSesion, me);
router.post('/clave',    requireSesion, cambiarClave);   // cambiar la propia contraseña
router.patch('/perfil',  requireSesion, actualizarPerfil); // cambiar el propio nombre
router.put('/foto',      requireSesion, subirFoto);        // foto de perfil
router.delete('/foto',   requireSesion, quitarFoto);   // también con cuenta pendiente o bloqueada, para mostrar el aviso

module.exports = router;
