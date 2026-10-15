// 圧縮・展開（ADR 0021）。7-Zip が入っているときだけ、右クリックのメニューに出す。中身は 7-Zip に任せる。
// 7-Zip の画面版（7zG.exe）を使うので、進み具合・取りやめ・パスワードの入力・上書きの確認は 7-Zip の画面が出す。
// - 圧縮：zip・7z。選んだ項目と同じフォルダに「最初の項目の名前.zip」を作る（同じ名前があれば「 (2)」を付ける）
// - 展開：7-Zip が読める書庫（zip・7z・rar・tar.gz など）。同じフォルダに、書庫の名前のフォルダを作って、その中に出す

use crate::fsops::{verify, EntryRef};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// 「ここに展開」を出す拡張子（7-Zip が読めるもののうち、よく使うもの）。.tar.gz などの2段のものは別に扱う
const EXTRACT_EXTS: &[&str] = &[
    "zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "tbz2", "xz", "txz", "zst", "lzh", "lha", "cab", "iso", "wim", "arj", "z",
];
/// 中に tar が入った2段の書庫（展開すると、まず .tar が出てくる）
const TAR_WRAPPED: &[&str] = &[".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz", ".tar.zst"];

fn io_err(e: impl std::fmt::Display) -> String {
    format!("io: {}", e)
}

/// 登録情報（レジストリ）に書かれた 7-Zip のフォルダ
fn registry_dir() -> Option<PathBuf> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        for name in [w!("Path64"), w!("Path")] {
            let mut buf = [0u16; 520];
            let mut size = (buf.len() * 2) as u32;
            let ok = unsafe {
                RegGetValueW(root, w!("SOFTWARE\\7-Zip"), PCWSTR(name.as_ptr()), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as _), Some(&mut size))
            };
            if ok.is_ok() {
                let len = buf.iter().position(|&c| c == 0).unwrap_or(0);
                let dir = PathBuf::from(String::from_utf16_lossy(&buf[..len]));
                if dir.join("7zG.exe").is_file() || dir.join("7z.exe").is_file() {
                    return Some(dir);
                }
            }
        }
    }
    None
}

/// 7-Zip のプログラム（画面版の 7zG.exe を優先）。入っていなければ None
fn seven_zip() -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = registry_dir().into_iter().collect();
    for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Ok(p) = std::env::var(var) {
            dirs.push(PathBuf::from(p).join("7-Zip"));
        }
    }
    dirs.iter().flat_map(|d| [d.join("7zG.exe"), d.join("7z.exe")]).find(|p| p.is_file())
}

/// 書庫の名前から、展開先のフォルダの名前（拡張子を除いた名前）を作る。展開できない名前なら None
pub fn archive_stem(name: &str) -> Option<String> {
    let lower = name.to_lowercase();
    if let Some(ext) = TAR_WRAPPED.iter().find(|e| lower.ends_with(*e) && lower.len() > e.len()) {
        return Some(name[..name.len() - ext.len()].to_string());
    }
    let (stem, ext) = name.rsplit_once('.')?;
    (!stem.is_empty() && EXTRACT_EXTS.contains(&ext.to_lowercase().as_str())).then(|| stem.to_string())
}

fn is_tar_wrapped(name: &str) -> bool {
    let lower = name.to_lowercase();
    TAR_WRAPPED.iter().any(|e| lower.ends_with(e))
}

/// dir の中で使われていない名前（"名前.ext"、なければ "名前 (2).ext" …）。ext は "" ならフォルダ
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let make = |n: u32| {
        let base = if n == 1 { stem.to_string() } else { format!("{} ({})", stem, n) };
        dir.join(if ext.is_empty() { base } else { format!("{}.{}", base, ext) })
    };
    (1..).map(make).find(|p| !p.exists()).unwrap()
}

/// 7-Zip を動かして、終わるまで待つ。コンソール版のときは黒い窓を出さない
fn run(exe: &Path, args: &[String], cwd: Option<&Path>) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new(exe);
    cmd.args(args);
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    if exe.file_name().is_some_and(|n| n.eq_ignore_ascii_case("7z.exe")) {
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let status = cmd.status().map_err(io_err)?;
    // 7-Zip の終わり方：0 うまくいった、1 注意あり（使えないファイルを飛ばした等）、255 ユーザーがやめた、ほかは失敗
    match status.code() {
        Some(0) | Some(1) => Ok(()),
        Some(255) => Err("denied: cancelled".into()),
        Some(c) => Err(format!("io: 7-Zip failed (code {})", c)),
        None => Err("io: 7-Zip stopped".into()),
    }
}

#[derive(Serialize)]
pub struct ArchiveTool {
    /// 7-Zip が入っているか（入っていなければ、メニューに圧縮・展開を出さない）
    available: bool,
    /// 「ここに展開」を出す拡張子（点なし。2段のものは "tar.gz" の形）
    extensions: Vec<String>,
}

#[tauri::command]
pub fn archive_tool() -> ArchiveTool {
    let mut extensions: Vec<String> = EXTRACT_EXTS.iter().map(|s| s.to_string()).collect();
    extensions.extend(TAR_WRAPPED.iter().map(|s| s.trim_start_matches('.').to_string()));
    ArchiveTool { available: seven_zip().is_some(), extensions }
}

/// 選んだ項目を圧縮する。format は "zip" か "7z"。作った書庫のパスを返す
#[tauri::command]
pub async fn archive_create(items: Vec<EntryRef>, format: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exe = seven_zip().ok_or("not-found: 7-Zip")?;
        if format != "zip" && format != "7z" {
            return Err(format!("invalid: format {}", format));
        }
        let sources: Vec<PathBuf> = items.iter().map(verify).collect::<Result<_, _>>()?;
        let first = sources.first().ok_or("invalid: no items")?;
        let dir = first.parent().ok_or("invalid: cannot compress a drive")?.to_path_buf();
        // 名前は最初の項目から（ファイルなら拡張子を除く。Win11 と同じ）
        let stem = if first.is_dir() { first.file_name() } else { first.file_stem() }
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "archive".into());
        let dest = unique_path(&dir, &stem, &format);
        let mut args = vec!["a".to_string(), format!("-t{}", format)];
        // zip の中の名前は UTF-8 にする（ほかの PC・Mac でも化けない）
        if format == "zip" {
            args.push("-mcu=on".into());
        }
        args.push(dest.to_string_lossy().into_owned());
        args.push("--".into());
        // 項目のフォルダで動かし、名前だけを渡す（書庫の中が「名前/…」になる）
        for s in &sources {
            args.push(s.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("invalid: name")?);
        }
        run(&exe, &args, Some(&dir))?;
        Ok(dest.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 書庫を、同じフォルダの「書庫の名前」のフォルダへ展開する。作ったフォルダのパスを返す
#[tauri::command]
pub async fn archive_extract(item: EntryRef) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exe = seven_zip().ok_or("not-found: 7-Zip")?;
        let path = verify(&item)?;
        let name = path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let stem = archive_stem(&name).ok_or_else(|| format!("invalid: not an archive ({})", name))?;
        let dest = unique_path(path.parent().ok_or("invalid")?, &stem, "");
        let out = |d: &Path| format!("-o{}", d.to_string_lossy());
        let result = if is_tar_wrapped(&name) {
            // .tar.gz などは2段：まず一時の場所に .tar を出し、それを展開先へ出す
            let tmp = std::env::temp_dir().join(format!("explorer-plus-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&tmp);
            let r = run(&exe, &["x".into(), path.to_string_lossy().into_owned(), out(&tmp), "-y".into()], None).and_then(|_| {
                let tar = std::fs::read_dir(&tmp)
                    .map_err(io_err)?
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .find(|p| p.is_file())
                    .ok_or("invalid: empty archive")?;
                run(&exe, &["x".into(), tar.to_string_lossy().into_owned(), out(&dest)], None)
            });
            let _ = std::fs::remove_dir_all(&tmp);
            r
        } else {
            run(&exe, &["x".into(), path.to_string_lossy().into_owned(), out(&dest)], None)
        };
        if result.is_err() {
            // やめた・失敗したときは、展開のために作ったフォルダ（ほかの物は入っていない）を片付ける
            let _ = std::fs::remove_dir_all(&dest);
        }
        result.map(|_| dest.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stems() {
        assert_eq!(archive_stem("課題.ZIP").as_deref(), Some("課題"));
        assert_eq!(archive_stem("a.tar.gz").as_deref(), Some("a"));
        assert_eq!(archive_stem("a.tgz").as_deref(), Some("a"));
        assert_eq!(archive_stem("写真.7z").as_deref(), Some("写真"));
        assert_eq!(archive_stem("x.rar").as_deref(), Some("x"));
        assert_eq!(archive_stem("report.docx"), None);
        assert_eq!(archive_stem(".zip"), None);
        assert_eq!(archive_stem("noext"), None);
        assert!(is_tar_wrapped("A.TAR.GZ") && !is_tar_wrapped("a.gz"));
    }

    #[test]
    fn unique_names() {
        let d = std::env::temp_dir().join(format!("ep-archive-unique-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        assert_eq!(unique_path(&d, "x", "zip"), d.join("x.zip"));
        std::fs::write(d.join("x.zip"), "").unwrap();
        assert_eq!(unique_path(&d, "x", "zip"), d.join("x (2).zip"));
        std::fs::create_dir(d.join("x")).unwrap();
        assert_eq!(unique_path(&d, "x", ""), d.join("x (2)"));
    }

    /// この PC に 7-Zip があれば、実際に圧縮・展開して確かめる（無ければ何もしない）
    #[test]
    fn round_trip_with_7zip_if_installed() {
        let Some(exe) = seven_zip() else { return };
        // 画面版は窓が出るので、試験ではコンソール版を使う
        let exe = exe.with_file_name("7z.exe");
        if !exe.is_file() {
            return;
        }
        let d = std::env::temp_dir().join(format!("ep-archive-rt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("資料/中")).unwrap();
        std::fs::write(d.join("資料/中/レポート.txt"), "あいう").unwrap();
        for fmt in ["zip", "7z"] {
            let dest = d.join(format!("out.{}", fmt));
            // -mcu=on（名前を UTF-8 に）は zip だけの指定（archive_create と同じ）
            let mut args = vec!["a".to_string(), format!("-t{}", fmt)];
            if fmt == "zip" {
                args.push("-mcu=on".into());
            }
            args.extend([dest.to_string_lossy().into_owned(), "--".into(), "資料".into()]);
            run(&exe, &args, Some(&d)).unwrap();
            let out = d.join(format!("x-{}", fmt));
            run(&exe, &["x".into(), dest.to_string_lossy().into_owned(), format!("-o{}", out.to_string_lossy())], None).unwrap();
            assert_eq!(std::fs::read_to_string(out.join("資料/中/レポート.txt")).unwrap(), "あいう");
        }
    }
}
