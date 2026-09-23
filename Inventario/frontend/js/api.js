// ==========================================================================
// api.js — wrapper de fetch hacia el backend
// ==========================================================================

const API_BASE = '/api';

/**
 * Escapa texto antes de meterlo dentro de HTML.
 *
 * Sin esto, cualquier dato con comillas o signos de mayor/menor rompe la
 * pantalla. Es muy fácil que pase en este taller: una descripción como
 * Vinil 54" brillante cortaba el value="" del formulario de edición y el
 * campo salía vacío o a medias.
 */
function esc(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Un texto como argumento de un onclick="...".
 *
 * Con esc() no basta: el navegador vuelve a convertir &#39; en ' ANTES de
 * correr el JS, así que un código con comilla (ej. COR-4'X8') rompía el
 * botón — y, peor, permitía colar código. JSON.stringify lo deja como un
 * texto JS válido y esc() lo protege dentro del atributo.
 */
function argJs(valor) {
  return esc(JSON.stringify(String(valor)));
}

/**
 * Formatea un monto en balboas. Devuelve null si no se puede calcular, para
 * que la pantalla pueda decir "sin costo" en vez de mostrar un cero que
 * parecería que el material no vale nada.
 */
function money(valor) {
  if (valor === null || valor === undefined || valor === '' || Number.isNaN(Number(valor))) return null;
  return 'B/. ' + Number(valor).toLocaleString('es-PA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getToken() {
  return localStorage.getItem('inv_token');
}

// Cuántas peticiones que ESCRIBEN están en curso. Sirve para no registrar dos
// veces lo mismo por un doble clic (ver bloquearDobleEnvio más abajo).
let ESCRITURAS_EN_CURSO = 0;

function marcarGuardando(delta) {
  ESCRITURAS_EN_CURSO = Math.max(0, ESCRITURAS_EN_CURSO + delta);
  document.body.classList.toggle('inv-guardando', ESCRITURAS_EN_CURSO > 0);
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const escribe = options.method && options.method !== 'GET';
  if (escribe) marcarGuardando(1);

  let res;
  let data;
  try {
    try {
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    } catch (err) {
      // Sin conexión con el servidor (apagado, red caída, VM reiniciando)
      throw new Error('No hay conexión con el servidor del inventario. Revisa que esté encendido e intenta de nuevo.');
    }
    // La respuesta se lee ENTERA antes de soltar el candado del doble envío:
    // si no, quedaba un instante en que un segundo clic volvía a mandar
    data = await res.json().catch(() => ({}));
  } finally {
    if (escribe) marcarGuardando(-1);
  }

  // Un 401 al entrar o al cambiar la contraseña NO es una sesión vencida: es
  // que la contraseña está mal. Antes cerraba la sesión y sacaba al usuario.
  const esLoginOPassword = path.startsWith('/auth/login') || path.startsWith('/auth/mi-password');
  if (res.status === 401 && !esLoginOPassword) {
    const mensaje = data.error || 'Sesión vencida. Inicia sesión de nuevo.';
    localStorage.removeItem('inv_token');
    localStorage.removeItem('inv_user');
    // Se explica en la pantalla de entrada por qué se salió (antes aparecía
    // el login sin ningún mensaje, a mitad de lo que se estaba haciendo)
    mostrarLogin(mensaje);
    throw new Error(mensaje);
  }

  if (!res.ok) throw new Error(data.error || 'Ocurrió un error inesperado.');
  return data;
}

/**
 * Evita el doble clic en cualquier formulario: mientras hay algo guardándose,
 * un segundo envío no llega al servidor. Un doble clic en "Registrar entrada"
 * llegaba a registrar dos entradas.
 */
document.addEventListener('submit', (e) => {
  if (ESCRITURAS_EN_CURSO > 0) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

// --------------------------------------------------------------------------
// Usuario en sesión y permisos
//
// El rol se guarda junto con el token al entrar. La pantalla lo usa para
// esconder lo que la persona no puede hacer; el permiso de verdad lo aplica
// el backend, esto es solo para no mostrar botones que van a dar error.
// --------------------------------------------------------------------------

function usuarioActual() {
  try {
    return JSON.parse(localStorage.getItem('inv_user') || 'null');
  } catch (err) {
    return null;
  }
}

function esAdmin() {
  const u = usuarioActual();
  return !!u && u.rol === 'ADMIN';
}

function puedeEscribir() {
  const u = usuarioActual();
  return !!u && u.rol !== 'VISTA';
}

/** Nombre corto del usuario conectado, para llenar los campos de "quién". */
function nombreUsuario() {
  const u = usuarioActual();
  return u ? u.nombre : '';
}

/**
 * Descarga un archivo del backend (CSV) mandando el token.
 * No se puede usar un <a href> normal porque ahí no viaja la cabecera de
 * autenticación y el servidor responde 401.
 */
async function descargar(path, nombreSugerido) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo generar el archivo.');
  }

  // El nombre viene en la cabecera Content-Disposition del servidor
  const cabecera = res.headers.get('Content-Disposition') || '';
  const coincidencia = cabecera.match(/filename="?([^"]+)"?/);
  const nombre = coincidencia ? coincidencia[1] : nombreSugerido;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => apiFetch(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path, body) => apiFetch(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
};
