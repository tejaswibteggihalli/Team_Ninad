# Dayflow

Dayflow is a hackathon prototype for a human resource management system. The interface follows the supplied dark Excalidraw wireframes and demonstrates sign in, employee records, profiles, attendance, leave approvals, and payroll visibility.

## Run locally

Dayflow now runs through a small Node.js server backed by SQLite. Install Node.js 18 or newer, then from this folder run:

```bash
npm install
npm start
```

Open http://localhost:3000. The SQLite database is created at `data/dayflow.db` and seeded automatically on the first run. Do not open the HTML file directly or use Live Server, because the API and session cookie are provided by the Node server.

## Demo flow

1. Open http://localhost:3000 and sign in with a demo account.
2. Browse the Employees view and open an employee profile.
3. Open Attendance to review daily records..
4. Open Leave and approve or reject a pending request.
6. Use Sign Up to create a SQL-backed employee login.

### Demo accounts

- Admin: `admin@dayflow.io` / `admin123`
- Employee: `asha@dayflow.io` / `employee123`

Passwords are stored as bcrypt hashes. The application uses server-side sessions and role checks for API access. Set `DAYFLOW_SESSION_SECRET` before deployment; the built-in secret is intended only for local development.
