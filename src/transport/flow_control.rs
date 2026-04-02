use std::collections::BTreeMap;
use std::time::Instant;

pub struct FlowControl {
    pub base_seq: u32,
    pub next_seq: u32,
    pub unacked: BTreeMap<u32, (Vec<u8>, Instant)>,
}

impl FlowControl {
    pub fn new() -> Self {
        Self {
            base_seq: 0,
            next_seq: 0,
            unacked: BTreeMap::new(),
        }
    }

    pub fn add(&mut self, seq: u32, data: Vec<u8>) {
        self.unacked.insert(seq, (data, Instant::now()));
        self.next_seq = std::cmp::max(self.next_seq, seq + 1);
    }

    pub fn ack(&mut self, seq: u32) -> Option<Instant> {
        let sent_time = self.unacked.remove(&seq).map(|(_, t)| t);
        if let Some(&first_unacked) = self.unacked.keys().next() {
            self.base_seq = first_unacked;
        } else {
            self.base_seq = self.next_seq;
        }
        sent_time
    }

    pub fn timeout_check(&self, timeout_ms: u128) -> Option<u32> {
        let now = Instant::now();
        for (&seq, (_, sent_time)) in &self.unacked {
            if now.duration_since(*sent_time).as_millis() > timeout_ms {
                return Some(seq);
            }
        }
        None
    }
}
