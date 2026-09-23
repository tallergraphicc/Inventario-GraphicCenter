// ==========================================================================
// usuarios.js — pantalla de usuarios (solo admin) y cambio de contraseña
// ==========================================================================

// Los administradores activos, que llenan el desplegable de "Quién autoriza".
// Se cargan una vez al entrar y se refrescan cuando cambia algo en Usuarios.
let AUTORIZADORES = [];

const ROLES_LEGIBLES = {
  ADMIN: 'Administrador',
  OPERADOR: 'Operador',
  VISTA: 'Solo consulta',
};

const ROLES_EXPLICADOS = {
  ADMIN: 'Todo: registra, edita, elimina, anula movimientos y administra usuarios.',
  OPERADOR: 'El día a día: registra entradas, salidas, mermas y ajustes, y edita. No elimina ni anula.',
  VISTA: 'Solo consulta. No puede registrar ni modificar nada.',
};

/** Trae los admins para el campo "Autoriza". Lo puede pedir cualquiera. */
async function cargarAutorizadores() {
  try {
    AUTORIZADORES = await api.get('/usuarios/autorizadores');
  } catch (err) {
    AUTORIZADORES = [];
  }
}

/**
 * Desplegable de "Quién autoriza" con los administradores.
 *
 * Antes era un campo de texto libre donde cada quien escribía el nombre como
 * le parecía ("Javier", "javier", "Ing. Javier"), y después no había forma de
 * filtrar por eso. Ahora se elige de la lista.
 */
function opcionesAutoriza(seleccionado) {
  if (!AUTORIZADORES.length) {
    return '<option value="">(no hay administradores registrados)</option>';
  }
  return '<option value="">Selecciona quién autoriza</option>' +
    AUTORIZADORES.map((a) =>
      `<option value="${esc(a.nombre)}" ${a.nombre === seleccionado ? 'selected' : ''}>${esc(a.nombre)}</option>`
    ).join('');
}

// ==========================================================================
// Cambiar mi propia contraseña
// ==========================================================================
function abrirModalMiPassword(obligatorio) {
  // Si es obligatorio, la ventana no se cierra haciendo clic afuera: antes
  // bastaba con eso para seguir usando la contraseña provisional.
  abrirModal(`
    ${obligatorio ? '' : '<button class="inv-modal-close" onclick="cerrarModal()">&times;</button>'}
    <h3 class="font-display">Cambiar mi contraseña</h3>
    ${obligatorio ? `<div class="inv-error is-visible" style="background:rgba(31,173,224,0.08); border-left-color:var(--color-cyan); color:var(--color-cyan-dark);">
       Tu contraseña fue asignada por un administrador. Cámbiala ahora por una tuya.
     </div>` : ''}
    <form id="formMiPassword">
      <div class="form-row"><label>Contraseña actual *</label>
        <input type="password" id="mp-actual" required autocomplete="current-password"></div>
      <div class="form-row"><label>Contraseña nueva *</label>
        <input type="password" id="mp-nueva" required minlength="8" autocomplete="new-password">
        <p class="inv-hint" style="margin:0.3rem 0 0;">Mínimo 8 caracteres.</p></div>
      <div class="form-row"><label>Repetir la nueva *</label>
        <input type="password" id="mp-repetir" required minlength="8" autocomplete="new-password"></div>
      <div id="mp-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        ${obligatorio ? '' : '<button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>'}
        <button type="submit" class="btn btn-magenta chip">Guardar</button>
      </div>
    </form>
  `, { fijo: !!obligatorio });

  document.getElementById('formMiPassword').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('mp-error');
    const nueva = document.getElementById('mp-nueva').value;
    if (nueva !== document.getElementById('mp-repetir').value) {
      errBox.textContent = 'Las dos contraseñas nuevas no coinciden.';
      errBox.classList.add('is-visible');
      return;
    }
    try {
      const r = await api.put('/auth/mi-password', {
        passwordActual: document.getElementById('mp-actual').value,
        passwordNueva: nueva,
      });
      // Con la contraseña nueva, el servidor da un token nuevo (los de antes
      // dejan de servir, así una sesión abierta en otra PC queda afuera)
      if (r && r.token) localStorage.setItem('inv_token', r.token);
      const u = usuarioActual();
      if (u) { u.debeCambiarPassword = false; localStorage.setItem('inv_user', JSON.stringify(u)); }
      cerrarModal();
      alert('Contraseña actualizada.');
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

// ==========================================================================
// Listado de usuarios
// ==========================================================================
async function renderUsuarios() {
  const tbody = document.getElementById('usuariosBody');
  let usuarios;
  try {
    usuarios = await api.get('/usuarios');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="inv-empty">${esc(err.message)}</div></td></tr>`;
    return;
  }

  const yo = usuarioActual();
  tbody.innerHTML = usuarios.map((u) => `
    <tr${u.activo ? '' : ' style="opacity:0.5;"'}>
      <td class="mono">${esc(u.usuario)}${u.id === (yo && yo.id) ? ' <span class="inv-chip inv-chip-SIN_MINIMO">tú</span>' : ''}</td>
      <td>${esc(u.nombre)}</td>
      <td><span class="inv-chip ${u.rol === 'ADMIN' ? 'inv-chip-NEGATIVO' : u.rol === 'VISTA' ? 'inv-chip-AGOTADO' : 'inv-chip-NORMAL'}">${esc(ROLES_LEGIBLES[u.rol] || u.rol)}</span></td>
      <td>${u.activo ? 'Activo' : 'Desactivado'}</td>
      <td>${u.ultimo_acceso ? esc(new Date(u.ultimo_acceso).toLocaleString()) : '—'}</td>
      <td><div class="inv-row-actions">
        <button onclick="abrirModalEditarUsuario(${u.id})">Editar</button>
        <button onclick="abrirModalRestablecer(${u.id})">Contraseña</button>
        ${u.activo && u.id !== (yo && yo.id)
          ? `<button onclick="desactivarUsuario(${u.id})" style="color:var(--color-magenta-dark);">Desactivar</button>`
          : ''}
      </div></td>
    </tr>
  `).join('');

  USUARIOS_CACHE = usuarios;
}

let USUARIOS_CACHE = [];

function camposDeUsuario(u) {
  return `
    <div class="form-two-col">
      <div class="form-row"><label>Usuario *</label>
        <input type="text" id="u-usuario" required value="${esc(u ? u.usuario : '')}"
               ${u ? 'disabled' : ''} placeholder="javier" autocapitalize="none" spellcheck="false">
        ${u ? '<p class="inv-hint" style="margin:0.3rem 0 0;">El usuario no se cambia.</p>'
            : '<p class="inv-hint" style="margin:0.3rem 0 0;">Minúsculas, sin espacios ni acentos.</p>'}
      </div>
      <div class="form-row"><label>Nombre completo *</label>
        <input type="text" id="u-nombre" required value="${esc(u ? u.nombre : '')}" placeholder="Javier Pérez">
        <p class="inv-hint" style="margin:0.3rem 0 0;">Este es el nombre que sale en los movimientos.</p>
      </div>
    </div>
    <div class="form-row"><label>Rol *</label>
      <select id="u-rol" required onchange="explicarRol()">
        ${Object.keys(ROLES_LEGIBLES).map((r) =>
          `<option value="${r}" ${u && u.rol === r ? 'selected' : ''}>${ROLES_LEGIBLES[r]}</option>`).join('')}
      </select>
      <p class="inv-hint" id="u-rol-explica" style="margin:0.4rem 0 0;"></p>
    </div>
    <div class="form-row"><label>Correo (opcional)</label>
      <input type="email" id="u-email" value="${esc(u && u.email ? u.email : '')}" placeholder="Déjalo vacío si no tiene">
      <p class="inv-hint" style="margin:0.3rem 0 0;">No hace falta para entrar. Es solo para avisos más adelante.</p>
    </div>
  `;
}

function explicarRol() {
  const sel = document.getElementById('u-rol');
  const caja = document.getElementById('u-rol-explica');
  if (sel && caja) caja.textContent = ROLES_EXPLICADOS[sel.value] || '';
}

function abrirModalNuevoUsuario() {
  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Nuevo usuario</h3>
    <form id="formNuevoUsuario">
      ${camposDeUsuario(null)}
      <div class="form-row"><label>Contraseña provisional *</label>
        <input type="password" id="u-password" required minlength="8">
        <p class="inv-hint" style="margin:0.3rem 0 0;">Mínimo 8 caracteres. La persona tendrá que cambiarla la primera vez que entre.</p>
      </div>
      <div id="u-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Crear usuario</button>
      </div>
    </form>
  `);
  explicarRol();

  document.getElementById('formNuevoUsuario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('u-error');
    try {
      await api.post('/usuarios', {
        usuario: document.getElementById('u-usuario').value.trim().toLowerCase(),
        nombre: document.getElementById('u-nombre').value.trim(),
        rol: document.getElementById('u-rol').value,
        email: document.getElementById('u-email').value.trim() || null,
        password: document.getElementById('u-password').value,
      });
      cerrarModal();
      await renderUsuarios();
      await cargarAutorizadores();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

function abrirModalEditarUsuario(id) {
  const u = USUARIOS_CACHE.find((x) => x.id === id);
  if (!u) return;
  // A uno mismo no se le cambia el rol ni se desactiva (el servidor lo niega:
  // así nadie se queda afuera por error, ni el último administrador)
  const yo = usuarioActual();
  const esUnoMismo = !!yo && yo.id === u.id;

  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Editar — <span class="mono">${esc(u.usuario)}</span></h3>
    <form id="formEditarUsuario">
      ${camposDeUsuario(u)}
      <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; margin-bottom:1rem;">
        <input type="checkbox" id="u-activo" ${u.activo ? 'checked' : ''} ${esUnoMismo ? 'disabled' : ''}> Usuario activo (puede entrar al sistema)
      </label>
      ${esUnoMismo ? `<p class="inv-hint">Es tu propio usuario: tu rol y si estás activo los cambia otro administrador.</p>` : ''}
      <div id="u-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Guardar cambios</button>
      </div>
    </form>
  `);
  explicarRol();
  if (esUnoMismo) document.getElementById('u-rol').disabled = true;

  document.getElementById('formEditarUsuario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('u-error');
    try {
      const nombre = document.getElementById('u-nombre').value.trim();
      await api.put(`/usuarios/${id}`, {
        nombre,
        ...(esUnoMismo ? {} : {
          rol: document.getElementById('u-rol').value,
          activo: document.getElementById('u-activo').checked,
        }),
        email: document.getElementById('u-email').value.trim() || null,
      });
      // Si me cambié el nombre, se ve arriba y en los campos de "quién" de una vez
      if (esUnoMismo) {
        const actual = usuarioActual();
        if (actual) {
          actual.nombre = nombre;
          localStorage.setItem('inv_user', JSON.stringify(actual));
          mostrarApp(actual);
        }
      }
      cerrarModal();
      await renderUsuarios();
      await cargarAutorizadores();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

function abrirModalRestablecer(id) {
  const u = USUARIOS_CACHE.find((x) => x.id === id);
  if (!u) return;

  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Contraseña de <span class="mono">${esc(u.usuario)}</span></h3>
    <p class="inv-hint">Se le asigna una contraseña provisional. La persona tendrá que cambiarla la próxima vez que entre.</p>
    <form id="formRestablecer">
      <div class="form-row"><label>Contraseña provisional *</label>
        <input type="password" id="rp-nueva" required minlength="8"></div>
      <div id="rp-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Restablecer</button>
      </div>
    </form>
  `);

  document.getElementById('formRestablecer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('rp-error');
    try {
      const r = await api.put(`/usuarios/${id}/password`, {
        passwordNueva: document.getElementById('rp-nueva').value,
      });
      cerrarModal();
      alert(r.mensaje);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

async function desactivarUsuario(id) {
  const u = USUARIOS_CACHE.find((x) => x.id === id);
  if (!u) return;
  if (!confirm(`¿Desactivar a "${u.nombre}"? No podrá entrar, pero sus movimientos siguen en el histórico.`)) return;
  try {
    await api.delete(`/usuarios/${id}`);
    await renderUsuarios();
    await cargarAutorizadores();
  } catch (err) {
    alert(err.message);
  }
}

function initUsuariosListeners() {
  const btn = document.getElementById('btnNuevoUsuario');
  if (btn) btn.addEventListener('click', abrirModalNuevoUsuario);
}
