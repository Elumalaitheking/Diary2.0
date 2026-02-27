const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'diary-data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const SQL_SCHEMA = `
-- Optional relational schema for future SQLite migration
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
  category TEXT NOT NULL
);
CREATE TABLE reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  reminder_type TEXT NOT NULL,
  due_at TEXT NOT NULL,
  notes TEXT NOT NULL,
  is_done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE user_settings (
  user_id INTEGER PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'light'
);
`;

function createDefaultDb() {
  return {
    meta: { schemaVersion: 1 },
    users: [],
    entries: [],
    notes: [],
    reminders: [],
    settings: [],
    schemaSql: SQL_SCHEMA
  };
}

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    const db = createDefaultDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    return db;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = readDb();
const sessions = new Map();

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc, pair) => {
    const [k, v] = pair.trim().split('=');
    if (k) acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {});
}

function getSessionUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return session.userId;
}

function requireAuth(req, res) {
  const userId = getSessionUser(req);
  if (!userId) {
    json(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return userId;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 25 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function matchesPassword(password, user) {
  return hashPassword(password, user.password_salt).hash === user.password_hash;
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json' };
  const contentType = types[ext] || 'text/plain';
  fs.readFile(filePath, (err, data) => {
    if (err) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': `${contentType}; charset=utf-8`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

function nextId(rows) {
  return rows.length ? Math.max(...rows.map((r) => r.id)) + 1 : 1;
}

function normalize(str) {
  return String(str || '').toLowerCase();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Security headers
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    if (req.method === 'GET' && url.pathname === '/api/auth/status') {
      return json(res, 200, { authenticated: !!getSessionUser(req), hasUser: db.users.length > 0 });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      const body = await parseBody(req);
      if (db.users.length > 0) return json(res, 400, { error: 'User already exists.' });
      if (!body.password || body.password.length < 8) return json(res, 400, { error: 'Password must be at least 8 characters.' });
      const pw = hashPassword(body.password);
      const user = { id: 1, password_hash: pw.hash, password_salt: pw.salt, created_at: new Date().toISOString() };
      db.users.push(user);
      db.settings.push({ user_id: user.id, theme: 'light', updated_at: new Date().toISOString() });
      writeDb(db);
      const sid = crypto.randomUUID();
      sessions.set(sid, { userId: user.id, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 });
      res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await parseBody(req);
      const user = db.users[0];
      if (!user) return json(res, 400, { error: 'No account found. Register first.' });
      if (!matchesPassword(body.password || '', user)) return json(res, 401, { error: 'Invalid password.' });
      const sid = crypto.randomUUID();
      sessions.set(sid, { userId: user.id, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 });
      res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      const sid = parseCookies(req).sid;
      if (sid) sessions.delete(sid);
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/change-password') {
      const userId = requireAuth(req, res);
      if (!userId) return;
      const body = await parseBody(req);
      const user = db.users.find((u) => u.id === userId);
      if (!user || !matchesPassword(body.currentPassword || '', user)) return json(res, 401, { error: 'Current password is incorrect.' });
      if (!body.newPassword || body.newPassword.length < 8) return json(res, 400, { error: 'New password must be at least 8 chars.' });
      const pw = hashPassword(body.newPassword);
      user.password_hash = pw.hash;
      user.password_salt = pw.salt;
      writeDb(db);
      return json(res, 200, { ok: true });
    }

    if (url.pathname.startsWith('/api/')) {
      const userId = requireAuth(req, res);
      if (!userId) return;

      if (req.method === 'GET' && url.pathname === '/api/entries') {
        let list = db.entries.filter((e) => e.user_id === userId);
        const q = url.searchParams;
        const keyword = normalize(q.get('keyword'));
        const year = q.get('year');
        const month = q.get('month');
        const day = q.get('day');
        const from = q.get('from');
        const to = q.get('to');

        if (keyword) list = list.filter((e) => normalize(e.title).includes(keyword) || normalize(e.content_text).includes(keyword));
        if (year) list = list.filter((e) => String(new Date(e.entry_date).getFullYear()) === year);
        if (month) list = list.filter((e) => String(new Date(e.entry_date).getMonth() + 1).padStart(2, '0') === String(month).padStart(2, '0'));
        if (day) list = list.filter((e) => String(new Date(e.entry_date).getDate()).padStart(2, '0') === String(day).padStart(2, '0'));
        if (from) list = list.filter((e) => e.entry_date >= from);
        if (to) list = list.filter((e) => e.entry_date <= to);

        list.sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date));
        return json(res, 200, list);
      }

      if (req.method === 'POST' && url.pathname === '/api/entries') {
        const body = await parseBody(req);
        if (!body.entryDate || !body.title || !body.contentHtml) return json(res, 400, { error: 'Date, title and content are required.' });
        if (body.id) {
          const item = db.entries.find((e) => e.id === Number(body.id) && e.user_id === userId);
          if (!item) return json(res, 404, { error: 'Entry not found.' });
          Object.assign(item, {
            entry_date: body.entryDate,
            title: body.title,
            content_html: body.contentHtml,
            content_text: body.contentText || '',
            images: Array.isArray(body.images) ? body.images : [],
            draft: body.draft ? 1 : 0,
            updated_at: new Date().toISOString()
          });
          writeDb(db);
          return json(res, 200, { ok: true, id: item.id });
        }
        const id = nextId(db.entries);
        db.entries.push({
          id,
          user_id: userId,
          entry_date: body.entryDate,
          title: body.title,
          content_html: body.contentHtml,
          content_text: body.contentText || '',
          images: Array.isArray(body.images) ? body.images : [],
          draft: body.draft ? 1 : 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        writeDb(db);
        return json(res, 200, { ok: true, id });
      }

      if (req.method === 'GET' && url.pathname === '/api/notes') {
        let list = db.notes.filter((n) => n.user_id === userId);
        const keyword = normalize(url.searchParams.get('keyword'));
        const category = url.searchParams.get('category');
        if (keyword) list = list.filter((n) => normalize(n.title).includes(keyword) || normalize(n.content).includes(keyword));
        if (category) list = list.filter((n) => n.category === category);
        list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        return json(res, 200, list);
      }

      if (req.method === 'POST' && url.pathname === '/api/notes') {
        const body = await parseBody(req);
        if (!body.title || !body.content) return json(res, 400, { error: 'Title and content required.' });
        const category = ['personal', 'learning', 'ideas'].includes(body.category) ? body.category : 'personal';
        if (body.id) {
          const n = db.notes.find((x) => x.id === Number(body.id) && x.user_id === userId);
          if (!n) return json(res, 404, { error: 'Note not found.' });
          Object.assign(n, { title: body.title, content: body.content, category, updated_at: new Date().toISOString() });
          writeDb(db);
          return json(res, 200, { ok: true, id: n.id });
        }
        const id = nextId(db.notes);
        db.notes.push({ id, user_id: userId, title: body.title, content: body.content, category, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        writeDb(db);
        return json(res, 200, { ok: true, id });
      }

      if (req.method === 'GET' && url.pathname === '/api/reminders') {
        const list = db.reminders.filter((r) => r.user_id === userId).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
        return json(res, 200, list);
      }

      if (req.method === 'POST' && url.pathname === '/api/reminders') {
        const body = await parseBody(req);
        const type = ['event', 'learning', 'task'].includes(body.reminderType) ? body.reminderType : null;
        if (!body.title || !type || !body.dueAt) return json(res, 400, { error: 'Title, type and date required.' });
        if (body.id) {
          const r = db.reminders.find((x) => x.id === Number(body.id) && x.user_id === userId);
          if (!r) return json(res, 404, { error: 'Reminder not found.' });
          Object.assign(r, { title: body.title, reminder_type: type, due_at: body.dueAt, notes: body.notes || '', is_done: body.isDone ? 1 : 0 });
          writeDb(db);
          return json(res, 200, { ok: true, id: r.id });
        }
        const id = nextId(db.reminders);
        db.reminders.push({ id, user_id: userId, title: body.title, reminder_type: type, due_at: body.dueAt, notes: body.notes || '', is_done: 0, created_at: new Date().toISOString() });
        writeDb(db);
        return json(res, 200, { ok: true, id });
      }

      if (req.method === 'GET' && url.pathname === '/api/settings') {
        return json(res, 200, db.settings.find((s) => s.user_id === userId) || { theme: 'light' });
      }

      if (req.method === 'POST' && url.pathname === '/api/settings/theme') {
        const body = await parseBody(req);
        if (!['light', 'dark'].includes(body.theme)) return json(res, 400, { error: 'Invalid theme.' });
        let setting = db.settings.find((s) => s.user_id === userId);
        if (!setting) {
          setting = { user_id: userId, theme: body.theme, updated_at: new Date().toISOString() };
          db.settings.push(setting);
        } else {
          setting.theme = body.theme;
          setting.updated_at = new Date().toISOString();
        }
        writeDb(db);
        return json(res, 200, { ok: true });
      }

      if (req.method === 'GET' && url.pathname === '/api/export') {
        return json(res, 200, {
          exportedAt: new Date().toISOString(),
          entries: db.entries.filter((e) => e.user_id === userId),
          notes: db.notes.filter((n) => n.user_id === userId),
          reminders: db.reminders.filter((r) => r.user_id === userId)
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/restore') {
        const body = await parseBody(req);
        db.entries = db.entries.filter((e) => e.user_id !== userId);
        db.notes = db.notes.filter((n) => n.user_id !== userId);
        db.reminders = db.reminders.filter((r) => r.user_id !== userId);

        (body.entries || []).forEach((e) => db.entries.push({ ...e, id: nextId(db.entries), user_id: userId }));
        (body.notes || []).forEach((n) => db.notes.push({ ...n, id: nextId(db.notes), user_id: userId }));
        (body.reminders || []).forEach((r) => db.reminders.push({ ...r, id: nextId(db.reminders), user_id: userId }));
        writeDb(db);
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { error: 'Unknown endpoint' });
    }

    if (req.method === 'GET') {
      if (url.pathname === '/' || url.pathname === '/index.html') return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
      const staticPath = path.normalize(path.join(PUBLIC_DIR, url.pathname));
      if (staticPath.startsWith(PUBLIC_DIR) && fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
        return sendFile(res, staticPath);
      }
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    json(res, 500, { error: err.message || 'Internal error' });
  }
});

server.listen(PORT, () => {
  console.log(`Diary app running at http://localhost:${PORT}`);
});
