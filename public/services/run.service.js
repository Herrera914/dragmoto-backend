/**
 * ─────────────────────────────────────────────────────────────────
 *  RunService
 *  Consume la API REST del backend con $http de AngularJS.
 *
 *  DEMOSTRACIÓN DEL FRAMEWORK — CONSUMO DE API:
 *  $http es el módulo de AngularJS para peticiones HTTP.
 *  Devuelve promesas (.then / .catch) que se encadenan limpiamente.
 *  El controlador nunca hace fetch directo: siempre usa este servicio.
 * ─────────────────────────────────────────────────────────────────
 */

angular.module('telemetriaApp')

.service('RunService', function($http, $q) {

    // URL base de la API — cambia por tu URL de Railway en producción
    var API = '/api';

    // ── GET /api/runs — obtener historial ─────────────────────────
    this.obtenerHistorial = function() {
        return $http.get(API + '/runs')
            .then(function(res) {
                return res.data;  // Array de runs
            })
            .catch(function(err) {
                return $q.reject(manejarError(err));
            });
    };

    // ── GET /api/runs/stats — estadísticas globales ───────────────
    this.obtenerEstadisticas = function() {
        return $http.get(API + '/runs/stats')
            .then(function(res) {
                return res.data;
            })
            .catch(function(err) {
                return $q.reject(manejarError(err));
            });
    };

    // ── DELETE /api/runs/:id — eliminar un run ────────────────────
    this.eliminarRun = function(id) {
        return $http.delete(API + '/runs/' + id)
            .then(function(res) {
                return res.data;
            })
            .catch(function(err) {
                return $q.reject(manejarError(err));
            });
    };

    // ── GET /api/health — verificar que el servidor vive ─────────
    this.verificarConexion = function() {
        return $http.get(API + '/health')
            .then(function(res) { return res.data; })
            .catch(function()   { return null; });
    };

    // ── Manejo centralizado de errores ────────────────────────────
    function manejarError(error) {
        var mensaje = 'Error desconocido';
        if (error.status === 0)   mensaje = 'Sin conexión con el servidor';
        if (error.status === 404) mensaje = 'Recurso no encontrado';
        if (error.status === 500) mensaje = 'Error interno del servidor';
        if (error.data && error.data.message) mensaje = error.data.message;
        console.error('[RunService] Error ' + error.status + ':', mensaje);
        return { codigo: error.status, mensaje: mensaje };
    }
});
