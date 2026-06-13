# Product

## Register

product

## Users

El piloto y su equipo durante sesiones de drag racing: miran el dashboard en un portátil o tablet junto a la pista (a menudo bajo luz solar fuerte o de noche), mientras la moto transmite telemetría GPS a 1 Hz desde la app Android DragMoto. Después de la sesión revisan el historial de runs para comparar configuraciones.

## Product Purpose

Visualizar en tiempo real la telemetría de un run de drag (velocidad, aceleración, distancia, tiempos de sprint y de distancia) recibida por socket.io, y conservar un historial consultable de runs con sus métricas. El éxito es que el equipo pueda leer el estado del run de un vistazo a distancia y confiar en los números.

## Brand Personality

Técnico, competitivo, nocturno. Estética de instrumentación de carreras: fondo oscuro, acentos neón (rojo/azul/verde), tipografía Orbitron para datos y Rajdhani para texto. La identidad visual ya está comprometida en el código (paleta `dm.*` en Tailwind).

## Anti-references

- Dashboards SaaS claros y genéricos (cards blancas, gris corporativo).
- Skeuomorfismo de tablero de coche antiguo (cromados, agujas fotorrealistas).
- Sobrecarga de animación decorativa que distraiga durante un run real.

## Design Principles

1. **Legible a distancia**: los números clave se leen desde lejos; jerarquía por tamaño y color, no por densidad.
2. **El movimiento comunica estado**: animar solo lo que cambia de estado (dato nuevo, hito cruzado, run completado); nada decorativo.
3. **Continuidad entre fixes**: la telemetría llega a 1 Hz; la UI interpola para que el dato se sienta vivo sin inventar precisión.
4. **Consistencia con la app Android**: misma semántica de colores y tiempos anclados al lanzamiento.

## Accessibility & Inclusion

- Respetar `prefers-reduced-motion` en toda animación (alternativa: cambio instantáneo).
- Contraste: valores y etiquetas clave ≥ 4.5:1 sobre los fondos `dm.s1/s2`.
- Estados vacíos y de espera explícitos ("Esperando conexión", "Sin runs").
