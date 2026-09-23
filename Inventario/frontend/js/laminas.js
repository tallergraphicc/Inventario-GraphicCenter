// ==========================================================================
// laminas.js — pestaña Láminas y la salida/merma por piezas
//
// Materiales por lámina = los que están en la unidad "Lámina": acrílico,
// MDF, coroplast, caucho para sellos, foam board, PVC espumoso (Sintra).
// Siempre se compran de 4x8 pies (48x96 pulg. = 32 pie²).
//
// La existencia se lleva en láminas equivalentes (1 = una de 4x8) y en
// pantalla se muestra siempre también en pies².
// ==========================================================================

const PIE2_POR_LAMINA = 32;
const RETAZO_MIN_PULG = 12;
const LAMINAS_CACHE = {};        // id de lámina → lámina (con restante)
const LAMINAS_MATERIALES = {};   // id de material → material con resumen y láminas
const LAMINAS_VER_COMPLETAS = new Set(); // materiales donde se despliegan las completas

const ESTADOS_LAMINA = {
  COMPLETA: 'Completa', ABIERTA: 'Abierta', RETAZOS: 'Retazos', AGOTADA: 'Agotada',
};

/** Láminas equivalentes → pies², con 2 decimales. */
function aPies2(laminas) {
  return Math.round(Number(laminas || 0) * PIE2_POR_LAMINA * 100) / 100;
}

function numero(n, decimales = 2) {
  return Number(n || 0).toLocaleString('es-PA', { maximumFractionDigits: decimales });
}

/** "11.5 láminas · 368 pie²" */
function textoLaminas(laminas) {
  const l = Number(laminas || 0);
  return `${numero(l, 2)} lámina${Math.abs(l - 1) < 0.0001 ? '' : 's'} · ${numero(aPies2(l))} pie²`;
}

function chipEstadoLamina(estado) {
  const clase = estado === 'COMPLETA' ? 'inv-chip-NORMAL'
    : estado === 'ABIERTA' ? 'inv-chip-SIN_MINIMO'
    : estado === 'RETAZOS' ? 'inv-chip-BAJO'
    : 'inv-chip-AGOTADO';
  return `<span class="inv-chip ${clase}">${esc(ESTADOS_LAMINA[estado] || estado)}</span>`;
}

/** Resumen corto de un material: "10 completas + 2 abiertas (48 pie²) · Retazos 3 pie²" */
function textoDisponible(r) {
  const partes = [];
  if (r.completas) partes.push(`${r.completas} completa${r.completas === 1 ? '' : 's'}`);
  if (r.abiertas) partes.push(`${r.abiertas} abierta${r.abiertas === 1 ? '' : 's'} (${numero(r.enAbiertasPies2)} pie²)`);
  let texto = partes.length ? partes.join(' + ') : 'Nada disponible';
  if (r.enRetazos > 0) texto += ` · Retazos: ${numero(r.enRetazosPies2)} pie²`;
  return texto;
}

async function traerLaminas(materialId) {
  const params = new URLSearchParams();
  if (materialId) params.set('materialId', materialId);
  const r = await api.get(`/laminas?${params.toString()}`);
  r.materiales.forEach((m) => {
    LAMINAS_MATERIALES[m.id] = m;
    m.laminas.forEach((l) => { LAMINAS_CACHE[l.id] = l; });
  });
  return r.materiales;
}

// ==========================================================================
// Pestaña Láminas
// ==========================================================================

async function renderLaminas() {
  const cont = document.getElementById('laminasBody');
  let materiales;
  try {
    materiales = await traerLaminas(document.getElementById('laminasFiltroMaterial').value);
  } catch (err) {
    cont.innerHTML = `<div class="inv-error is-visible">No se pudieron cargar las láminas: ${esc(err.message)}</div>`;
    return;
  }

  // El filtro de materiales se rearma cada vez (pudieron crear uno nuevo),
  // conservando el que estaba elegido
  const sel = document.getElementById('laminasFiltroMaterial');
  const elegido = sel.value;
  const todos = (CATALOGOS.materiales || []).filter(esMaterialDeLamina);
  const opciones = '<option value="">Todos los materiales</option>' +
    todos.map((m) => `<option value="${m.id}" ${String(m.id) === elegido ? 'selected' : ''}>${esc(m.codigo)} — ${esc(m.descripcion)}</option>`).join('');
  if (sel.innerHTML !== opciones) sel.innerHTML = opciones;

  const soloConMaterial = document.getElementById('laminasSoloDisponibles').checked;
  const visibles = materiales.filter((m) => !soloConMaterial || m.resumen.total > 0.0001 || m.sin_lamina > 0.0001);

  if (!visibles.length) {
    cont.innerHTML = `<div class="inv-empty">
      ${materiales.length ? 'Ningún material por lámina tiene material ahora.' : `Todavía no hay materiales por lámina.<br>
      Crea el material (ej. "Acrílico negro 3 mm") con la unidad <strong>Lámina</strong>, o cambia la unidad
      de uno que ya exista en Inventario → Editar.`}
    </div>`;
    return;
  }

  cont.innerHTML = visibles.map(tarjetaMaterialLamina).join('');
}

function tarjetaMaterialLamina(m) {
  const r = m.resumen;
  const escribe = puedeEscribir();
  const valor = m.costo != null ? money(Number(m.existencia) * Number(m.costo)) : null;

  // Lo contado que no está en ninguna lámina (típico: lo que había antes)
  let aviso = '';
  if (m.sin_lamina > 0.0001) {
    const completas = Math.floor(m.sin_lamina + 0.0001);
    const resto = Math.round((m.sin_lamina - completas) * 10000) / 10000;
    aviso = `
      <div class="inv-lamina-aviso">
        <div>
          <strong>${esc(textoLaminas(m.sin_lamina))}</strong> contadas en la existencia no están registradas
          como láminas${resto > 0.0001 ? ` (${completas} completa${completas === 1 ? '' : 's'} y un pedazo de ${numero(aPies2(resto))} pie²)` : ''}.
          Hay que registrarlas para poder sacar cortes.
        </div>
        ${escribe ? `<button class="btn btn-magenta chip" onclick="crearLaminasDelConteo(${m.id})">Crear las láminas</button>` : ''}
      </div>`;
  } else if (m.sin_lamina < -0.0001) {
    aviso = `
      <div class="inv-lamina-aviso es-error">
        Las láminas suman <strong>${esc(textoLaminas(-m.sin_lamina))}</strong> más que la existencia.
        Revisa cuál no existe y corrígela o elimínala.
      </div>`;
  }

  const laminas = m.laminas.slice();
  const completas = laminas.filter((l) => l.estado === 'COMPLETA');
  const otras = laminas.filter((l) => l.estado !== 'COMPLETA')
    .sort((a, b) => (a.estado === 'RETAZOS') - (b.estado === 'RETAZOS') || a.restante - b.restante);
  const verCompletas = LAMINAS_VER_COMPLETAS.has(m.id) || completas.length <= 4;

  const fila = (l) => `
    <tr>
      <td class="mono">${esc(l.id)}</td>
      <td>${chipEstadoLamina(l.estado)}</td>
      <td class="num"><strong>${numero(l.restante_pies2)}</strong> pie²
        <div class="inv-sub">${numero(l.restante, 4)} lám.</div></td>
      <td>${l.tamano < 0.9999
        ? `Pedazo${l.ancho ? ` ${esc(l.ancho)}×${esc(l.alto)}"` : ''} · ${numero(aPies2(l.tamano))} pie²`
        : '4×8 pies'}</td>
      <td>${esc([l.bodega_nombre, l.ubicacion].filter(Boolean).join(' · ') || '—')}</td>
      <td><div class="inv-row-actions">
        ${escribe && l.restante > 0.0001 ? `<button onclick="abrirModalCorteLamina(${m.id}, 'SALIDA', ${argJs(l.id)})">Cortar</button>` : ''}
        ${escribe && l.estado === 'ABIERTA' ? `<button onclick="abrirModalTerminarLamina(${argJs(l.id)})" title="Ya solo le quedan pedazos de menos de 12×12 pulg.">Terminar</button>` : ''}
        ${escribe && l.estado === 'RETAZOS' ? `<button onclick="reabrirLamina(${argJs(l.id)})">Reabrir</button>` : ''}
        ${escribe ? `<button onclick="abrirModalCorregirLamina(${argJs(l.id)})">Corregir</button>` : ''}
        ${esAdmin() ? `<button onclick="abrirModalEliminarLamina(${argJs(l.id)})" style="color:var(--color-magenta-dark);">Eliminar</button>` : ''}
      </div></td>
    </tr>`;

  const filaCompletasJuntas = completas.length ? `
    <tr class="inv-row-clickable" onclick="alternarCompletas(${m.id})">
      <td class="mono">${esc(completas[0].id.split('-').pop())} … ${esc(completas[completas.length - 1].id.split('-').pop())}</td>
      <td>${chipEstadoLamina('COMPLETA')}</td>
      <td class="num"><strong>${completas.length}</strong> × 32 pie²</td>
      <td>4×8 pies</td>
      <td>—</td>
      <td><div class="inv-row-actions"><button>Ver las ${completas.length}</button></div></td>
    </tr>` : '';

  const cuerpo = [
    ...otras.map(fila),
    ...(verCompletas ? completas.map(fila) : [filaCompletasJuntas]),
  ].join('');

  return `
    <div class="inv-table-wrap inv-lamina-card" style="margin-bottom:1.5rem;">
      <div class="inv-lamina-head">
        <div>
          <span class="mono" style="font-weight:600;">${esc(m.codigo)}</span>
          <span style="color:rgba(var(--texto-rgb),0.55); margin-left:0.5rem;">${esc(m.descripcion)}</span>
          ${m.espesor_mm != null ? `<span class="inv-chip inv-chip-SIN_MINIMO" style="margin-left:0.5rem;">${esc(numero(m.espesor_mm))} mm</span>` : ''}
          <div class="inv-lamina-disponible">${esc(textoDisponible(r))}</div>
        </div>
        <div style="display:flex; align-items:center; gap:0.9rem; flex-wrap:wrap; justify-content:flex-end;">
          <span style="font-size:0.85rem; color:rgba(var(--texto-rgb),0.6);">
            Existencia: <strong class="mono" style="color:var(--texto);">${esc(textoLaminas(m.existencia))}</strong>
          </span>
          ${valor ? `<span style="font-size:0.85rem; color:rgba(var(--texto-rgb),0.6);">Valor: <strong class="mono" style="color:var(--texto);">${esc(valor)}</strong></span>`
            : '<span class="inv-chip inv-chip-AGOTADO" title="Se llena al registrar una entrada con costo">sin costo</span>'}
          ${chipEstado(m.estado)}
        </div>
      </div>
      ${escribe ? `
        <div class="inv-lamina-acciones">
          ${r.total > 0.0001 ? `
            <button class="btn btn-magenta chip" onclick="abrirModalCorteLamina(${m.id}, 'SALIDA')">Salida (corte)</button>
            <button class="btn btn-outline chip" onclick="abrirModalCorteLamina(${m.id}, 'MERMA')">Merma</button>` : ''}
          <button class="btn btn-outline chip" onclick="abrirModalEntrada(${m.id})">Entrada</button>
          ${r.enRetazos > 0 ? `
            <button class="btn btn-outline chip" onclick="abrirModalCorteLamina(${m.id}, 'SALIDA', null, 'retazos')">Salida de retazos</button>
            <button class="btn btn-outline chip" onclick="abrirModalBotarRetazos(${m.id})">Botar retazos</button>` : ''}
        </div>` : ''}
      ${aviso}
      ${laminas.length ? `
        <table class="inv-table">
          <thead><tr><th>Lámina</th><th>Estado</th><th>Le queda</th><th>Tamaño</th><th>Ubicación</th><th>Acciones</th></tr></thead>
          <tbody>${cuerpo}</tbody>
        </table>
        ${verCompletas && completas.length > 4 ? `<div style="padding:0.6rem 1.25rem;"><button class="btn btn-outline chip" style="padding:0.35rem 0.8rem; font-size:0.7rem;" onclick="alternarCompletas(${m.id})">Juntar las completas</button></div>` : ''}
      ` : `<div class="inv-empty" style="padding:1.5rem;">Sin láminas registradas.</div>`}
      ${m.agotadas ? `<p class="inv-hint" style="margin:0.75rem 1.25rem;">${m.agotadas} lámina(s) ya agotada(s) no se muestran.</p>` : ''}
    </div>`;
}

function alternarCompletas(materialId) {
  if (LAMINAS_VER_COMPLETAS.has(materialId)) LAMINAS_VER_COMPLETAS.delete(materialId);
  else LAMINAS_VER_COMPLETAS.add(materialId);
  renderLaminas();
}

/** Después de cualquier cambio, se refresca lo que se está viendo. */
async function refrescarTrasLamina() {
  await refrescarVistas();
}

// ==========================================================================
// Salida o merma por piezas
//
// Lo normal: se ponen las piezas que se cortaron (cuántas, ancho y alto en
// pulgadas) y el sistema descuenta ese pedazo de la lámina que corresponde:
// primero la abierta más chica donde quepa, y si ninguna alcanza, una
// completa. Al terminar dice cuánto le quedó a esa lámina y cuánto hay en total.
// ==========================================================================

async function abrirModalCorteLamina(materialId, tipo = 'SALIDA', laminaElegida = null, fuenteInicial = null) {
  await traerLaminas(materialId);
  const m = LAMINAS_MATERIALES[materialId];
  if (!m) { alert('No se encontró el material.'); return; }
  const esMerma = tipo === 'MERMA';
  const matsLamina = (CATALOGOS.materiales || []).filter(esMaterialDeLamina);

  const vivas = m.laminas.filter((l) => l.restante > 0.0001);

  // Sin láminas no hay de dónde cortar: se dice qué hacer en vez de dejar
  // llenar todo el formulario para que al final dé error.
  if (!vivas.length) {
    abrirModal(`
      <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
      <h3 class="font-display">${esMerma ? 'Merma' : 'Salida'} — <span class="mono">${esc(m.codigo)}</span></h3>
      <p class="inv-hint">Este material no tiene láminas con material registradas.</p>
      <ul class="inv-hint" style="padding-left:1.1rem; line-height:1.6;">
        ${m.sin_lamina > 0.0001 ? `<li>Tiene <strong>${esc(textoLaminas(m.sin_lamina))}</strong> contadas: en la pestaña Láminas, botón <strong>Crear las láminas</strong>.</li>` : ''}
        <li>Si llegaron láminas nuevas: registra la <strong>Entrada</strong> de la compra.</li>
        <li>Si ya estaban en bodega: <strong>+ Registrar láminas existentes</strong>.</li>
      </ul>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cerrar</button>
        <button type="button" class="btn btn-magenta chip" onclick="cerrarModal(); cambiarTab('laminas')">Ir a Láminas</button>
      </div>`);
    return;
  }

  const opcionesFuente = [
    '<option value="auto">Automático: la abierta más chica donde quepa, si no una completa</option>',
    ...vivas.filter((l) => l.estado !== 'RETAZOS').map((l) =>
      `<option value="${esc(l.id)}" ${l.id === laminaElegida ? 'selected' : ''}>${esc(l.id)} — ${esc(ESTADOS_LAMINA[l.estado])}, le quedan ${numero(l.restante_pies2)} pie²</option>`),
    m.resumen.enRetazos > 0
      ? `<option value="retazos" ${fuenteInicial === 'retazos' ? 'selected' : ''}>De los retazos (${numero(m.resumen.enRetazosPies2)} pie²)</option>` : '',
    ...vivas.filter((l) => l.estado === 'RETAZOS' && l.id === laminaElegida).map((l) =>
      `<option value="${esc(l.id)}" selected>${esc(l.id)} — retazos, ${numero(l.restante_pies2)} pie²</option>`),
  ].join('');

  const opcionesResto = vivas.map((l) =>
    `<option value="${esc(l.id)}" ${l.id === laminaElegida ? 'selected' : ''}>${esc(l.id)} — ${esc(ESTADOS_LAMINA[l.estado])}, ${numero(l.restante_pies2)} pie²</option>`).join('');

  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">${esMerma ? 'Merma de lámina' : 'Salida de lámina'}</h3>
    <form id="formCorte">
      <div class="form-row"><label>Material *</label>
        <select id="c-material">${optMateriales(matsLamina, m.id)}</select>
        <p class="inv-hint" style="margin:0.35rem 0 0;">${esc(m.descripcion)}${m.espesor_mm != null ? ` · ${esc(numero(m.espesor_mm))} mm` : ''} —
          <strong>${esc(textoDisponible(m.resumen))}</strong></p>
      </div>

      <div class="form-row"><label>¿Qué sale?</label>
        <select id="c-modo">
          <option value="piezas">Piezas cortadas (pones las medidas)</option>
          ${esMerma ? '' : '<option value="completas">Láminas completas, enteras</option>'}
          <option value="resto">Todo lo que le queda a una lámina</option>
        </select>
      </div>

      <div id="c-bloque-piezas">
        <label class="inv-label-chica">Piezas (en pulgadas)</label>
        <div id="c-piezas"></div>
        <button type="button" class="btn btn-outline chip" id="c-mas" style="padding:0.4rem 0.8rem; font-size:0.7rem; margin-bottom:0.9rem;">+ Otra medida</button>
        <div class="form-row"><label>¿De dónde sale?</label>
          <select id="c-fuente">${opcionesFuente}</select>
        </div>
        <div class="inv-corte-calculo" id="c-calculo">Pon las medidas de lo que cortaste.</div>
        ${esMerma ? '' : `
        <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; margin:0.75rem 0 1rem;">
          <input type="checkbox" id="c-terminar">
          Con este corte, a la lámina ya solo le quedan retazos (pedazos de menos de 12×12 pulg.)
        </label>`}
      </div>

      <div id="c-bloque-completas" class="inv-hidden">
        <div class="form-row"><label>¿Cuántas láminas completas? *</label>
          <input type="number" id="c-completas" min="1" step="1" value="1">
          <p class="inv-hint" style="margin:0.35rem 0 0;">Hay ${m.resumen.completas} completa(s).</p>
        </div>
      </div>

      <div id="c-bloque-resto" class="inv-hidden">
        <div class="form-row"><label>¿De qué lámina? *</label>
          <select id="c-resto">${opcionesResto || '<option value="">No hay láminas con material</option>'}</select>
          <p class="inv-hint" style="margin:0.35rem 0 0;">Se descuenta todo lo que le queda y la lámina queda agotada.</p>
        </div>
      </div>

      <div class="form-two-col">
        <div class="form-row"><label>Fecha *</label><input type="date" id="c-fecha" required value="${hoy()}"></div>
        ${esMerma
          ? `<div class="form-row"><label>Motivo *</label><select id="c-motivo">${MOTIVOS_MERMA.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></div>`
          : `<div class="form-row"><label>Tipo de salida</label><select id="c-movimiento">${TIPOS_SALIDA.map(([v, l]) => `<option value="${v}" ${fuenteInicial === 'retazos' && v === 'EMBALAJE' ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`}
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>OT</label><input type="text" id="c-ot"></div>
        <div class="form-row"><label>Área</label><select id="c-area"><option value="">—</option>${opt(CATALOGOS.areas, 'id', 'nombre')}</select></div>
      </div>
      ${esMerma ? `
        <div class="form-two-col">
          <div class="form-row"><label>Responsable *</label><input type="text" id="c-quien" required value="${esc(nombreUsuario())}"></div>
          <div class="form-row"><label>Autoriza *</label><select id="c-autoriza" required>${opcionesAutoriza()}</select></div>
        </div>` : `
        <div class="form-row"><label>Cliente</label><input type="text" id="c-cliente"></div>
        <div class="form-two-col">
          <div class="form-row"><label>Quién retira *</label><input type="text" id="c-retira" required placeholder="Quién se lo lleva o lo corta"></div>
          <div class="form-row"><label>Quién entrega *</label><input type="text" id="c-entrega" required value="${esc(nombreUsuario())}"></div>
        </div>`}
      <div class="form-row"><label>Observaciones</label><textarea id="c-obs" rows="2"></textarea></div>
      <div id="c-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">${esMerma ? 'Registrar merma' : 'Registrar salida'}</button>
      </div>
    </form>
  `);

  // Cambiar a otro material por lámina vuelve a abrir el formulario con sus láminas
  document.getElementById('c-material').addEventListener('change', (e) => {
    abrirModalCorteLamina(Number(e.target.value), tipo);
  });

  const piezas = document.getElementById('c-piezas');
  const agregarPieza = () => {
    const div = document.createElement('div');
    div.className = 'inv-pieza';
    div.innerHTML = `
      <input type="number" class="p-cant" min="1" step="1" value="1" title="Cuántas piezas">
      <span>×</span>
      <input type="number" class="p-ancho" step="any" min="0" placeholder="Ancho">
      <span>×</span>
      <input type="number" class="p-alto" step="any" min="0" placeholder="Alto">
      <span class="inv-pieza-unidad">pulg.</span>
      <button type="button" class="inv-pieza-quitar" title="Quitar">&times;</button>`;
    div.querySelector('.inv-pieza-quitar').addEventListener('click', () => {
      if (piezas.children.length > 1) { div.remove(); calcular(); }
    });
    div.querySelectorAll('input').forEach((i) => i.addEventListener('input', calcular));
    piezas.appendChild(div);
    return div;
  };
  document.getElementById('c-mas').addEventListener('click', () => { agregarPieza().querySelector('.p-ancho').focus(); });

  const leerPiezas = () => [...piezas.querySelectorAll('.inv-pieza')].map((d) => ({
    cantidad: parseInt(d.querySelector('.p-cant').value, 10) || 1,
    ancho: parseFloat(d.querySelector('.p-ancho').value),
    alto: parseFloat(d.querySelector('.p-alto').value),
  })).filter((p) => p.ancho > 0 && p.alto > 0);

  /** Muestra en vivo cuánto es el corte y de qué lámina saldría. */
  function calcular() {
    const caja = document.getElementById('c-calculo');
    const lista = leerPiezas();
    if (!lista.length) { caja.innerHTML = 'Pon las medidas de lo que cortaste.'; return; }

    const noCabe = lista.find((p) => Math.min(p.ancho, p.alto) > 48 || Math.max(p.ancho, p.alto) > 96);
    if (noCabe) {
      caja.innerHTML = `<span style="color:var(--color-magenta-dark);">Una pieza de ${noCabe.ancho}×${noCabe.alto} no cabe en una lámina de 48×96 pulg.</span>`;
      return;
    }
    const pulg2 = lista.reduce((t, p) => t + p.cantidad * p.ancho * p.alto, 0);
    const lam = pulg2 / 4608;
    const pies2 = Math.round((pulg2 / 144) * 100) / 100;
    let destino = '';

    const fuente = document.getElementById('c-fuente').value;
    if (fuente === 'retazos') {
      const quedan = m.resumen.enRetazos - lam;
      destino = quedan < -0.0001
        ? `<span style="color:var(--color-magenta-dark);">En retazos solo hay ${numero(m.resumen.enRetazosPies2)} pie².</span>`
        : `Sale de los retazos; quedarían ${numero(aPies2(Math.max(quedan, 0)))} pie² de retazos.`;
    } else {
      const candidatas = vivas.filter((l) => l.estado !== 'RETAZOS');
      let elegida = null;
      // Misma regla que el servidor, con su tolerancia de redondeo
      const cabe = (l) => lam <= l.restante + (l.tolerancia || 0.0001);
      if (fuente !== 'auto') {
        elegida = vivas.find((l) => l.id === fuente);
      } else {
        const abiertas = candidatas.filter((l) => l.estado === 'ABIERTA').sort((a, b) => a.restante - b.restante);
        elegida = abiertas.find(cabe) || candidatas.find((l) => l.estado === 'COMPLETA' && cabe(l));
      }
      if (elegida && cabe(elegida)) {
        destino = `Sale de <strong class="mono">${esc(elegida.id)}</strong>
          (${esc(ESTADOS_LAMINA[elegida.estado].toLowerCase())}): le quedarían
          <strong>${numero(aPies2(Math.max(elegida.restante - lam, 0)))} pie²</strong>.`;
      } else if (fuente !== 'auto') {
        destino = `<span style="color:var(--color-magenta-dark);">A ${esc(fuente)} solo le quedan ${numero(elegida ? elegida.restante_pies2 : 0)} pie².</span>`;
      } else if (candidatas.reduce((t, l) => t + l.restante, 0) >= lam - 0.0001) {
        destino = 'Ninguna lámina alcanza sola: se reparte entre varias.';
      } else {
        destino = `<span style="color:var(--color-magenta-dark);">No alcanza: entre todas las láminas hay ${numero(m.resumen.disponiblePies2)} pie².</span>`;
      }
    }

    caja.innerHTML = `= <strong>${numero(pies2)} pie²</strong> (${numero(lam, 4)} lámina) ·
      ${lista.length > 1 || lista[0].cantidad > 1 ? `${lista.reduce((t, p) => t + p.cantidad, 0)} piezas · ` : ''}${destino}`;
  }

  const modo = document.getElementById('c-modo');
  const aplicarModo = () => {
    document.getElementById('c-bloque-piezas').classList.toggle('inv-hidden', modo.value !== 'piezas');
    document.getElementById('c-bloque-completas').classList.toggle('inv-hidden', modo.value !== 'completas');
    document.getElementById('c-bloque-resto').classList.toggle('inv-hidden', modo.value !== 'resto');
  };
  modo.addEventListener('change', aplicarModo);
  document.getElementById('c-fuente').addEventListener('change', calcular);

  agregarPieza();
  if (laminaElegida && fuenteInicial === 'resto') { modo.value = 'resto'; }
  aplicarModo();
  calcular();
  const primera = piezas.querySelector('.p-ancho');
  if (primera && modo.value === 'piezas') primera.focus();

  document.getElementById('formCorte').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('c-error');
    errBox.classList.remove('is-visible');

    const cuerpo = {
      materialId: m.id,
      fecha: document.getElementById('c-fecha').value,
      ot: document.getElementById('c-ot').value || null,
      areaId: document.getElementById('c-area').value || null,
      observaciones: document.getElementById('c-obs').value || null,
      modoLamina: modo.value,
    };
    if (modo.value === 'piezas') {
      const lista = leerPiezas();
      if (!lista.length) {
        errBox.textContent = 'Pon al menos una pieza con su ancho y alto.';
        errBox.classList.add('is-visible');
        return;
      }
      const fuente = document.getElementById('c-fuente').value;
      cuerpo.piezas = lista;
      cuerpo.fuente = fuente === 'auto' || fuente === 'retazos' ? fuente : 'lamina';
      cuerpo.laminaId = cuerpo.fuente === 'lamina' ? fuente : null;
      cuerpo.terminarDespues = !esMerma && document.getElementById('c-terminar').checked;
    } else if (modo.value === 'completas') {
      cuerpo.completas = parseInt(document.getElementById('c-completas').value, 10);
    } else {
      cuerpo.laminaId = document.getElementById('c-resto').value;
      if (!cuerpo.laminaId) {
        errBox.textContent = 'Elige la lámina.';
        errBox.classList.add('is-visible');
        return;
      }
    }

    if (esMerma) {
      Object.assign(cuerpo, {
        motivo: document.getElementById('c-motivo').value,
        quien: document.getElementById('c-quien').value,
        autorizaResponsable: document.getElementById('c-autoriza').value,
      });
    } else {
      Object.assign(cuerpo, {
        movimiento: document.getElementById('c-movimiento').value,
        cliente: document.getElementById('c-cliente').value || null,
        retira: document.getElementById('c-retira').value,
        entrega: document.getElementById('c-entrega').value,
      });
    }

    try {
      const r = await api.post(esMerma ? '/movimientos/merma' : '/movimientos/salida', cuerpo);
      mostrarResultadoCorte(m, tipo, r);
      refrescarTrasLamina();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

/** Después de registrar: qué salió, cuánto le quedó a la lámina y cuánto hay en total. */
function mostrarResultadoCorte(m, tipo, r) {
  const res = r.resumen;
  const partes = r.movimientos.map((x) => `${numero(x.pies2)} pie² de <strong class="mono">${esc(x.laminaId)}</strong>`);
  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">${tipo === 'MERMA' ? 'Merma registrada' : 'Salida registrada'}</h3>
    <div class="inv-corte-resultado">
      <div class="fila"><span>Salió</span><span>${esc(r.medidas)}<br>${partes.join(' + ')}</span></div>
      <div class="fila"><span>A la lámina ${esc(r.quedaEnUltima.id)} le queda</span>
        <span><strong>${numero(r.quedaEnUltima.pies2)} pie²</strong> (${numero(r.quedaEnUltima.restante, 4)} lám.)
        ${r.terminada ? '<br><em>Pasó a retazos</em>' : r.quedaEnUltima.restante <= 0.0001 ? '<br><em>Quedó agotada</em>' : ''}</span></div>
      <div class="fila destacada"><span>Disponible de ${esc(m.codigo)}</span>
        <span><strong>${esc(textoLaminas(res.disponible))}</strong><br>${esc(textoDisponible(res))}</span></div>
    </div>
    <div class="inv-modal-actions">
      <button type="button" class="btn btn-outline chip" onclick="abrirModalCorteLamina(${m.id}, '${tipo}')">Otro corte de este material</button>
      <button type="button" class="btn btn-magenta chip" onclick="cerrarModal()">Listo</button>
    </div>
  `);
}

// ==========================================================================
// Registrar láminas que ya están en bodega
// ==========================================================================

/** Botón del aviso: crea las láminas de lo que ya estaba contado (no suma nada). */
async function crearLaminasDelConteo(materialId) {
  const m = LAMINAS_MATERIALES[materialId];
  if (!m || !(m.sin_lamina > 0)) return;
  const completas = Math.floor(m.sin_lamina + 0.0001);
  const resto = Math.round((m.sin_lamina - completas) * 10000) / 10000;
  const texto = `${completas} lámina(s) completa(s)${resto > 0.0001 ? ` y un pedazo de ${numero(aPies2(resto))} pie²` : ''}`;
  if (!confirm(`¿En bodega hay de verdad ${texto} de ${m.codigo}?\n\n` +
    'Se registran una por una. No suma nada a la existencia: es lo que ya estaba contado. ' +
    'Si no coincide con lo que hay, cancela y usa "+ Registrar láminas existentes" con la cantidad real.')) return;
  try {
    const r = await api.post('/laminas', {
      materialId, completas, pedazoTamano: resto > 0.0001 ? resto : null,
      // Solo lo que ya estaba contado: si otro ya lo registró, no se duplica
      soloAbsorber: true,
    });
    alert(r.mensaje);
    await refrescarTrasLamina();
  } catch (err) {
    alert(err.message);
  }
}

function abrirModalRegistrarLaminas(materialId) {
  const mats = (CATALOGOS.materiales || []).filter(esMaterialDeLamina);
  if (!mats.length) {
    alert('No hay materiales en la unidad "Lámina". Crea uno o cambia la unidad en Inventario → Editar material.');
    return;
  }
  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Registrar láminas existentes</h3>
    <p class="inv-hint">Para láminas que ya están en bodega y no entraron por una compra. Si ya estaban
      contadas en la existencia, no se suman dos veces.</p>
    <form id="formRegLaminas">
      <div class="form-row"><label>Material *</label>
        <select id="rl-material">${optMateriales(mats, materialId)}</select></div>
      <div class="form-row"><label>Láminas completas de 4×8</label>
        <input type="number" id="rl-completas" min="0" step="1" value="1"></div>
      <label class="inv-label-chica">Y/o un pedazo (pulgadas)</label>
      <div class="inv-pieza" style="margin-bottom:1rem;">
        <input type="number" id="rl-ancho" step="any" min="0" placeholder="Ancho">
        <span>×</span>
        <input type="number" id="rl-alto" step="any" min="0" placeholder="Alto">
        <span class="inv-pieza-unidad">pulg.</span>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Bodega</label><select id="rl-bodega"><option value="">La del material</option>${opt(CATALOGOS.bodegas, 'id', 'nombre')}</select></div>
        <div class="form-row"><label>Ubicación</label><input type="text" id="rl-ubicacion" placeholder="Ej. rack de láminas"></div>
      </div>
      <div class="form-row"><label>Observaciones</label><textarea id="rl-obs" rows="2"></textarea></div>
      <div id="rl-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Registrar</button>
      </div>
    </form>
  `);
  document.getElementById('formRegLaminas').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('rl-error');
    try {
      const r = await api.post('/laminas', {
        materialId: document.getElementById('rl-material').value,
        completas: parseInt(document.getElementById('rl-completas').value || '0', 10),
        pedazoAncho: document.getElementById('rl-ancho').value || null,
        pedazoAlto: document.getElementById('rl-alto').value || null,
        bodegaId: document.getElementById('rl-bodega').value || null,
        ubicacion: document.getElementById('rl-ubicacion').value || null,
        observaciones: document.getElementById('rl-obs').value || null,
      });
      cerrarModal();
      alert(r.mensaje);
      await refrescarTrasLamina();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

// ==========================================================================
// Corregir, terminar, reabrir, eliminar, botar retazos
// ==========================================================================

function abrirModalCorregirLamina(laminaId) {
  const l = LAMINAS_CACHE[laminaId];
  if (!l) return;
  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Corregir lámina <span class="mono">${esc(l.id)}</span></h3>
    <p class="inv-hint">Según el sistema le quedan <strong>${numero(l.restante_pies2)} pie²</strong>.
      Si al revisarla no es así, pon lo que de verdad le queda. Queda un ajuste en Movimientos.</p>
    <form id="formCorregirLamina">
      <div class="form-row"><label>Lo que le queda de verdad (pie²)</label>
        <input type="number" id="cl-pies2" step="any" min="0" max="32" value="${esc(l.restante_pies2)}"></div>
      <label class="inv-label-chica">…o mide el pedazo y se calcula solo (pulgadas)</label>
      <div class="inv-pieza" style="margin-bottom:1rem;">
        <input type="number" id="cl-ancho" step="any" min="0" placeholder="Ancho">
        <span>×</span>
        <input type="number" id="cl-alto" step="any" min="0" placeholder="Alto">
        <span class="inv-pieza-unidad">pulg.</span>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Bodega</label><select id="cl-bodega"><option value="">—</option>${opt(CATALOGOS.bodegas, 'id', 'nombre', l.bodega_id)}</select></div>
        <div class="form-row"><label>Ubicación</label><input type="text" id="cl-ubicacion" value="${esc(l.ubicacion || '')}"></div>
      </div>
      <div id="cl-quien-fila" class="form-two-col inv-hidden">
        <div class="form-row"><label>Quién corrige *</label><input type="text" id="cl-quien" value="${esc(nombreUsuario())}"></div>
        <div class="form-row"><label>Autoriza *</label><select id="cl-autoriza">${opcionesAutoriza()}</select></div>
      </div>
      <div id="cl-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Guardar</button>
      </div>
    </form>
  `);
  const pies2 = document.getElementById('cl-pies2');
  const mostrarQuien = () => {
    const cambia = Math.abs(parseFloat(pies2.value) - l.restante_pies2) > 0.005;
    document.getElementById('cl-quien-fila').classList.toggle('inv-hidden', !cambia);
  };
  pies2.addEventListener('input', mostrarQuien);
  ['cl-ancho', 'cl-alto'].forEach((id) => document.getElementById(id).addEventListener('input', () => {
    const a = parseFloat(document.getElementById('cl-ancho').value);
    const b = parseFloat(document.getElementById('cl-alto').value);
    if (a > 0 && b > 0) { pies2.value = Math.round((a * b / 144) * 100) / 100; mostrarQuien(); }
  }));

  document.getElementById('formCorregirLamina').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('cl-error');
    const cambia = Math.abs(parseFloat(pies2.value) - l.restante_pies2) > 0.005;
    try {
      await api.put(`/laminas/${encodeURIComponent(l.id)}`, {
        bodegaId: document.getElementById('cl-bodega').value || null,
        ubicacion: document.getElementById('cl-ubicacion').value || null,
        restantePies2: cambia ? pies2.value : null,
        quien: document.getElementById('cl-quien').value,
        autoriza: document.getElementById('cl-autoriza').value,
      });
      cerrarModal();
      await refrescarTrasLamina();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

function abrirModalTerminarLamina(laminaId) {
  const l = LAMINAS_CACHE[laminaId];
  if (!l) return;
  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Terminar lámina <span class="mono">${esc(l.id)}</span></h3>
    <p class="inv-hint">Le quedan <strong>${numero(l.restante_pies2)} pie²</strong>. Termínala cuando ya solo
      tenga pedazos de menos de 12×12 pulg. (1×1 pie). ¿Qué pasa con lo que queda?</p>
    <form id="formTerminar">
      <label class="inv-opcion"><input type="radio" name="t-accion" value="retazos" checked>
        <span><strong>Se guarda como retazos</strong><br>Sigue en la existencia, aparte, para embalaje o piezas chicas.</span></label>
      <label class="inv-opcion"><input type="radio" name="t-accion" value="merma">
        <span><strong>No sirve: se bota</strong><br>Se registra como merma y la lámina queda agotada.</span></label>
      <div id="t-merma" class="inv-hidden" style="margin-top:0.75rem;">
        <div class="form-row"><label>Motivo</label><select id="t-motivo">${MOTIVOS_MERMA.map((x) => `<option ${x === 'Retazo no aprovechable' ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
        <div class="form-two-col">
          <div class="form-row"><label>Responsable *</label><input type="text" id="t-quien" value="${esc(nombreUsuario())}"></div>
          <div class="form-row"><label>Autoriza *</label><select id="t-autoriza">${opcionesAutoriza()}</select></div>
        </div>
      </div>
      <div id="t-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Terminar lámina</button>
      </div>
    </form>
  `);
  document.querySelectorAll('input[name="t-accion"]').forEach((r) => r.addEventListener('change', () => {
    document.getElementById('t-merma').classList.toggle('inv-hidden', document.querySelector('input[name="t-accion"]:checked').value !== 'merma');
  }));
  document.getElementById('formTerminar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('t-error');
    const accion = document.querySelector('input[name="t-accion"]:checked').value;
    try {
      const r = await api.post(`/laminas/${encodeURIComponent(l.id)}/terminar`, {
        accion,
        motivo: document.getElementById('t-motivo').value,
        quien: document.getElementById('t-quien').value,
        autoriza: document.getElementById('t-autoriza').value,
      });
      cerrarModal();
      alert(r.mensaje);
      await refrescarTrasLamina();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

async function reabrirLamina(laminaId) {
  if (!confirm(`¿Reabrir ${laminaId}? Vuelve a estar disponible para cortes normales.`)) return;
  try {
    await api.post(`/laminas/${encodeURIComponent(laminaId)}/reabrir`, {});
    await refrescarTrasLamina();
  } catch (err) {
    alert(err.message);
  }
}

function abrirModalEliminarLamina(laminaId) {
  const l = LAMINAS_CACHE[laminaId];
  if (!l) return;
  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Eliminar lámina <span class="mono">${esc(l.id)}</span></h3>
    <p class="inv-hint" style="color:var(--color-magenta-dark);">
      ${l.restante > 0.0001
        ? `Le quedan ${numero(l.restante_pies2)} pie²: al eliminarla se descuentan de la existencia con un ajuste "Lámina eliminada".`
        : 'Ya no le queda material; solo queda la constancia en Movimientos.'}
      Úsalo si se registró de más o si la lámina ya no existe.
    </p>
    <form id="formEliminarLamina">
      <div class="form-two-col">
        <div class="form-row"><label>Quién elimina *</label><input type="text" id="dl-quien" required value="${esc(nombreUsuario())}"></div>
        <div class="form-row"><label>Autoriza *</label><select id="dl-autoriza" required>${opcionesAutoriza()}</select></div>
      </div>
      <div class="form-row"><label>Observaciones</label><textarea id="dl-obs" rows="2"></textarea></div>
      <div id="dl-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Sí, eliminar</button>
      </div>
    </form>
  `);
  document.getElementById('formEliminarLamina').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('dl-error');
    try {
      await api.delete(`/laminas/${encodeURIComponent(l.id)}`, {
        quien: document.getElementById('dl-quien').value,
        autoriza: document.getElementById('dl-autoriza').value,
        observaciones: document.getElementById('dl-obs').value || null,
      });
      cerrarModal();
      await refrescarTrasLamina();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

function abrirModalBotarRetazos(materialId) {
  const m = LAMINAS_MATERIALES[materialId];
  if (!m) return;
  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Botar retazos — <span class="mono">${esc(m.codigo)}</span></h3>
    <p class="inv-hint">Se registran como merma los <strong>${numero(m.resumen.enRetazosPies2)} pie²</strong> de retazos
      (${m.resumen.retazos} lámina(s) terminada(s)).</p>
    <form id="formBotar">
      <div class="form-row"><label>Motivo</label><select id="br-motivo">${MOTIVOS_MERMA.map((x) => `<option ${x === 'Retazo no aprovechable' ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="form-two-col">
        <div class="form-row"><label>Responsable *</label><input type="text" id="br-quien" required value="${esc(nombreUsuario())}"></div>
        <div class="form-row"><label>Autoriza *</label><select id="br-autoriza" required>${opcionesAutoriza()}</select></div>
      </div>
      <div id="br-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Botar retazos</button>
      </div>
    </form>
  `);
  document.getElementById('formBotar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('br-error');
    try {
      const r = await api.post('/laminas/retazos/botar', {
        materialId,
        motivo: document.getElementById('br-motivo').value,
        quien: document.getElementById('br-quien').value,
        autoriza: document.getElementById('br-autoriza').value,
      });
      cerrarModal();
      alert(r.mensaje);
      await refrescarTrasLamina();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

function initLaminasListeners() {
  document.getElementById('btnNuevaLamina').addEventListener('click', () => abrirModalRegistrarLaminas());
  ['laminasFiltroMaterial', 'laminasSoloDisponibles'].forEach((id) => {
    document.getElementById(id).addEventListener('change', renderLaminas);
  });
  document.getElementById('btnExportarLaminas').addEventListener('click', async (e) => {
    const btn = e.target; const texto = btn.textContent;
    btn.disabled = true; btn.textContent = 'Generando...';
    try { await descargar('/laminas/exportar.csv', 'laminas.csv'); }
    catch (err) { alert(err.message); }
    finally { btn.disabled = false; btn.textContent = texto; }
  });
}
