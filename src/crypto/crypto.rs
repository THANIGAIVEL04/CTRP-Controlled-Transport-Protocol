use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use std::error::Error;

pub fn generate_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    key
}

pub fn encrypt(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, Box<dyn Error>> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("Invalid key length: {:?}", e))?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let mut ciphertext = cipher.encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption error: {:?}", e))?;
    
    // Prepend nonce
    let mut result = nonce_bytes.to_vec();
    result.append(&mut ciphertext);
    Ok(result)
}

pub fn decrypt(key: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, Box<dyn Error>> {
    if ciphertext.len() < 12 {
        return Err("Ciphertext too short".into());
    }

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("Invalid key length: {:?}", e))?;
    let nonce = Nonce::from_slice(&ciphertext[..12]);
    let actual_ciphertext = &ciphertext[12..];

    let plaintext = cipher.decrypt(nonce, actual_ciphertext)
        .map_err(|e| format!("Decryption error: {:?}", e))?;
    
    Ok(plaintext)
}
