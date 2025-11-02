require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Postgres connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret123',
  resave: false,
  saveUninitialized: true
}));

// Helper DB query function
async function dbQuery(text, params) {
  const res = await pool.query(text, params);
  return res;
}

// Initialize tables and demo admin
(async () => {
  try {
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbQuery(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        sku TEXT,
        quantity INTEGER DEFAULT 0,
        location TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create demo admin if no users exist
    const res = await dbQuery('SELECT COUNT(*) AS cnt FROM users');
    if (res.rows && Number(res.rows[0].cnt) === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await dbQuery('INSERT INTO users (username, password_hash) VALUES ($1, $2)', ['admin', hash]);
      console.log('Created demo admin: username=admin, password=admin123');
    }
  } catch (err) {
    console.error('Error initializing DB:', err);
  }
})();

// Middleware to check login
function checkAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// Routes
app.get('/', (req, res) => res.redirect('/login'));

// Login
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const r = await dbQuery('SELECT * FROM users WHERE username=$1', [username]);
    const user = r.rows[0];
    if (user && await bcrypt.compare(password, user.password_hash)) {
      req.session.user = { id: user.id, username: user.username };
      res.redirect('/dashboard');
    } else {
      res.render('login', { error: 'Invalid credentials' });
    }
  } catch (err) {
    console.error(err);
    res.render('login', { error: 'Server error' });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Dashboard
app.get('/dashboard', checkAuth, async (req, res) => {
  try {
    const r = await dbQuery('SELECT COUNT(*) AS total FROM items');
    res.render('dashboard', { total: r.rows[0].total, currentUser: req.session.user });
  } catch (err) {
    console.error(err);
    res.send('Server error');
  }
});

// Items list
app.get('/items', checkAuth, async (req, res) => {
  try {
    const r = await dbQuery('SELECT * FROM items ORDER BY id DESC');
    res.render('inventory_list', { items: r.rows, currentUser: req.session.user });
  } catch (err) {
    console.error(err);
    res.send('Server error');
  }
});

// Add new item form
app.get('/items/new', checkAuth, (req, res) => {
  res.render('inventory_form', { item: null, action: '/items/new', currentUser: req.session.user });
});

// Add new item POST
app.post('/items/new', checkAuth, async (req, res) => {
  const { name, sku, quantity, location, notes } = req.body;
  try {
    await dbQuery('INSERT INTO items (name, sku, quantity, location, notes) VALUES ($1,$2,$3,$4,$5)', [name, sku, quantity, location, notes]);
    res.redirect('/items');
  } catch (err) {
    console.error(err);
    res.send('Server error');
  }
});

// Edit item form
app.get('/items/:id/edit', checkAuth, async (req, res) => {
  try {
    const r = await dbQuery('SELECT * FROM items WHERE id=$1', [req.params.id]);
    const item = r.rows[0];
    res.render('inventory_form', { item, action: `/items/${req.params.id}/edit`, currentUser: req.session.user });
  } catch (err) {
    console.error(err);
    res.send('Server error');
  }
});

// Edit item POST
app.post('/items/:id/edit', checkAuth, async (req, res) => {
  const { name, sku, quantity, location, notes } = req.body;
  try {
    await dbQuery('UPDATE items SET name=$1, sku=$2, quantity=$3, location=$4, notes=$5 WHERE id=$6', [name, sku, quantity, location, notes, req.params.id]);
    res.redirect('/items');
  } catch (err) {
    console.error(err);
    res.send('Server error');
  }
});

// Delete item
app.post('/items/:id/delete', checkAuth, async (req, res) => {
  try {
    await dbQuery('DELETE FROM items WHERE id=$1', [req.params.id]);
    res.redirect('/items');
  } catch (err) {
    console.error(err);
    res.send('Server error');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

