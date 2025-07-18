let currentPage = 1;
let currentLimit = 10;
let currentSortField = null;
let currentSortOrder = 1;
let currentFilters = {};
let calendar = null;
let editId = null;
let isCalendarInitialized = false;

document.addEventListener('DOMContentLoaded', () => {
  aplicarConfiguracionUsuario(); // NUEVO: Cargar configuración usuario
  cargarFiltros();
  cargarAcciones();
  configurarEventos();
});


async function aplicarConfiguracionUsuario() {
  try {
    const res = await fetch('/api/configuracion');
    if (!res.ok) throw new Error('Error al obtener configuración');
    const { config } = await res.json();
    const color = config?.color || '#ffffff';
    document.documentElement.style.setProperty('--color-personalizado', color);
  } catch (err) {
    console.error('Error al aplicar configuración del usuario:', err);
    document.documentElement.style.setProperty('--color-personalizado', '#ffffff');
  }
}

async function cargarFiltros() {
  try {
    const res = await fetch('/api/acciones/filters');
    if (!res.ok) throw new Error('Error al obtener filtros');
    const data = await res.json();

    const tipoFilter = document.getElementById('tipoFilter');
    const estadoFilter = document.getElementById('estadoFilter');
    if (!tipoFilter || !estadoFilter) return;

    tipoFilter.innerHTML = '<option value="">Todos</option>';
    estadoFilter.innerHTML = '<option value="">Todos</option>';

    (data.tipos || []).forEach(tipo => {
      if (tipo) {
        const opt = document.createElement('option');
        opt.value = tipo;
        opt.textContent = tipo;
        tipoFilter.appendChild(opt);
      }
    });

    (data.estados || []).forEach(estado => {
      if (estado) {
        const opt = document.createElement('option');
        opt.value = estado;
        opt.textContent = estado;
        estadoFilter.appendChild(opt);
      }
    });
  } catch (err) {
    console.error('Error cargando filtros:', err);
    mostrarNotificacion('Error al cargar filtros', 'error');
  }
}

function configurarEventos() {
  const tableViewBtn = document.getElementById('tableViewBtn');
  const calendarViewBtn = document.getElementById('calendarViewBtn');
  const applyFiltersBtn = document.getElementById('applyFilters');
  const resetFiltersBtn = document.getElementById('resetFilters');
  const exportBtn = document.getElementById('exportBtn');
  const addAccionBtn = document.getElementById('addAccionBtn');
  const modal = document.getElementById('accionModal');
  const closeModalBtn = modal?.querySelector('.close');
  const accionForm = document.getElementById('accionForm');

  if (tableViewBtn) {
    tableViewBtn.addEventListener('click', () => {
      document.querySelector('.calendar-view').style.display = 'none';
      document.querySelector('.table-view').style.display = 'block';
      tableViewBtn.classList.add('active');
      calendarViewBtn?.classList.remove('active');
    });
  }

  if (calendarViewBtn) {
    calendarViewBtn.addEventListener('click', () => {
      document.querySelector('.table-view').style.display = 'none';
      document.querySelector('.calendar-view').style.display = 'block';
      calendarViewBtn.classList.add('active');
      tableViewBtn?.classList.remove('active');

      if (!isCalendarInitialized) {
        iniciarCalendario();
        isCalendarInitialized = true;
      } else {
        calendar?.refetchEvents();
      }
    });
  }

  if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener('click', () => {
      currentFilters.search = document.getElementById('searchInput')?.value.trim() || '';
      currentFilters.tipo = document.getElementById('tipoFilter')?.value || '';
      currentFilters.estado = document.getElementById('estadoFilter')?.value || '';
      currentPage = 1;
      cargarAcciones();
    });
  }

  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', () => {
      currentFilters = {};
      if (document.getElementById('searchInput')) document.getElementById('searchInput').value = '';
      if (document.getElementById('tipoFilter')) document.getElementById('tipoFilter').value = '';
      if (document.getElementById('estadoFilter')) document.getElementById('estadoFilter').value = '';
      currentPage = 1;
      cargarAcciones();
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/acciones/export');
        if (!res.ok) throw new Error(res.statusText);

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'acciones.csv';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
      } catch (err) {
        console.error('Error al exportar:', err);
        mostrarNotificacion('Error al exportar datos', 'error');
      }
    });
  }

  if (addAccionBtn) {
    addAccionBtn.addEventListener('click', () => {
      editId = null;
      abrirModal();
    });
  }

  if (closeModalBtn && modal) {
    closeModalBtn.addEventListener('click', cerrarModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) cerrarModal();
    });
  }

  if (accionForm) {
    accionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await guardarAccion();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarModal();
  });

  document.querySelectorAll('.table-header').forEach(header => {
    header.addEventListener('click', () => {
      const field = header.dataset.sort;
      if (!field) return;

      if (currentSortField === field) {
        currentSortOrder = -currentSortOrder;
      } else {
        currentSortField = field;
        currentSortOrder = 1;
      }

      document.querySelectorAll('.sort-icon').forEach(icon => (icon.innerHTML = ''));

      const icon = header.querySelector('.sort-icon');
      if (icon) {
        icon.innerHTML = currentSortOrder === 1 ?
          '<i class="fas fa-sort-up"></i>' :
          '<i class="fas fa-sort-down"></i>';
      }

      cargarAcciones();
    });
  });
}

async function cargarAcciones() {
  const tbody = document.querySelector('#accionesTable tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="12" class="loading">Cargando acciones...</td></tr>';

  const params = new URLSearchParams();
  params.append('page', currentPage);
  params.append('limit', currentLimit);

  if (currentFilters.search) params.append('search', currentFilters.search);
  if (currentFilters.tipo) params.append('tipo', currentFilters.tipo);
  if (currentFilters.estado) params.append('estado', currentFilters.estado);
  if (currentSortField) {
    params.append('sortField', currentSortField);
    params.append('sortOrder', currentSortOrder);
  }

  try {
    const res = await fetch(`/api/acciones?${params.toString()}`);
    if (!res.ok) throw new Error(res.statusText);

    const { data, totalPages } = await res.json();

    tbody.innerHTML = '';
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="12" class="no-data">No se encontraron acciones</td></tr>';
      construirPaginacion(0);
      return;
    }

    data.forEach(accion => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${accion.nombre || '-'}</td>
        <td>${accion.asociacionEntidad || '-'}</td>
        <td>${accion.email || '-'}</td>
        <td>${accion.telefono || '-'}</td>
        <td>${accion.tipoAccion || '-'}</td>
        <td>${accion.fechaInicio ? formatDate(accion.fechaInicio) : '-'}</td>
        <td>${accion.fechaFin ? formatDate(accion.fechaFin) : '-'}</td>
        <td>${(accion.horario || []).join(', ') || '-'}</td>
        <td>${(accion.responsableAccion || []).join(', ') || '-'}</td>
        <td><span class="estado-badge estado-${(accion.estado || 'pendiente').toLowerCase().replace(/\s+/g, '-')}">${accion.estado || 'Pendiente'}</span></td>
        <td>${accion.fechaInsercion ? formatDate(accion.fechaInsercion) : '-'}</td>
        <td class="actions">
          <button class="edit-btn" data-id="${accion._id}" title="Editar"><i class="fas fa-edit"></i></button>
          <button class="delete-btn" data-id="${accion._id}" title="Eliminar"><i class="fas fa-trash-alt"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    construirPaginacion(totalPages);
    asignarEventosTabla();
  } catch (err) {
    console.error('Error cargando acciones:', err);
    tbody.innerHTML = '<tr><td colspan="12" class="error">Error al cargar acciones</td></tr>';
    mostrarNotificacion('Error al cargar acciones', 'error');
  }
}

function construirPaginacion(totalPages) {
  const pagination = document.getElementById('pagination');
  if (!pagination) return;

  pagination.innerHTML = '';

  if (totalPages <= 1) return;

  if (currentPage < 1) currentPage = 1;
  if (currentPage > totalPages) currentPage = totalPages;

  if (currentPage > 1) {
    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
    prevBtn.addEventListener('click', () => {
      currentPage--;
      cargarAcciones();
    });
    pagination.appendChild(prevBtn);
  }

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);

  for (let i = startPage; i <= endPage; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    if (i === currentPage) btn.classList.add('active');
    btn.addEventListener('click', () => {
      currentPage = i;
      cargarAcciones();
    });
    pagination.appendChild(btn);
  }

  if (currentPage < totalPages) {
    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
    nextBtn.addEventListener('click', () => {
      currentPage++;
      cargarAcciones();
    });
    pagination.appendChild(nextBtn);
  }
}

function asignarEventosTabla() {
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.onclick = async () => {
      editId = btn.dataset.id;
      try {
        const res = await fetch(`/api/acciones/${editId}`);
        if (!res.ok) throw new Error(res.statusText);
        const accion = await res.json();
        abrirModal(accion);
      } catch (err) {
        console.error('Error al cargar acción:', err);
        mostrarNotificacion('Error al cargar acción para editar', 'error');
      }
    };
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = async () => {
      if (confirm('¿Seguro que quieres eliminar esta acción?')) {
        try {
          const res = await fetch(`/api/acciones/${btn.dataset.id}`, {
            method: 'DELETE'
          });

          if (res.ok) {
            mostrarNotificacion('Acción eliminada con éxito', 'success');
            cargarAcciones();
            calendar?.refetchEvents();
          } else {
            throw new Error(res.statusText);
          }
        } catch (err) {
          console.error('Error al eliminar:', err);
          mostrarNotificacion('Error al eliminar la acción', 'error');
        }
      }
    };
  });
}

function abrirModal(accion = null) {
  const modal = document.getElementById('accionModal');
  if (!modal) return;

  modal.style.display = 'block';

  const form = document.getElementById('accionForm');
  if (!form) return;

  form.reset();
  document.getElementById('modalTitle').textContent = accion ? 'Editar Acción' : 'Nueva Acción';

  if (accion) {
    form.nombre.value = accion.nombre || '';
    form.asociacionEntidad.value = accion.asociacionEntidad || '';
    form.email.value = accion.email || '';
    form.telefono.value = accion.telefono || '';
    form.fechaInicio.value = accion.fechaInicio ? accion.fechaInicio.slice(0, 10) : '';
    form.fechaFin.value = accion.fechaFin ? accion.fechaFin.slice(0, 10) : '';
    form.tipoAccion.value = accion.tipoAccion || '';
    form.estado.value = accion.estado || 'Pendiente';

    const horarios = accion.horario || [];
    Array.from(form.horario).forEach(input => {
      input.checked = horarios.includes(input.value);
    });

    const responsables = accion.responsableAccion || [];
    Array.from(form.responsableAccion).forEach(input => {
      input.checked = responsables.includes(input.value);
    });
  } else {
    editId = null;
  }

  form.nombre.focus();
}

function cerrarModal() {
  const modal = document.getElementById('accionModal');
  if (!modal) return;
  modal.style.display = 'none';
}

async function guardarAccion() {
  const form = document.getElementById('accionForm');
  if (!form) return;

  const formData = new FormData(form);
  const data = {
    nombre: formData.get('nombre'),
    asociacionEntidad: formData.get('asociacionEntidad'),
    email: formData.get('email'),
    telefono: formData.get('telefono'),
    fechaInicio: formData.get('fechaInicio'),
    fechaFin: formData.get('fechaFin'),
    tipoAccion: formData.get('tipoAccion'),
    estado: formData.get('estado'),
    horario: formData.getAll('horario'),
    responsableAccion: formData.getAll('responsableAccion'),
  };

  try {
    const url = editId ? `/api/acciones/${editId}` : '/api/acciones';
    const method = editId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.message || 'Error al guardar');
    }

    mostrarNotificacion(editId ? 'Acción actualizada' : 'Acción creada', 'success');
    cerrarModal();
    cargarAcciones();
    calendar?.refetchEvents();

  } catch (err) {
    console.error('Error guardando acción:', err);
    mostrarNotificacion('Error al guardar la acción', 'error');
  }
}

function mostrarNotificacion(mensaje, tipo = 'info') {
  document.querySelectorAll('.notificacion').forEach(el => el.remove());

  const notificacion = document.createElement('div');
  notificacion.className = `notificacion notificacion-${tipo}`;
  notificacion.textContent = mensaje;

  document.body.appendChild(notificacion);

  setTimeout(() => notificacion.classList.add('mostrar'), 10);

  setTimeout(() => {
    notificacion.classList.remove('mostrar');
    setTimeout(() => notificacion.remove(), 300);
  }, 3000);
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const d = new Date(dateString);
  if (isNaN(d)) return '-';
  return d.toLocaleDateString('es-ES', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function iniciarCalendario() {
  const calendarEl = document.getElementById('calendar');
  if (!calendarEl) return;

  calendar = new FullCalendar.Calendar(calendarEl, {
    locale: 'es',
    initialView: 'dayGridMonth',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
    },
    events: async (info, successCallback, failureCallback) => {
      try {
        const res = await fetch('/api/acciones/calendar');
        if (!res.ok) throw new Error('Error al cargar eventos calendario');
        const eventos = await res.json();
        successCallback(eventos);
      } catch (err) {
        console.error(err);
        failureCallback(err);
      }
    },
    eventClick: info => {
      abrirModal(info.event.extendedProps);
    }
  });

  calendar.render();
}
