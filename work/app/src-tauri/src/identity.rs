// MOD ごとの匿名の ID と、署名の鍵（ADR 0040）。
// - PC ごとに秘密の値（ランダムな 32 バイト）を1つ作り、資格情報マネージャーに預ける。MOD には渡さない
// - MOD ごとの鍵は、その秘密の値と MOD の id から作る（Ed25519）。MOD の ID は、その鍵の公開鍵（64 文字の16進数）
// - 別々の MOD には別の ID が見えるので、MOD どうしで「同じ人だ」と突き合わせられない

use crate::mods::valid_id;
use ed25519_dalek::{SigningKey, VerifyingKey};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

/// 一度読んだ秘密の値（ウィンドウが複数でも、同じプロセスの中で1つ。同時に2つ作らないように、作るのもこの中で行う）
static DEVICE_SECRET: Mutex<Option<[u8; 32]>> = Mutex::new(None);

pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 16進数（小文字）を N バイトに。形が違えば None
pub fn from_hex<const N: usize>(s: &str) -> Option<[u8; N]> {
    if s.len() != N * 2 || !s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) {
        return None;
    }
    let mut out = [0u8; N];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

fn device_secret() -> Result<[u8; 32], String> {
    let mut cached = DEVICE_SECRET.lock().unwrap();
    if let Some(s) = *cached {
        return Ok(s);
    }
    let target = crate::secrets::app_target("identity");
    let secret = match crate::secrets::cred_read(&target)?.as_deref().and_then(from_hex::<32>) {
        Some(s) => s,
        None => {
            let mut s = [0u8; 32];
            getrandom::fill(&mut s).map_err(|e| format!("io: {}", e))?;
            crate::secrets::cred_write(&target, "explorer_plus", &to_hex(&s))?;
            s
        }
    };
    *cached = Some(secret);
    Ok(secret)
}

/// 秘密の値と MOD の id から、その MOD の鍵を作る（いつも同じ鍵になる）
fn derive(secret: &[u8; 32], view_id: &str) -> SigningKey {
    let mut h = Sha256::new();
    h.update(b"explorer_plus/identity/v1\0");
    h.update(secret);
    h.update(view_id.as_bytes());
    SigningKey::from_bytes(&h.finalize().into())
}

/// この PC の、その MOD の鍵
pub fn key_for(view_id: &str) -> Result<SigningKey, String> {
    if !valid_id(view_id) {
        return Err(format!("invalid: id \"{}\"", view_id));
    }
    Ok(derive(&device_secret()?, view_id))
}

/// 鍵から ID（公開鍵の16進数）
pub fn id_of(key: &SigningKey) -> String {
    to_hex(key.verifying_key().as_bytes())
}

/// ID から、署名を確かめる鍵。形が違えば None
pub fn verifying_key(id: &str) -> Option<VerifyingKey> {
    VerifyingKey::from_bytes(&from_hex::<32>(id)?).ok()
}

/// その MOD の ID（表示名・アイコンは本体の画面側が持つ）
#[tauri::command]
pub async fn identity_id(view_id: String) -> Result<String, String> {
    Ok(id_of(&key_for(&view_id)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_roundtrip() {
        assert_eq!(to_hex(&[0, 15, 255]), "000fff");
        assert_eq!(from_hex::<3>("000fff"), Some([0, 15, 255]));
        assert_eq!(from_hex::<3>("000FFF"), None, "大文字は受けない（フォルダの名前にするので、形を1つにする）");
        assert_eq!(from_hex::<3>("000ff"), None);
        assert_eq!(from_hex::<1>("zz"), None);
    }

    #[test]
    fn keys_differ_per_mod_and_are_stable() {
        let secret = [7u8; 32];
        let a = id_of(&derive(&secret, "my.board"));
        assert_eq!(a, id_of(&derive(&secret, "my.board")), "同じ MOD なら、いつも同じ ID");
        assert_ne!(a, id_of(&derive(&secret, "my.other")), "MOD が違えば別の ID");
        assert_ne!(a, id_of(&derive(&[8u8; 32], "my.board")), "PC が違えば別の ID");
        assert_eq!(a.len(), 64);
        assert!(verifying_key(&a).is_some());
        assert!(verifying_key("xyz").is_none());
    }
}
