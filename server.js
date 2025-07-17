import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { MongoClient, ObjectId } from 'mongodb';
import session from 'express-session';
import bcrypt from 'bcrypt';
import { createRequire } from 'module';
import { v4 as uuidv4 } from 'uuid';

const require = createRequire(import.meta.url);
const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017');
let db;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Sesión
app.use(session({
  secret: process.env.SESSION_SECRET || uuidv4(),
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Pasar info user y página activa
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.activePage = req.path.split('/')[1] || 'panel';
  next();
});

// Protección rutas
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).redirect('/');
  }
  next();
};

// Parsear fechas en query
app.use((req, res, next) => {
  if (req.query.fechaInicio) req.query.fechaInicio = new Date(req.query.fechaInicio);
  if (req.query.fechaFin) req.query.fechaFin = new Date(req.query.fechaFin);
  next();
});

(async () => {
  try {
    await client.connect();
    db = client.db('kudehezi');
    console.log('Conectado a MongoDB');

    // --- RUTAS PÚBLICAS ---
    app.get('/', (req, res) => {
      if (req.session.user) return res.redirect('/panel');
      res.render('login', { title: 'Inicio de Sesión', activePage: 'login', error: null });
    });

    app.post('/register', async (req, res) => {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).render('login', { title: 'Inicio de Sesión', activePage: 'login', error: 'Usuario y contraseña son requeridos' });
      }
      try {
        const existingUser = await db.collection('users').findOne({ username });
        if (existingUser) {
          return res.status(400).render('login', { title: 'Inicio de Sesión', activePage: 'login', error: 'Usuario ya existe' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.collection('users').insertOne({ 
          username, 
          password: hashedPassword, 
          name: username, 
          createdAt: new Date(),
          config: { color: '#ffffff' } // Configuración inicial
        });
        req.session.user = { 
          id: (await db.collection('users').findOne({ username }))._id.toString(), 
          username, 
          name: username,
          config: { color: '#ffffff' }
        };
        res.redirect('/panel');
      } catch (err) {
        console.error('Error en registro:', err);
        res.status(500).render('login', { title: 'Inicio de Sesión', activePage: 'login', error: 'Error en el servidor' });
      }
    });

    app.post('/login', async (req, res) => {
      const { username, password } = req.body;
      try {
        const user = await db.collection('users').findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
          return res.status(401).render('login', { title: 'Inicio de Sesión', activePage: 'login', error: 'Usuario o contraseña incorrectos' });
        }
        req.session.user = { 
          id: user._id.toString(), 
          username: user.username, 
          name: user.name || user.username,
          config: user.config || { color: '#ffffff' }
        };
        res.redirect('/panel');
      } catch (err) {
        console.error('Error en login:', err);
        res.status(500).render('login', { title: 'Inicio de Sesión', activePage: 'login', error: 'Error en el servidor' });
      }
    });

    app.get('/logout', (req, res) => {
      req.session.destroy(err => {
        if (err) {
          console.error('Error al cerrar sesión:', err);
          return res.status(500).render('error', { title: 'Error', message: 'Error al cerrar sesión' });
        }
        res.redirect('/');
      });
    });

    // --- RUTAS PROTEGIDAS ---
    app.get('/panel', requireAuth, (req, res) => {
      res.render('panel', { title: 'Panel', activePage: 'panel' });
    });

    app.get('/estadisticas', requireAuth, (req, res) => {
      res.render('estadisticas', { title: 'Estadísticas', activePage: 'estadisticas' });
    });

    app.get('/configuracion', requireAuth, async (req, res) => {
      try {
        const user = await db.collection('users').findOne({ 
          _id: new ObjectId(req.session.user.id) 
        });
        
        res.render('configuracion', { 
          title: 'Configuración', 
          user: req.session.user,
          config: user?.config || { color: '#ffffff' },
          activePage: 'configuracion' 
        });
      } catch (err) {
        console.error('Error al cargar configuración:', err);
        res.status(500).render('error', { 
          title: 'Error', 
          message: 'Error al cargar la configuración',
          error: err 
        });
      }
    });

    // API: Listado acciones con filtros y paginación
    app.get('/api/acciones', requireAuth, async (req, res) => {
      try {
        const { search, tipo, estado, page = 1, limit = 10, sortField, sortOrder = 1 } = req.query;
        const query = {};
        if (search) {
          query.$or = [
            { nombre: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { asociacionEntidad: { $regex: search, $options: 'i' } },
            { telefono: { $regex: search, $options: 'i' } }
          ];
        }
        if (tipo) query.tipoAccion = tipo;
        if (estado) query.estado = estado;
        const sort = sortField ? { [sortField]: parseInt(sortOrder) } : { fechaInsercion: -1 };
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const limitNum = parseInt(limit);

        const [acciones, total] = await Promise.all([
          db.collection('acciones').find(query).sort(sort).skip(skip).limit(limitNum).toArray(),
          db.collection('acciones').countDocuments(query)
        ]);

        const accionesFormateadas = acciones.map(accion => ({
          ...accion,
          _id: accion._id.toString(),
          fechaInicio: accion.fechaInicio?.toISOString(),
          fechaFin: accion.fechaFin?.toISOString(),
          fechaInsercion: accion.fechaInsercion?.toISOString()
        }));

        res.json({ data: accionesFormateadas, total, page: parseInt(page), limit: limitNum, totalPages: Math.ceil(total / limitNum) });
      } catch (err) {
        console.error('Error en /api/acciones:', err);
        res.status(500).json({ error: 'Error al obtener las acciones', details: err.message });
      }
    });

    // API: Filtros únicos
    app.get('/api/acciones/filters', requireAuth, async (req, res) => {
      try {
        const [tipos, estados] = await Promise.all([
          db.collection('acciones').distinct('tipoAccion'),
          db.collection('acciones').distinct('estado')
        ]);
        res.json({ tipos: tipos.filter(t => t), estados: estados.filter(e => e) });
      } catch (err) {
        res.status(500).json({ error: 'Error al obtener los filtros', details: err.message });
      }
    });

    // API: Exportar acciones CSV
    app.get('/api/acciones/export', requireAuth, async (req, res) => {
      try {
        const acciones = await db.collection('acciones').find().toArray();
        if (acciones.length === 0) {
          return res.status(404).json({ error: 'No hay acciones para exportar' });
        }
        const headers = ['Nombre','Entidad','Email','Teléfono','Tipo','Fecha Inicio','Fecha Fin','Horario','Responsables','Estado','Fecha Inserción'].join(',');
        const rows = acciones.map(a => [
          `"${(a.nombre||'').replace(/"/g,'""')}"`,
          `"${(a.asociacionEntidad||'').replace(/"/g,'""')}"`,
          `"${(a.email||'').replace(/"/g,'""')}"`,
          `"${(a.telefono||'').replace(/"/g,'""')}"`,
          `"${(a.tipoAccion||'').replace(/"/g,'""')}"`,
          a.fechaInicio?.toISOString()||'',
          a.fechaFin?.toISOString()||'',
          `"${(a.horario||[]).join(';').replace(/"/g,'""')}"`,
          `"${(a.responsableAccion||[]).join(';').replace(/"/g,'""')}"`,
          `"${(a.estado||'').replace(/"/g,'""')}"`,
          a.fechaInsercion?.toISOString()||''
        ].join(','));
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=acciones.csv');
        res.send([headers, ...rows].join('\n'));
      } catch (err) {
        console.error('Error al exportar:', err);
        res.status(500).json({ error: 'Error al exportar las acciones', details: err.message });
      }
    });

    // API: Eventos calendario
    app.get('/api/acciones/calendar', requireAuth, async (req, res) => {
      try {
        const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const sixMonthsLater = new Date(); sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
        const query = { fechaInicio: { $exists: true, $gte: sixMonthsAgo, $lte: sixMonthsLater } };
        const acciones = await db.collection('acciones').find(query).toArray();

        const eventos = acciones.map(a => ({
          id: a._id.toString(),
          title: a.nombre || 'Sin nombre',
          start: a.fechaInicio.toISOString(),
          end: a.fechaFin ? a.fechaFin.toISOString() : a.fechaInicio.toISOString(),
          allDay: !a.horario || a.horario.length === 0,
          extendedProps: {
            tipo: a.tipoAccion || '',
            estado: a.estado || 'Pendiente',
            responsable: (a.responsableAccion || []).join(', ') || ''
          },
          backgroundColor: getEventColor(a.estado),
          borderColor: getEventColor(a.estado)
        }));

        res.json(eventos);
      } catch (err) {
        console.error('Error en /api/acciones/calendar:', err);
        res.status(500).json({ error: 'Error al obtener eventos del calendario', details: err.message });
      }
    });

    function getEventColor(estado) {
      switch (estado) {
        case 'Completado': return '#28a745';
        case 'En curso': return '#17a2b8';
        case 'Cancelado': return '#dc3545';
        default: return '#6c757d';
      }
    }

    // CRUD acciones
    app.get('/api/acciones/:id', requireAuth, async (req, res) => {
      try {
        if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
        const accion = await db.collection('acciones').findOne({ _id: new ObjectId(req.params.id) });
        if (!accion) return res.status(404).json({ error: 'Acción no encontrada' });

        res.json({
          ...accion,
          _id: accion._id.toString(),
          fechaInicio: accion.fechaInicio?.toISOString(),
          fechaFin: accion.fechaFin?.toISOString(),
          fechaInsercion: accion.fechaInsercion?.toISOString()
        });
      } catch (err) {
        console.error('Error en /api/acciones/:id:', err);
        res.status(500).json({ error: 'Error al obtener la acción', details: err.message });
      }
    });

    app.post('/api/acciones', requireAuth, async (req, res) => {
      try {
        const { nombre, tipoAccion, email, fechaInicio } = req.body;
        if (!nombre || !tipoAccion || !email || !fechaInicio) {
          return res.status(400).json({ error: 'Nombre, tipo, email y fecha inicio son obligatorios' });
        }
        const nuevaAccion = {
          nombre: nombre.trim(),
          tipoAccion: tipoAccion.trim(),
          email: email.trim(),
          fechaInicio: new Date(fechaInicio),
          asociacionEntidad: req.body.asociacionEntidad?.trim() || '',
          telefono: req.body.telefono?.trim() || '',
          fechaFin: req.body.fechaFin ? new Date(req.body.fechaFin) : null,
          estado: req.body.estado || 'Pendiente',
          responsableAccion: Array.isArray(req.body.responsableAccion) ? req.body.responsableAccion.map(r => r.trim()) : (req.body.responsableAccion ? [req.body.responsableAccion.trim()] : []),
          horario: Array.isArray(req.body.horario) ? req.body.horario.map(h => h.trim()) : (req.body.horario ? [req.body.horario.trim()] : []),
          fechaInsercion: new Date(),
          usuarioCreacion: req.session.user.username
        };
        const result = await db.collection('acciones').insertOne(nuevaAccion);
        res.status(201).json({ _id: result.insertedId.toString(), ...nuevaAccion, fechaInicio: nuevaAccion.fechaInicio.toISOString(), fechaFin: nuevaAccion.fechaFin?.toISOString(), fechaInsercion: nuevaAccion.fechaInsercion.toISOString() });
      } catch (err) {
        console.error('Error en POST /api/acciones:', err);
        res.status(500).json({ error: 'Error al crear la acción', details: err.message });
      }
    });

    app.put('/api/acciones/:id', requireAuth, async (req, res) => {
      try {
        if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
        const { nombre, tipoAccion, email, fechaInicio } = req.body;
        if (!nombre || !tipoAccion || !email || !fechaInicio) {
          return res.status(400).json({ error: 'Nombre, tipo, email y fecha inicio son obligatorios' });
        }
        const update = {
          nombre: nombre.trim(),
          tipoAccion: tipoAccion.trim(),
          email: email.trim(),
          fechaInicio: new Date(fechaInicio),
          asociacionEntidad: req.body.asociacionEntidad?.trim() || '',
          telefono: req.body.telefono?.trim() || '',
          fechaFin: req.body.fechaFin ? new Date(req.body.fechaFin) : null,
          estado: req.body.estado || 'Pendiente',
          responsableAccion: Array.isArray(req.body.responsableAccion) ? req.body.responsableAccion.map(r => r.trim()) : (req.body.responsableAccion ? [req.body.responsableAccion.trim()] : []),
          horario: Array.isArray(req.body.horario) ? req.body.horario.map(h => h.trim()) : (req.body.horario ? [req.body.horario.trim()] : []),
          fechaModificacion: new Date(),
          usuarioModificacion: req.session.user.username
        };
        const result = await db.collection('acciones').updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });
        if (!result.matchedCount) return res.status(404).json({ error: 'Acción no encontrada' });
        res.json({ modifiedCount: result.modifiedCount, accion: { ...update, _id: req.params.id, fechaInicio: update.fechaInicio.toISOString(), fechaFin: update.fechaFin?.toISOString() } });
      } catch (err) {
        console.error('Error en PUT /api/acciones/:id:', err);
        res.status(500).json({ error: 'Error al actualizar la acción', details: err.message });
      }
    });

    app.delete('/api/acciones/:id', requireAuth, async (req, res) => {
      try {
        if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
        const result = await db.collection('acciones').deleteOne({ _id: new ObjectId(req.params.id) });
        if (!result.deletedCount) return res.status(404).json({ error: 'Acción no encontrada' });
        res.json({ deletedCount: result.deletedCount });
      } catch (err) {
        console.error('Error en DELETE /api/acciones/:id:', err);
        res.status(500).json({ error: 'Error al eliminar la acción', details: err.message });
      }
    });

    // API: Guardar configuración
    app.post('/api/configuracion', requireAuth, async (req, res) => {
      try {
        const { color } = req.body;
        const userId = new ObjectId(req.session.user.id);
        
        await db.collection('users').updateOne(
          { _id: userId },
          { $set: { config: { color } } }
        );
        
        // Actualizar sesión
        req.session.user.config = { color };
        
        res.json({ success: true });
      } catch (err) {
        console.error('Error al guardar configuración:', err);
        res.status(500).json({ 
          success: false, 
          error: 'Error al guardar la configuración' 
        });
      }
    });

    // API: Obtener configuración
   app.post('/api/configuracion', requireAuth, async (req, res) => {
  try {
    const userId = new ObjectId(req.session.user.id);
    const { color } = req.body;

    const result = await db.collection('users').updateOne(
      { _id: userId },
      { $set: { 'config.color': color } }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Error al guardar configuración:', err);
    res.status(500).json({ success: false, error: 'Error al guardar configuración' });
  }
});

    // Estadísticas
    app.get('/api/estadisticas', requireAuth, async (req, res) => {
      try {
        const estados = await db.collection('acciones').aggregate([
          { $group: { _id: "$estado", count: { $sum: 1 } } }
        ]).toArray();

        const tipos = await db.collection('acciones').aggregate([
          { $group: { _id: "$tipoAccion", count: { $sum: 1 } } }
        ]).toArray();

        res.json({ estados, tipos });
      } catch (err) {
        console.error('Error en /api/estadisticas:', err);
        res.status(500).json({ error: 'Error al obtener estadísticas', details: err.message });
      }
    });

    // Actualizar perfil usuario
    app.post('/api/usuario/perfil', requireAuth, async (req, res) => {
      try {
        const { name, email } = req.body;
        if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });

        const userId = new ObjectId(req.session.user.id);

        await db.collection('users').updateOne({ _id: userId }, { $set: { name, email } });

        // Actualizar sesión
        req.session.user.name = name;
        req.session.user.email = email;

        res.json({ success: true, user: req.session.user });
      } catch (err) {
        console.error('Error actualizar perfil:', err);
        res.status(500).json({ success: false, error: 'Error al actualizar perfil' });
      }
    });

    // Cambiar contraseña
    app.post('/api/usuario/password', requireAuth, async (req, res) => {
      try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Datos insuficientes' });

        const userId = new ObjectId(req.session.user.id);
        const user = await db.collection('users').findOne({ _id: userId });

        if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
          return res.status(400).json({ error: 'Contraseña actual incorrecta' });
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await db.collection('users').updateOne({ _id: userId }, { $set: { password: hashedNewPassword } });

        res.json({ success: true });
      } catch (err) {
        console.error('Error cambiar contraseña:', err);
        res.status(500).json({ success: false, error: 'Error al cambiar contraseña' });
      }
    });

    // 404 y errores
    app.use((req, res) => {
      res.status(404).render('404', { title: 'Página no encontrada' });
    });

    app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(500).render('error', { 
        title: 'Error', 
        message: 'Algo salió mal!',
        error: err 
      });
    });

    app.listen(PORT, () => {
      console.log(`Servidor en http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Error al conectar a MongoDB:', err);
    process.exit(1);
  }
})();