use std::net::SocketAddr;
use std::time::Duration;
use tokio::time::sleep;
use serde_json::json;

use crate::net::udp::UdpHandler;
use crate::packet::{Packet, PacketType};
use crate::crypto;
use crate::transport::flow_control::FlowControl;
use crate::transport::congestion::CongestionControl;
use crate::log_event;

pub async fn start_sender(
    udp: &UdpHandler,
    session_key: &[u8; 32],
    target: SocketAddr,
    data: &[u8],
) -> Result<(), Box<dyn std::error::Error>> {
    let mut flow = FlowControl::new();
    let mut congest = CongestionControl::new();
    let chunk_size = 1024;
    let total_chunks = (data.len() + chunk_size - 1) / chunk_size;

    let mut current_chunk = 0;
    
    log_event("sender_start", json!({
        "total_chunks": total_chunks,
        "target": target.to_string()
    }));

    while flow.base_seq < total_chunks as u32 {
        while flow.next_seq < flow.base_seq + congest.window_size 
              && current_chunk < total_chunks {
            
            let start = current_chunk * chunk_size;
            let end = std::cmp::min(data.len(), start + chunk_size);
            let chunk = &data[start..end];
            
            let encrypted = crypto::encrypt(session_key, chunk)?;
            let packet = Packet::new(PacketType::Data, current_chunk as u32, encrypted.clone());
            
            udp.send_packet(&packet, target).await?;
            flow.add(current_chunk as u32, encrypted);
            
            log_event("packet_send", json!({
                "seq_no": current_chunk,
                "packet_size": packet.payload.len()
            }));
            
            current_chunk += 1;
        }
        
        let recv_fut = udp.recv_packet();
        let timeout_result = tokio::time::timeout(Duration::from_millis(100), recv_fut).await;
        
        match timeout_result {
            Ok(Ok((packet, src))) => {
                if src == target && packet.ptype == PacketType::Ack {
                    if let Some(sent_time) = flow.ack(packet.seq_no) {
                        let rtt = sent_time.elapsed().as_millis();
                        congest.on_ack();
                        
                        log_event("packet_ack", json!({
                            "seq_no": packet.seq_no,
                            "rtt": rtt,
                            "window": congest.window_size
                        }));
                    }
                }
            }
            Ok(Err(_e)) => { continue; }
            Err(_) => {
                if let Some(loss_seq) = flow.timeout_check(300) {
                    congest.on_timeout_or_loss();
                    if let Some((payload, _)) = flow.unacked.get(&loss_seq) {
                        let pkt = Packet::new(PacketType::Data, loss_seq, payload.clone());
                        let _ = udp.send_packet(&pkt, target).await;
                        log_event("retransmit", json!({
                            "seq_no": loss_seq,
                            "window": congest.window_size
                        }));
                        flow.unacked.insert(loss_seq, (payload.clone(), std::time::Instant::now()));
                    }
                }
            }
        }
    }

    log_event("sender_done", json!({
        "msg": "All data sent and acked."
    }));
    
    sleep(Duration::from_millis(100)).await;
    Ok(())
}
