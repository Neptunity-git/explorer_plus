// ファイルシステムの操作：フォルダの一覧（ファイルID 付き）、フォルダの合計の大きさ、リンクの解決、開く、ごみ箱。
// 拡張子・並び順・アイコンの種類などの「見せ方の判断」は TypeScript の src/core に任せ、ここでは Windows から事実だけを取る。

use serde::{Deserialize, Serialize};
use std::os::windows::ffi::OsStringExt;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use windows::Win32::Foundation::{CloseHandle, ERROR_NO_MORE_FILES, HANDLE};
use windows::Win32::Storage::FileSystem::{
    FileIdExtdDirectoryInfo, FileIdExtdDirectoryRestartInfo, FileIdInfo, GetFileInformationByHandleEx,
    GetFinalPathNameByHandleW, OpenFileById, ExtendedFileIdType, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_HIDDEN,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_ID_128, FILE_ID_DESCRIPTOR, FILE_ID_DESCRIPTOR_0,
    FILE_ID_EXTD_DIR_INFO, FILE_ID_INFO, FILE_NAME_NORMALIZED, GETFINALPATHNAMEBYHANDLE_FLAGS, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    VOLUME_NAME_DOS,
};

const FILE_READ_ATTRIBUTES: u32 = 0x80;
const FILE_LIST_DIRECTORY: u32 = 0x1;
/// FILETIME（1601年からの100ナノ秒）と、1970年からのミリ秒の差
const FILETIME_UNIX_EPOCH: i64 = 116_444_736_000_000_000;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RawEntry {
    /// ファイルID。取れないドライブ（FAT の USB メモリなど）では ""
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub hidden: bool,
    /// バイト。フォルダは 0
    pub size: u64,
    /// 1970年からのミリ秒
    pub modified: i64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RawFolder {
    /// フォルダ自身のファイルID（取れなければ ""）
    pub id: String,
    pub path: String,
    pub name: String,
    pub parent_path: Option<String>,
    pub entries: Vec<RawEntry>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct EntryRef {
    pub id: String,
    pub path: String,
}

fn id_string(volume_serial: u64, id: &FILE_ID_128) -> String {
    let hex: String = id.Identifier.iter().rev().map(|b| format!("{:02x}", b)).collect();
    format!("{:016x}:{}", volume_serial, hex)
}

fn parse_id(id: &str) -> Option<(u64, [u8; 16])> {
    let (vol, file) = id.split_once(':')?;
    if vol.len() != 16 || file.len() != 32 {
        return None;
    }
    let volume = u64::from_str_radix(vol, 16).ok()?;
    let mut bytes = [0u8; 16];
    for i in 0..16 {
        // id_string は上位バイトから書いているので、逆順に戻す
        bytes[15 - i] = u8::from_str_radix(&file[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some((volume, bytes))
}

fn filetime_to_unix_ms(ft: i64) -> i64 {
    (ft - FILETIME_UNIX_EPOCH) / 10_000
}

fn open_for_attributes(path: &Path, extra_access: u32) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES | extra_access)
        .share_mode(7)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0)
        .open(path)
}

fn handle_id_info(file: &std::fs::File) -> windows::core::Result<FILE_ID_INFO> {
    let mut info = FILE_ID_INFO::default();
    unsafe {
        GetFileInformationByHandleEx(
            HANDLE(file.as_raw_handle()),
            FileIdInfo,
            &mut info as *mut _ as *mut _,
            std::mem::size_of::<FILE_ID_INFO>() as u32,
        )?;
    }
    Ok(info)
}

/// 1つのファイル・フォルダのファイルID。取れなければ None
pub fn file_id(path: &Path) -> Option<String> {
    let f = open_for_attributes(path, 0).ok()?;
    let info = handle_id_info(&f).ok()?;
    Some(id_string(info.VolumeSerialNumber, &info.FileId))
}

pub fn display_name(path: &Path) -> String {
    match path.file_name() {
        Some(n) => n.to_string_lossy().into_owned(),
        // ドライブの直下（"C:\"）は "C:"
        None => path.to_string_lossy().trim_end_matches('\\').to_string(),
    }
}

/// フォルダの中身を、ファイルID 付きでまとめて読む（FileIdExtdDirectoryInfo）。
/// NTFS・ReFS 以外で使えなければ、1件ずつ読むやり方に切り替える。
pub fn read_dir(dir: &Path) -> Result<Vec<RawEntry>, String> {
    match read_dir_bulk(dir) {
        Ok(v) => Ok(v),
        Err(_) => read_dir_fallback(dir),
    }
}

fn read_dir_bulk(dir: &Path) -> Result<Vec<RawEntry>, String> {
    let f = open_for_attributes(dir, FILE_LIST_DIRECTORY).map_err(|e| e.to_string())?;
    let volume = handle_id_info(&f).map_err(|e| e.to_string())?.VolumeSerialNumber;
    let handle = HANDLE(f.as_raw_handle());
    // FILE_ID_EXTD_DIR_INFO は 8 バイト境界に置く必要がある
    let mut buf = vec![0u64; 64 * 1024 / 8];
    let mut out = Vec::new();
    let mut first = true;
    loop {
        let class = if first { FileIdExtdDirectoryRestartInfo } else { FileIdExtdDirectoryInfo };
        first = false;
        let r = unsafe {
            GetFileInformationByHandleEx(handle, class, buf.as_mut_ptr() as *mut _, (buf.len() * 8) as u32)
        };
        if let Err(e) = r {
            if e.code() == ERROR_NO_MORE_FILES.to_hresult() {
                break;
            }
            return Err(e.to_string());
        }
        let base = buf.as_ptr() as *const u8;
        let mut offset = 0usize;
        loop {
            let info = unsafe { &*(base.add(offset) as *const FILE_ID_EXTD_DIR_INFO) };
            let name_len = info.FileNameLength as usize / 2;
            let name_ptr = unsafe { (base.add(offset) as *const FILE_ID_EXTD_DIR_INFO as *const u8).add(
                std::mem::offset_of!(FILE_ID_EXTD_DIR_INFO, FileName),
            ) as *const u16 };
            let name_u16 = unsafe { std::slice::from_raw_parts(name_ptr, name_len) };
            let name = std::ffi::OsString::from_wide(name_u16).to_string_lossy().into_owned();
            if name != "." && name != ".." {
                let attrs = info.FileAttributes;
                let is_dir = attrs & FILE_ATTRIBUTE_DIRECTORY.0 != 0;
                out.push(RawEntry {
                    id: id_string(volume, &info.FileId),
                    path: dir.join(&name).to_string_lossy().into_owned(),
                    name,
                    is_dir,
                    hidden: attrs & FILE_ATTRIBUTE_HIDDEN.0 != 0,
                    size: if is_dir { 0 } else { info.EndOfFile.max(0) as u64 },
                    modified: filetime_to_unix_ms(info.LastWriteTime),
                });
            }
            if info.NextEntryOffset == 0 {
                break;
            }
            offset += info.NextEntryOffset as usize;
        }
    }
    Ok(out)
}

fn read_dir_fallback(dir: &Path) -> Result<Vec<RawEntry>, String> {
    use std::os::windows::fs::MetadataExt;
    let mut out = Vec::new();
    for item in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let Ok(item) = item else { continue };
        let Ok(meta) = item.metadata() else { continue };
        let path = item.path();
        let is_dir = meta.is_dir();
        out.push(RawEntry {
            id: file_id(&path).unwrap_or_default(),
            name: item.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            is_dir,
            hidden: meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN.0 != 0,
            size: if is_dir { 0 } else { meta.len() },
            modified: filetime_to_unix_ms(meta.last_write_time() as i64),
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn list_dir(path: String) -> Result<RawFolder, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        if !p.is_dir() {
            return Err(format!("not-found: {}", path));
        }
        Ok(RawFolder {
            id: file_id(&p).unwrap_or_default(),
            name: display_name(&p),
            parent_path: p.parent().map(|x| x.to_string_lossy().into_owned()),
            entries: read_dir(&p)?,
            path,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// フォルダの中身の合計の大きさ。リパースポイント（ジャンクション・シンボリックリンク）の先はたどらない（無限ループを防ぐ）。
/// 読めないフォルダは飛ばす。
pub fn folder_size(dir: &Path) -> u64 {
    let mut total = 0u64;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = read_dir(&d) else { continue };
        for e in entries {
            if e.is_dir {
                let p = PathBuf::from(&e.path);
                let is_reparse = std::fs::symlink_metadata(&p)
                    .map(|m| {
                        use std::os::windows::fs::MetadataExt;
                        m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
                    })
                    .unwrap_or(true);
                if !is_reparse {
                    stack.push(p);
                }
            } else {
                total += e.size;
            }
        }
    }
    total
}

#[tauri::command]
pub async fn folder_sizes(paths: Vec<String>) -> Result<Vec<u64>, String> {
    tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| folder_size(Path::new(p))).collect())
        .await
        .map_err(|e| e.to_string())
}

/// ファイルID から今のパスを引く。ref.path のドライブを手がかりに、そのボリュームの中を探す。
fn path_by_id(r: &EntryRef) -> Option<String> {
    let (volume, bytes) = parse_id(&r.id)?;
    let root: String = r.path.chars().take(3).collect(); // "C:\"
    if !root.ends_with(":\\") {
        return None;
    }
    let vol = open_for_attributes(Path::new(&root), 0).ok()?;
    if handle_id_info(&vol).ok()?.VolumeSerialNumber != volume {
        return None;
    }
    let desc = FILE_ID_DESCRIPTOR {
        dwSize: std::mem::size_of::<FILE_ID_DESCRIPTOR>() as u32,
        Type: ExtendedFileIdType,
        Anonymous: FILE_ID_DESCRIPTOR_0 { ExtendedFileId: FILE_ID_128 { Identifier: bytes } },
    };
    let h = unsafe {
        OpenFileById(
            HANDLE(vol.as_raw_handle()),
            &desc,
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            FILE_FLAG_BACKUP_SEMANTICS,
        )
    }
    .ok()?;
    let mut buf = vec![0u16; 32768];
    let n = unsafe { GetFinalPathNameByHandleW(h, &mut buf, GETFINALPATHNAMEBYHANDLE_FLAGS(FILE_NAME_NORMALIZED.0 | VOLUME_NAME_DOS.0)) } as usize;
    unsafe {
        let _ = CloseHandle(h);
    }
    if n == 0 || n > buf.len() {
        return None;
    }
    let s = String::from_utf16_lossy(&buf[..n]);
    Some(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string())
}

fn entry_at(path: &Path, id: String) -> Option<RawEntry> {
    use std::os::windows::fs::MetadataExt;
    let meta = std::fs::metadata(path).ok()?;
    let is_dir = meta.is_dir();
    Some(RawEntry {
        id,
        name: display_name(path),
        path: path.to_string_lossy().into_owned(),
        is_dir,
        hidden: meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN.0 != 0,
        size: if is_dir { 0 } else { meta.len() },
        modified: filetime_to_unix_ms(meta.last_write_time() as i64),
    })
}

/// ref を今の場所に解決する。まず保存しておいたパスを見て、ID が一致すればそれ。違えば ID から探す。
pub fn resolve_one(r: &EntryRef) -> Option<RawEntry> {
    if r.id.is_empty() {
        // ID が取れないドライブのものは、パスだけで探す
        return entry_at(Path::new(&r.path), String::new());
    }
    let p = Path::new(&r.path);
    if file_id(p).as_deref() == Some(r.id.as_str()) {
        return entry_at(p, r.id.clone());
    }
    let now = path_by_id(r)?;
    entry_at(Path::new(&now), r.id.clone())
}

/// パスの一覧から、それぞれのファイルID を引く（取れなければ ""）。時間割にフォルダを結びつけるときに使う
#[tauri::command]
pub async fn file_ids(paths: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| file_id(Path::new(p)).unwrap_or_default()).collect())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resolve(refs: Vec<EntryRef>) -> Result<Vec<Option<RawEntry>>, String> {
    tauri::async_runtime::spawn_blocking(move || refs.iter().map(resolve_one).collect())
        .await
        .map_err(|e| e.to_string())
}

/// MOD から頼まれた ref が、本当にそのファイルを指しているかを確かめる。
/// ID が一致しないもの（MOD が適当なパスを作って渡したもの）は断る。
fn verify(r: &EntryRef) -> Result<PathBuf, String> {
    let p = PathBuf::from(&r.path);
    if !p.exists() {
        return Err(format!("not-found: {}", r.path));
    }
    let actual = file_id(&p).unwrap_or_default();
    if actual != r.id {
        return Err(format!("denied: id does not match {}", r.path));
    }
    Ok(p)
}

#[tauri::command]
pub fn open_entry(app: tauri::AppHandle, item: EntryRef) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let p = verify(&item)?;
    app.opener()
        .open_path(p.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("io: {}", e))
}

#[tauri::command]
pub async fn trash_entries(items: Vec<EntryRef>) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = items.iter().map(verify).collect::<Result<Vec<_>, _>>()?;
        trash::delete_all(&paths).map_err(|e| format!("io: {}", e))?;
        Ok(paths.len())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 名前に区切りやドライブ指定が入っていないか（フォルダの外を指す名前を断る）。
/// Windows の名前の決まりの細かい検査は TypeScript（src/core/names.ts）が行う
fn plain_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." || name.contains(['\\', '/', ':', '\0']) {
        return Err(format!("invalid: bad name \"{}\"", name));
    }
    Ok(())
}

#[tauri::command]
pub async fn rename_entry(item: EntryRef, new_name: String) -> Result<RawEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        plain_name(&new_name)?;
        let from = verify(&item)?;
        let parent = from.parent().ok_or("invalid: cannot rename a drive")?;
        let to = parent.join(&new_name);
        // 同じものを指していれば（大文字・小文字だけの変更）許す。別のものなら「既にある」
        if to.exists() && file_id(&to).unwrap_or_default() != item.id {
            return Err(format!("exists: {}", to.display()));
        }
        std::fs::rename(&from, &to).map_err(|e| format!("io: {}", e))?;
        entry_at(&to, file_id(&to).unwrap_or_default()).ok_or_else(|| "io: renamed but cannot read".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_folder(parent: String, name: String) -> Result<RawEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        plain_name(&name)?;
        let dir = PathBuf::from(&parent);
        if !dir.is_dir() {
            return Err(format!("not-found: {}", parent));
        }
        let target = dir.join(&name);
        std::fs::create_dir(&target).map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => format!("exists: {}", target.display()),
            _ => format!("io: {}", e),
        })?;
        entry_at(&target, file_id(&target).unwrap_or_default()).ok_or_else(|| "io: created but cannot read".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    /// "drive" か、よく使うフォルダの種類（"desktop" など）
    pub kind: String,
    pub name: String,
    pub path: String,
}

fn known_folder(id: &windows::core::GUID) -> Option<String> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    unsafe {
        let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const _));
        s
    }
}

/// ドライブと、よく使うフォルダ（OneDrive に移されていても正しい場所を返す）
#[tauri::command]
pub fn list_places() -> Vec<Place> {
    use windows::Win32::Storage::FileSystem::GetLogicalDrives;
    use windows::Win32::UI::Shell::{
        FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Downloads, FOLDERID_Music, FOLDERID_Pictures,
        FOLDERID_Profile, FOLDERID_Videos,
    };
    let mut out = Vec::new();
    for (kind, id) in [
        ("home", &FOLDERID_Profile),
        ("desktop", &FOLDERID_Desktop),
        ("documents", &FOLDERID_Documents),
        ("downloads", &FOLDERID_Downloads),
        ("pictures", &FOLDERID_Pictures),
        ("music", &FOLDERID_Music),
        ("videos", &FOLDERID_Videos),
    ] {
        if let Some(path) = known_folder(id) {
            out.push(Place { kind: kind.into(), name: display_name(Path::new(&path)), path });
        }
    }
    let mask = unsafe { GetLogicalDrives() };
    for i in 0..26 {
        if mask & (1 << i) != 0 {
            let letter = (b'A' + i as u8) as char;
            out.push(Place { kind: "drive".into(), name: format!("{}:", letter), path: format!("{}:\\", letter) });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("explorer-plus-test-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn id_round_trip() {
        let id = FILE_ID_128 { Identifier: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] };
        let s = id_string(0xabc, &id);
        assert_eq!(s, "0000000000000abc:100f0e0d0c0b0a090807060504030201");
        let (vol, bytes) = parse_id(&s).unwrap();
        assert_eq!(vol, 0xabc);
        assert_eq!(bytes, id.Identifier);
        assert!(parse_id("zz").is_none());
        assert!(parse_id("0000000000000abc:00").is_none());
    }

    #[test]
    fn read_dir_bulk_matches_file_id() {
        let d = temp_dir("readdir");
        std::fs::write(d.join("a.txt"), "hello").unwrap();
        std::fs::create_dir(d.join("sub")).unwrap();
        // NTFS の一時フォルダでは、まとめて読む方（切り替え先ではない方）が動くこと
        let mut entries = read_dir_bulk(&d).unwrap();
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        let mut fallback = read_dir_fallback(&d).unwrap();
        fallback.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(
            entries.iter().map(|e| (&e.id, e.size, e.modified)).collect::<Vec<_>>(),
            fallback.iter().map(|e| (&e.id, e.size, e.modified)).collect::<Vec<_>>()
        );
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "a.txt");
        assert_eq!(entries[0].size, 5);
        assert!(!entries[0].is_dir);
        assert!(entries[1].is_dir);
        assert_eq!(Some(entries[0].id.clone()), file_id(&d.join("a.txt")));
        assert!(entries[0].modified > 1_700_000_000_000);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn resolve_follows_rename_and_move() {
        let d = temp_dir("resolve");
        std::fs::create_dir(d.join("sub")).unwrap();
        let a = d.join("a.txt");
        std::fs::write(&a, "x").unwrap();
        let r = EntryRef { id: file_id(&a).unwrap(), path: a.to_string_lossy().into_owned() };
        let moved = d.join("sub").join("b.txt");
        std::fs::rename(&a, &moved).unwrap();
        let found = resolve_one(&r).unwrap();
        assert_eq!(found.name, "b.txt");
        assert!(found.path.ends_with(r"sub\b.txt"));
        std::fs::remove_file(&moved).unwrap();
        assert!(resolve_one(&r).is_none());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn verify_rejects_wrong_id() {
        let d = temp_dir("verify");
        let a = d.join("a.txt");
        let b = d.join("b.txt");
        std::fs::write(&a, "x").unwrap();
        std::fs::write(&b, "y").unwrap();
        let wrong = EntryRef { id: file_id(&a).unwrap(), path: b.to_string_lossy().into_owned() };
        assert!(verify(&wrong).unwrap_err().starts_with("denied"));
        let right = EntryRef { id: file_id(&b).unwrap(), path: b.to_string_lossy().into_owned() };
        assert!(verify(&right).is_ok());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn folder_size_sums_nested_files() {
        let d = temp_dir("size");
        std::fs::create_dir_all(d.join("x").join("y")).unwrap();
        std::fs::write(d.join("a"), vec![0u8; 100]).unwrap();
        std::fs::write(d.join("x").join("b"), vec![0u8; 20]).unwrap();
        std::fs::write(d.join("x").join("y").join("c"), vec![0u8; 3]).unwrap();
        assert_eq!(folder_size(&d), 123);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn root_names() {
        assert_eq!(display_name(Path::new("C:\\")), "C:");
        assert_eq!(display_name(Path::new("C:\\Users")), "Users");
        assert!(Path::new("C:\\").parent().is_none());
    }

    #[test]
    fn rename_and_create() {
        let d = temp_dir("rename");
        let a = d.join("a.txt");
        std::fs::write(&a, "x").unwrap();
        std::fs::write(d.join("taken.txt"), "y").unwrap();
        let r = EntryRef { id: file_id(&a).unwrap(), path: a.to_string_lossy().into_owned() };
        use tauri::async_runtime::block_on as rt;
        assert!(rt(rename_entry(r.clone(), "taken.txt".into())).unwrap_err().starts_with("exists"));
        assert!(rt(rename_entry(r.clone(), r"..\evil.txt".into())).unwrap_err().starts_with("invalid"));
        // 大文字・小文字だけの変更は通る
        let e = rt(rename_entry(r.clone(), "A.txt".into())).unwrap();
        assert_eq!(e.name, "A.txt");
        assert_eq!(e.id, r.id);
        let parent = d.to_string_lossy().into_owned();
        let f = rt(create_folder(parent.clone(), "新しいフォルダー".into())).unwrap();
        assert!(f.is_dir);
        assert!(rt(create_folder(parent.clone(), "新しいフォルダー".into())).unwrap_err().starts_with("exists"));
        assert!(rt(create_folder(parent, "a/b".into())).unwrap_err().starts_with("invalid"));
        let _ = std::fs::remove_dir_all(&d);
    }
}
