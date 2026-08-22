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

function publicUser(user, includeSensitive = false) {
  if (!user) return null;
  const result = { id: user.id, companyName: user.company_name, companyLogo: user.company_logo, employeeId: user.employee_id, name: user.name, email: user.email, role: user.role, phone: user.phone, address: user.address, department: user.department, joinDate: user.join_date, workStatus: user.work_status, mustChangePassword: Boolean(user.must_change_password) };
  if (includeSensitive) result.salary = user.salary;
  return result;
}
function userById(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
function requireAuth(req, res, next) { if (!req.session.userId) return res.status(401).json({ error: 'Authentication required.' }); next(); }
function requireAdmin(req, res, next) { const user = userById(req.session.userId); if (!user || user.role !== 'admin') return res.status(403).json({ error: 'HR admin access required.' }); next(); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
function id(prefix) { return `${prefix}_${crypto.randomBytes(5).toString('hex')}`; }
function temporaryPassword() { return crypto.randomBytes(6).toString('base64url'); }
function employeeIdFor(companyName, name, year) {
  const companyCode = companyName.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase().padEnd(2, 'X');
  const nameParts = name.trim().split(/\s+/);
  const firstNameCode = (nameParts[0] || '').slice(0, 2).toUpperCase().padEnd(2, 'X');
  const lastNameCode = (nameParts.length > 1 ? nameParts[nameParts.length - 1] : '').slice(0, 2).toUpperCase().padEnd(2, 'X');
  const initials = firstNameCode + lastNameCode;
  const prefix = `${companyCode}${initials}${year}`;
  const count = db.prepare('SELECT COUNT(*) AS count FROM users WHERE employee_id LIKE ?').get(`${prefix}%`).count + 1;
  return `${prefix}${String(count).padStart(4, '0')}`;
}
function mapAttendance(row) { return row && { id: row.id, userId: row.user_id, date: row.date, checkIn: row.check_in, checkOut: row.check_out, status: row.status }; }
function mapLeave(row) { return { id: row.id, userId: row.user_id, type: row.type, startDate: row.start_date, endDate: row.end_date, remarks: row.remarks, status: row.status, comment: row.comment, createdAt: row.created_at }; }

app.post('/api/auth/sign-in', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) OR upper(employee_id) = upper(?)').get(email, email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Incorrect email or password.' });
  req.session.userId = user.id;
  res.json({ user: publicUser(user, user.role === 'admin') });
});
app.post('/api/auth/sign-up', (req, res) => {
  const companyName = String(req.body.companyName || '').trim();
  const companyLogo = String(req.body.companyLogo || '');
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  if (!companyName || !name || !email || password.length < 6) return res.status(400).json({ error: 'Company, name, email, and a password of at least 6 characters are required.' });
  if (companyLogo && !/^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=]+$/i.test(companyLogo)) return res.status(400).json({ error: 'Please upload a valid PNG, JPG, or WebP logo.' });
  if (companyLogo.length > 700000) return res.status(400).json({ error: 'Logo must be smaller than 500 KB.' });
  if (db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email)) return res.status(409).json({ error: 'That email already exists.' });
  const joinDate = new Date().toISOString().slice(0, 10);
  const userId = id('u');
  const employeeId = employeeIdFor(companyName, name, new Date().getFullYear());
  db.prepare(`INSERT INTO users (id, company_name, company_logo, employee_id, name, email, password_hash, must_change_password, role, phone, department, salary, join_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'admin', ?, 'Human Resources', '—', ?, ?)`).run(userId, companyName, companyLogo, employeeId, name, email, bcrypt.hashSync(password, 12), phone, joinDate, Date.now());
  req.session.userId = userId;
  res.status(201).json({ user: publicUser(userById(userId), true) });
});
app.post('/api/employees', requireAdmin, (req, res) => {
  const admin = userById(req.session.userId);
  const companyName = admin.company_name;
  const companyLogo = admin.company_logo || '';
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  if (!companyName || !name || !email) return res.status(400).json({ error: 'Employee name and email are required.' });
  if (db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email)) return res.status(409).json({ error: 'That email already exists.' });
  const joinDate = new Date().toISOString().slice(0, 10);
  const employeeId = employeeIdFor(companyName, name, new Date().getFullYear());
  const password = temporaryPassword();
  const userId = id('u');
  db.prepare(`INSERT INTO users (id, company_name, company_logo, employee_id, name, email, password_hash, must_change_password, role, phone, department, salary, join_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'employee', ?, 'Unassigned', '—', ?, ?)`).run(userId, companyName, companyLogo, employeeId, name, email, bcrypt.hashSync(password, 12), phone, joinDate, Date.now());
  res.status(201).json({ user: publicUser(userById(userId), true), temporaryPassword: password });
});
app.patch('/api/auth/password', requireAuth, (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(bcrypt.hashSync(password, 12), req.session.userId);
  const updatedUser = userById(req.session.userId);
  res.json({ user: publicUser(updatedUser, updatedUser.role === 'admin') });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(userById(req.session.userId)) }));

app.get('/api/bootstrap', requireAuth, (req, res) => {
  const user = userById(req.session.userId);
  const attendance = user.role === 'admin' ? db.prepare('SELECT * FROM attendance ORDER BY date DESC').all() : db.prepare('SELECT * FROM attendance WHERE user_id = ? ORDER BY date DESC').all(user.id);
  const leave = user.role === 'admin' ? db.prepare('SELECT * FROM leave_requests ORDER BY created_at DESC').all() : db.prepare('SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  const users = db.prepare('SELECT * FROM users WHERE role = \'employee\' ORDER BY name').all();
  res.json({ user: publicUser(user, user.role === 'admin'), users: users.map(employee => publicUser(employee, user.role === 'admin')), attendance: attendance.map(mapAttendance), leave: leave.map(mapLeave) });
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
app.patch('/api/employees/:id/status', requireAdmin, (req, res) => {
  const status = ['present', 'on-leave', 'absent'].includes(req.body.status) ? req.body.status : null;
  const employee = userById(req.params.id);
  if (!employee || employee.role !== 'employee') return res.status(404).json({ error: 'Employee not found.' });
  if (!status) return res.status(400).json({ error: 'Invalid employee status.' });
  db.prepare('UPDATE users SET work_status = ? WHERE id = ?').run(status, employee.id);
  res.json({ user: publicUser(userById(employee.id)) });
});

app.post('/api/attendance/check-in', requireAuth, (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  const time = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const existing = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(req.session.userId, date);
  if (existing && existing.check_in) return res.status(409).json({ error: 'Already checked in today.' });
  if (existing) db.prepare('UPDATE attendance SET check_in = ?, status = \'present\' WHERE id = ?').run(time, existing.id);
  else db.prepare('INSERT INTO attendance (id, user_id, date, check_in, status) VALUES (?, ?, ?, ?, \'present\')').run(id('att'), req.session.userId, date, time);
  db.prepare("UPDATE users SET work_status = 'present' WHERE id = ?").run(req.session.userId);
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
app.delete('/api/leave/:id', requireAuth, (req, res) => {
  const result = db.prepare(`DELETE FROM leave_requests
    WHERE id = ? AND user_id = ? AND status = 'pending'`).run(req.params.id, req.session.userId);
  if (!result.changes) return res.status(404).json({ error: 'Only your pending leave requests can be removed.' });
  res.json({ ok: true });
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
