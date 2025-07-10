let currentPage = 1;
let currentLimit = 10;
let currentSort = {};
let currentFilters = {};
let editId = null;
let calendar = null;

document.addEventListener('DOMContentLoaded', () => {
  initModal();
  loadFilters();
  loadAcciones();
  setupEventListeners();
  setupSidebarNavigation();
});

function initModal() {
  const modal = document.getElementById('accionModal');
  const form = document.getElementById('accionForm');
  const addBtn = document.getElementById('addAccionBtn');
  const closeBtn = document.querySelector('.close');

  addBtn.addEventListener('click', () => {
    editId = null;
    form.reset();
    document.getElementById('modalTitle').textContent = 'Nueva Acción';
    modal.style.display = 'flex';
  });

  closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  window.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });

  form.addEventListener('submit', handleFormSubmit);
}

function setupSidebarNavigation() {
  document.querySelectorAll('.sidebar .icon').forEach(icon => {
    icon.addEventListener('click', () => {
      const target = icon.dataset.page;
      if (target) window.location.href = target;
    });
  });
}

function setupEventListeners() {
  // Filtros
  document.getElementById('applyFilters').addEventListener('click', applyFilters);
  document.getElementById('resetFilters').addEventListener('click', resetFilters);
  document.getElementById('exportBtn').addEventListener('click', exportData);
  
  // Búsqueda al presionar Enter
  document.getElementById('searchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') applyFilters();
  });
  
  // Paginación
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('page-btn')) {
      currentPage = parseInt(e.target.dataset.page);
      loadAcciones();
    }
  });
  
  // Ordenación
  document.querySelectorAll('.table-header').forEach(header => {
    header.addEventListener('click', () => {
      const field = header.dataset.sort;
      if (!field) return;
      
      // Cambiar dirección de ordenación
      if (currentSort.field === field) {
        currentSort.order = currentSort.order === 1 ? -1 : 1;
      } else {
        currentSort = { field, order: 1 };
      }
      
      // Actualizar iconos
      document.querySelectorAll('.sort-icon').forEach(icon => {
        icon.textContent = '';
      });
      
      const icon = header.querySelector('.sort-icon');
      icon.textContent = currentSort.order === 1 ? '↑' : '↓';
      
      loadAcciones();
    });
  });
  
  // Vista tabla/calendario
  document.getElementById('tableViewBtn').addEventListener('click', () => {
    document.querySelector('.table-view').style.display = 'block';
    document.getElementById('calendarView').style.display = 'none';
    document.getElementById('tableViewBtn').classList.add('active');
    document.getElementById('calendarViewBtn').classList.remove('active');
  });
  
  document.getElementById('calendarViewBtn').addEventListener('click', () => {
    document.querySelector('.table-view').style.display = 'none';
    document.getElementById('calendarView').style.display = 'block';
    document.getElementById('tableViewBtn').classList.remove('active');
    document.getElementById('calendarViewBtn').classList.add('active');
    initCalendar();
  });
}

async function loadFilters() {
  try {
    const response = await fetch('/api/acciones/filters');
    if (!response.ok) throw new Error('Error al cargar filtros');
    
    const { tipos, estados } = await response.json();
    const tipoFilter = document.getElementById('tipoFilter');
    const estadoFilter = document.getElementById('estadoFilter');
    
    // Limpiar selects
    tipoFilter.innerHTML = '<option value="">Todos</option>';
    estadoFilter.innerHTML = '<option value="">Todos</option>';
    
    // Llenar tipos
    tipos.forEach(tipo => {
      const option = document.createElement('option');
      option.value = tipo;
      option.textContent = tipo;
      tipoFilter.appendChild(option);
    });
    
    // Llenar estados
    estados.forEach(estado => {
      const option = document.createElement('option');
      option.value = estado;
      option.textContent = estado;
      estadoFilter.appendChild(option);
    });
  } catch (error) {
    showNotification('Error al cargar filtros', 'error');
  }
}

async function loadAcciones() {
  try {
    const params = new URLSearchParams({
      page: currentPage,
      limit: currentLimit,
      ...currentFilters,
      ...(currentSort.field && { 
        sortField: currentSort.field, 
        sortOrder: currentSort.order 
      })
    });
    
    const response = await fetch(`/api/acciones?${params}`);
    if (!response.ok) throw new Error('Error al cargar acciones');
    
    const { data: acciones, total, page, totalPages } = await response.json();
    renderAcciones(acciones);
    renderPagination(total, page, totalPages);
    
    // Configurar eventos para los botones de acción
    document.querySelector('#accionesTable tbody').addEventListener('click', handleTableActions);
  } catch (error) {
    showNotification('Error al cargar las acciones', 'error');
  }
}

function renderAcciones(acciones) {
  const tbody = document.querySelector('#accionesTable tbody');
  tbody.innerHTML = acciones.map(accion => `
    <tr>
      <td>${accion.nombre || ''}</td>
      <td>${accion.asociacionEntidad || ''}</td>
      <td>${accion.email || ''}</td>
      <td>${accion.telefono || ''}</td>
      <td>${accion.tipoAccion || ''}</td>
      <td>${accion.fechaInicio ? new Date(accion.fechaInicio).toLocaleDateString() : ''}</td>
      <td>${accion.fechaFin ? new Date(accion.fechaFin).toLocaleDateString() : ''}</td>
      <td>${Array.isArray(accion.horario) ? accion.horario.join(', ') : ''}</td>
      <td>${Array.isArray(accion.responsableAccion) ? accion.responsableAccion.join(', ') : ''}</td>
      <td><span class="status ${(accion.estado || '').toLowerCase().replace(/\s/g, '')}">${accion.estado || 'Pendiente'}</span></td>
      <td>${accion.fechaInsercion ? new Date(accion.fechaInsercion).toLocaleDateString() : ''}</td>
      <td class="action-btns">
        <button class="edit-btn" data-id="${accion._id}"><i class="fas fa-edit"></i></button>
        <button class="delete-btn" data-id="${accion._id}"><i class="fas fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

function renderPagination(total, currentPage, totalPages) {
  const pagination = document.getElementById('pagination');
  pagination.innerHTML = '';
  
  if (totalPages <= 1) return;
  
  // Botón Anterior
  const prevBtn = document.createElement('button');
  prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
  prevBtn.disabled = currentPage === 1;
  prevBtn.dataset.page = currentPage - 1;
  prevBtn.classList.add('page-btn');
  pagination.appendChild(prevBtn);
  
  // Páginas
  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);
  
  for (let i = startPage; i <= endPage; i++) {
    const pageBtn = document.createElement('button');
    pageBtn.textContent = i;
    pageBtn.dataset.page = i;
    pageBtn.classList.add('page-btn');
    if (i === currentPage) pageBtn.classList.add('active');
    pagination.appendChild(pageBtn);
  }
  
  // Botón Siguiente
  const nextBtn = document.createElement('button');
  nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.dataset.page = currentPage + 1;
  nextBtn.classList.add('page-btn');
  pagination.appendChild(nextBtn);
  
  // Info total
  const info = document.createElement('span');
  info.textContent = `Total: ${total} acciones`;
  info.style.marginLeft = '15px';
  info.style.color = '#666';
  pagination.appendChild(info);
}

function handleTableActions(e) {
  if (e.target.closest('.edit-btn')) {
    editAccion(e.target.closest('.edit-btn').dataset.id);
  } else if (e.target.closest('.delete-btn')) {
    deleteAccion(e.target.closest('.delete-btn').dataset.id);
  }
}

function applyFilters() {
  currentPage = 1;
  currentFilters = {
    search: document.getElementById('searchInput').value.trim(),
    tipo: document.getElementById('tipoFilter').value,
    estado: document.getElementById('estadoFilter').value
  };
  loadAcciones();
}

function resetFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('tipoFilter').value = '';
  document.getElementById('estadoFilter').value = '';
  currentFilters = {};
  currentPage = 1;
  loadAcciones();
}

async function exportData() {
  try {
    const response = await fetch('/api/acciones/export');
    if (!response.ok) throw new Error('Error al exportar');
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'acciones.csv';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    
    showNotification('Datos exportados correctamente', 'success');
  } catch (error) {
    showNotification('Error al exportar datos', 'error');
  }
}

function initCalendar() {
  const calendarEl = document.getElementById('calendar');
  
  if (!calendar) {
    calendar = new FullCalendar.Calendar(calendarEl, {
      locale: 'es',
      initialView: 'dayGridMonth',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,timeGridDay'
      },
      events: '/api/acciones/calendar',
      eventClick: function(info) {
        editAccion(info.event.extendedProps._id);
      },
      eventTimeFormat: {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }
    });
  }
  
  calendar.render();
}

async function editAccion(id) {
  try {
    const response = await fetch(`/api/acciones/${id}`);
    if (!response.ok) throw new Error('Error al cargar la acción');
    
    const accion = await response.json();
    editId = id;
    
    const form = document.getElementById('accionForm');
    Object.keys(accion).forEach(key => {
      if (form[key] !== undefined) {
        if (form[key].type === 'checkbox') {
          form[key].checked = accion[key];
        } else {
          form[key].value = accion[key];
        }
      }
    });
    
    document.getElementById('modalTitle').textContent = 'Editar Acción';
    document.getElementById('accionModal').style.display = 'flex';
    
  } catch (error) {
    showNotification('Error al cargar la acción para editar', 'error');
  }
}

async function deleteAccion(id) {
  if (!confirm('¿Estás seguro de que quieres eliminar esta acción?')) return;
  
  try {
    const response = await fetch(`/api/acciones/${id}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) throw new Error('Error al eliminar la acción');
    
    showNotification('Acción eliminada correctamente', 'success');
    loadAcciones();
  } catch (error) {
    showNotification('Error al eliminar la acción', 'error');
  }
}

async function handleFormSubmit(e) {
  e.preventDefault();
  
  const form = e.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  
  try {
    const url = editId ? `/api/acciones/${editId}` : '/api/acciones';
    const method = editId ? 'PUT' : 'POST';
    
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) throw new Error('Error al guardar la acción');
    
    showNotification(`Acción ${editId ? 'actualizada' : 'creada'} correctamente`, 'success');
    document.getElementById('accionModal').style.display = 'none';
    loadAcciones();
    
  } catch (error) {
    showNotification('Error al guardar la acción', 'error');
  }
}

function showNotification(message, type = 'success') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}