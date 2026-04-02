use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::UdpSocket;
use crate::packet::Packet;

#[derive(Clone)]
pub struct UdpHandler {
    socket: Arc<UdpSocket>,
}

impl UdpHandler {
    pub async fn bind(addr: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let socket = UdpSocket::bind(addr).await?;
        Ok(Self {
            socket: Arc::new(socket),
        })
    }

    pub async fn send_packet(&self, packet: &Packet, dest: SocketAddr) -> Result<(), Box<dyn std::error::Error>> {
        let bytes = packet.to_bytes()?;
        self.socket.send_to(&bytes, dest).await?;
        Ok(())
    }

    pub async fn recv_packet(&self) -> Result<(Packet, SocketAddr), Box<dyn std::error::Error>> {
        let mut buf = vec![0u8; 65535];
        let (len, src) = self.socket.recv_from(&mut buf).await?;
        let packet = Packet::from_bytes(&buf[..len])?;
        Ok((packet, src))
    }
}
