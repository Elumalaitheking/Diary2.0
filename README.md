# My Calm Diary (Mobile-First)

A private, smartphone-friendly personal diary web app with secure login, diary entries, photos, notes, reminders, search, and backup tools.

## Tech Stack
- **Frontend:** Vanilla HTML/CSS/JS (mobile-first responsive UI)
- **Backend:** Node.js `http` server (no external runtime dependencies)
- **Storage:** Persistent local JSON database file (`diary-data.json`)
- **Auth:** Password hash using `crypto.pbkdf2Sync` + HTTP-only session cookie

## Features Implemented
1. **Authentication**
   - First-time registration (single private account)
   - Secure password login/logout
   - Change password from settings
2. **Diary Entries**
   - Date, title, rich text editor, optional multiple photos
   - Browser spellcheck + autocorrect-enabled editor
   - Auto-save draft every 10 seconds + manual draft save
3. **Search & Filters**
   - Keyword, year, month, day, and date-range filtering
4. **Notes**
   - Categorized notes: personal / learning / ideas
   - Searchable note list
5. **Reminders**
   - Event / learning / task reminders
   - Browser notification support (if permission granted)
6. **Photo Handling**
   - Phone camera/gallery upload supported
   - Client-side image compression before saving
7. **UI/UX**
   - Mobile-first, calm diary style with bottom navigation
   - Light/Dark theme toggle
8. **Data Utilities**
   - Export data as JSON
   - Restore data from JSON backup
9. **Persistence**
   - All entries, notes, reminders, and settings persist in `diary-data.json`

## Database Schema
- The running app persists data in JSON for easy local setup.
- A full relational SQL schema (users, diary_entries, notes, reminders, user_settings) is embedded in `server.js` as `SQL_SCHEMA` for future SQLite/cloud upgrade.

## Setup & Run
```bash
npm install
npm start
```
Open: `http://localhost:3000`

## Mobile Usage Tips
- Use phone browser "Add to Home Screen" for app-like usage.
- Photo upload input supports camera capture on mobile.
- Bottom navigation is optimized for thumb reach.

## Security Notes
- Passwords are hashed and salted via PBKDF2.
- Session cookies are HTTP-only.
- Basic secure headers are set server-side.
- For production, run behind HTTPS and use a persistent session store.
