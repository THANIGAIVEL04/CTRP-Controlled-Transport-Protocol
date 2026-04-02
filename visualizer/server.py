"""
CTRP Visualizer Backend — FastAPI server
Serves the dashboard at http://localhost:8080/
WebSocket endpoint at ws://localhost:8080/ws
"""
import asyncio
import os
import json
import subprocess

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from fastapi import HTTPException
import sqlite3
import datetime

# Dashboard/visualizer directory (where this file is located)
DASHBOARD_DIR = os.path.dirname(os.path.abspath(__file__))
INDEX_HTML    = os.path.join(DASHBOARD_DIR, "index.html")
CSS_FILE      = os.path.join(DASHBOARD_DIR, "visualizer.css")
JS_FILE       = os.path.join(DASHBOARD_DIR, "visualizer.js")
DB_FILE       = os.path.join(DASHBOARD_DIR, "ctrp.db")

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_id TEXT UNIQUE,
        name TEXT,
        email TEXT,
        profile_picture TEXT,
        signup_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS simulation_history (
        simulation_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        input_message TEXT,
        packet_count INTEGER,
        encryption_used TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(user_id)
    )''')
    conn.commit()
    conn.close()

init_db()

app = FastAPI(title="CTRP Visualizer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Serve UI files explicitly — no StaticFiles conflict ──────────────────────
@app.get("/")
async def root():
    return FileResponse(INDEX_HTML)

@app.get("/index.html")
async def index():
    return FileResponse(INDEX_HTML)

@app.get("/visualizer.css")
async def css():
    return FileResponse(CSS_FILE, media_type="text/css")

@app.get("/visualizer.js")
async def js():
    return FileResponse(JS_FILE, media_type="application/javascript")

# ── Process control (start / stop Rust backend) ──────────────────────────────
_active: dict[str, subprocess.Popen | None] = {"server": None, "client": None}
_root_dir = os.path.abspath(os.path.join(DASHBOARD_DIR, ".."))

@app.post("/start/{role}")
async def start_process(role: str):
    if role not in _active:
        return {"error": "Invalid role"}
    p = _active[role]
    if p and p.poll() is None:
        return {"msg": f"{role} already running"}
    exe = os.path.join(_root_dir, "target", "release", "ctrp.exe")
    if os.path.exists(exe):
        cmd = [exe, role, "127.0.0.1:9000"]
    else:
        cmd = ["cargo", "run", "--", role, "127.0.0.1:9000"]
    _active[role] = subprocess.Popen(cmd, cwd=_root_dir,
                                     stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL)
    return {"msg": f"Started {role}"}

@app.post("/stop/{role}")
async def stop_process(role: str):
    p = _active.get(role)
    if p:
        p.terminate()
        _active[role] = None
        return {"msg": f"Stopped {role}"}
    return {"msg": f"{role} not running"}

# ── Google OAuth & User System ───────────────────────────────────────────────────
class TokenRequest(BaseModel):
    token: str
    client_id: str

@app.post("/api/auth/google")
async def google_auth(req: TokenRequest):
    try:
        idinfo = id_token.verify_oauth2_token(req.token, google_requests.Request(), req.client_id)
        
        google_id = idinfo['sub']
        name = idinfo.get('name', 'User')
        email = idinfo.get('email', '')
        picture = idinfo.get('picture', '')
        
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("SELECT user_id FROM users WHERE google_id = ?", (google_id,))
        row = c.fetchone()
        if row:
            user_id = row[0]
            c.execute("UPDATE users SET name = ?, email = ?, profile_picture = ? WHERE google_id = ?", 
                      (name, email, picture, google_id))
        else:
            c.execute("INSERT INTO users (google_id, name, email, profile_picture) VALUES (?, ?, ?, ?)", 
                      (google_id, name, email, picture))
            user_id = c.lastrowid
        conn.commit()
        conn.close()
        
        return {"success": True, "user_id": user_id, "name": name, "email": email, "picture": picture}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

class SimulationRecord(BaseModel):
    user_id: int
    input_message: str
    packet_count: int
    encryption_used: str

@app.post("/api/history")
async def save_history(record: SimulationRecord):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("""
        INSERT INTO simulation_history 
        (user_id, input_message, packet_count, encryption_used)
        VALUES (?, ?, ?, ?)
    """, (record.user_id, record.input_message, record.packet_count, record.encryption_used))
    conn.commit()
    conn.close()
    return {"success": True}

@app.get("/api/user/{user_id}/dashboard")
async def get_dashboard(user_id: int):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    c.execute("SELECT name, email, profile_picture, signup_timestamp FROM users WHERE user_id = ?", (user_id,))
    user_row = c.fetchone()
    if not user_row:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")
        
    c.execute("SELECT simulation_id, input_message, packet_count, encryption_used, timestamp FROM simulation_history WHERE user_id = ? ORDER BY timestamp DESC", (user_id,))
    history_rows = c.fetchall()
    
    c.execute("SELECT COUNT(*) as total, AVG(packet_count) as avg_packets FROM simulation_history WHERE user_id = ?", (user_id,))
    stats_row = c.fetchone()
    
    conn.close()
    
    # Calculate a mock simulated latency between 5 and 45ms
    total_sims = stats_row["total"] or 0
    avg_latency = f"{12 + (total_sims % 5)}ms" if total_sims > 0 else "0ms"
    
    return {
        "profile": dict(user_row),
        "history": [dict(r) for r in history_rows],
        "stats": {
            "total_simulations": total_sims,
            "avg_packet_count": round(stats_row["avg_packets"] or 0, 1),
            "avg_latency": avg_latency
        }
    }


# ── WebSocket – streams server.log and client.log to the browser ─────────────
async def _tail(path: str, q: asyncio.Queue, src: str):
    while not os.path.exists(path):
        await asyncio.sleep(0.5)
    while True:
        with open(path, "r", encoding="utf-8") as f:
            while True:
                tell = f.tell()
                line = f.readline()
                if not line:
                    f.seek(tell)
                    try:
                        if os.path.getsize(path) < tell:
                            break
                    except OSError:
                        pass
                    await asyncio.sleep(0.1)
                    continue
                try:
                    data = json.loads(line)
                    data["_source"] = src
                    await q.put(data)
                except Exception:
                    pass

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    q: asyncio.Queue = asyncio.Queue()
    logs_dir = os.path.join(_root_dir, "logs")
    t1 = asyncio.create_task(_tail(os.path.join(logs_dir, "server.log"), q, "SERVER"))
    t2 = asyncio.create_task(_tail(os.path.join(logs_dir, "client.log"), q, "CLIENT"))
    try:
        while True:
            msg = await q.get()
            await ws.send_json(msg)
    except WebSocketDisconnect:
        pass
    finally:
        t1.cancel(); t2.cancel()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
