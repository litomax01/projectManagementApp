const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

router.get('/register', (req, res) => res.render('register', { error: null, form: {} }));

router.post('/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const fail = (error) => res.status(400).render('register', { error, form: { name, email } });

  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return fail('Nombre y correo válido son obligatorios.');
  if (password.length < 8) return fail('La contraseña debe tener al menos 8 caracteres.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return fail('Ese correo ya está registrado.');

  const hash = bcrypt.hashSync(password, 10);
  const { lastInsertRowid } = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, hash);
  req.session.regenerate(() => {
    req.session.userId = Number(lastInsertRowid);
    res.redirect('/');
  });
});

router.get('/login', (req, res) => res.render('login', { error: null, email: '' }));

router.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !bcrypt.compareSync(String(req.body.password || ''), row.password_hash)) {
    return res.status(401).render('login', { error: 'Correo o contraseña incorrectos.', email });
  }
  req.session.regenerate(() => {
    req.session.userId = row.id;
    res.redirect('/');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
