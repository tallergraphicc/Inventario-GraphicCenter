// ==========================================================================
// laminas.service.js — láminas de 4x8 pies (acrílico, MDF, coroplast, caucho,
// foam board, PVC espumoso / Sintra)
//
// Cómo se cuenta:
//   - Cada lámina que hay en bodega es un registro, igual que los rollos.
//   - La existencia del material se lleva en LÁMINAS EQUIVALENTES:
//     1 = una lámina completa de 48x96 pulgadas = 32 pies².
//   - En la salida se ponen las piezas que se cortaron (ancho x alto en
//     pulgadas) y el sistema descuenta ese pedazo de la lámina.
//   - Lo que le queda a cada lámina NUNCA se guarda: se calcula
//     (tamaño con el que se registró − cortes y mermas hechos en ella).
//   - Cuando a una lámina ya solo le quedan pedazos de menos de 12x12
//     pulgadas, se "termina": lo que queda pasa a RETAZOS. Sigue contando en
//     la existencia, pero aparte, porque ya no sirve para un trabajo normal
//     (sí para embalaje o piezas chicas).
// ==========================================================================

const pool = require('../config/db');
const { HttpError } = require('../middleware/errorHandler');
const inv = require('./inventario.service');

const LAMINA_ANCHO = 48;                            // pulgadas
const LAMINA_ALTO = 96;                             // pulgadas
const PULG2_POR_LAMINA = LAMINA_ANCHO * LAMINA_ALTO; // 4608
const PIE2_POR_LAMINA = PULG2_POR_LAMINA / 144;      // 32
const RETAZO_MINIMO = 12;                           // menos de 12x12 pulg. es retazo
const CASI_CERO = 0.0001;

const round4 = inv.round4;

function esMaterialDeLamina(material) {
  return !!material && material.unidad_codigo === 'LAMINA';
}

/** Láminas equivalentes → pies² (para mostrar). */
function aPies2(laminas) {
  return Math.round(Number(laminas) * PIE2_POR_LAMINA * 100) / 100;
}

/** Pies² → láminas equivalentes. */
function dePies2(pies2) {
  return round4(Number(pies2) / PIE2_POR_LAMINA);
}

/** Texto corto de una cantidad: "3 pie² (0.0938 lám.)" */
function textoCantidad(laminas) {
  return `${aPies2(laminas)} pie² (${round4(laminas)} lám.)`;
}

/**
 * Estado de una lámina, calculado — no se guarda, así nunca queda desfasado:
 *   COMPLETA  → nadie la ha tocado
 *   ABIERTA   → ya se cortó de ella y todavía sirve
 *   RETAZOS   → la terminaron: solo quedan pedazos chicos
 *   AGOTADA   → no queda nada
 */
function estadoDeLamina(l) {
  if (l.restante <= CASI_CERO) return 'AGOTADA';
  if (l.terminada) return 'RETAZOS';
  if (Number(l.tamano) >= 1 - CASI_CERO && l.restante >= Number(l.tamano) - CASI_CERO) return 'COMPLETA';
  return 'ABIERTA';
}

/**
 * Láminas activas de un material con lo que le queda a cada una.
 * Una sola consulta suma los cortes de todas (no una por lámina).
 */
/**
 * Tolerancia de redondeo de una lámina.
 *
 * Cada corte se guarda con 4 decimales de lámina: un corte de 12x12 es
 * 0.03125 y se guarda 0.0313. Después de muchos cortes iguales, lo que queda
 * según el sistema difiere unas diezmilésimas de lo real, y el último corte
 * "no cabía" por 0.0016 (menos de 8 pulg²). Con esta tolerancia, si un corte
 * se pasa o se queda corto de lo que queda solo por ese arrastre, se toma
 * exactamente lo que queda. Crece con los cortes hechos (medio paso de
 * redondeo por corte) y nunca pasa de 0.0025 de lámina (≈ 11 pulg²).
 */
function toleranciaDe(cortes) {
  return Math.min(0.00005 * (cortes + 1), 0.0025) + 1e-9;
}

/**
 * Láminas activas de un material con lo que le queda a cada una.
 * Una sola consulta suma los cortes de todas (no una por lámina).
 *
 * No bloquea filas: quien escribe ya tiene bloqueado el MATERIAL (siempre se
 * bloquea primero el material), y eso basta para que dos cortes del mismo
 * material no se pisen. Bloquear aquí con un JOIN bloqueaba también la
 * bodega, y ponía en fila a todo el sistema.
 */
async function laminasConRestante(conn, materialId) {
  const [laminas] = await conn.query(
    `SELECT l.*, b.nombre AS bodega_nombre
     FROM laminas l LEFT JOIN bodegas b ON b.id = l.bodega_id
     WHERE l.material_id = ? AND l.activo = TRUE
     ORDER BY l.created_at, l.id`,
    [materialId]
  );
  if (!laminas.length) return [];

  const [consumos] = await conn.query(
    `SELECT mv.lamina_id, SUM(mv.cantidad) AS usado, COUNT(*) AS cortes
     FROM movimientos mv
     JOIN laminas l ON l.id = mv.lamina_id
     WHERE l.material_id = ? AND mv.anulado = FALSE AND mv.anula_movimiento_id IS NULL
       AND (mv.tipo = 'SALIDA' OR (mv.tipo = 'MERMA' AND mv.descuenta = TRUE))
     GROUP BY mv.lamina_id`,
    [materialId]
  );
  const usado = {};
  const cortes = {};
  consumos.forEach((c) => { usado[c.lamina_id] = Number(c.usado); cortes[c.lamina_id] = Number(c.cortes); });

  return laminas.map((l) => {
    const restante = round4(Number(l.tamano) - (usado[l.id] || 0));
    const conRestante = { ...l, tamano: Number(l.tamano), restante };
    return {
      ...conRestante,
      estado: estadoDeLamina(conRestante),
      restante_pies2: aPies2(restante),
      tolerancia: toleranciaDe(cortes[l.id] || 0),
    };
  });
}

/** ¿Cabe este corte en la lámina? (con la tolerancia de redondeo) */
function cabe(lamina, necesita) {
  return necesita <= lamina.restante + lamina.tolerancia;
}

/**
 * Cuánto se descuenta de verdad: lo pedido, salvo que la diferencia con lo
 * que queda sea solo arrastre de redondeo — entonces se toma todo lo que queda
 * y la lámina cierra en cero exacto, sin sobrantes fantasma.
 */
function cantidadATomar(lamina, necesita) {
  if (Math.abs(lamina.restante - necesita) <= lamina.tolerancia) return lamina.restante;
  return round4(Math.min(necesita, lamina.restante));
}

/** Totales de un material: cuántas completas, cuánto abierto, cuánto en retazos. */
function resumir(laminas) {
  const r = { completas: 0, abiertas: 0, enAbiertas: 0, retazos: 0, enRetazos: 0, disponible: 0, total: 0 };
  laminas.forEach((l) => {
    if (l.estado === 'COMPLETA') { r.completas++; r.disponible += l.restante; }
    else if (l.estado === 'ABIERTA') { r.abiertas++; r.enAbiertas += l.restante; r.disponible += l.restante; }
    else if (l.estado === 'RETAZOS') { r.retazos++; r.enRetazos += l.restante; }
    if (l.restante > 0) r.total += l.restante;
  });
  ['enAbiertas', 'enRetazos', 'disponible', 'total'].forEach((k) => { r[k] = round4(r[k]); });
  r.enAbiertasPies2 = aPies2(r.enAbiertas);
  r.enRetazosPies2 = aPies2(r.enRetazos);
  r.disponiblePies2 = aPies2(r.disponible);
  r.totalPies2 = aPies2(r.total);
  return r;
}

/**
 * Existencia que el sistema cuenta pero que no está en ninguna lámina
 * registrada. Pasa con lo que ya estaba contado antes de que existieran las
 * láminas (ej. "Foam 3 mm: 8"). Positivo = faltan láminas por registrar;
 * negativo = las láminas suman más que la existencia.
 */
async function stockSinLamina(conn, materialId) {
  const existencia = await inv.calcularExistencia(conn, materialId);
  const laminas = await laminasConRestante(conn, materialId);
  const enLaminas = laminas.reduce((t, l) => t + Math.max(l.restante, 0), 0);
  return round4(existencia - enLaminas);
}

/** Siguiente ID libre: CODIGO-L01, CODIGO-L02... (mira también las eliminadas). */
async function siguientesIds(conn, material, cuantos) {
  const [rows] = await conn.query('SELECT id FROM laminas WHERE material_id = ?', [material.id]);
  let mayor = 0;
  rows.forEach((r) => {
    const m = String(r.id).match(/-L(\d+)$/i);
    if (m) mayor = Math.max(mayor, Number(m[1]));
  });
  const ids = [];
  let n = mayor + 1;
  while (ids.length < cuantos && n < mayor + 5000) {
    const candidato = `${material.codigo}-L${String(n).padStart(2, '0')}`;
    const [[existe]] = await conn.query('SELECT id FROM laminas WHERE id = ?', [candidato]);
    if (!existe) ids.push(candidato);
    n++;
  }
  if (ids.length < cuantos) throw new HttpError(500, 'No se pudieron generar IDs de lámina libres.');
  return ids;
}

/**
 * Crea láminas: N completas de 48x96 y, si viene, un pedazo.
 * pedazo = { ancho, alto } en pulgadas, o { tamano } en láminas equivalentes.
 */
async function crearLaminas(conn, material, { completas = 0, pedazo = null, origen, movimientoOrigenId, bodegaId, ubicacion }) {
  const total = completas + (pedazo ? 1 : 0);
  if (!total) return [];
  const ids = await siguientesIds(conn, material, total);
  const creadas = [];
  for (let i = 0; i < completas; i++) {
    await conn.query(
      `INSERT INTO laminas (id, material_id, tamano, ancho, alto, bodega_id, ubicacion, origen, movimiento_origen_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [ids[i], material.id, 1, LAMINA_ANCHO, LAMINA_ALTO, bodegaId || material.bodega_id || null,
        ubicacion || null, origen, movimientoOrigenId || null]
    );
    creadas.push({ id: ids[i], tamano: 1 });
  }
  if (pedazo) {
    const id = ids[completas];
    const tamano = pedazo.tamano != null
      ? round4(pedazo.tamano)
      : round4((Number(pedazo.ancho) * Number(pedazo.alto)) / PULG2_POR_LAMINA);
    if (!(tamano > 0)) throw new HttpError(400, 'El pedazo no tiene medida.');
    await conn.query(
      `INSERT INTO laminas (id, material_id, tamano, ancho, alto, bodega_id, ubicacion, origen, movimiento_origen_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, material.id, tamano, pedazo.ancho || null, pedazo.alto || null,
        bodegaId || material.bodega_id || null, ubicacion || null, origen, movimientoOrigenId || null]
    );
    creadas.push({ id, tamano });
  }
  return creadas;
}

/**
 * Valida las piezas cortadas y las convierte en área.
 * piezas = [{ cantidad: 2, ancho: 12, alto: 18 }, ...] en pulgadas.
 * Una pieza no puede ser más grande que una lámina de 48x96 (en cualquier sentido).
 */
function leerPiezas(piezas) {
  if (!Array.isArray(piezas) || !piezas.length) {
    throw new HttpError(400, 'Pon al menos una pieza: cuántas, y su ancho y alto en pulgadas.');
  }
  let pulg2 = 0;
  const partes = [];
  const limpias = [];
  for (const p of piezas) {
    const cantidad = Number(p.cantidad || 1);
    const ancho = Number(p.ancho);
    const alto = Number(p.alto);
    if (!(cantidad > 0) || !Number.isInteger(cantidad)) throw new HttpError(400, 'La cantidad de piezas tiene que ser un número entero.');
    if (!(ancho > 0) || !(alto > 0)) throw new HttpError(400, 'Cada pieza necesita ancho y alto (en pulgadas) mayores que cero.');
    const corto = Math.min(ancho, alto);
    const largo = Math.max(ancho, alto);
    if (corto > LAMINA_ANCHO || largo > LAMINA_ALTO) {
      throw new HttpError(400, `Una pieza de ${ancho}×${alto} pulg. no cabe en una lámina de 48×96 pulg. (4×8 pies).`);
    }
    pulg2 += cantidad * ancho * alto;
    partes.push(`${cantidad} × ${ancho}×${alto}`);
    limpias.push({ cantidad, ancho, alto });
  }
  const laminas = round4(pulg2 / PULG2_POR_LAMINA);
  if (!(laminas > 0)) throw new HttpError(400, 'El corte es demasiado pequeño para descontarlo (menos de medio pulgada cuadrada).');
  const pies2 = Math.round((pulg2 / 144) * 100) / 100;
  let texto = `${partes.join(' + ')} pulg.`;
  // La columna guarda 200 letras: con muchas medidas distintas se resume
  if (texto.length > 160) {
    const totalPiezas = limpias.reduce((t, p) => t + p.cantidad, 0);
    texto = `${totalPiezas} piezas de ${limpias.length} medidas distintas (${pies2} pie²)`;
  }
  return {
    piezas: limpias,
    laminas,
    pies2,
    texto,
    todasChicas: limpias.every((p) => p.ancho < RETAZO_MINIMO || p.alto < RETAZO_MINIMO),
  };
}

/**
 * De qué lámina(s) sale un corte.
 *
 * Automático: primero la lámina ABIERTA más chica donde quepa (para ir
 * terminando lo que ya está cortado y no abrir láminas nuevas por gusto); si
 * ninguna abierta alcanza, una COMPLETA, la más vieja. Solo si ninguna lámina
 * sola alcanza (muchas piezas), se reparte entre varias.
 */
function repartir(candidatas, necesita) {
  const conMaterial = candidatas.filter((l) => l.restante > CASI_CERO);
  const abiertas = conMaterial.filter((l) => l.estado === 'ABIERTA' || l.estado === 'RETAZOS')
    .sort((a, b) => a.restante - b.restante);
  const completas = conMaterial.filter((l) => l.estado === 'COMPLETA');
  const orden = [...abiertas, ...completas];

  const unaSola = orden.find((l) => cabe(l, necesita));
  if (unaSola) return [{ lamina: unaSola, cantidad: cantidadATomar(unaSola, necesita) }];
  return repartirEnOrden(orden, necesita);
}

/** Reparte una cantidad entre varias láminas, en el orden dado. null si no alcanza. */
function repartirEnOrden(orden, necesita) {
  const reparto = [];
  let pendiente = necesita;
  for (const l of orden) {
    if (pendiente <= CASI_CERO) break;
    const tomar = cabe(l, pendiente) ? cantidadATomar(l, pendiente) : l.restante;
    reparto.push({ lamina: l, cantidad: tomar });
    pendiente = round4(pendiente - tomar);
  }
  // Lo que falte por redondeo no cuenta como "no alcanza"
  if (!reparto.length) return null;
  const tolerancia = reparto[reparto.length - 1].lamina.tolerancia;
  return pendiente > Math.max(tolerancia, CASI_CERO) ? null : reparto;
}

/**
 * Registra una SALIDA o MERMA de un material por láminas.
 *
 * datos    → lo común del movimiento (tipo, fecha, OT, quién, motivo...)
 * opciones → cómo sale:
 *   { modo: 'piezas', piezas: [...], fuente: 'auto' | 'retazos' | 'lamina', laminaId, terminarDespues }
 *   { modo: 'completas', completas: 2 }          → salen láminas enteras
 *   { modo: 'resto', laminaId }                  → sale todo lo que le queda a esa lámina
 *
 * Todo en una transacción: o se registran todos los movimientos, o ninguno.
 */
async function registrarConsumo(datos, opciones, usuarioId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Se bloquea solo la fila del material (sin JOIN: un JOIN con FOR UPDATE
    // bloquearía también la unidad "Lámina", que comparten todos)
    const [[bloqueo]] = await conn.query('SELECT id FROM materiales WHERE id = ? FOR UPDATE', [datos.materialId]);
    if (!bloqueo) throw new HttpError(404, 'Material no encontrado.');
    const [[material]] = await conn.query(
      `SELECT m.*, u.codigo AS unidad_codigo FROM materiales m
       JOIN unidades_medida u ON u.id = m.unidad_id WHERE m.id = ?`,
      [datos.materialId]
    );

    const laminas = await laminasConRestante(conn, material.id);
    const vivas = laminas.filter((l) => l.restante > CASI_CERO);
    const res = resumir(laminas);
    const esMerma = datos.tipo === 'MERMA';
    const modo = opciones.modo || 'piezas';

    if (!laminas.length) {
      throw new HttpError(
        409,
        'Este material no tiene láminas registradas. Ve a la pestaña Láminas y regístralas ' +
        '(si ya estaban contadas, con el botón "Crear las láminas").'
      );
    }

    let reparto;
    let medidas;

    if (modo === 'completas') {
      const n = Number(opciones.completas);
      if (!(n >= 1) || !Number.isInteger(n)) throw new HttpError(400, 'Di cuántas láminas completas salen (un número entero).');
      const completas = vivas.filter((l) => l.estado === 'COMPLETA');
      if (completas.length < n) {
        throw new HttpError(409, `Solo hay ${completas.length} lámina(s) completa(s) de este material.`);
      }
      reparto = completas.slice(0, n).map((l) => ({ lamina: l, cantidad: l.restante }));
      medidas = n === 1 ? 'Lámina completa 48×96 pulg.' : `${n} láminas completas 48×96 pulg.`;
    } else if (modo === 'resto') {
      const l = vivas.find((x) => x.id === opciones.laminaId);
      if (!l) throw new HttpError(409, 'Esa lámina no existe o ya no le queda material.');
      reparto = [{ lamina: l, cantidad: l.restante }];
      medidas = `Todo lo que le quedaba a la lámina (${aPies2(l.restante)} pie²)`;
    } else {
      const corte = leerPiezas(opciones.piezas);
      medidas = corte.texto;
      const fuente = opciones.fuente || 'auto';

      if (fuente === 'lamina') {
        const l = laminas.find((x) => x.id === opciones.laminaId);
        if (!l) throw new HttpError(404, 'Esa lámina no existe.');
        if (!cabe(l, corte.laminas)) {
          throw new HttpError(
            409,
            `A la lámina ${l.id} solo le quedan ${aPies2(l.restante)} pie² y el corte es de ${corte.pies2} pie².`
          );
        }
        reparto = [{ lamina: l, cantidad: cantidadATomar(l, corte.laminas) }];
      } else if (fuente === 'retazos') {
        // Los retazos son un montón: se toma de los más viejos primero
        const retazos = vivas.filter((l) => l.estado === 'RETAZOS').sort((a, b) => a.created_at - b.created_at);
        const enRetazos = retazos.reduce((t, l) => t + l.restante, 0);
        reparto = repartirEnOrden(retazos, corte.laminas);
        if (!reparto) {
          throw new HttpError(409, `En retazos solo hay ${aPies2(enRetazos)} pie² y el corte es de ${corte.pies2} pie².`);
        }
      } else {
        reparto = repartir(vivas.filter((l) => l.estado !== 'RETAZOS'), corte.laminas);
        if (!reparto) {
          throw new HttpError(
            409,
            `No alcanza: el corte es de ${corte.pies2} pie² y entre las láminas disponibles hay ` +
            `${res.disponiblePies2} pie²` +
            (res.enRetazos > 0 ? ` (más ${res.enRetazosPies2} pie² en retazos)` : '') +
            (esMerma ? '.' : '. Registra una compra o las láminas que falten en la pestaña Láminas.')
          );
        }
      }
    }

    const movimientos = [];
    for (let i = 0; i < reparto.length; i++) {
      const { lamina, cantidad } = reparto[i];
      const r = await inv.registrarMovimiento(
        {
          ...datos,
          cantidad,
          unidadId: material.unidad_id,
          laminaId: lamina.id,
          medidas: reparto.length > 1 ? `${medidas} (parte ${i + 1} de ${reparto.length})` : medidas,
          // La merma de una lámina nunca puede dejar nada en negativo
          forzadoNegativo: esMerma ? false : datos.forzadoNegativo,
        },
        usuarioId,
        conn
      );
      movimientos.push({ laminaId: lamina.id, cantidad, pies2: aPies2(cantidad), movimientoId: r.movimientoId });
      lamina.restante = round4(lamina.restante - cantidad);
    }

    // "Con este corte la lámina se terminó": lo que queda pasa a retazos,
    // con su constancia en Movimientos igual que el botón Terminar
    const ultima = reparto[reparto.length - 1].lamina;
    let terminada = null;
    if (opciones.terminarDespues && ultima.restante > CASI_CERO && !ultima.terminada) {
      await inv.registrarMovimiento(
        {
          materialId: material.id, tipo: 'AJUSTE', cantidad: 0, unidadId: material.unidad_id,
          fecha: datos.fecha, laminaId: ultima.id, motivo: 'Lámina pasa a retazos',
          quien: datos.quien, permitirCero: true, forzarMovimiento: true, descuenta: false,
          medidas: `Quedan ${aPies2(ultima.restante)} pie² en pedazos de menos de 12×12 pulg.`,
        },
        usuarioId,
        conn
      );
      await conn.query('UPDATE laminas SET terminada = TRUE WHERE id = ?', [ultima.id]);
      terminada = ultima.id;
    }

    const despues = resumir(await laminasConRestante(conn, material.id));
    const existencia = await inv.calcularExistencia(conn, material.id);
    await conn.commit();

    return {
      movimientos,
      laminasUsadas: reparto.map((x) => x.lamina.id),
      cantidad: round4(reparto.reduce((t, x) => t + x.cantidad, 0)),
      medidas,
      quedaEnUltima: { id: ultima.id, restante: ultima.restante, pies2: aPies2(ultima.restante) },
      terminada,
      resumen: despues,
      existencia,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  LAMINA_ANCHO,
  LAMINA_ALTO,
  PULG2_POR_LAMINA,
  PIE2_POR_LAMINA,
  RETAZO_MINIMO,
  CASI_CERO,
  esMaterialDeLamina,
  aPies2,
  dePies2,
  textoCantidad,
  estadoDeLamina,
  laminasConRestante,
  toleranciaDe,
  cabe,
  cantidadATomar,
  calcularRestanteLamina: inv.calcularRestanteLamina,
  resumir,
  stockSinLamina,
  crearLaminas,
  leerPiezas,
  registrarConsumo,
};
