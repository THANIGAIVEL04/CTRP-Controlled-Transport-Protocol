# CTRP — Controlled Transport Protocol

A clean, optimized, and warning-free Rust implementation of a reliable UDP transport protocol with integrated real-time visualization.

## 🚀 Features

- **Reliable Transport**: Handshake mechanism (`CLIENT_HELLO` / `SERVER_HELLO`), packet framing, and window-based flow control.
- **Security**: AES-256-GCM encryption for all data packets using session keys established during the handshake.
- **Congestion Control**: TCP-like congestion handling (Slow Start & Congestion Avoidance) with automated window adjustment.
- **Observability**: High-frequency structured JSON logging for real-time analysis of RTT, congestion, and flow-control.
- **Visualization Suite**: A collection of Python scripts to plot protocol metrics live.

## 📂 Project Structure

- `src/main.rs`: Entry point with dual-mode (Server/Client) CLI.
- `src/logger.rs`: Structured JSON log emitter.
- `src/net/`: UDP socket handling.
- `src/handshake/`: Robust session establishment.
- `src/packet/`: Custom protocol wire framing.
- `src/crypto/`: AES-GCM encryption/decryption.
- `src/transport/`: Core protocol logic (Sender, Receiver, Flow Control, Congestion Control).
- `visualizer/`: Real-time Python graphing tools.

## 🛠️ Getting Started

### Prerequisites

- **Rust**: [Install Rust](https://rustup.rs/) (edition 2021)
- **Python**: (For visualization)
  ```bash
  pip install matplotlib
  ```

### Running CTRP

1. **Start the Server**:
   ```powershell
   cargo run -- server
   ```

2. **Start the Client**:
   ```powershell
   cargo run -- client
   ```

### Running Visualizers

The visualizers read from `logs/client.log` and `logs/server.log`. Open these in separate terminals while CTRP is running:

```bash
# View Congestion Window & Loss Markers
python visualizer/congestion_graph.py

# View Round-Trip Time (RTT) measurements
python visualizer/rtt_graph.py

# View Receiver Flow-Window & Buffer
python visualizer/flow_window_graph.py

# View Global Event Timeline
python visualizer/timeline_graph.py
```

## 📊 Logging Specifications

Every event is logged as a machine-readable JSON line to `stdout` and the respective role's log file.
Example `rtt_measurement` event:
```json
{"event":"rtt_measurement","ack_seq":42,"rtt_ms":15,"ts_ms":1708681200000}
```

## 📜 Development Notes

- **Zero Warnings**: The project builds cleanly using `cargo build`.
- **Optimization**: Minimal dependencies (`tokio`, `aes-gcm`, `rand`, `serde_json`).
- **Telemetry**: Designed for real-time analysis during high-load transport simulations.
