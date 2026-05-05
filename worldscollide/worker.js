import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.mjs";

let pyodide = null;
let initialized = false;

const COMPUTE_CONFIG_CODE = `
import json
import shlex
from nlwc import (
  ParsedRequest,
  parse_presets,
  parse_prompt,
  normalize_flag_tokens,
  objective_string,
)

body = json.loads(wasm_payload_json)

def _read_optional_int(value):
  if value is None:
    return None
  text = str(value).strip()
  if not text:
    return None
  return int(text)

def _safe_bool(value, default=False):
  if value is None:
    return default
  return bool(value)

def _preset_mode(flags):
  has_open = "-open" in flags
  has_cg = "-cg" in flags
  if has_open and not has_cg:
    return "open-world"
  if has_cg and not has_open:
    return "character-gating"
  return "mixed"

preset_list = body.get("presets") or []
prompt = body.get("prompt") or ""
extra_flags = body.get("extraFlags") or ""
seed = (body.get("seed") or "").strip()
include_objectives = _safe_bool(body.get("includeObjectives"), False)
no_rom_output = _safe_bool(body.get("noRomOutput"), False)
stdout_log = _safe_bool(body.get("stdoutLog"), True)

preset_parsed = parse_presets([",".join(preset_list)]) if preset_list else ParsedRequest([], [])
prompt_parsed = parse_prompt(prompt) if prompt else ParsedRequest([], [])

merged_notes = preset_parsed.notes + prompt_parsed.notes
merged_flags = preset_parsed.flags + prompt_parsed.flags

def _append_start_resource(raw, low, high, flag, note_label):
  value = _read_optional_int(raw)
  if value is None:
    return
  clamped = max(low, min(high, int(value)))
  merged_flags.extend([flag, str(clamped)])
  merged_notes.append(f"{note_label}: {clamped}")

_append_start_resource(body.get("startGold"), 0, 999999, "-gp", "Starting gold")
_append_start_resource(body.get("startMoogleCharms"), 0, 3, "-smc", "Starting moogle charms")
_append_start_resource(body.get("startWarpStones"), 0, 10, "-sws", "Starting warp stones")
_append_start_resource(body.get("startFenixDowns"), 0, 10, "-sfd", "Starting fenix downs")
_append_start_resource(body.get("startTools"), 0, 8, "-sto", "Starting tools")

normalized_flags = normalize_flag_tokens(merged_flags)

has_objectives = any(flag in normalized_flags for flag in ["-oa", "-ob", "-oc", "-od", "-oe"])
if include_objectives and not has_objectives:
  merged_flags.extend(["-oa", objective_string(2, 1, 1, [[2, 6, 10]])])
  merged_flags.append("-sl")
  merged_notes.append("Objectives: default objective profile enabled")
  normalized_flags = normalize_flag_tokens(merged_flags)

if extra_flags:
  normalized_flags = normalize_flag_tokens(normalized_flags + shlex.split(extra_flags))

display_command = ["python", "wc.py", "-i", "input.smc", "-o", "output.smc"]
if seed:
  display_command.extend(["-s", seed])
if no_rom_output:
  display_command.append("-nro")
if stdout_log:
  display_command.append("-slog")
display_command.extend(normalized_flags)

wasm_result_json = json.dumps({
  "notes": merged_notes,
  "flags": normalized_flags,
  "seed": seed,
  "noRomOutput": no_rom_output,
  "stdoutLog": stdout_log,
  "command": display_command,
  "commandText": " ".join(shlex.quote(part) for part in display_command),
})
`;

const PRESETS_CODE = `
import json
from nlwc import PRESETS

def _preset_mode(flags):
  has_open = "-open" in flags
  has_cg = "-cg" in flags
  if has_open and not has_cg:
    return "open-world"
  if has_cg and not has_open:
    return "character-gating"
  return "mixed"

presets = []
for preset in sorted(PRESETS.values(), key=lambda p: p.name):
  presets.append({
    "name": preset.name,
    "description": preset.description,
    "flags": preset.flags,
    "mode": _preset_mode(preset.flags),
  })

wasm_result_json = json.dumps({"presets": presets})
`;

function postStatus(message) {
  self.postMessage({ type: "status", message });
}

function ensureParentDirs(fs, absolutePath) {
  const parts = absolutePath.split("/").filter(Boolean);
  let current = "";
  for (let i = 0; i < parts.length - 1; i += 1) {
    current += `/${parts[i]}`;
    try {
      fs.mkdir(current);
    } catch {
      // already exists
    }
  }
}

async function loadPythonSourceBundle() {
  postStatus("Loading python source manifest...");
  const manifestResponse = await fetch("./python-manifest.json");
  if (!manifestResponse.ok) {
    throw new Error(`Failed to load python manifest (${manifestResponse.status})`);
  }

  const manifest = await manifestResponse.json();
  const files = manifest.files || [];
  if (!files.length) {
    throw new Error("python-manifest.json has no files");
  }

  postStatus(`Fetching ${files.length} python files...`);
  for (let i = 0; i < files.length; i += 1) {
    const rel = files[i];
    const response = await fetch(`./python-src/${rel}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${rel} (${response.status})`);
    }

    const text = await response.text();
    const dest = `/workspace/worldscollide/${rel}`;
    ensureParentDirs(pyodide.FS, dest);
    pyodide.FS.writeFile(dest, text, { encoding: "utf8" });

    if ((i + 1) % 60 === 0 || i + 1 === files.length) {
      postStatus(`Loaded ${i + 1}/${files.length} python files`);
    }
  }
}

async function loadExtraPythonFiles() {
  const extraFiles = ["nlwc.py"];

  for (const rel of extraFiles) {
    const response = await fetch(`./python-src/${rel}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${rel} (${response.status})`);
    }
    const text = await response.text();
    const dest = `/workspace/worldscollide/${rel}`;
    ensureParentDirs(pyodide.FS, dest);
    pyodide.FS.writeFile(dest, text, { encoding: "utf8" });
  }

  postStatus(`Loaded ${extraFiles.length} extra python files`);
}

async function loadAssetBundle() {
  postStatus("Loading asset manifest...");
  const manifestResponse = await fetch("./asset-manifest.json");
  if (!manifestResponse.ok) {
    throw new Error(`Failed to load asset manifest (${manifestResponse.status})`);
  }

  const manifest = await manifestResponse.json();
  const files = manifest.files || [];

  for (let i = 0; i < files.length; i += 1) {
    const rel = files[i];
    const response = await fetch(`./assets/${rel}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch asset ${rel} (${response.status})`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const dest = `/workspace/worldscollide/${rel}`;
    ensureParentDirs(pyodide.FS, dest);
    pyodide.FS.writeFile(dest, bytes, { encoding: "binary" });
  }

  postStatus(`Loaded ${files.length} asset files`);
}

async function initialize() {
  if (initialized) {
    return;
  }

  postStatus("Loading Pyodide runtime...");
  pyodide = await loadPyodide({});

  try {
    pyodide.FS.mkdir("/workspace");
  } catch {
    // ignore
  }

  await loadPythonSourceBundle();
  await loadExtraPythonFiles();
  await loadAssetBundle();

  await pyodide.runPythonAsync(`
import os
import sys
os.chdir("/workspace/worldscollide")
sys.path.insert(0, "/workspace/worldscollide")
`);

  initialized = true;
  self.postMessage({ type: "ready" });
}

async function computeConfig(payload) {
  pyodide.globals.set("wasm_payload_json", JSON.stringify(payload || {}));
  await pyodide.runPythonAsync(COMPUTE_CONFIG_CODE);
  const raw = pyodide.globals.get("wasm_result_json");
  return JSON.parse(raw);
}

async function listPresets() {
  if (!initialized) {
    await initialize();
  }

  await pyodide.runPythonAsync(PRESETS_CODE);
  const raw = pyodide.globals.get("wasm_result_json");
  const parsed = JSON.parse(raw);
  self.postMessage({ type: "presets", presets: parsed.presets || [] });
}

async function compilePayload(payload) {
  if (!initialized) {
    await initialize();
  }

  postStatus("Compiling request to wc.py flags...");
  const compiled = await computeConfig(payload);
  self.postMessage({ type: "compiled", ...compiled });
}

async function generateRom(payload) {
  if (!initialized) {
    await initialize();
  }

  const romBuffer = payload.romBuffer;
  const outputName = payload.outputName || "worlds_collide_output.smc";

  if (!romBuffer) {
    throw new Error("Missing ROM bytes");
  }

  const compiled = await computeConfig(payload);

  postStatus("Preparing generation environment...");
  pyodide.FS.writeFile("/workspace/input.smc", new Uint8Array(romBuffer), { encoding: "binary" });

  try {
    pyodide.FS.unlink("/workspace/output.smc");
  } catch {
    // ignore
  }

  pyodide.globals.set("wasm_flags_json", JSON.stringify(compiled.flags || []));
  pyodide.globals.set("wasm_seed", compiled.seed || "");

  postStatus("Running wc.py...");
  await pyodide.runPythonAsync(`
import io
import json
import runpy
import sys
from contextlib import redirect_stderr, redirect_stdout

roots_to_clear = {
    "args", "log", "memory", "data", "custom_hacks", "event", "add_ons",
    "menus", "battle", "settings", "bug_fixes", "objectives", "constants",
    "graphics", "instruction", "utils", "seed", "sprite_hash", "version", "wc",
}

for module_name in list(sys.modules.keys()):
    if module_name.split(".")[0] in roots_to_clear:
        del sys.modules[module_name]

raw_tokens = list(json.loads(wasm_flags_json))

argv = ["wc.py", "-i", "/workspace/input.smc", "-o", "/workspace/output.smc"]
if wasm_seed:
    argv.extend(["-s", wasm_seed])

filtered_tokens = []
skip_next = False
for token in raw_tokens:
  if skip_next:
    skip_next = False
    continue

  if token in ("-i", "-o"):
    skip_next = True
    continue

  if token == "-nro":
    continue

  filtered_tokens.append(token)

argv.extend(filtered_tokens)

sys.argv = argv
stdout_buffer = io.StringIO()
stderr_buffer = io.StringIO()

with redirect_stdout(stdout_buffer), redirect_stderr(stderr_buffer):
  runpy.run_path("/workspace/worldscollide/wc.py", run_name="__main__")

wasm_run_stdout = stdout_buffer.getvalue()
wasm_run_stderr = stderr_buffer.getvalue()
`);

  postStatus("Reading output ROM...");
  const outputBytes = pyodide.FS.readFile("/workspace/output.smc", { encoding: "binary" });
  const stdout = pyodide.globals.get("wasm_run_stdout") || "";
  const stderr = pyodide.globals.get("wasm_run_stderr") || "";

  self.postMessage(
    {
      type: "generated",
      romBuffer: outputBytes.buffer,
      size: outputBytes.byteLength,
      fileName: outputName,
    notes: compiled.notes || [],
    commandText: compiled.commandText || "",
    stdout,
    stderr,
    },
    [outputBytes.buffer]
  );
}

self.onmessage = async (event) => {
  const message = event.data || {};

  try {
    if (message.type === "init") {
      await initialize();
      return;
    }

    if (message.type === "generate") {
      await generateRom(message);
      return;
    }

    if (message.type === "compile") {
      await compilePayload(message);
      return;
    }

    if (message.type === "presets") {
      await listPresets();
      return;
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: String(error?.message || error),
    });
  }
};
