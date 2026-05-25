const personUpload = document.getElementById("person-upload");
const referenceUpload = document.getElementById("reference-upload");
const personPreview = document.getElementById("person-preview");
const referencePreview = document.getElementById("reference-preview");
const resultPreview = document.getElementById("result-preview");
const personPlaceholder = document.getElementById("person-placeholder");
const referencePlaceholder = document.getElementById("reference-placeholder");
const resultPlaceholder = document.getElementById("result-placeholder");
const personFrame = personPreview.closest(".preview-frame");
const referenceFrame = referencePreview.closest(".preview-frame");
const resultFrame = resultPreview.closest(".preview-frame");
const personCameraStart = document.getElementById("person-camera-start");
const personCameraCapture = document.getElementById("person-camera-capture");
const personCameraStop = document.getElementById("person-camera-stop");
const referenceCameraStart = document.getElementById("reference-camera-start");
const referenceCameraCapture = document.getElementById("reference-camera-capture");
const referenceCameraStop = document.getElementById("reference-camera-stop");
const personVideo = document.getElementById("person-video");
const referenceVideo = document.getElementById("reference-video");
const garmentType = document.getElementById("garment-type");
const outputAspectRatio = document.getElementById("output-aspect-ratio");
const backgroundPreservation = document.getElementById("background-preservation");
const changeStrength = document.getElementById("change-strength");
const changeStrengthValue = document.getElementById("change-strength-value");
const stylePrompt = document.getElementById("style-prompt");
const generateButton = document.getElementById("generate-button");
const downloadResultButton = document.getElementById("download-result");
const historyGallery = document.getElementById("history-gallery");
const historyPlaceholder = document.getElementById("history-placeholder");
const generationStatus = document.getElementById("generation-status");
const serverStatus = document.getElementById("server-status");
const vintedCategory = document.getElementById("vinted-category");
const loadVintedItemsButton = document.getElementById("load-vinted-items");
const vintedGallery = document.getElementById("vinted-gallery");
const vintedStatus = document.getElementById("vinted-status");

const MAX_HISTORY_ITEMS = 12;

const appState = {
  personImageDataUrl: null,
  referenceImageDataUrl: null,
  resultImageDataUrl: null,
  history: [],
  streams: {
    person: null,
    reference: null,
  },
  vinted: {
    items: [],
    selectedItemId: null,
    loadingSelection: false,
  },
};

function setPreview({ frame, imageElement, placeholderElement }, dataUrl) {
  if (!dataUrl) {
    imageElement.removeAttribute("src");
    frame.classList.remove("has-image");
    placeholderElement.style.display = "block";
    return;
  }

  imageElement.src = dataUrl;
  frame.classList.add("has-image");
  placeholderElement.style.display = "none";
}

function formatFilenameTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

async function handleFileUpload(fileInput, target) {
  const selectedFile = fileInput.files?.[0];
  if (!selectedFile) {
    return;
  }

  try {
    const dataUrl = await fileToDataUrl(selectedFile);
    appState[target] = dataUrl;
    if (target === "referenceImageDataUrl") {
      appState.vinted.selectedItemId = null;
      renderVintedGallery();
      vintedStatus.textContent = "Using your uploaded outfit image as reference.";
    }
    updateInputsPreview();
  } catch (error) {
    generationStatus.textContent = `Upload failed: ${error.message}`;
  }
}

function getVideoElement(side) {
  return side === "person" ? personVideo : referenceVideo;
}

function getCameraButtons(side) {
  if (side === "person") {
    return {
      start: personCameraStart,
      capture: personCameraCapture,
      stop: personCameraStop,
    };
  }

  return {
    start: referenceCameraStart,
    capture: referenceCameraCapture,
    stop: referenceCameraStop,
  };
}

async function startCamera(side) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    generationStatus.textContent = "Camera access is not supported in this browser.";
    return;
  }

  const existingStream = appState.streams[side];
  if (existingStream) {
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    appState.streams[side] = stream;

    const video = getVideoElement(side);
    const buttons = getCameraButtons(side);
    video.srcObject = stream;
    video.classList.add("active");
    buttons.start.disabled = true;
    buttons.capture.disabled = false;
    buttons.stop.disabled = false;
    generationStatus.textContent = `Camera ready for ${side === "person" ? "your photo" : "reference image"}.`;
  } catch (error) {
    generationStatus.textContent = `Could not start camera: ${error.message}`;
  }
}

function stopCamera(side) {
  const stream = appState.streams[side];
  const video = getVideoElement(side);
  const buttons = getCameraButtons(side);

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    appState.streams[side] = null;
  }

  video.srcObject = null;
  video.classList.remove("active");
  buttons.start.disabled = false;
  buttons.capture.disabled = true;
  buttons.stop.disabled = true;
}

function captureFromCamera(side) {
  const video = getVideoElement(side);
  if (!video.videoWidth || !video.videoHeight) {
    generationStatus.textContent = "Camera is not ready to capture yet.";
    return;
  }

  const captureCanvas = document.createElement("canvas");
  captureCanvas.width = video.videoWidth;
  captureCanvas.height = video.videoHeight;
  const captureContext = captureCanvas.getContext("2d");
  if (!captureContext) {
    generationStatus.textContent = "Unable to capture image.";
    return;
  }

  captureContext.drawImage(video, 0, 0);
  const capturedDataUrl = captureCanvas.toDataURL("image/png");
  if (side === "person") {
    appState.personImageDataUrl = capturedDataUrl;
  } else {
    appState.referenceImageDataUrl = capturedDataUrl;
    appState.vinted.selectedItemId = null;
    renderVintedGallery();
    vintedStatus.textContent = "Using your camera capture as reference.";
  }

  updateInputsPreview();
  stopCamera(side);
  generationStatus.textContent = `${side === "person" ? "Your photo" : "Reference image"} captured.`;
}

function updateInputsPreview() {
  setPreview(
    { frame: personFrame, imageElement: personPreview, placeholderElement: personPlaceholder },
    appState.personImageDataUrl
  );
  setPreview(
    { frame: referenceFrame, imageElement: referencePreview, placeholderElement: referencePlaceholder },
    appState.referenceImageDataUrl
  );
}

function updateResultPreview(dataUrl) {
  appState.resultImageDataUrl = dataUrl;
  setPreview(
    { frame: resultFrame, imageElement: resultPreview, placeholderElement: resultPlaceholder },
    appState.resultImageDataUrl
  );
  downloadResultButton.disabled = !appState.resultImageDataUrl;
}

function updateChangeStrengthLabel() {
  changeStrengthValue.textContent = `${changeStrength.value}%`;
}

function mapCategoryToGarmentType(category) {
  if (category === "hat") {
    return "hat";
  }
  if (category === "trousers") {
    return "trousers";
  }
  if (category === "dresses") {
    return "dress";
  }
  return "shirt";
}

function renderVintedGallery() {
  vintedGallery.innerHTML = "";

  if (!appState.vinted.items.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "vinted-empty";
    emptyState.textContent = "No Vinted thumbnails loaded yet.";
    vintedGallery.appendChild(emptyState);
    return;
  }

  appState.vinted.items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "vinted-item";

    const image = document.createElement("img");
    image.src = item.thumbnailUrl;
    image.alt = item.alt || `${item.title} on Vinted`;
    card.appendChild(image);

    const title = document.createElement("p");
    title.className = "vinted-item-title";
    title.textContent = item.title || "Vinted garment";
    card.appendChild(title);

    if (item.price || item.subtitle) {
      const meta = document.createElement("p");
      meta.className = "vinted-item-meta";
      meta.textContent = [item.price, item.subtitle].filter(Boolean).join(" • ");
      card.appendChild(meta);
    }

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.textContent = appState.vinted.selectedItemId === item.id ? "Selected" : "Use as Reference";
    selectButton.classList.toggle("active", appState.vinted.selectedItemId === item.id);
    selectButton.disabled = appState.vinted.loadingSelection;
    selectButton.addEventListener("click", () => {
      useVintedItemAsReference(item.id);
    });
    card.appendChild(selectButton);

    vintedGallery.appendChild(card);
  });
}

async function loadVintedItems() {
  loadVintedItemsButton.disabled = true;
  vintedStatus.textContent = "Loading Vinted thumbnails...";

  try {
    const selectedCategory = vintedCategory.value || "shirts-tops";
    garmentType.value = mapCategoryToGarmentType(selectedCategory);

    const response = await fetch(
      `/api/vinted-garments?category=${encodeURIComponent(selectedCategory)}&limit=${MAX_HISTORY_ITEMS}`
    );
    const responseBody = await response.json();

    if (!response.ok) {
      throw new Error(responseBody.error || `HTTP ${response.status}`);
    }

    appState.vinted.items = Array.isArray(responseBody.items) ? responseBody.items : [];
    appState.vinted.selectedItemId = null;
    renderVintedGallery();
    vintedStatus.textContent = appState.vinted.items.length
      ? `Loaded ${appState.vinted.items.length} ${responseBody.categoryLabel || "items"} thumbnails.`
      : "No thumbnails were found for this category.";
  } catch (error) {
    appState.vinted.items = [];
    appState.vinted.selectedItemId = null;
    renderVintedGallery();
    vintedStatus.textContent = `Could not load Vinted items: ${error.message}`;
  } finally {
    loadVintedItemsButton.disabled = false;
  }
}

async function useVintedItemAsReference(itemId) {
  const selectedItem = appState.vinted.items.find((item) => item.id === itemId);
  if (!selectedItem) {
    vintedStatus.textContent = "That Vinted item is no longer available.";
    return;
  }

  appState.vinted.loadingSelection = true;
  renderVintedGallery();
  vintedStatus.textContent = "Downloading selected Vinted item...";

  try {
    const response = await fetch(`/api/vinted-image-data-url?url=${encodeURIComponent(selectedItem.thumbnailUrl)}`);
    const responseBody = await response.json();
    if (!response.ok) {
      throw new Error(responseBody.error || `HTTP ${response.status}`);
    }
    if (!responseBody.dataUrl) {
      throw new Error("No image data was returned.");
    }

    appState.referenceImageDataUrl = responseBody.dataUrl;
    appState.vinted.selectedItemId = selectedItem.id;
    updateInputsPreview();
    generationStatus.textContent = `Reference image set from Vinted: ${selectedItem.title}.`;
    vintedStatus.textContent = "Vinted item selected and ready for try-on.";
  } catch (error) {
    vintedStatus.textContent = `Could not use selected Vinted item: ${error.message}`;
  } finally {
    appState.vinted.loadingSelection = false;
    renderVintedGallery();
  }
}

function addHistoryEntry(dataUrl, metadata) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    dataUrl,
    createdAt: new Date(),
    metadata,
  };
  appState.history.unshift(entry);
  if (appState.history.length > MAX_HISTORY_ITEMS) {
    appState.history.length = MAX_HISTORY_ITEMS;
  }
  renderHistoryGallery();
}

function renderHistoryGallery() {
  historyGallery.innerHTML = "";
  historyPlaceholder.style.display = appState.history.length ? "none" : "block";

  appState.history.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "history-item";

    const image = document.createElement("img");
    image.src = entry.dataUrl;
    image.alt = "Previously generated virtual try-on image";
    item.appendChild(image);

    const details = document.createElement("p");
    const timeLabel = entry.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    details.textContent = `${entry.metadata.garment} • ${entry.metadata.aspectRatioLabel} • ${timeLabel}`;
    item.appendChild(details);

    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.textContent = "Download";
    downloadButton.addEventListener("click", () => {
      downloadDataUrl(entry.dataUrl, `try-on-${formatFilenameTimestamp(entry.createdAt)}.png`);
    });
    item.appendChild(downloadButton);

    historyGallery.appendChild(item);
  });
}

async function generateTryOn() {
  if (!appState.personImageDataUrl || !appState.referenceImageDataUrl) {
    generationStatus.textContent = "Please provide both your photo and a reference outfit image.";
    return;
  }

  generateButton.disabled = true;
  generationStatus.textContent = "Generating image with OpenAI... this can take up to a minute.";

  try {
    const response = await fetch("/api/virtual-try-on", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personImageDataUrl: appState.personImageDataUrl,
        referenceImageDataUrl: appState.referenceImageDataUrl,
        garmentType: garmentType.value,
        outputAspectRatio: outputAspectRatio.value,
        backgroundPreservation: backgroundPreservation.value,
        changeStrength: Number(changeStrength.value),
        prompt: stylePrompt.value.trim(),
      }),
    });

    const responseBody = await response.json();

    if (!response.ok) {
      throw new Error(responseBody.error || `Request failed with HTTP ${response.status}`);
    }

    if (!responseBody.resultImageDataUrl) {
      throw new Error("No generated image was returned.");
    }

    updateResultPreview(responseBody.resultImageDataUrl);
    addHistoryEntry(responseBody.resultImageDataUrl, {
      garment: garmentType.value,
      aspectRatioLabel: outputAspectRatio.options[outputAspectRatio.selectedIndex]?.text || outputAspectRatio.value,
    });
    generationStatus.textContent = "Done! Your try-on image is ready.";
  } catch (error) {
    generationStatus.textContent = `Generation failed: ${error.message}`;
  } finally {
    generateButton.disabled = false;
  }
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

personUpload.addEventListener("change", () => handleFileUpload(personUpload, "personImageDataUrl"));
referenceUpload.addEventListener("change", () => handleFileUpload(referenceUpload, "referenceImageDataUrl"));
personCameraStart.addEventListener("click", () => startCamera("person"));
personCameraCapture.addEventListener("click", () => captureFromCamera("person"));
personCameraStop.addEventListener("click", () => stopCamera("person"));
referenceCameraStart.addEventListener("click", () => startCamera("reference"));
referenceCameraCapture.addEventListener("click", () => captureFromCamera("reference"));
referenceCameraStop.addEventListener("click", () => stopCamera("reference"));
changeStrength.addEventListener("input", updateChangeStrengthLabel);
generateButton.addEventListener("click", generateTryOn);
loadVintedItemsButton.addEventListener("click", loadVintedItems);
vintedCategory.addEventListener("change", () => {
  garmentType.value = mapCategoryToGarmentType(vintedCategory.value);
});
downloadResultButton.addEventListener("click", () => {
  if (!appState.resultImageDataUrl) {
    return;
  }
  downloadDataUrl(appState.resultImageDataUrl, `try-on-latest-${formatFilenameTimestamp()}.png`);
});
window.addEventListener("beforeunload", () => {
  stopCamera("person");
  stopCamera("reference");
});

updateInputsPreview();
updateResultPreview(null);
updateChangeStrengthLabel();
renderHistoryGallery();
renderVintedGallery();
loadStatus();
loadVintedItems();
