// ==========================================================================
// log.js — bitácora en archivo
//
// Antes todo iba a console.error, que se pierde al cerrar la terminal.
// Ahora cada línea queda en Inventario/logs/inventario-AAAA-MM-DD.log, un
// archivo por día. Se borran solos los de más de DIAS_A_GUARDAR días para que
// la carpeta no crezca sin control.
//
// Sigue escribiendo también en la consola, así que 'npm start' se ve igual.
// ==========================================================================

const fs = require('fs');
const path = require('path');

const DIAS_A_GUARDAR = 60;
const CARPETA = path.join(__dirname, '..', '..', 'logs');

try {
  fs.mkdirSync(CARPETA, { recursive: true });
} catch (err) {
  console.error('No se pudo crear la carpeta de logs:', err.message);
}

/** Fecha local AAAA-MM-DD (no la de Greenwich: si no, el archivo del día
 *  cambiaba a las 7 de la noche). */
function fechaLocal(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function archivoDeHoy() {
  return path.join(CARPETA, `inventario-${fechaLocal(new Date())}.log`);
}

/** Borra los logs viejos. Se llama al arrancar y una vez al día. */
function limpiarViejos() {
  try {
    const limite = Date.now() - DIAS_A_GUARDAR * 24 * 60 * 60 * 1000;
    for (const nombre of fs.readdirSync(CARPETA)) {
      if (!nombre.startsWith('inventario-') || !nombre.endsWith('.log')) continue;
      const completo = path.join(CARPETA, nombre);
      if (fs.statSync(completo).mtimeMs < limite) fs.unlinkSync(completo);
    }
  } catch (err) {
    console.error('No se pudieron limpiar los logs viejos:', err.message);
  }
}

function escribir(nivel, mensaje, datos) {
  const ahora = new Date();
  const momento = `${fechaLocal(ahora)} ${ahora.toTimeString().slice(0, 8)}`;
  const extra = datos && Object.keys(datos).length ? ' ' + JSON.stringify(datos) : '';
  const linea = `${momento} [${nivel}] ${mensaje}${extra}\n`;

  // La consola sigue funcionando igual que antes
  if (nivel === 'ERROR') console.error(linea.trim());
  else console.log(linea.trim());

  // Y además queda en el archivo. Si el disco falla, la app NO se cae.
  try {
    fs.appendFileSync(archivoDeHoy(), linea);
  } catch (err) {
    console.error('No se pudo escribir en el log:', err.message);
  }
}

module.exports = {
  info: (mensaje, datos) => escribir('INFO', mensaje, datos),
  aviso: (mensaje, datos) => escribir('AVISO', mensaje, datos),
  error: (mensaje, datos) => escribir('ERROR', mensaje, datos),
  limpiarViejos,
  CARPETA,
};
