import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { MongoClient, ObjectId } from 'mongodb';
import session from 'express-session';
import bcrypt from 'bcrypt';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const PORT = 3000;
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuración de Express
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Configuración de sesión
app.use(session({
  secret: process.env.SESSION_SECRET || 'mi_clave_secreta',
  resave: false,
  saveUninitialized: false,
}));  
   
 


// Middleware de autenticación
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/');
  }
  next();
};

// Conexión a MongoDB
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017');
let db;

(async () => {
  try {
    await client.connect();
    db = client.db('kudehezi');
    console.log('Conectado a MongoDB');
    
    // Crear índices
    await db.collection('acciones').createIndex({ nombre: 1 });
    await db.collection('acciones').createIndex({ tipoAccion: 1 });
    await db.collection('acciones').createIndex({ estado: 1 });
    await db.collection('acciones').createIndex({ fechaInicio: 1 });
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
    
    // Iniciar servidor
   
} catch (err) {
    console.error('Error al conectar a MongoDB:', err);
}

// Middleware para determinar la página actual
app.use((req, res, next) => {
  const path = req.path.slice(1);
  res.locals.activePage = path || 'panel';
  res.locals.user = req.session.user || null;
  next();
});

// Rutas de autenticación
app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/panel');
  }
  res.render('login', { 
    title: 'Inicio de Sesión',
    activePage: 'login',
    error: null
  });
});

app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).render('login', {
        title: 'Inicio de Sesión',
        activePage: 'login',
        error: 'Usuario y contraseña son requeridos'
      });
    }

    const existingUser = await db.collection('users').findOne({ username });
    if (existingUser) {
      return res.status(400).render('login', {
        title: 'Inicio de Sesión',
        activePage: 'login',
        error: 'Usuario ya existe'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.collection('users').insertOne({ 
      username, 
      password: hashedPassword,
      createdAt: new Date()
    });

    req.session.user = { username };
    res.redirect('/panel');
  } catch (err) {
    console.error('Error en registro:', err);
    res.status(500).render('login', {
      title: 'Inicio de Sesión',
      activePage: 'login',
      error: 'Error en el servidor'
    });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.collection('users').findOne({ username });
    
    if (!user) {
      return res.render('login', {
        title: 'Inicio de Sesión',
        activePage: 'login',
        error: 'Usuario no encontrado'
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.render('login', {
        title: 'Inicio de Sesión',
        activePage: 'login',
        error: 'Contraseña incorrecta'
      });
    }

    req.session.user = { 
      id: user._id.toString(), 
      username: user.username 
    };
    res.redirect('/panel');
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).render('login', {
      title: 'Inicio de Sesión',
      activePage: 'login',
      error: 'Error en el servidor'
    });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Error al cerrar sesión:', err);
      return res.status(500).render('error', {
        title: 'Error',
        activePage: 'error',
        message: 'Error al cerrar sesión'
      });
    }
    res.redirect('/');
  });
});

// Rutas protegidas
app.get('/panel', requireAuth, (req, res) => {
  res.render('panel', { 
    title: 'Panel de Acciones',
    activePage: 'panel'
  });
});

app.get('/estadisticas', requireAuth, (req, res) => {
  res.render('estadisticas', { 
    title: 'Estadísticas',
    activePage: 'estadisticas'
  });
});

app.get('/configuracion', requireAuth, (req, res) => {
  res.render('configuracion', { 
    title: 'Configuración',
    activePage: 'configuracion'
  });
});

// API Acciones
app.get('/api/acciones', requireAuth, async (req, res) => {
  try {
    const { 
      search, 
      tipo, 
      estado, 
      page = 1, 
      limit = 10, 
      sortField, 
      sortOrder = 1 
    } = req.query;
    
    const skip = (page - 1) * limit;
    const query = {};
    
    if (search) {
      query.$or = [
        { nombre: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { asociacionEntidad: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (tipo) query.tipoAccion = tipo;
    if (estado) query.estado = estado;

    const sort = {};
    if (sortField) sort[sortField] = parseInt(sortOrder);

    const [acciones, total] = await Promise.all([
      db.collection('acciones')
        .find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .toArray(),
      db.collection('acciones').countDocuments(query)
    ]);

    res.json({
      data: acciones,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Error en /api/acciones:', err);
    res.status(500).json({ error: 'Error al obtener las acciones' });
  }
});

app.get('/api/acciones/filters', requireAuth, async (req, res) => {
  try {
    const [tipos, estados] = await Promise.all([
      db.collection('acciones').distinct('tipoAccion'),
      db.collection('acciones').distinct('estado')
    ]);
    res.json({ tipos, estados });
  } catch (err) {
    console.error('Error en /api/acciones/filters:', err);
    res.status(500).json({ error: 'Error al obtener los filtros' });
  }
});

app.get('/api/acciones/export', requireAuth, async (req, res) => {
  try {
    const acciones = await db.collection('acciones').find().toArray();
    
    if (acciones.length === 0) {
      return res.status(404).json({ error: 'No hay acciones para exportar' });
    }

    // Mejor formato CSV
    const headers = Object.keys(acciones[0]).join(',');
    const rows = acciones.map(accion => 
      Object.values(accion).map(value => 
        typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
      ).join(',')
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=acciones.csv');
    res.send([headers, ...rows].join('\n'));
  } catch (err) {
    console.error('Error en /api/acciones/export:', err);
    res.status(500).json({ error: 'Error al exportar las acciones' });
  }
});

app.get('/api/acciones/calendar', requireAuth, async (req, res) => {
  try {
    const acciones = await db.collection('acciones')
      .find({ 
        fechaInicio: { $exists: true },
        $or: [
          { fechaFin: { $exists: false } },
          { fechaFin: { $gte: new Date(new Date().setFullYear(new Date().getFullYear() - 1)) } }
        ]
      })
      .toArray();

    const eventos = acciones.map(accion => ({
      id: accion._id.toString(),
      title: accion.nombre,
      start: accion.fechaInicio,
      end: accion.fechaFin || accion.fechaInicio,
      allDay: !accion.horario || accion.horario.length === 0,
      extendedProps: {
        tipo: accion.tipoAccion,
        estado: accion.estado,
        responsable: accion.responsableAccion?.join(', ') || ''
      }
    }));

    res.json(eventos);
  } catch (err) {
    console.error('Error en /api/acciones/calendar:', err);
    res.status(500).json({ error: 'Error al obtener eventos del calendario' });
  }
});

// CRUD Acciones
app.get('/api/acciones/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const accion = await db.collection('acciones').findOne({ 
      _id: new ObjectId(id) 
    });

    if (!accion) {
      return res.status(404).json({ error: 'Acción no encontrada' });
    }

    res.json(accion);
  } catch (err) {
    console.error('Error en /api/acciones/:id:', err);
    res.status(500).json({ error: 'Error al obtener la acción' });
  }
});

app.post('/api/acciones', requireAuth, async (req, res) => {
  try {
    const { nombre, tipoAccion, email, fechaInicio } = req.body;
    if (!nombre || !tipoAccion || !email || !fechaInicio) {
      return res.status(400).json({ 
        error: 'Nombre, tipo, email y fecha inicio son requeridos' 
      });
    }

    const nuevaAccion = {
      nombre,
      tipoAccion,
      email,
      fechaInicio: new Date(fechaInicio),
      asociacionEntidad: req.body.asociacionEntidad || '',
      telefono: req.body.telefono || '',
      fechaFin: req.body.fechaFin ? new Date(req.body.fechaFin) : null,
      estado: req.body.estado || 'Pendiente',
      responsableAccion: Array.isArray(req.body.responsableAccion) ? 
        req.body.responsableAccion : 
        (req.body.responsableAccion ? [req.body.responsableAccion] : []),
      horario: Array.isArray(req.body.horario) ? 
        req.body.horario : 
        (req.body.horario ? [req.body.horario] : []),
      fechaInsercion: new Date(),
      usuarioCreacion: req.session.user.username
    };

    const result = await db.collection('acciones').insertOne(nuevaAccion);
    res.status(201).json({ 
      _id: result.insertedId, 
      ...nuevaAccion 
    });
  } catch (err) {
    console.error('Error en POST /api/acciones:', err);
    res.status(500).json({ error: 'Error al crear la acción' });
  }
});

app.put('/api/acciones/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const { nombre, tipoAccion, email, fechaInicio } = req.body;
    if (!nombre || !tipoAccion || !email || !fechaInicio) {
      return res.status(400).json({ 
        error: 'Nombre, tipo, email y fecha inicio son requeridos' 
      });
    }

    const accionActualizada = {
      ...req.body,
      fechaInicio: new Date(fechaInicio),
      fechaFin: req.body.fechaFin ? new Date(req.body.fechaFin) : null,
      fechaModificacion: new Date(),
      usuarioModificacion: req.session.user.username
    };

    const result = await db.collection('acciones').updateOne(
      { _id: new ObjectId(id) },
      { $set: accionActualizada }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Acción no encontrada' });
    }

    res.json({ 
      modifiedCount: result.modifiedCount,
      accion: accionActualizada
    });
  } catch (err) {
    console.error('Error en PUT /api/acciones/:id:', err);
    res.status(500).json({ error: 'Error al actualizar la acción' });
  }
});

app.delete('/api/acciones/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const result = await db.collection('acciones').deleteOne({ 
      _id: new ObjectId(id) 
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Acción no encontrada' });
    }

    res.json({ deletedCount: result.deletedCount });
  } catch (err) {
    console.error('Error en DELETE /api/acciones/:id:', err);
    res.status(500).json({ error: 'Error al eliminar la acción' });
  }
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { 
    title: 'Error',
    activePage: 'error',
    message: 'Algo salió mal!'
  });
});

// Ruta para cualquier otra petición
app.use((req, res) => {
  res.status(404).render('404', { 
    title: 'Página no encontrada',
    activePage: '404'
  });
});
// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
});
})().catch(err => {
  console.error('Error al iniciar el servidor:', err);
  process.exit(1);
});