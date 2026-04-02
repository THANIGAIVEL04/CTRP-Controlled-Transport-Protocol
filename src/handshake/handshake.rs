use std::net::SocketAddr;
use std::error::Error;
use serde_json::json;

use crate::crypto;
use crate::net::udp::UdpHandler;
use crate::packet::{Packet, PacketType};
use crate::log_event;

pub async fn initiate_handshake(udp: &UdpHandler, target: SocketAddr) -> Result<[u8; 32], Box<dyn Error>> {
    let session_key = crypto::generate_key();
    let packet = Packet::new(PacketType::ClientHello, 0, session_key.to_vec());
    
    log_event("handshake_start", json!({"role": "client", "target": target.to_string()}));
    
    udp.send_packet(&packet, target).await?;
    
    // Wait for ServerHello
    loop {
        let (recv_packet, src) = udp.recv_packet().await?;
        if src == target && recv_packet.ptype == PacketType::ServerHello {
            log_event("handshake_success", json!({"role": "client", "target": target.to_string()}));
            return Ok(session_key);
        }
    }
}

pub async fn accept_handshake(udp: &UdpHandler) -> Result<([u8; 32], SocketAddr), Box<dyn Error>> {
    log_event("handshake_wait", json!({"role": "server"}));
    loop {
        let (packet, src) = udp.recv_packet().await?;
        if packet.ptype == PacketType::ClientHello {
            if packet.payload.len() != 32 {
                continue;
            }
            let mut session_key = [0u8; 32];
            session_key.copy_from_slice(&packet.payload[..32]);
            
            // Send ServerHello
            let reply = Packet::new(PacketType::ServerHello, 0, vec![]);
            udp.send_packet(&reply, src).await?;
            
            log_event("handshake_success", json!({"role": "server", "client": src.to_string()}));
            
            return Ok((session_key, src));
        }
    }
}
