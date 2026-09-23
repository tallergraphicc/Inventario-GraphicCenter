const pool = require('../config/db');
const { HttpError } = require('../middleware/errorHandler');

/** Redondea a 4 decimales, igual que el sistema original (evita arrastre de punto flotante). */
function round4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

/**
 * Calcula la existencia de un material a partir de su inventario_inicial
 * más TODOS sus movimientos. Debe ejecutarse dentro de una conexión que
 * ya tiene el FOR UPDATE sobre el material cuando se usa para escribir.
 *
 * Fórmula: inicial + entradas - salidas - mermas(que descuentan) + ajustes
 */
async function calcularExistencia(conn, materialId) {
  const [[material]] = await conn.query(
    'SELECT inventario_inicial FROM materiales WHERE id = ?',
    [materialId]
  );
  if (!material) throw new HttpError(404, 'Material no encontrado.');

  // Los movimientos anulados y sus contra-movimientos NO entran en la cuenta:
  // la existencia queda como si el movimiento mal registrado nunca hubiera
  // ocurrido. Los dos siguen visibles en el histórico, que nunca se borra.
  const [movs] = await conn.query(
    `SELECT tipo, cantidad, descuenta FROM movimientos
     WHERE material_id = ? AND anulado = FALSE AND anula_movimiento_id IS NULL`,
    [materialId]
  );

  let total = material.inventario_inicial != null ? Number(material.inventario_inicial) : 0;
  for (const v of movs) {
    if (v.tipo === 'ENTRADA') total += Number(v.cantidad);
    else if (v.tipo === 'SALIDA') total -= Number(v.cantidad);
    else if (v.tipo === 'MERMA') { if (v.descuenta) total -= Number(v.cantidad); }
    else if (v.tipo === 'AJUSTE') total += Number(v.cantidad);
  }
  return round4(total);
}

/**
 * ¿Se conoce la existencia de este material? (tiene inicial o al menos un
 * movimiento que de verdad mueve la existencia).
 *
 * Solo cuentan los movimientos con descuenta = TRUE. Las MERMAS, que desde
 * ahora quedan registradas pero NO descuentan, son un apunte informativo:
 * que exista una merma no significa que alguien ya haya medido el material.
 */
async function esConocida(conn, materialId) {
  const [[material]] = await conn.query(
    'SELECT inventario_inicial FROM materiales WHERE id = ?',
    [materialId]
  );
  if (material && material.inventario_inicial != null) return true;
  const [[{ n }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM movimientos
     WHERE material_id = ? AND descuenta = TRUE
       AND anulado = FALSE AND anula_movimiento_id IS NULL`,
    [materialId]
  );
  return n > 0;
}

/** Calcula el largo restante de un rollo (nunca se guarda, siempre se deriva). */
async function calcularRestanteRollo(conn, rolloId) {
  const [[rollo]] = await conn.query('SELECT largo FROM rollos WHERE id = ?', [rolloId]);
  if (!rollo || rollo.largo == null) return null;

  const [movs] = await conn.query(
    `SELECT tipo, cantidad, descuenta FROM movimientos
     WHERE rollo_id = ? AND anulado = FALSE AND anula_movimiento_id IS NULL`,
    [rolloId]
  );
  let usado = 0;
  for (const v of movs) {
    if (v.tipo === 'SALIDA') usado += Number(v.cantidad);
    else if (v.tipo === 'MERMA' && v.descuenta) usado += Number(v.cantidad);
  }
  return round4(Number(rollo.largo) - usado);
}

/**
 * Lo que le queda a una lámina, en láminas equivalentes (1 = 4x8 pies).
 * Igual que el rollo: tamaño con el que se registró menos lo que se cortó.
 * Está aquí y no en laminas.service para que registrarMovimiento pueda
 * validarlo sin que los dos archivos se necesiten mutuamente.
 */
async function calcularRestanteLamina(conn, laminaId) {
  const [[lamina]] = await conn.query('SELECT tamano, activo FROM laminas WHERE id = ?', [laminaId]);
  if (!lamina) return null;
  if (!lamina.activo) return 0;
  const [[{ usado }]] = await conn.query(
    `SELECT COALESCE(SUM(cantidad), 0) AS usado FROM movimientos
     WHERE lamina_id = ? AND anulado = FALSE AND anula_movimiento_id IS NULL
       AND (tipo = 'SALIDA' OR (tipo = 'MERMA' AND descuenta = TRUE))`,
    [laminaId]
  );
  return round4(Number(lamina.tamano) - Number(usado));
}

/**
 * Cuánto hay DENTRO de los rollos activos que ya están medidos.
 * Los rollos sin largo no suman: no se sabe cuánto tienen.
 */
async function sumaRestantesRollos(conn, materialId) {
  const [rollos] = await conn.query(
    'SELECT id FROM rollos WHERE material_id = ? AND activo = TRUE AND largo IS NOT NULL',
    [materialId]
  );
  let total = 0;
  for (const r of rollos) {
    const restante = await calcularRestanteRollo(conn, r.id);
    if (restante != null) total += restante;
  }
  return round4(total);
}

/**
 * Existencia que el sistema ya cuenta pero que NO está en ningún rollo medido.
 *
 * Aparece cuando se registra una entrada sin crear el rollo, o cuando se hace
 * un conteo físico del material entero antes de medir sus rollos uno por uno.
 * Ese material existe — el sistema solo no sabe todavía en qué rollo está.
 *
 * Es lo que causó la existencia duplicada: se registraba la compra (entrada
 * de 164 pies, sin rollo) y después, al medir el rollo físico, se volvían a
 * sumar esos mismos 164 pies. Ahora, al medir un rollo por primera vez, se
 * descuenta primero de aquí: "esos 164 pies que no sabíamos dónde estaban,
 * estaban en este rollo".
 */
async function stockSinRollo(conn, materialId) {
  const existencia = await calcularExistencia(conn, materialId);
  const enRollos = await sumaRestantesRollos(conn, materialId);
  return round4(Math.max(0, existencia - enRollos));
}

/**
 * Siguiente ID libre para un rollo de este material: CODIGO-R01, CODIGO-R02...
 * Mira también los rollos eliminados, para no reutilizar un ID que ya tiene
 * historia en Movimientos.
 */
async function siguienteIdRollo(conn, material) {
  const [rows] = await conn.query('SELECT id FROM rollos WHERE material_id = ?', [material.id]);
  let mayor = 0;
  for (const r of rows) {
    const m = String(r.id).match(/-R(\d+)$/i);
    if (m) mayor = Math.max(mayor, Number(m[1]));
  }
  for (let n = mayor + 1; n < mayor + 1000; n++) {
    const candidato = `${material.codigo}-R${String(n).padStart(2, '0')}`;
    const [[existe]] = await conn.query('SELECT id FROM rollos WHERE id = ?', [candidato]);
    if (!existe) return candidato;
  }
  throw new HttpError(500, 'No se pudo generar un ID de rollo libre.');
}

/**
 * ¿Todos los rollos activos de este material ya están medidos?
 * Es decir: existe al menos un rollo activo y NINGUNO se quedó sin largo o
 * con la precisión en "por confirmar". Se usa para sacar al material del
 * estado POR_CONFIRMAR en cuanto sus rollos ya tienen los datos.
 */
async function rollosTodosMedidos(conn, materialId) {
  const [[{ total }]] = await conn.query(
    'SELECT COUNT(*) AS total FROM rollos WHERE material_id = ? AND activo = TRUE',
    [materialId]
  );
  if (!total) return false;

  const [[{ pendientes }]] = await conn.query(
    `SELECT COUNT(*) AS pendientes FROM rollos
     WHERE material_id = ? AND activo = TRUE
       AND (largo IS NULL OR precision_medida = 'POR_CONFIRMAR')`,
    [materialId]
  );
  return pendientes === 0;
}

/** ¿Hay láminas registradas y toda la existencia está dentro de ellas? */
async function existenciaTodaEnLaminas(conn, materialId) {
  const [[{ n, tamanos }]] = await conn.query(
    'SELECT COUNT(*) AS n, COALESCE(SUM(tamano), 0) AS tamanos FROM laminas WHERE material_id = ? AND activo = TRUE',
    [materialId]
  );
  if (!n) return false;
  const [[{ usado }]] = await conn.query(
    `SELECT COALESCE(SUM(mv.cantidad), 0) AS usado
     FROM movimientos mv JOIN laminas l ON l.id = mv.lamina_id
     WHERE l.material_id = ? AND l.activo = TRUE AND mv.anulado = FALSE AND mv.anula_movimiento_id IS NULL
       AND (mv.tipo = 'SALIDA' OR (mv.tipo = 'MERMA' AND mv.descuenta = TRUE))`,
    [materialId]
  );
  const enLaminas = Number(tamanos) - Number(usado);
  const existencia = await calcularExistencia(conn, materialId);
  return existencia - enLaminas <= 0.0001;
}

/**
 * Estado automático de un material, replicando exactamente la lógica
 * del sistema original (estadoMat en bodega_gcp_4.html).
 */
async function calcularEstado(conn, material) {
  const conocida = await esConocida(conn, material.id);
  if (!conocida) return 'POR_MEDIR';

  const esRollo = material.unidad_codigo === 'PIE LINEAL' || material.unidad_codigo === 'METRO LINEAL';

  // "Por confirmar" solo se sostiene mientras de verdad no se sepa la medida.
  // Si es un material por rollo y TODOS sus rollos activos ya tienen largo y
  // una precisión definida (exacto o estimado), la medida ya está confirmada
  // aunque la bandera vieja del material siga diciendo POR_CONFIRMAR — así el
  // estado se corrige solo, sin tener que reeditar material por material.
  if (material.precision_inicial === 'POR_CONFIRMAR') {
    const medidaResueltaPorRollos = esRollo && (await rollosTodosMedidos(conn, material.id));
    // Láminas: si toda la existencia está en láminas registradas una por una,
    // ya se sabe lo que hay (cada lámina es de 4x8 y se sabe cuánto le queda).
    const resueltaPorLaminas = material.unidad_codigo === 'LAMINA'
      && (await existenciaTodaEnLaminas(conn, material.id));
    if (!medidaResueltaPorRollos && !resueltaPorLaminas) return 'POR_CONFIRMAR';
  }

  const existencia = await calcularExistencia(conn, material.id);
  if (existencia < 0) return 'NEGATIVO';

  // "Faltan por medir" solo aplica cuando la existencia calculada da CERO —
  // ahí es cuando de verdad importa si es porque está agotado de verdad, o
  // porque hay un rollo activo sin medir y en realidad no lo sabemos.
  // Si ya hay existencia confirmada (>0), no bloqueamos el estado normal
  // solo porque exista algún rollo viejo sin medir por ahí.
  if (existencia <= 0) {
    if (esRollo) {
      const [rollosPendientes] = await conn.query(
        "SELECT COUNT(*) AS n FROM rollos WHERE material_id = ? AND activo = TRUE AND largo IS NULL",
        [material.id]
      );
      if (rollosPendientes[0].n > 0) return 'FALTAN_POR_MEDIR';
    }
    return 'AGOTADO';
  }

  if (material.stock_minimo != null && existencia <= Number(material.stock_minimo)) return 'CRITICO';
  if (material.stock_minimo != null && existencia <= Number(material.stock_minimo) * 1.5) return 'BAJO';
  if (material.stock_minimo == null) return 'SIN_MINIMO';
  return 'NORMAL';
}

/**
 * Registra un movimiento (ENTRADA, SALIDA, MERMA o AJUSTE) de forma segura:
 * usa una transacción con SELECT ... FOR UPDATE sobre el material para que
 * dos usuarios no puedan pisarse el mismo stock al mismo tiempo.
 *
 * datos = { materialId, tipo, cantidad, unidadId, fecha, rolloId, ... resto de campos }
 * Lanza HttpError si la operación no es válida (existencia insuficiente sin forzar, etc).
 *
 * connExterna (opcional): si quien llama YA tiene una transacción abierta sobre
 * una fila relacionada (ej. un rollo, que tiene llave foránea al material),
 * hay que pasar esa misma conexión aquí — de lo contrario, dos conexiones
 * distintas del mismo request terminan esperándose la una a la otra para
 * siempre (auto-bloqueo). Cuando se pasa connExterna, esta función NO abre,
 * confirma ni cierra la transacción — eso queda a cargo de quien la llamó.
 */
async function registrarMovimiento(datos, usuarioId, connExterna = null) {
  const conn = connExterna || await pool.getConnection();
  const esPropia = !connExterna; // si la transacción es nuestra, la manejamos completa

  try {
    if (esPropia) await conn.beginTransaction();

    // Bloquea la fila del material hasta que termine esta transacción
    const [[material]] = await conn.query(
      'SELECT * FROM materiales WHERE id = ? FOR UPDATE',
      [datos.materialId]
    );
    if (!material) throw new HttpError(404, 'Material no encontrado.');

    const cantidad = round4(datos.cantidad);
    // Los AJUSTES sí pueden ser negativos (un faltante) — solo no pueden ser cero.
    // Entrada/Salida/Merma siempre deben ser positivos.
    if (datos.tipo === 'AJUSTE') {
      // Un ajuste de cero normalmente no tiene sentido. La excepción es cuando
      // la razón de ser del movimiento es dejar constancia de un cambio que no
      // mueve cantidad — por ejemplo corregir el ANCHO de un rollo, que hay que
      // poder ver en Movimientos igual que el largo. Para ese caso se manda
      // permitirCero: true.
      if (cantidad === 0 && !datos.permitirCero) throw new HttpError(400, 'El ajuste no puede ser cero.');
    } else if (!(cantidad > 0)) {
      throw new HttpError(400, 'La cantidad debe ser mayor que cero.');
    }

    const conocida = await esConocida(conn, material.id);
    const existenciaActual = await calcularExistencia(conn, material.id);

    // ¿Este movimiento toca la existencia? Casi siempre sí. El flag descuenta
    // queda para casos puntuales que solo dejan constancia (un traslado, la
    // nota de un rollo eliminado sin restante).
    const afectaExistencia = datos.descuenta !== false;

    // Reglas de negativo.
    //
    //   SALIDA → puede quedar en negativo SOLO si viene forzado con el nombre
    //            de quien lo autoriza. Pasa cuando el papel va atrasado y el
    //            material ya salió físicamente.
    //   MERMA  → NUNCA. Si la merma no cabe en lo que queda, es que algo está
    //            mal contado, y eso se arregla con un conteo físico, no
    //            empujando el número para abajo.
    //
    // La regla de la MERMA vale SIEMPRE, aunque el material nunca se haya
    // contado: antes, en un material sin inventario inicial, una merma lo
    // dejaba en negativo sin decir nada.
    if (afectaExistencia && (datos.tipo === 'SALIDA' || datos.tipo === 'MERMA')
        && (conocida || datos.tipo === 'MERMA')) {
      const quedaria = round4(existenciaActual - cantidad);

      if (quedaria < 0 && datos.tipo === 'MERMA') {
        throw new HttpError(
          409,
          `No se puede registrar una merma de ${cantidad}: solo hay ${existenciaActual} disponibles ` +
          `y la merma no puede dejar la existencia en negativo. ` +
          `Si de verdad se echó a perder más de lo que el sistema dice que había, ` +
          `registra primero un ajuste por conteo físico con la cantidad real.`
        );
      }

      if (quedaria < 0 && !conocida) {
        // (solo puede ser MERMA: la salida de un material sin contar sigue
        //  permitida, porque todavía no se sabe cuánto hay)
        throw new HttpError(
          409,
          'Este material todavía no tiene existencia confirmada, así que no se puede registrar una merma. ' +
          'Primero haz un ajuste por conteo físico con lo que hay de verdad.'
        );
      }

      if (quedaria < 0 && !datos.forzadoNegativo) {
        throw new HttpError(
          409,
          `La operación supera la existencia disponible (${existenciaActual}). ` +
          `Si un encargado autoriza dejarlo en negativo, reenvía marcando "forzado" con su nombre en "autoriza".`
        );
      }
      if (quedaria < 0 && datos.forzadoNegativo && !datos.autoriza) {
        throw new HttpError(400, 'Para forzar una existencia negativa se requiere el nombre de quien autoriza.');
      }
    }

    // Si hay rollo involucrado, valida contra el restante de ESE rollo específico
    // (si ya viene con FOR UPDATE de afuera —como al editar un rollo— no lo repetimos).
    if (datos.rolloId && afectaExistencia && (datos.tipo === 'SALIDA' || datos.tipo === 'MERMA')) {
      const [[rollo]] = esPropia
        ? await conn.query('SELECT * FROM rollos WHERE id = ? FOR UPDATE', [datos.rolloId])
        : await conn.query('SELECT * FROM rollos WHERE id = ?', [datos.rolloId]);
      if (!rollo) throw new HttpError(404, 'Rollo no encontrado.');
      // El rollo tiene que ser de ESTE material y estar vigente: si no, se
      // descontaba de un material y del rollo de otro, o de un rollo ya
      // eliminado (cuyo restante ya se había dado de baja).
      if (String(rollo.material_id) !== String(material.id)) {
        throw new HttpError(409, `El rollo ${rollo.id} no es de ${material.codigo}.`);
      }
      if (!rollo.activo) {
        throw new HttpError(409, `El rollo ${rollo.id} está eliminado: recarga la pantalla y elige otro.`);
      }
      if (rollo.largo == null) {
        throw new HttpError(409, `El rollo ${rollo.id} todavía no está medido. Mídelo en Rollos → Editar antes de sacar material.`);
      }

      const restante = await calcularRestanteRollo(conn, datos.rolloId);
      if (restante != null && cantidad > restante) {
        throw new HttpError(409, `Ese rollo solo tiene ${restante} disponibles.`);
      }
      if (rollo.estado === 'SELLADO') {
        await conn.query('UPDATE rollos SET estado = "ABIERTO" WHERE id = ?', [datos.rolloId]);
      }
      if (restante != null && Math.abs(restante - cantidad) < 0.001) {
        await conn.query('UPDATE rollos SET estado = "AGOTADO" WHERE id = ?', [datos.rolloId]);
      }
    } else if (datos.rolloId) {
      // Movimiento que NO descuenta (ej. una merma): el rollo solo sirve para
      // dejar anotado a cuál se le fue el material. Se valida que exista, pero
      // no se toca su estado ni su restante.
      const [[rollo]] = await conn.query('SELECT id, material_id FROM rollos WHERE id = ?', [datos.rolloId]);
      if (!rollo) throw new HttpError(404, 'Rollo no encontrado.');
      if (String(rollo.material_id) !== String(material.id)) {
        throw new HttpError(409, `El rollo ${rollo.id} no es de ${material.codigo}.`);
      }
    }

    // Lámina: el corte no puede ser más grande que lo que le queda a esa lámina
    if (datos.laminaId && afectaExistencia && (datos.tipo === 'SALIDA' || datos.tipo === 'MERMA')) {
      const restante = await calcularRestanteLamina(conn, datos.laminaId);
      if (restante == null) throw new HttpError(404, 'Lámina no encontrada.');
      if (cantidad > restante + 0.0001) {
        throw new HttpError(409, `A la lámina ${datos.laminaId} solo le quedan ${Math.round(restante * 32 * 100) / 100} pie².`);
      }
    }

    // AJUSTE: si el material nunca tuvo existencia confirmada, la primera
    // "confirmación" no genera movimiento — solo fija el inventario inicial.
    // EXCEPCIÓN: si viene forzarMovimiento=true (ej. corrección de largo de
    // un rollo), siempre queda el movimiento registrado, para que se vea en
    // Movimientos sin excepción.
    if (datos.tipo === 'AJUSTE' && !conocida && !datos.forzarMovimiento) {
      await conn.query(
        'UPDATE materiales SET inventario_inicial = ?, precision_inicial = "EXACTO" WHERE id = ?',
        [datos.cantidad, material.id]
      );
      if (esPropia) await conn.commit();
      return { confirmacionInicial: true, existencia: round4(datos.cantidad) };
    }

    const [result] = await conn.query(
      `INSERT INTO movimientos
        (material_id, tipo, cantidad, unidad_id, fecha, rollo_id, lamina_id, medidas, movimiento_detalle,
         ot, cotizacion, cliente, proyecto, area_id, bodega_id,
         proveedor_id, documento_tipo, documento_numero, motivo, costo_unitario,
         descuenta, quien, entrega, autoriza, forzado_negativo, observaciones, usuario_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        material.id, datos.tipo, cantidad, datos.unidadId || material.unidad_id, datos.fecha,
        datos.rolloId || null, datos.laminaId || null, datos.medidas || null, datos.movimientoDetalle || null,
        datos.ot || null, datos.cotizacion || null, datos.cliente || null, datos.proyecto || null,
        datos.areaId || null, datos.bodegaId || material.bodega_id || null,
        // De dónde viene el material: proveedor y el documento que lo respalda
        datos.proveedorId || null, datos.documentoTipo || null, datos.documentoNumero || null,
        datos.motivo || null,
        // Salidas y mermas guardan el costo que tenía el material ese día.
        // Así el reporte de "cuánto se perdió en merma en septiembre" usa el
        // precio de septiembre, aunque después el costo cambie con otra compra.
        datos.costoUnitario ?? (
          (datos.tipo === 'SALIDA' || datos.tipo === 'MERMA') && material.costo != null
            ? material.costo : null
        ),
        datos.descuenta === false ? 0 : 1,
        datos.quien || null, datos.entrega || null, datos.autoriza || null,
        !!datos.forzadoNegativo, datos.observaciones || null, usuarioId || null,
      ]
    );

    // Si vino costo en una entrada, se actualiza el costo de referencia del material
    if (datos.tipo === 'ENTRADA' && datos.costoUnitario != null) {
      await conn.query('UPDATE materiales SET costo = ? WHERE id = ?', [datos.costoUnitario, material.id]);
    }
    if (datos.tipo === 'ENTRADA' && datos.bodegaId && !material.bodega_id) {
      await conn.query('UPDATE materiales SET bodega_id = ? WHERE id = ?', [datos.bodegaId, material.id]);
    }

    const nuevaExistencia = await calcularExistencia(conn, material.id);
    if (esPropia) await conn.commit();
    return { movimientoId: result.insertId, existencia: nuevaExistencia };
  } catch (err) {
    if (esPropia) await conn.rollback();
    throw err;
  } finally {
    if (esPropia) conn.release();
  }
}

/**
 * Para materiales que se manejan por rollo (PIE LINEAL / METRO LINEAL):
 * registra una SALIDA o MERMA eligiendo sola el/los rollo(s) a usar, sin que
 * el usuario tenga que saber cuál rollo específico tiene material disponible.
 *
 * Reglas:
 *  - Se usa primero el rollo ya ABIERTO más antiguo (para no dejar rollos a
 *    medias regados); si no alcanza, sigue con el siguiente ABIERTO, y luego
 *    con los SELLADO en orden de llegada.
 *  - Si un rollo se agota a mitad de la operación, automáticamente continúa
 *    con el siguiente — puede generar más de un movimiento (uno por rollo).
 *  - Si no hay suficiente en NINGÚN rollo, no se permite la operación y se
 *    indica cuánto hay disponible en total (para decidir si hace falta comprar).
 */
async function registrarSalidaAutomatica(datos, usuarioId) {
  // Todo ocurre dentro de UNA sola transacción: si el reparto entre rollos
  // falla a la mitad, no queda un movimiento suelto ya guardado contra el
  // primer rollo. O se registran todos, o no se registra ninguno.
  const cantidadPedida = round4(datos.cantidad);
  if (!(cantidadPedida > 0)) throw new HttpError(400, 'La cantidad debe ser mayor que cero.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Primero se bloquea el material y después se miran sus rollos: siempre
    // en ese orden, para que dos salidas a la vez no se traben entre sí.
    const [[existe]] = await conn.query('SELECT id FROM materiales WHERE id = ? FOR UPDATE', [datos.materialId]);
    if (!existe) throw new HttpError(404, 'Material no encontrado.');

    const [rollos] = await conn.query(
      `SELECT * FROM rollos
       WHERE material_id = ? AND activo = TRUE AND largo IS NOT NULL AND estado <> 'AGOTADO'
       ORDER BY FIELD(estado, 'ABIERTO', 'SELLADO', 'POR_CONFIRMAR'), created_at ASC
       FOR UPDATE`,
      [datos.materialId]
    );

    const candidatos = [];
    for (const r of rollos) {
      const restante = await calcularRestanteRollo(conn, r.id);
      if (restante != null && restante > 0.0001) candidatos.push({ ...r, restante });
    }

    const totalDisponible = round4(candidatos.reduce((acc, r) => acc + r.restante, 0));
    const cantidadSolicitada = cantidadPedida;

    if (totalDisponible <= 0) {
      throw new HttpError(
        409,
        'No hay stock disponible en ningún rollo de este material. Hay que realizar una compra.'
      );
    }
    if (totalDisponible < cantidadSolicitada) {
      const esMerma = datos.tipo === 'MERMA';
      throw new HttpError(
        409,
        esMerma
          ? `No se puede registrar una merma de ${cantidadSolicitada}: entre todos los rollos ` +
            `solo quedan ${totalDisponible}, y la merma no puede dejar la existencia en negativo. ` +
            `Si se echó a perder más de lo que el sistema dice que había, registra primero un ` +
            `ajuste por conteo físico.`
          : `Stock insuficiente: solo hay ${totalDisponible} disponibles entre los rollos existentes ` +
            `(se necesitan ${cantidadSolicitada}). Registra un rollo adicional o realiza una compra.`
      );
    }

    let pendiente = cantidadSolicitada;
    const resultados = [];
    for (const rollo of candidatos) {
      if (pendiente <= 0) break;
      const tomar = round4(Math.min(rollo.restante, pendiente));
      const res = await registrarMovimiento(
        { ...datos, cantidad: tomar, rolloId: rollo.id },
        usuarioId,
        conn
      );
      resultados.push({ rolloId: rollo.id, cantidad: tomar, ...res });
      pendiente = round4(pendiente - tomar);
    }

    await conn.commit();

    return {
      multiRollo: resultados.length > 1,
      rollosUsados: resultados.map((r) => r.rolloId),
      movimientos: resultados,
      existencia: resultados[resultados.length - 1]?.existencia,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}


module.exports = {
  round4,
  calcularExistencia,
  esConocida,
  calcularRestanteRollo,
  calcularRestanteLamina,
  sumaRestantesRollos,
  stockSinRollo,
  siguienteIdRollo,
  rollosTodosMedidos,
  calcularEstado,
  registrarMovimiento,
  registrarSalidaAutomatica,
};
