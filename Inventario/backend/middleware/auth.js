const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

/** Igual que en auth.controller: la huella de la contraseña que va en el token. */
function huellaPassword(passwordHash) {
  return crypto.createHash('sha256').update(String(passwordHash)).digest('hex').slice(0, 16);
}

/**
 * Exige un token JWT válido en el header:
 *   Authorization: Bearer <token>
 *
 * Además va SIEMPRE a la base de datos a ver cómo está el usuario ahora
 * mismo. Antes el rol y el "activo" salían del propio token: a alguien a
 * quien se le quitaban los permisos (o se le desactivaba el usuario) le
 * seguían funcionando hasta 12 horas, con los permisos viejos.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No autenticado. Falta el token.' });
  }

  let datos;
  try {
    datos = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o vencida. Inicia sesión de nuevo.' });
  }

  try {
    const [[usuario]] = await pool.query(
      'SELECT id, usuario, nombre, rol, activo, debe_cambiar_password, password_hash FROM usuarios WHERE id = ?',
      [datos.id]
    );
    if (!usuario || !usuario.activo) {
      return res.status(401).json({ error: 'Tu usuario ya no está activo. Habla con un administrador.' });
    }
    // Si la contraseña cambió después de entrar (la cambió el dueño o un
    // admin la reseteó), esta sesión ya no vale. Los tokens de antes de esta
    // versión no traen huella: esos siguen hasta que venzan (12 horas).
    if (datos.pv && datos.pv !== huellaPassword(usuario.password_hash)) {
      return res.status(401).json({ error: 'Tu contraseña cambió. Inicia sesión de nuevo.' });
    }
    req.usuario = {
      id: usuario.id,
      usuario: usuario.usuario,
      nombre: usuario.nombre,
      rol: usuario.rol,
      debeCambiarPassword: !!usuario.debe_cambiar_password,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Mientras tenga la contraseña provisional, el usuario puede mirar pero no
 * escribir. Antes esto solo lo pedía la pantalla, y bastaba con cerrar la
 * ventana para seguir trabajando con la contraseña que le puso el admin.
 */
function bloquearSiDebeCambiarPassword(req, res) {
  if (req.usuario && req.usuario.debeCambiarPassword) {
    res.status(403).json({
      error: 'Antes de registrar nada tienes que cambiar tu contraseña (botón "Cambiar contraseña", arriba a la derecha).',
    });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Roles
//
//   ADMIN    → todo: anular movimientos, eliminar rollos y materiales,
//              administrar usuarios y catálogos.
//   OPERADOR → el día a día del taller: registra entradas, salidas, mermas y
//              ajustes, y edita materiales y rollos. NO elimina ni anula nada.
//   VISTA    → solo consulta. No puede escribir absolutamente nada.
// ---------------------------------------------------------------------------

/** Solo administradores. Úsalo DESPUÉS de requireAuth. */
function requireAdmin(req, res, next) {
  if (!req.usuario || req.usuario.rol !== 'ADMIN') {
    return res.status(403).json({
      error: 'Esta acción solo la puede hacer un administrador.',
    });
  }
  if (bloquearSiDebeCambiarPassword(req, res)) return;
  next();
}

/**
 * Bloquea a los usuarios de solo lectura. Va en las rutas que escriben
 * (crear, editar, registrar movimientos) pero que no exigen ser admin.
 */
function requireEscritura(req, res, next) {
  if (!req.usuario) {
    return res.status(401).json({ error: 'No autenticado.' });
  }
  if (req.usuario.rol === 'VISTA') {
    return res.status(403).json({
      error: 'Tu usuario es de solo consulta. No puede registrar ni modificar nada.',
    });
  }
  if (bloquearSiDebeCambiarPassword(req, res)) return;
  next();
}

module.exports = { requireAuth, requireAdmin, requireEscritura };
