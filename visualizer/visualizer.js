/* ================================================================
   CTRP Protocol Visualizer — Simulation Engine v3
   Features:
     - Packet splitting by word (each word = one packet)
     - Full 12-entity pipeline processing
     - Real changing packet values at each stage
     - Entity expansion with INCOMING / PROCESSING / OUTGOING
     - Vertical scrolling inside entity panels
     - Packet animation across the network divider
     - Server reconstruction display
     - Single START SIMULATION button (Client→Server pipeline)
     - 4 themes
   ================================================================ */

'use strict';

/* ============================
   GLOBAL STATE
   ============================ */
const State = {
    currentTheme: 'theme-bw',
    isSimulating: false,
    lastSimulation: null,
    history: [],
    selectedFile: null,
    currentFsPhaseIndex: -1,
    activePackets: {}, // track current packet state per phase
    user: null, // Logged in user info
};

/* ============================
   PHASE IDs (ordered)
   ============================ */
const CLIENT_PHASES = [
    'phase-client-app',
    'phase-ctrp-client',
    'phase-handshake',
    'phase-session',
    'phase-framing',
    'phase-encryption',
];
const SERVER_PHASES = [
    'phase-udp-rx',
    'phase-ctrp-server',
    'phase-server-hs',
    'phase-decryption',
    'phase-flow',
    'phase-server-app',
];
const ALL_PHASES = [...CLIENT_PHASES, ...SERVER_PHASES];

/* ============================
   HELPERS
   ============================ */
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function hexHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
    return (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function randHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
    return s;
}

function nowTs() { return new Date().toISOString(); }
function uid() { return Math.floor(Math.random() * 65536); }

/* ============================
   PACKET MODEL
   ============================ */
function makePacket(id, seq, word) {
    return {
        packet_id: id,
        sequence_number: seq,
        header: '',
        payload: word,
        payload_length: word.length,
        checksum: '',
        encryption_flag: false,
        plaintext: '',
        ciphertext: '',
        auth_tag: '',
        timestamp: nowTs(),
    };
}

function clonePkt(p) { return JSON.parse(JSON.stringify(p)); }

/* ============================
   PACKET RENDERING
   ============================ */
function renderPacketTable(pkt, heading) {
    const rows = Object.entries(pkt)
        .filter(([, v]) => v !== '' && v !== null && v !== false)
        .map(([k, v]) => {
            const val = (typeof v === 'boolean') ? String(v) : v;
            return `<div class="pkt-row">
                        <span class="pkt-key">${k}</span>
                        <span class="pkt-val">${escHtml(String(val))}</span>
                    </div>`;
        }).join('');
    return `<div class="pkt-block">
                <div class="pkt-head">${heading}</div>
                ${rows}
            </div>`;
}

function setPhaseContent(phaseId, inPkt, processLines, outPkt) {
    const box = document.getElementById(phaseId);
    if (!box) return;
    const body = box.querySelector('.phase-body');
    if (!body) return;

    let dyn = body.querySelector('.dyn');
    if (!dyn) {
        dyn = document.createElement('div');
        dyn.className = 'dyn';
        body.appendChild(dyn);
    }

    const procHtml = processLines
        .map(l => `<div class="proc-line">▶ ${escHtml(l)}</div>`)
        .join('');

    dyn.innerHTML =
        renderPacketTable(inPkt, '▼ INCOMING PACKET') +
        `<div class="proc-block"><div class="proc-head">⚙ PROCESSING</div>${procHtml}</div>` +
        renderPacketTable(outPkt, '▲ OUTGOING PACKET');

    // Save active packet state for fullscreen view
    State.activePackets[phaseId] = { inPkt, processLines, outPkt };

    // If fullscreen modal is open for THIS phase, refresh it
    if (State.currentFsPhaseIndex !== -1 && ALL_PHASES[State.currentFsPhaseIndex] === phaseId) {
        renderFullscreenContent(phaseId);
    }
}

/* ============================
   TERMINAL
   ============================ */
function termLog(tag, msg, cls = 'info') {
    const body = document.getElementById('terminal-body');
    if (!body) return;
    const t = new Date().toTimeString().slice(0, 8);
    const line = document.createElement('div');
    line.className = `terminal-line ${cls}`;
    line.textContent = `[${t}] [${tag}] ${msg}`;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
    while (body.childElementCount > 300) body.removeChild(body.firstElementChild);
}

/* ============================
   PHASE EXPAND / COLLAPSE
   ============================ */
function expandPhase(id) {
    const b = document.getElementById(id);
    if (b) b.classList.add('expanded', 'phase-highlighted');
}
function collapsePhase(id) {
    const b = document.getElementById(id);
    if (b) b.classList.remove('expanded', 'phase-highlighted');
}
function resetAllPhases() {
    ALL_PHASES.forEach(id => {
        collapsePhase(id);
        const box = document.getElementById(id);
        if (!box) return;
        const dyn = box.querySelector('.dyn');
        if (dyn) dyn.innerHTML = '';
    });
}

function initPhaseExpansion() {
    document.querySelectorAll('.phase-box').forEach(box => {
        // Expand on header click (manual toggle)
        const hdr = box.querySelector('.phase-header');
        if (hdr) {
            hdr.addEventListener('click', (e) => {
                e.stopPropagation();
                box.classList.toggle('expanded');
            });
        }

        // Open Fullscreen on box click
        box.addEventListener('click', () => {
            const phaseId = box.id;
            openFullscreen(phaseId);
        });
    });
}

/* ============================
   FULL SCREEN LOGIC
   ============================ */
function openFullscreen(phaseId) {
    const index = ALL_PHASES.indexOf(phaseId);
    if (index === -1) return;

    State.currentFsPhaseIndex = index;
    const modal = document.getElementById('fs-modal');
    if (modal) modal.classList.add('active');

    renderFullscreenContent(phaseId);
}

function closeFullscreen() {
    State.currentFsPhaseIndex = -1;
    const modal = document.getElementById('fs-modal');
    if (modal) modal.classList.remove('active');
}

function navFullscreen(dir) {
    let nextIdx = State.currentFsPhaseIndex + dir;
    if (nextIdx < 0) nextIdx = ALL_PHASES.length - 1;
    if (nextIdx >= ALL_PHASES.length) nextIdx = 0;

    State.currentFsPhaseIndex = nextIdx;
    renderFullscreenContent(ALL_PHASES[nextIdx]);
}

function renderFullscreenContent(phaseId) {
    const box = document.getElementById(phaseId);
    const title = box?.querySelector('.phase-name')?.textContent || 'Entity';

    const fsTitle = document.getElementById('fs-title');
    const fsBody = document.getElementById('fs-body');
    const fsIndicator = document.getElementById('fs-indicator');

    if (fsTitle) fsTitle.textContent = title;
    if (fsIndicator) fsIndicator.textContent = `Entity ${State.currentFsPhaseIndex + 1} of ${ALL_PHASES.length}`;

    if (!fsBody) return;

    const data = State.activePackets[phaseId];
    if (!data) {
        fsBody.innerHTML = `<div class="history-empty" style="margin-top:100px">
            <i class="fa-solid fa-microchip"></i>
            <p>No active packet data recorded for this entity.</p>
            <p class="history-empty-sub">Run a simulation or wait for a packet to reach this stage.</p>
        </div>`;
        return;
    }

    const { inPkt, processLines, outPkt } = data;

    // Format full packet data table for display
    const renderFullPkt = (p, label) => {
        const rows = [
            'packet_id', 'sequence_number', 'header', 'payload',
            'payload_length', 'checksum', 'encryption_flag',
            'plaintext', 'ciphertext', 'auth_tag', 'timestamp'
        ].map(key => {
            const val = p[key];
            const displayVal = (typeof val === 'boolean') ? String(val) : (val || '-');
            return `<div class="pkt-row">
                        <span class="pkt-key">${key}</span>
                        <span class="pkt-val">${escHtml(String(displayVal))}</span>
                    </div>`;
        }).join('');

        return `<div class="fs-section">
            <div class="fs-section-title">${label}</div>
            <div class="pkt-block">${rows}</div>
        </div>`;
    };

    const procHtml = processLines
        .map(l => `<div class="proc-line">▶ ${escHtml(l)}</div>`)
        .join('');

    fsBody.innerHTML = `
        <div class="fs-grid">
            ${renderFullPkt(inPkt, 'Input Packet State')}
            <div class="fs-section">
                <div class="fs-section-title">Processing Steps & Transformations</div>
                <div class="proc-block" style="border:1px solid var(--border)">
                    ${procHtml}
                </div>
            </div>
            ${renderFullPkt(outPkt, 'Output Packet State')}
        </div>
    `;
}

function initFullscreen() {
    const close = document.getElementById('fs-close');
    const overlay = document.getElementById('fs-overlay');
    const prev = document.getElementById('fs-prev');
    const next = document.getElementById('fs-next');

    if (close) close.addEventListener('click', closeFullscreen);
    if (overlay) overlay.addEventListener('click', closeFullscreen);
    if (prev) prev.addEventListener('click', () => navFullscreen(-1));
    if (next) next.addEventListener('click', () => navFullscreen(1));

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeFullscreen();
        if (State.currentFsPhaseIndex !== -1) {
            if (e.key === 'ArrowLeft') navFullscreen(-1);
            if (e.key === 'ArrowRight') navFullscreen(1);
        }
    });
}

/* ============================
   PACKET ANIMATION across network divider
   ============================ */
function animatePacket(pktLabel) {
    return new Promise(resolve => {
        const el = document.getElementById('anim-packet');
        const div = document.getElementById('network-divider');
        if (!el || !div) { resolve(); return; }

        el.textContent = pktLabel;
        el.style.display = 'flex';
        el.style.left = '0px';
        el.style.opacity = '1';

        const w = div.offsetWidth || 900;
        const dur = 700;
        const t0 = performance.now();

        function step(now) {
            const p = Math.min((now - t0) / dur, 1);
            el.style.left = (p * (w - 60)) + 'px';
            if (p < 1) { requestAnimationFrame(step); return; }
            el.style.opacity = '0';
            setTimeout(() => {
                el.style.display = 'none';
                el.style.left = '0px';
                el.style.opacity = '1';
                resolve();
            }, 200);
        }
        requestAnimationFrame(step);
    });
}

/* ============================
   PACKET SPLITTING DISPLAY
   ============================ */
function showPacketSplit(packets) {
    // Print splitting result to terminal
    termLog('SPLIT', `Input → ${packets.length} packet(s):`, 'highlight');
    packets.forEach(p => {
        termLog('SPLIT', `  PKT#${p.packet_id} seq=${p.sequence_number} payload="${p.payload}" len=${p.payload_length}`, 'info');
    });
}

/* ============================
   PIPELINE PROCESSING (per packet)
   ============================ */
async function processPacketThroughPipeline(pkt, packetNum, totalPackets) {
    const label = `PKT#${pkt.packet_id}`;

    async function runStage(phaseId, processor, delay = 280) {
        await sleep(delay);
        const inP = clonePkt(pkt);
        const { lines, mutate } = processor(pkt);
        mutate(pkt);
        const outP = clonePkt(pkt);
        setPhaseContent(phaseId, inP, lines, outP);

        // Auto-expand for visibility
        expandPhase(phaseId);

        // Log to terminal
        const phaseName = document.getElementById(phaseId)
            ?.querySelector('.phase-name')?.textContent || phaseId;
        termLog(phaseName.toUpperCase().replace(/ /g, '_'), lines[0] || '', 'info');

        await sleep(650); // Slightly longer for readability
        collapsePhase(phaseId);
    }

    termLog('PIPELINE', `── Processing ${label} (${packetNum}/${totalPackets}) ──`, 'highlight');

    // ── CLIENT SIDE ─────────────────────────────────────────────────────────

    // 1. Client Application
    await runStage('phase-client-app', p => ({
        lines: [
            `User input received. Serialising to UTF-8.`,
            `Payload = "${p.payload}" (${p.payload_length} bytes)`,
            `Assigning packet_id = ${p.packet_id}`,
        ],
        mutate: p => { /* no change yet — raw payload */ },
    }));

    // 2. CTRP Client Layer
    await runStage('phase-ctrp-client', p => ({
        lines: [
            `Protocol header created. Version = CTRPv1`,
            `Sequence number = ${p.sequence_number}`,
            `SEQ_NO = prev_seq + ${p.payload_length}`,
        ],
        mutate: p => { p.header = `CTRPv1|SEQ=${p.sequence_number}|LEN=${p.payload_length}`; },
    }));

    // 3. Handshake
    await runStage('phase-handshake', p => {
        const nonce = randHex(8);
        return {
            lines: [
                `ClientHello sent. Nonce = 0x${nonce}`,
                `ECDH P-256 key exchange initiated.`,
                `ServerHello received.`,
            ],
            mutate: p => { p.header += `|NONCE=${nonce}`; },
        };
    });

    // 4. Session Key Generation
    await runStage('phase-session', p => {
        const sessionKey = randHex(16);
        const iv = randHex(12);
        return {
            lines: [
                `HKDF-SHA256 derived. Session key = 0x${sessionKey.slice(0, 8)}…`,
                `IV/nonce = 0x${iv}`,
                `Key material stored in secure memory.`,
            ],
            mutate: p => { p.header += `|IV=${iv}`; p.checksum = ''; },
        };
    });

    // 5. Packet Framing
    await runStage('phase-framing', p => {
        const crc = hexHash(p.payload + p.header);
        return {
            lines: [
                `Frame built: [magic=0xCTRP][type=DATA][seq=${p.sequence_number}][len=${p.payload_length}]`,
                `CRC32 checksum = 0x${crc}`,
                `Fragment ID assigned.`,
            ],
            mutate: p => { p.checksum = `0x${crc}`; },
        };
    });

    // 6. Encryption Layer
    await runStage('phase-encryption', p => {
        const ct = hexHash(p.payload + 'AES-GCM-KEY');
        const tag = hexHash(ct + 'TAG');
        return {
            lines: [
                `plaintext = "${p.payload}"`,
                `AES-256-GCM encryption applied.`,
                `ciphertext = 0x${ct}`,
                `auth_tag   = 0x${tag}`,
            ],
            mutate: p => {
                p.plaintext = p.payload;
                p.ciphertext = `0x${ct}`;
                p.auth_tag = `0x${tag}`;
                p.encryption_flag = true;
                p.payload = '[ENCRYPTED]';
            },
        };
    });

    // ── NETWORK TRANSIT ──────────────────────────────────────────────────────
    termLog('UDP/TX', `${label} → UDP datagram transmitted over IPv4.`, 'info');
    await animatePacket(label);
    await sleep(150);

    // ── SERVER SIDE ─────────────────────────────────────────────────────────

    // 7. UDP Receiver
    await runStage('phase-udp-rx', p => ({
        lines: [
            `Datagram received. Source: 127.0.0.1:ephemeral`,
            `Buffer size = ${p.payload_length + 64} bytes`,
            `Checksum = ${p.checksum}`,
        ],
        mutate: p => { /* packet unchanged, just received */ },
    }));

    // 8. CTRP Server Layer
    await runStage('phase-ctrp-server', p => ({
        lines: [
            `Magic bytes validated (0xCTRP ✓)`,
            `Header parsed: ${p.header.slice(0, 40)}`,
            `Routing to DATA handler.`,
        ],
        mutate: p => { /* validated, no data change */ },
    }));

    // 9. Server Handshake
    await runStage('phase-server-hs', p => ({
        lines: [
            `Session active. Peer authenticated.`,
            `ECDH shared secret verified.`,
            `Key exchange complete.`,
        ],
        mutate: p => { /* session confirmed */ },
    }));

    // 10. Decryption Layer
    await runStage('phase-decryption', p => ({
        lines: [
            `ciphertext = ${p.ciphertext}`,
            `auth_tag   = ${p.auth_tag}`,
            `AES-256-GCM decryption successful (tag verified).`,
            `plaintext  = "${p.plaintext}"`,
        ],
        mutate: p => {
            p.payload = p.plaintext;
            p.ciphertext = '';
            p.auth_tag = '';
            p.encryption_flag = false;
        },
    }));

    // 11. Flow Control
    await runStage('phase-flow', p => ({
        lines: [
            `Sequence ${p.sequence_number} accepted (in-order).`,
            `RWND updated. SACK generated.`,
            `ACK_NUM = ${p.sequence_number + p.payload_length}`,
        ],
        mutate: p => { p.checksum = ''; }, // cleared after validation
    }));

    // 12. Server Application
    await runStage('phase-server-app', p => ({
        lines: [
            `Payload fragment delivered: "${p.payload}"`,
            `Fragment queued for reassembly.`,
            `ACK sent to client.`,
        ],
        mutate: p => { /* final delivery, no further change */ },
    }));

    return pkt.payload; // return recovered plaintext word
}

/* ============================
   MAIN SIMULATION
   ============================ */
async function runSimulation(rawInput, isFile, fileName) {
    if (State.isSimulating) return;
    State.isSimulating = true;

    const startBtn = document.getElementById('send-btn-start');
    if (startBtn) startBtn.disabled = true;

    resetAllPhases();

    const displayLabel = isFile
        ? fileName
        : (rawInput.length > 50 ? rawInput.slice(0, 50) + '…' : rawInput);

    termLog('SYSTEM', `━━━━ Simulation start (Client→Server): "${displayLabel}" ━━━━`, 'highlight');

    // ── PACKET SPLITTING ─────────────────────────────────────────────────────
    let words;
    if (isFile) {
        // For files, create chunks by name
        words = [fileName, `[FILE_DATA_${randHex(4)}]`, `[EOF_${randHex(2)}]`];
    } else {
        words = rawInput.trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) words = ['[EMPTY]'];
    }

    termLog('SPLIT', `Splitting input into ${words.length} packet(s)…`, 'info');
    await sleep(300);

    const packets = words.map((w, i) => makePacket(uid(), i + 1, w));
    showPacketSplit(packets);
    await sleep(500);

    // ── PIPELINE ─────────────────────────────────────────────────────────────
    const recovered = [];
    for (let i = 0; i < packets.length; i++) {
        const word = await processPacketThroughPipeline(packets[i], i + 1, packets.length);
        recovered.push(word);
        await sleep(200);
    }

    // ── RECONSTRUCTION ───────────────────────────────────────────────────────
    const reconstructed = recovered.join(' ');
    await sleep(300);
    termLog('RECONSTRUCT', `━━━━ SERVER REASSEMBLY ━━━━`, 'success');
    termLog('RECONSTRUCT', `Fragments received: ${recovered.map((w, i) => `PKT${i + 1}="${w}"`).join(' | ')}`, 'info');
    termLog('RECONSTRUCT', `Reconstructed message: "${reconstructed}"`, 'success');
    termLog('SYSTEM', `Simulation complete. ${packets.length} packet(s) delivered.`, 'success');

    // expand server-app to show final reconstruction
    const saBox = document.getElementById('phase-server-app');
    const saBody = saBox?.querySelector('.phase-body');
    if (saBox && saBody) {
        let dyn = saBody.querySelector('.dyn');
        if (!dyn) { dyn = document.createElement('div'); dyn.className = 'dyn'; saBody.appendChild(dyn); }
        const fragHtml = recovered.map((w, i) =>
            `<div class="pkt-row"><span class="pkt-key">Fragment ${i + 1}</span><span class="pkt-val">${escHtml(w)}</span></div>`
        ).join('');
        dyn.innerHTML = `<div class="pkt-block">
            <div class="pkt-head">✔ RECONSTRUCTED MESSAGE</div>
            ${fragHtml}
            <div class="pkt-row" style="margin-top:6px;border-top:1px dashed var(--border)">
                <span class="pkt-key">Full output</span>
                <span class="pkt-val" style="font-weight:700">${escHtml(reconstructed)}</span>
            </div>
        </div>`;
        expandPhase('phase-server-app');
    }

    const simData = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        label: displayLabel,
        isFile,
        fileName: fileName || '',
        payload: isFile ? null : rawInput,
        result: 'SUCCESS',
        packets: packets.length,
        reconstructed,
        encryption_used: 'AES-256-GCM'
    };
    State.lastSimulation = simData;

    // Automatically save to backend if user is logged in
    if (State.user) {
        saveSimulationToBackend(simData);
    }

    const saveBtn = document.getElementById('save-sim-btn');
    if (saveBtn) saveBtn.disabled = false;

    if (startBtn) startBtn.disabled = false;
    State.isSimulating = false;
}

/* ============================
   SPLASH
   ============================ */
function initSplash() {
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        const app = document.getElementById('main-app');
        if (splash) { splash.classList.add('fade-out'); setTimeout(() => splash.style.display = 'none', 600); }
        if (app) { app.style.display = 'flex'; app.style.flexDirection = 'column'; }
    }, 1800);
}

/* ============================
   THEME SYSTEM
   ============================ */
const THEMES = ['theme-bw', 'theme-dark', 'theme-gray', 'theme-blue'];

function applyTheme(theme) {
    if (!THEMES.includes(theme)) return;
    const body = document.getElementById('app-body');
    THEMES.forEach(t => body.classList.remove(t));
    body.classList.add(theme);
    State.currentTheme = theme;
    document.querySelectorAll('.theme-option').forEach(o =>
        o.classList.toggle('active', o.dataset.theme === theme));
    try { localStorage.setItem('ctrp-theme', theme); } catch { }
}

function initTheme() {
    let s; try { s = localStorage.getItem('ctrp-theme'); } catch { }
    applyTheme(THEMES.includes(s) ? s : 'theme-bw');
}

function initThemeSwitcher() {
    const btn = document.getElementById('theme-btn');
    const dd = document.getElementById('theme-dropdown');
    if (!btn || !dd) return;
    btn.addEventListener('click', e => { e.stopPropagation(); dd.classList.toggle('open'); });
    document.addEventListener('click', e => { if (!dd.contains(e.target) && e.target !== btn) dd.classList.remove('open'); });
    dd.querySelectorAll('.theme-option').forEach(o =>
        o.addEventListener('click', e => { e.stopPropagation(); applyTheme(o.dataset.theme); dd.classList.remove('open'); }));
}

/* ============================
   TAB NAV
   ============================ */
function initTabs() {
    document.querySelectorAll('.nav-tab').forEach(tab =>
        tab.addEventListener('click', () => {
            if (tab.classList.contains('auth-required') && !State.user) {
                alert('Please login with Google to access this feature.');
                return;
            }

            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const p = document.getElementById('tab-' + tab.dataset.tab);
            if (p) p.classList.add('active');

            if (tab.dataset.tab === 'dashboard') {
                loadDashboard();
            }
        }));
}

/* ============================
   TERMINAL CLEAR
   ============================ */
function initTerminal() {
    const btn = document.getElementById('clear-terminal');
    if (btn) btn.addEventListener('click', () => {
        const b = document.getElementById('terminal-body');
        if (b) b.innerHTML = '';
    });
}

/* ============================
   INPUT HANDLING
   ============================ */
function initInput() {
    const msgInput = document.getElementById('msg-input');
    const fileInput = document.getElementById('file-input');
    const startBtn = document.getElementById('send-btn-start');
    const filePrev = document.getElementById('file-preview');
    const fileLabel = document.getElementById('file-name');
    const clearFile = document.getElementById('clear-file');

    if (!startBtn) return;

    // File select
    if (fileInput) {
        fileInput.addEventListener('change', () => {
            const f = fileInput.files[0];
            if (!f) return;
            State.selectedFile = f;
            if (fileLabel) fileLabel.textContent = `${f.name} (${fmtBytes(f.size)})`;
            if (filePrev) filePrev.style.display = 'flex';
            if (msgInput) msgInput.placeholder = 'Optional note…';
        });
    }
    if (clearFile) {
        clearFile.addEventListener('click', () => {
            State.selectedFile = null;
            if (fileInput) fileInput.value = '';
            if (filePrev) filePrev.style.display = 'none';
            if (msgInput) msgInput.placeholder = 'Type a message…';
        });
    }

    function doSend() {
        if (State.isSimulating) return;
        if (State.selectedFile) {
            const f = State.selectedFile;
            const note = msgInput?.value.trim() || '';
            State.selectedFile = null;
            if (fileInput) fileInput.value = '';
            if (filePrev) filePrev.style.display = 'none';
            if (msgInput) { msgInput.value = ''; msgInput.placeholder = 'Type a message…'; }
            runSimulation(note || f.name, true, f.name);
            return;
        }
        const text = msgInput?.value.trim() || '';
        if (!text) return;
        msgInput.value = '';
        runSimulation(text, false, '');
    }

    startBtn.addEventListener('click', doSend);

    if (msgInput) {
        msgInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
        });
    }
}

/* ============================
   HISTORY
   ============================ */
function initHistory() {
    const saveBtn = document.getElementById('save-sim-btn');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', () => {
        if (!State.lastSimulation) return;
        addHistoryItem(State.lastSimulation);
        saveBtn.disabled = true;
        State.lastSimulation = null;
    });
}

function addHistoryItem(sim) {
    State.history.unshift(sim);
    const list = document.getElementById('history-list');
    if (!list) return;
    const empty = list.querySelector('.history-empty');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.className = 'history-item';
    const dt = new Date(sim.timestamp).toLocaleString();
    const icon = sim.isFile ? '<i class="fa-solid fa-file"></i>' : '<i class="fa-solid fa-message"></i>';

    item.innerHTML = `
        <div class="history-icon">${icon}</div>
        <div class="history-info">
            <div class="history-name">${escHtml(sim.label)}</div>
            <div class="history-meta">${dt} &nbsp;|&nbsp; ${sim.isFile ? 'File' : 'Text'} &nbsp;|&nbsp; ${sim.packets} pkt(s)</div>
            <div class="history-meta" style="color:var(--accent);font-weight:600">↺ "${escHtml(sim.reconstructed)}"</div>
        </div>
        <div class="history-status"><i class="fa-solid fa-circle-check"></i> ${sim.result}</div>
        <button class="replay-btn"><i class="fa-solid fa-rotate-right"></i> Replay</button>`;

    item.querySelector('.replay-btn').addEventListener('click', () => {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        const pt = document.querySelector('.nav-tab[data-tab="pipeline"]');
        if (pt) pt.classList.add('active');
        const pp = document.getElementById('tab-pipeline');
        if (pp) pp.classList.add('active');
        setTimeout(() => runSimulation(sim.payload || sim.label, sim.isFile, sim.fileName || ''), 100);
    });

    list.insertBefore(item, list.firstChild);
}

/* ============================
   UTILITIES
   ============================ */
function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
}

/* ============================
   AUTH & DASHBOARD
   ============================ */
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

function initAuth() {
    const loginBtn = document.getElementById('google-login-btn');
    const profileMenu = document.getElementById('user-profile-menu');
    const logoutBtn = document.getElementById('logout-btn');
    const logoutBtn2 = document.getElementById('logout-btn-2');
    const profilePic = document.getElementById('user-profile-pic');
    const dropdownName = document.getElementById('dropdown-name');
    const dropdownEmail = document.getElementById('dropdown-email');

    // Handle profile dropdown toggle
    profilePic?.addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = document.getElementById('profile-dropdown');
        if (dd) dd.style.display = dd.style.display === 'flex' ? 'none' : 'flex';
    });

    document.addEventListener('click', (e) => {
        const dd = document.getElementById('profile-dropdown');
        if (dd && !profileMenu.contains(e.target)) {
            dd.style.display = 'none';
        }
    });

    // Check existing session (mocked via localStorage for simplicity)
    const storedUser = localStorage.getItem('ctrp_user');
    if (storedUser) {
        try {
            State.user = JSON.parse(storedUser);
            updateAuthUI();
        } catch (e) {
            localStorage.removeItem('ctrp_user');
        }
    }

    // Assign custom login button logic 
    // Usually Google GIS requires its own button rendering, but we can do a prompt or let the user click if we rendered with Google.
    // However, since we must provide a standard "Login with Google" button without changing layout, we'll try initializing GSI payload
    if (window.google && google.accounts && google.accounts.id) {
        google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleCredentialResponse
        });

        // We'll attach the click handler to our custom button to invoke the prompt
        // Note: Google OneTap prompt() is different, but for custom buttons standard GIS doesn't allow easy binding without RenderButton.
        // As a workaround for custom designs, we wrap our button or simply use prompt.
        if (loginBtn) {
            loginBtn.addEventListener('click', () => {
                google.accounts.id.prompt();

                // For educational/demonstration purposes if the ClientID is still the placeholder,
                // we'll simulate a login after a tiny delay so the UI can be evaluated.
                if (GOOGLE_CLIENT_ID.includes('YOUR_GOOGLE_CLIENT_ID')) {
                    setTimeout(() => simulateLogin(), 500);
                }
            });
        }
    } else if (loginBtn && GOOGLE_CLIENT_ID.includes('YOUR_GOOGLE_CLIENT_ID')) {
        loginBtn.addEventListener('click', () => simulateLogin());
    }

    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    if (logoutBtn2) logoutBtn2.addEventListener('click', handleLogout);
}

function simulateLogin() {
    const fakeData = {
        success: true,
        user_id: 1,
        name: "Demo Instructor",
        email: "instructor@example.com",
        picture: "https://ui-avatars.com/api/?name=Demo+Instructor&background=0D8ABC&color=fff"
    };
    State.user = fakeData;
    localStorage.setItem('ctrp_user', JSON.stringify(fakeData));
    updateAuthUI();
}

async function handleCredentialResponse(response) {
    try {
        // Send token to backend
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: response.credential, client_id: GOOGLE_CLIENT_ID })
        });
        const data = await res.json();
        if (data.success) {
            State.user = data;
            localStorage.setItem('ctrp_user', JSON.stringify(data));
            updateAuthUI();
        } else {
            alert('Login failed: ' + (data.detail || 'Unknown error'));
        }
    } catch (err) {
        console.error('Auth error', err);
        // Fallback for demonstration if backend fails (e.g. invalid client id)
        simulateLogin();
    }
}

function updateAuthUI() {
    const loginBtn = document.getElementById('google-login-btn');
    const profileMenu = document.getElementById('user-profile-menu');
    const profilePic = document.getElementById('user-profile-pic');
    const dropdownName = document.getElementById('dropdown-name');
    const dropdownEmail = document.getElementById('dropdown-email');

    // Auth-required tabs
    const authTabs = document.querySelectorAll('.nav-tab.auth-required');

    if (State.user) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (profileMenu) profileMenu.style.display = 'block';
        if (profilePic) profilePic.src = State.user.picture || 'https://ui-avatars.com/api/?name=' + State.user.name;
        if (dropdownName) dropdownName.textContent = State.user.name;
        if (dropdownEmail) dropdownEmail.textContent = State.user.email;

        authTabs.forEach(t => t.style.display = 'block');

        // Populate profile tab
        const pName = document.getElementById('prof-name');
        const pEmail = document.getElementById('prof-email');
        const pId = document.getElementById('prof-id');
        if (pName) pName.textContent = State.user.name;
        if (pEmail) pEmail.textContent = State.user.email;
        if (pId) pId.textContent = 'CTRP-' + State.user.user_id;

    } else {
        if (loginBtn) loginBtn.style.display = 'flex';
        if (profileMenu) profileMenu.style.display = 'none';
        authTabs.forEach(t => t.style.display = 'none');

        // Kick out to home if on protected tab
        const activeTab = document.querySelector('.nav-tab.active');
        if (activeTab && activeTab.classList.contains('auth-required')) {
            document.querySelector('.nav-tab[data-tab="home"]')?.click();
        }
    }
}

function handleLogout() {
    State.user = null;
    localStorage.removeItem('ctrp_user');
    const dd = document.getElementById('profile-dropdown');
    if (dd) dd.style.display = 'none';
    updateAuthUI();
}

async function saveSimulationToBackend(sim) {
    if (!State.user) return;
    try {
        await fetch('/api/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: State.user.user_id,
                input_message: sim.label,
                packet_count: sim.packets,
                encryption_used: sim.encryption_used || 'AES-256-GCM'
            })
        });
    } catch (e) {
        console.error('Failed to save simulation to db', e);
    }
}

async function loadDashboard() {
    if (!State.user) return;
    try {
        const res = await fetch('/api/user/' + State.user.user_id + '/dashboard');
        if (!res.ok) {
            // Mock data fallback if DB fails
            renderDashboard({
                profile: { name: State.user.name, email: State.user.email, profile_picture: State.user.picture },
                stats: { total_simulations: State.history.length, avg_packet_count: 5.5, avg_latency: "12ms" },
                history: State.history.map(h => ({ input_message: h.label, packet_count: h.packets, encryption_used: 'AES-256-GCM', timestamp: h.timestamp }))
            });
            return;
        }
        const data = await res.json();
        renderDashboard(data);
    } catch (e) {
        console.error('Dashboard load failed', e);
    }
}

function renderDashboard(data) {
    const pPic = document.getElementById('dash-pic');
    const pName = document.getElementById('dash-name');
    const pEmail = document.getElementById('dash-email');
    if (pPic) pPic.src = data.profile.profile_picture || 'https://ui-avatars.com/api/?name=' + data.profile.name;
    if (pName) pName.textContent = data.profile.name;
    if (pEmail) pEmail.textContent = data.profile.email;

    const sTotal = document.getElementById('stat-total');
    const sAvgPkt = document.getElementById('stat-avg-packets');
    const sAvgLat = document.getElementById('stat-avg-latency');
    if (sTotal) sTotal.textContent = data.stats.total_simulations;
    if (sAvgPkt) sAvgPkt.textContent = data.stats.avg_packet_count;
    if (sAvgLat) sAvgLat.textContent = data.stats.avg_latency;

    const histUI = document.getElementById('dash-history-list');
    if (histUI) {
        if (data.history.length === 0) {
            histUI.innerHTML = `<div class="history-empty"><p>No simulations found in database.</p></div>`;
        } else {
            histUI.innerHTML = data.history.map(h => {
                const dt = new Date(h.timestamp).toLocaleString();
                return `
                <div class="history-item" style="padding:10px; margin-bottom:8px;">
                    <div class="history-icon" style="width:28px; height:28px;"><i class="fa-solid fa-server"></i></div>
                    <div class="history-info">
                        <div class="history-name" style="font-size:12px;">${escHtml(h.input_message)}</div>
                        <div class="history-meta" style="font-size:10px;">${dt} | ${h.packet_count} packets | ${escHtml(h.encryption_used)}</div>
                    </div>
                </div>`;
            }).join('');
        }
    }
}

/* ============================
   ANIMATED NETWORK BACKGROUND
   ============================ */
function initNetworkBackground() {
    const canvas = document.getElementById('network-bg-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let width, height;
    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    const nodes = [];
    const numNodes = 40; // Lightweight node count
    for (let i = 0; i < numNodes; i++) {
        nodes.push({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.5) * 0.8,
            vy: (Math.random() - 0.5) * 0.8,
            radius: Math.random() * 2 + 1
        });
    }

    const packets = [];

    setInterval(() => {
        // Spawn more network traffic when simulating
        if (State.isSimulating && Math.random() > 0.4) return;
        if (!State.isSimulating && Math.random() > 0.08) return;

        const a = nodes[Math.floor(Math.random() * nodes.length)];
        const b = nodes[Math.floor(Math.random() * nodes.length)];
        if (a === b) return;
        packets.push({ source: a, target: b, progress: 0, speed: Math.random() * 0.01 + 0.005 });
    }, 150);

    let colors = { bg: '#fff', border: '#e0e0e0', accent: '#000', nodes: '#888' };
    function updateColors() {
        const style = getComputedStyle(document.body);
        colors = {
            bg: style.getPropertyValue('--bg').trim() || '#ffffff',
            border: style.getPropertyValue('--border-strong').trim() || style.getPropertyValue('--border').trim(),
            accent: style.getPropertyValue('--accent').trim() || '#000000',
            nodes: style.getPropertyValue('--text-muted').trim() || '#888888'
        };
    }
    updateColors();
    setInterval(updateColors, 1000); // Poll for theme changes roughly every second

    let isVisible = true;
    document.addEventListener('visibilitychange', () => {
        isVisible = document.visibilityState === 'visible';
    });

    function draw() {
        requestAnimationFrame(draw);
        if (!isVisible) return; // Automatic pause

        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = colors.nodes;
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            n.x += n.vx;
            n.y += n.vy;

            if (n.x < 0 || n.x > width) n.vx *= -1;
            if (n.y < 0 || n.y > height) n.vy *= -1;

            ctx.beginPath();
            ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 1;
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                const dist = dx * dx + dy * dy;
                // Connecting lines between nearby points
                if (dist < 20000) {
                    ctx.globalAlpha = 1 - (dist / 20000);
                    ctx.beginPath();
                    ctx.moveTo(nodes[i].x, nodes[i].y);
                    ctx.lineTo(nodes[j].x, nodes[j].y);
                    ctx.stroke();
                }
            }
        }
        ctx.globalAlpha = 1.0;

        for (let i = packets.length - 1; i >= 0; i--) {
            const p = packets[i];
            p.progress += p.speed;
            if (p.progress >= 1) {
                packets.splice(i, 1);
                continue;
            }

            const x = p.source.x + (p.target.x - p.source.x) * p.progress;
            const y = p.source.y + (p.target.y - p.source.y) * p.progress;

            ctx.fillStyle = colors.accent;
            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, Math.PI * 2);
            ctx.fill();

            // Subtle glow around active packets
            ctx.shadowBlur = 8;
            ctx.shadowColor = colors.accent;
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }
    // Start loop
    draw();
}

/* ============================
   BOOTSTRAP
   ============================ */
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initNetworkBackground(); // Load animation first
    initSplash();
    initThemeSwitcher();
    initTabs();
    initPhaseExpansion();
    initFullscreen(); // ← NEW: Initialize fullscreen mode
    initTerminal();
    initInput();
    initHistory();
    initAuth();
});
