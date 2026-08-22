const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db/database');

const app = express();
const port = Number(process.env.PORT) || 3000;
const DAYFLOW_SESSION_SECRET = process.env.DAYFLOW_SESSION_SECRET || 'dayflow-local-development-secret';

app.use(express.json());
app.use(session({
  secret: DAYFLOW_SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
}));

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, employeeId: user.employee_id, name: user.name, email: user.email, role: user.role, phone: user.phone, address: user.address, department: user.department, salary: user.salary, joinDate: user.join_date };
}
function userById(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
function requireAuth(req, res, next) { if (!req.session.userId) return res.status(401).json({ error: 'Authentication required.' }); next(); }
function requireAdmin(req, res, next) { const user = userById(req.session.userId); if (!user || user.role !== 'admin') return res.status(403).json({ error: 'HR admin access required.' }); next(); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
function id(prefix) { return `${prefix}_${crypto.randomBytes(5).toString('hex')}`; }
function mapAttendance(row) { return row && { id: row.id, userId: row.user_id, date: row.date, checkIn: row.check_in, checkOut: row.check_out, status: row.status }; }
function mapLeave(row) { return { id: row.id, userId: row.user_id, type: row.type, startDate: row.start_date, endDate: row.end_date, remarks: row.remarks, status: row.status, comment: row.comment, createdAt: row.created_at }; }

app.post('/api/auth/sign-in', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Incorrect email or password.' });
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});
app.post('/api/auth/sign-up', (req, res) => {
  const name = String(req.body.name || '').trim();
  const employeeId = String(req.body.employeeId || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = req.body.role === 'admin' ? 'admin' : 'employee';
  if (!name || !employeeId || !email || password.length < 6) return res.status(400).json({ error: 'Please provide all fields and a password of at least 6 characters.' });
  if (db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) OR employee_id = ?').get(email, employeeId)) return res.status(409).json({ error: 'That email or employee ID already exists.' });
  const user = { id: id('u'), joinDate: new Date().toISOString().slice(0, 10) };
  db.prepare(`INSERT INTO users (id, employee_id, name, email, password_hash, role, department, salary, join_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, employeeId, name, email, bcrypt.hashSync(password, 12), role, role === 'admin' ? 'Human Resources' : 'Unassigned', '—', user.joinDate, Date.now());
  req.session.userId = user.id;
  res.status(201).json({ user: publicUser(userById(user.id)) });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(userById(req.session.userId)) }));

app.get('/api/bootstrap', requireAuth, (req, res) => {
  const user = userById(req.session.userId);
  const attendance = user.role === 'admin' ? db.prepare('SELECT * FROM attendance ORDER BY date DESC').all() : db.prepare('SELECT * FROM attendance WHERE user_id = ? ORDER BY date DESC').all(user.id);
  const leave = user.role === 'admin' ? db.prepare('SELECT * FROM leave_requests ORDER BY created_at DESC').all() : db.prepare('SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  const users = user.role === 'admin' ? db.prepare('SELECT * FROM users WHERE role = \'employee\' ORDER BY name').all() : [];
  res.json({ user: publicUser(user), users: users.map(publicUser), attendance: attendance.map(mapAttendance), leave: leave.map(mapLeave) });
});

app.patch('/api/profile', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET phone = ?, address = ? WHERE id = ?').run(String(req.body.phone || '').trim(), String(req.body.address || '').trim(), req.session.userId);
  res.json({ user: publicUser(userById(req.session.userId)) });
});
app.patch('/api/employees/:id', requireAdmin, (req, res) => {
  const employee = userById(req.params.id);
  if (!employee || employee.role !== 'employee') return res.status(404).json({ error: 'Employee not found.' });
  db.prepare('UPDATE users SET department = ?, phone = ?, address = ?, salary = ? WHERE id = ?').run(String(req.body.department || '').trim(), String(req.body.phone || '').trim(), String(req.body.address || '').trim(), String(req.body.salary || '').trim(), employee.id);
  res.json({ user: publicUser(userById(employee.id)) });
});

app.post('/api/attendance/check-in', requireAuth, (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  const time = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const existing = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(req.session.userId, date);
  if (existing && existing.check_in) return res.status(409).json({ error: 'Already checked in today.' });
  if (existing) db.prepare('UPDATE attendance SET check_in = ?, status = \'present\' WHERE id = ?').run(time, existing.id);
  else db.prepare('INSERT INTO attendance (id, user_id, date, check_in, status) VALUES (?, ?, ?, ?, \'present\')').run(id('att'), req.session.userId, date, time);
  res.json({ ok: true });
});
app.post('/api/attendance/check-out', requireAuth, (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  const record = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(req.session.userId, date);
  if (!record || !record.check_in || record.check_out) return res.status(409).json({ error: 'You cannot check out yet.' });
  db.prepare('UPDATE attendance SET check_out = ? WHERE id = ?').run(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), record.id);
  res.json({ ok: true });
});

app.post('/api/leave', requireAuth, (req, res) => {
  const type = ['Paid', 'Sick', 'Unpaid'].includes(req.body.type) ? req.body.type : null;
  const startDate = String(req.body.startDate || '');
  const endDate = String(req.body.endDate || '');
  if (!type || !validDate(startDate) || !validDate(endDate) || endDate < startDate) return res.status(400).json({ error: 'Please provide a valid leave type and date range.' });
  db.prepare(`INSERT INTO leave_requests (id, user_id, type, start_date, end_date, remarks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id('lv'), req.session.userId, type, startDate, endDate, String(req.body.remarks || '').trim(), Date.now());
  res.status(201).json({ ok: true });
});
app.patch('/api/leave/:id', requireAdmin, (req, res) => {
  const decision = ['approved', 'rejected'].includes(req.body.status) ? req.body.status : null;
  if (!decision) return res.status(400).json({ error: 'Invalid leave decision.' });
  const result = db.prepare('UPDATE leave_requests SET status = ?, comment = ? WHERE id = ? AND status = \'pending\'').run(decision, String(req.body.comment || '').trim(), req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Pending leave request not found.' });
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname)));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dayflow.html')));
app.listen(port, () => console.log(`Dayflow running at http://localhost:${port}`));
