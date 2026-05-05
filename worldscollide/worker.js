import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.mjs";

let pyodide = null;
let initialized = false;

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

async function generateRom(payload) {
  if (!initialized) {
    await initialize();
  }

  const romBuffer = payload.romBuffer;
  const flags = payload.flags || "";
  const seed = payload.seed || "";
  const outputName = payload.outputName || "worlds_collide_output.smc";

  if (!romBuffer) {
    throw new Error("Missing ROM bytes");
  }

  postStatus("Preparing generation environment...");
  pyodide.FS.writeFile("/workspace/input.smc", new Uint8Array(romBuffer), { encoding: "binary" });

  try {
    pyodide.FS.unlink("/workspace/output.smc");
  } catch {
    // ignore
  }

  pyodide.globals.set("wasm_flags", flags);
  pyodide.globals.set("wasm_seed", seed);

  postStatus("Running wc.py...");
  await pyodide.runPythonAsync(`
import runpy
import shlex
import sys

roots_to_clear = {
    "args", "log", "memory", "data", "custom_hacks", "event", "add_ons",
    "menus", "battle", "settings", "bug_fixes", "objectives", "constants",
    "graphics", "instruction", "utils", "seed", "sprite_hash", "version", "wc",
}

for module_name in list(sys.modules.keys()):
    if module_name.split(".")[0] in roots_to_clear:
        del sys.modules[module_name]

raw_tokens = shlex.split(wasm_flags)
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

argv = ["wc.py", "-i", "/workspace/input.smc", "-o", "/workspace/output.smc"]
if wasm_seed:
    argv.extend(["-s", wasm_seed])
argv.extend(filtered_tokens)

sys.argv = argv
runpy.run_path("/workspace/worldscollide/wc.py", run_name="__main__")
`);

  postStatus("Reading output ROM...");
  const outputBytes = pyodide.FS.readFile("/workspace/output.smc", { encoding: "binary" });

  self.postMessage(
    {
      type: "generated",
      romBuffer: outputBytes.buffer,
      size: outputBytes.byteLength,
      fileName: outputName,
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
  } catch (error) {
    self.postMessage({
      type: "error",
      message: String(error?.message || error),
    });
  }
};
