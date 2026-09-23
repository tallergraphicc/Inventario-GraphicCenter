const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');
const log = require('../config/log');

const ROLES = ['ADMIN', 'OPERADOR', 'VISTA'];

/** Nunca se devuelve el hash de la contraseña al frontend. */
const CAMPOS_PUBLICOS = `id, usuario, nombre, email, rol, activo,
                         debe_cambiar_password, ultimo_acceso, created_at`;

/** Lista de usuarios. Solo admin. */
const listar = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT ${CAMPOS_PUBLICOS} FROM usuarios ORDER BY activo DESC, rol, nombre`
  );
  res.json(rows);
});

/**
 * Los administradores activos, para llenar el desplegable de "Quién autoriza".
 *
 * Esto lo puede pedir cualquier usuario con sesión: el operador del taller
 * necesita ver la lista para elegir quién le autorizó la merma. Solo devuelve
 * id y nombre — ningún otro dato del usuario sale por aquí.
 */
const autorizadores = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, nombre FROM usuarios
     WHERE rol = 'ADMIN' AND activo = TRUE ORDER BY nombre`
  );
  res.json(rows);
});

/** Crear usuario. Solo admin. */
const crear = asyncHandler(async (req, res) => {
  const usuario = String(req.body.usuario ?? '').trim().toLowerCase();
  const nombre = String(req.body.nombre ?? '').trim();
  const email = String(req.body.email ?? '').trim() || null;
  const rol = req.body.rol || 'OPERADOR';
  const { password } = req.body;

  if (!usuario || !nombre || !password) {
    throw new HttpError(400, 'Usuario, nombre y contraseña son obligatorios.');
  }
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) {
    throw new HttpError(400, 'El usuario debe tener entre 3 y 40 caracteres: letras, números, punto, guion o guion bajo. Sin espacios ni acentos.');
  }
  if (!ROLES.includes(rol)) throw new HttpError(400, 'Rol no válido.');
  if (String(password).length < 8) {
    throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres.');
  }

  const [existe] = await pool.query('SELECT id FROM usuarios WHERE usuario = ?', [usuario]);
  if (existe.length) throw new HttpError(409, `Ya existe el usuario "${usuario}".`);

  const hash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    `INSERT INTO usuarios (usuario, nombre, email, password_hash, rol, debe_cambiar_password)
     VALUES (?,?,?,?,?,TRUE)`,
    [usuario, nombre, email, hash, rol]
  );

  log.info('usuario creado', { creado: usuario, rol, por: req.usuario.usuario });
  res.status(201).json({ id: result.insertId, usuario, nombre, rol });
});

/** Editar nombre, correo, rol o estado de un usuario. Solo admin. */
const actualizar = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [[destino]] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!destino) throw new HttpError(404, 'Usuario no encontrado.');

  const sets = [];
  const valores = [];

  if (req.body.nombre !== undefined) {
    const nombre = String(req.body.nombre).trim();
    if (!nombre) throw new HttpError(400, 'El nombre no puede quedar vacío.');
    sets.push('nombre = ?'); valores.push(nombre);
  }
  if (req.body.email !== undefined) {
    sets.push('email = ?'); valores.push(String(req.body.email).trim() || null);
  }
  // Nadie se quita a sí mismo el rol ni se desactiva: quedaría fuera del
  // sistema de un clic, sin poder deshacerlo.
  const esUnoMismo = Number(id) === Number(req.usuario.id);
  if (req.body.rol !== undefined) {
    if (!ROLES.includes(req.body.rol)) throw new HttpError(400, 'Rol no válido.');
    if (esUnoMismo && req.body.rol !== destino.rol) {
      throw new HttpError(409, 'No puedes cambiarte el rol a ti mismo. Pídeselo a otro administrador.');
    }
    sets.push('rol = ?'); valores.push(req.body.rol);
  }
  if (req.body.activo !== undefined) {
    // "false" (texto) también es falso: si no, desactivar desde otra
    // herramienta terminaba activando al usuario.
    const activo = req.body.activo !== false && req.body.activo !== 'false' && req.body.activo !== 0 && req.body.activo !== '0';
    if (esUnoMismo && !activo) {
      throw new HttpError(409, 'No puedes desactivar tu propio usuario.');
    }
    sets.push('activo = ?'); valores.push(activo ? 1 : 0);
  }

  if (!sets.length) throw new HttpError(400, 'No se envió nada para cambiar.');

  // Red de seguridad: que nadie deje el sistema sin ningún administrador
  // activo — si eso pasa, ya no hay forma de volver a entrar a administrar.
  const quedaSinAdmin =
    (req.body.rol !== undefined && destino.rol === 'ADMIN' && req.body.rol !== 'ADMIN') ||
    (req.body.activo !== undefined && destino.rol === 'ADMIN' && !req.body.activo);

  if (quedaSinAdmin) {
    const [[{ n }]] = await pool.query(
      "SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'ADMIN' AND activo = TRUE AND id <> ?",
      [id]
    );
    if (n === 0) {
      throw new HttpError(409, 'No se puede: este es el único administrador activo. Crea o activa otro administrador antes de cambiar este.');
    }
  }

  valores.push(id);
  await pool.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`, valores);

  log.info('usuario editado', { editado: destino.usuario, por: req.usuario.usuario });
  res.json({ ok: true });
});

/**
 * Restablecer la contraseña de otro usuario. Solo admin.
 * Queda marcado para que la persona la cambie la próxima vez que entre.
 */
const restablecerPassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { passwordNueva } = req.body;
  if (!passwordNueva || String(passwordNueva).length < 8) {
    throw new HttpError(400, 'La contraseña nueva debe tener al menos 8 caracteres.');
  }

  const [[destino]] = await pool.query('SELECT usuario FROM usuarios WHERE id = ?', [id]);
  if (!destino) throw new HttpError(404, 'Usuario no encontrado.');

  const hash = await bcrypt.hash(passwordNueva, 10);
  await pool.query(
    'UPDATE usuarios SET password_hash = ?, debe_cambiar_password = TRUE WHERE id = ?',
    [hash, id]
  );

  log.info('contraseña restablecida', { a: destino.usuario, por: req.usuario.usuario });
  res.json({ ok: true, mensaje: `Contraseña de "${destino.usuario}" restablecida. Tendrá que cambiarla al entrar.` });
});

/**
 * Desactivar un usuario. No se borra la fila: los movimientos que registró
 * apuntan a ella y el histórico tiene que seguir diciendo quién hizo qué.
 */
const desactivar = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.usuario.id) {
    throw new HttpError(409, 'No puedes desactivar tu propio usuario.');
  }

  const [[destino]] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!destino) throw new HttpError(404, 'Usuario no encontrado.');

  if (destino.rol === 'ADMIN') {
    const [[{ n }]] = await pool.query(
      "SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'ADMIN' AND activo = TRUE AND id <> ?",
      [id]
    );
    if (n === 0) throw new HttpError(409, 'No se puede: es el único administrador activo.');
  }

  await pool.query('UPDATE usuarios SET activo = FALSE WHERE id = ?', [id]);
  log.info('usuario desactivado', { desactivado: destino.usuario, por: req.usuario.usuario });
  res.json({ ok: true });
});

module.exports = { listar, autorizadores, crear, actualizar, restablecerPassword, desactivar };
