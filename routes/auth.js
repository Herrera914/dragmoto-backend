const express = require('express');
const router  = express.Router();
const { register, login, me } = require('../controllers/authController');
const { requireSesion } = require('../middleware/auth');

router.post('/register', register);
router.post('/login',    login);
router.get('/me',        requireSesion, me);   // también con cuenta pendiente o bloqueada, para mostrar el aviso

module.exports = router;
