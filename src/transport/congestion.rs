use serde_json::json;
use crate::log_event;

pub struct CongestionControl {
    pub window_size: u32,
    pub ssthresh: u32,
    pub in_slow_start: bool,
}

impl CongestionControl {
    pub fn new() -> Self {
        Self {
            window_size: 1, // Start with 1 packet
            ssthresh: 64,   // Default slow start threshold
            in_slow_start: true,
        }
    }

    pub fn on_ack(&mut self) {
        if self.in_slow_start {
            self.window_size += 1;
            if self.window_size >= self.ssthresh {
                self.in_slow_start = false;
            }
        } else {
            // Congestion avoidance phase, simple linear increase
            self.window_size += 1; 
        }

        // Limit window
        if self.window_size > 1024 {
            self.window_size = 1024;
        }
        
        log_event("window_update", json!({
            "window": self.window_size,
        }));
    }

    pub fn on_timeout_or_loss(&mut self) {
        // Multiplicative decrease
        self.ssthresh = std::cmp::max(self.window_size / 2, 1);
        self.window_size = 1;
        self.in_slow_start = true;
        
        // Emitting event: "congestion" ensures we hit the requirement
        // "Congestion event graph (red markers)" in dashboard can listen for this.
        log_event("congestion", json!({
            "window": self.window_size,
            "ssthresh": self.ssthresh,
            "congestion": true
        }));
    }
}
