# My Calm Diary (Mobile-First Private Diary)

A complete private diary web application designed for phone browsers.
It supports secure login, rich diary entries with photos, notes, reminders, search/filtering, theme control, and backup/restore.

## Highlights
- Mobile-first UI with bottom navigation (Home, Add, Search, Notes, Settings)
- Private single-user authentication with salted PBKDF2 password hashing
- Diary entries with date/title/rich text, optional multiple photos, draft auto-save
- Search by keyword, year, month, day, and advanced date range
- Notes section with categories (personal, learning, ideas)
- Reminder system with browser notification support
- Light/dark themes
- JSON backup restore + plain text diary export
- Persistent local storage in `diary-data.json`
- Embedded SQL schema in `server.js` (`SQL_SCHEMA`) for future SQLite/cloud migration

## Tech Stack
- Frontend: Vanilla HTML/CSS/JS
- Backend: Node.js built-in `http` server
- Data persistence: JSON file on disk (`diary-data.json`)

## Run Locally
```bash
npm install
npm start
```
Open http://localhost:3000

## Security Notes
- Passwords are hashed using `crypto.pbkdf2Sync` with per-user salt.
- Sessions are HTTP-only cookies.
- Security headers (CSP, frame protection, referrer policy, etc.) are added server-side.
- For production: run behind HTTPS and use a durable distributed session store.

## API Overview
- Auth: `/api/auth/status`, `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/change-password`
- Entries: `GET/POST /api/entries`, `DELETE /api/entries/:id`
- Notes: `GET/POST /api/notes`, `DELETE /api/notes/:id`
- Reminders: `GET/POST /api/reminders`, `DELETE /api/reminders/:id`
- Settings: `GET /api/settings`, `POST /api/settings/theme`
- Backup: `GET /api/export`, `POST /api/restore`, `GET /api/export.txt`

## Data Model
`diary-data.json` stores:
- users
- entries
- notes
- reminders
- settings
- `schemaSql` (future migration SQL)
