const express = require('express');
const db = require('../db');
const { loadProject, requireOwner } = require('../middleware/auth');

const router = express.Router();
const STATUSES = { todo: 'Por hacer', doing: 'En curso', done: 'Hecha' };

const isMember = (projectId, userId) =>
  !!db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId);

// ---- Listado y creación de proyectos ----
router.get('/', (req, res) => {
  const projects = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS total,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done
    FROM projects p JOIN project_members m ON m.project_id = p.id
    WHERE m.user_id = ? ORDER BY p.created_at DESC, p.id DESC`).all(req.user.id);
  const myTasks = db.prepare(`
    SELECT t.*, p.name AS project_name FROM tasks t
    JOIN projects p ON p.id = t.project_id
    JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
    WHERE t.assignee_id = ? AND t.status != 'done'
    ORDER BY t.due_date IS NULL, t.due_date`).all(req.user.id, req.user.id);
  res.render('projects/index', { projects, myTasks, STATUSES });
});

router.post('/projects', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.redirect('/');
  const description = String(req.body.description || '').trim();
  const { lastInsertRowid } = db.prepare('INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)').run(name, description, req.user.id);
  db.prepare('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)').run(lastInsertRowid, req.user.id);
  res.redirect(`/projects/${lastInsertRowid}`);
});

// ---- Detalle de proyecto (tablero) ----
router.get('/projects/:id', loadProject, (req, res) => {
  const tasks = db.prepare(`
    SELECT t.*, u.name AS assignee_name,
      (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) AS comment_count
    FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.project_id = ? ORDER BY t.due_date IS NULL, t.due_date, t.id`).all(req.project.id);
  const members = db.prepare(`
    SELECT u.id, u.name, u.email FROM project_members m JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ? ORDER BY u.name`).all(req.project.id);
  const done = tasks.filter((t) => t.status === 'done').length;
  res.render('projects/show', {
    tasks, members, STATUSES,
    progress: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    error: req.query.error || null,
  });
});

router.post('/projects/:id/delete', loadProject, requireOwner, (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.project.id);
  res.redirect('/');
});

// ---- Miembros ----
router.post('/projects/:id/members', loadProject, requireOwner, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!u) return res.redirect(`/projects/${req.project.id}?error=${encodeURIComponent('No existe un usuario con ese correo.')}`);
  db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)').run(req.project.id, u.id);
  res.redirect(`/projects/${req.project.id}`);
});

router.post('/projects/:id/members/:userId/remove', loadProject, requireOwner, (req, res) => {
  const userId = Number(req.params.userId);
  if (userId !== req.project.owner_id) {
    db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(req.project.id, userId);
    db.prepare('UPDATE tasks SET assignee_id = NULL WHERE project_id = ? AND assignee_id = ?').run(req.project.id, userId);
  }
  res.redirect(`/projects/${req.project.id}`);
});

// ---- Tareas ----
function parseAssignee(projectId, raw) {
  const id = Number(raw);
  return id && isMember(projectId, id) ? id : null;
}
const parseDate = (raw) => (/^\d{4}-\d{2}-\d{2}$/.test(raw || '') ? raw : null);

router.post('/projects/:id/tasks', loadProject, (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.redirect(`/projects/${req.project.id}`);
  db.prepare(`INSERT INTO tasks (project_id, title, description, assignee_id, due_date, created_by)
              VALUES (?, ?, ?, ?, ?, ?)`).run(
    req.project.id, title, String(req.body.description || '').trim(),
    parseAssignee(req.project.id, req.body.assignee_id), parseDate(req.body.due_date), req.user.id);
  res.redirect(`/projects/${req.project.id}`);
});

function loadTask(req, res, next) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?').get(req.params.taskId, req.project.id);
  if (!task) return res.status(404).render('error', { message: 'Tarea no encontrada.' });
  req.task = task;
  next();
}

router.get('/projects/:id/tasks/:taskId', loadProject, loadTask, (req, res) => {
  const comments = db.prepare(`
    SELECT c.*, u.name AS author FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.task_id = ? ORDER BY c.id`).all(req.task.id);
  const members = db.prepare(`
    SELECT u.id, u.name FROM project_members m JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ? ORDER BY u.name`).all(req.project.id);
  res.render('projects/task', { task: req.task, comments, members, STATUSES });
});

router.post('/projects/:id/tasks/:taskId', loadProject, loadTask, (req, res) => {
  const title = String(req.body.title || '').trim() || req.task.title;
  const status = Object.hasOwn(STATUSES, req.body.status) ? req.body.status : req.task.status;
  db.prepare('UPDATE tasks SET title = ?, description = ?, status = ?, assignee_id = ?, due_date = ? WHERE id = ?').run(
    title, String(req.body.description || '').trim(), status,
    parseAssignee(req.project.id, req.body.assignee_id), parseDate(req.body.due_date), req.task.id);
  res.redirect(`/projects/${req.project.id}/tasks/${req.task.id}`);
});

router.post('/projects/:id/tasks/:taskId/status', loadProject, loadTask, (req, res) => {
  if (Object.hasOwn(STATUSES, req.body.status)) {
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(req.body.status, req.task.id);
  }
  res.redirect(`/projects/${req.project.id}`);
});

router.post('/projects/:id/tasks/:taskId/delete', loadProject, loadTask, (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.task.id);
  res.redirect(`/projects/${req.project.id}`);
});

// ---- Comunicación con el equipo: comentarios ----
router.post('/projects/:id/tasks/:taskId/comments', loadProject, loadTask, (req, res) => {
  const body = String(req.body.body || '').trim();
  if (body) db.prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)').run(req.task.id, req.user.id, body);
  res.redirect(`/projects/${req.project.id}/tasks/${req.task.id}#comments`);
});

module.exports = router;
