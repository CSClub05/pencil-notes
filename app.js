const DB_NAME = "pencil-notes-db";
const DB_VERSION = 1;
const STORE_NAME = "notes";
const CURRENT_NOTE_KEY = "pencil-notes-current-note";
const FINGER_DRAW_KEY = "pencil-notes-finger-draw";

const canvas = document.getElementById("drawingCanvas");
const ctx = canvas.getContext("2d");

const notesList = document.getElementById("notesList");
const pagesList = document.getElementById("pagesList");
const addPageButton = document.getElementById("addPageButton");
const deletePageButton = document.getElementById("deletePageButton");
const newNoteButton = document.getElementById("newNoteButton");
const renameNoteButton = document.getElementById("renameNoteButton");
const deleteNoteButton = document.getElementById("deleteNoteButton");
const noteTitleInput = document.getElementById("noteTitleInput");
const saveStatus = document.getElementById("saveStatus");
const saveNowButton = document.getElementById("saveNowButton");
const exportPngButton = document.getElementById("exportPngButton");
const exportPdfButton = document.getElementById("exportPdfButton");
const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");
const clearPageButton = document.getElementById("clearPageButton");
const toggleSidebarButton = document.getElementById("toggleSidebarButton");
const sidebar = document.getElementById("sidebar");

const penToolButton = document.getElementById("penToolButton");
const eraserToolButton = document.getElementById("eraserToolButton");
const fingerDrawInput = document.getElementById("fingerDrawInput");
const penSizeInput = document.getElementById("penSizeInput");
const penSizeOutput = document.getElementById("penSizeOutput");
const eraserSizeInput = document.getElementById("eraserSizeInput");
const eraserSizeOutput = document.getElementById("eraserSizeOutput");
const colorPickerInput = document.getElementById("colorPickerInput");
const hexColorInput = document.getElementById("hexColorInput");

const zoomOutButton = document.getElementById("zoomOutButton");
const zoomInButton = document.getElementById("zoomInButton");
const resetZoomButton = document.getElementById("resetZoomButton");
const zoomOutput = document.getElementById("zoomOutput");

let db;
let notes = [];
let activeNoteId = null;
let activePageIndex = 0;
let activeStroke = null;
let eraserPreviewPoint = null;
let autosaveTimer = null;
let lastPointerId = null;
let fingerDrawEnabled = localStorage.getItem(FINGER_DRAW_KEY) === "true";

let activeTool = "pen";

let currentPen = {
  color: "#000000",
  size: 5
};

let currentEraser = {
  size: 24
};

let view = {
  scale: 1,
  offsetX: 0,
  offsetY: 0
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

const activePointers = new Map();
let gesture = null;

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
    strokes: [],
    redoStrokes: []
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

function normalizeNote(note) {
  if (!Array.isArray(note.pages) || note.pages.length === 0) {
    note.pages = [blankPage()];
  }

  for (const page of note.pages) {
    if (!Array.isArray(page.strokes)) page.strokes = [];
    if (!Array.isArray(page.redoStrokes)) page.redoStrokes = [];

    for (const stroke of page.strokes) {
      if (!stroke.kind) stroke.kind = "pen";
    }

    for (const stroke of page.redoStrokes) {
      if (!stroke.kind) stroke.kind = "pen";
    }
  }

  return note;
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
  notes = (await getAllNotes()).map(normalizeNote);
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
  updateToolButtons();
  updateZoomOutput();
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
      resetZoom();
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
  redoButton.disabled = !page || page.redoStrokes.length === 0;
  clearPageButton.disabled = !page || page.strokes.length === 0;
  deleteNoteButton.disabled = !note || notes.length <= 1;
  deletePageButton.disabled = !note || note.pages.length <= 1;
}

function updateToolButtons() {
  penToolButton.classList.toggle("active", activeTool === "pen");
  eraserToolButton.classList.toggle("active", activeTool === "eraser");
}

function updateZoomOutput() {
  zoomOutput.textContent = `${Math.round(view.scale * 100)}%`;
}

function resizeCanvasToDisplaySize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function applyDrawingTransform() {
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  ctx.setTransform(
    dpr * view.scale,
    0,
    0,
    dpr * view.scale,
    dpr * view.offsetX,
    dpr * view.offsetY
  );
}

function clearCanvas() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  applyDrawingTransform();
}

function redrawCanvas() {
  resizeCanvasToDisplaySize();
  clearCanvas();

  const page = getActivePage();
  if (!page) return;

  for (const stroke of page.strokes) {
    drawStroke(stroke);
  }

  if (activeStroke) {
    drawStroke(activeStroke);
  }

  drawEraserPreview();
}

function drawStroke(stroke) {
  if (!stroke.points || stroke.points.length === 0) return;

  const kind = stroke.kind || "pen";
  const isEraser = kind === "eraser";

  ctx.save();
  ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = isEraser ? "rgba(0, 0, 0, 1)" : stroke.color;
  ctx.fillStyle = isEraser ? "rgba(0, 0, 0, 1)" : stroke.color;

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(0.5, getPointWidth(stroke, point.pressure) / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  for (let i = 1; i < stroke.points.length; i++) {
    const previous = stroke.points[i - 1];
    const current = stroke.points[i];
    ctx.beginPath();
    ctx.lineWidth = getPointWidth(stroke, current.pressure);
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawStrokeForExport(exportCtx, stroke) {
  if (!stroke.points || stroke.points.length === 0) return;

  const kind = stroke.kind || "pen";
  const isEraser = kind === "eraser";

  exportCtx.save();
  exportCtx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
  exportCtx.lineCap = "round";
  exportCtx.lineJoin = "round";
  exportCtx.strokeStyle = isEraser ? "rgba(0, 0, 0, 1)" : stroke.color;
  exportCtx.fillStyle = isEraser ? "rgba(0, 0, 0, 1)" : stroke.color;

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    exportCtx.beginPath();
    exportCtx.arc(
      point.x,
      point.y,
      Math.max(0.5, getPointWidth(stroke, point.pressure) / 2),
      0,
      Math.PI * 2
    );
    exportCtx.fill();
    exportCtx.restore();
    return;
  }

  for (let i = 1; i < stroke.points.length; i++) {
    const previous = stroke.points[i - 1];
    const current = stroke.points[i];

    exportCtx.beginPath();
    exportCtx.lineWidth = getPointWidth(stroke, current.pressure);
    exportCtx.moveTo(previous.x, previous.y);
    exportCtx.lineTo(current.x, current.y);
    exportCtx.stroke();
  }

  exportCtx.restore();
}

function renderPageToExportCanvas(page, scale = 2) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = width * scale;
  exportCanvas.height = height * scale;

  const exportCtx = exportCanvas.getContext("2d");
  exportCtx.scale(scale, scale);

  for (const stroke of page.strokes) {
    drawStrokeForExport(exportCtx, stroke);
  }

  exportCtx.save();
  exportCtx.globalCompositeOperation = "destination-over";
  exportCtx.fillStyle = "#ffffff";
  exportCtx.fillRect(0, 0, width, height);
  exportCtx.restore();

  return exportCanvas;
}

function safeFileName(value) {
  return (value || "untitled-note")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled-note";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function dataUrlToBlob(dataUrl) {
  const [header, base64Data] = dataUrl.split(",");
  const mimeMatch = header.match(/^data:(.*?);base64$/);
  const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

function isAppleTouchDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function canShareFile(file) {
  return (
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  );
}

async function sharePngFile(file, note, pageNumber) {
  await navigator.share({
    files: [file],
    title: note.title || "Pencil Notes",
    text: `Page ${pageNumber} from ${note.title || "Pencil Notes"}`
  });
}

async function exportCurrentPageAsPng() {
  const note = getActiveNote();
  const page = getActivePage();
  if (!note || !page) return;

  const pageNumber = activePageIndex + 1;
  const filename = `${safeFileName(note.title)}-page-${pageNumber}.png`;
  const exportCanvas = renderPageToExportCanvas(page, 2);
  const dataUrl = exportCanvas.toDataURL("image/png");
  const pngFile = new File([dataUrlToBlob(dataUrl)], filename, { type: "image/png" });

  if (isAppleTouchDevice() && canShareFile(pngFile)) {
    try {
      await sharePngFile(pngFile, note, pageNumber);
      setStatus(`Opened iOS share sheet for Page ${pageNumber}. Choose Save Image to add it to Photos.`);
      await saveActiveNote("Saved");
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        setStatus("PNG export cancelled.");
        return;
      }

      console.warn("Native image sharing failed; falling back to download.", error);
    }
  }

  downloadDataUrl(dataUrl, filename);
  await saveActiveNote("Saved");
  setStatus(`Exported Page ${pageNumber} as PNG.`);
}

async function exportNoteAsPdf() {
  await saveActiveNote("Saved");

  const note = getActiveNote();
  if (!note) return;

  const exportWindow = window.open("", "_blank");

  if (!exportWindow) {
    setStatus("Allow pop-ups to export as PDF.");
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const orientation = rect.width >= rect.height ? "landscape" : "portrait";

  const pagesHtml = note.pages.map((page, index) => {
    const dataUrl = renderPageToExportCanvas(page, 2).toDataURL("image/png");

    return `
      <section class="pdf-page">
        <img src="${dataUrl}" alt="Page ${index + 1}">
      </section>
    `;
  }).join("");

  exportWindow.document.open();
  exportWindow.document.write(`
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(note.title || "Exported note")}</title>
      <style>
        @page {
          size: ${orientation};
          margin: 0;
        }

        html,
        body {
          margin: 0;
          padding: 0;
          background: white;
        }

        .pdf-page {
          width: 100vw;
          height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          page-break-after: always;
          break-after: page;
          background: white;
        }

        .pdf-page:last-child {
          page-break-after: auto;
          break-after: auto;
        }

        img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
        }
      </style>
    </head>
    <body>
      ${pagesHtml}
      <script>
        window.addEventListener("load", () => {
          setTimeout(() => {
            window.focus();
            window.print();
          }, 250);
        });
      <\/script>
    </body>
    </html>
  `);
  exportWindow.document.close();

  setStatus("Opened PDF export. Choose Save as PDF in the print dialog.");
}

function drawEraserPreview() {
  if (!eraserPreviewPoint || activeTool !== "eraser") return;

  const radius = currentEraser.size / 2;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.lineWidth = 1 / view.scale;
  ctx.strokeStyle = "rgba(31, 35, 40, 0.75)";
  ctx.setLineDash([4 / view.scale, 4 / view.scale]);

  ctx.beginPath();
  ctx.arc(eraserPreviewPoint.x, eraserPreviewPoint.y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function getPointWidth(stroke, pressure) {
  if ((stroke.kind || "pen") === "eraser") {
    return Math.max(1, stroke.size);
  }

  const safePressure = pressure && pressure > 0 ? pressure : 0.5;
  return Math.max(0.5, stroke.size * (0.35 + safePressure * 0.9));
}

function clientToCanvasScreen(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function clientToPage(clientX, clientY) {
  const screen = clientToCanvasScreen(clientX, clientY);
  return {
    x: (screen.x - view.offsetX) / view.scale,
    y: (screen.y - view.offsetY) / view.scale
  };
}

function getCanvasPoint(event) {
  const point = clientToPage(event.clientX, event.clientY);
  return {
    x: point.x,
    y: point.y,
    pressure: event.pressure && event.pressure > 0 ? event.pressure : 0.5,
    pointerType: event.pointerType || "unknown",
    t: Date.now()
  };
}

function startStroke(event) {
  event.preventDefault();
  lastPointerId = event.pointerId;

  activeStroke = {
    id: uid(),
    kind: activeTool,
    color: currentPen.color,
    size: activeTool === "eraser" ? currentEraser.size : currentPen.size,
    points: [getCanvasPoint(event)]
  };

  if (activeStroke.kind === "eraser") {
    eraserPreviewPoint = activeStroke.points[0];
    redrawCanvas();
  } else {
    eraserPreviewPoint = null;
    drawStroke(activeStroke);
  }
}

function continueStroke(event) {
  if (!activeStroke || event.pointerId !== lastPointerId) return;
  event.preventDefault();

  const isEraserStroke = activeStroke.kind === "eraser";
  const events = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [event];
  let previousPoint = activeStroke.points[activeStroke.points.length - 1];

  for (const pointerEvent of events) {
    const point = getCanvasPoint(pointerEvent);
    activeStroke.points.push(point);

    if (!isEraserStroke) {
      drawStroke({
        ...activeStroke,
        points: [previousPoint, point]
      });
    }

    previousPoint = point;
  }

  if (isEraserStroke) {
    eraserPreviewPoint = activeStroke.points[activeStroke.points.length - 1];
    redrawCanvas();
  }
}

function finishStroke(event) {
  if (!activeStroke || event.pointerId !== lastPointerId) return;
  event.preventDefault();

  const page = getActivePage();
  if (page) {
    page.strokes.push(activeStroke);
    page.redoStrokes = [];
  }

  const wasEraserStroke = activeStroke.kind === "eraser";

  activeStroke = null;
  lastPointerId = null;
  eraserPreviewPoint = null;

  if (wasEraserStroke) {
    redrawCanvas();
  }

  updateButtons();
  scheduleAutosave();
}

function getTouchPointers() {
  return Array.from(activePointers.values()).filter(pointer => pointer.pointerType === "touch");
}

function distance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function midpoint(a, b) {
  return {
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function startPan(touch) {
  gesture = {
    type: "pan",
    lastClientX: touch.clientX,
    lastClientY: touch.clientY
  };
}

function updatePan(touch) {
  if (!gesture || gesture.type !== "pan") {
    startPan(touch);
    return;
  }

  view.offsetX += touch.clientX - gesture.lastClientX;
  view.offsetY += touch.clientY - gesture.lastClientY;

  gesture.lastClientX = touch.clientX;
  gesture.lastClientY = touch.clientY;

  redrawCanvas();
}

function startPinch(touches) {
  const first = touches[0];
  const second = touches[1];
  const mid = midpoint(first, second);
  const worldPoint = clientToPage(mid.clientX, mid.clientY);

  gesture = {
    type: "pinch",
    startDistance: distance(first, second),
    startScale: view.scale,
    worldX: worldPoint.x,
    worldY: worldPoint.y
  };
}

function updatePinch(touches) {
  if (!gesture || gesture.type !== "pinch") {
    startPinch(touches);
    return;
  }

  const first = touches[0];
  const second = touches[1];
  const mid = midpoint(first, second);
  const screen = clientToCanvasScreen(mid.clientX, mid.clientY);

  const nextScale = clamp(
    gesture.startScale * (distance(first, second) / Math.max(1, gesture.startDistance)),
    MIN_ZOOM,
    MAX_ZOOM
  );

  view.scale = nextScale;
  view.offsetX = screen.x - gesture.worldX * nextScale;
  view.offsetY = screen.y - gesture.worldY * nextScale;

  updateZoomOutput();
  redrawCanvas();
}

function handleTouchGesture(event) {
  event.preventDefault();

  const touches = getTouchPointers();

  if (touches.length >= 2) {
    updatePinch(touches);
  } else if (touches.length === 1) {
    updatePan(touches[0]);
  } else {
    gesture = null;
  }
}

function resetGestureAfterPointerEnd() {
  const touches = getTouchPointers();

  if (touches.length >= 2) {
    startPinch(touches);
  } else if (touches.length === 1) {
    startPan(touches[0]);
  } else {
    gesture = null;
  }
}

function canPointerDraw(event) {
  if (event.pointerType === "touch") return false;
  if (event.pointerType === "mouse") return event.button === 0 || event.buttons === 1;
  return event.pointerType === "pen" || event.pointerType === "";
}

function cancelActiveStroke() {
  activeStroke = null;
  lastPointerId = null;
  redrawCanvas();
}

function handlePointerDown(event) {
  activePointers.set(event.pointerId, {
    pointerId: event.pointerId,
    pointerType: event.pointerType || "",
    clientX: event.clientX,
    clientY: event.clientY
  });

  canvas.setPointerCapture?.(event.pointerId);

  if (event.pointerType === "touch") {
    const touches = getTouchPointers();

    if (fingerDrawEnabled && touches.length === 1) {
      startStroke(event);
      return;
    }

    if (activeStroke) {
      cancelActiveStroke();
    }

    handleTouchGesture(event);
    return;
  }

  if (canPointerDraw(event)) {
    startStroke(event);
  }
}

function handlePointerMove(event) {
  if (activePointers.has(event.pointerId)) {
    activePointers.set(event.pointerId, {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "",
      clientX: event.clientX,
      clientY: event.clientY
    });
  }

  if (event.pointerType === "touch") {
    const touches = getTouchPointers();

    if (
      fingerDrawEnabled &&
      touches.length === 1 &&
      activeStroke &&
      event.pointerId === lastPointerId
    ) {
      continueStroke(event);
      return;
    }

    if (activeStroke && touches.length >= 2) {
      cancelActiveStroke();
    }

    handleTouchGesture(event);
    return;
  }

  continueStroke(event);
}

function handlePointerEnd(event) {
  if (event.pointerType === "touch") {
    if (fingerDrawEnabled && activeStroke && event.pointerId === lastPointerId) {
      finishStroke(event);
    } else {
      event.preventDefault();
    }
  } else {
    finishStroke(event);
  }

  activePointers.delete(event.pointerId);
  resetGestureAfterPointerEnd();
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

function setTool(tool) {
  activeTool = tool;
  updateToolButtons();
}

function setFingerDrawEnabled(enabled) {
  fingerDrawEnabled = enabled;
  fingerDrawInput.checked = enabled;
  localStorage.setItem(FINGER_DRAW_KEY, String(enabled));

  setStatus(
    enabled
      ? "Finger drawing is on. One finger draws; two fingers pan and pinch-zoom."
      : "Finger drawing is off. Apple Pencil/mouse draws; fingers pan and pinch-zoom."
  );
}

function zoomAroundScreenPoint(nextScale, screenX, screenY) {
  const worldX = (screenX - view.offsetX) / view.scale;
  const worldY = (screenY - view.offsetY) / view.scale;

  view.scale = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);
  view.offsetX = screenX - worldX * view.scale;
  view.offsetY = screenY - worldY * view.scale;

  updateZoomOutput();
  redrawCanvas();
}

function zoomFromCenter(multiplier) {
  const rect = canvas.getBoundingClientRect();
  zoomAroundScreenPoint(
    view.scale * multiplier,
    rect.width / 2,
    rect.height / 2
  );
}

function resetZoom() {
  view.scale = 1;
  view.offsetX = 0;
  view.offsetY = 0;
  updateZoomOutput();
  redrawCanvas();
}

penToolButton.addEventListener("click", () => setTool("pen"));
eraserToolButton.addEventListener("click", () => setTool("eraser"));
fingerDrawInput.addEventListener("change", () => {
  setFingerDrawEnabled(fingerDrawInput.checked);
});

penSizeInput.addEventListener("input", () => {
  currentPen.size = Number(penSizeInput.value);
  penSizeOutput.textContent = `${currentPen.size} px`;
});

eraserSizeInput.addEventListener("input", () => {
  currentEraser.size = Number(eraserSizeInput.value);
  eraserSizeOutput.textContent = `${currentEraser.size} px`;
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

canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerEnd);
canvas.addEventListener("pointercancel", handlePointerEnd);

addPageButton.addEventListener("click", () => {
  const note = getActiveNote();
  if (!note) return;
  note.pages.push(blankPage());
  activePageIndex = note.pages.length - 1;
  resetZoom();
  renderPagesList();
  redrawCanvas();
  scheduleAutosave();
});

deletePageButton.addEventListener("click", () => {
  const note = getActiveNote();
  if (!note || note.pages.length <= 1) return;

  const pageNumber = activePageIndex + 1;
  const confirmed = confirm(`Delete Page ${pageNumber}? This cannot be undone.`);
  if (!confirmed) return;

  note.pages.splice(activePageIndex, 1);
  activePageIndex = Math.min(activePageIndex, note.pages.length - 1);

  resetZoom();
  renderPagesList();
  redrawCanvas();
  updateButtons();
  scheduleAutosave();
  setStatus(`Deleted Page ${pageNumber}.`);
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
  resetZoom();
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
  resetZoom();
  renderAll();
  setStatus("Deleted note.");
});

undoButton.addEventListener("click", () => {
  const page = getActivePage();
  if (!page || page.strokes.length === 0) return;

  const stroke = page.strokes.pop();
  page.redoStrokes.push(stroke);

  redrawCanvas();
  updateButtons();
  scheduleAutosave();
});

redoButton.addEventListener("click", () => {
  const page = getActivePage();
  if (!page || page.redoStrokes.length === 0) return;

  const stroke = page.redoStrokes.pop();
  page.strokes.push(stroke);

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
  page.redoStrokes = [];

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

exportPngButton.addEventListener("click", () => {
  exportCurrentPageAsPng().catch(error => {
    console.error(error);
    setStatus("Could not export PNG.");
  });
});

exportPdfButton.addEventListener("click", () => {
  exportNoteAsPdf().catch(error => {
    console.error(error);
    setStatus("Could not export PDF.");
  });
});

zoomOutButton.addEventListener("click", () => zoomFromCenter(0.8));
zoomInButton.addEventListener("click", () => zoomFromCenter(1.25));
resetZoomButton.addEventListener("click", resetZoom);

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
    installSafariGestureGuards();

    db = await openDb();
    await loadInitialNotes();
    setColor("#000000");
    fingerDrawInput.checked = fingerDrawEnabled;
    penSizeOutput.textContent = `${currentPen.size} px`;
    eraserSizeOutput.textContent = `${currentEraser.size} px`;
    updateZoomOutput();

    setStatus(
      fingerDrawEnabled
        ? "Ready. Finger drawing is on; two fingers pan and pinch-zoom."
        : "Ready. Apple Pencil/mouse draws; fingers pan and pinch-zoom."
    );
    await registerServiceWorker();
  } catch (error) {
    console.error(error);
    setStatus("The app could not start. Check browser storage permissions.");
  }
}

function installSafariGestureGuards() {
  let lastTouchEndTime = 0;

  document.addEventListener("touchend", event => {
    const now = Date.now();

    if (now - lastTouchEndTime <= 350) {
      event.preventDefault();
    }

    lastTouchEndTime = now;
  }, { passive: false });

  document.addEventListener("gesturestart", event => {
    event.preventDefault();
  }, { passive: false });

  document.addEventListener("gesturechange", event => {
    event.preventDefault();
  }, { passive: false });

  document.addEventListener("gestureend", event => {
    event.preventDefault();
  }, { passive: false });
}

main();