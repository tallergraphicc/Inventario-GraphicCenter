const pool = require('../config/db');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');

const listarCategorias = asyncHandler(async (req, res) => {
  const [categorias] = await pool.query('SELECT * FROM categorias ORDER BY nombre');
  const [subcategorias] = await pool.query('SELECT * FROM subcategorias ORDER BY nombre');
  const conSubs = categorias.map((c) => ({
    ...c,
    subcategorias: subcategorias.filter((s) => s.categoria_id === c.id),
  }));
  res.json(conSubs);
});

const listarUnidades = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM unidades_medida ORDER BY nombre');
  res.json(rows);
});

const listarBodegas = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM bodegas ORDER BY nombre');
  res.json(rows);
});

const listarAreas = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM areas ORDER BY nombre');
  res.json(rows);
});

/**
 * Proveedores, con cuántas entradas tiene cada uno. El conteo sirve en
 * Configuración para saber de antemano si se puede eliminar: uno que ya tiene
 * compras registradas no se borra, porque el histórico perdería a quién se
 * le compró.
 */
const listarProveedores = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT p.id, p.nombre, COUNT(mv.id) AS movimientos
    FROM proveedores p
    LEFT JOIN movimientos mv ON mv.proveedor_id = p.id
    GROUP BY p.id, p.nombre
    ORDER BY p.nombre
  `);
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Crear
// ---------------------------------------------------------------------------

const crearCategoria = asyncHandler(async (req, res) => {
  const nombre = String(req.body.nombre ?? '').trim().toUpperCase();
  if (!nombre) throw new HttpError(400, 'El nombre es obligatorio.');
  const [result] = await pool.query('INSERT INTO categorias (nombre) VALUES (?)', [nombre]);
  res.status(201).json({ id: result.insertId, nombre });
});

const crearSubcategoria = asyncHandler(async (req, res) => {
  const nombre = String(req.body.nombre ?? '').trim();
  const { categoriaId } = req.params;
  if (!nombre) throw new HttpError(400, 'El nombre es obligatorio.');
  const [result] = await pool.query(
    'INSERT INTO subcategorias (categoria_id, nombre) VALUES (?, ?)',
    [categoriaId, nombre]
  );
  res.status(201).json({ id: result.insertId, nombre });
});

const crearBodega = asyncHandler(async (req, res) => {
  const nombre = String(req.body.nombre ?? '').trim().toUpperCase();
  if (!nombre) throw new HttpError(400, 'El nombre es obligatorio.');
  const [result] = await pool.query('INSERT INTO bodegas (nombre) VALUES (?)', [nombre]);
  res.status(201).json({ id: result.insertId, nombre });
});

const crearArea = asyncHandler(async (req, res) => {
  const nombre = String(req.body.nombre ?? '').trim().toUpperCase();
  if (!nombre) throw new HttpError(400, 'El nombre es obligatorio.');
  const [result] = await pool.query('INSERT INTO areas (nombre) VALUES (?)', [nombre]);
  res.status(201).json({ id: result.insertId, nombre });
});

const crearProveedor = asyncHandler(async (req, res) => {
  const nombre = String(req.body.nombre ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (!nombre) throw new HttpError(400, 'El nombre del proveedor es obligatorio.');
  if (nombre.length > 120) throw new HttpError(400, 'El nombre del proveedor es muy largo (máximo 120 letras).');
  try {
    const [result] = await pool.query('INSERT INTO proveedores (nombre) VALUES (?)', [nombre]);
    res.status(201).json({ id: result.insertId, nombre });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, `El proveedor ${nombre} ya existe.`);
    throw err;
  }
});

const crearUnidad = asyncHandler(async (req, res) => {
  const codigo = String(req.body.codigo ?? '').trim().toUpperCase();
  const nombre = String(req.body.nombre ?? '').trim();
  if (!codigo || !nombre) throw new HttpError(400, 'Código y nombre son obligatorios.');
  const [result] = await pool.query('INSERT INTO unidades_medida (codigo, nombre) VALUES (?, ?)', [codigo, nombre]);
  res.status(201).json({ id: result.insertId, codigo, nombre });
});

// ---------------------------------------------------------------------------
// Eliminar — si algo lo está usando (FK), MySQL/MariaDB rechaza el borrado
// con ER_ROW_IS_REFERENCED_2; lo convertimos en un mensaje claro para el usuario.
// ---------------------------------------------------------------------------

// Estas unidades no son una más: el sistema decide por ellas si un material
// se maneja por rollos o por láminas. Borrarlas dejaba esas pantallas sin
// funcionar, en silencio.
const UNIDADES_DEL_SISTEMA = ['PIE LINEAL', 'METRO LINEAL', 'LAMINA'];

const eliminarUnidad = asyncHandler(async (req, res) => {
  const [[unidad]] = await pool.query('SELECT codigo FROM unidades_medida WHERE id = ?', [req.params.id]);
  if (unidad && UNIDADES_DEL_SISTEMA.includes(unidad.codigo)) {
    throw new HttpError(
      409,
      `La unidad ${unidad.codigo} la usa el sistema para los ${unidad.codigo === 'LAMINA' ? 'materiales por lámina' : 'rollos'}. No se puede eliminar.`
    );
  }
  try {
    await pool.query('DELETE FROM unidades_medida WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      throw new HttpError(409, 'No se puede eliminar: hay materiales que la están usando.');
    }
    throw err;
  }
});

function eliminarDe(tabla) {
  return asyncHandler(async (req, res) => {
    try {
      await pool.query(`DELETE FROM ${tabla} WHERE id = ?`, [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
        throw new HttpError(409, 'No se puede eliminar: hay materiales o movimientos que lo están usando.');
      }
      throw err;
    }
  });
}

module.exports = {
  listarCategorias, listarUnidades, listarBodegas, listarAreas, listarProveedores,
  crearCategoria, crearSubcategoria, crearBodega, crearArea, crearUnidad, crearProveedor,
  eliminarCategoria: eliminarDe('categorias'),
  eliminarSubcategoria: eliminarDe('subcategorias'),
  eliminarBodega: eliminarDe('bodegas'),
  eliminarArea: eliminarDe('areas'),
  eliminarUnidad,
  eliminarProveedor: eliminarDe('proveedores'),
};
