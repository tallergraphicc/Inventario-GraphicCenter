const pool = require('../config/db');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');
const inv = require('../services/inventario.service');
const csv = require('../config/csv');
const log = require('../config/log');
const lam = require('../services/laminas.service');

const UNIDADES_DE_ROLLO = ['PIE LINEAL', 'METRO LINEAL'];

/** Busca el material por id y valida que exista; usado por los 4 endpoints de movimiento. */
async function materialOrThrow(materialId) {
  const [[m]] = await pool.query(
    `SELECT mat.*, u.codigo AS unidad_codigo
     FROM materiales mat JOIN unidades_medida u ON u.id = mat.unidad_id
     WHERE mat.id = ?`,
    [materialId]
  );
  if (!m) throw new HttpError(404, 'Material no encontrado.');
  // Un material eliminado no recibe movimientos nuevos (pasaba con una
  // pantalla abierta desde antes de eliminarlo).
  if (!m.activo) throw new HttpError(409, `El material ${m.codigo} está eliminado. Recarga la pantalla.`);
  return m;
}

/** Un número de verdad (no "abc", ni vacío, ni infinito). */
function numero(valor, etiqueta, { min = null, permitirVacio = false } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (permitirVacio) return null;
    throw new HttpError(400, `Falta ${etiqueta}.`);
  }
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new HttpError(400, `${etiqueta} tiene que ser un número.`);
  if (min !== null && n < min) throw new HttpError(400, `${etiqueta} no puede ser menor que ${min}.`);
  return n;
}

/** La fecha tiene que venir como AAAA-MM-DD y existir en el calendario. */
function fechaValida(valor) {
  const texto = String(valor || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) throw new HttpError(400, 'La fecha no tiene el formato correcto (AAAA-MM-DD).');
  const d = new Date(`${texto}T12:00:00`);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Esa fecha no existe.');
  return texto;
}

function esMaterialDeRollo(material) {
  return UNIDADES_DE_ROLLO.includes(material.unidad_codigo);
}

async function materialEsDeLamina(conn, materialId) {
  const [[m]] = await conn.query(
    `SELECT u.codigo AS unidad_codigo FROM materiales mat
     JOIN unidades_medida u ON u.id = mat.unidad_id WHERE mat.id = ?`,
    [materialId]
  );
  return lam.esMaterialDeLamina(m);
}

const TIPOS_DOCUMENTO = ['FACTURA', 'COTIZACION', 'OTRO'];
const LEGIBLES_DOCUMENTO = { FACTURA: 'Factura', COTIZACION: 'Cotización', OTRO: 'Documento' };

/**
 * Proveedor y documento de respaldo (N° de factura o cotización) de una
 * entrada. Todo es opcional, pero si viene, se valida:
 *  - el proveedor tiene que existir en Configuración → Proveedores
 *  - el tipo de documento es FACTURA, COTIZACION u OTRO
 * Sin número de documento no se guarda el tipo (quedaría "Factura" en blanco).
 */
async function leerDocumento(b, conn = pool) {
  let proveedorId = b.proveedorId ? Number(b.proveedorId) : null;
  if (proveedorId) {
    const [[p]] = await conn.query('SELECT id FROM proveedores WHERE id = ?', [proveedorId]);
    if (!p) throw new HttpError(400, 'Ese proveedor no existe. Agrégalo primero en Configuración → Proveedores.');
  } else {
    proveedorId = null;
  }

  const documentoNumero = String(b.documentoNumero || '').trim() || null;
  if (documentoNumero && documentoNumero.length > 60) {
    throw new HttpError(400, 'El número de documento es muy largo (máximo 60 caracteres).');
  }
  let documentoTipo = documentoNumero ? String(b.documentoTipo || 'FACTURA').toUpperCase() : null;
  if (documentoTipo && !TIPOS_DOCUMENTO.includes(documentoTipo)) {
    throw new HttpError(400, 'El tipo de documento debe ser Factura, Cotización u Otro.');
  }
  return { proveedorId, documentoTipo, documentoNumero };
}

/**
 * Cómo sale material de una lámina (ver laminas.service.registrarConsumo):
 *   modo 'piezas'    → piezas: [{ cantidad, ancho, alto }] en pulgadas
 *                      fuente: 'auto' | 'retazos' | 'lamina' (+ laminaId)
 *   modo 'completas' → completas: N láminas enteras
 *   modo 'resto'     → todo lo que le queda a laminaId
 */
function opcionesDeLamina(b) {
  return {
    modo: b.modoLamina || 'piezas',
    piezas: b.piezas,
    fuente: b.fuente || (b.laminaId ? 'lamina' : 'auto'),
    laminaId: b.laminaId || null,
    completas: b.completas,
    terminarDespues: b.terminarDespues === true,
  };
}

/**
 * ENTRADA — compra, devolución, etc.
 *
 * Para materiales por rollo (pie o metro lineal) la entrada CREA EL ROLLO por
 * omisión. Antes crearlo era una casilla opcional fácil de pasar por alto, y
 * si no se marcaba, los pies entraban a la existencia sin estar en ningún
 * rollo. Después, al ir a Rollos y medir el rollo físico, se sumaban otra vez:
 * así se duplicaba la existencia.
 *
 * El costo se puede mandar de dos formas:
 *   costoTotal → lo que costó la compra completa (ej. el rollo: B/. 100).
 *                El sistema lo divide entre la cantidad.
 *   costo      → el costo por unidad, ya calculado.
 */
const entrada = asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.materialId || !b.cantidad || !b.fecha) {
    throw new HttpError(400, 'Material, cantidad y fecha son obligatorios.');
  }
  const material = await materialOrThrow(b.materialId);
  const fecha = fechaValida(b.fecha);
  const cantidad = inv.round4(numero(b.cantidad, 'la cantidad'));
  if (!(cantidad > 0)) throw new HttpError(400, 'La cantidad debe ser mayor que cero.');

  // Costo por unidad: del total de la compra, o el que venga directo
  let costoUnitario = null;
  const costoTotal = numero(b.costoTotal, 'el costo total', { min: 0, permitirVacio: true });
  const costoUnidad = numero(b.costo, 'el costo por unidad', { min: 0, permitirVacio: true });
  if (costoTotal !== null) costoUnitario = inv.round4(costoTotal / cantidad);
  else if (costoUnidad !== null) costoUnitario = inv.round4(costoUnidad);

  const documento = await leerDocumento(b);

  // Láminas: siempre entran completas (se compran de 4x8, sin excepción).
  // Cada una queda registrada aparte: ACR-NEG-3MM-L01, L02...
  const esLamina = lam.esMaterialDeLamina(material);
  if (esLamina && !Number.isInteger(cantidad)) {
    throw new HttpError(
      400,
      'Las láminas entran completas: la cantidad tiene que ser un número entero de láminas de 4×8. ' +
      'Para un pedazo que ya estaba en bodega, usa Láminas → Registrar láminas existentes.'
    );
  }
  if (esLamina && cantidad > 500) throw new HttpError(400, 'Son demasiadas láminas en una sola entrada (máximo 500).');

  // ¿Se crea rollo? Por omisión sí, si el material se maneja por rollo.
  // Solo los materiales por largo (pie o metro lineal) llevan rollos
  const crearRollo = esMaterialDeRollo(material) && b.crearRollo !== false;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // El material se bloquea primero, antes de crear el rollo: dos entradas
    // del mismo material al mismo tiempo se trababan entre sí.
    await conn.query('SELECT id FROM materiales WHERE id = ? FOR UPDATE', [material.id]);

    let rolloId = null;
    if (crearRollo) {
      rolloId = String(b.nuevoRolloId ?? '').trim() || await inv.siguienteIdRollo(conn, material);
      const [[existe]] = await conn.query('SELECT id FROM rollos WHERE id = ?', [rolloId]);
      if (existe) throw new HttpError(409, `Ya existe un rollo con el ID ${rolloId}.`);

      await conn.query(
        `INSERT INTO rollos (id, material_id, ancho, largo, estado, precision_medida, bodega_id, ubicacion, origen)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          rolloId, material.id, b.ancho || null, cantidad,
          'SELLADO', 'EXACTO', b.bodegaId || material.bodega_id || null, b.ubicacion || null, 'entrada',
        ]
      );
    }

    // Todo en la misma transacción: si algo falla, no queda un rollo creado
    // sin su entrada, ni una entrada sin su rollo.
    const resultado = await inv.registrarMovimiento(
      {
        materialId: material.id, tipo: 'ENTRADA', cantidad, unidadId: material.unidad_id,
        fecha, rolloId, movimientoDetalle: b.movimiento,
        bodegaId: b.bodegaId, ubicacion: b.ubicacion, costoUnitario,
        ...documento,
        quien: b.quien, observaciones: b.observaciones,
      },
      req.usuario.id,
      conn
    );

    let laminasCreadas = [];
    if (esLamina) {
      laminasCreadas = (await lam.crearLaminas(conn, material, {
        completas: cantidad, origen: 'entrada', movimientoOrigenId: resultado.movimientoId,
        bodegaId: b.bodegaId, ubicacion: b.ubicacion,
      })).map((l) => l.id);
    }

    await conn.commit();
    log.info('entrada registrada', {
      material: material.codigo, cantidad, rollo: rolloId, laminas: laminasCreadas.length || undefined, costoUnitario,
      proveedor: documento.proveedorId, documento: documento.documentoNumero, por: req.usuario.usuario,
    });
    res.status(201).json({ ...resultado, rolloId, laminasCreadas, costoUnitario });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

const salida = asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.materialId || !b.fecha || !b.retira || !b.entrega) {
    throw new HttpError(400, 'Material, fecha, quién retira y quién entrega son obligatorios.');
  }
  const material = await materialOrThrow(b.materialId);
  // En láminas la cantidad sale de las piezas cortadas; en lo demás es obligatoria
  if (!lam.esMaterialDeLamina(material) && !b.cantidad) throw new HttpError(400, 'La cantidad es obligatoria.');

  const esLamina = lam.esMaterialDeLamina(material);
  const datosMovimiento = {
    materialId: material.id, tipo: 'SALIDA',
    cantidad: esLamina ? null : inv.round4(numero(b.cantidad, 'la cantidad', { min: 0 })),
    unidadId: material.unidad_id,
    fecha: fechaValida(b.fecha),
    // En láminas el rollo no aplica: se descuenta de una lámina
    rolloId: esLamina ? null : (b.rolloId || null),
    movimientoDetalle: b.movimiento,
    ot: b.ot, cotizacion: b.cotizacion, cliente: b.cliente, proyecto: b.proyecto,
    areaId: b.areaId, quien: b.retira, entrega: b.entrega,
    forzadoNegativo: b.forzadoNegativo, autoriza: b.autoriza, observaciones: b.observaciones,
  };

  // Láminas: se descuenta lo cortado de la lámina que corresponde
  if (esLamina) {
    const r = await lam.registrarConsumo(datosMovimiento, opcionesDeLamina(b), req.usuario.id);
    log.info('salida de lámina', { material: material.codigo, medidas: r.medidas, laminas: r.laminasUsadas, por: req.usuario.usuario });
    return res.status(201).json(r);
  }

  // Si el material se maneja por rollo y no vino un rollo específico ya elegido,
  // el sistema decide solo de cuál(es) rollo(s) descontar.
  const resultado = (esMaterialDeRollo(material) && !b.rolloId)
    ? await inv.registrarSalidaAutomatica(datosMovimiento, req.usuario.id)
    : await inv.registrarMovimiento(datosMovimiento, req.usuario.id);

  res.status(201).json(resultado);
});

/**
 * MERMA — descuenta del material y del rollo.
 *
 * El material que se echa a perder salió de la bodega igual que el que se
 * vendió: si no se descuenta, el sistema dice que hay más de lo que hay.
 *
 * Dos reglas propias de la merma:
 *
 *  - NUNCA puede dejar la existencia en negativo. A diferencia de una salida,
 *    aquí no hay forma de forzarlo: si la merma no cabe en lo que queda, es
 *    que algo está mal contado y hay que revisarlo antes, no empujarlo.
 *  - Si el material se maneja por rollos y no se eligió uno, el sistema
 *    descuenta solo del rollo (o los rollos) que tengan material.
 */
const merma = asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.materialId || !b.fecha || !b.motivo || !b.quien || !b.autorizaResponsable) {
    throw new HttpError(400, 'Material, fecha, motivo, responsable y quien autoriza son obligatorios.');
  }
  const material = await materialOrThrow(b.materialId);
  if (!lam.esMaterialDeLamina(material) && !b.cantidad) throw new HttpError(400, 'La cantidad es obligatoria.');

  const esLaminaMerma = lam.esMaterialDeLamina(material);
  const datosMovimiento = {
    materialId: material.id, tipo: 'MERMA',
    cantidad: esLaminaMerma ? null : inv.round4(numero(b.cantidad, 'la cantidad', { min: 0 })),
    unidadId: material.unidad_id,
    fecha: fechaValida(b.fecha), rolloId: esLaminaMerma ? null : (b.rolloId || null), motivo: b.motivo,
    ot: b.ot, cliente: b.cliente, areaId: b.areaId, bodegaId: b.bodegaId,
    // El costo de la merma lo pone el sistema (el del material ese día), no
    // quien llena el formulario.
    quien: b.quien, autoriza: b.autorizaResponsable,
    observaciones: b.observaciones,
    // La merma descuenta. Y nunca se fuerza a negativo, pase lo que pase:
    // aunque llegue forzadoNegativo desde afuera, aquí no se propaga.
    forzadoNegativo: false,
  };

  const resultado = esLaminaMerma
    ? await lam.registrarConsumo(datosMovimiento, opcionesDeLamina(b), req.usuario.id)
    : (esMaterialDeRollo(material) && !b.rolloId)
      ? await inv.registrarSalidaAutomatica(datosMovimiento, req.usuario.id)
      : await inv.registrarMovimiento(datosMovimiento, req.usuario.id);

  log.info('merma registrada', {
    material: material.codigo, cantidad: b.cantidad, motivo: b.motivo,
    por: req.usuario.usuario,
  });

  res.status(201).json(resultado);
});

/** Ajuste = resultado de un conteo físico. Si hay diferencia, exige quien autoriza. */
const ajuste = asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.materialId || b.conteo === undefined || b.conteo === null || !b.fecha || !b.quien) {
    throw new HttpError(400, 'Material, cantidad contada, fecha y quién contó son obligatorios.');
  }
  const material = await materialOrThrow(b.materialId);
  // Las láminas se cuentan una por una (pestaña Láminas): un ajuste del total
  // cambiaría la existencia sin decir a qué lámina le falta o le sobra.
  if (lam.esMaterialDeLamina(material)) {
    throw new HttpError(
      409,
      `${material.codigo} se maneja por láminas: el conteo se hace lámina por lámina en la pestaña Láminas ` +
      '(Corregir, Eliminar o Registrar láminas existentes).'
    );
  }

  const conteo = inv.round4(numero(b.conteo, 'la cantidad contada', { min: 0 }));
  const fecha = fechaValida(b.fecha);

  // TODO el ajuste ocurre dentro de una sola transacción, con el material
  // bloqueado: antes se calculaba la diferencia por fuera y, si mientras
  // tanto alguien registraba una salida (o se hacía doble clic), el conteo
  // terminaba restando de más.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SELECT id FROM materiales WHERE id = ? FOR UPDATE', [material.id]);

    const conocida = await inv.esConocida(conn, material.id);
    const existenciaActual = await inv.calcularExistencia(conn, material.id);

    if (!conocida) {
      const resultado = await inv.registrarMovimiento(
        {
          materialId: material.id, tipo: 'AJUSTE', cantidad: conteo, fecha, quien: b.quien,
          // Contar y que dé cero también es confirmar (antes se rechazaba y
          // el material se quedaba "por medir" para siempre).
          permitirCero: true,
        },
        req.usuario.id,
        conn
      );
      await conn.commit();
      return res.status(201).json({ ...resultado, mensaje: 'Existencia inicial confirmada.' });
    }

    // Rollos: el conteo no puede quedar por debajo de lo que suman los rollos
    // medidos. Si faltan pies, es porque un rollo tiene menos de lo que dice
    // el sistema (o ya no existe), y eso se corrige en ESE rollo; si no, la
    // existencia y los rollos quedan diciendo cosas distintas.
    if (esMaterialDeRollo(material)) {
      const enRollos = await inv.sumaRestantesRollos(conn, material.id);
      if (conteo < enRollos - 0.0005) {
        throw new HttpError(
          409,
          `El conteo (${conteo}) es menor que lo que suman los rollos medidos (${enRollos}). ` +
          'Corrige el largo del rollo que tiene menos en Rollos → Editar, o elimina el que ya no existe.'
        );
      }
    }

    const diferencia = inv.round4(conteo - existenciaActual);
    if (diferencia === 0) {
      await conn.commit();
      return res.json({ ok: true, diferencia: 0, mensaje: 'Sin diferencia. Existencia confirmada.' });
    }
    if (!b.autoriza) {
      throw new HttpError(
        400,
        `Diferencia de ${diferencia > 0 ? '+' : ''}${diferencia}. Se requiere el nombre de quien autoriza el ajuste.`
      );
    }

    const resultado = await inv.registrarMovimiento(
      {
        materialId: material.id, tipo: 'AJUSTE', cantidad: diferencia, fecha,
        motivo: b.motivo || (diferencia < 0 ? 'FALTANTE' : 'SOBRANTE'),
        quien: b.quien, autoriza: b.autoriza, observaciones: b.observaciones,
      },
      req.usuario.id,
      conn
    );
    await conn.commit();
    res.status(201).json({ ...resultado, diferencia });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ---------------------------------------------------------------------------
// Historial de movimientos
// ---------------------------------------------------------------------------

/** Arma el WHERE compartido por el listado y por el resumen, con los mismos filtros. */
function construirFiltros(query) {
  const { materialId, categoriaId, tipo, areaId, bodegaId, rolloId, desde, hasta, q, ot, proveedorId } = query;
  const cond = [];
  const params = [];

  if (materialId) { cond.push('mv.material_id = ?'); params.push(materialId); }
  if (categoriaId) { cond.push('m.categoria_id = ?'); params.push(categoriaId); }
  if (tipo) { cond.push('mv.tipo = ?'); params.push(tipo); }
  if (areaId) { cond.push('mv.area_id = ?'); params.push(areaId); }
  if (bodegaId) { cond.push('mv.bodega_id = ?'); params.push(bodegaId); }
  if (rolloId) { cond.push('mv.rollo_id = ?'); params.push(rolloId); }
  if (query.laminaId) { cond.push('mv.lamina_id = ?'); params.push(query.laminaId); }
  if (query.id) { cond.push('mv.id = ?'); params.push(Math.floor(Number(query.id)) || 0); }
  if (ot) { cond.push('mv.ot = ?'); params.push(ot); }
  if (proveedorId) { cond.push('mv.proveedor_id = ?'); params.push(proveedorId); }

  // Por omisión el resumen y los totales NO cuentan lo anulado ni sus
  // contra-movimientos: sumarlos daría números que no cuadran con la
  // existencia. Con incluirAnulados=1 se ven todos (para auditar).
  if (query.incluirAnulados !== '1' && query.incluirAnulados !== 'true') {
    cond.push('mv.anulado = FALSE');
    cond.push('mv.anula_movimiento_id IS NULL');
  }
  if (desde) { cond.push('mv.fecha >= ?'); params.push(desde); }
  if (hasta) { cond.push('mv.fecha <= ?'); params.push(hasta); }

  // Búsqueda libre: código o descripción del material, motivo, OT, cliente,
  // proyecto, rollo, el nombre de quien lo registró, el N° de factura o
  // cotización, o el nombre del proveedor.
  if (q && String(q).trim()) {
    const like = `%${String(q).trim()}%`;
    cond.push(`(m.codigo LIKE ? OR m.descripcion LIKE ? OR mv.motivo LIKE ?
                OR mv.ot LIKE ? OR mv.cliente LIKE ? OR mv.proyecto LIKE ?
                OR mv.rollo_id LIKE ? OR mv.lamina_id LIKE ? OR mv.quien LIKE ?
                OR mv.documento_numero LIKE ? OR mv.cotizacion LIKE ?
                OR mv.proveedor_id IN (SELECT id FROM proveedores WHERE nombre LIKE ?))`);
    params.push(like, like, like, like, like, like, like, like, like, like, like, like);
  }

  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

/**
 * Historial de movimientos, paginado.
 *
 * Antes cortaba en 500 filas sin avisar: el usuario creía estar viendo todo
 * cuando no era así. Ahora devuelve la página pedida y cuántos hay en total,
 * para que la pantalla pueda decir "mostrando 1-100 de 3.482".
 */
const listar = asyncHandler(async (req, res) => {
  const { where, params } = construirFiltros(req.query);

  const porPagina = Math.min(Math.max(Math.floor(Number(req.query.porPagina)) || 100, 1), 1000);
  // Tope razonable: un número de página gigante (1e20) armaba un OFFSET que
  // la base de datos no entiende
  const pagina = Math.min(Math.max(Math.floor(Number(req.query.pagina)) || 1, 1), 1000000);
  const salto = (pagina - 1) * porPagina;

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM movimientos mv
     JOIN materiales m ON m.id = mv.material_id
     ${where}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT mv.*, m.codigo AS material_codigo, m.descripcion AS material_descripcion,
            m.costo AS costo_actual_material,
            u.codigo AS unidad_codigo, a.nombre AS area_nombre, b.nombre AS bodega_nombre,
            p.nombre AS proveedor_nombre,
            us.nombre AS registrado_por,
            ua.nombre AS anulado_por
     FROM movimientos mv
     JOIN materiales m ON m.id = mv.material_id
     JOIN unidades_medida u ON u.id = mv.unidad_id
     LEFT JOIN areas a ON a.id = mv.area_id
     LEFT JOIN bodegas b ON b.id = mv.bodega_id
     LEFT JOIN proveedores p ON p.id = mv.proveedor_id
     LEFT JOIN usuarios us ON us.id = mv.usuario_id
     LEFT JOIN usuarios ua ON ua.id = mv.anulado_por_usuario_id
     ${where}
     ORDER BY mv.fecha DESC, mv.id DESC
     LIMIT ${porPagina} OFFSET ${salto}`,
    params
  );

  res.json({
    movimientos: rows,
    pagina,
    porPagina,
    total,
    totalPaginas: Math.max(Math.ceil(total / porPagina), 1),
  });
});

/**
 * Resumen agrupado por material y tipo, con EXACTAMENTE los mismos filtros
 * que el listado. Es lo que responde "¿cuánta merma hubo de cada material?":
 *
 *   GET /api/movimientos/resumen?tipo=MERMA&desde=2026-01-01&hasta=2026-12-31
 *
 * Se calcula en la base de datos (SUM), así que el total es de TODO lo que
 * cumple el filtro, no solo de las filas que alcanzaron a mostrarse en pantalla.
 */
const resumen = asyncHandler(async (req, res) => {
  // Los totales SIEMPRE excluyen lo anulado, aunque el listado de abajo los
  // esté mostrando. Un movimiento anulado y su contra-movimiento sumarían el
  // doble de algo que en realidad nunca pasó: el total diría que salieron 500
  // pies cuando no salió ninguno. Para auditar están la lista y el CSV.
  const { where, params } = construirFiltros({ ...req.query, incluirAnulados: undefined });

  const [porMaterial] = await pool.query(
    `SELECT mv.material_id, mv.tipo,
            m.codigo AS material_codigo, m.descripcion AS material_descripcion,
            u.codigo AS unidad_codigo,
            COUNT(*) AS registros,
            SUM(mv.cantidad) AS total,
            SUM(mv.cantidad * COALESCE(mv.costo_unitario, m.costo)) AS valor,
            SUM(CASE WHEN COALESCE(mv.costo_unitario, m.costo) IS NULL THEN 1 ELSE 0 END) AS sin_costo
     FROM movimientos mv
     JOIN materiales m ON m.id = mv.material_id
     JOIN unidades_medida u ON u.id = mv.unidad_id
     ${where}
     GROUP BY mv.material_id, mv.tipo, m.codigo, m.descripcion, u.codigo
     ORDER BY total DESC, m.codigo`,
    params
  );

  const [porTipo] = await pool.query(
    `SELECT mv.tipo, COUNT(*) AS registros, SUM(mv.cantidad) AS total,
            SUM(mv.cantidad * COALESCE(mv.costo_unitario, m.costo)) AS valor
     FROM movimientos mv
     JOIN materiales m ON m.id = mv.material_id
     ${where}
     GROUP BY mv.tipo`,
    params
  );

  // Compras por proveedor: cuánto se le compró a cada uno en el período
  // filtrado. Con el filtro de un mes responde "¿cuánto le gastamos a cada
  // proveedor en septiembre?". Solo cuenta ENTRADAS.
  const [porProveedor] = await pool.query(
    `SELECT mv.proveedor_id, p.nombre AS proveedor_nombre,
            COUNT(*) AS registros,
            COUNT(DISTINCT mv.documento_numero) AS documentos,
            SUM(mv.cantidad * COALESCE(mv.costo_unitario, m.costo)) AS valor,
            SUM(CASE WHEN COALESCE(mv.costo_unitario, m.costo) IS NULL THEN 1 ELSE 0 END) AS sin_costo
     FROM movimientos mv
     JOIN materiales m ON m.id = mv.material_id
     LEFT JOIN proveedores p ON p.id = mv.proveedor_id
     ${where ? `${where} AND` : 'WHERE'} mv.tipo = 'ENTRADA'
     GROUP BY mv.proveedor_id, p.nombre
     ORDER BY (mv.proveedor_id IS NULL), valor DESC, p.nombre`,
    params
  );

  res.json({ porMaterial, porTipo, porProveedor });
});

// ---------------------------------------------------------------------------
// Anular un movimiento (solo administradores)
//
// Nunca se borra nada. El movimiento original se marca como anulado y se
// crea un contra-movimiento que apunta a él. Los dos quedan a la vista en el
// histórico, y los cálculos ignoran ambos.
//
// Opción: PASAR A MERMA. Una salida (o una merma con el motivo equivocado)
// se anula y en la misma operación se registra como merma, con su motivo y
// observación. La existencia queda igual — el material sigue fuera — pero
// ahora cuenta como material perdido, que es lo que fue.
// ---------------------------------------------------------------------------
const TIPOS_QUE_PASAN_A_MERMA = ['SALIDA', 'MERMA'];

const anular = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const motivo = String(req.body.motivo ?? '').trim();
  const pasarAMerma = req.body.pasarAMerma === true;
  const motivoMerma = String(req.body.motivoMerma ?? '').trim();

  if (!motivo) {
    throw new HttpError(400, 'Hay que escribir por qué se anula el movimiento.');
  }
  if (pasarAMerma && !motivoMerma) {
    throw new HttpError(400, 'Para pasarlo a merma hay que elegir el motivo de la merma.');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[original]] = await conn.query('SELECT * FROM movimientos WHERE id = ? FOR UPDATE', [id]);
    if (!original) throw new HttpError(404, 'Movimiento no encontrado.');
    if (original.anulado) throw new HttpError(409, 'Ese movimiento ya estaba anulado.');
    if (original.anula_movimiento_id) {
      throw new HttpError(409, 'Ese registro es la anulación de otro movimiento; no se puede anular una anulación.');
    }
    if (pasarAMerma && !TIPOS_QUE_PASAN_A_MERMA.includes(original.tipo)) {
      throw new HttpError(
        400,
        `Un movimiento de tipo ${original.tipo} no se puede pasar a merma. ` +
        'Solo las salidas y las mermas: son las que ya sacaron material de bodega.'
      );
    }

    await conn.query('SELECT id FROM materiales WHERE id = ? FOR UPDATE', [original.material_id]);

    // Cómo cuadran HOY la existencia y los rollos, para comparar al final:
    // anular no puede empeorar el cuadre (pero si ya venía descuadrado por
    // otra cosa, tampoco se bloquea algo que no lo toca).
    const [[matAnular]] = await conn.query(
      `SELECT u.codigo AS unidad_codigo FROM materiales mat
       JOIN unidades_medida u ON u.id = mat.unidad_id WHERE mat.id = ?`,
      [original.material_id]
    );
    const esDeRollos = !!matAnular && esMaterialDeRollo(matAnular);
    const cuadreRollos = async () => inv.round4(
      (await inv.calcularExistencia(conn, original.material_id))
      - (await inv.sumaRestantesRollos(conn, original.material_id))
    );
    const sinRolloAntes = esDeRollos ? await cuadreRollos() : 0;

    // Una ENTRADA que creó un rollo: al anularla, el rollo también tiene que
    // desaparecer. Si no, la existencia baja pero el rollo sigue ahí con todo
    // su largo, y el sistema dice que hay material en rollos que ya no existe
    // (y hasta deja sacar de él).
    // Si ese rollo ya se usó (salidas, mermas, medidas corregidas), no se
    // puede anular así nomás: primero hay que anular esos movimientos.
    let rolloDadoDeBaja = null;
    if (original.rollo_id) {
      const [[rollo]] = await conn.query('SELECT * FROM rollos WHERE id = ?', [original.rollo_id]);
      const creoElRollo = original.tipo === 'ENTRADA' || original.motivo === 'Alta de rollo existente';

      if (rollo && creoElRollo) {
        // Se miran TODOS los movimientos del rollo, esté activo o no: si el
        // rollo ya se eliminó, esa eliminación ya descontó su restante, y
        // anular además la entrada descontaba el material dos veces.
        const [otros] = await conn.query(
          `SELECT id, tipo, motivo FROM movimientos
           WHERE rollo_id = ? AND id <> ? AND anulado = FALSE AND anula_movimiento_id IS NULL
           ORDER BY id`,
          [original.rollo_id, original.id]
        );
        if (otros.length) {
          throw new HttpError(
            409,
            `Este movimiento creó el rollo ${original.rollo_id}, y ese rollo ya tiene ` +
            `${otros.length} movimiento(s) después (${otros.map((o) => `#${o.id} ${(o.motivo || o.tipo).toLowerCase()}`).join(', ')}). ` +
            'Anula primero esos movimientos y después este.'
          );
        }
        if (rollo.activo) {
          await conn.query('UPDATE rollos SET activo = FALSE WHERE id = ?', [original.rollo_id]);
          rolloDadoDeBaja = original.rollo_id;
        }
      } else if (rollo && /^Rollo eliminado/.test(original.motivo || '')) {
        // (incluye "Rollo eliminado (sin restante)", la constancia de un rollo que ya no tenía nada)
        // Deshacer la eliminación: el rollo vuelve con lo que le quedaba
        await conn.query('UPDATE rollos SET activo = TRUE WHERE id = ?', [original.rollo_id]);
      } else if (rollo && !rollo.activo) {
        throw new HttpError(
          409,
          `El rollo ${rollo.id} fue eliminado después de este movimiento. ` +
          'Anula primero su eliminación ("Rollo eliminado") y después este movimiento.'
        );
      } else if (rollo && original.tipo === 'AJUSTE' && /^(Medición|Corrección de (largo|medidas|ancho))/.test(original.motivo || '')) {
        // Deshacer una medición o corrección: el rollo vuelve a las medidas
        // que tenía. Desde esta versión la constancia guarda en "medidas" el
        // antes y el después ("Largo: 50 → 60. Ancho: sin definir → 54").
        // En las constancias viejas, que no lo traen, el largo anterior se
        // saca restando lo que movió el ajuste (vale salvo en una primera
        // medición que reconoció material "sin rollo").
        const textoMedidas = original.medidas || '';
        const largoPrevio = textoMedidas.match(/Largo: (sin definir|[-\d.]+) →/);
        const anchoPrevio = textoMedidas.match(/Ancho: (sin definir|[-\d.]+) →/);
        const cambiaLargo = largoPrevio || /^(Medición|Corrección de (largo|medidas))/.test(original.motivo || '');

        if (cambiaLargo) {
          const largoAnterior = largoPrevio
            ? (largoPrevio[1] === 'sin definir' ? null : Number(largoPrevio[1]))
            : inv.round4(Number(rollo.largo || 0) - Number(original.cantidad));
          const usado = inv.round4(Number(rollo.largo || 0) - (await inv.calcularRestanteRollo(conn, original.rollo_id) || 0));
          if ((largoAnterior || 0) < usado - 0.0001) {
            throw new HttpError(
              409,
              `Después de esa medición ya salieron ${usado} de ese rollo: deshacerla lo dejaría en negativo. ` +
              'Anula primero esas salidas.'
            );
          }
          if (largoAnterior == null || largoAnterior <= 0.0001) {
            await conn.query(
              "UPDATE rollos SET largo = NULL, estado = 'POR_CONFIRMAR', precision_medida = 'POR_CONFIRMAR' WHERE id = ?",
              [original.rollo_id]
            );
          } else {
            await conn.query('UPDATE rollos SET largo = ? WHERE id = ?', [largoAnterior, original.rollo_id]);
          }
        }
        if (anchoPrevio) {
          await conn.query('UPDATE rollos SET ancho = ? WHERE id = ?', [
            anchoPrevio[1] === 'sin definir' ? null : Number(anchoPrevio[1]), original.rollo_id,
          ]);
        }
      }
    }

    // Lo mismo con las LÁMINAS: una entrada (o un alta de láminas existentes)
    // que creó láminas se lleva esas láminas al anularse. Si alguna ya se
    // cortó, primero hay que anular esos cortes.
    //
    // Se miran TODAS las láminas que creó, también las ya eliminadas: si una
    // se eliminó, su eliminación es un movimiento hecho en ella y bloquea
    // (si no, se descontaría dos veces).
    const esDeLaminas = await materialEsDeLamina(conn, original.material_id);
    const sinLaminaAntes = esDeLaminas ? await lam.stockSinLamina(conn, original.material_id) : 0;

    const [laminasDelMovimiento] = await conn.query(
      'SELECT id, activo FROM laminas WHERE movimiento_origen_id = ?',
      [original.id]
    );
    let laminasDadasDeBaja = [];
    if (laminasDelMovimiento.length) {
      const ids = laminasDelMovimiento.map((l) => l.id);
      const [usadas] = await conn.query(
        `SELECT id, tipo, lamina_id FROM movimientos
         WHERE lamina_id IN (?) AND anulado = FALSE AND anula_movimiento_id IS NULL
         ORDER BY id`,
        [ids]
      );
      if (usadas.length) {
        throw new HttpError(
          409,
          `Este movimiento creó ${ids.length} lámina(s), y ya hay movimientos hechos en ellas ` +
          `(${usadas.map((u) => `#${u.id} ${u.tipo.toLowerCase()} en ${u.lamina_id}`).join(', ')}). ` +
          'Anula primero esos movimientos y después este.'
        );
      }
      await conn.query('UPDATE laminas SET activo = FALSE WHERE id IN (?)', [ids]);
      laminasDadasDeBaja = ids;
    }

    // Movimientos hechos EN una lámina: al anularlos, la lámina tiene que
    // quedar como estaba antes de ese movimiento.
    if (original.lamina_id) {
      const [[lamina]] = await conn.query('SELECT * FROM laminas WHERE id = ?', [original.lamina_id]);
      if (lamina) {
        if (original.motivo === 'Lámina eliminada') {
          // Deshacer la eliminación: la lámina vuelve, con lo que le quedaba
          await conn.query('UPDATE laminas SET activo = TRUE WHERE id = ?', [lamina.id]);
        } else if (!lamina.activo) {
          throw new HttpError(
            409,
            `La lámina ${lamina.id} fue eliminada después de este movimiento. ` +
            'Anula primero su eliminación ("Lámina eliminada") y después este movimiento.'
          );
        } else if (original.motivo === 'Corrección de lámina') {
          // La corrección cambió el tamaño de la lámina: se devuelve
          const restante = await inv.calcularRestanteLamina(conn, lamina.id);
          if (restante - Number(original.cantidad) < -0.0005) {
            throw new HttpError(
              409,
              `Después de esa corrección ya se cortó de la lámina ${lamina.id}: deshacerla la dejaría en negativo. ` +
              'Anula primero esos cortes.'
            );
          }
          await conn.query('UPDATE laminas SET tamano = tamano - ? WHERE id = ?', [original.cantidad, lamina.id]);
        } else if (original.motivo === 'Lámina pasa a retazos') {
          await conn.query('UPDATE laminas SET terminada = FALSE WHERE id = ?', [lamina.id]);
        }
      }
    }

    const fechaOriginal = csv.fecha(original.fecha);

    // 1) El contra-movimiento: constancia visible, no cuenta para nada
    const [result] = await conn.query(
      `INSERT INTO movimientos
        (material_id, tipo, cantidad, unidad_id, fecha, rollo_id, motivo,
         descuenta, quien, autoriza, observaciones, usuario_id, anula_movimiento_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        original.material_id, original.tipo, original.cantidad, original.unidad_id,
        csv.fecha(new Date()), original.rollo_id,
        pasarAMerma
          ? `Reclasificado como merma (movimiento #${original.id})`
          : `Anulación del movimiento #${original.id}`,
        false, req.usuario.nombre, req.usuario.nombre,
        `Anula el movimiento #${original.id} (${original.tipo} de ${original.cantidad} del ${fechaOriginal}). Motivo: ${motivo}`,
        req.usuario.id, original.id,
      ]
    );

    // 2) El original queda marcado. Tiene que ir ANTES de registrar la merma:
    //    así el material y el rollo recuperan esa cantidad y la merma cabe.
    await conn.query(
      `UPDATE movimientos
          SET anulado = TRUE, anulado_por_usuario_id = ?, anulado_en = NOW(), motivo_anulacion = ?
        WHERE id = ?`,
      [req.usuario.id, motivo, original.id]
    );

    // 3) Si hay que pasarlo a merma, se registra con los datos del original:
    //    misma fecha (la pérdida ocurrió ese día), mismo rollo, misma cantidad.
    let mermaId = null;
    if (pasarAMerma) {
      const r = await inv.registrarMovimiento(
        {
          materialId: original.material_id, tipo: 'MERMA', cantidad: original.cantidad,
          unidadId: original.unidad_id, fecha: fechaOriginal, rolloId: original.rollo_id,
          laminaId: original.lamina_id, medidas: original.medidas,
          motivo: motivoMerma, ot: original.ot, cliente: original.cliente,
          areaId: original.area_id, bodegaId: original.bodega_id,
          costoUnitario: original.costo_unitario,
          quien: original.quien || req.usuario.nombre,
          autoriza: req.usuario.nombre,
          forzadoNegativo: false,
          observaciones: String(req.body.observacionesMerma ?? '').trim()
            || `Reclasificado desde el movimiento #${original.id} (${original.tipo}).`,
        },
        req.usuario.id,
        conn
      );
      mermaId = r.movimientoId;
    } else if (original.rollo_id) {
      // Si el movimiento había dejado el rollo AGOTADO, vuelve a estar disponible
      const restante = await inv.calcularRestanteRollo(conn, original.rollo_id);
      if (restante != null && restante > 0.0001) {
        await conn.query(
          'UPDATE rollos SET estado = "ABIERTO" WHERE id = ? AND estado = "AGOTADO"',
          [original.rollo_id]
        );
      }
    }

    // Red de seguridad para láminas: después de anular, la existencia y lo que
    // hay en las láminas tienen que seguir cuadrando igual que antes. Si no
    // (ej. se anula una entrada vieja cuyas láminas ya se registraron con
    // "Crear las láminas"), no se anula: se explica qué hacer primero.
    // Lo mismo para los rollos: si al anular los rollos quedaran sumando más
    // que la existencia, algo no cuadra y es mejor no hacerlo.
    if (esDeRollos) {
      // Solo se bloquea si ESTA anulación deja los rollos sumando más que la
      // existencia (o lo empeora). Antes se miraba el total: un conteo físico
      // viejo que ya lo había descuadrado bloqueaba cualquier anulación.
      const sinRolloDespues = await cuadreRollos();
      if (sinRolloDespues < -0.0005 && sinRolloDespues < sinRolloAntes - 0.0005) {
        throw new HttpError(
          409,
          'Anular este movimiento dejaría los rollos sumando más material del que quedaría en existencia. ' +
          'Revisa primero el rollo en la pestaña Rollos (corrige su largo o elimínalo).'
        );
      }
    }

    if (esDeLaminas) {
      const sinLaminaDespues = await lam.stockSinLamina(conn, original.material_id);
      const cambio = inv.round4(sinLaminaDespues - sinLaminaAntes);
      const devuelveLoContado = laminasDadasDeBaja.length > 0 && cambio >= -0.0005;
      if ((sinLaminaDespues < -0.0005 && cambio < -0.0005) || (!devuelveLoContado && Math.abs(cambio) > 0.0005)) {
        throw new HttpError(
          409,
          'Anular este movimiento dejaría la existencia descuadrada con las láminas registradas ' +
          `(${cambio > 0 ? 'sobraría' : 'faltaría'} ${lam.textoCantidad(Math.abs(cambio))} en las láminas). ` +
          'Corrige o elimina primero la lámina que corresponde en la pestaña Láminas.'
        );
      }
    }

    const existencia = await inv.calcularExistencia(conn, original.material_id);
    await conn.commit();

    log.info(pasarAMerma ? 'movimiento pasado a merma' : 'movimiento anulado', {
      movimiento: original.id, tipo: original.tipo, cantidad: String(original.cantidad),
      merma: mermaId, rolloDadoDeBaja, laminasDadasDeBaja, por: req.usuario.usuario, motivo,
    });

    res.status(201).json({
      ok: true,
      anulado: original.id,
      contraMovimientoId: result.insertId,
      mermaId,
      existencia,
      rolloDadoDeBaja,
      laminasDadasDeBaja,
      mensaje: pasarAMerma
        ? `Movimiento #${original.id} pasado a merma (#${mermaId}), motivo "${motivoMerma}". La existencia quedó igual: ${existencia}.`
        : `Movimiento #${original.id} anulado. La existencia quedó en ${existencia}.` +
          (rolloDadoDeBaja ? ` El rollo ${rolloDadoDeBaja} que había creado esa entrada se dio de baja.` : '') +
          (laminasDadasDeBaja.length ? ` Se dieron de baja las láminas que había creado: ${laminasDadasDeBaja.join(', ')}.` : ''),
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ---------------------------------------------------------------------------
// Exportar a CSV — respeta exactamente los mismos filtros que el listado
// ---------------------------------------------------------------------------
/**
 * Nombre del archivo según lo filtrado, para que al abrirlo se sepa de qué es:
 *   movimientos_2026-09.csv                    (un mes completo)
 *   movimientos_entrada_3m-panama_2026-09.csv  (compras a un proveedor en el mes)
 *   movimientos_2026-09-05_a_2026-09-20.csv    (un rango cualquiera)
 */
async function nombreDeExportacion(query) {
  const partes = ['movimientos'];
  // Solo valores conocidos: lo que llega en la URL no se mete tal cual en el nombre del archivo
  if (['ENTRADA', 'SALIDA', 'MERMA', 'AJUSTE'].includes(query.tipo)) partes.push(query.tipo.toLowerCase());
  if (query.proveedorId) {
    const [[p]] = await pool.query('SELECT nombre FROM proveedores WHERE id = ?', [query.proveedorId]);
    if (p) {
      const limpio = p.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (limpio) partes.push(limpio);
    }
  }

  const { desde, hasta } = query;
  const esFecha = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f || '');
  if (esFecha(desde) && esFecha(hasta)) {
    const [a, m] = desde.split('-').map(Number);
    const ultimoDia = new Date(a, m, 0).getDate();
    const mesCompleto = desde.endsWith('-01') && hasta.slice(0, 7) === desde.slice(0, 7)
      && Number(hasta.slice(8)) === ultimoDia;
    partes.push(mesCompleto ? desde.slice(0, 7) : `${desde}_a_${hasta}`);
  } else if (esFecha(desde)) {
    partes.push(`desde_${desde}`);
  } else if (esFecha(hasta)) {
    partes.push(`hasta_${hasta}`);
  } else {
    partes.push(`al_${csv.fecha(new Date())}`);
  }
  return partes.join('_');
}

const exportarCsv = asyncHandler(async (req, res) => {
  const { where, params } = construirFiltros(req.query);

  const [rows] = await pool.query(
    `SELECT mv.*, m.codigo AS material_codigo, m.descripcion AS material_descripcion,
            m.costo AS costo_actual_material,
            u.codigo AS unidad_codigo, a.nombre AS area_nombre, b.nombre AS bodega_nombre,
            p.nombre AS proveedor_nombre,
            us.nombre AS registrado_por
     FROM movimientos mv
     JOIN materiales m ON m.id = mv.material_id
     JOIN unidades_medida u ON u.id = mv.unidad_id
     LEFT JOIN areas a ON a.id = mv.area_id
     LEFT JOIN bodegas b ON b.id = mv.bodega_id
     LEFT JOIN proveedores p ON p.id = mv.proveedor_id
     LEFT JOIN usuarios us ON us.id = mv.usuario_id
     ${where}
     ORDER BY mv.fecha DESC, mv.id DESC`,
    params
  );

  const nombreArchivo = await nombreDeExportacion(req.query);
  log.info('exportación de movimientos', { filas: rows.length, archivo: nombreArchivo, por: req.usuario.usuario });

  csv.responder(res, 'movimientos', [
    { titulo: 'N°', clave: 'id' },
    { titulo: 'Fecha', valor: (r) => csv.fecha(r.fecha) },
    { titulo: 'Tipo', clave: 'tipo' },
    { titulo: 'Código', clave: 'material_codigo' },
    { titulo: 'Material', clave: 'material_descripcion' },
    { titulo: 'Cantidad', clave: 'cantidad' },
    { titulo: 'Unidad', clave: 'unidad_codigo' },
    { titulo: 'Descuenta', valor: (r) => (r.descuenta ? 'Sí' : 'No') },
    // Láminas: la cantidad va en láminas de 4x8; aquí también en pies²
    { titulo: 'Pies²', valor: (r) => (r.unidad_codigo === 'LAMINA' ? lam.aPies2(r.cantidad) : '') },
    { titulo: 'Rollo', clave: 'rollo_id' },
    { titulo: 'Lámina', clave: 'lamina_id' },
    { titulo: 'Medidas', clave: 'medidas' },
    { titulo: 'Detalle', clave: 'movimiento_detalle' },
    { titulo: 'Proveedor', clave: 'proveedor_nombre' },
    { titulo: 'Documento', valor: (r) => (r.documento_tipo ? LEGIBLES_DOCUMENTO[r.documento_tipo] || r.documento_tipo : '') },
    { titulo: 'N° documento', clave: 'documento_numero' },
    { titulo: 'OT', clave: 'ot' },
    { titulo: 'Cotización', clave: 'cotizacion' },
    { titulo: 'Cliente', clave: 'cliente' },
    { titulo: 'Proyecto', clave: 'proyecto' },
    { titulo: 'Área', clave: 'area_nombre' },
    { titulo: 'Bodega', clave: 'bodega_nombre' },
    { titulo: 'Motivo', clave: 'motivo' },
    // Costo del día del movimiento si se guardó; si no (movimientos viejos),
    // el costo actual del material, y se marca de dónde salió.
    { titulo: 'Costo por unidad', valor: (r) => (r.costo_unitario ?? r.costo_actual_material ?? '') },
    { titulo: 'Origen del costo', valor: (r) => (r.costo_unitario != null ? 'del día'
        : r.costo_actual_material != null ? 'costo actual' : 'sin costo') },
    { titulo: 'Costo total', valor: (r) => {
        const c = r.costo_unitario ?? r.costo_actual_material;
        return c == null ? '' : inv.round4(Number(r.cantidad) * Number(c));
      } },
    { titulo: 'Quién', clave: 'quien' },
    { titulo: 'Entrega', clave: 'entrega' },
    { titulo: 'Autoriza', clave: 'autoriza' },
    { titulo: 'Anulado', valor: (r) => (r.anulado ? 'Sí' : 'No') },
    { titulo: 'Anula al N°', clave: 'anula_movimiento_id' },
    { titulo: 'Observaciones', clave: 'observaciones' },
    { titulo: 'Registrado por', clave: 'registrado_por' },
    { titulo: 'Registrado el', valor: (r) => csv.fecha(r.created_at) },
  ], rows, nombreArchivo);
});

// ---------------------------------------------------------------------------
// Completar o corregir el proveedor y el documento de una ENTRADA ya hecha.
//
// Solo toca esos tres datos: no mueve cantidades ni costos, así que no afecta
// la existencia. Sirve para las entradas que se registraron antes de que
// existieran estos campos, o cuando la factura llega días después.
// El cambio queda anotado en las observaciones del movimiento, con nombre y
// fecha, para que se sepa quién lo cambió.
// ---------------------------------------------------------------------------
const actualizarDocumento = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [[mv]] = await pool.query(
    `SELECT mv.*, p.nombre AS proveedor_nombre
     FROM movimientos mv LEFT JOIN proveedores p ON p.id = mv.proveedor_id
     WHERE mv.id = ?`,
    [id]
  );
  if (!mv) throw new HttpError(404, 'Movimiento no encontrado.');
  if (mv.tipo !== 'ENTRADA') {
    throw new HttpError(400, 'El proveedor y la factura solo se registran en las entradas.');
  }
  if (mv.anulado || mv.anula_movimiento_id) {
    throw new HttpError(409, 'Ese movimiento está anulado; no se le cambian datos.');
  }

  const nuevo = await leerDocumento(req.body);
  const [[prov]] = nuevo.proveedorId
    ? await pool.query('SELECT nombre FROM proveedores WHERE id = ?', [nuevo.proveedorId])
    : [[null]];

  const describir = (nombreProveedor, tipo, numero) =>
    `proveedor ${nombreProveedor || '—'}, ${numero ? `${LEGIBLES_DOCUMENTO[tipo] || 'Documento'} ${numero}` : 'sin documento'}`;
  const antes = describir(mv.proveedor_nombre, mv.documento_tipo, mv.documento_numero);
  const despues = describir(prov && prov.nombre, nuevo.documentoTipo, nuevo.documentoNumero);

  if (antes === despues) {
    return res.json({ ok: true, sinCambios: true, mensaje: 'No hubo cambios.' });
  }

  const nota = `[${csv.fecha(new Date())} · ${req.usuario.nombre}] Antes: ${antes}. Ahora: ${despues}.`;
  await pool.query(
    `UPDATE movimientos
        SET proveedor_id = ?, documento_tipo = ?, documento_numero = ?,
            observaciones = CONCAT_WS('\n', NULLIF(observaciones, ''), ?)
      WHERE id = ?`,
    [nuevo.proveedorId, nuevo.documentoTipo, nuevo.documentoNumero, nota, id]
  );

  log.info('documento de entrada actualizado', { movimiento: Number(id), antes, despues, por: req.usuario.usuario });
  res.json({ ok: true, mensaje: 'Proveedor y documento actualizados.' });
});

module.exports = {
  entrada, salida, merma, ajuste, listar, resumen, anular, exportarCsv, actualizarDocumento,
};
