const state = {
  registerMode: false,
  view: 'home',
  editingEntryId: null,
  entryImages: [],
  draftTimer: null,
  reminderTimer: null
};

const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const response = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function notify(message) {
  window.alert(message);
}

function applyView(view) {
  state.view = view;
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.add('hidden'));
  $(view).classList.remove('hidden');
  document.querySelectorAll('#bottomNav button').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
  $('pageTitle').textContent = document.querySelector(`#bottomNav button[data-view="${view}"]`)?.textContent || 'Diary';

  if (view === 'home') loadHome();
  if (view === 'search') runSearch();
  if (view === 'notes') loadNotes();
  if (view === 'settings') loadSettings();
}

function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function imageToCompressedDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

function renderPhotoPreview() {
  $('photoPreview').innerHTML = state.entryImages.map((img, i) => `<div><img src="${img}" alt="photo ${i + 1}" /></div>`).join('');
}

function resetEntryEditor() {
  state.editingEntryId = null;
  state.entryImages = [];
  $('entryDate').valueAsDate = new Date();
  $('entryTitle').value = '';
  $('entryEditor').innerHTML = '';
  $('entryFormTitle').textContent = 'Add Diary Entry';
  renderPhotoPreview();
}

async function saveEntry({ draft = false } = {}) {
  const title = $('entryTitle').value.trim();
  const contentHtml = $('entryEditor').innerHTML.trim();
  const contentText = $('entryEditor').innerText.trim();
  const entryDate = $('entryDate').value;

  if (!draft && (!title || !contentHtml)) {
    notify('Title and content are required.');
    return;
  }

  const payload = {
    id: state.editingEntryId,
    entryDate,
    title: title || '(Draft)',
    contentHtml: contentHtml || '<p></p>',
    contentText,
    images: state.entryImages,
    draft: draft ? 1 : 0
  };

  const result = await api('/api/entries', { method: 'POST', body: payload });
  state.editingEntryId = result.id;
}

function escapeHtml(input) {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderEntries(entries, targetId, withActions = false) {
  const target = $(targetId);
  if (!entries.length) {
    target.innerHTML = '<p class="meta">No entries found.</p>';
    return;
  }

  target.innerHTML = entries
    .map((entry) => {
      const images = (entry.images || []).slice(0, 3).map((src) => `<img src="${src}" alt="entry photo" />`).join('');
      return `<div class="item">
        <strong>${escapeHtml(entry.title)}</strong>
        <div class="meta">${escapeHtml(entry.entry_date)} ${entry.draft ? '• Draft' : ''}</div>
        <p>${escapeHtml((entry.content_text || '').slice(0, 180))}</p>
        ${images ? `<div class="photo-grid">${images}</div>` : ''}
        ${withActions ? `<div class="actions"><button data-edit-entry="${entry.id}">Edit</button><button data-delete-entry="${entry.id}" class="ghost">Delete</button></div>` : ''}
      </div>`;
    })
    .join('');
}

async function loadHome() {
  const [entries, reminders] = await Promise.all([api('/api/entries'), api('/api/reminders')]);
  renderEntries(entries.slice(0, 8), 'entryList', true);
  $('homeReminderList').innerHTML = reminders.length
    ? reminders.slice(0, 5).map((r) => `<div class="item"><strong>${escapeHtml(r.title)}</strong><div class="meta">${new Date(r.due_at).toLocaleString()}</div></div>`).join('')
    : '<p class="meta">No reminders yet.</p>';
}

async function runSearch() {
  const params = new URLSearchParams();
  const mapping = {
    searchKeyword: 'keyword',
    searchYear: 'year',
    searchMonth: 'month',
    searchDay: 'day',
    searchFrom: 'from',
    searchTo: 'to'
  };
  Object.entries(mapping).forEach(([id, key]) => {
    const val = $(id).value.trim();
    if (val) params.set(key, val);
  });
  const results = await api(`/api/entries?${params.toString()}`);
  renderEntries(results, 'searchResults', true);
}

async function loadNotes() {
  const notes = await api(`/api/notes?keyword=${encodeURIComponent($('noteSearch').value.trim())}`);
  $('noteList').innerHTML = notes.length
    ? notes
        .map((note) => `<div class="item"><strong>${escapeHtml(note.title)}</strong> <span class="meta">(${escapeHtml(note.category)})</span><p>${escapeHtml(note.content)}</p><div class="actions"><button data-delete-note="${note.id}" class="ghost">Delete</button></div></div>`)
        .join('')
    : '<p class="meta">No notes yet.</p>';
}

async function loadSettings() {
  const [settings, reminders] = await Promise.all([api('/api/settings'), api('/api/reminders')]);
  document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  $('themeSelect').value = settings.theme;
  $('reminderList').innerHTML = reminders.length
    ? reminders
        .map(
          (r) => `<div class="item"><strong>${escapeHtml(r.title)}</strong><div class="meta">${escapeHtml(r.reminder_type)} • ${new Date(r.due_at).toLocaleString()}</div><p>${escapeHtml(r.notes || '')}</p><div class="actions"><button data-toggle-reminder="${r.id}">${r.is_done ? 'Mark Undone' : 'Mark Done'}</button><button data-delete-reminder="${r.id}" class="ghost">Delete</button></div></div>`
        )
        .join('')
    : '<p class="meta">No reminders.</p>';
}

function startDraftAutosave() {
  if (state.draftTimer) clearInterval(state.draftTimer);
  state.draftTimer = setInterval(() => {
    if (state.view === 'add' && ($('entryTitle').value.trim() || $('entryEditor').innerText.trim())) {
      saveEntry({ draft: true }).catch(() => null);
    }
  }, 10000);
}

function startReminderChecks() {
  if (state.reminderTimer) clearInterval(state.reminderTimer);
  state.reminderTimer = setInterval(async () => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const reminders = await api('/api/reminders');
      const now = Date.now();
      reminders.forEach((r) => {
        const due = new Date(r.due_at).getTime();
        if (!r.is_done && due > now - 60_000 && due < now + 60_000) {
          new Notification('Diary Reminder', { body: r.title });
        }
      });
    } catch {
      // ignore polling errors while logged out
    }
  }, 45000);
}

async function boot() {
  const status = await api('/api/auth/status');
  state.registerMode = !status.hasUser;
  $('authHint').textContent = state.registerMode ? 'Create your private password (minimum 8 characters).' : 'Enter your password to unlock your diary.';
  $('authButton').textContent = state.registerMode ? 'Create Account' : 'Login';

  if (status.authenticated) {
    $('authView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    $('bottomNav').classList.remove('hidden');
    resetEntryEditor();
    applyView('home');
    startDraftAutosave();
    startReminderChecks();
  }
}

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (state.registerMode) await api('/api/auth/register', { method: 'POST', body: { password: $('password').value } });
    else await api('/api/auth/login', { method: 'POST', body: { password: $('password').value } });

    $('authView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    $('bottomNav').classList.remove('hidden');
    resetEntryEditor();
    applyView('home');
    startDraftAutosave();
    startReminderChecks();
  } catch (err) {
    notify(err.message);
  }
});

document.querySelectorAll('#bottomNav button').forEach((button) => {
  button.addEventListener('click', () => applyView(button.dataset.view));
});

document.querySelectorAll('[data-command]').forEach((btn) => {
  btn.addEventListener('click', () => document.execCommand(btn.dataset.command, false, null));
});

$('entryPhotos').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []).slice(0, 8);
  for (const file of files) {
    state.entryImages.push(await imageToCompressedDataUrl(file));
  }
  renderPhotoPreview();
});

$('entryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await saveEntry({ draft: false });
    notify('Entry saved.');
    resetEntryEditor();
    await loadHome();
    applyView('home');
  } catch (err) {
    notify(err.message);
  }
});

$('saveDraft').addEventListener('click', async () => {
  try {
    await saveEntry({ draft: true });
    notify('Draft saved.');
  } catch (err) {
    notify(err.message);
  }
});

$('clearEntry').addEventListener('click', () => resetEntryEditor());

$('runSearch').addEventListener('click', () => runSearch().catch((err) => notify(err.message)));
$('noteSearch').addEventListener('input', () => loadNotes().catch((err) => notify(err.message)));

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
    await loadNotes();
  } catch (err) {
    notify(err.message);
  }
});

$('themeSelect').addEventListener('change', async () => {
  await api('/api/settings/theme', { method: 'POST', body: { theme: $('themeSelect').value } });
  await loadSettings();
});

$('enableNotifications').addEventListener('click', async () => {
  if (!('Notification' in window)) return notify('Notifications are not supported in this browser.');
  const permission = await Notification.requestPermission();
  notify(`Notification permission: ${permission}`);
});

$('exportJson').addEventListener('click', async () => {
  const exported = await api('/api/export');
  downloadBlob(`diary-backup-${Date.now()}.json`, new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }));
});

$('exportTxt').addEventListener('click', async () => {
  const response = await fetch('/api/export.txt');
  const text = await response.text();
  downloadBlob(`diary-${Date.now()}.txt`, new Blob([text], { type: 'text/plain' }));
});

$('restoreFile').addEventListener('change', async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const restored = JSON.parse(await file.text());
    await api('/api/restore', { method: 'POST', body: restored });
    notify('Backup restored successfully.');
    await Promise.all([loadHome(), loadNotes(), loadSettings()]);
  } catch (err) {
    notify(err.message);
  }
});

$('saveReminder').addEventListener('click', async () => {
  try {
    await api('/api/reminders', {
      method: 'POST',
      body: {
        title: $('reminderTitle').value.trim(),
        reminderType: $('reminderType').value,
        dueAt: new Date($('reminderDue').value).toISOString(),
        notes: $('reminderNotes').value.trim(),
        isDone: 0
      }
    });
    $('reminderTitle').value = '';
    $('reminderNotes').value = '';
    await Promise.all([loadHome(), loadSettings()]);
  } catch (err) {
    notify(err.message);
  }
});

$('changePassword').addEventListener('click', async () => {
  try {
    await api('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword: $('currentPassword').value, newPassword: $('newPassword').value }
    });
    $('currentPassword').value = '';
    $('newPassword').value = '';
    notify('Password changed successfully.');
  } catch (err) {
    notify(err.message);
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.reload();
});

document.body.addEventListener('click', async (event) => {
  const editEntryId = event.target.getAttribute('data-edit-entry');
  if (editEntryId) {
    const entries = await api('/api/entries');
    const entry = entries.find((e) => e.id === Number(editEntryId));
    if (!entry) return;
    state.editingEntryId = entry.id;
    state.entryImages = entry.images || [];
    $('entryDate').value = entry.entry_date;
    $('entryTitle').value = entry.title;
    $('entryEditor').innerHTML = entry.content_html;
    $('entryFormTitle').textContent = 'Edit Diary Entry';
    renderPhotoPreview();
    applyView('add');
    return;
  }

  const deleteEntryId = event.target.getAttribute('data-delete-entry');
  if (deleteEntryId) {
    if (!confirm('Delete this diary entry?')) return;
    await api(`/api/entries/${deleteEntryId}`, { method: 'DELETE' });
    await Promise.all([loadHome(), runSearch()]);
    return;
  }

  const deleteNoteId = event.target.getAttribute('data-delete-note');
  if (deleteNoteId) {
    await api(`/api/notes/${deleteNoteId}`, { method: 'DELETE' });
    await loadNotes();
    return;
  }

  const toggleReminderId = event.target.getAttribute('data-toggle-reminder');
  if (toggleReminderId) {
    const reminders = await api('/api/reminders');
    const reminder = reminders.find((r) => r.id === Number(toggleReminderId));
    if (!reminder) return;
    await api('/api/reminders', {
      method: 'POST',
      body: {
        id: reminder.id,
        title: reminder.title,
        reminderType: reminder.reminder_type,
        dueAt: reminder.due_at,
        notes: reminder.notes,
        isDone: reminder.is_done ? 0 : 1
      }
    });
    await Promise.all([loadHome(), loadSettings()]);
    return;
  }

  const deleteReminderId = event.target.getAttribute('data-delete-reminder');
  if (deleteReminderId) {
    await api(`/api/reminders/${deleteReminderId}`, { method: 'DELETE' });
    await Promise.all([loadHome(), loadSettings()]);
  }
});

boot().catch((err) => notify(err.message));
