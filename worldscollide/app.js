const els = {
  romFile: document.getElementById("romFile"),
  dropZone: document.getElementById("dropZone"),
  romMeta: document.getElementById("romMeta"),
  seed: document.getElementById("seed"),
  outputName: document.getElementById("outputName"),
  prompt: document.getElementById("prompt"),
  extraFlags: document.getElementById("extraFlags"),
  startGold: document.getElementById("startGold"),
  startMoogleCharms: document.getElementById("startMoogleCharms"),
  startWarpStones: document.getElementById("startWarpStones"),
  startFenixDowns: document.getElementById("startFenixDowns"),
  startTools: document.getElementById("startTools"),
  includeObjectives: document.getElementById("includeObjectives"),
  noRomOutput: document.getElementById("noRomOutput"),
  stdoutLog: document.getElementById("stdoutLog"),
  presetList: document.getElementById("presetList"),
  presetModeFilter: document.getElementById("presetModeFilter"),
  compileBtn: document.getElementById("compileBtn"),
  generateBtn: document.getElementById("generateBtn"),
  downloadLink: document.getElementById("downloadLink"),
  notes: document.getElementById("notes"),
  command: document.getElementById("command"),
  result: document.getElementById("result"),
  statusLog: document.getElementById("statusLog"),
};

const state = {
  workerReady: false,
  selectedFile: null,
  downloadUrl: null,
  runInProgress: false,
  presets: [],
};

const worker = new Worker("./worker.js", { type: "module" });

function appendStatus(text) {
  const ts = new Date().toLocaleTimeString();
  els.statusLog.textContent += `[${ts}] ${text}\n`;
  els.statusLog.scrollTop = els.statusLog.scrollHeight;
}

function renderResult(text) {
  els.result.textContent = text || "";
}

function renderNotes(notes) {
  els.notes.innerHTML = "";
  if (!notes || !notes.length) {
    const li = document.createElement("li");
    li.textContent = "No notes generated.";
    els.notes.appendChild(li);
    return;
  }

  for (const note of notes) {
    const li = document.createElement("li");
    li.textContent = note;
    els.notes.appendChild(li);
  }
}

function updateGenerateButton() {
  const canRun = state.workerReady && !!state.selectedFile && !state.runInProgress;
  els.generateBtn.disabled = !canRun;
  els.compileBtn.disabled = !state.workerReady || state.runInProgress;

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

function selectedPresets() {
  return [...document.querySelectorAll("input[name='preset']:checked")].map((x) => x.value);
}

function readOptionalInt(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const parsed = Number.parseInt(text, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function requestPayload() {
  return {
    seed: (els.seed.value || "").trim(),
    prompt: els.prompt.value || "",
    extraFlags: els.extraFlags.value || "",
    startGold: readOptionalInt(els.startGold.value),
    startMoogleCharms: readOptionalInt(els.startMoogleCharms.value),
    startWarpStones: readOptionalInt(els.startWarpStones.value),
    startFenixDowns: readOptionalInt(els.startFenixDowns.value),
    startTools: readOptionalInt(els.startTools.value),
    includeObjectives: !!els.includeObjectives.checked,
    noRomOutput: !!els.noRomOutput.checked,
    stdoutLog: !!els.stdoutLog.checked,
    presets: selectedPresets(),
  };
}

function renderPresetList() {
  const selected = new Set(selectedPresets());
  const filter = els.presetModeFilter.value || "all";
  els.presetList.innerHTML = "";

  for (const preset of state.presets) {
    if (filter !== "all" && (preset.mode || "mixed") !== filter) {
      continue;
    }

    const wrap = document.createElement("div");
    wrap.className = "preset-item";

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "preset";
    checkbox.value = preset.name;
    checkbox.checked = selected.has(preset.name);
    label.appendChild(checkbox);

    const modeSuffix = preset.mode ? ` [${preset.mode}]` : "";
    label.append(` ${preset.name}${modeSuffix}`);

    const desc = document.createElement("p");
    desc.className = "subtle";
    desc.textContent = preset.description;

    wrap.appendChild(label);
    wrap.appendChild(desc);
    els.presetList.appendChild(wrap);
  }
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

els.presetModeFilter.addEventListener("change", renderPresetList);

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
    worker.postMessage({ type: "presets" });
    return;
  }

  if (msg.type === "presets") {
    state.presets = msg.presets || [];
    renderPresetList();
    appendStatus(`Loaded ${state.presets.length} presets.`);
    return;
  }

  if (msg.type === "compiled") {
    renderNotes(msg.notes || []);
    els.command.textContent = msg.commandText || "";
    renderResult("Compile successful.");
    appendStatus("Compile complete.");
    return;
  }

  if (msg.type === "error") {
    state.runInProgress = false;
    renderResult(`Error: ${msg.message}`);
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

    renderNotes(msg.notes || []);
    els.command.textContent = msg.commandText || "";
    const output = [
      "Generation finished.",
      "",
      "STDOUT:",
      msg.stdout || "",
      "",
      "STDERR:",
      msg.stderr || "",
    ].join("\n");
    renderResult(output);
    updateGenerateButton();
  }
};

els.compileBtn.addEventListener("click", () => {
  if (!state.workerReady || state.runInProgress) {
    return;
  }
  renderResult("Compiling...");
  worker.postMessage({ type: "compile", ...requestPayload() });
});

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
      outputName,
      ...requestPayload(),
    },
    [romBuffer]
  );
});

appendStatus("Starting worker...");
worker.postMessage({ type: "init" });
updateGenerateButton();
