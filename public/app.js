const canvas = document.getElementById("drawing-canvas");
const context = canvas.getContext("2d");
const colorPicker = document.getElementById("color-picker");
const brushSizeInput = document.getElementById("brush-size");
const brushSizeValue = document.getElementById("brush-size-value");
const drawModeButton = document.getElementById("draw-mode");
const eraseModeButton = document.getElementById("erase-mode");
const clearCanvasButton = document.getElementById("clear-canvas");
const saveImageButton = document.getElementById("save-image");
const serverStatus = document.getElementById("server-status");

const drawingState = {
  active: false,
  lastX: 0,
  lastY: 0,
  mode: "draw",
};

function setupCanvasResolution() {
  let snapshot = null;
  if (canvas.width > 0 && canvas.height > 0) {
    snapshot = document.createElement("canvas");
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    const snapshotContext = snapshot.getContext("2d");
    if (snapshotContext) {
      snapshotContext.drawImage(canvas, 0, 0);
    }
  }

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, rect.width, rect.height);

  if (snapshot) {
    context.drawImage(snapshot, 0, 0, snapshot.width, snapshot.height, 0, 0, rect.width, rect.height);
  }
}

function updateBrushSizeLabel() {
  brushSizeValue.textContent = `${brushSizeInput.value}px`;
}

function setMode(mode) {
  drawingState.mode = mode;
  const isDrawMode = mode === "draw";
  drawModeButton.classList.toggle("active", isDrawMode);
  eraseModeButton.classList.toggle("active", !isDrawMode);
}

function getCanvasCoordinates(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function drawLine(startX, startY, endX, endY) {
  context.strokeStyle = drawingState.mode === "draw" ? colorPicker.value : "#ffffff";
  context.lineWidth = Number(brushSizeInput.value);
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.stroke();
}

function startDrawing(event) {
  event.preventDefault();
  drawingState.active = true;
  const { x, y } = getCanvasCoordinates(event);
  drawingState.lastX = x;
  drawingState.lastY = y;
}

function continueDrawing(event) {
  if (!drawingState.active) {
    return;
  }

  event.preventDefault();
  const { x, y } = getCanvasCoordinates(event);
  drawLine(drawingState.lastX, drawingState.lastY, x, y);
  drawingState.lastX = x;
  drawingState.lastY = y;
}

function stopDrawing() {
  drawingState.active = false;
}

function clearCanvas() {
  const rect = canvas.getBoundingClientRect();
  context.clearRect(0, 0, rect.width, rect.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, rect.width, rect.height);
}

function saveCanvasAsImage() {
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = "drawing.png";
  link.click();
}

canvas.addEventListener("pointerdown", startDrawing);
canvas.addEventListener("pointermove", continueDrawing);
canvas.addEventListener("pointerup", stopDrawing);
canvas.addEventListener("pointerleave", stopDrawing);
canvas.addEventListener("pointercancel", stopDrawing);

brushSizeInput.addEventListener("input", updateBrushSizeLabel);
drawModeButton.addEventListener("click", () => setMode("draw"));
eraseModeButton.addEventListener("click", () => setMode("erase"));
clearCanvasButton.addEventListener("click", clearCanvas);
saveImageButton.addEventListener("click", saveCanvasAsImage);
window.addEventListener("resize", setupCanvasResolution);

function initializeDrawingApp() {
  setupCanvasResolution();
  updateBrushSizeLabel();
  setMode("draw");
}

async function loadStatus() {
  try {
    const response = await fetch("/api/health");

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    serverStatus.textContent = `Online - uptime ${data.uptimeSeconds}s`;
  } catch (error) {
    serverStatus.textContent = `Unavailable (${error.message})`;
  }
}

initializeDrawingApp();
loadStatus();
