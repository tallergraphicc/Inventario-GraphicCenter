/**
 * Middleware de errores centralizado. Cualquier controlador que haga
 * `next(err)` o lance un error dentro de un async handler envuelto
 * en asyncHandler() termina aquí. Nunca se expone el detalle interno
 * (mensajes de MySQL, stack) al cliente — solo un mensaje seguro.
 */
const log = require('../config/log');

function errorHandler(err, req, res, next) {
  // Los errores esperados (validaciones, 404, permisos) no son fallas del
  // sistema: se registran como aviso. Lo demás sí queda como ERROR con su
  // stack, para poder revisarlo después en la bitácora.
  if (err.status && err.status < 500) {
    log.aviso(`${req.method} ${req.originalUrl} → ${err.status}`, {
      mensaje: err.message,
      usuario: req.usuario ? req.usuario.usuario : null,
    });
  } else {
    log.error(`${req.method} ${req.originalUrl}`, {
      mensaje: err.message,
      codigo: err.code,
      usuario: req.usuario ? req.usuario.usuario : null,
      stack: err.stack,
    });
  }

  // Solo se devuelven los mensajes que escribimos nosotros (HttpError). Los de
  // otras librerías pueden repetir lo que mandó el cliente o rutas internas.
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: 'La solicitud no es válida.' });
  }

  // Dos personas guardando lo mismo al mismo tiempo: no es una falla, hay que
  // reintentar. Sin esto salía "Error interno del servidor".
  if (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT') {
    return res.status(409).json({
      error: 'Otra persona estaba guardando algo de este mismo material en ese momento. Intenta de nuevo.',
    });
  }

  // Un número que no es número (llegó "abc" o quedó vacío)
  if (err.code === 'ER_BAD_FIELD_ERROR' && /NaN/.test(err.sqlMessage || '')) {
    return res.status(400).json({ error: 'Uno de los números escritos no es válido.' });
  }
  if (['ER_TRUNCATED_WRONG_VALUE', 'ER_WRONG_VALUE', 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',
    'WARN_DATA_TRUNCATED', 'ER_WARN_DATA_OUT_OF_RANGE'].includes(err.code)) {
    return res.status(400).json({ error: 'Una fecha o un número no tiene el formato correcto (o es demasiado grande).' });
  }
  if (err.code === 'ER_BAD_NULL_ERROR') {
    return res.status(400).json({ error: 'Falta un dato obligatorio.' });
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW') {
    return res.status(400).json({ error: 'Algo de lo que elegiste ya no existe. Recarga la pantalla e intenta de nuevo.' });
  }
  if (err.code === 'ER_DATA_TOO_LONG') {
    return res.status(400).json({ error: 'Uno de los textos es demasiado largo.' });
  }

  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Ya existe un registro con ese valor único (código duplicado).' });
  }

  // Falta una tabla o una columna: casi siempre es que se copió código nuevo
  // pero no se corrió su migración. Se dice así, en vez de un "error interno"
  // que no ayuda a nadie. El detalle exacto queda en la bitácora.
  if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR') {
    return res.status(500).json({
      error: 'La base de datos no está al día: falta correr una migración de la carpeta database. ' +
        'El detalle quedó en la bitácora (carpeta logs).',
    });
  }

  res.status(500).json({ error: 'Error interno del servidor.' });
}

/** Envuelve un handler async para que sus errores lleguen al errorHandler. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Error con status HTTP explícito, para lanzar desde servicios/controladores. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { errorHandler, asyncHandler, HttpError };
