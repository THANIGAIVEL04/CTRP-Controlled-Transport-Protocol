"""
CTRP Protocol Visualizer - Unified Launcher
===========================================
Usage:  python run_ctrp.py

What it does:
  1. Checks Python dependencies (fastapi, uvicorn, websockets)
  2. Ensures the Rust backend compiles correctly
  3. Starts the FastAPI server
  4. Waits until port 8080 is ready
  5. Determines the active UI file
  6. Opens the correct UI page automatically
  7. Streams server logs to the terminal
"""

import os
import sys
import time
import socket
import subprocess
import threading
import webbrowser

# Paths
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
VISUALIZER_DIR = os.path.join(ROOT_DIR, "visualizer")
RUST_EXE = os.path.join(
    ROOT_DIR, "target", "release",
    "ctrp.exe" if sys.platform == "win32" else "ctrp"
)

def find_server_dir():
    if os.path.exists(os.path.join(VISUALIZER_DIR, "server.py")):
        return VISUALIZER_DIR
    if os.path.exists(os.path.join(ROOT_DIR, "server.py")):
        return ROOT_DIR
    return VISUALIZER_DIR

REQUIRED_PACKAGES = {
    "fastapi": "fastapi",
    "uvicorn": "uvicorn[standard]",
    "websockets": "websockets",
    "requests": "requests",
    "google.auth": "google-auth"
}

# Terminal Output Formatting (ANSI)
if sys.platform == "win32":
    os.system("")

RESET  = "\033[0m"
BOLD   = "\033[1m"
CYAN   = "\033[96m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"

def log_info(msg): print(f"{CYAN}{BOLD}[CTRP]{RESET} {CYAN}{msg}{RESET}", flush=True)
def log_ok(msg):   print(f"{GREEN}{BOLD}[CTRP]{RESET} {GREEN}{msg}{RESET}", flush=True)
def log_warn(msg): print(f"{YELLOW}{BOLD}[CTRP]{RESET} {YELLOW}{msg}{RESET}", flush=True)
def log_err(msg):  print(f"{RED}{BOLD}[CTRP]{RESET} {RED}{msg}{RESET}", flush=True)

# ── 1. Dependency Check ───────────────────────────────────────────────────────
def _is_installed(module_name):
    try:
        __import__(module_name)
        return True
    except ImportError:
        return False

def check_dependencies():
    log_info("Checking Python dependencies...")
    missing = [pip_name for mod_name, pip_name in REQUIRED_PACKAGES.items()
               if not _is_installed(mod_name)]
    if missing:
        log_warn(f"Installing missing dependencies: {', '.join(missing)}")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--quiet"] + missing,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        log_ok("Dependencies installed successfully.")
    else:
        log_ok("All dependencies present.")

# ── 2. Rust Build Check ───────────────────────────────────────────────────────
def check_rust():
    if os.path.exists(RUST_EXE):
        log_ok(f"Rust binary found: {RUST_EXE}")
        return
    log_warn("Rust binary not found. Compiling now...")
    try:
        res = subprocess.run(["cargo", "build", "--release"], cwd=ROOT_DIR)
        if res.returncode == 0:
            log_ok("Rust code compiled successfully.")
        else:
            log_warn("Rust compilation failed. Simulation logic will rely on JS fallback.")
    except Exception as e:
        log_warn(f"Could not run cargo build: {e}")

# ── 3. Detect UI File ─────────────────────────────────────────────────────────
def detect_ui_file():
    candidates = ["index.html", "ctrp_visualizer.html", "ctrp_deep_viz.html", "ctrp_workflow.html"]
    search_dirs = list(dict.fromkeys([find_server_dir(), ROOT_DIR, VISUALIZER_DIR]))
    for directory in search_dirs:
        for candidate in candidates:
            if os.path.exists(os.path.join(directory, candidate)):
                return candidate
    return None

# ── 4. Server ─────────────────────────────────────────────────────────────────
def stream_output(proc, prefix_name):
    prefix = f"  {CYAN}[{prefix_name}]{RESET} "
    try:
        for raw_line in proc.stdout:
            line = raw_line.decode(errors="replace").rstrip()
            if line:
                print(prefix + line)
    except Exception:
        pass

def start_server(port):
    server_dir = find_server_dir()
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server:app", "--host", "0.0.0.0",
         "--port", str(port), "--log-level", "warning"],
        cwd=server_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env
    )
    threading.Thread(target=stream_output, args=(proc, "SERVER"), daemon=True).start()
    return proc

def wait_for_port(port, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.5)
    return False

def find_free_port(start_port=8080, max_tries=20):
    port = start_port
    for _ in range(max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                port += 1
    raise RuntimeError(f"Could not find a free port starting from {start_port}.")

# ── 5. Verify server.py has static files mount ───────────────────────────────
def check_server_py():
    """
    Warn if the FastAPI server.py does not mount static files,
    which would cause 404 on /index.html etc.
    """
    server_file = os.path.join(find_server_dir(), "server.py")
    if not os.path.exists(server_file):
        log_err(f"server.py not found at: {server_file}")
        log_err("server.py must be in the same folder as run_ctrp.py or inside a visualizer/ subfolder.")
        sys.exit(1)

    with open(server_file, "r", encoding="utf-8") as f:
        content = f.read()

    if "StaticFiles" not in content and "mount" not in content:
        log_warn("WARNING: server.py may not be serving static files.")
        log_warn('Add: app.mount("/", StaticFiles(directory=".", html=True), name="static")')
    else:
        log_ok("server.py looks correct.")

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print()
    print(f"{BOLD}{CYAN}+========================================+{RESET}")
    print(f"{BOLD}{CYAN}|  CTRP Protocol Visualizer - Launcher   |{RESET}")
    print(f"{BOLD}{CYAN}+========================================+{RESET}")
    print()

    check_dependencies()
    check_rust()
    check_server_py()   # ← NEW: validates server.py exists and warns about static files

    # Determine port
    try:
        port = find_free_port(8080)
    except Exception as e:
        log_err(str(e))
        sys.exit(1)

    if port != 8080:
        log_warn(f"Port 8080 is busy. Using fallback port: {port}")

    # Start server
    server_process = start_server(port)

    log_info("Waiting for server to spin up...")
    if not wait_for_port(port, timeout=20):
        log_err("Server did not respond within 20 seconds.")
        server_process.terminate()
        sys.exit(1)

    log_ok("Server is active!")

    # Detect UI file (checks both visualizer/ and root)
    ui_file = detect_ui_file() or "index.html"
    target_url = f"http://localhost:{port}/{ui_file}"
    log_ok(f"Opening browser at: {target_url}")
    webbrowser.open(target_url)

    print()
    print(f"{GREEN}{BOLD}  >> Running at {target_url}  ---  Press Ctrl+C to exit.{RESET}")
    print()

    try:
        server_process.wait()
    except KeyboardInterrupt:
        print()
        log_warn("Shutting down the server...")
        server_process.terminate()
        log_ok("Shutdown successful. Goodbye!")
        sys.exit(0)

if __name__ == "__main__":
    main()