CTRP — Custom Transport Protocol (Design & Simulation)

«CTRP is a custom-designed transport-layer protocol implemented in Rust, featuring reliability, congestion control, encryption, and real-time visualization. This project demonstrates practical protocol design and networking concepts.»

---

🚀 Features

- Reliable Transport: Handshake mechanism ("CLIENT_HELLO" / "SERVER_HELLO"), packet framing, and window-based flow control
- Security: AES-256-GCM encryption for secure data transmission
- Congestion Control: TCP-like behavior (Slow Start & Congestion Avoidance)
- Observability: Structured JSON logging for RTT, congestion, and flow analysis
- Visualization: Python-based real-time graphing tools

---

🧪 Project Type

- Custom Protocol Design
- Network Simulation
- Systems Programming (Rust)

---

🧠 Skills Demonstrated

- Transport Layer Networking
- Congestion Control Algorithms
- Secure Communication (AES-GCM)
- Rust Systems Programming
- Real-time Data Visualization

---

📂 Project Structure

- "src/" → Core protocol implementation
- "visualizer/" → Python-based visualization tools
- "logs/" → Runtime logs (structure only, not stored)
- "docs/" → Project documentation

---

⚙️ Prerequisites

- Rust (Edition 2021)
- Python 3

Install Python dependency:

pip install matplotlib

---

▶️ Running CTRP

1. Start Server

cargo run -- server

2. Start Client

cargo run -- client

---

📊 Running Visualizers

The visualizers read from:

- "logs/client.log"
- "logs/server.log"

Run:

python visualizer/congestion_graph.py
python visualizer/rtt_graph.py
python visualizer/flow_window_graph.py
python visualizer/timeline_graph.py

---

📜 Logging Format

Each event is logged as JSON:

{
  "event": "rtt_measurement",
  "ack_seq": 42,
  "rtt_ms": 15
}

---

📌 Resume Description

Designed and implemented a custom reliable transport protocol over UDP with congestion control, encryption, and real-time visualization using Rust and Python.

---

🎯 Objective

To design and simulate a custom transport protocol and gain hands-on understanding of real-world networking challenges.

---

🔮 Future Improvements

- Real socket-level optimization
- Packet-level visualization
- Performance benchmarking

---

👨‍💻 Author

Thanigaivel
