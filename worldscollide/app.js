const els = {
  romFile: document.getElementById("romFile"),
  dropZone: document.getElementById("dropZone"),
  romMeta: document.getElementById("romMeta"),
  seed: document.getElementById("seed"),
  flags: document.getElementById("flags"),
  outputName: document.getElementById("outputName"),
  generateBtn: document.getElementById("generateBtn"),
  downloadLink: document.getElementById("downloadLink"),
  statusLog: document.getElementById("statusLog"),
};

const state = {
  workerReady: false,
  selectedFile: null,
  downloadUrl: null,
  runInProgress: false,
};

const worker = new Worker("./worker.js", { type: "module" });

function appendStatus(text) {
  const ts = new Date().toLocaleTimeString();
  els.statusLog.textContent += `[${ts}] ${text}\n`;
  els.statusLog.scrollTop = els.statusLog.scrollHeight;
}

function updateGenerateButton() {
  const canRun = state.workerReady && !!state.selectedFile && !state.runInProgress;
  els.generateBtn.disabled = !canRun;
  if (!state.workerReady) {
    els.generateBtn.textContent = "Loading runtime...";
  } else if (state.runInProgress) {
    els.generateBtn.textContent = "Generating...";
  } else {
    els.generateBtn.textContent = "Generate ROM";
  }
}

function updateRomMeta() {
  if (!state.selectedFile) {
    els.romMeta.textContent = "No ROM selected.";
    return;
  }

  const mb = (state.selectedFile.size / (1024 * 1024)).toFixed(2);
  els.romMeta.textContent = `${state.selectedFile.name} (${mb} MB)`;

  if (!els.outputName.value.trim()) {
    const dot = state.selectedFile.name.lastIndexOf(".");
    if (dot > 0) {
      els.outputName.value = `${state.selectedFile.name.slice(0, dot)}_wc${state.selectedFile.name.slice(dot)}`;
    } else {
      els.outputName.value = `${state.selectedFile.name}_wc.smc`;
    }
  }
}

function setSelectedFile(file) {
  state.selectedFile = file;
  updateRomMeta();
  updateGenerateButton();
}

function clearDownload() {
  if (state.downloadUrl) {
    URL.revokeObjectURL(state.downloadUrl);
    state.downloadUrl = null;
  }
  els.downloadLink.classList.add("hidden");
  els.downloadLink.removeAttribute("href");
}

els.romFile.addEventListener("change", () => {
  const file = els.romFile.files?.[0] || null;
  if (file) {
    appendStatus(`Selected ROM via picker: ${file.name}`);
  }
  clearDownload();
  setSelectedFile(file);
});

els.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.dropZone.classList.add("active");
});

els.dropZone.addEventListener("dragleave", () => {
  els.dropZone.classList.remove("active");
});

els.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  els.dropZone.classList.remove("active");
  const file = event.dataTransfer?.files?.[0] || null;
  if (!file) {
    return;
  }

  appendStatus(`Selected ROM via drag/drop: ${file.name}`);
  clearDownload();
  setSelectedFile(file);
});

worker.onmessage = (event) => {
  const msg = event.data;

  if (msg.type === "status") {
    appendStatus(msg.message);
    return;
  }

  if (msg.type === "ready") {
    state.workerReady = true;
    appendStatus("Pyodide runtime ready.");
    updateGenerateButton();
    return;
  }

  if (msg.type === "error") {
    state.runInProgress = false;
    appendStatus(`ERROR: ${msg.message}`);
    updateGenerateButton();
    return;
  }

  if (msg.type === "generated") {
    state.runInProgress = false;
    appendStatus(`Generation complete (${msg.size} bytes).`);

    const blob = new Blob([msg.romBuffer], { type: "application/octet-stream" });
    state.downloadUrl = URL.createObjectURL(blob);
    els.downloadLink.href = state.downloadUrl;
    els.downloadLink.download = msg.fileName || "worlds_collide_output.smc";
    els.downloadLink.classList.remove("hidden");
    updateGenerateButton();
  }
};

els.generateBtn.addEventListener("click", async () => {
  if (!state.selectedFile || !state.workerReady || state.runInProgress) {
    return;
  }

  clearDownload();
  state.runInProgress = true;
  updateGenerateButton();
  appendStatus("Reading ROM file...");

  const romBuffer = await state.selectedFile.arrayBuffer();
  const outputName = (els.outputName.value || "worlds_collide_output.smc").trim();

  worker.postMessage(
    {
      type: "generate",
      romBuffer,
      flags: els.flags.value || "",
      seed: (els.seed.value || "").trim(),
      outputName,
    },
    [romBuffer]
  );
});

appendStatus("Starting worker...");
worker.postMessage({ type: "init" });
