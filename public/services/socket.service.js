/**
 * ─────────────────────────────────────────────────────────────────
 *  SocketService
 *  Encapsula Socket.io dentro de un servicio Angular.
 *
 *  DEMOSTRACIÓN DEL FRAMEWORK:
 *  Los servicios en AngularJS son singletons: se crean una vez
 *  y se inyectan en cualquier controlador que los necesite.
 *  Esto separa la lógica de comunicación de la vista.
 * ─────────────────────────────────────────────────────────────────
 */

angular.module('telemetriaApp')

.service('SocketService', function($rootScope) {
    var socket = io(); // Conecta al servidor que sirve esta página

    /**
     * Escucha un evento del servidor y notifica a Angular.
     * $rootScope.$apply() es necesario porque Socket.io opera
     * fuera del ciclo de digest de Angular.
     */
    this.on = function(evento, callback) {
        socket.on(evento, function(data) {
            $rootScope.$apply(function() {
                callback(data);
            });
        });
    };

    /** Envía un evento al servidor */
    this.emit = function(evento, data) {
        socket.emit(evento, data);
    };

    /** Estado de la conexión */
    this.conectado = function() {
        return socket.connected;
    };

    /** ID del socket actual */
    this.id = function() {
        return socket.id;
    };

    return this;
});
