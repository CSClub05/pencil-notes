const DB_NAME = "pencil-notes-db";
const DB_VERSION = 1;
const STORE_NAME = "notes";
const CURRENT_NOTE_KEY = "pencil-notes-current-note";

const canvas = document.getElementById("drawingCanvas");
const canvasWrap = document.getElementById("canvasWrap");
const ctx = canvas.getContext("2d");

const notesList = document.getElementById("notesList");
const pagesList = document.getElementById("pagesList");
const addPageButton = document.getElementById("addPageButton");
const newNoteButton = document.getElementById("newNoteButton");
const renameNoteButton = document.getElementById("renameNoteButton");
const deleteNoteButton = document.getElementById("deleteNoteButton");
const noteTitleInput = document.getElementById("noteTitleInput");
const saveStatus = document.getElementById("saveStatus");
const saveNowButton = document.getElementById("saveNowButton");
const undoButton = document.getElementById("undoButton");
const clearPageButton = document.getElementById("clearPageButton");
const toggleSidebarButton = document.getElementById("toggleSidebarButton");
const sidebar = document.getElementById("sidebar");

const penSizeInput = document.getElementById("penSizeInput");
const penSizeOutput = document.getElementById("penSizeOutput");
const colorPickerInput = document.getElementById("colorPickerInput");
const hexColorInput = document.getElementById("hexColorInput");

let db;
let notes = [];
let activeNoteId = null;
let activePageIndex = 0;
let activeStroke = null;
let autosaveTimer = null;
let lastPointerId = null;
let currentPen = {
  color: "#000000",
  size: 5
};

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function blankPage() {
  return {
    id: uid(),
    strokes: []
  };
}

function createNote(title = "Untitled note") {
  const timestamp = nowIso();
  return {
    id: uid(),
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    pages: [blankPage()]
  };
}

function getActiveNote() {
  return notes.find(note => note.id === activeNoteId) || null;
}

function getActivePage() {
  const note = getActiveNote();
  if (!note) return null;
  if (!note.pages[activePageIndex]) {
    activePageIndex = 0;
  }
  return note.pages[activePageIndex] || null;
}

function setStatus(message) {
  saveStatus.textContent = message;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(storeMode = "readonly") {
  return db.transaction(STORE_NAME, storeMode).objectStore(STORE_NAME);
}

function getAllNotes() {
  return new Promise((resolve, reject) => {
    const request = tx().getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function putNote(note) {
  return new Promise((resolve, reject) => {
    const request = tx("readwrite").put(note);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteNoteFromDb(id) {
  return new Promise((resolve, reject) => {
    const request = tx("readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function saveActiveNote(reason = "Saved") {
  const note = getActiveNote();
  if (!note) return;
  note.updatedAt = nowIso();
  await putNote(note);
  notes = notes.map(item => item.id === note.id ? note : item);
  localStorage.setItem(CURRENT_NOTE_KEY, note.id);
  setStatus(`${reason} at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`);
  renderNotesList();
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    saveActiveNote("Autosaved").catch(error => {
      console.error(error);
      setStatus("Could not autosave.");
    });
  }, 500);
}

async function loadInitialNotes() {
  notes = await getAllNotes();
  notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  if (notes.length === 0) {
    const firstNote = createNote("My first note");
    notes = [firstNote];
    activeNoteId = firstNote.id;
    await putNote(firstNote);
  } else {
    const storedCurrentId = localStorage.getItem(CURRENT_NOTE_KEY);
    activeNoteId = notes.some(note => note.id === storedCurrentId) ? storedCurrentId : notes[0].id;
  }

  activePageIndex = 0;
  const note = getActiveNote();
  noteTitleInput.value = note?.title || "";
  renderAll();
}

function renderAll() {
  renderNotesList();
  renderPagesList();
  resizeCanvasToDisplaySize();
  redrawCanvas();
  updateButtons();
}

function renderNotesList() {
  notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  notesList.innerHTML = "";

  for (const note of notes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `note-card ${note.id === activeNoteId ? "active" : ""}`;
    button.innerHTML = `
      <strong></strong>
      <p></p>
    `;
    button.querySelector("strong").textContent = note.title || "Untitled note";
    button.querySelector("p").textContent = `${note.pages.length} page${note.pages.length === 1 ? "" : "s"} · ${formatDate(note.updatedAt)}`;
    button.addEventListener("click", async () => {
      await saveActiveNote("Saved");
      activeNoteId = note.id;
      activePageIndex = 0;
      localStorage.setItem(CURRENT_NOTE_KEY, note.id);
      noteTitleInput.value = note.title || "Untitled note";
      renderAll();
      if (window.innerWidth < 780) {
        sidebar.classList.add("collapsed");
      }
    });
    notesList.appendChild(button);
  }
}

function renderPagesList() {
  const note = getActiveNote();
  pagesList.innerHTML = "";
  if (!note) return;

  note.pages.forEach((page, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `page-tab ${index === activePageIndex ? "active" : ""}`;
    button.textContent = `Page ${index + 1}`;
    button.addEventListener("click", () => {
      activePageIndex = index;
      renderPagesList();
      redrawCanvas();
      updateButtons();
    });
    pagesList.appendChild(button);
  });
}

function updateButtons() {
  const page = getActivePage();
  const note = getActiveNote();
  undoButton.disabled = !page || page.strokes.length === 0;
  clearPageButton.disabled = !page || page.strokes.length === 0;
  deleteNoteButton.disabled = !note || notes.length <= 1;
}

function resizeCanvasToDisplaySize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function clearCanvas() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
}

function redrawCanvas() {
  resizeCanvasToDisplaySize();
  clearCanvas();

  const page = getActivePage();
  if (!page) return;

  for (const stroke of page.strokes) {
    drawStroke(stroke);
  }
}

function drawStroke(stroke) {
  if (!stroke.points || stroke.points.length === 0) return;

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    ctx.beginPath();
    ctx.fillStyle = stroke.color;
    ctx.arc(point.x, point.y, Math.max(0.5, getPointWidth(stroke.size, point.pressure) / 2), 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;

  for (let i = 1; i < stroke.points.length; i++) {
    const previous = stroke.points[i - 1];
    const current = stroke.points[i];
    ctx.beginPath();
    ctx.lineWidth = getPointWidth(stroke.size, current.pressure);
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();
  }
}

function getPointWidth(baseSize, pressure) {
  const safePressure = pressure && pressure > 0 ? pressure : 0.5;
  return Math.max(0.5, baseSize * (0.35 + safePressure * 0.9));
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    pressure: event.pressure && event.pressure > 0 ? event.pressure : 0.5,
    pointerType: event.pointerType || "unknown",
    t: Date.now()
  };
}

function startStroke(event) {
  if (event.button !== undefined && event.button !== 0) return;

  event.preventDefault();
  lastPointerId = event.pointerId;
  canvas.setPointerCapture?.(event.pointerId);

  activeStroke = {
    id: uid(),
    color: currentPen.color,
    size: currentPen.size,
    points: [getCanvasPoint(event)]
  };

  drawStroke(activeStroke);
}

function continueStroke(event) {
  if (!activeStroke || event.pointerId !== lastPointerId) return;
  event.preventDefault();

  const points = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [event];
  let previousPoint = activeStroke.points[activeStroke.points.length - 1];

  for (const pointerEvent of points) {
    const point = getCanvasPoint(pointerEvent);
    activeStroke.points.push(point);
    drawStroke({
      ...activeStroke,
      points: [previousPoint, point]
    });
    previousPoint = point;
  }
}

function finishStroke(event) {
  if (!activeStroke || event.pointerId !== lastPointerId) return;
  event.preventDefault();

  const page = getActivePage();
  if (page) {
    page.strokes.push(activeStroke);
  }

  activeStroke = null;
  lastPointerId = null;
  updateButtons();
  scheduleAutosave();
}

function normalizeHex(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toLowerCase()}` : null;
}

function setColor(value) {
  const normalized = normalizeHex(value);
  if (!normalized) return false;
  currentPen.color = normalized;
  colorPickerInput.value = normalized;
  hexColorInput.value = normalized;
  return true;
}

penSizeInput.addEventListener("input", () => {
  currentPen.size = Number(penSizeInput.value);
  penSizeOutput.value = `${currentPen.size} px`;
  penSizeOutput.textContent = `${currentPen.size} px`;
});

colorPickerInput.addEventListener("input", () => {
  setColor(colorPickerInput.value);
});

hexColorInput.addEventListener("change", () => {
  const ok = setColor(hexColorInput.value);
  if (!ok) {
    hexColorInput.value = currentPen.color;
    setStatus("Use a 6-digit hex color like #000000.");
  }
});

hexColorInput.addEventListener("input", () => {
  const normalized = normalizeHex(hexColorInput.value);
  if (normalized) {
    setColor(normalized);
  }
});

canvas.addEventListener("pointerdown", startStroke);
canvas.addEventListener("pointermove", continueStroke);
canvas.addEventListener("pointerup", finishStroke);
canvas.addEventListener("pointercancel", finishStroke);
canvas.addEventListener("lostpointercapture", event => {
  if (activeStroke && event.pointerId === lastPointerId) {
    finishStroke(event);
  }
});

addPageButton.addEventListener("click", () => {
  const note = getActiveNote();
  if (!note) return;
  note.pages.push(blankPage());
  activePageIndex = note.pages.length - 1;
  renderPagesList();
  redrawCanvas();
  scheduleAutosave();
});

newNoteButton.addEventListener("click", async () => {
  await saveActiveNote("Saved");
  const note = createNote(`Note ${notes.length + 1}`);
  notes.unshift(note);
  activeNoteId = note.id;
  activePageIndex = 0;
  noteTitleInput.value = note.title;
  await putNote(note);
  localStorage.setItem(CURRENT_NOTE_KEY, note.id);
  renderAll();
  setStatus("Created a new note.");
});

renameNoteButton.addEventListener("click", () => {
  const note = getActiveNote();
  if (!note) return;
  const nextTitle = noteTitleInput.value.trim() || "Untitled note";
  note.title = nextTitle;
  scheduleAutosave();
  renderNotesList();
});

noteTitleInput.addEventListener("change", () => {
  renameNoteButton.click();
});

deleteNoteButton.addEventListener("click", async () => {
  const note = getActiveNote();
  if (!note || notes.length <= 1) return;
  const confirmed = confirm(`Delete "${note.title}"? This cannot be undone.`);
  if (!confirmed) return;

  await deleteNoteFromDb(note.id);
  notes = notes.filter(item => item.id !== note.id);
  activeNoteId = notes[0].id;
  activePageIndex = 0;
  localStorage.setItem(CURRENT_NOTE_KEY, activeNoteId);
  noteTitleInput.value = getActiveNote()?.title || "";
  renderAll();
  setStatus("Deleted note.");
});

undoButton.addEventListener("click", () => {
  const page = getActivePage();
  if (!page || page.strokes.length === 0) return;
  page.strokes.pop();
  redrawCanvas();
  updateButtons();
  scheduleAutosave();
});

clearPageButton.addEventListener("click", () => {
  const page = getActivePage();
  if (!page || page.strokes.length === 0) return;
  const confirmed = confirm("Clear this page?");
  if (!confirmed) return;
  page.strokes = [];
  redrawCanvas();
  updateButtons();
  scheduleAutosave();
});

saveNowButton.addEventListener("click", () => {
  saveActiveNote("Saved").catch(error => {
    console.error(error);
    setStatus("Could not save.");
  });
});

toggleSidebarButton.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
});

window.addEventListener("resize", () => {
  redrawCanvas();
});

window.addEventListener("orientationchange", () => {
  setTimeout(redrawCanvas, 250);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    saveActiveNote("Saved").catch(console.error);
  }
});

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("service-worker.js");
  } catch (error) {
    console.warn("Service worker registration failed:", error);
  }
}

async function main() {
  try {
    db = await openDb();
    await loadInitialNotes();
    setColor("#000000");
    penSizeOutput.textContent = `${currentPen.size} px`;
    await registerServiceWorker();
  } catch (error) {
    console.error(error);
    setStatus("The app could not start. Check browser storage permissions.");
  }
}

main();