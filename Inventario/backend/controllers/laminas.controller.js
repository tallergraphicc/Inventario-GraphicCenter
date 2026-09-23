// ==========================================================================
// laminas.controller.js — pestaña Láminas
//
// Materiales que usan láminas: los que están en la unidad LAMINA.
// Cada lámina de 4x8 se registra una por una; en la salida se ponen las
// piezas cortadas y el sistema descuenta ese pedazo (ver laminas.service.js).
// ==========================================================================

const pool = require('../config/db');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');
const inv = require('../services/inventario.service');
const lam = require('../services/laminas.service');
const csv = require('../config/csv');
const log = require('../config/log');

/**
 * El material, validando que sea por láminas.
 *
 * paraActualizar: bloquea la fila del material. Es el ÚNICO bloqueo que se
 * usa para láminas, y siempre va primero — así dos operaciones nunca se
 * bloquean en orden cruzado (lo que antes podía trabar dos pedidos a la vez).
 * Se bloquea la tabla sola, sin JOIN, para no bloquear también la unidad.
 */
async function materialDeLaminaOrThrow(conn, materialId, paraActualizar = false) {
  if (paraActualizar) {
    const [[bloqueo]] = await conn.query('SELECT id FROM materiales WHERE id = ? FOR UPDATE', [materialId]);
    if (!bloqueo) throw new HttpError(404, 'Material no encontrado.');
  }
  const [[m]] = await conn.query(
    `SELECT m.*, u.codigo AS unidad_codigo FROM materiales m
     JOIN unidades_medida u ON u.id = m.unidad_id
     WHERE m.id = ?`,
    [materialId]
  );
  if (!m) throw new HttpError(404, 'Material no encontrado.');
  if (!lam.esMaterialDeLamina(m)) {
    throw new HttpError(400, `${m.codigo} no se maneja por láminas: su unidad es ${m.unidad_codigo}. Cámbiala a "Lámina" en Editar material.`);
  }
  return m;
}

/**
 * Una lámina con lo que le queda, y su material ya bloqueado.
 * Primero se averigua de qué material es (sin bloquear), después se bloquea
 * el material, y recién entonces se lee la lámina.
 */
async function laminaYMaterial(conn, id) {
  const [[ref]] = await conn.query('SELECT material_id FROM laminas WHERE id = ?', [id]);
  if (!ref) throw new HttpError(404, 'Lámina no encontrada.');
  const material = await materialDeLaminaOrThrow(conn, ref.material_id, true);
  const lista = await lam.laminasConRestante(conn, ref.material_id);
  const l = lista.find((x) => x.id === id);
  if (!l) throw new HttpError(404, 'Lámina no encontrada (ya estaba eliminada).');
  return { l, material };
}

/**
 * Todos los materiales por lámina, cada uno con sus láminas, lo que le queda
 * a cada una y el resumen (completas, abiertas, retazos, sin registrar).
 */
const listar = asyncHandler(async (req, res) => {
  const cond = ["u.codigo = 'LAMINA'", 'm.activo = TRUE'];
  const params = [];
  if (req.query.materialId) { cond.push('m.id = ?'); params.push(req.query.materialId); }

  const [materiales] = await pool.query(
    `SELECT m.*, u.codigo AS unidad_codigo, c.nombre AS categoria, sc.nombre AS subcategoria
     FROM materiales m
     JOIN unidades_medida u ON u.id = m.unidad_id
     JOIN categorias c ON c.id = m.categoria_id
     LEFT JOIN subcategorias sc ON sc.id = m.subcategoria_id
     WHERE ${cond.join(' AND ')}
     ORDER BY m.codigo`,
    params
  );

  const conn = await pool.getConnection();
  try {
    const resultado = [];
    for (const m of materiales) {
      const laminas = await lam.laminasConRestante(conn, m.id);
      const existencia = await inv.calcularExistencia(conn, m.id);
      const estado = await inv.calcularEstado(conn, m);
      const enLaminas = laminas.reduce((t, l) => t + Math.max(l.restante, 0), 0);
      const sinLamina = inv.round4(existencia - enLaminas);
      const visibles = req.query.soloDisponibles === '1'
        ? laminas.filter((l) => l.restante > lam.CASI_CERO)
        : laminas.filter((l) => l.estado !== 'AGOTADA' || req.query.verAgotadas === '1');
      resultado.push({
        ...m,
        existencia,
        existencia_pies2: lam.aPies2(existencia),
        estado,
        resumen: lam.resumir(laminas),
        sin_lamina: sinLamina,
        sin_lamina_pies2: lam.aPies2(sinLamina),
        agotadas: laminas.filter((l) => l.estado === 'AGOTADA').length,
        laminas: visibles,
      });
    }
    res.json({ materiales: resultado, pie2PorLamina: lam.PIE2_POR_LAMINA, retazoMinimo: lam.RETAZO_MINIMO });
  } finally {
    conn.release();
  }
});

/**
 * Registrar láminas que ya están en bodega (sin compra).
 *
 * body: { materialId, completas: 3 }            → 3 láminas de 4x8
 *       { materialId, pedazoAncho, pedazoAlto } → un pedazo de esas medidas
 *       { materialId, completas, pedazoPies2 }  → lo que usa el botón
 *                                                  "Crear las láminas"
 *
 * Igual que con los rollos: si ya había existencia contada sin lámina (ej.
 * "Foam 3 mm: 8" de antes), esas láminas SON ese material — no se suma dos
 * veces. Solo entra a la existencia lo que pase de ahí.
 */
const crear = asyncHandler(async (req, res) => {
  const b = req.body;
  const completas = Number(b.completas || 0);
  if (!Number.isInteger(completas) || completas < 0) throw new HttpError(400, 'Las láminas completas tienen que ser un número entero.');
  if (completas > 500) throw new HttpError(400, 'Son demasiadas láminas de una vez (máximo 500).');

  let pedazo = null;
  if (b.pedazoAncho || b.pedazoAlto) {
    const corte = lam.leerPiezas([{ cantidad: 1, ancho: b.pedazoAncho, alto: b.pedazoAlto }]);
    pedazo = { ancho: Number(b.pedazoAncho), alto: Number(b.pedazoAlto), tamano: corte.laminas };
  } else if (b.pedazoTamano || b.pedazoPies2) {
    // pedazoTamano viene en láminas (exacto, lo usa "Crear las láminas");
    // pedazoPies2 en pies²
    const tamano = b.pedazoTamano ? inv.round4(b.pedazoTamano) : lam.dePies2(b.pedazoPies2);
    if (!(tamano > 0) || tamano >= 1) throw new HttpError(400, 'El pedazo tiene que ser de menos de una lámina (32 pie²).');
    pedazo = { tamano };
  }
  if (!completas && !pedazo) throw new HttpError(400, 'Di cuántas láminas completas son, o las medidas del pedazo.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const material = await materialDeLaminaOrThrow(conn, b.materialId, true);

    const tamanoTotal = inv.round4(completas + (pedazo ? pedazo.tamano : 0));
    const sinLamina = await lam.stockSinLamina(conn, material.id);

    // "Crear las láminas" solo registra lo que YA estaba contado. Si mientras
    // tanto alguien más lo hizo (otra pestaña, otro usuario), no se crea nada:
    // si no, se duplicarían láminas y se sumaría a la existencia.
    if (b.soloAbsorber && tamanoTotal > Math.max(0, sinLamina) + 0.0005) {
      throw new HttpError(
        409,
        `Ya no hay tanto sin registrar: quedan ${lam.textoCantidad(Math.max(0, sinLamina))}. ` +
        'Seguro alguien ya creó estas láminas. Recarga la pantalla.'
      );
    }
    const absorbido = inv.round4(Math.min(tamanoTotal, Math.max(0, sinLamina)));
    const nuevo = inv.round4(tamanoTotal - absorbido);

    const partes = [];
    if (completas) partes.push(`${completas} lámina(s) completa(s)`);
    if (pedazo) partes.push(`un pedazo de ${pedazo.ancho ? `${pedazo.ancho}×${pedazo.alto} pulg.` : `${lam.aPies2(pedazo.tamano)} pie²`}`);
    const nota = [`Se registran ${partes.join(' y ')} que ya estaban en bodega`];
    if (absorbido > 0) nota.push(`${lam.textoCantidad(absorbido)} ya estaban contados en la existencia`);
    if (nuevo > 0) nota.push(`${lam.textoCantidad(nuevo)} se suman a la existencia`);

    // Queda siempre constancia en Movimientos, aunque no sume nada
    const mov = await inv.registrarMovimiento(
      {
        materialId: material.id, tipo: 'AJUSTE', cantidad: nuevo, unidadId: material.unidad_id,
        fecha: csv.fecha(new Date()), motivo: 'Alta de lámina existente',
        quien: b.quien || req.usuario.nombre, autoriza: b.autoriza || null,
        forzarMovimiento: true, permitirCero: true, descuenta: nuevo !== 0,
        observaciones: nota.join('. ') + '.' + (b.observaciones ? ` ${b.observaciones}` : ''),
      },
      req.usuario.id,
      conn
    );

    const creadas = await lam.crearLaminas(conn, material, {
      completas, pedazo, origen: absorbido >= tamanoTotal ? 'conteo' : 'existente',
      movimientoOrigenId: mov.movimientoId, bodegaId: b.bodegaId, ubicacion: b.ubicacion,
    });

    await conn.commit();
    log.info('láminas existentes registradas', {
      material: material.codigo, laminas: creadas.map((c) => c.id), absorbido, nuevo, por: req.usuario.usuario,
    });
    res.status(201).json({
      ok: true,
      laminas: creadas.map((c) => c.id),
      absorbido,
      nuevo,
      mensaje: `Se registraron ${creadas.length} lámina(s): ${creadas.map((c) => c.id).join(', ')}.` +
        (absorbido > 0 ? ' Ya estaban contadas en la existencia, así que no se sumaron dos veces.' : ''),
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/**
 * Editar una lámina: ubicación/bodega, o corregir lo que le queda.
 *
 * Corregir lo que queda (ej. el sistema dice 20 pie² y en la bodega se ve
 * que quedan 12) deja un AJUSTE con quién y quién autoriza, como el largo de
 * un rollo. Nunca cambia en silencio.
 */
const actualizar = asyncHandler(async (req, res) => {
  const b = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { l, material } = await laminaYMaterial(conn, req.params.id);

    if (b.bodegaId !== undefined || b.ubicacion !== undefined) {
      await conn.query('UPDATE laminas SET bodega_id = ?, ubicacion = ? WHERE id = ?', [
        b.bodegaId === undefined ? l.bodega_id : (b.bodegaId || null),
        b.ubicacion === undefined ? l.ubicacion : (b.ubicacion || null),
        l.id,
      ]);
    }

    let diferencia = 0;
    if (b.restantePies2 !== undefined && b.restantePies2 !== null && b.restantePies2 !== '') {
      const nuevoRestante = lam.dePies2(b.restantePies2);
      if (nuevoRestante < 0) throw new HttpError(400, 'Lo que queda no puede ser negativo.');
      if (nuevoRestante > 1 + lam.CASI_CERO) throw new HttpError(400, 'Una lámina no puede tener más de 32 pie² (4×8 pies).');
      diferencia = inv.round4(nuevoRestante - l.restante);

      if (Math.abs(diferencia) > lam.CASI_CERO) {
        if (!b.quien || !b.autoriza) {
          throw new HttpError(400, 'Para corregir lo que le queda a la lámina hace falta quién lo hace y quién autoriza.');
        }
        // Se corrige el tamaño de registro para que lo que queda dé lo contado
        await conn.query('UPDATE laminas SET tamano = tamano + ? WHERE id = ?', [diferencia, l.id]);
        await inv.registrarMovimiento(
          {
            materialId: material.id, tipo: 'AJUSTE', cantidad: diferencia, unidadId: material.unidad_id,
            fecha: csv.fecha(new Date()), laminaId: l.id, motivo: 'Corrección de lámina',
            quien: b.quien, autoriza: b.autoriza, forzarMovimiento: true,
            medidas: `Quedaban ${lam.aPies2(l.restante)} pie²; se contaron ${lam.aPies2(nuevoRestante)} pie²`,
            observaciones: b.observaciones || null,
          },
          req.usuario.id,
          conn
        );
      }
    }

    await conn.commit();
    res.json({ ok: true, diferencia, diferenciaPies2: lam.aPies2(diferencia) });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/**
 * Terminar una lámina: ya solo le quedan pedazos de menos de 12x12 pulg.
 *   accion 'retazos' → lo que queda se guarda como retazos (sigue en existencia)
 *   accion 'merma'   → lo que queda no sirve: se registra como merma
 */
const terminar = asyncHandler(async (req, res) => {
  const accion = req.body.accion === 'merma' ? 'merma' : 'retazos';
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { l, material } = await laminaYMaterial(conn, req.params.id);
    if (l.restante <= lam.CASI_CERO) throw new HttpError(409, 'A esa lámina ya no le queda nada.');

    if (accion === 'merma') {
      if (!req.body.quien || !req.body.autoriza) {
        throw new HttpError(400, 'Para botar lo que queda como merma hace falta el responsable y quién autoriza.');
      }
      await inv.registrarMovimiento(
        {
          materialId: material.id, tipo: 'MERMA', cantidad: l.restante, unidadId: material.unidad_id,
          fecha: csv.fecha(new Date()), laminaId: l.id, motivo: req.body.motivo || 'Retazo no aprovechable',
          quien: req.body.quien, autoriza: req.body.autoriza, forzadoNegativo: false,
          medidas: `Lo que le quedaba a la lámina (${lam.aPies2(l.restante)} pie²)`,
          observaciones: req.body.observaciones || null,
        },
        req.usuario.id,
        conn
      );
    } else {
      // No mueve existencia, pero queda la constancia en Movimientos
      await inv.registrarMovimiento(
        {
          materialId: material.id, tipo: 'AJUSTE', cantidad: 0, unidadId: material.unidad_id,
          fecha: csv.fecha(new Date()), laminaId: l.id, motivo: 'Lámina pasa a retazos',
          quien: req.body.quien || req.usuario.nombre, permitirCero: true, forzarMovimiento: true, descuenta: false,
          medidas: `Quedan ${lam.aPies2(l.restante)} pie² en pedazos de menos de 12×12 pulg.`,
          observaciones: req.body.observaciones || null,
        },
        req.usuario.id,
        conn
      );
    }
    await conn.query('UPDATE laminas SET terminada = TRUE WHERE id = ?', [l.id]);

    await conn.commit();
    log.info('lámina terminada', { lamina: l.id, accion, restante: l.restante, por: req.usuario.usuario });
    res.json({
      ok: true,
      mensaje: accion === 'merma'
        ? `Lámina ${l.id} terminada: ${lam.aPies2(l.restante)} pie² se registraron como merma.`
        : `Lámina ${l.id} terminada: ${lam.aPies2(l.restante)} pie² pasan a retazos.`,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/** Deshacer "terminar": la lámina vuelve a estar disponible para cortes normales. */
const reabrir = asyncHandler(async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { l } = await laminaYMaterial(conn, req.params.id);
    if (!l.terminada) throw new HttpError(409, 'Esa lámina no estaba terminada.');
    if (l.restante <= lam.CASI_CERO) throw new HttpError(409, 'A esa lámina ya no le queda nada.');
    await conn.query('UPDATE laminas SET terminada = FALSE WHERE id = ?', [l.id]);
    await conn.commit();
    log.info('lámina reabierta', { lamina: l.id, por: req.usuario.usuario });
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/**
 * Eliminar una lámina (ej. se registró de más, o ya no existe).
 * Si le quedaba material, se descuenta con un AJUSTE "Lámina eliminada".
 */
const eliminar = asyncHandler(async (req, res) => {
  const { quien, autoriza, observaciones } = req.body;
  if (!quien || !autoriza) throw new HttpError(400, 'Eliminar una lámina requiere quién lo hace y quién autoriza.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { l, material } = await laminaYMaterial(conn, req.params.id);

    await inv.registrarMovimiento(
      {
        materialId: material.id, tipo: 'AJUSTE', cantidad: l.restante > lam.CASI_CERO ? -l.restante : 0,
        unidadId: material.unidad_id, fecha: csv.fecha(new Date()), laminaId: l.id,
        motivo: 'Lámina eliminada', quien, autoriza, forzarMovimiento: true,
        permitirCero: true, descuenta: l.restante > lam.CASI_CERO,
        medidas: `Le quedaban ${lam.aPies2(Math.max(l.restante, 0))} pie²`,
        observaciones: observaciones || null,
      },
      req.usuario.id,
      conn
    );
    await conn.query('UPDATE laminas SET activo = FALSE WHERE id = ?', [l.id]);
    await conn.commit();
    log.info('lámina eliminada', { lamina: l.id, restante: l.restante, por: req.usuario.usuario });
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/** Botar todos los retazos de un material de una vez (merma). */
const botarRetazos = asyncHandler(async (req, res) => {
  const { materialId, quien, autoriza, motivo, observaciones } = req.body;
  if (!quien || !autoriza) throw new HttpError(400, 'Hace falta el responsable y quién autoriza.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const material = await materialDeLaminaOrThrow(conn, materialId, true);
    const retazos = (await lam.laminasConRestante(conn, material.id))
      .filter((l) => l.estado === 'RETAZOS');
    if (!retazos.length) throw new HttpError(409, 'Este material no tiene retazos.');

    let total = 0;
    for (const l of retazos) {
      await inv.registrarMovimiento(
        {
          materialId: material.id, tipo: 'MERMA', cantidad: l.restante, unidadId: material.unidad_id,
          fecha: csv.fecha(new Date()), laminaId: l.id, motivo: motivo || 'Retazo no aprovechable',
          quien, autoriza, forzadoNegativo: false,
          medidas: `Retazos de la lámina ${l.id} (${lam.aPies2(l.restante)} pie²)`,
          observaciones: observaciones || null,
        },
        req.usuario.id,
        conn
      );
      total += l.restante;
    }
    await conn.commit();
    res.json({ ok: true, mensaje: `Se botaron ${lam.aPies2(total)} pie² de retazos (${retazos.length} lámina(s)).` });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

const ESTADOS = { COMPLETA: 'Completa', ABIERTA: 'Abierta', RETAZOS: 'Retazos', AGOTADA: 'Agotada' };

const exportarCsv = asyncHandler(async (req, res) => {
  const [materiales] = await pool.query(
    `SELECT m.id, m.codigo, m.descripcion, m.espesor_mm, m.costo
     FROM materiales m JOIN unidades_medida u ON u.id = m.unidad_id
     WHERE u.codigo = 'LAMINA' AND m.activo = TRUE ORDER BY m.codigo`
  );
  const filas = [];
  const conn = await pool.getConnection();
  try {
    for (const m of materiales) {
      const laminas = await lam.laminasConRestante(conn, m.id);
      laminas.filter((l) => l.restante > lam.CASI_CERO).forEach((l) => filas.push({ ...l, m }));
    }
  } finally {
    conn.release();
  }
  csv.responder(res, 'laminas', [
    { titulo: 'Lámina', clave: 'id' },
    { titulo: 'Código', valor: (r) => r.m.codigo },
    { titulo: 'Material', valor: (r) => r.m.descripcion },
    { titulo: 'Espesor (mm)', valor: (r) => r.m.espesor_mm ?? '' },
    { titulo: 'Estado', valor: (r) => ESTADOS[r.estado] || r.estado },
    { titulo: 'Queda (pie²)', clave: 'restante_pies2' },
    { titulo: 'Queda (láminas)', clave: 'restante' },
    { titulo: 'Costo por lámina', valor: (r) => r.m.costo ?? '' },
    { titulo: 'Valor', valor: (r) => (r.m.costo == null ? '' : inv.round4(r.restante * Number(r.m.costo))) },
    { titulo: 'Bodega', clave: 'bodega_nombre' },
    { titulo: 'Ubicación', clave: 'ubicacion' },
    { titulo: 'Registrada el', valor: (r) => csv.fecha(r.created_at) },
  ], filas);
});

module.exports = { listar, crear, actualizar, terminar, reabrir, eliminar, botarRetazos, exportarCsv };
