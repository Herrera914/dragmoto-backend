const express = require('express');
const router  = express.Router();
const { resumen, usuarios, actualizar, eliminar, actividad, restablecerClave } = require('../controllers/adminController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Panel de administración: solo cuentas con rol admin
router.use(requireAuth, requireAdmin);

router.get('/resumen',          resumen);
router.get('/usuarios',         usuarios);
router.patch('/usuarios/:id',   actualizar);
router.delete('/usuarios/:id',  eliminar);
router.post('/usuarios/:id/clave', restablecerClave);
router.get('/actividad',        actividad);

module.exports = router;
