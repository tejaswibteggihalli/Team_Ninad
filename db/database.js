const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'dayflow.db'));
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
if (!userColumns.includes('company_name')) db.exec("ALTER TABLE users ADD COLUMN company_name TEXT NOT NULL DEFAULT 'Dayflow'");
if (!userColumns.includes('company_logo')) db.exec("ALTER TABLE users ADD COLUMN company_logo TEXT NOT NULL DEFAULT ''");
if (!userColumns.includes('must_change_password')) db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');

function id(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function seed() {
  if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0) return;

  const users = [
    ['u_admin', 'Dayflow', 'EMP-001', 'Priya Nair', 'admin@dayflow.io', 'admin123', 'admin', '+91 98765 43210', 'HR Wing, HQ Campus', 'Human Resources', '₹14,20,000 / yr', '2021-03-01'],
    ['u_emp1', 'Dayflow', 'EMP-002', 'Asha Rao', 'asha@dayflow.io', 'employee123', 'employee', '+91 90000 11122', '204 Lakeview Rd, Pune', 'Engineering', '₹9,60,000 / yr', '2023-07-14'],
    ['u_emp2', 'Dayflow', 'EMP-003', 'Ravi Menon', 'ravi@dayflow.io', 'employee123', 'employee', '+91 90000 33344', '12 MG Road, Bengaluru', 'Design', '₹8,40,000 / yr', '2022-11-02']
  ];
  const insertUser = db.prepare(`INSERT INTO users
    (id, company_name, company_logo, employee_id, name, email, password_hash, role, phone, address, department, salary, join_date, created_at)
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertAttendance = db.prepare('INSERT INTO attendance (id, user_id, date, check_in, check_out, status) VALUES (?, ?, ?, ?, ?, ?)');
  const insertLeave = db.prepare(`INSERT INTO leave_requests
    (id, user_id, type, start_date, end_date, remarks, status, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const transaction = db.transaction(() => {
    for (const user of users) {
      const [userId, companyName, employeeId, name, email, password, role, phone, address, department, salary, joinDate] = user;
      insertUser.run(userId, companyName, employeeId, name, email, bcrypt.hashSync(password, 12), role, phone, address, department, salary, joinDate, Date.now());
    }
    insertAttendance.run(id('att'), 'u_emp1', today(), '09:12', null, 'present');
    insertLeave.run(id('lv'), 'u_emp1', 'Sick', today(), today(), 'Fever, resting at home.', 'pending', '', Date.now());
    insertLeave.run(id('lv'), 'u_emp2', 'Paid', today(), today(), 'Family function.', 'approved', 'Enjoy!', Date.now() - 90000);
  });
  transaction();
}

seed();
module.exports = db;
