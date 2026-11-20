const express = require('express');
const router  = express.Router();
const {
    uploadRun,
    livePoint,
    getRuns,
    getRun,
    getStats,
    deleteRun
} = require('../controllers/runController');
const { requireAuth } = require('../middleware/auth');

// Todas las rutas de carreras exigen sesión: cada usuario ve solo lo suyo
router.use(requireAuth);

router.get('/stats',  getStats);    // Estadísticas del usuario
router.post('/live',  livePoint);   // Punto GPS en tiempo real
router.post('/',      uploadRun);   // Run completo al finalizar
router.get('/',       getRuns);     // Historial
router.get('/:id',    getRun);      // Una carrera con su trazado
router.delete('/:id', deleteRun);   // Eliminar run

module.exports = router;
