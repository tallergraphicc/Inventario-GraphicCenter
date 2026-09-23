// ==========================================================================
// auth.js — login, logout, cambio de contraseña y qué pantalla se muestra
// ==========================================================================

function mostrarLogin(mensaje) {
  // Si había un modal abierto (ej. cambiar contraseña), se cierra: si no,
  // quedaba encima de la pantalla de login, tapándola.
  const modales = document.getElementById('modalRoot');
  if (modales) modales.innerHTML = '';
  // La contraseña nunca se queda escrita en la pantalla de entrada: en una
  // PC compartida del taller, el siguiente entraba con un solo clic.
  const clave = document.getElementById('loginPassword');
  if (clave) clave.value = '';
  // Si se llegó aquí porque la sesión venció a mitad de algo, se dice
  const caja = document.getElementById('loginError');
  if (caja) {
    caja.textContent = mensaje || '';
    caja.classList.toggle('is-visible', !!mensaje);
  }
  document.getElementById('loginScreen').classList.remove('inv-hidden');
  document.getElementById('app').classList.add('inv-hidden');
}

function mostrarApp(usuario) {
  document.getElementById('loginScreen').classList.add('inv-hidden');
  document.getElementById('app').classList.remove('inv-hidden');

  const legibles = { ADMIN: 'Administrador', OPERADOR: 'Operador', VISTA: 'Solo consulta' };
  document.getElementById('userLabel').textContent =
    `${usuario.nombre} — ${legibles[usuario.rol] || usuario.rol}`;

  aplicarPermisos();
}

/**
 * Esconde de la pantalla lo que este usuario no puede hacer.
 *
 * Es solo para no mostrar botones que van a dar error: el permiso de verdad
 * lo aplica el backend en cada ruta. Un usuario que toquetee el HTML no gana
 * nada, el servidor lo rechaza igual.
 */
function aplicarPermisos() {
  document.querySelectorAll('.inv-solo-admin').forEach((el) => {
    el.classList.toggle('inv-hidden', !esAdmin());
  });
  document.querySelectorAll('.inv-solo-escritura').forEach((el) => {
    el.classList.toggle('inv-hidden', !puedeEscribir());
  });
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById('loginError');
  errorBox.classList.remove('is-visible');

  const usuario = document.getElementById('loginUsuario').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const data = await api.post('/auth/login', { usuario, password });
    localStorage.setItem('inv_token', data.token);
    localStorage.setItem('inv_user', JSON.stringify(data.usuario));
    mostrarApp(data.usuario);
    if (window.iniciarApp) await window.iniciarApp();

    // Si el administrador le puso una contraseña provisional, se le pide
    // cambiarla de una vez.
    if (data.usuario.debeCambiarPassword && window.abrirModalMiPassword) {
      abrirModalMiPassword(true);
    }
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.add('is-visible');
  }
});

// --------------------------------------------------------------------------
// Modo oscuro
//
// La elección se guarda en este navegador (localStorage), no en el usuario:
// cada PC del taller recuerda la suya. Se aplica con el atributo
// data-tema="oscuro" en <html>, que es lo que usan css/style.css y
// css/inventario.css para los colores oscuros. El script del <head> ya lo
// aplicó antes de pintar la página (para evitar el parpadeo); acá solo se
// mantiene sincronizado el botón y se atiende el clic.
// --------------------------------------------------------------------------
const TEMA_CLAVE = 'inv_tema';

function temaGuardado() {
  try { return localStorage.getItem(TEMA_CLAVE) === 'oscuro' ? 'oscuro' : 'claro'; }
  catch (err) { return 'claro'; }
}

function aplicarTema(tema) {
  if (tema === 'oscuro') document.documentElement.setAttribute('data-tema', 'oscuro');
  else document.documentElement.removeAttribute('data-tema');
  const btn = document.getElementById('btnTema');
  if (btn) btn.textContent = tema === 'oscuro' ? '☀️ Modo claro' : '🌙 Modo oscuro';
}

document.getElementById('btnTema').addEventListener('click', () => {
  const nuevo = temaGuardado() === 'oscuro' ? 'claro' : 'oscuro';
  try { localStorage.setItem(TEMA_CLAVE, nuevo); } catch (err) { /* sin localStorage, no se recuerda, pero igual cambia */ }
  aplicarTema(nuevo);
});

// El botón ya existe en el HTML desde el arranque (está dentro de #app,
// solo oculto por CSS hasta iniciar sesión), así que el texto se puede
// poner de una vez, sin esperar el login.
aplicarTema(temaGuardado());

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('inv_token');
  localStorage.removeItem('inv_user');
  mostrarLogin();
});

document.getElementById('btnMiPassword').addEventListener('click', () => {
  if (window.abrirModalMiPassword) abrirModalMiPassword(false);
});

// Al cargar la página, revisa si ya había una sesión guardada.
// IMPORTANTE: esto se ejecuta en DOMContentLoaded, no de inmediato — así nos
// aseguramos de que TODOS los scripts (incluyendo app.js, que define
// window.iniciarApp) ya terminaron de cargar antes de intentar usarla.
// Sin este cambio, al recargar la página se queda en blanco.
document.addEventListener('DOMContentLoaded', function initAuth() {
  const token = localStorage.getItem('inv_token');
  const userRaw = localStorage.getItem('inv_user');
  if (token && userRaw) {
    try {
      mostrarApp(JSON.parse(userRaw));
      if (window.iniciarApp) window.iniciarApp();
      // El servidor manda cómo está el usuario AHORA: si le cambiaron el rol
      // o todavía tiene la contraseña provisional, se nota al recargar.
      api.get('/auth/yo').then((r) => {
        if (!r || !r.usuario) return;
        localStorage.setItem('inv_user', JSON.stringify(r.usuario));
        mostrarApp(r.usuario);
        if (r.usuario.debeCambiarPassword && window.abrirModalMiPassword) abrirModalMiPassword(true);
      }).catch(() => { /* si falla, la sesión ya se manejó en apiFetch */ });
    } catch (err) {
      // Sesión guardada con formato viejo (antes se entraba con correo):
      // se descarta y se pide entrar de nuevo.
      localStorage.removeItem('inv_token');
      localStorage.removeItem('inv_user');
      mostrarLogin();
    }
  } else {
    mostrarLogin();
  }
});
