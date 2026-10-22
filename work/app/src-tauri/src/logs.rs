// ログ（ADR 0029）。本体のログと、MOD ごとのログを、アプリのデータの logs フォルダにファイルで残す。
//   logs/app.log          … explorer_plus 本体
//   logs/mod.<id>.log     … MOD ごと（console.log・エラー・その MOD が本体に頼んだこと）
// 1行が1件（JSON の文字列。中身の形は TypeScript の src/core/logs.ts が決める）。
// 大きくなりすぎないよう、1MB を超えたら古いもの（.old.log）に入れ替える。
// 人が読む・人に渡すためのファイルは、ホームの「ファイルで開く」が logs/app.txt・logs/mod.<id>.txt に書き出す（ADR 0038）。

use crate::mods::{data_root, valid_id};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;

const FILE_MAX: u64 = 1024 * 1024;
const TAIL_MAX_BYTES: u64 = 512 * 1024;
const LINE_MAX: usize = 8 * 1024;

/// 書き込みを1つずつにする（同じファイルへの書き込みが混ざらないように）
static WRITE_LOCK: Mutex<()> = Mutex::new(());

fn io_err(e: impl std::fmt::Display) -> String {
    format!("io: {}", e)
}

/// ログの出どころ（"app" か MOD の id）から、ファイルの名前を決める
fn file_name(source: &str) -> Result<String, String> {
    if source == "app" {
        Ok("app.log".into())
    } else if valid_id(source) {
        Ok(format!("mod.{}.log", source))
    } else {
        Err(format!("invalid: log source \"{}\"", source))
    }
}

/// "mod.x.log" の拡張子 .log を ext に替えた名前（"mod.x.old.log"・"mod.x.txt" など）。
/// id に ".log" が入っていても（"my.logger" など）、後ろの拡張子だけを替える
fn with_ext(name: &str, ext: &str) -> String {
    format!("{}{}", name.strip_suffix(".log").unwrap_or(name), ext)
}

fn logs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_root(app)?.join("logs"))
}

fn append_to(dir: &std::path::Path, source: &str, lines: &[String]) -> Result<(), String> {
    let name = file_name(source)?;
    std::fs::create_dir_all(dir).map_err(io_err)?;
    let path = dir.join(&name);
    let _g = WRITE_LOCK.lock().unwrap();
    if std::fs::metadata(&path).map(|m| m.len() > FILE_MAX).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join(with_ext(&name, ".old.log")));
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(io_err)?;
    let mut buf = String::new();
    for l in lines {
        // 改行を含む行は、ファイルの1行に収まるよう除く（JSON の文字列なら、もともと含まない）
        let mut l: String = l.chars().filter(|c| *c != '\n' && *c != '\r').collect();
        if l.len() > LINE_MAX {
            let mut cut = LINE_MAX;
            while !l.is_char_boundary(cut) {
                cut -= 1;
            }
            l.truncate(cut);
        }
        buf.push_str(&l);
        buf.push('\n');
    }
    f.write_all(buf.as_bytes()).map_err(io_err)
}

fn tail_of(dir: &std::path::Path, source: &str, max: usize) -> Result<Vec<String>, String> {
    let path = dir.join(file_name(source)?);
    let Ok(mut f) = std::fs::File::open(&path) else { return Ok(Vec::new()) };
    let len = f.metadata().map_err(io_err)?.len();
    let start = len.saturating_sub(TAIL_MAX_BYTES);
    f.seek(SeekFrom::Start(start)).map_err(io_err)?;
    let mut bytes = Vec::new();
    f.read_to_end(&mut bytes).map_err(io_err)?;
    let text = String::from_utf8_lossy(&bytes);
    let mut lines: Vec<&str> = text.lines().collect();
    // 途中から読んだときは、最初の1行は欠けているので捨てる
    if start > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    let skip = lines.len().saturating_sub(max);
    Ok(lines[skip..].iter().filter(|l| !l.is_empty()).map(|l| l.to_string()).collect())
}

/// ログを書き足す（lines は1件ずつの文字列）
#[tauri::command]
pub async fn log_append(app: AppHandle, source: String, lines: Vec<String>) -> Result<(), String> {
    let dir = logs_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || append_to(&dir, &source, &lines)).await.map_err(|e| e.to_string())?
}

/// 新しい方から max 件まで（古い順に並べて返す）
#[tauri::command]
pub async fn log_tail(app: AppHandle, source: String, max: usize) -> Result<Vec<String>, String> {
    let dir = logs_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || tail_of(&dir, &source, max.min(5000))).await.map_err(|e| e.to_string())?
}

/// ログが残っている MOD の id
#[tauri::command]
pub fn log_sources(app: AppHandle) -> Result<Vec<String>, String> {
    let Ok(items) = std::fs::read_dir(logs_dir(&app)?) else { return Ok(Vec::new()) };
    let mut out: Vec<String> = items
        .filter_map(|i| i.ok())
        .filter_map(|i| {
            let n = i.file_name().to_string_lossy().into_owned();
            n.strip_prefix("mod.").and_then(|r| r.strip_suffix(".log")).filter(|id| !id.ends_with(".old") && valid_id(id)).map(String::from)
        })
        .collect();
    out.sort();
    Ok(out)
}

/// ログを消す（古いものも、書き出した読みやすい文字のファイルも）
#[tauri::command]
pub fn log_clear(app: AppHandle, source: String) -> Result<(), String> {
    let dir = logs_dir(&app)?;
    clear_in(&dir, &source)
}

fn clear_in(dir: &std::path::Path, source: &str) -> Result<(), String> {
    let name = file_name(source)?;
    let _g = WRITE_LOCK.lock().unwrap();
    let _ = std::fs::remove_file(dir.join(&name));
    let _ = std::fs::remove_file(dir.join(with_ext(&name, ".old.log")));
    let _ = std::fs::remove_file(dir.join(with_ext(&name, ".txt")));
    Ok(())
}

/// ログのフォルダ（「ログのフォルダ」を開くのに使う。まだ無ければ作る）
#[tauri::command]
pub fn log_dir(app: AppHandle) -> Result<String, String> {
    let dir = logs_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(io_err)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// 人が読む文字のファイルを書き出し（前に書き出したものは置き換える）、そのパスを返す。
/// text の形は TypeScript の src/core/logs.ts（toText）が決める
fn export_to(dir: &std::path::Path, source: &str, text: &str) -> Result<PathBuf, String> {
    let path = dir.join(with_ext(&file_name(source)?, ".txt"));
    std::fs::create_dir_all(dir).map_err(io_err)?;
    let _g = WRITE_LOCK.lock().unwrap();
    std::fs::write(&path, text).map_err(io_err)?;
    Ok(path)
}

#[tauri::command]
pub async fn log_export(app: AppHandle, source: String, text: String) -> Result<String, String> {
    let dir = logs_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || export_to(&dir, &source, &text).map(|p| p.to_string_lossy().into_owned()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ep-logs-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn names() {
        assert_eq!(file_name("app").unwrap(), "app.log");
        assert_eq!(file_name("my.view").unwrap(), "mod.my.view.log");
        assert!(file_name("../x").is_err());
    }

    #[test]
    fn append_and_tail() {
        let d = dir("tail");
        append_to(&d, "app", &["a".into(), "b\nc".into()]).unwrap();
        append_to(&d, "app", &["d".into()]).unwrap();
        assert_eq!(tail_of(&d, "app", 10).unwrap(), vec!["a", "bc", "d"]);
        assert_eq!(tail_of(&d, "app", 2).unwrap(), vec!["bc", "d"]);
        assert!(tail_of(&d, "my.view", 10).unwrap().is_empty());
    }

    #[test]
    fn with_ext_only_changes_the_end() {
        assert_eq!(with_ext("app.log", ".txt"), "app.txt");
        assert_eq!(with_ext("mod.my.logger.log", ".old.log"), "mod.my.logger.old.log");
        assert_eq!(with_ext("mod.my.logger.log", ".txt"), "mod.my.logger.txt");
    }

    #[test]
    fn export_replaces_and_clear_removes_all() {
        let d = dir("export");
        append_to(&d, "my.logger", &["a".into()]).unwrap();
        let p = export_to(&d, "my.logger", "one\r\n").unwrap();
        assert_eq!(p, d.join("mod.my.logger.txt"));
        export_to(&d, "my.logger", "two\r\n").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "two\r\n");
        assert!(export_to(&d, "../x", "no").is_err());
        clear_in(&d, "my.logger").unwrap();
        assert!(!p.exists());
        assert!(!d.join("mod.my.logger.log").exists());
    }

    #[test]
    fn rotates_when_large() {
        let d = dir("rotate");
        let big = "x".repeat(LINE_MAX);
        for _ in 0..(FILE_MAX as usize / LINE_MAX + 2) {
            append_to(&d, "app", &[big.clone()]).unwrap();
        }
        assert!(d.join("app.old.log").exists());
        assert!(std::fs::metadata(d.join("app.log")).unwrap().len() <= FILE_MAX);
    }
}
