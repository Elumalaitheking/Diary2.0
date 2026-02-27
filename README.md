# Calm Diary (Mobile-first, Offline-capable)

A personal diary web app for one user with no login/password.

## Features
- Daily diary entries with editable date, title/event, rich text formatting, optional multiple photos.
- Browser spellcheck with mobile-friendly text input behavior and auto-save draft.
- Search by keyword, date range, month, and year.
- Notes (quick/learning/idea) with tags, edit/delete-ready structure, and search.
- Reminders for events, learning goals, and tasks with notification support.
- Photo upload from gallery/camera and automatic compression.
- Mobile-first calming UI, large text, bottom tab navigation.
- Settings for light/dark mode, export (JSON/TXT/PDF print), backup restore, and clear data.
- Local persistence using `localStorage`; works after refresh/restart.
- PWA basics via `manifest.json` + service worker for offline access of app shell.

## Run locally
Use any static server. Example:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173` in your mobile browser or desktop browser mobile emulator.

## Data model
All data is stored in `localStorage` under:
- `calmDiaryData_v1`
- `calmDiaryDraft`

## Notes
- Notifications depend on browser permissions and support.
- PDF export uses browser print dialog from an export window.
