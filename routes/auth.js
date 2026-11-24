const express = require('express');
const router  = express.Router();
const { register, login, me, cambiarClave, actualizarPerfil } = require('../controllers/authController');
const { requireSesion } = require('../middleware/auth');

router.post('/register', register);
router.post('/login',    login);
router.get('/me',        requireSesion, me);
router.post('/clave',    requireSesion, cambiarClave);   // cambiar la propia contraseña
router.patch('/perfil',  requireSesion, actualizarPerfil); // cambiar el propio nombre   // también con cuenta pendiente o bloqueada, para mostrar el aviso

module.exports = router;
