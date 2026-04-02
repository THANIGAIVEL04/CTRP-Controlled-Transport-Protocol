use std::convert::TryInto;
use std::error::Error;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PacketType {
    ClientHello,
    ServerHello,
    Data,
    Ack,
    Probe,
    Unknown,
}

impl PacketType {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => PacketType::ClientHello,
            1 => PacketType::ServerHello,
            2 => PacketType::Data,
            3 => PacketType::Ack,
            4 => PacketType::Probe,
            _ => PacketType::Unknown,
        }
    }

    pub fn to_u8(self) -> u8 {
        match self {
            PacketType::ClientHello => 0,
            PacketType::ServerHello => 1,
            PacketType::Data => 2,
            PacketType::Ack => 3,
            PacketType::Probe => 4,
            PacketType::Unknown => 255,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Packet {
    pub ptype: PacketType,
    pub seq_no: u32,
    pub payload: Vec<u8>,
}

impl Packet {
    pub fn new(ptype: PacketType, seq_no: u32, payload: Vec<u8>) -> Self {
        Self {
            ptype,
            seq_no,
            payload,
        }
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, Box<dyn Error>> {
        let mut buf = Vec::new();
        buf.push(self.ptype.to_u8());
        buf.extend_from_slice(&self.seq_no.to_be_bytes());
        let len = self.payload.len() as u32;
        buf.extend_from_slice(&len.to_be_bytes());
        buf.extend_from_slice(&self.payload);
        Ok(buf)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Box<dyn Error>> {
        if bytes.len() < 9 {
            return Err("Packet too short".into());
        }
        let ptype = PacketType::from_u8(bytes[0]);
        let seq_no = u32::from_be_bytes(bytes[1..5].try_into()?);
        let len = u32::from_be_bytes(bytes[5..9].try_into()?) as usize;
        
        if bytes.len() < 9 + len {
            return Err("Packet body incomplete".into());
        }
        
        let payload = bytes[9..9 + len].to_vec();
        Ok(Self { ptype, seq_no, payload })
    }
}
