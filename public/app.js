const state = {
  isRegister: false,
  currentView: 'home',
  editingEntryId: null,
  draftTimer: null,
  images: []
};

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showMessage(msg) {
  alert(msg);
}

function setView(view) {
  state.currentView = view;
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $(view).classList.remove('hidden');
  $('viewTitle').textContent = document.querySelector(`[data-view="${view}"]`)?.textContent || 'Diary';
  document.querySelectorAll('#bottomNav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'home') loadHome();
  if (view === 'search') runSearch();
  if (view === 'notes') loadNotes();
  if (view === 'settings') loadSettings();
}

async function initAuth() {
  const status = await api('/api/auth/status');
  state.isRegister = !status.hasUser;
  $('authHint').textContent = status.hasUser ? 'Enter your password to unlock diary.' : 'Create your first password (min 8 chars).';
  $('authBtn').textContent = status.hasUser ? 'Login' : 'Create Account';
  if (status.authenticated) return onLogin();
}

async function onLogin() {
  $('authView').classList.add('hidden');
  $('mainView').classList.remove('hidden');
  $('bottomNav').classList.remove('hidden');
  $('entryDate').valueAsDate = new Date();
  enableDraftAutoSave();
  await loadSettings();
  await loadHome();
}

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const password = $('password').value;
    if (state.isRegister) await api('/api/auth/register', { method: 'POST', body: { password } });
    else await api('/api/auth/login', { method: 'POST', body: { password } });
    await onLogin();
  } catch (err) {
    showMessage(err.message);
  }
});

document.querySelectorAll('#bottomNav button').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));

document.querySelectorAll('[data-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => document.execCommand(btn.dataset.cmd, false, null));
});

async function compressImage(file, maxWidth = 1200, quality = 0.75) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

$('entryPhotos').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    const compressed = await compressImage(file);
    state.images.push(compressed);
  }
  renderPhotoPreview();
});

function renderPhotoPreview() {
  $('photoPreview').innerHTML = state.images.map((img) => `<img src="${img}" alt="entry"/>`).join('');
}

async function saveEntry(draft = false) {
  const contentHtml = $('editor').innerHTML.trim();
  const contentText = $('editor').innerText.trim();
  if (!draft && (!$('entryTitle').value.trim() || !contentHtml)) return showMessage('Title and content are required.');
  const result = await api('/api/entries', {
    method: 'POST',
    body: {
      id: state.editingEntryId,
      entryDate: $('entryDate').value,
      title: $('entryTitle').value || '(Draft)',
      contentHtml: contentHtml || '<p></p>',
      contentText,
      images: state.images,
      draft: draft ? 1 : 0
    }
  });
  state.editingEntryId = result.id;
}

$('entryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await saveEntry(false);
    showMessage('Entry saved.');
    $('entryTitle').value = '';
    $('editor').innerHTML = '';
    state.images = [];
    state.editingEntryId = null;
    renderPhotoPreview();
    await loadHome();
    setView('home');
  } catch (err) {
    showMessage(err.message);
  }
});

$('saveDraft').addEventListener('click', async () => {
  try {
    await saveEntry(true);
    showMessage('Draft saved.');
  } catch (err) {
    showMessage(err.message);
  }
});

function enableDraftAutoSave() {
  if (state.draftTimer) clearInterval(state.draftTimer);
  state.draftTimer = setInterval(() => {
    if (state.currentView === 'add' && ($('entryTitle').value.trim() || $('editor').innerText.trim())) {
      saveEntry(true).catch(() => null);
    }
  }, 10000);
}

function renderEntries(list, targetId) {
  const target = $(targetId);
  if (!list.length) {
    target.innerHTML = '<p class="meta">No entries yet.</p>';
    return;
  }
  target.innerHTML = list
    .map(
      (e) => `<div class="item">
      <strong>${e.title}</strong>
      <div class="meta">${e.entry_date}${e.draft ? ' • Draft' : ''}</div>
      <div>${e.content_text.slice(0, 120)}</div>
      ${(e.images || []).length ? `<div class="meta">${e.images.length} photo(s)</div>` : ''}
    </div>`
    )
    .join('');
}

async function loadHome() {
  const [entries, reminders] = await Promise.all([api('/api/entries'), api('/api/reminders')]);
  renderEntries(entries.slice(0, 6), 'entryList');
  const upcoming = reminders.filter((r) => !r.is_done).slice(0, 4);
  $('reminderPreview').innerHTML = upcoming.length
    ? upcoming.map((r) => `<div class="item"><strong>${r.title}</strong><div class="meta">${new Date(r.due_at).toLocaleString()}</div></div>`).join('')
    : '<p class="meta">No reminders.</p>';
}

async function runSearch() {
  try {
    const params = new URLSearchParams();
    ['searchKeyword', 'searchYear', 'searchMonth', 'searchFrom', 'searchTo'].forEach((id) => {
      const value = $(id).value.trim();
      if (!value) return;
      const key = id.replace('search', '').toLowerCase();
      params.set(key === 'keyword' ? 'keyword' : key, value);
    });
    const results = await api(`/api/entries?${params.toString()}`);
    renderEntries(results, 'searchResults');
  } catch (err) {
    showMessage(err.message);
  }
}
$('runSearch').addEventListener('click', runSearch);

async function loadNotes() {
  const keyword = $('noteSearch').value.trim();
  const notes = await api(`/api/notes?keyword=${encodeURIComponent(keyword)}`);
  $('noteList').innerHTML = notes.length
    ? notes
        .map((n) => `<div class="item"><strong>${n.title}</strong> <span class="meta">(${n.category})</span><div>${n.content}</div></div>`)
        .join('')
    : '<p class="meta">No notes yet.</p>';
}

$('saveNote').addEventListener('click', async () => {
  try {
    await api('/api/notes', {
      method: 'POST',
      body: {
        title: $('noteTitle').value.trim(),
        content: $('noteContent').value.trim(),
        category: $('noteCategory').value
      }
    });
    $('noteTitle').value = '';
    $('noteContent').value = '';
    loadNotes();
  } catch (err) {
    showMessage(err.message);
  }
});
$('noteSearch').addEventListener('input', () => loadNotes());

async function loadSettings() {
  const [settings, reminders] = await Promise.all([api('/api/settings'), api('/api/reminders')]);
  document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  $('themeSelect').value = settings.theme;
  $('reminderList').innerHTML = reminders.length
    ? reminders
        .map(
          (r) => `<div class="item"><strong>${r.title}</strong><div class="meta">${r.reminder_type} • ${new Date(r.due_at).toLocaleString()}</div><div>${r.notes || ''}</div></div>`
        )
        .join('')
    : '<p class="meta">No reminders created.</p>';
}

$('themeSelect').addEventListener('change', async () => {
  await api('/api/settings/theme', { method: 'POST', body: { theme: $('themeSelect').value } });
  await loadSettings();
});

$('saveReminder').addEventListener('click', async () => {
  try {
    await api('/api/reminders', {
      method: 'POST',
      body: {
        title: $('reminderTitle').value.trim(),
        reminderType: $('reminderType').value,
        dueAt: new Date($('reminderDue').value).toISOString(),
        notes: $('reminderNotes').value.trim()
      }
    });
    $('reminderTitle').value = '';
    $('reminderNotes').value = '';
    await loadSettings();
    await loadHome();
  } catch (err) {
    showMessage(err.message);
  }
});

$('enableNotifs').addEventListener('click', async () => {
  if (!('Notification' in window)) return showMessage('Notifications not supported in this browser.');
  const perm = await Notification.requestPermission();
  showMessage(`Notification permission: ${perm}`);
});

setInterval(async () => {
  if (Notification.permission !== 'granted') return;
  try {
    const reminders = await api('/api/reminders');
    const now = Date.now();
    reminders.forEach((r) => {
      const due = new Date(r.due_at).getTime();
      if (!r.is_done && due > now - 60000 && due < now + 60000) {
        new Notification('Diary Reminder', { body: r.title });
      }
    });
  } catch {
    // ignore when logged out
  }
}, 45000);

$('exportData').addEventListener('click', async () => {
  const data = await api('/api/export');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `diary-export-${Date.now()}.json`;
  a.click();
});

$('restoreInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const json = JSON.parse(await file.text());
  await api('/api/restore', { method: 'POST', body: json });
  showMessage('Data restored.');
  await loadHome();
});

$('changePassword').addEventListener('click', async () => {
  try {
    await api('/api/auth/change-password', {
      method: 'POST',
      body: {
        currentPassword: $('currentPassword').value,
        newPassword: $('newPassword').value
      }
    });
    $('currentPassword').value = '';
    $('newPassword').value = '';
    showMessage('Password updated.');
  } catch (err) {
    showMessage(err.message);
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.reload();
});

initAuth().catch((err) => showMessage(err.message));
