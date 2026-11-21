// npm test: corre cada prueba con un MongoDB en memoria (nunca toca la base real).
// La primera vez descarga el binario de MongoDB (~100 MB) a la caché del usuario.
const { spawnSync } = require('child_process');
const path = require('path');

const pruebas = ['cuentas.test.js', 'admin.test.js', 'clave.test.js', 'version.test.js'];
let fallidas = 0;
for (const p of pruebas) {
    console.log(`\n▶ ${p}`);
    const r = spawnSync(process.execPath, [path.join(__dirname, p)], { stdio: 'inherit' });
    if (r.status !== 0) fallidas++;
}
console.log(fallidas ? `\n✖ ${fallidas} de ${pruebas.length} archivos con fallos` : `\n✔ ${pruebas.length} archivos de prueba OK`);
process.exit(fallidas ? 1 : 0);
