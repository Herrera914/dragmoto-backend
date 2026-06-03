/**
 * ─────────────────────────────────────────────────────────────────
 *  DashboardCtrl
 *  Controlador de la pantalla principal (telemetría en vivo).
 *
 *  DEMOSTRACIÓN DEL FRAMEWORK:
 *  El controlador recibe servicios por inyección de dependencias
 *  (SocketService, RunService) y expone datos en $scope.
 *  La vista accede a esos datos con {{ }} — two-way data binding.
 *  Cuando $scope.velocidad cambia, la pantalla se actualiza sola.
 * ─────────────────────────────────────────────────────────────────
 */

angular.module('telemetriaApp')

.controller('DashboardCtrl', function($scope, $interval, SocketService, RunService) {

    // ── Estado del dashboard ──────────────────────────────────────
    $scope.conectado      = false;
    $scope.enVivo         = false;
    $scope.velocidad      = 0;
    $scope.maxVelocidad   = 0;
    $scope.aceleracion    = 0;
    $scope.maxAceler      = 0;
    $scope.distancia      = 0;
    $scope.trapSpeed      = null;
    $scope.ultimoRun      = null;
    $scope.estadoMensaje  = 'Esperando conexión...';

    // ── Estado del botón PREPARAR ─────────────────────────────────
    $scope.motoConectada  = false;
    $scope.estadoPrepare  = '';   // '' | 'enviando' | 'ok' | 'error'
    $scope.mensajePrepare = '';

    // Tiempos de sprint del run actual
    $scope.sprints = {
        zero30:  null, zero60:  null,
        zero80:  null, zero100: null,
        zero120: null, quarterMile: null
    };

    // Historial de velocidades para la gráfica (últimos 40 puntos)
    $scope.historialVelocidad = [];

    // ── Verificar conexión al servidor ────────────────────────────
    RunService.verificarConexion().then(function(data) {
        $scope.conectado     = !!data;
        $scope.motoConectada = !!(data && data.moto_conectada);
        $scope.estadoMensaje = data
            ? 'Conectado — esperando telemetría'
            : 'Sin conexión con el servidor';
    });

    // ── Estado de conexión de la moto (en tiempo real) ───────────
    SocketService.on('moto_status', function(data) {
        $scope.motoConectada = !!data.conectada;
    });

    // ── Feedback del comando PREPARAR ─────────────────────────────
    SocketService.on('prepare_ok', function() {
        $scope.estadoPrepare  = 'ok';
        $scope.mensajePrepare = '✓ LISTO — la moto está preparada';
        $interval(function() {
            $scope.estadoPrepare  = '';
            $scope.mensajePrepare = '';
        }, 3000, 1);
    });

    SocketService.on('prepare_error', function(data) {
        $scope.estadoPrepare  = 'error';
        $scope.mensajePrepare = (data && data.mensaje) ? data.mensaje : 'Error: moto no conectada';
        $interval(function() {
            $scope.estadoPrepare  = '';
            $scope.mensajePrepare = '';
        }, 3000, 1);
    });

    // ── Acción del botón PREPARAR ─────────────────────────────────
    $scope.triggerPrepare = function() {
        if (!$scope.motoConectada || $scope.estadoPrepare === 'enviando') return;
        $scope.estadoPrepare  = 'enviando';
        $scope.mensajePrepare = 'Enviando...';
        SocketService.emit('web_trigger_prepare');
    };

    // ── Escuchar punto GPS en vivo (Socket.io) ────────────────────
    SocketService.on('live_point', function(data) {
        $scope.enVivo    = true;
        $scope.velocidad = parseFloat(data.speed_kmh)    || 0;
        $scope.aceleracion = parseFloat(data.acceleration) || 0;
        $scope.distancia = parseFloat(data.distance)     || 0;

        // Actualizar máximos
        if ($scope.velocidad   > $scope.maxVelocidad) $scope.maxVelocidad = $scope.velocidad;
        if ($scope.aceleracion > $scope.maxAceler)    $scope.maxAceler    = $scope.aceleracion;

        // Guardar para la gráfica
        $scope.historialVelocidad.push($scope.velocidad);
        if ($scope.historialVelocidad.length > 40) {
            $scope.historialVelocidad.shift();
        }

        $scope.estadoMensaje = '🟢 En vivo — ' + new Date().toLocaleTimeString('es-CO');

        // Actualizar gráfica si existe
        if ($scope.chart) actualizarGrafica();
    });

    // ── Escuchar run completado ───────────────────────────────────
    SocketService.on('run_completed', function(run) {
        $scope.ultimoRun = run;
        $scope.enVivo    = false;

        // Pintar tiempos de sprint en el dashboard
        $scope.sprints = {
            zero30:      run.zero_to_30,
            zero60:      run.zero_to_60,
            zero80:      run.zero_to_80,
            zero100:     run.zero_to_100,
            zero120:     run.zero_to_120,
            quarterMile: run.quarter_mile
        };

        $scope.trapSpeed    = run.trap_speed_quarter;
        $scope.maxVelocidad = run.top_speed;
        $scope.estadoMensaje = '✅ Run completado — ' + run.vehicle_name;

        // Limpiar estado 10 segundos después para el siguiente run
        $interval(function() {
            $scope.velocidad    = 0;
            $scope.aceleracion  = 0;
            $scope.distancia    = 0;
            $scope.maxVelocidad = 0;
            $scope.maxAceler    = 0;
            $scope.trapSpeed    = null;
            $scope.sprints      = { zero30:null, zero60:null, zero80:null, zero100:null, zero120:null, quarterMile:null };
            $scope.historialVelocidad = [];
            $scope.estadoMensaje = 'Esperando próximo run...';
        }, 10000, 1);
    });

    // ── Inicializar gráfica con Chart.js ─────────────────────────
    $scope.initChart = function(canvas) {
        var ctx = canvas.getContext('2d');
        $scope.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels  : [],
                datasets: [{
                    data           : [],
                    borderColor    : '#f97316',
                    backgroundColor: 'rgba(249,115,22,0.08)',
                    borderWidth    : 2,
                    pointRadius    : 0,
                    tension        : 0.4,
                    fill           : true
                }]
            },
            options: {
                responsive : true,
                animation  : false,
                plugins    : { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: {
                        min  : 0,
                        grid : { color: 'rgba(255,255,255,0.04)' },
                        ticks: { color: '#64748b', font: { size: 10 } }
                    }
                }
            }
        });
    };

    function actualizarGrafica() {
        $scope.chart.data.labels   = $scope.historialVelocidad.map((_, i) => i);
        $scope.chart.data.datasets[0].data = $scope.historialVelocidad;
        $scope.chart.update();
    }

    // ── Porcentaje de la barra de aceleración (máx 10 m/s²) ──────
    $scope.barraAceleracion = function() {
        return Math.min(($scope.aceleracion / 10) * 100, 100);
    };
});
