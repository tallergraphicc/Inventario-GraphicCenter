const pool = require('../config/db');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');
const inv = require('../services/inventario.service');
const csv = require('../config/csv');
const log = require('../config/log');
const lam = require('../services/laminas.service');

/** Lista el inventario completo con existencia y estado ya calculados. */
const listar = asyncHandler(async (req, res) => {
  const [materiales] = await pool.query(`
    SELECT m.*, c.nombre AS categoria, sc.nombre AS subcategoria,
           u.codigo AS unidad_codigo, u.nombre AS unidad_nombre,
           b.nombre AS bodega_nombre
    FROM materiales m
    JOIN categorias c ON c.id = m.categoria_id
    LEFT JOIN subcategorias sc ON sc.id = m.subcategoria_id
    JOIN unidades_medida u ON u.id = m.unidad_id
    LEFT JOIN bodegas b ON b.id = m.bodega_id
    WHERE m.activo = TRUE
    ORDER BY m.codigo
  `);

  const conn = await pool.getConnection();
  try {
    const resultado = [];
    for (const m of materiales) {
      const existencia = await inv.calcularExistencia(conn, m.id);
      const estado = await inv.calcularEstado(conn, m);
      // Para materiales por rollo: cuánto está dentro de rollos medidos. Si no
      // coincide con la existencia, la pantalla lo muestra — así se ve de
      // inmediato si hay material contado que no está en ningún rollo.
      const esRollo = m.unidad_codigo === 'PIE LINEAL' || m.unidad_codigo === 'METRO LINEAL';
      const enRollos = esRollo ? await inv.sumaRestantesRollos(conn, m.id) : null;
      resultado.push({ ...m, existencia, estado, en_rollos: enRollos });
    }
    res.json(resultado);
  } finally {
    conn.release();
  }
});

const obtener = asyncHandler(async (req, res) => {
  const [[material]] = await pool.query(
    `SELECT m.*, c.nombre AS categoria, sc.nombre AS subcategoria,
            u.codigo AS unidad_codigo, u.nombre AS unidad_nombre
     FROM materiales m
     JOIN categorias c ON c.id = m.categoria_id
     LEFT JOIN subcategorias sc ON sc.id = m.subcategoria_id
     JOIN unidades_medida u ON u.id = m.unidad_id
     WHERE m.id = ?`,
    [req.params.id]
  );
  if (!material) throw new HttpError(404, 'Material no encontrado.');

  const conn = await pool.getConnection();
  try {
    const existencia = await inv.calcularExistencia(conn, material.id);
    const estado = await inv.calcularEstado(conn, material);
    const [rollos] = await conn.query('SELECT * FROM rollos WHERE material_id = ?', [material.id]);
    const rollosConRestante = [];
    for (const r of rollos) {
      const restante = await inv.calcularRestanteRollo(conn, r.id);
      rollosConRestante.push({ ...r, restante });
    }
    res.json({ ...material, existencia, estado, rollos: rollosConRestante });
  } finally {
    conn.release();
  }
});

/**
 * Número opcional: vacío → null; si viene, tiene que ser un número de verdad
 * y no negativo. Antes "abc" o "12,5" terminaban en un error interno, y un
 * costo negativo se guardaba.
 */
function numeroOpcional(valor, etiqueta) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new HttpError(400, `${etiqueta} tiene que ser un número (usa punto para los decimales).`);
  if (n < 0) throw new HttpError(400, `${etiqueta} no puede ser negativo.`);
  if (n > 99999999) throw new HttpError(400, `${etiqueta} es demasiado grande.`);
  return n;
}

const crear = asyncHandler(async (req, res) => {
  const {
    categoriaId, subcategoriaId, unidadId,
    bodegaId, ubicacion, observaciones,
  } = req.body;
  const codigo = String(req.body.codigo ?? '').trim().toUpperCase();
  const descripcion = String(req.body.descripcion ?? '').trim();

  if (!codigo || !descripcion || !categoriaId || !unidadId) {
    throw new HttpError(400, 'Código, descripción, categoría y unidad son obligatorios.');
  }
  if (codigo.length > 40) throw new HttpError(400, 'El código es muy largo (máximo 40 caracteres).');
  if (descripcion.length > 200) throw new HttpError(400, 'La descripción es muy larga (máximo 200 caracteres).');
  const inventarioInicial = numeroOpcional(req.body.inventarioInicial, 'El inventario inicial');
  const stockMinimo = numeroOpcional(req.body.stockMinimo, 'El stock mínimo');
  const costo = numeroOpcional(req.body.costo, 'El costo');
  const espesorMm = numeroOpcional(req.body.espesorMm, 'El espesor');

  const [existe] = await pool.query('SELECT id FROM materiales WHERE codigo = ?', [codigo]);
  if (existe.length) throw new HttpError(409, `Ya existe un material con el código ${codigo}.`);

  const precision = inventarioInicial === null ? 'POR_CONFIRMAR' : 'EXACTO';

  const [result] = await pool.query(
    `INSERT INTO materiales
      (codigo, descripcion, categoria_id, subcategoria_id, unidad_id, bodega_id, ubicacion, espesor_mm,
       inventario_inicial, precision_inicial, stock_minimo, costo, observaciones)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      codigo, descripcion, categoriaId, subcategoriaId || null, unidadId,
      bodegaId || null, ubicacion || null,
      espesorMm,
      inventarioInicial,
      precision,
      stockMinimo,
      costo,
      observaciones || null,
    ]
  );
  res.status(201).json({ id: result.insertId });
});

/**
 * Importa varios materiales de una vez (desde el Excel que arma la pantalla
 * de "Importar desde Excel"). Cada fila pasa por las mismas reglas que crear
 * un material a mano — código, descripción, categoría y unidad obligatorios,
 * números válidos y no negativos. Si algo no cuadra en una fila (categoría
 * que no existe, código repetido, dato mal escrito...) esa fila se rechaza
 * con el motivo, pero las demás se importan igual: no es todo o nada.
 *
 * Un código que ya existe en el sistema SIEMPRE se rechaza — nunca pisa un
 * material existente. Tampoco crea rollos ni láminas individuales: solo el
 * material con su existencia inicial, igual que "+ Nuevo material".
 */
const importar = asyncHandler(async (req, res) => {
  const filas = req.body.materiales;
  if (!Array.isArray(filas) || !filas.length) {
    throw new HttpError(400, 'No se recibió ninguna fila para importar.');
  }
  if (filas.length > 500) {
    throw new HttpError(400, 'Como mucho 500 materiales por importación. Dividí el archivo en partes más chicas.');
  }

  const [categorias] = await pool.query('SELECT id, nombre FROM categorias');
  const [subcategorias] = await pool.query('SELECT id, categoria_id, nombre FROM subcategorias');
  const [unidades] = await pool.query('SELECT id, codigo, nombre FROM unidades_medida');
  const [bodegas] = await pool.query('SELECT id, nombre FROM bodegas');
  const [existentes] = await pool.query('SELECT codigo FROM materiales');
  const codigosExistentes = new Set(existentes.map((m) => m.codigo));

  const normaliza = (s) => String(s ?? '').trim().toLowerCase();
  const buscaPorNombre = (lista, nombre) => lista.find((x) => normaliza(x.nombre) === normaliza(nombre));
  const buscaUnidad = (valor) => {
    const v = normaliza(valor);
    return unidades.find((u) => normaliza(u.codigo) === v || normaliza(u.nombre) === v);
  };
  const numeroFilaOpcional = (valor, etiqueta, motivos) => {
    try { return numeroOpcional(valor, etiqueta); }
    catch (err) { motivos.push(err.message); return null; }
  };

  const creados = [];
  const rechazados = [];
  const codigosEnEsteArchivo = new Set();

  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i] || {};
    const numeroFila = i + 2; // la fila 1 del Excel es el encabezado
    const codigo = String(fila.codigo ?? '').trim().toUpperCase();
    const descripcion = String(fila.descripcion ?? '').trim();

    // Fila completamente vacía (una línea de más al final del Excel): se
    // salta sin contar como rechazada.
    if (!codigo && !descripcion && !fila.categoria && !fila.unidad) continue;

    const motivos = [];
    if (!codigo) motivos.push('falta el código');
    else if (codigo.length > 40) motivos.push('el código tiene más de 40 caracteres');
    if (!descripcion) motivos.push('falta la descripción');
    else if (descripcion.length > 200) motivos.push('la descripción tiene más de 200 caracteres');

    let categoria = null;
    if (!String(fila.categoria ?? '').trim()) motivos.push('falta la categoría');
    else {
      categoria = buscaPorNombre(categorias, fila.categoria);
      if (!categoria) motivos.push(`la categoría "${fila.categoria}" no existe`);
    }

    let subcategoriaId = null;
    if (String(fila.subcategoria ?? '').trim()) {
      const sub = categoria
        ? subcategorias.find((s) => s.categoria_id === categoria.id && normaliza(s.nombre) === normaliza(fila.subcategoria))
        : null;
      if (!sub) motivos.push(`la subcategoría "${fila.subcategoria}" no existe en esa categoría`);
      else subcategoriaId = sub.id;
    }

    let unidad = null;
    if (!String(fila.unidad ?? '').trim()) motivos.push('falta la unidad');
    else {
      unidad = buscaUnidad(fila.unidad);
      if (!unidad) motivos.push(`la unidad "${fila.unidad}" no existe`);
    }

    let bodegaId = null;
    if (String(fila.bodega ?? '').trim()) {
      const bod = buscaPorNombre(bodegas, fila.bodega);
      if (!bod) motivos.push(`la bodega "${fila.bodega}" no existe`);
      else bodegaId = bod.id;
    }

    const inventarioInicial = numeroFilaOpcional(fila.existenciaInicial, 'La existencia inicial', motivos);
    const stockMinimo = numeroFilaOpcional(fila.stockMinimo, 'El stock mínimo', motivos);
    const costo = numeroFilaOpcional(fila.costo, 'El costo', motivos);
    const espesorMm = numeroFilaOpcional(fila.espesorMm, 'El espesor', motivos);

    if (codigo) {
      if (codigosExistentes.has(codigo)) motivos.push('ya existe un material con ese código en el sistema');
      else if (codigosEnEsteArchivo.has(codigo)) motivos.push('el código está repetido dentro del mismo archivo');
    }

    if (motivos.length) {
      rechazados.push({ fila: numeroFila, codigo: codigo || '(sin código)', motivos });
      continue;
    }

    const ubicacion = String(fila.ubicacion ?? '').trim().slice(0, 100) || null;
    const observaciones = String(fila.observaciones ?? '').trim() || null;
    const precision = inventarioInicial === null ? 'POR_CONFIRMAR' : 'EXACTO';

    try {
      const [result] = await pool.query(
        `INSERT INTO materiales
          (codigo, descripcion, categoria_id, subcategoria_id, unidad_id, bodega_id, ubicacion, espesor_mm,
           inventario_inicial, precision_inicial, stock_minimo, costo, observaciones)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          codigo, descripcion, categoria.id, subcategoriaId, unidad.id,
          bodegaId, ubicacion, espesorMm, inventarioInicial, precision, stockMinimo, costo, observaciones,
        ]
      );
      codigosEnEsteArchivo.add(codigo);
      creados.push({ fila: numeroFila, id: result.insertId, codigo });
    } catch (err) {
      // Carrera muy poco probable (otra importación o alta con el mismo
      // código, justo entre el chequeo de arriba y este INSERT). Se rechaza
      // esta fila en vez de tumbar toda la importación.
      if (err.code === 'ER_DUP_ENTRY') {
        rechazados.push({ fila: numeroFila, codigo, motivos: ['ya existe un material con ese código en el sistema'] });
      } else {
        throw err;
      }
    }
  }

  log.info('importación de materiales desde Excel', {
    creados: creados.length, rechazados: rechazados.length, por: req.usuario.usuario,
  });

  res.json({ creados, rechazados });
});

const actualizar = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Cambiar la unidad es válido para corregir un error al dar de alta el
  // material (se puso "unidad" cuando en realidad se mide por pie lineal).
  // Pero si YA hay movimientos registrados, cambiarla deja todo el histórico
  // sin sentido: 40 pies y 40 unidades no son lo mismo. En ese caso solo lo
  // puede hacer un administrador, y sabiendo lo que hace.
  let desactivarLaminas = false;
  if (req.body.unidadId !== undefined) {
    const [[actual]] = await pool.query('SELECT unidad_id FROM materiales WHERE id = ?', [id]);
    if (!actual) throw new HttpError(404, 'Material no encontrado.');

    if (String(actual.unidad_id) !== String(req.body.unidadId)) {
      // Si tiene láminas registradas, no puede dejar de ser un material por
      // láminas: esas láminas quedarían sueltas, sin nadie que las use.
      // Solo cuentan las que todavía tienen material: las agotadas ni se ven.
      const conLaminas = (await lam.laminasConRestante(pool, id)).filter((l) => l.restante > lam.CASI_CERO);
      const [[nueva]] = await pool.query('SELECT codigo FROM unidades_medida WHERE id = ?', [req.body.unidadId]);
      if (conLaminas.length && (!nueva || nueva.codigo !== 'LAMINA')) {
        throw new HttpError(
          409,
          `Este material tiene ${conLaminas.length} lámina(s) con material. Para cambiarle la unidad, elimínalas primero en la pestaña Láminas.`
        );
      }
      // Las agotadas que queden ya no le sirven a nadie (se apagan al final,
      // solo si el cambio de verdad se guarda)
      desactivarLaminas = !nueva || nueva.codigo !== 'LAMINA';

      const [[{ n }]] = await pool.query(
        'SELECT COUNT(*) AS n FROM movimientos WHERE material_id = ?',
        [id]
      );
      if (n > 0 && req.usuario.rol !== 'ADMIN') {
        throw new HttpError(
          409,
          `Este material ya tiene ${n} movimiento(s) registrados con la unidad actual. ` +
          `Cambiar la unidad ahora dejaría el histórico sin sentido, así que solo lo puede hacer un administrador.`
        );
      }
      if (n > 0) {
        log.aviso('cambio de unidad con movimientos existentes', {
          materialId: id, movimientos: n, por: req.usuario.usuario,
        });
      }
    }
  }

  const campos = [
    'descripcion', 'categoria_id', 'subcategoria_id', 'unidad_id', 'bodega_id',
    'ubicacion', 'espesor_mm', 'stock_minimo', 'costo', 'observaciones',
    // 'activo' NO se edita por aquí: eliminar (o revivir) un material es cosa
    // de administradores y tiene su propia ruta, que además da de baja sus
    // rollos y láminas. Por aquí, cualquier operador podía esconder un
    // material con existencia de un solo clic.
  ];
  if (req.body.descripcion !== undefined) {
    req.body.descripcion = String(req.body.descripcion ?? '').trim();
    if (!req.body.descripcion) throw new HttpError(400, 'La descripción no puede quedar vacía.');
    if (req.body.descripcion.length > 200) throw new HttpError(400, 'La descripción es muy larga (máximo 200 caracteres).');
  }
  if (req.body.stockMinimo !== undefined) req.body.stockMinimo = numeroOpcional(req.body.stockMinimo, 'El stock mínimo');
  if (req.body.costo !== undefined) req.body.costo = numeroOpcional(req.body.costo, 'El costo');
  if (req.body.espesorMm !== undefined) req.body.espesorMm = numeroOpcional(req.body.espesorMm, 'El espesor');

  const map = {
    descripcion: req.body.descripcion, categoria_id: req.body.categoriaId,
    subcategoria_id: req.body.subcategoriaId, unidad_id: req.body.unidadId,
    bodega_id: req.body.bodegaId, ubicacion: req.body.ubicacion, espesor_mm: req.body.espesorMm,
    stock_minimo: req.body.stockMinimo, costo: req.body.costo,
    observaciones: req.body.observaciones,
  };
  const sets = [];
  const valores = [];
  for (const c of campos) {
    if (map[c] !== undefined) { sets.push(`${c} = ?`); valores.push(map[c] === '' ? null : map[c]); }
  }
  if (!sets.length) throw new HttpError(400, 'No se enviaron campos para actualizar.');
  valores.push(id);
  await pool.query(`UPDATE materiales SET ${sets.join(', ')} WHERE id = ?`, valores);
  if (desactivarLaminas) await pool.query('UPDATE laminas SET activo = FALSE WHERE material_id = ?', [id]);
  res.json({ ok: true });
});

/**
 * Eliminar un material. Solo administradores.
 *
 * Se desactiva, no se borra la fila: los movimientos que ya existen apuntan a
 * ella y el histórico no se toca nunca. Un material desactivado desaparece del
 * inventario y de los desplegables.
 *
 * Si el material todavía tiene existencia o rollos activos, se avisa: hay que
 * confirmar a propósito, para que no se esconda material por accidente.
 */
const eliminar = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const confirmado = req.body.confirmar === true || req.query.confirmar === '1';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[material]] = await conn.query('SELECT * FROM materiales WHERE id = ? FOR UPDATE', [id]);
    if (!material) throw new HttpError(404, 'Material no encontrado.');
    if (!material.activo) throw new HttpError(409, 'Ese material ya estaba eliminado.');

    const existencia = await inv.calcularExistencia(conn, material.id);
    const [[{ rollos }]] = await conn.query(
      'SELECT COUNT(*) AS rollos FROM rollos WHERE material_id = ? AND activo = TRUE',
      [id]
    );
    const [[{ movimientos }]] = await conn.query(
      'SELECT COUNT(*) AS movimientos FROM movimientos WHERE material_id = ?',
      [id]
    );

    if (!confirmado && (existencia > 0 || rollos > 0)) {
      const partes = [];
      if (existencia > 0) partes.push(`${existencia} de existencia`);
      if (rollos > 0) partes.push(`${rollos} rollo(s) activo(s)`);
      throw new HttpError(
        409,
        `"${material.codigo}" todavía tiene ${partes.join(' y ')}. ` +
        `Si de verdad quieres eliminarlo, vuelve a enviarlo confirmando.`
      );
    }

    await conn.query('UPDATE materiales SET activo = FALSE WHERE id = ?', [id]);
    // Sus rollos y láminas también salen de circulación
    await conn.query('UPDATE rollos SET activo = FALSE WHERE material_id = ?', [id]);
    await conn.query('UPDATE laminas SET activo = FALSE WHERE material_id = ?', [id]);
    await conn.commit();

    log.info('material eliminado', {
      codigo: material.codigo, existencia, rollos, movimientos, por: req.usuario.usuario,
    });

    res.json({
      ok: true,
      mensaje: movimientos > 0
        ? `"${material.codigo}" fue eliminado. Sus ${movimientos} movimientos siguen en el histórico.`
        : `"${material.codigo}" fue eliminado.`,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/** Exportar el inventario completo, con existencia y estado ya calculados. */
const exportarCsv = asyncHandler(async (req, res) => {
  const [materiales] = await pool.query(`
    SELECT m.*, c.nombre AS categoria, sc.nombre AS subcategoria,
           u.codigo AS unidad_codigo, b.nombre AS bodega_nombre
    FROM materiales m
    JOIN categorias c ON c.id = m.categoria_id
    LEFT JOIN subcategorias sc ON sc.id = m.subcategoria_id
    JOIN unidades_medida u ON u.id = m.unidad_id
    LEFT JOIN bodegas b ON b.id = m.bodega_id
    WHERE m.activo = TRUE
    ORDER BY m.codigo
  `);

  const conn = await pool.getConnection();
  let filas;
  try {
    filas = [];
    for (const m of materiales) {
      filas.push({
        ...m,
        existencia: await inv.calcularExistencia(conn, m.id),
        estado: await inv.calcularEstado(conn, m),
      });
    }
  } finally {
    conn.release();
  }

  log.info('exportación de inventario', { filas: filas.length, por: req.usuario.usuario });

  csv.responder(res, 'inventario', [
    { titulo: 'Código', clave: 'codigo' },
    { titulo: 'Descripción', clave: 'descripcion' },
    { titulo: 'Categoría', clave: 'categoria' },
    { titulo: 'Subcategoría', clave: 'subcategoria' },
    { titulo: 'Existencia', clave: 'existencia' },
    { titulo: 'Unidad', clave: 'unidad_codigo' },
    { titulo: 'Estado', clave: 'estado' },
    { titulo: 'Stock mínimo', clave: 'stock_minimo' },
    { titulo: 'Precisión', clave: 'precision_inicial' },
    { titulo: 'Bodega', clave: 'bodega_nombre' },
    { titulo: 'Ubicación', clave: 'ubicacion' },
    { titulo: 'Costo por unidad', clave: 'costo' },
    { titulo: 'Valor total', valor: (m) => (m.costo != null && m.existencia != null
        ? inv.round4(Number(m.existencia) * Number(m.costo)) : '') },
    { titulo: 'Observaciones', clave: 'observaciones' },
  ], filas);
});

module.exports = { listar, obtener, crear, importar, actualizar, eliminar, exportarCsv };
