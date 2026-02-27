const STORAGE_KEY = "calmDiaryData_v1";
const AUTOSAVE_KEY = "calmDiaryDraft";

const state = {
  entries: [],
  notes: [],
  reminders: [],
  theme: "light"
};

const el = {
  pages: document.querySelectorAll(".page"),
  navButtons: document.querySelectorAll(".bottom-nav button"),
  entryList: document.getElementById("entryList"),
  entryForm: document.getElementById("entryForm"),
  entryDate: document.getElementById("entryDate"),
  entryTitle: document.getElementById("entryTitle"),
  entryContent: document.getElementById("entryContent"),
  entryPhotos: document.getElementById("entryPhotos"),
  photoPreview: document.getElementById("photoPreview"),
  autosaveStatus: document.getElementById("autosaveStatus"),
  searchKeyword: document.getElementById("searchKeyword"),
  searchFrom: document.getElementById("searchFrom"),
  searchTo: document.getElementById("searchTo"),
  searchMonth: document.getElementById("searchMonth"),
  searchYear: document.getElementById("searchYear"),
  runSearch: document.getElementById("runSearch"),
  searchResults: document.getElementById("searchResults"),
  noteForm: document.getElementById("noteForm"),
  noteType: document.getElementById("noteType"),
  noteTags: document.getElementById("noteTags"),
  noteText: document.getElementById("noteText"),
  noteSearch: document.getElementById("noteSearch"),
  noteList: document.getElementById("noteList"),
  reminderForm: document.getElementById("reminderForm"),
  reminderTitle: document.getElementById("reminderTitle"),
  reminderType: document.getElementById("reminderType"),
  reminderTime: document.getElementById("reminderTime"),
  reminderList: document.getElementById("reminderList"),
  reminderCalendar: document.getElementById("reminderCalendar"),
  toggleTheme: document.getElementById("toggleTheme"),
  enableNotifications: document.getElementById("enableNotifications"),
  exportJson: document.getElementById("exportJson"),
  exportTxt: document.getElementById("exportTxt"),
  exportPdf: document.getElementById("exportPdf"),
  restoreFile: document.getElementById("restoreFile"),
  clearData: document.getElementById("clearData")
};

let draftTimer;
let selectedImages = [];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed) Object.assign(state, parsed);
  } catch {
    console.warn("Could not load saved diary data");
  }
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  persist();
}

function navTo(pageId) {
  el.pages.forEach((p) => p.classList.toggle("active", p.id === pageId));
  el.navButtons.forEach((b) => b.classList.toggle("active", b.dataset.page === pageId));
}

async function compressImage(file, maxW = 1200, quality = 0.72) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();

  const scale = Math.min(1, maxW / img.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);

  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  return canvas.toDataURL("image/jpeg", quality);
}

function renderEntries(entries = state.entries, target = el.entryList) {
  target.innerHTML = "";
  if (!entries.length) {
    target.innerHTML = "<p class='hint'>No entries yet.</p>";
    return;
  }
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  sorted.forEach((entry) => {
    const article = document.createElement("article");
    article.innerHTML = `
      <h3>${entry.title}</h3>
      <p class="hint"><strong>${entry.date}</strong></p>
      <div>${entry.content}</div>
      <div class="photo-grid">${entry.photos.map((p) => `<img src="${p}" alt="diary photo"/>`).join("")}</div>
    `;
    target.appendChild(article);
  });
}

function renderNotes(filter = "") {
  const q = filter.toLowerCase().trim();
  const list = state.notes.filter((n) => `${n.text} ${n.tags.join(" ")} ${n.type}`.toLowerCase().includes(q));
  el.noteList.innerHTML = "";
  if (!list.length) {
    el.noteList.innerHTML = "<p class='hint'>No notes found.</p>";
    return;
  }
  list.forEach((n) => {
    const article = document.createElement("article");
    article.innerHTML = `
      <h3>${n.type.toUpperCase()}</h3>
      <p>${n.text}</p>
      <p class="tags">Tags: ${n.tags.join(", ") || "none"}</p>
      <div class="grid-2">
        <button data-edit-note="${n.id}">Edit</button>
        <button data-del-note="${n.id}" class="danger">Delete</button>
      </div>
    `;
    el.noteList.appendChild(article);
  });
}

function renderReminders() {
  const sorted = [...state.reminders].sort((a, b) => a.time.localeCompare(b.time));
  el.reminderList.innerHTML = sorted.length ? "" : "<p class='hint'>No reminders.</p>";
  sorted.forEach((r) => {
    const article = document.createElement("article");
    article.innerHTML = `
      <h3>${r.title}</h3>
      <p class="hint">${r.type} • ${new Date(r.time).toLocaleString()}</p>
      <button data-del-reminder="${r.id}" class="danger">Delete</button>
    `;
    el.reminderList.appendChild(article);
  });

  const grouped = sorted.reduce((acc, item) => {
    const day = item.time.slice(0, 10);
    acc[day] = acc[day] || [];
    acc[day].push(item.title);
    return acc;
  }, {});

  el.reminderCalendar.innerHTML = `<h3>Calendar View</h3>${Object.keys(grouped).length
      ? Object.entries(grouped)
          .map(([day, titles]) => `<p><strong>${day}</strong>: ${titles.join(", ")}</p>`)
          .join("")
      : "<p class='hint'>No scheduled items.</p>"
    }`;
}

function saveDraft() {
  const draft = {
    date: el.entryDate.value,
    title: el.entryTitle.value,
    content: el.entryContent.innerHTML
  };
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(draft));
  el.autosaveStatus.textContent = `Auto-saved at ${new Date().toLocaleTimeString()}`;
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(AUTOSAVE_KEY));
    if (!draft) return;
    el.entryDate.value = draft.date || todayISO();
    el.entryTitle.value = draft.title || "";
    el.entryContent.innerHTML = draft.content || "";
  } catch {
    console.warn("Could not restore draft.");
  }
}

function clearDraft() {
  localStorage.removeItem(AUTOSAVE_KEY);
  el.autosaveStatus.textContent = "Auto-save idle";
}

function triggerDownload(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function runEntrySearch() {
  const key = el.searchKeyword.value.toLowerCase().trim();
  const from = el.searchFrom.value;
  const to = el.searchTo.value;
  const month = Number(el.searchMonth.value || 0);
  const year = Number(el.searchYear.value || 0);

  const results = state.entries.filter((entry) => {
    const matchKey = !key || `${entry.title} ${entry.content}`.toLowerCase().includes(key);
    const matchRange = (!from || entry.date >= from) && (!to || entry.date <= to);
    const d = new Date(entry.date);
    const matchMonth = !month || d.getMonth() + 1 === month;
    const matchYear = !year || d.getFullYear() === year;
    return matchKey && matchRange && matchMonth && matchYear;
  });

  renderEntries(results, el.searchResults);
}

function scheduleReminderChecks() {
  setInterval(() => {
    if (Notification.permission !== "granted") return;
    const now = Date.now();
    state.reminders.forEach((r) => {
      if (r.notified) return;
      const when = new Date(r.time).getTime();
      if (when <= now) {
        new Notification(`Reminder: ${r.title}`, { body: `${r.type} reminder` });
        r.notified = true;
        persist();
      }
    });
  }, 30000);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(console.warn);
  }
}

function bindEvents() {
  el.navButtons.forEach((btn) => btn.addEventListener("click", () => navTo(btn.dataset.page)));

  document.querySelectorAll("[data-cmd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.execCommand(btn.dataset.cmd, false);
      el.entryContent.focus();
    });
  });

  [el.entryDate, el.entryTitle, el.entryContent].forEach((node) => {
    node.addEventListener("input", () => {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(saveDraft, 450);
    });
  });

  el.entryPhotos.addEventListener("change", async () => {
    selectedImages = [];
    el.photoPreview.innerHTML = "";
    const files = [...el.entryPhotos.files].slice(0, 8);
    for (const file of files) {
      const compressed = await compressImage(file);
      selectedImages.push(compressed);
      const img = document.createElement("img");
      img.src = compressed;
      el.photoPreview.appendChild(img);
    }
  });

  el.entryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    state.entries.push({
      id: uid(),
      date: el.entryDate.value,
      title: el.entryTitle.value.trim(),
      content: el.entryContent.innerHTML.trim(),
      photos: [...selectedImages]
    });
    persist();
    renderEntries();
    el.entryForm.reset();
    el.entryContent.innerHTML = "";
    el.photoPreview.innerHTML = "";
    selectedImages = [];
    el.entryDate.value = todayISO();
    clearDraft();
    navTo("home");
  });

  el.runSearch.addEventListener("click", runEntrySearch);

  el.noteForm.addEventListener("submit", (e) => {
    e.preventDefault();
    state.notes.push({
      id: uid(),
      type: el.noteType.value,
      tags: el.noteTags.value.split(",").map((t) => t.trim()).filter(Boolean),
      text: el.noteText.value.trim()
    });
    persist();
    el.noteForm.reset();
    renderNotes();
  });

  el.noteSearch.addEventListener("input", () => renderNotes(el.noteSearch.value));

  el.noteList.addEventListener("click", (e) => {
    if (e.target.matches("[data-edit-note]")) {
      const note = state.notes.find((n) => n.id === e.target.dataset.editNote);
      if (!note) return;
      const updated = prompt("Edit note", note.text);
      if (updated === null) return;
      note.text = updated.trim();
      persist();
      renderNotes(el.noteSearch.value);
      return;
    }
    if (!e.target.matches("[data-del-note]")) return;
    state.notes = state.notes.filter((n) => n.id !== e.target.dataset.delNote);
    persist();
    renderNotes(el.noteSearch.value);
  });

  el.reminderForm.addEventListener("submit", (e) => {
    e.preventDefault();
    state.reminders.push({
      id: uid(),
      title: el.reminderTitle.value.trim(),
      type: el.reminderType.value,
      time: el.reminderTime.value,
      notified: false
    });
    persist();
    el.reminderForm.reset();
    renderReminders();
  });

  el.reminderList.addEventListener("click", (e) => {
    if (!e.target.matches("[data-del-reminder]")) return;
    state.reminders = state.reminders.filter((r) => r.id !== e.target.dataset.delReminder);
    persist();
    renderReminders();
  });

  el.toggleTheme.addEventListener("click", () => setTheme(state.theme === "light" ? "dark" : "light"));

  el.enableNotifications.addEventListener("click", async () => {
    if (!("Notification" in window)) {
      alert("Notifications are not available in this browser.");
      return;
    }
    const permission = await Notification.requestPermission();
    alert(`Notification permission: ${permission}`);
  });

  el.exportJson.addEventListener("click", () => {
    triggerDownload("calm-diary-backup.json", JSON.stringify(state, null, 2), "application/json");
  });

  el.exportTxt.addEventListener("click", () => {
    const textDump = state.entries
      .map((e) => `${e.date} | ${e.title}\n${e.content.replace(/<[^>]+>/g, "")}\n`)
      .join("\n---\n");
    triggerDownload("calm-diary.txt", textDump, "text/plain");
  });

  el.exportPdf.addEventListener("click", () => {
    const printWindow = window.open("", "_blank");
    printWindow.document.write(`<html><body><h1>Calm Diary Export</h1>${state.entries.map((e) => `<h2>${e.date} - ${e.title}</h2>${e.content}`).join("")}</body></html>`);
    printWindow.document.close();
    printWindow.print();
  });

  el.restoreFile.addEventListener("change", async () => {
    const file = el.restoreFile.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      Object.assign(state, data);
      persist();
      renderEntries();
      renderNotes();
      renderReminders();
      alert("Backup restored");
    } catch {
      alert("Invalid backup file");
    }
  });

  el.clearData.addEventListener("click", () => {
    if (!confirm("Delete all diary data permanently from this device?")) return;
    state.entries = [];
    state.notes = [];
    state.reminders = [];
    persist();
    clearDraft();
    renderEntries();
    renderNotes();
    renderReminders();
  });
}

function init() {
  load();
  bindEvents();
  setTheme(state.theme || "light");
  el.entryDate.value = todayISO();
  restoreDraft();
  renderEntries();
  renderNotes();
  renderReminders();
  scheduleReminderChecks();
  registerServiceWorker();
}

init();
