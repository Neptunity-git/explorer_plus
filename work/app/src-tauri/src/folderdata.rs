// フォルダの中に置くデータ（ADR 0022）。時間割・ノートなど「そのフォルダについてのデータ」を、フォルダの中の
// 隠しフォルダ .explorer_plus に JSON で置く。OneDrive などで同期すれば、別の PC の explorer_plus でも同じものが出る。
// フォルダの一覧には出さない（fsops::listed）。普通のエクスプローラでも、隠しフォルダなので普段は見えない。

use crate::fsops::{verify, EntryRef};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

/// フォルダの中のデータの置き場所
pub const DATA_DIR: &str = ".explorer_plus";
/// 1つのデータの大きさの上限（ビューの保存場所と同じ）
const MAX_BYTES: usize = 1024 * 1024;

fn io_err(e: impl std::fmt::Display) -> String {
    format!("io: {}", e)
}

/// データの名前：英小文字・数字・. - _ だけ（パスに使うので）。例 "timetable"・"view.builtin.notes"
fn valid_name(name: &str) -> bool {
    (1..=100).contains(&name.len())
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || ".-_".contains(c))
        && !name.starts_with('.')
}

fn data_file(folder: &EntryRef, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err(format!("invalid: name {}", name));
    }
    let dir = verify(folder)?;
    if !dir.is_dir() {
        return Err(format!("invalid: not a folder {}", dir.display()));
    }
    Ok(dir.join(DATA_DIR).join(format!("{}.json", name)))
}

/// 置き場所のフォルダに「隠し」の印を付ける（普通のエクスプローラでも普段は見えないように）
fn mark_hidden(dir: &Path) {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_FLAGS_AND_ATTRIBUTES};
    let w: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        let attrs = GetFileAttributesW(PCWSTR(w.as_ptr()));
        if attrs != u32::MAX && attrs & FILE_ATTRIBUTE_HIDDEN.0 == 0 {
            let _ = SetFileAttributesW(PCWSTR(w.as_ptr()), FILE_FLAGS_AND_ATTRIBUTES(attrs | FILE_ATTRIBUTE_HIDDEN.0));
        }
    }
}

pub fn read(file: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(file) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_err(e)),
    }
}

/// 書き込みは、隣に書いてから置き換える（途中で止まっても、前のものが壊れないように。同期の道具にも半端なファイルを見せない）
pub fn write(file: &Path, text: &str) -> Result<(), String> {
    if text.len() > MAX_BYTES {
        return Err(format!("too-large: {} bytes", text.len()));
    }
    let dir = file.parent().ok_or("invalid")?;
    std::fs::create_dir_all(dir).map_err(|e| if e.kind() == std::io::ErrorKind::PermissionDenied { format!("denied: {}", e) } else { io_err(e) })?;
    mark_hidden(dir);
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| if e.kind() == std::io::ErrorKind::PermissionDenied { format!("denied: {}", e) } else { io_err(e) })?;
    std::fs::rename(&tmp, file).map_err(io_err)
}

pub fn delete(file: &Path) -> Result<(), String> {
    match std::fs::remove_file(file) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(io_err(e)),
    }
    // 置き場所が空になったら片付ける（ほかのデータがあれば消えない）
    if let Some(dir) = file.parent() {
        let _ = std::fs::remove_dir(dir);
    }
    Ok(())
}

#[tauri::command]
pub async fn folder_data_read(folder: EntryRef, name: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || read(&data_file(&folder, &name)?)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn folder_data_write(folder: EntryRef, name: String, text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write(&data_file(&folder, &name)?, &text)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn folder_data_delete(folder: EntryRef, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete(&data_file(&folder, &name)?)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert!(valid_name("timetable"));
        assert!(valid_name("view.builtin.notes"));
        assert!(valid_name("view.my.size-bars"));
        assert!(!valid_name(""));
        assert!(!valid_name("../x"));
        assert!(!valid_name("a/b"));
        assert!(!valid_name("A"));
        assert!(!valid_name(".hidden"));
    }

    #[test]
    fn write_read_delete_and_hidden() {
        use std::os::windows::fs::MetadataExt;
        let d = std::env::temp_dir().join(format!("ep-folderdata-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join(DATA_DIR).join("timetable.json");
        assert_eq!(read(&f).unwrap(), None);
        write(&f, "{\"a\":1}").unwrap();
        assert_eq!(read(&f).unwrap().as_deref(), Some("{\"a\":1}"));
        let attrs = std::fs::metadata(d.join(DATA_DIR)).unwrap().file_attributes();
        assert!(attrs & 0x2 != 0, "置き場所は隠しフォルダ");
        assert!(!crate::fsops::listed(DATA_DIR, attrs), "一覧には出さない");
        assert!(crate::fsops::listed("普通の隠しフォルダ", 0x2 | 0x10), "ほかの隠し項目は出す");
        assert!(!crate::fsops::listed("desktop.ini", 0x2 | 0x4), "隠し＋システムは出さない");
        delete(&f).unwrap();
        assert!(!d.join(DATA_DIR).exists(), "空になった置き場所は片付ける");
        assert!(write(&f, &"x".repeat(MAX_BYTES + 1)).unwrap_err().starts_with("too-large"));
    }
}
