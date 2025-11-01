// app.js - copy this whole file and save as app.js
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'devsecret';
const DB_FILE = process.env.DB_FILE || './data/inventory.db';

// ensure data folder exists
if (!fs.existsSync(path.dirname(DB_FILE))) fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

// open sqlite DB
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) console.error('DB open error', err);
});

// create tables if not exist
const initSql = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER DEFAULT 0,
  location TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;
db.exec(initSql, (e) => { if (e) console.error('DB init error', e); });

// ensure an admin user exists (username: admin / password: admin123) - only if users table empty
db.get('SELECT COUNT(*) AS cnt FROM users', [], async (err, row) => {
  if (!err && row && row.cnt === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', ['admin', hash]);
    console.log('Created demo admin user -> username: admin password: admin123');
  }
});

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: './data' }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 4 }
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

app.get('/', (req, res) => res.redirect('/dashboard'));

app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, row) => {
    if (err || !row) return res.render('login', { error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.render('login', { error: 'Invalid credentials' });
    req.session.user = { id: row.id, username: row.username };
    res.redirect('/dashboard');
  });
});

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.render('register', { error: 'Required' });
  const hash = await bcrypt.hash(password, 10);
  db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash], function(err) {
    if (err) return res.render('register', { error: 'Username taken' });
    req.session.user = { id: this.lastID, username };
    res.redirect('/dashboard');
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/dashboard', requireLogin, (req, res) => {
  db.get('SELECT COUNT(*) as cnt FROM items', [], (err, row) => {
    const total = row ? row.cnt : 0;
    res.render('dashboard', { total });
  });
});

app.get('/items', requireLogin, (req, res) => {
  db.all('SELECT * FROM items ORDER BY created_at DESC', [], (err, rows) => {
    res.render('inventory_list', { items: rows || [] });
  });
});

app.get('/items/new', requireLogin, (req, res) => res.render('inventory_form', { item: null, action: '/items/new' }));
app.post('/items/new', requireLogin, (req, res) => {
  const { name, sku, quantity, location, notes } = req.body;
  db.run('INSERT INTO items (name, sku, quantity, location, notes) VALUES (?, ?, ?, ?, ?)', [name, sku, Number(quantity)||0, location, notes], () => res.redirect('/items'));
});

app.get('/items/:id/edit', requireLogin, (req, res) => {
  db.get('SELECT * FROM items WHERE id = ?', [req.params.id], (err, row) => {
    if (!row) return res.redirect('/items');
    res.render('inventory_form', { item: row, action: `/items/${row.id}/edit` });
  });
});
app.post('/items/:id/edit', requireLogin, (req, res) => {
  const { name, sku, quantity, location, notes } = req.body;
  db.run('UPDATE items SET name=?, sku=?, quantity=?, location=?, notes=? WHERE id=?', [name, sku, Number(quantity)||0, location, notes, req.params.id], () => res.redirect('/items'));
});

app.post('/items/:id/delete', requireLogin, (req, res) => {
  db.run('DELETE FROM items WHERE id = ?', [req.params.id], () => res.redirect('/items'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
