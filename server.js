const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = path.join(__dirname, 'diary-data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const SQL_SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE diary_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  entry_date TEXT NOT NULL,
  title TEXT NOT NULL,
  content_html TEXT NOT NULL,
  content_text TEXT NOT NULL,
  images_json TEXT NOT NULL DEFAULT '[]',
  draft INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('personal', 'learning', 'ideas')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  reminder_type TEXT NOT NULL CHECK(reminder_type IN ('event', 'learning', 'task')),
  due_at TEXT NOT NULL,
  notes TEXT NOT NULL,
  is_done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE user_settings (
  user_id INTEGER PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'light' CHECK(theme IN ('light', 'dark')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

function baseData() {
  return {
    meta: { schemaVersion: 2, createdAt: new Date().toISOString() },
    schemaSql: SQL_SCHEMA,
    users: [],
    entries: [],
    notes: [],
    reminders: [],
    settings: []
  };
}

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const initial = baseData();
      fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { ...baseData(), ...parsed };
  } catch {
    return baseData();
  }
}

let data = readData();
const sessions = new Map();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function setSecurityHeaders(res) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'");
}

function parseCookies(req) {
  return (req.headers.cookie || '').split(';').reduce((acc, item) => {
    const [k, ...rest] = item.trim().split('=');
    if (!k) return acc;
    acc[k] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function currentUserId(req) {
  const sid = parseCookies(req).sid;
  if (!sid || !sessions.has(sid)) return null;
  const session = sessions.get(sid);
  if (Date.now() > session.expiresAt) {
    sessions.delete(sid);
    return null;
  }
  return session.userId;
}

function requireAuth(req, res) {
  const userId = currentUserId(req);
  if (!userId) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return userId;
}

function sanitizeText(value, max = 20000) {
  return String(value || '').replace(/\0/g, '').slice(0, max).trim();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 20 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 150000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  return hashPassword(password, user.password_salt).hash === user.password_hash;
}

function getNextId(items) {
  return items.length ? Math.max(...items.map((i) => i.id)) + 1 : 1;
}

function serveFile(res, filepath) {
  const ext = path.extname(filepath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
  };
  fs.readFile(filepath, (err, content) => {
    if (err) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function toDiaryText(entry) {
  return `${entry.entry_date}\n${entry.title}\n${'-'.repeat(20)}\n${entry.content_text}\n\n`;
}

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === '/api/auth/status' && req.method === 'GET') {
      return sendJson(res, 200, { authenticated: !!currentUserId(req), hasUser: data.users.length > 0 });
    }

    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await readBody(req);
      if (data.users.length > 0) return sendJson(res, 400, { error: 'Account already exists.' });
      const password = sanitizeText(body.password, 200);
      if (password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
      const { salt, hash } = hashPassword(password);
      const user = { id: 1, password_hash: hash, password_salt: salt, created_at: new Date().toISOString() };
      data.users.push(user);
      data.settings.push({ user_id: 1, theme: 'light', updated_at: new Date().toISOString() });
      saveData();
      const sid = crypto.randomUUID();
      sessions.set(sid, { userId: 1, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
      res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      const user = data.users[0];
      if (!user) return sendJson(res, 400, { error: 'No account found.' });
      if (!verifyPassword(String(body.password || ''), user)) return sendJson(res, 401, { error: 'Invalid password.' });
      const sid = crypto.randomUUID();
      sessions.set(sid, { userId: 1, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
      res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const sid = parseCookies(req).sid;
      if (sid) sessions.delete(sid);
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/auth/change-password' && req.method === 'POST') {
      const userId = requireAuth(req, res);
      if (!userId) return;
      const body = await readBody(req);
      const user = data.users.find((u) => u.id === userId);
      if (!verifyPassword(String(body.currentPassword || ''), user)) return sendJson(res, 401, { error: 'Current password is incorrect.' });
      const newPassword = sanitizeText(body.newPassword, 200);
      if (newPassword.length < 8) return sendJson(res, 400, { error: 'New password must be at least 8 characters.' });
      const { salt, hash } = hashPassword(newPassword);
      user.password_salt = salt;
      user.password_hash = hash;
      saveData();
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname.startsWith('/api/')) {
      const userId = requireAuth(req, res);
      if (!userId) return;

      if (url.pathname === '/api/entries' && req.method === 'GET') {
        const keyword = sanitizeText(url.searchParams.get('keyword'), 150).toLowerCase();
        const year = sanitizeText(url.searchParams.get('year'), 4);
        const month = sanitizeText(url.searchParams.get('month'), 2).padStart(2, '0');
        const day = sanitizeText(url.searchParams.get('day'), 2).padStart(2, '0');
        const from = sanitizeText(url.searchParams.get('from'), 10);
        const to = sanitizeText(url.searchParams.get('to'), 10);

        let entries = data.entries.filter((e) => e.user_id === userId);
        if (keyword) entries = entries.filter((e) => `${e.title} ${e.content_text}`.toLowerCase().includes(keyword));
        if (year) entries = entries.filter((e) => e.entry_date.slice(0, 4) === year);
        if (month) entries = entries.filter((e) => e.entry_date.slice(5, 7) === month);
        if (day) entries = entries.filter((e) => e.entry_date.slice(8, 10) === day);
        if (from) entries = entries.filter((e) => e.entry_date >= from);
        if (to) entries = entries.filter((e) => e.entry_date <= to);
        entries.sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.updated_at.localeCompare(a.updated_at));
        return sendJson(res, 200, entries);
      }

      if (url.pathname === '/api/entries' && req.method === 'POST') {
        const body = await readBody(req);
        const entryDate = sanitizeText(body.entryDate, 10);
        const title = sanitizeText(body.title, 140);
        const contentHtml = sanitizeText(body.contentHtml, 200000);
        const contentText = sanitizeText(body.contentText, 50000);
        const images = Array.isArray(body.images) ? body.images.slice(0, 8) : [];
        const draft = body.draft ? 1 : 0;

        if (!entryDate || !title || !contentHtml) return sendJson(res, 400, { error: 'Date, title and content are required.' });

        if (body.id) {
          const entry = data.entries.find((e) => e.id === Number(body.id) && e.user_id === userId);
          if (!entry) return sendJson(res, 404, { error: 'Entry not found.' });
          Object.assign(entry, { entry_date: entryDate, title, content_html: contentHtml, content_text: contentText, images, draft, updated_at: new Date().toISOString() });
          saveData();
          return sendJson(res, 200, { ok: true, id: entry.id });
        }

        const newEntry = {
          id: getNextId(data.entries),
          user_id: userId,
          entry_date: entryDate,
          title,
          content_html: contentHtml,
          content_text: contentText,
          images,
          draft,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        data.entries.push(newEntry);
        saveData();
        return sendJson(res, 200, { ok: true, id: newEntry.id });
      }

      if (url.pathname.startsWith('/api/entries/') && req.method === 'DELETE') {
        const id = Number(url.pathname.split('/').pop());
        const before = data.entries.length;
        data.entries = data.entries.filter((e) => !(e.user_id === userId && e.id === id));
        if (data.entries.length === before) return sendJson(res, 404, { error: 'Entry not found.' });
        saveData();
        return sendJson(res, 200, { ok: true });
      }

      if (url.pathname === '/api/notes' && req.method === 'GET') {
        const keyword = sanitizeText(url.searchParams.get('keyword'), 120).toLowerCase();
        const category = sanitizeText(url.searchParams.get('category'), 20);
        let notes = data.notes.filter((n) => n.user_id === userId);
        if (keyword) notes = notes.filter((n) => `${n.title} ${n.content}`.toLowerCase().includes(keyword));
        if (category) notes = notes.filter((n) => n.category === category);
        notes.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return sendJson(res, 200, notes);
      }

      if (url.pathname === '/api/notes' && req.method === 'POST') {
        const body = await readBody(req);
        const title = sanitizeText(body.title, 140);
        const content = sanitizeText(body.content, 8000);
        const category = ['personal', 'learning', 'ideas'].includes(body.category) ? body.category : 'personal';
        if (!title || !content) return sendJson(res, 400, { error: 'Title and content are required.' });

        if (body.id) {
          const note = data.notes.find((n) => n.id === Number(body.id) && n.user_id === userId);
          if (!note) return sendJson(res, 404, { error: 'Note not found.' });
          Object.assign(note, { title, content, category, updated_at: new Date().toISOString() });
          saveData();
          return sendJson(res, 200, { ok: true, id: note.id });
        }

        const note = { id: getNextId(data.notes), user_id: userId, title, content, category, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        data.notes.push(note);
        saveData();
        return sendJson(res, 200, { ok: true, id: note.id });
      }

      if (url.pathname.startsWith('/api/notes/') && req.method === 'DELETE') {
        const id = Number(url.pathname.split('/').pop());
        const before = data.notes.length;
        data.notes = data.notes.filter((n) => !(n.user_id === userId && n.id === id));
        if (data.notes.length === before) return sendJson(res, 404, { error: 'Note not found.' });
        saveData();
        return sendJson(res, 200, { ok: true });
      }

      if (url.pathname === '/api/reminders' && req.method === 'GET') {
        const reminders = data.reminders.filter((r) => r.user_id === userId).sort((a, b) => a.due_at.localeCompare(b.due_at));
        return sendJson(res, 200, reminders);
      }

      if (url.pathname === '/api/reminders' && req.method === 'POST') {
        const body = await readBody(req);
        const title = sanitizeText(body.title, 140);
        const reminderType = ['event', 'learning', 'task'].includes(body.reminderType) ? body.reminderType : null;
        const dueAt = sanitizeText(body.dueAt, 40);
        const notes = sanitizeText(body.notes, 3000);
        const isDone = body.isDone ? 1 : 0;
        if (!title || !reminderType || !dueAt) return sendJson(res, 400, { error: 'Title, type, and due date are required.' });

        if (body.id) {
          const reminder = data.reminders.find((r) => r.id === Number(body.id) && r.user_id === userId);
          if (!reminder) return sendJson(res, 404, { error: 'Reminder not found.' });
          Object.assign(reminder, { title, reminder_type: reminderType, due_at: dueAt, notes, is_done: isDone, updated_at: new Date().toISOString() });
          saveData();
          return sendJson(res, 200, { ok: true, id: reminder.id });
        }

        const reminder = {
          id: getNextId(data.reminders),
          user_id: userId,
          title,
          reminder_type: reminderType,
          due_at: dueAt,
          notes,
          is_done: isDone,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        data.reminders.push(reminder);
        saveData();
        return sendJson(res, 200, { ok: true, id: reminder.id });
      }

      if (url.pathname.startsWith('/api/reminders/') && req.method === 'DELETE') {
        const id = Number(url.pathname.split('/').pop());
        const before = data.reminders.length;
        data.reminders = data.reminders.filter((r) => !(r.user_id === userId && r.id === id));
        if (data.reminders.length === before) return sendJson(res, 404, { error: 'Reminder not found.' });
        saveData();
        return sendJson(res, 200, { ok: true });
      }

      if (url.pathname === '/api/settings' && req.method === 'GET') {
        return sendJson(res, 200, data.settings.find((s) => s.user_id === userId) || { theme: 'light' });
      }

      if (url.pathname === '/api/settings/theme' && req.method === 'POST') {
        const body = await readBody(req);
        if (!['light', 'dark'].includes(body.theme)) return sendJson(res, 400, { error: 'Invalid theme.' });
        const settings = data.settings.find((s) => s.user_id === userId);
        if (!settings) {
          data.settings.push({ user_id: userId, theme: body.theme, updated_at: new Date().toISOString() });
        } else {
          settings.theme = body.theme;
          settings.updated_at = new Date().toISOString();
        }
        saveData();
        return sendJson(res, 200, { ok: true });
      }

      if (url.pathname === '/api/export' && req.method === 'GET') {
        return sendJson(res, 200, {
          exportedAt: new Date().toISOString(),
          entries: data.entries.filter((e) => e.user_id === userId),
          notes: data.notes.filter((n) => n.user_id === userId),
          reminders: data.reminders.filter((r) => r.user_id === userId)
        });
      }

      if (url.pathname === '/api/export.txt' && req.method === 'GET') {
        const text = data.entries.filter((e) => e.user_id === userId).sort((a, b) => b.entry_date.localeCompare(a.entry_date)).map(toDiaryText).join('\n');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(text || 'No diary entries yet.');
      }

      if (url.pathname === '/api/restore' && req.method === 'POST') {
        const body = await readBody(req);
        data.entries = data.entries.filter((e) => e.user_id !== userId);
        data.notes = data.notes.filter((n) => n.user_id !== userId);
        data.reminders = data.reminders.filter((r) => r.user_id !== userId);

        (body.entries || []).forEach((entry) => {
          data.entries.push({
            id: getNextId(data.entries),
            user_id: userId,
            entry_date: sanitizeText(entry.entry_date, 10),
            title: sanitizeText(entry.title, 140),
            content_html: sanitizeText(entry.content_html || `<p>${sanitizeText(entry.content_text, 50000)}</p>`, 200000),
            content_text: sanitizeText(entry.content_text, 50000),
            images: Array.isArray(entry.images) ? entry.images.slice(0, 8) : [],
            draft: entry.draft ? 1 : 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        });

        (body.notes || []).forEach((note) => {
          data.notes.push({
            id: getNextId(data.notes),
            user_id: userId,
            title: sanitizeText(note.title, 140),
            content: sanitizeText(note.content, 8000),
            category: ['personal', 'learning', 'ideas'].includes(note.category) ? note.category : 'personal',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        });

        (body.reminders || []).forEach((reminder) => {
          data.reminders.push({
            id: getNextId(data.reminders),
            user_id: userId,
            title: sanitizeText(reminder.title, 140),
            reminder_type: ['event', 'learning', 'task'].includes(reminder.reminder_type) ? reminder.reminder_type : 'task',
            due_at: sanitizeText(reminder.due_at, 40),
            notes: sanitizeText(reminder.notes, 3000),
            is_done: reminder.is_done ? 1 : 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        });

        saveData();
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { error: 'Unknown API endpoint' });
    }

    if (req.method === 'GET') {
      if (url.pathname === '/' || url.pathname === '/index.html') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
      const candidate = path.normalize(path.join(PUBLIC_DIR, url.pathname));
      if (candidate.startsWith(PUBLIC_DIR) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return serveFile(res, candidate);
      }
      return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Internal error' });
  }
});

server.listen(PORT, () => {
  console.log(`My Calm Diary running on http://localhost:${PORT}`);
});
