use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, OnceLock};
use chrono::Utc;
use serde_json::{json, Value};

pub mod crypto;
pub mod handshake;
pub mod net;
pub mod packet;
pub mod transport;

use handshake::{accept_handshake, initiate_handshake};
use net::udp::UdpHandler;
use transport::{receiver::start_receiver, sender::start_sender};

static LOG_FILE: OnceLock<Arc<Mutex<std::fs::File>>> = OnceLock::new();

pub fn init_logger(role: &str) {
    fs::create_dir_all("logs").unwrap();
    let filename = format!("logs/{}.log", role);
    let _file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&filename)
        .unwrap();
    
    // Clear out for new session
    let file_clear = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(&filename)
        .unwrap();
    
    LOG_FILE.set(Arc::new(Mutex::new(file_clear))).unwrap();
}

pub fn log_event(event: &str, mut details: Value) {
    let timestamp = Utc::now().timestamp_millis();
    if let Value::Object(ref mut map) = details {
        map.insert("event".to_string(), Value::String(event.to_string()));
        map.insert("timestamp".to_string(), Value::Number(timestamp.into()));
    }
    
    let log_str = format!("{}\n", serde_json::to_string(&details).unwrap());
    if let Some(file_mtx) = LOG_FILE.get() {
        if let Ok(mut file) = file_mtx.lock() {
            let _ = file.write_all(log_str.as_bytes());
            let _ = file.flush();
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        println!("Usage: ctrp server [bind_addr] | ctrp client [target_addr]");
        return Ok(());
    }

    let mode = args[1].as_str();

    match mode {
        "server" => {
            let bind_addr = args.get(2).map(|s| s.as_str()).unwrap_or("127.0.0.1:8080");
            init_logger("server");
            log_event("status", json!({"msg": format!("Server binding to {}", bind_addr)}));

            let udp = UdpHandler::bind(bind_addr).await?;
            let (session_key, peer_addr) = accept_handshake(&udp).await?;
            log_event("status", json!({"msg": "Handshake successful, starting receiver."}));

            start_receiver(&udp, &session_key, peer_addr).await?;
        }
        "client" => {
            let target_addr = args.get(2).map(|s| s.as_str()).unwrap_or("127.0.0.1:8080");
            init_logger("client");
            log_event("status", json!({"msg": format!("Client connecting to {}", target_addr)}));

            let udp = UdpHandler::bind("127.0.0.1:0").await?;
            let target: SocketAddr = target_addr.parse()?;

            let session_key = initiate_handshake(&udp, target).await?;
            log_event("status", json!({"msg": "Handshake successful, starting sender."}));

            // Create some dummy data
            let mut data = Vec::new();
            for i in 0..100 {
                data.extend_from_slice(format!("CTRP reliable message block {}. ", i).as_bytes());
            }

            start_sender(&udp, &session_key, target, &data).await?;
        }
        _ => {
            println!("Usage: ctrp server [bind_addr] | ctrp client [target_addr]");
        }
    }

    Ok(())
}
