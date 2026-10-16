const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const { loadUser, requireAuth, csrf } = require('./middleware/auth');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
if (isProd) app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 24 * 7 },
}));
app.use(loadUser);
app.use(csrf);

app.use(require('./routes/auth'));
app.use(requireAuth, require('./routes/projects'));

app.use((req, res) => res.status(404).render('error', { message: 'Página no encontrada.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: 'Error interno del servidor.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor en http://localhost:${port}`));
