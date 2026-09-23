const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');
const log = require('../config/log');

// ---------------------------------------------------------------------------
// Freno a los intentos de adivinar contraseñas.
//
// Sin esto, un programa puede probar miles de contraseñas por minuto contra
// el sistema (está en la red de la empresa, con la dirección IP a la vista).
// Después de 10 intentos fallidos desde el mismo lugar, hay que esperar 15
// minutos. Un intento bueno borra la cuenta.
// ---------------------------------------------------------------------------
const MAX_INTENTOS = 10;
const ESPERA_MS = 15 * 60 * 1000;
const intentos = new Map();

function llave(req, identificador) {
  return `${req.ip}|${String(identificador).toLowerCase()}`;
}

function bloqueado(clave) {
  const registro = intentos.get(clave);
  if (!registro) return 0;
  if (Date.now() - registro.desde > ESPERA_MS) { intentos.delete(clave); return 0; }
  if (registro.fallos < MAX_INTENTOS) return 0;
  return Math.ceil((ESPERA_MS - (Date.now() - registro.desde)) / 60000);
}

function anotarFallo(clave) {
  const registro = intentos.get(clave);
  if (!registro || Date.now() - registro.desde > ESPERA_MS) {
    intentos.set(clave, { fallos: 1, desde: Date.now() });
  } else {
    registro.fallos += 1;
  }
  // Tope duro: si alguien llena la lista a propósito, se tiran los más viejos
  if (intentos.size > 5000) {
    const sobran = intentos.size - 5000;
    let i = 0;
    for (const k of intentos.keys()) { if (i++ >= sobran) break; intentos.delete(k); }
  }
}

// Cada 10 minutos se borra lo vencido, aunque nadie intente entrar
setInterval(() => {
  const ahora = Date.now();
  for (const [k, v] of intentos) if (ahora - v.desde > ESPERA_MS) intentos.delete(k);
}, 10 * 60 * 1000).unref();

/**
 * "Huella" de la contraseña que va dentro del token. Si la contraseña cambia
 * (la cambia el dueño o un admin la resetea), los tokens viejos dejan de
 * servir: quien tuviera una sesión abierta con la contraseña anterior queda
 * afuera. No revela nada de la contraseña: es un pedazo del hash del hash.
 */
function huellaPassword(passwordHash) {
  return crypto.createHash('sha256').update(String(passwordHash)).digest('hex').slice(0, 16);
}

function firmarToken(usuario) {
  const payload = {
    id: usuario.id,
    usuario: usuario.usuario,
    nombre: usuario.nombre,
    rol: usuario.rol,
    pv: huellaPassword(usuario.password_hash),
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  });
  return { token, payload };
}

/** Lo escrito en "usuario" puede ser una contraseña mal tecleada: no se guarda entero. */
function tapado(texto) {
  const t = String(texto);
  return t.length <= 2 ? '**' : `${t.slice(0, 2)}***(${t.length})`;
}

/**
 * Entrar al sistema con USUARIO y contraseña.
 *
 * Antes se entraba con correo, lo que obligaba a inventar correos ficticios
 * para la gente del taller. Ahora se entra con un nombre de usuario corto
 * (ej. "javier"). El correo queda como dato opcional para avisos a futuro.
 *
 * Por compatibilidad, si alguien todavía manda `email`, se acepta: se busca
 * tanto por usuario como por correo.
 */
const login = asyncHandler(async (req, res) => {
  const crudo = req.body.usuario || req.body.email || '';
  const identificador = typeof crudo === 'string' ? crudo.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!identificador || !password) {
    throw new HttpError(400, 'Usuario y contraseña son obligatorios.');
  }
  // Un usuario o una contraseña de miles de letras no son reales: se cortan
  // aquí, antes de guardarlos en la lista de intentos o pasarlos a bcrypt.
  if (identificador.length > 150 || password.length > 200) {
    throw new HttpError(400, 'Usuario o contraseña demasiado largos.');
  }

  const clave = llave(req, identificador);
  const minutos = bloqueado(clave);
  if (minutos) {
    log.aviso('login bloqueado por demasiados intentos', { usuario: tapado(identificador), ip: req.ip });
    throw new HttpError(429, `Demasiados intentos fallidos. Espera ${minutos} minuto(s) y vuelve a probar.`);
  }
  // El intento se cuenta YA, antes de ir a la base de datos. Si se contaba
  // al final, muchos intentos mandados a la vez pasaban todos el control
  // antes de que el primero se anotara. Si la contraseña es buena, se borra.
  anotarFallo(clave);

  const [[usuario]] = await pool.query(
    `SELECT * FROM usuarios
     WHERE (usuario = ? OR email = ?) AND activo = TRUE`,
    [identificador, identificador]
  );

  // Mismo mensaje exista o no el usuario: no se le regala a nadie la pista
  // de qué usuarios son válidos.
  if (!usuario) {
    log.aviso('login fallido (usuario inexistente)', { usuario: tapado(identificador), ip: req.ip });
    throw new HttpError(401, 'Usuario o contraseña incorrectos.');
  }

  const valido = await bcrypt.compare(password, usuario.password_hash);
  if (!valido) {
    log.aviso('login fallido (contraseña incorrecta)', { usuario: usuario.usuario, ip: req.ip });
    throw new HttpError(401, 'Usuario o contraseña incorrectos.');
  }
  intentos.delete(clave);

  await pool.query('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?', [usuario.id]);

  const { token, payload } = firmarToken(usuario);
  const { pv, ...publico } = payload;

  log.info('login', { usuario: usuario.usuario, rol: usuario.rol });

  res.json({
    token,
    usuario: { ...publico, debeCambiarPassword: !!usuario.debe_cambiar_password },
  });
});

/**
 * Datos del usuario actual. Vienen de la base de datos (requireAuth los
 * refresca en cada petición), así que un cambio de rol o la contraseña
 * provisional se notan al recargar la pantalla.
 */
const yo = asyncHandler(async (req, res) => {
  res.json({ usuario: req.usuario });
});

/**
 * Cambiar mi propia contraseña. Exige la actual, para que nadie que encuentre
 * una sesión abierta pueda dejar al dueño afuera.
 */
const cambiarMiPassword = asyncHandler(async (req, res) => {
  const { passwordActual, passwordNueva } = req.body;
  if (!passwordActual || !passwordNueva || typeof passwordActual !== 'string' || typeof passwordNueva !== 'string') {
    throw new HttpError(400, 'Hay que escribir la contraseña actual y la nueva.');
  }
  if (passwordNueva.length > 200) throw new HttpError(400, 'La contraseña nueva es demasiado larga.');
  if (typeof passwordNueva !== 'string' || passwordNueva.length < 8) {
    throw new HttpError(400, 'La contraseña nueva debe tener al menos 8 caracteres.');
  }
  if (/^(12345678|contrasena|contraseña|password|graphiccenter|inventario)/i.test(passwordNueva)) {
    throw new HttpError(400, 'Esa contraseña es muy fácil de adivinar. Usa uno o dos datos que solo tú sepas.');
  }
  if (passwordNueva === passwordActual) {
    throw new HttpError(400, 'La contraseña nueva tiene que ser distinta de la actual.');
  }

  const [[usuario]] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [req.usuario.id]);
  if (!usuario) throw new HttpError(404, 'Usuario no encontrado.');

  const valido = await bcrypt.compare(passwordActual, usuario.password_hash);
  if (!valido) throw new HttpError(401, 'La contraseña actual no es correcta.');

  const hash = await bcrypt.hash(passwordNueva, 10);
  await pool.query(
    'UPDATE usuarios SET password_hash = ?, debe_cambiar_password = FALSE WHERE id = ?',
    [hash, req.usuario.id]
  );

  log.info('cambio de contraseña propia', { usuario: usuario.usuario });
  // Con la contraseña nueva los tokens viejos dejan de servir (también el
  // de esta sesión), así que se entrega uno nuevo para seguir trabajando.
  const { token } = firmarToken({ ...usuario, password_hash: hash });
  res.json({ ok: true, token, mensaje: 'Contraseña actualizada.' });
});

module.exports = { login, yo, cambiarMiPassword, huellaPassword };
