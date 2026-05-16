/**
 * ─────────────────────────────────────────────────────────────────
 *  DRAGMOTO TELEMETRÍA — app.js
 *  Módulo principal de AngularJS
 * ─────────────────────────────────────────────────────────────────
 *
 *  DEMOSTRACIÓN DEL FRAMEWORK:
 *  Este archivo define el módulo raíz de la aplicación.
 *  En AngularJS, todo parte del módulo: controladores, servicios
 *  y directivas se registran aquí.
 * ─────────────────────────────────────────────────────────────────
 */

angular.module('telemetriaApp', ['ngRoute'])

// ── Configuración de rutas ────────────────────────────────────────
.config(function($routeProvider) {
    $routeProvider

        // Ruta principal: dashboard en vivo
        .when('/', {
            templateUrl : 'views/dashboard.html',
            controller  : 'DashboardCtrl'
        })

        // Ruta historial: todos los runs guardados
        .when('/historial', {
            templateUrl : 'views/historial.html',
            controller  : 'HistorialCtrl'
        })

        // Ruta por defecto
        .otherwise({ redirectTo: '/' });
})

// ── Filtro: formatea segundos con 2 decimales o muestra "—" ──────
.filter('sprint', function() {
    return function(value) {
        if (value === null || value === undefined) return '—';
        return parseFloat(value).toFixed(2) + 's';
    };
})

// ── Filtro: formatea km/h ─────────────────────────────────────────
.filter('kmh', function() {
    return function(value) {
        if (value === null || value === undefined) return '—';
        return parseFloat(value).toFixed(1) + ' km/h';
    };
})

// ── Filtro: metros a km con 2 decimales ──────────────────────────
.filter('distancia', function() {
    return function(value) {
        if (value === null || value === undefined) return '—';
        return (value / 1000).toFixed(2) + ' km';
    };
});
