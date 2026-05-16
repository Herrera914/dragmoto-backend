const express = require('express');
const router  = express.Router();
const {
    uploadRun,
    livePoint,
    getRuns,
    getStats,
    deleteRun
} = require('../controllers/runController');

router.get('/stats',  getStats);    // Estadísticas globales
router.post('/live',  livePoint);   // Punto GPS en tiempo real
router.post('/',      uploadRun);   // Run completo al finalizar
router.get('/',       getRuns);     // Historial
router.delete('/:id', deleteRun);   // Eliminar run

module.exports = router;
