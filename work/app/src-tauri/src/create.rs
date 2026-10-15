// MOD が新しいファイル・フォルダ・ショートカットを作る（ADR 0025）。作るだけで、今あるものを書き換えたり消したりはしない。
// 許可（MOD ごとに最初の1回）は本体（TypeScript）が聞く。ここは名前の検査と、上書きしない作り方を受け持つ。

use crate::fsops::{entry_at, file_id, verify, EntryRef, RawEntry};
use base64::Engine;
use std::io::Write;
use std::path::{Path, PathBuf};

/// 作るファイルの大きさの上限
const MAX_BYTES: usize = 16 * 1024 * 1024;

/// Windows で使える名前か（使えない文字・予約された名前・末尾の点と空白・長すぎ）
pub fn valid_windows_name(name: &str) -> bool {
    if name.is_empty() || name.chars().count() > 200 || name.ends_with('.') || name.ends_with(' ') {
        return false;
    }
    if name.chars().any(|c| (c as u32) < 32 || "<>:\"/\\|?*".contains(c)) {
        return false;
    }
    let stem = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit() && stem.as_bytes()[3] != b'0');
    !reserved
}

fn target_in(folder: &EntryRef, name: &str) -> Result<PathBuf, String> {
    if !valid_windows_name(name) {
        return Err(format!("invalid: bad name \"{}\"", name));
    }
    let dir = verify(folder)?;
    if !dir.is_dir() {
        return Err("invalid: not a folder".into());
    }
    Ok(dir.join(name))
}

fn created(path: &Path) -> Result<RawEntry, String> {
    entry_at(path, file_id(path).unwrap_or_default()).ok_or_else(|| "io: created but cannot read".to_string())
}

/// 上書きしないで書く（同じ名前があれば "exists"）
pub fn write_new(path: &Path, data: &[u8]) -> Result<(), String> {
    if data.len() > MAX_BYTES {
        return Err(format!("too-large: {} bytes", data.len()));
    }
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!("exists: {}", path.display()),
        std::io::ErrorKind::PermissionDenied => format!("denied: {}", e),
        _ => format!("io: {}", e),
    })?;
    f.write_all(data).map_err(|e| format!("io: {}", e))
}

/// 新しいファイル（中身は文字か base64）・フォルダを作る。kind は "file" か "folder"
#[tauri::command]
pub async fn create_entry(folder: EntryRef, name: String, kind: String, text: Option<String>, base64: Option<String>) -> Result<RawEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = target_in(&folder, &name)?;
        match kind.as_str() {
            "folder" => std::fs::create_dir(&path).map_err(|e| match e.kind() {
                std::io::ErrorKind::AlreadyExists => format!("exists: {}", path.display()),
                _ => format!("io: {}", e),
            })?,
            "file" => {
                let data = match (text, base64) {
                    (Some(t), None) => t.into_bytes(),
                    (None, Some(b)) => base64::engine::general_purpose::STANDARD.decode(b).map_err(|_| "invalid: bad base64".to_string())?,
                    (None, None) => Vec::new(),
                    _ => return Err("invalid: give text or bytes, not both".into()),
                };
                write_new(&path, &data)?
            }
            _ => return Err(format!("invalid: kind {}", kind)),
        }
        created(&path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// ショートカット（.lnk）を作る。name は ".lnk" を付けない名前（省略は「元の名前 - ショートカット」）
#[tauri::command]
pub async fn create_shortcut(folder: EntryRef, target: EntryRef, name: Option<String>) -> Result<RawEntry, String> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    tauri::async_runtime::spawn_blocking(move || {
        let to = verify(&target)?;
        let base = name.unwrap_or_else(|| format!("{} - ショートカット", to.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
        let path = target_in(&folder, &format!("{}.lnk", base))?;
        if path.exists() {
            return Err(format!("exists: {}", path.display()));
        }
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|e| format!("io: {}", e))?;
            link.SetPath(&HSTRING::from(to.as_os_str())).map_err(|e| format!("io: {}", e))?;
            if let Some(dir) = to.parent() {
                let _ = link.SetWorkingDirectory(&HSTRING::from(dir.as_os_str()));
            }
            let file: IPersistFile = link.cast().map_err(|e| format!("io: {}", e))?;
            file.Save(&HSTRING::from(path.as_os_str()), true).map_err(|e| format!("io: {}", e))?;
        }
        created(&path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_names() {
        assert!(valid_windows_name("レポート.txt"));
        assert!(valid_windows_name("a b"));
        assert!(!valid_windows_name(""));
        assert!(!valid_windows_name("a/b"));
        assert!(!valid_windows_name("what?.txt"));
        assert!(!valid_windows_name("CON"));
        assert!(!valid_windows_name("nul.txt"));
        assert!(!valid_windows_name("COM1.log"));
        assert!(valid_windows_name("COM0"));
        assert!(valid_windows_name("CONSOLE.txt"));
        assert!(!valid_windows_name("trailing."));
        assert!(!valid_windows_name("trailing "));
    }

    #[test]
    fn never_overwrites() {
        let d = std::env::temp_dir().join(format!("ep-create-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("a.txt");
        write_new(&f, b"first").unwrap();
        assert!(write_new(&f, b"second").unwrap_err().starts_with("exists"));
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "first");
        assert!(write_new(&d.join("big.bin"), &vec![0u8; MAX_BYTES + 1]).unwrap_err().starts_with("too-large"));
    }
}
