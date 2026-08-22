PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL DEFAULT 'Dayflow',
  company_logo TEXT NOT NULL DEFAULT '',
  employee_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  role TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT 'Unassigned',
  work_status TEXT NOT NULL DEFAULT 'absent' CHECK (work_status IN ('present', 'on-leave', 'absent')),
  salary TEXT NOT NULL DEFAULT '—',
  join_date TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  check_in TEXT,
  check_out TEXT,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent')),
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('Paid', 'Sick', 'Unpaid')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  remarks TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  comment TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, date);
CREATE INDEX IF NOT EXISTS idx_leave_user_created ON leave_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_status_created ON leave_requests(status, created_at DESC);
