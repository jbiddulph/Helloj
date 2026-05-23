const noteForm = document.getElementById("note-form");
const noteInput = document.getElementById("note-input");
const noteList = document.getElementById("note-list");
const serverStatus = document.getElementById("server-status");

const notes = [];

function renderNotes() {
  noteList.innerHTML = "";

  if (notes.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = "No notes yet.";
    noteList.appendChild(emptyItem);
    return;
  }

  notes.forEach((note) => {
    const item = document.createElement("li");
    item.textContent = note;
    noteList.appendChild(item);
  });
}

noteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = noteInput.value.trim();

  if (!value) {
    return;
  }

  notes.push(value);
  noteInput.value = "";
  renderNotes();
});

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

renderNotes();
loadStatus();
