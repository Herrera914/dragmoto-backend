/**
 * ─────────────────────────────────────────────────────────────────
 *  HistorialCtrl
 *  Controlador de la pantalla de historial de runs.
 *
 *  DEMOSTRACIÓN DEL FRAMEWORK — CONSUMO DE API:
 *  Usa RunService.$http para GET /api/runs y GET /api/runs/stats.
 *  ng-repeat renderiza la tabla automáticamente cuando llegan datos.
 * ─────────────────────────────────────────────────────────────────
 */

angular.module('telemetriaApp')

.controller('HistorialCtrl', function($scope, RunService) {

    $scope.runs       = [];
    $scope.stats      = null;
    $scope.cargando   = true;
    $scope.error      = null;
    $scope.busqueda   = '';   // filtro de búsqueda por vehículo
    $scope.ordenarPor = 'created_at';
    $scope.orden      = true; // true = descendente

    // ── Cargar datos al iniciar el controlador ────────────────────
    cargarDatos();

    function cargarDatos() {
        $scope.cargando = true;
        $scope.error    = null;

        // Petición 1: historial de runs — GET /api/runs
        RunService.obtenerHistorial()
            .then(function(runs) {
                $scope.runs = runs;
            })
            .catch(function(err) {
                $scope.error = err.mensaje;
            })
            .finally(function() {
                $scope.cargando = false;
            });

        // Petición 2: estadísticas globales — GET /api/runs/stats
        RunService.obtenerEstadisticas()
            .then(function(stats) {
                $scope.stats = stats;
            });
    }

    // ── Eliminar run — DELETE /api/runs/:id ───────────────────────
    $scope.eliminar = function(run) {
        if (!confirm('¿Eliminar este run de ' + run.vehicle_name + '?')) return;

        RunService.eliminarRun(run._id)
            .then(function() {
                // Quita el run del array local sin recargar
                var idx = $scope.runs.indexOf(run);
                if (idx > -1) $scope.runs.splice(idx, 1);
            })
            .catch(function(err) {
                alert('Error al eliminar: ' + err.mensaje);
            });
    };

    // ── Recargar lista ────────────────────────────────────────────
    $scope.recargar = function() {
        cargarDatos();
    };

    // ── Cambiar columna de ordenamiento ──────────────────────────
    $scope.ordenarColumna = function(columna) {
        if ($scope.ordenarPor === columna) {
            $scope.orden = !$scope.orden;
        } else {
            $scope.ordenarPor = columna;
            $scope.orden = true;
        }
    };

    // ── Badge de calidad de salida ────────────────────────────────
    $scope.badgeClase = function(quality) {
        var mapa = {
            'EXCELENTE': 'badge-excelente',
            'BUENA'    : 'badge-buena',
            'REGULAR'  : 'badge-regular',
            'POBRE'    : 'badge-pobre'
        };
        return mapa[quality] || 'badge-muted';
    };
});
