use std::net::SocketAddr;
use std::collections::BTreeMap;
use serde_json::json;

use crate::net::udp::UdpHandler;
use crate::packet::{Packet, PacketType};
use crate::crypto;
use crate::log_event;

pub async fn start_receiver(
    udp: &UdpHandler,
    session_key: &[u8; 32],
    expected_src: SocketAddr,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut expected_seq = 0;
    let mut buffer = BTreeMap::new();
    
    log_event("receiver_start", json!({
        "expected_src": expected_src.to_string()
    }));

    loop {
        let (packet, src) = udp.recv_packet().await?;
        if src != expected_src { continue; }

        if packet.ptype == PacketType::Data {
            log_event("packet_receive", json!({
                "seq_no": packet.seq_no,
                "packet_size": packet.payload.len()
            }));
            
            // Decrypt payload
            match crypto::decrypt(session_key, &packet.payload) {
                Ok(data) => {
                    if packet.seq_no >= expected_seq {
                        buffer.insert(packet.seq_no, data);
                        
                        // Advance expected sequence and process buffer
                        while let Some(d) = buffer.remove(&expected_seq) {
                            expected_seq += 1;
                            // In a real application, we might pass 'd' up the stack
                            let _ = d;
                        }
                    }
                    
                    // Always ACK the received packet
                    let ack_pkt = Packet::new(PacketType::Ack, packet.seq_no, vec![]);
                    udp.send_packet(&ack_pkt, src).await?;
                }
                Err(e) => {
                    log_event("decrypt_error", json!({"seq_no": packet.seq_no, "error": e.to_string()}));
                }
            }
        }
    }
}
