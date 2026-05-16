/**
 * ─────────────────────────────────────────────────────────────────
 *  Directiva: <velocimetro>
 *
 *  DEMOSTRACIÓN DEL FRAMEWORK — DIRECTIVAS:
 *  Las directivas en AngularJS crean componentes HTML reutilizables.
 *  <velocimetro velocidad="velocidad" maximo="maxVelocidad">
 *  encapsula el arco SVG y la lógica de color.
 *  Se puede reusar en cualquier vista sin repetir código.
 * ─────────────────────────────────────────────────────────────────
 */

angular.module('telemetriaApp')

.directive('velocimetro', function() {
    return {
        restrict    : 'E',        // Solo como elemento <velocimetro>
        scope       : {
            velocidad: '=',       // Two-way binding con el controlador
            maximo   : '='
        },
        template    : `
            <div class="velocimetro-wrap">
                <svg viewBox="0 0 200 120" class="velocimetro-svg">
                    <!-- Arco de fondo -->
                    <path d="M 20 110 A 90 90 0 0 1 180 110"
                          fill="none" stroke="#1e1e2e" stroke-width="14"
                          stroke-linecap="round"/>
                    <!-- Arco de progreso (calculado por la directiva) -->
                    <path d="M 20 110 A 90 90 0 0 1 180 110"
                          fill="none"
                          stroke="{{ colorArco() }}"
                          stroke-width="14"
                          stroke-linecap="round"
                          stroke-dasharray="283"
                          stroke-dashoffset="{{ offsetArco() }}"
                          style="transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease"/>
                    <!-- Valor numérico -->
                    <text x="100" y="100" text-anchor="middle"
                          font-size="38" font-weight="900"
                          fill="{{ colorArco() }}"
                          font-family="'Courier New', monospace">
                        {{ velocidad | number:1 }}
                    </text>
                    <text x="100" y="116" text-anchor="middle"
                          font-size="10" fill="#64748b"
                          font-family="'Courier New', monospace">
                        km/h
                    </text>
                </svg>
                <!-- Máxima velocidad debajo del arco -->
                <div class="vel-max">MÁX {{ maximo | number:1 }} km/h</div>
            </div>
        `,
        controller  : function($scope) {
            var MAX_VEL    = 180;
            var CIRCUNF    = 283; // Longitud del arco SVG

            // Desplazamiento del arco según velocidad
            $scope.offsetArco = function() {
                var pct = Math.min(($scope.velocidad || 0) / MAX_VEL, 1);
                return CIRCUNF - (CIRCUNF * pct);
            };

            // Color dinámico: verde → naranja → rojo
            $scope.colorArco = function() {
                var v = $scope.velocidad || 0;
                if (v < 60)  return '#22c55e';
                if (v < 100) return '#f97316';
                return '#ef4444';
            };
        }
    };
});
