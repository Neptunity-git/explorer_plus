// MOD の秘密の設定（API キーなど。ADR 0027）を、Windows の「資格情報マネージャー」に預ける。
// - 値を書く・消す・「あるかどうか」を調べるのは本体（設定の画面）だけ。値そのものを MOD に渡す口は無い
// - 値を使うのは、本体が MOD の代わりに通信するとき（netproxy.rs）だけ。manifest に書いた宛先にだけ付ける
// 資格情報の名前は "explorer_plus:<ビューの id>:<設定の key>"（開発中のアプリは "explorer_plus-dev:..."。普段使いの値と混ざらないように）

use crate::mods::valid_id;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Security::Credentials::{CredDeleteW, CredEnumerateW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_FLAGS, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC};

#[cfg(debug_assertions)]
const PREFIX: &str = "explorer_plus-dev";
#[cfg(not(debug_assertions))]
const PREFIX: &str = "explorer_plus";

/// 秘密の値の長さの上限（文字）
pub const SECRET_MAX: usize = 2000;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 設定の key の形（TypeScript の src/core/settings.ts と同じ）
pub fn valid_key(key: &str) -> bool {
    let mut c = key.chars();
    matches!(c.next(), Some(f) if f.is_ascii_alphabetic()) && key.len() <= 32 && c.all(|x| x.is_ascii_alphanumeric() || x == '_')
}

/// 値の形：前後の空白を除いて 1〜2000 文字の、表示できる ASCII（ヘッダや URL にそのまま入れられるもの）
pub fn valid_value(v: &str) -> bool {
    !v.is_empty() && v.len() <= SECRET_MAX && v.bytes().all(|b| (0x20..=0x7e).contains(&b))
}

fn target(view_id: &str, key: &str) -> Result<String, String> {
    if !valid_id(view_id) || !valid_key(key) {
        return Err(format!("invalid: secret {}:{}", view_id, key));
    }
    Ok(format!("{}:{}:{}", PREFIX, view_id, key))
}

pub fn read(view_id: &str, key: &str) -> Result<Option<String>, String> {
    cred_read(&target(view_id, key)?)
}

fn write(view_id: &str, key: &str, value: &str) -> Result<(), String> {
    cred_write(&target(view_id, key)?, view_id, value)
}

/// 本体だけが使う値（MOD の id と重ならない名前。@ は MOD の id に使えない）。例 "identity" → "explorer_plus:@identity"（ADR 0040）
pub(crate) fn app_target(name: &str) -> String {
    format!("{}:@{}", PREFIX, name)
}

/// 資格情報マネージャーから読む。無ければ None
pub(crate) fn cred_read(target_name: &str) -> Result<Option<String>, String> {
    let name = wide(target_name);
    let mut cred: *mut CREDENTIALW = std::ptr::null_mut();
    // 無いときはエラー（ERROR_NOT_FOUND）で返ってくる
    if unsafe { CredReadW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, None, &mut cred) }.is_err() || cred.is_null() {
        return Ok(None);
    }
    let value = unsafe {
        let c = &*cred;
        let bytes = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize).to_vec();
        CredFree(cred as *const _);
        bytes
    };
    Ok(String::from_utf8(value).ok())
}

pub(crate) fn cred_write(target_name: &str, user_name: &str, value: &str) -> Result<(), String> {
    let mut name = wide(target_name);
    let mut user = wide(user_name);
    let mut blob = value.as_bytes().to_vec();
    let cred = CREDENTIALW {
        Flags: CRED_FLAGS(0),
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(name.as_mut_ptr()),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: PWSTR(user.as_mut_ptr()),
        ..Default::default()
    };
    unsafe { CredWriteW(&cred, 0) }.map_err(|e| format!("io: {}", e))
}

fn delete(view_id: &str, key: &str) -> Result<(), String> {
    let name = wide(&target(view_id, key)?);
    // 無いものを消すのは、うまくいったことにする
    let _ = unsafe { CredDeleteW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, None) };
    Ok(())
}

/// 秘密の値を預ける。value が null なら消す
#[tauri::command]
pub async fn secret_set(view_id: String, key: String, value: Option<String>) -> Result<(), String> {
    match value.map(|v| v.trim().to_string()) {
        Some(v) if !valid_value(&v) => Err("invalid: a secret must be 1-2000 printable ASCII characters".into()),
        Some(v) => write(&view_id, &key, &v),
        None => delete(&view_id, &key),
    }
}

/// それぞれの key の値が預けてあるか（値そのものは返さない）
#[tauri::command]
pub async fn secret_status(view_id: String, keys: Vec<String>) -> Result<Vec<bool>, String> {
    keys.iter().map(|k| read(&view_id, k).map(|v| v.is_some())).collect()
}

/// その MOD の秘密の値をすべて消す（MOD を外したとき）
#[tauri::command]
pub async fn secret_clear(view_id: String) -> Result<(), String> {
    if !valid_id(&view_id) {
        return Err(format!("invalid: id \"{}\"", view_id));
    }
    let filter = wide(&format!("{}:{}:*", PREFIX, view_id));
    let mut count = 0u32;
    let mut list: *mut *mut CREDENTIALW = std::ptr::null_mut();
    if unsafe { CredEnumerateW(PCWSTR(filter.as_ptr()), None, &mut count, &mut list) }.is_err() || list.is_null() {
        return Ok(());
    }
    let names: Vec<Vec<u16>> = unsafe {
        let items = std::slice::from_raw_parts(list, count as usize);
        let names = items.iter().map(|c| (**c).TargetName.as_wide().iter().copied().chain(std::iter::once(0)).collect()).collect();
        CredFree(list as *const _);
        names
    };
    for n in names {
        let _ = unsafe { CredDeleteW(PCWSTR(n.as_ptr()), CRED_TYPE_GENERIC, None) };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shapes() {
        assert!(valid_key("apiKey") && valid_key("a_1"));
        assert!(!valid_key("1a") && !valid_key("") && !valid_key("a-b"));
        assert!(valid_value("abc DEF-123_+/="));
        assert!(!valid_value("") && !valid_value("a\nb") && !valid_value("キー") && !valid_value(&"x".repeat(2001)));
        assert!(target("my.view", "apiKey").unwrap().ends_with(":my.view:apiKey"));
        assert!(target("../x", "apiKey").is_err());
    }

    #[test]
    fn write_read_clear() {
        let id = "test.secrets-roundtrip";
        write(id, "apiKey", "k-123").unwrap();
        write(id, "other", "v").unwrap();
        assert_eq!(read(id, "apiKey").unwrap().as_deref(), Some("k-123"));
        tauri::async_runtime::block_on(secret_clear(id.into())).unwrap();
        assert_eq!(read(id, "apiKey").unwrap(), None);
        assert_eq!(read(id, "other").unwrap(), None);
    }
}
