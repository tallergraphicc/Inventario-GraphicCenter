// ==========================================================================
// csv.js — armar archivos CSV que Excel abra bien en español
// ==========================================================================

/**
 * Escapa un valor para CSV: comillas dobles alrededor y las comillas internas
 * duplicadas. Sin esto, una descripción como  Vinil 54" brillante  parte la
 * columna en dos.
 */
function celda(valor) {
  if (valor === null || valor === undefined) return '';
  let texto = valor instanceof Date ? fecha(valor) : String(valor);
  // Excel ejecuta como fórmula cualquier celda que empiece con = + - @ .
  // Un material llamado "=1+1" o una observación pegada de otro lado podían
  // convertirse en una fórmula al abrir el archivo. Con un apóstrofo delante
  // se muestra como texto y no se ejecuta.
  if (typeof valor === 'string' && /^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return `"${texto.replace(/"/g, '""')}"`;
}

/**
 * Fecha como AAAA-MM-DD.
 *
 * MySQL devuelve las fechas como objeto Date, y String(fecha) da
 * "Sat Sep 19 2026 …" — cortarlo a 10 caracteres dejaba "Sat Sep 19" en el
 * archivo. Esto la formatea bien venga como Date o como texto.
 */
function fecha(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  // Las fechas (sin hora) llegan ya como '2026-09-22' desde la base de datos:
  // se devuelven tal cual. Convertirlas a Date las corría un día hacia atrás,
  // porque se interpretan en hora de Greenwich.
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)) return valor.slice(0, 10);
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return String(valor).slice(0, 10);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * Convierte filas en un CSV.
 *
 * Detalles que importan para que Excel en español lo abra bien:
 *  - separador punto y coma, no coma (Excel en es-ES/es-PA espera ';')
 *  - BOM UTF-8 al inicio, si no los acentos salen como símbolos raros
 *
 * columnas = [{ clave: 'codigo', titulo: 'Código' }, ...]
 */
function generar(columnas, filas) {
  const BOM = '﻿';
  const encabezado = columnas.map((c) => celda(c.titulo)).join(';');
  const cuerpo = filas
    .map((f) => columnas.map((c) => celda(c.valor ? c.valor(f) : f[c.clave])).join(';'))
    .join('\r\n');
  return BOM + encabezado + '\r\n' + cuerpo + '\r\n';
}

/**
 * Manda el CSV al navegador como descarga.
 *
 * Por omisión el archivo se llama nombreBase-AAAA-MM-DD.csv con la fecha de
 * hoy. Si se pasa nombreExacto (ej. "movimientos_2026-09"), se usa ese tal
 * cual: sirve para que el archivo diga de qué período es, no el día en que
 * se descargó.
 */
function responder(res, nombreBase, columnas, filas, nombreExacto) {
  // Fecha LOCAL: con toISOString() después de las 7 p. m. en Panamá el
  // archivo salía con la fecha de mañana (es la hora de Greenwich).
  const nombre = `${nombreExacto || `${nombreBase}-${fecha(new Date())}`}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(generar(columnas, filas));
}

module.exports = { generar, responder, celda, fecha };
