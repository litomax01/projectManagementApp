const crypto = require('crypto');
const db = require('../db');

function loadUser(req, res, next) {
  res.locals.user = null;
  if (req.session.userId) {
    const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.user = user;
    } else {
      delete req.session.userId;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

// Protección CSRF: token por sesión, validado en todas las peticiones POST.
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  if (req.method === 'POST') {
    const sent = Buffer.from(String(req.body._csrf || ''));
    const real = Buffer.from(req.session.csrf);
    if (sent.length !== real.length || !crypto.timingSafeEqual(sent, real)) {
      return res.status(403).render('error', { message: 'Token CSRF inválido. Recarga la página e inténtalo de nuevo.' });
    }
  }
  next();
}

// Autorización: solo los miembros del proyecto pueden acceder a él.
function loadProject(req, res, next) {
  const project = db.prepare(`
    SELECT p.* FROM projects p
    JOIN project_members m ON m.project_id = p.id
    WHERE p.id = ? AND m.user_id = ?`).get(req.params.id, req.user.id);
  if (!project) return res.status(404).render('error', { message: 'Proyecto no encontrado.' });
  project.isOwner = project.owner_id === req.user.id;
  req.project = project;
  res.locals.project = project;
  next();
}

function requireOwner(req, res, next) {
  if (!req.project.isOwner) return res.status(403).render('error', { message: 'Solo el propietario puede hacer esto.' });
  next();
}

module.exports = { loadUser, requireAuth, csrf, loadProject, requireOwner };
