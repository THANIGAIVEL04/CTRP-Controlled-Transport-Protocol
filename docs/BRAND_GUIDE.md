# CTRP Brand Identity Guide v2.0
**Controlled Transport Protocol — Protocol Suite Identity**

## 1. Visual Philosophy
The CTRP brand identity is built around the anatomy of a network packet. It moves away from generic "high-tech" visuals toward specific **Protocol Visual Metaphors**: Handshakes, Flow Windows, and RTT Waveforms.

## 2. Protocol Color Palette
The primary colors are mapped directly to protocol events.

| Event / Component | Hex | Usage |
|-------------------|-----|-------|
| **SYN Blue** | `#4F8DFB` | Handshakes, Outgoing Data, Primary Action |
| **ACK Green** | `#34D399` | Acknowledgments, Window Increases, Health |
| **Payload Purple**| `#A855F7` | Encrypted Frames, Secure Streams, Probes |
| **RTT Orange** | `#F59E0B` | Latency Dynamics, Round-Trip Probes, Jitter |
| **Congestion Red**| `#EF4444` | Packet Loss, Throttling, Transmission Errors |
| **Encrypted Silver**| `#D1D5DB` | Primary Text, Inactive States, Frame Borders |
| **Transport Dark** | `#0A0A0F` | Page Background, Terminal Surface |

## 3. Topography & Typography
Standardizing on technical, readable typefaces.
- **Display**: `Inter` (Extra Bold for Titles)
- **Interface**: `IBM Plex Sans` (UI Components, Buttons)
- **Telemetry**: `JetBrains Mono` (Logs, JSON, Hex Views)

## 4. Design Metadata
- **Frame Cards**: All components used a "Framed Packet" border (`1px solid var(--layer-border)`).
- **Glint & Glow**: Component interactive states use a soft 8px glow (`rgba(79, 141, 251, 0.4)`).
- **Transitions**: Smooth 0.4s-0.8s bezier curves represent network stability.

## 5. File Assets
- **Logo**: `/dashboard/logo/ctrp_logo.svg`
- **Splash**: `/dashboard/splash/`
- **Theme**: `/dashboard/protocol_theme.css`
