const pool = require('../config/db');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');
const inv = require('../services/inventario.service');
const csv = require('../config/csv');
const log = require('../config/log');

// ---------------------------------------------------------------------------
// "Por confirmar" significa: todavía no sabemos la medida de este rollo.
// En cuanto el rollo TIENE un largo, ya se sabe — así que no tiene sentido
// que se quede marcado como por confirmar. Estas dos funciones resuelven ese
// caso, tanto al registrar el rollo como al editarlo.
// ---------------------------------------------------------------------------

/** Un rollo con largo conocido no puede quedarse en "POR_CONFIRMAR". */
function estadoDeRollo(estadoPedido, largo) {
  const estado = estadoPedido || 'POR_CONFIRMAR';
  const tieneLargo = largo !== null && largo !== undefined && largo !== '' && !Number.isNaN(Number(largo));
  if (estado === 'POR_CONFIRMAR' && tieneLargo) return 'SELLADO';
  return estado;
}

/** Idem para la precisión: si ya hay medida, como mínimo es "estimada". */
function precisionDeRollo(precisionPedida, largo) {
  const precision = precisionPedida || 'POR_CONFIRMAR';
  const tieneLargo = largo !== null && largo !== undefined && largo !== '' && !Number.isNaN(Number(largo));
  if (precision === 'POR_CONFIRMAR' && tieneLargo) return 'ESTIMADO';
  return precision;
}

/**
 * Lista de rollos.
 *
 * Acepta ?anchoMinimo=60 para responder la pregunta del taller: "¿tengo un
 * rollo lo bastante ancho para esto?". Los rollos sin ancho registrado se
 * incluyen igual, porque no saber el ancho no es lo mismo que ser angosto —
 * hay que ir a medirlos, y por eso se marcan aparte en la pantalla.
 */
const listar = asyncHandler(async (req, res) => {
  const cond = ['r.activo = TRUE'];
  const params = [];

  if (req.query.anchoMinimo) {
    cond.push('(r.ancho >= ? OR r.ancho IS NULL)');
    params.push(Number(req.query.anchoMinimo));
  }
  if (req.query.materialId) {
    cond.push('r.material_id = ?');
    params.push(req.query.materialId);
  }
  if (req.query.soloDisponibles === '1') {
    cond.push("r.estado <> 'AGOTADO'");
  }

  const [rollos] = await pool.query(`
    SELECT r.*, m.codigo AS material_codigo, m.descripcion AS material_descripcion,
           b.nombre AS bodega_nombre
    FROM rollos r
    JOIN materiales m ON m.id = r.material_id
    LEFT JOIN bodegas b ON b.id = r.bodega_id
    WHERE ${cond.join(' AND ')}
    ORDER BY r.created_at DESC
  `, params);

  const conn = await pool.getConnection();
  try {
    const resultado = [];
    for (const r of rollos) {
      const restante = await inv.calcularRestanteRollo(conn, r.id);
      resultado.push({ ...r, restante });
    }
    res.json(resultado);
  } finally {
    conn.release();
  }
});

/**
 * Convierte el costo del rollo completo en costo por unidad (por pie lineal)
 * y lo deja como costo del material.
 *
 * Así se piensa en el taller: "este rollo me costó B/. 100", no "cada pie me
 * costó B/. 0.6096". El sistema hace la división. Como el costo del material
 * se sobrescribe con el último dato, esto sirve también para ponerle precio a
 * lo que ya está en bodega sin tener que registrar una compra.
 */
async function aplicarCostoDelRollo(conn, materialId, costoRollo, largo, usuario) {
  if (costoRollo === undefined || costoRollo === null || costoRollo === '') return null;
  const total = Number(costoRollo);
  if (!(total >= 0)) throw new HttpError(400, 'El costo del rollo no es un número válido.');
  if (!(Number(largo) > 0)) {
    throw new HttpError(400, 'Para calcular el costo por pie hace falta el largo del rollo.');
  }
  const porUnidad = inv.round4(total / Number(largo));
  await conn.query('UPDATE materiales SET costo = ? WHERE id = ?', [porUnidad, materialId]);
  log.info('costo actualizado desde el rollo', { materialId, costoRollo: total, largo, porUnidad, por: usuario });
  return porUnidad;
}

/**
 * Registrar un rollo que ya estaba físicamente en bodega, sin pasar por Entrada.
 *
 * Si trae largo, ese material entra a la existencia — PERO primero se cuenta
 * lo que ya estaba registrado sin rollo. Si antes se hizo la entrada de la
 * compra sin crear el rollo, esos pies ya estaban contados: este rollo es
 * donde estaban, no material nuevo. Antes se sumaba dos veces.
 */
const crear = asyncHandler(async (req, res) => {
  const { materialId, ancho, largo, estado, precisionMedida, bodegaId, ubicacion, costoRollo } = req.body;
  if (!materialId) throw new HttpError(400, 'El material es obligatorio.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[material]] = await conn.query('SELECT * FROM materiales WHERE id = ? FOR UPDATE', [materialId]);
    if (!material) throw new HttpError(404, 'Material no encontrado.');
    const [[unidad]] = await conn.query('SELECT codigo FROM unidades_medida WHERE id = ?', [material.unidad_id]);
    if (unidad && unidad.codigo === 'LAMINA') {
      throw new HttpError(400, `${material.codigo} se maneja por láminas, no por rollos: regístralo en la pestaña Láminas.`);
    }
    // Rollos solo para lo que se mide por largo. Un "rollo" de un material
    // contado por unidad no cuadra con nada (así pasó con VIN-MAT-02 en ROLLO).
    if (!unidad || !['PIE LINEAL', 'METRO LINEAL'].includes(unidad.codigo)) {
      throw new HttpError(
        400,
        `${material.codigo} está en la unidad ${unidad ? unidad.codigo : '—'}. Los rollos son para materiales en ` +
        'pie lineal o metro lineal: cámbiale la unidad en Inventario → Editar si de verdad viene en rollo.'
      );
    }

    // ID: el que escribió la persona, o el siguiente libre (CODIGO-R03...)
    const id = String(req.body.id ?? '').trim() || await inv.siguienteIdRollo(conn, material);
    const [[existe]] = await conn.query('SELECT id FROM rollos WHERE id = ?', [id]);
    if (existe) throw new HttpError(409, `Ya existe un rollo con el ID ${id}.`);

    // El largo es opcional (un rollo se puede registrar sin medir), pero si
    // viene tiene que ser un número mayor que cero. Antes "-5" o "abc"
    // quedaban como rollo sin largo pero marcado SELLADO.
    const vieneLargo = largo !== undefined && largo !== null && largo !== '';
    if (vieneLargo && !(Number.isFinite(Number(largo)) && Number(largo) > 0)) {
      throw new HttpError(400, 'El largo del rollo tiene que ser un número mayor que cero (o déjalo vacío si no se ha medido).');
    }
    if (ancho !== undefined && ancho !== null && ancho !== '' && !(Number.isFinite(Number(ancho)) && Number(ancho) > 0)) {
      throw new HttpError(400, 'El ancho tiene que ser un número mayor que cero.');
    }
    const tieneLargo = vieneLargo;

    // ¿Cuánto de este largo ya estaba contado en la existencia sin rollo?
    // Se calcula ANTES de insertar el rollo, para que no se cuente a sí mismo.
    let absorbido = 0;
    let nuevo = 0;
    if (tieneLargo) {
      const sinRollo = await inv.stockSinRollo(conn, material.id);
      absorbido = inv.round4(Math.min(Number(largo), sinRollo));
      nuevo = inv.round4(Number(largo) - absorbido);
    }

    await conn.query(
      `INSERT INTO rollos (id, material_id, ancho, largo, estado, precision_medida, bodega_id, ubicacion, origen)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id, material.id, ancho || null, tieneLargo ? Number(largo) : null,
        estadoDeRollo(estado, largo), precisionDeRollo(precisionMedida, largo),
        bodegaId || null, ubicacion || null, 'inicial',
      ]
    );

    if (tieneLargo) {
      // Queda SIEMPRE constancia en Movimientos. Antes esto subía el
      // inventario inicial por debajo, sin dejar rastro de nada.
      const partes = [`Rollo ${id} registrado con ${Number(largo)}`];
      if (absorbido > 0) partes.push(`${absorbido} ya estaban contados en la existencia sin rollo`);
      if (nuevo > 0) partes.push(`${nuevo} se suman a la existencia`);

      await inv.registrarMovimiento(
        {
          materialId: material.id, tipo: 'AJUSTE', cantidad: nuevo, unidadId: material.unidad_id,
          fecha: csv.fecha(new Date()), rolloId: id,
          motivo: 'Alta de rollo existente', quien: req.usuario.nombre,
          forzarMovimiento: true, permitirCero: true, descuenta: nuevo !== 0,
          observaciones: partes.join('. ') + '.',
        },
        req.usuario.id,
        conn
      );

      // Si el material seguía "por confirmar", la medida del rollo lo confirma
      const precisionMaterial = precisionMedida === 'POR_CONFIRMAR' || !precisionMedida ? 'ESTIMADO' : precisionMedida;
      await conn.query(
        `UPDATE materiales SET precision_inicial = ?
         WHERE id = ? AND precision_inicial = 'POR_CONFIRMAR'`,
        [precisionMaterial, material.id]
      );
    }

    const costoPorUnidad = tieneLargo
      ? await aplicarCostoDelRollo(conn, material.id, costoRollo, largo, req.usuario.usuario)
      : null;

    await conn.commit();
    res.status(201).json({
      ok: true, id, absorbido, nuevo, costoPorUnidad,
      mensaje: absorbido > 0
        ? `Rollo ${id} registrado. ${absorbido} ya estaban contados en la existencia sin rollo, así que no se sumaron dos veces.`
        : `Rollo ${id} registrado.`,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/**
 * Editar un rollo ya existente.
 *
 * TODO cambio de medida queda visible en Movimientos — largo Y ancho:
 *
 *  - Si cambia el LARGO, se registra un AJUSTE y se exige quién lo hace y
 *    quién autoriza. Nunca se cambia el inventario en silencio.
 *  - Si cambia solo el ANCHO, también queda un AJUSTE, pero de cantidad CERO:
 *    el ancho no mueve pies lineales, pero es un dato de medida.
 *  - Si cambian los dos, sale UN solo movimiento con los dos cambios.
 *
 * LA PRIMERA VEZ que se mide un rollo (no tenía largo), primero se descuenta
 * lo que ya estaba contado en la existencia sin rollo. Eso es lo que evita la
 * existencia duplicada: si la compra se registró como entrada sin crear el
 * rollo, esos pies ya estaban contados, y medir el rollo físico solo dice
 * DÓNDE están, no agrega material nuevo.
 */
const actualizar = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    ancho, largo, estado, precisionMedida, bodegaId, ubicacion,
    quien, autoriza, observaciones, costoRollo,
  } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Siempre se bloquea primero el MATERIAL y después el rollo: en el orden
    // contrario, dos operaciones a la vez podían trabarse entre sí.
    const [[ref]] = await conn.query('SELECT material_id FROM rollos WHERE id = ?', [id]);
    if (!ref) throw new HttpError(404, 'Rollo no encontrado.');
    await conn.query('SELECT id FROM materiales WHERE id = ? FOR UPDATE', [ref.material_id]);
    const [[rollo]] = await conn.query('SELECT * FROM rollos WHERE id = ?', [id]);
    if (!rollo) throw new HttpError(404, 'Rollo no encontrado.');
    if (!rollo.activo) throw new HttpError(409, 'Ese rollo está eliminado: no se puede editar.');

    // ---- Largo ----
    const largoNuevo = largo === '' || largo === undefined || largo === null ? null : Number(largo);
    if (largoNuevo !== null && (!Number.isFinite(largoNuevo) || largoNuevo < 0)) {
      throw new HttpError(400, 'El largo tiene que ser un número mayor o igual que cero.');
    }
    const largoAnterior = rollo.largo === null ? null : Number(rollo.largo);
    const cambioDeLargo = largoNuevo !== null && largoNuevo !== largoAnterior;
    const primeraMedida = cambioDeLargo && largoAnterior === null;

    // ---- Ancho ----
    const anchoNuevo = ancho === '' || ancho === undefined || ancho === null ? null : Number(ancho);
    if (anchoNuevo !== null && (!Number.isFinite(anchoNuevo) || anchoNuevo <= 0)) {
      throw new HttpError(400, 'El ancho tiene que ser un número mayor que cero.');
    }
    const anchoAnterior = rollo.ancho === null ? null : Number(rollo.ancho);
    const cambioDeAncho = anchoNuevo !== null && anchoNuevo !== anchoAnterior;

    // El largo corregido no puede quedar por debajo de lo que ya se cortó
    if (cambioDeLargo && !primeraMedida) {
      const yaUsado = inv.round4(Number(rollo.largo) - (await inv.calcularRestanteRollo(conn, id)));
      if (largoNuevo < yaUsado - 0.0001) {
        throw new HttpError(
          409,
          `De ese rollo ya salieron ${yaUsado}. El largo corregido no puede ser menor que eso: ` +
          'si el rollo se acabó antes, registra la diferencia como merma.'
        );
      }
    }

    if (cambioDeLargo && (!quien || !autoriza)) {
      throw new HttpError(400, 'Cambiar el largo del rollo requiere quién lo hace y quién autoriza (queda como ajuste en Movimientos).');
    }

    const largoFinal = largoNuevo === null ? largoAnterior : largoNuevo;
    const anchoFinal = anchoNuevo === null ? anchoAnterior : anchoNuevo;

    // Si el rollo ya tiene medida, deja de estar "por confirmar".
    const estadoFinal = estadoDeRollo(estado || rollo.estado, largoFinal);
    const precisionFinal = precisionDeRollo(precisionMedida || rollo.precision_medida, largoFinal);

    // ------------------------------------------------------------------
    // ¿Cuánto mueve la existencia?
    // ------------------------------------------------------------------
    let diferencia = 0;
    let absorbido = 0;
    if (cambioDeLargo) {
      if (primeraMedida) {
        // Primera medida: lo que ya estaba contado sin rollo se asigna a este
        // rollo; solo lo que sobra es material nuevo. (Se calcula antes de
        // actualizar el rollo, así que este rollo todavía no cuenta.)
        const sinRollo = await inv.stockSinRollo(conn, rollo.material_id);
        absorbido = inv.round4(Math.min(largoNuevo, sinRollo));
        diferencia = inv.round4(largoNuevo - absorbido);
      } else {
        // Corrección de un rollo que ya estaba medido: la diferencia es real
        diferencia = inv.round4(largoNuevo - largoAnterior);
      }
    }

    // ------------------------------------------------------------------
    // Movimiento de constancia: UNO solo, con todo lo que cambió
    // ------------------------------------------------------------------
    if (cambioDeLargo || cambioDeAncho) {
      const detalle = [];
      if (cambioDeLargo) detalle.push(`Largo: ${largoAnterior ?? 'sin definir'} → ${largoNuevo}`);
      if (cambioDeAncho) detalle.push(`Ancho: ${anchoAnterior ?? 'sin definir'} → ${anchoNuevo}`);
      if (absorbido > 0) {
        detalle.push(`${absorbido} ya estaban contados en la existencia sin rollo (no se suman dos veces)`);
      }

      const motivo = cambioDeLargo && cambioDeAncho ? 'Corrección de medidas de rollo'
        : cambioDeLargo ? (primeraMedida ? 'Medición de rollo' : 'Corrección de largo de rollo')
        : 'Corrección de ancho de rollo';

      await inv.registrarMovimiento(
        {
          materialId: rollo.material_id,
          tipo: 'AJUSTE',
          cantidad: diferencia,
          fecha: csv.fecha(new Date()),
          rolloId: id,
          motivo,
          // El antes y el después, en un formato fijo: si se anula este
          // ajuste, de aquí se sabe a qué medidas vuelve el rollo
          medidas: detalle.filter((d) => /^(Largo|Ancho):/.test(d)).join('. ').slice(0, 200),
          quien: quien || req.usuario.nombre,
          autoriza: autoriza || null,
          forzarMovimiento: true,
          permitirCero: true,
          descuenta: diferencia !== 0,
          observaciones: observaciones
            ? `${observaciones} (${detalle.join('. ')})`
            : `Rollo ${id}. ${detalle.join('. ')}.`,
        },
        req.usuario.id,
        conn
      );
    }

    // Si al corregir el largo el rollo vuelve a tener material, deja de estar
    // agotado (si no, las salidas automáticas lo saltaban y decían que no hay
    // stock aunque el rollo tuviera de sobra).
    let estadoGuardado = estadoFinal;
    if (cambioDeLargo && estadoFinal === 'AGOTADO') {
      const usado = inv.round4((largoAnterior || 0) - (await inv.calcularRestanteRollo(conn, id) || 0));
      if (inv.round4(largoFinal - usado) > 0.0001) estadoGuardado = 'ABIERTO';
    }

    await conn.query(
      `UPDATE rollos SET ancho = ?, largo = ?, estado = ?, precision_medida = ?, bodega_id = ?, ubicacion = ? WHERE id = ?`,
      [
        anchoFinal, largoFinal, estadoGuardado, precisionFinal,
        bodegaId === undefined ? rollo.bodega_id : (bodegaId || null),
        ubicacion === undefined ? rollo.ubicacion : (ubicacion || null),
        id,
      ]
    );

    // El material tampoco debe seguir "por confirmar" si todos sus rollos ya
    // están medidos.
    if (largoFinal !== null && precisionFinal !== 'POR_CONFIRMAR') {
      const [[material]] = await conn.query(
        'SELECT precision_inicial FROM materiales WHERE id = ?',
        [rollo.material_id]
      );
      if (material && material.precision_inicial === 'POR_CONFIRMAR') {
        const [[{ pendientes }]] = await conn.query(
          `SELECT COUNT(*) AS pendientes FROM rollos
           WHERE material_id = ? AND activo = TRUE
             AND (largo IS NULL OR precision_medida = 'POR_CONFIRMAR')`,
          [rollo.material_id]
        );
        if (pendientes === 0) {
          await conn.query(
            'UPDATE materiales SET precision_inicial = ? WHERE id = ?',
            [precisionFinal, rollo.material_id]
          );
        }
      }
    }

    // Costo del rollo completo → costo por pie del material
    const costoPorUnidad = await aplicarCostoDelRollo(
      conn, rollo.material_id, costoRollo, largoFinal, req.usuario.usuario
    );

    await conn.commit();
    res.json({ ok: true, cambioDeLargo, cambioDeAncho, absorbido, diferencia, costoPorUnidad });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/**
 * "Eliminar" un rollo en realidad lo marca como inactivo (no se borra la fila,
 * para no romper el historial de movimientos que ya lo referencian).
 *
 * SIEMPRE queda un rastro en Movimientos:
 *  - Si tenía algo de existencia restante, se descuenta con un AJUSTE negativo
 *    "Rollo eliminado" (sí afecta la existencia del material).
 *  - Si ya estaba en cero, igual se deja una nota tipo AJUSTE de cantidad 0
 *    (no afecta la existencia, es solo la constancia de que se eliminó).
 *
 * Antes esto se registraba como MERMA. Se cambió a AJUSTE porque ahora las
 * mermas son solo un registro y NO descuentan: si se hubiera quedado como
 * merma, eliminar un rollo dejaría la existencia del material inflada, y
 * además el total de "merma" del filtro mezclaría material realmente
 * desperdiciado con rollos dados de baja.
 */
const eliminar = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { quien, autoriza, observaciones } = req.body;
  if (!quien || !autoriza) {
    throw new HttpError(400, 'Eliminar un rollo requiere quién lo hace y quién autoriza (queda registrado en Movimientos).');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[ref]] = await conn.query('SELECT material_id FROM rollos WHERE id = ?', [id]);
    if (!ref) throw new HttpError(404, 'Rollo no encontrado.');
    // Primero el material (mismo orden que en todo lo demás), después el rollo
    const [[material]] = await conn.query('SELECT unidad_id FROM materiales WHERE id = ? FOR UPDATE', [ref.material_id]);
    const [[rollo]] = await conn.query('SELECT * FROM rollos WHERE id = ?', [id]);
    if (!rollo) throw new HttpError(404, 'Rollo no encontrado.');
    if (!rollo.activo) throw new HttpError(409, 'Este rollo ya estaba eliminado.');

    const restante = await inv.calcularRestanteRollo(conn, id);

    if (restante != null && restante > 0.0001) {
      // Sí había material — la eliminación descuenta existencia, queda como
      // AJUSTE negativo (un faltante real), no como merma.
      await inv.registrarMovimiento(
        {
          materialId: rollo.material_id, tipo: 'AJUSTE', cantidad: -restante, unidadId: material.unidad_id,
          fecha: csv.fecha(new Date()), rolloId: id, motivo: 'Rollo eliminado',
          quien, autoriza, forzarMovimiento: true,
          observaciones: observaciones || `Rollo ${id} eliminado con ${restante} restantes.`,
        },
        req.usuario.id,
        conn
      );
    } else {
      // Ya estaba en cero — no hay nada que descontar, pero igual queda la
      // constancia de que el rollo se eliminó (inserción directa, sin pasar
      // por las validaciones de cantidad>0 que aplican a movimientos reales).
      await conn.query(
        `INSERT INTO movimientos
          (material_id, tipo, cantidad, unidad_id, fecha, rollo_id, motivo,
           descuenta, quien, autoriza, observaciones, usuario_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          rollo.material_id, 'AJUSTE', 0, material.unidad_id, csv.fecha(new Date()),
          id, 'Rollo eliminado (sin restante)', false, quien, autoriza,
          observaciones || `Rollo ${id} eliminado; ya no tenía material restante.`, req.usuario.id,
        ]
      );
    }

    await conn.query('UPDATE rollos SET activo = FALSE WHERE id = ?', [id]);

    await conn.commit();
    res.json({
      ok: true,
      ajusteRegistrado: restante != null && restante > 0.0001 ? restante : 0,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/** Siguiente ID libre para un rollo nuevo de un material (para sugerirlo en pantalla). */
const siguienteId = asyncHandler(async (req, res) => {
  const [[material]] = await pool.query('SELECT id, codigo FROM materiales WHERE id = ?', [req.query.materialId]);
  if (!material) throw new HttpError(404, 'Material no encontrado.');
  const conn = await pool.getConnection();
  try {
    res.json({ id: await inv.siguienteIdRollo(conn, material) });
  } finally {
    conn.release();
  }
});

/** Exportar los rollos con su restante calculado. */
const exportarCsv = asyncHandler(async (req, res) => {
  const [rollos] = await pool.query(`
    SELECT r.*, m.codigo AS material_codigo, m.descripcion AS material_descripcion,
           m.costo AS costo_material,
           b.nombre AS bodega_nombre, u.codigo AS unidad_codigo
    FROM rollos r
    JOIN materiales m ON m.id = r.material_id
    JOIN unidades_medida u ON u.id = m.unidad_id
    LEFT JOIN bodegas b ON b.id = r.bodega_id
    WHERE r.activo = TRUE
    ORDER BY m.codigo, r.id
  `);

  const conn = await pool.getConnection();
  let filas;
  try {
    filas = [];
    for (const r of rollos) {
      filas.push({ ...r, restante: await inv.calcularRestanteRollo(conn, r.id) });
    }
  } finally {
    conn.release();
  }

  log.info('exportación de rollos', { filas: filas.length, por: req.usuario.usuario });

  csv.responder(res, 'rollos', [
    { titulo: 'ID Rollo', clave: 'id' },
    { titulo: 'Código material', clave: 'material_codigo' },
    { titulo: 'Material', clave: 'material_descripcion' },
    { titulo: 'Ancho', clave: 'ancho' },
    { titulo: 'Largo inicial', clave: 'largo' },
    { titulo: 'Restante', clave: 'restante' },
    { titulo: 'Unidad', clave: 'unidad_codigo' },
    { titulo: 'Costo por unidad', clave: 'costo_material' },
    { titulo: 'Valor del rollo completo', valor: (r) => (r.costo_material != null && r.largo != null
        ? inv.round4(Number(r.largo) * Number(r.costo_material)) : '') },
    { titulo: 'Valor de lo que queda', valor: (r) => (r.costo_material != null && r.restante != null
        ? inv.round4(Number(r.restante) * Number(r.costo_material)) : '') },
    { titulo: 'Estado', clave: 'estado' },
    { titulo: 'Precisión', clave: 'precision_medida' },
    { titulo: 'Bodega', clave: 'bodega_nombre' },
    { titulo: 'Ubicación', clave: 'ubicacion' },
    { titulo: 'Origen', clave: 'origen' },
  ], filas);
});

module.exports = { listar, crear, actualizar, eliminar, exportarCsv, siguienteId };
