//! Structured JSON logger for CTRP.
//!
//! Call [`init`] once at startup, then use the typed `log_*` helpers
//! throughout the codebase.  Every event is:
//!   1. Printed as a single JSON line to **stdout**.
//!   2. Appended to the role-specific log file (`logs/client.log` or
//!      `logs/server.log`).
//!
//! The `env_logger` crate continues to write human-readable output to
//! **stderr**, so the two streams never interfere.

use std::fs::{create_dir_all, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Map, Value};

// ── Global log-file writer ─────────────────────────────────────────────────────

static LOG_WRITER: OnceLock<Mutex<BufWriter<File>>> = OnceLock::new();

/// Initialise the file logger.  `role` must be `"client"` or `"server"`;
/// the log is written to `logs/{role}.log`.
pub fn init(role: &str) {
    create_dir_all("logs").expect("cannot create logs/ directory");
    let path = format!("logs/{}.log", role);
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .unwrap_or_else(|e| panic!("cannot open {}: {}", path, e));
    // Ignore the error if init() is called twice in tests.
    let _ = LOG_WRITER.set(Mutex::new(BufWriter::new(file)));
}

// ── Timestamp ──────────────────────────────────────────────────────────────────

/// Current Unix time in milliseconds.
pub fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

// ── Core emitter ───────────────────────────────────────────────────────────────

/// Emit one JSON log line containing `event` + `ts_ms` + all `extra` fields.
fn log_event(event_type: &str, extra: Value) {
    let mut map = Map::new();
    map.insert("event".into(), json!(event_type));
    map.insert("ts_ms".into(), json!(now_ms()));
    if let Some(obj) = extra.as_object() {
        for (k, v) in obj {
            map.insert(k.clone(), v.clone());
        }
    }
    let line = Value::Object(map).to_string();

    // 1. stdout (machine-readable stream)
    println!("{}", line);

    // 2. log file (Python visualisers read this)
    if let Some(w) = LOG_WRITER.get() {
        if let Ok(mut w) = w.lock() {
            let _ = writeln!(w, "{}", line);
            let _ = w.flush();
        }
    }
}

// ── Typed public helpers ────────────────────────────────────────────────────────
// Each function maps to one event_type used by the Python visualisers.

/// Handshake successfully completed.
pub fn log_handshake_complete(role: &str, peer_addr: &str) {
    log_event(
        "handshake_complete",
        json!({ "role": role, "peer_addr": peer_addr }),
    );
}

/// A Data packet was encrypted and sent.
pub fn log_packet_sent(seq: u32, plaintext_bytes: usize, dest: &str) {
    log_event(
        "packet_sent",
        json!({ "seq": seq, "plaintext_bytes": plaintext_bytes, "dest": dest }),
    );
}

/// A Data packet was received and decrypted.
pub fn log_packet_received(seq: u32, plaintext_bytes: usize, src: &str) {
    log_event(
        "packet_received",
        json!({ "seq": seq, "plaintext_bytes": plaintext_bytes, "src": src }),
    );
}

/// An ACK was received by the sender.
pub fn log_ack_received(ack_seq: u32, rtt_ms: u128) {
    log_event(
        "ack_received",
        json!({ "ack_seq": ack_seq, "rtt_ms": rtt_ms }),
    );
}

/// Sender-side congestion window updated after an ACK.
pub fn log_sender_window(cwnd: u32, base_seq: u32) {
    log_event(
        "window_update",
        json!({ "side": "sender", "cwnd": cwnd, "base_seq": base_seq }),
    );
}

/// Receiver-side flow window advanced (next expected sequence number).
pub fn log_receiver_window(expected_seq: u32, buffered: usize) {
    log_event(
        "window_update",
        json!({ "side": "receiver", "expected_seq": expected_seq, "buffered": buffered }),
    );
}

/// Packet loss / timeout detected — congestion window halved.
pub fn log_congestion_detected(cwnd_before: f64, ssthresh_new: f64) {
    log_event(
        "congestion_detected",
        json!({ "cwnd_before": cwnd_before, "ssthresh_new": ssthresh_new }),
    );
}

/// Round-trip time measured for an acknowledged window.
pub fn log_rtt_measurement(rtt_ms: u128, ack_seq: u32) {
    log_event(
        "rtt_measurement",
        json!({ "rtt_ms": rtt_ms, "ack_seq": ack_seq }),
    );
}
