// ファイルの中身を MOD に渡す（ADR 0023）。読むだけ。
// - 文章として読む（files.readText）・バイトで読む（files.readBytes）：大きさに上限がある
// - ファイルの URL（files.url）：画像・動画・音楽などを MOD の画面にそのまま出すための、使い捨ての URL。
//   URL の中は推測できないランダムな印（トークン）で、本体が「ファイルID が合うことを確かめた項目」にだけ発行する。
//   配るのは独自の通信先 http://epfile.localhost/<トークン>/<ファイル名>（動画・音楽のシークのため Range に対応）。

use crate::fsops::{verify, EntryRef};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::http::{Request, Response, StatusCode};

/// 文章・バイトで読む大きさの上限
pub const TEXT_MAX_BYTES: u64 = 8 * 1024 * 1024;
pub const BYTES_MAX: u64 = 16 * 1024 * 1024;
/// 発行しておく URL の数の上限（超えたら古いものから無効にする）
const MAX_TOKENS: usize = 4000;
/// 1回の応答で返す大きさの上限（動画の Range もこの大きさずつ）
const CHUNK_MAX: u64 = 16 * 1024 * 1024;
/// Range なしで全部返してよいファイルの大きさの上限
const WHOLE_MAX: u64 = 256 * 1024 * 1024;

fn io_err(e: impl std::fmt::Display) -> String {
    format!("io: {}", e)
}

#[derive(Default)]
pub struct FileTokens {
    inner: Mutex<TokenMap>,
}

#[derive(Default)]
struct TokenMap {
    map: HashMap<String, PathBuf>,
    order: VecDeque<String>,
}

impl FileTokens {
    fn issue(&self, path: PathBuf) -> String {
        let mut raw = [0u8; 16];
        getrandom::fill(&mut raw).expect("random");
        let token: String = raw.iter().map(|b| format!("{:02x}", b)).collect();
        let mut g = self.inner.lock().unwrap();
        g.map.insert(token.clone(), path);
        g.order.push_back(token.clone());
        while g.order.len() > MAX_TOKENS {
            if let Some(old) = g.order.pop_front() {
                g.map.remove(&old);
            }
        }
        token
    }

    fn lookup(&self, token: &str) -> Option<PathBuf> {
        self.inner.lock().unwrap().map.get(token).cloned()
    }
}

fn mime_of(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg" | "jfif") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("svg") => "image/svg+xml",
        Some("mp4" | "m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("ogv") => "video/ogg",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg" | "oga" | "opus") => "audio/ogg",
        Some("flac") => "audio/flac",
        Some("m4a" | "aac") => "audio/mp4",
        Some("pdf") => "application/pdf",
        Some("json") => "application/json",
        Some("glb") => "model/gltf-binary",
        Some("gltf") => "model/gltf+json",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        // ページとして実行されないよう、HTML やスクリプトも文字として返す
        Some("txt" | "md" | "csv" | "html" | "htm" | "css" | "js" | "mjs" | "xml" | "log" | "yaml" | "yml" | "toml" | "ini") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

fn regular_file(item: &EntryRef) -> Result<PathBuf, String> {
    let p = verify(item)?;
    if !p.is_file() {
        return Err(format!("invalid: not a file {}", p.display()));
    }
    Ok(p)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRead {
    text: String,
    /// ファイル全体の大きさ（バイト）
    size: u64,
    /// 読んだバイト数（offset から）
    bytes_read: u64,
    /// まだ続きがあるか
    truncated: bool,
    /// "utf-8"・"utf-16le"・"utf-16be"・"shift_jis"
    encoding: String,
}

/// 文字コードを見分けて文字にする：BOM があればそれ、なければ UTF-8 として読めるか、読めなければ Shift_JIS（日本語の Windows の古いファイル）
fn decode(bytes: &[u8], at_start: bool, truncated: bool) -> (String, &'static str, usize) {
    if at_start {
        if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
            return decode_utf8(rest, truncated, bytes.len() - rest.len());
        }
        if bytes.starts_with(&[0xFF, 0xFE]) {
            let (s, _, _) = encoding_rs::UTF_16LE.decode(&bytes[2..]);
            return (s.into_owned(), "utf-16le", bytes.len());
        }
        if bytes.starts_with(&[0xFE, 0xFF]) {
            let (s, _, _) = encoding_rs::UTF_16BE.decode(&bytes[2..]);
            return (s.into_owned(), "utf-16be", bytes.len());
        }
    }
    let (text, enc, used) = decode_utf8(bytes, truncated, 0);
    if enc == "utf-8" {
        return (text, enc, used);
    }
    let (s, _) = encoding_rs::SHIFT_JIS.decode_without_bom_handling(bytes);
    (s.into_owned(), "shift_jis", bytes.len())
}

/// UTF-8 として読む。途中で切れているだけ（最後の文字が中途半端）なら、その手前までを使う。それ以外の不正があれば "" と別の印を返す
fn decode_utf8(bytes: &[u8], truncated: bool, skipped: usize) -> (String, &'static str, usize) {
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_string(), "utf-8", bytes.len() + skipped),
        Err(e) if truncated && e.error_len().is_none() => {
            let ok = &bytes[..e.valid_up_to()];
            (String::from_utf8_lossy(ok).into_owned(), "utf-8", ok.len() + skipped)
        }
        Err(_) => (String::new(), "invalid", 0),
    }
}

pub fn read_text(path: &Path, offset: u64, max: u64) -> Result<TextRead, String> {
    let max = max.clamp(1, TEXT_MAX_BYTES);
    let mut f = std::fs::File::open(path).map_err(io_err)?;
    let size = f.metadata().map_err(io_err)?.len();
    f.seek(SeekFrom::Start(offset.min(size))).map_err(io_err)?;
    let mut buf = Vec::new();
    f.take(max).read_to_end(&mut buf).map_err(io_err)?;
    let truncated = offset + (buf.len() as u64) < size;
    let (text, encoding, used) = decode(&buf, offset == 0, truncated);
    // UTF-8 の途中で切った分は、「読んだ」に数えない（続きを読むとき、そこから始められるように）
    let bytes_read = if encoding == "utf-8" || encoding == "invalid" { used as u64 } else { buf.len() as u64 };
    Ok(TextRead { text, size, bytes_read, truncated, encoding: encoding.to_string() })
}

#[tauri::command]
pub async fn file_read_text(item: EntryRef, offset: u64, max_bytes: u64) -> Result<TextRead, String> {
    tauri::async_runtime::spawn_blocking(move || read_text(&regular_file(&item)?, offset, max_bytes)).await.map_err(|e| e.to_string())?
}

/// バイトのまま返す。JSON を通さず、そのままのバイト列（ArrayBuffer）で届ける
#[tauri::command]
pub async fn file_read_bytes(item: EntryRef, offset: u64, length: u64) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = regular_file(&item)?;
        let mut f = std::fs::File::open(path).map_err(io_err)?;
        f.seek(SeekFrom::Start(offset)).map_err(io_err)?;
        let mut buf = Vec::new();
        f.take(length.min(BYTES_MAX)).read_to_end(&mut buf).map_err(io_err)?;
        Ok(tauri::ipc::Response::new(buf))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// ファイルの URL を発行する。ファイルID が合う項目にだけ発行する
#[tauri::command]
pub fn file_url(tokens: tauri::State<'_, FileTokens>, item: EntryRef) -> Result<String, String> {
    let path = regular_file(&item)?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let token = tokens.issue(path);
    Ok(format!("http://{}/{}/{}", FILE_HOST, token, percent_encode(&name)))
}

/// MOD の画面から見た、ファイルの配信元（Windows では http://<名前>.localhost になる）
pub const FILE_HOST: &str = "epfile.localhost";

fn status(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(code).header("Access-Control-Allow-Origin", "*").body(Vec::new()).unwrap()
}

/// Range ヘッダ（"bytes=a-b"・"bytes=a-"・"bytes=-n"）を、読む範囲 [start, end]（端を含む）にする
fn parse_range(header: &str, total: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    let (a, b) = spec.split_once('-')?;
    if total == 0 {
        return None;
    }
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        (total.saturating_sub(n), total - 1)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() { total - 1 } else { b.parse::<u64>().ok()?.min(total - 1) };
        (start, end)
    };
    (start <= end && start < total).then_some((start, end))
}

pub fn handle(tokens: &FileTokens, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = request.uri().path().trim_start_matches('/');
    let Some((token, _name)) = path.split_once('/') else { return status(StatusCode::NOT_FOUND) };
    let Some(file) = tokens.lookup(token) else { return status(StatusCode::NOT_FOUND) };
    let Ok(mut f) = std::fs::File::open(&file) else { return status(StatusCode::NOT_FOUND) };
    let Ok(meta) = f.metadata() else { return status(StatusCode::NOT_FOUND) };
    let total = meta.len();
    let range = request.headers().get("range").and_then(|v| v.to_str().ok()).map(|h| (h, parse_range(h, total)));
    let (start, end, partial) = match range {
        Some((_, Some((s, e)))) => (s, e.min(s + CHUNK_MAX - 1), true),
        Some((_, None)) => {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header("Content-Range", format!("bytes */{}", total))
                .header("Access-Control-Allow-Origin", "*")
                .body(Vec::new())
                .unwrap()
        }
        None if total > WHOLE_MAX => return status(StatusCode::PAYLOAD_TOO_LARGE),
        None => (0, total.saturating_sub(1), false),
    };
    let mut body = Vec::new();
    if total > 0 {
        if f.seek(SeekFrom::Start(start)).is_err() || f.take(end - start + 1).read_to_end(&mut body).is_err() {
            return status(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
    let mut b = Response::builder()
        .status(if partial { StatusCode::PARTIAL_CONTENT } else { StatusCode::OK })
        .header("Content-Type", mime_of(&file))
        .header("Accept-Ranges", "bytes")
        .header("X-Content-Type-Options", "nosniff")
        .header("Access-Control-Allow-Origin", "*")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .header("Cache-Control", "no-store");
    if partial {
        b = b.header("Content-Range", format!("bytes {}-{}/{}", start, end, total));
    }
    b.body(body).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ep-fileapi-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=900-", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=500-5000", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=9-3", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
        assert_eq!(parse_range("bytes=0-", 0), None);
    }

    #[test]
    fn decodes_text() {
        let d = temp("text");
        // UTF-8（BOM 付き）・Shift_JIS・UTF-16LE
        std::fs::write(d.join("a.txt"), [&[0xEF, 0xBB, 0xBF][..], "こんにちは".as_bytes()].concat()).unwrap();
        let r = read_text(&d.join("a.txt"), 0, 1000).unwrap();
        assert_eq!((r.text.as_str(), r.encoding.as_str(), r.truncated), ("こんにちは", "utf-8", false));
        let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode("日本語のメモ");
        std::fs::write(d.join("b.txt"), &*sjis).unwrap();
        let r = read_text(&d.join("b.txt"), 0, 1000).unwrap();
        assert_eq!((r.text.as_str(), r.encoding.as_str()), ("日本語のメモ", "shift_jis"));
        let utf16: Vec<u8> = [0xFF, 0xFE].into_iter().chain("あい".encode_utf16().flat_map(|u| u.to_le_bytes())).collect();
        std::fs::write(d.join("c.txt"), utf16).unwrap();
        assert_eq!(read_text(&d.join("c.txt"), 0, 1000).unwrap().text, "あい");
    }

    #[test]
    fn truncation_stops_at_character_boundary_and_continues() {
        let d = temp("trunc");
        std::fs::write(d.join("a.txt"), "あいうえお".as_bytes()).unwrap(); // 15 バイト
        let first = read_text(&d.join("a.txt"), 0, 7).unwrap(); // 「あい」＋「う」の途中
        assert_eq!(first.text, "あい");
        assert_eq!(first.bytes_read, 6);
        assert!(first.truncated);
        let rest = read_text(&d.join("a.txt"), first.bytes_read, 100).unwrap();
        assert_eq!(rest.text, "うえお");
        assert!(!rest.truncated);
    }

    #[test]
    fn tokens_are_unique_and_evicted() {
        let t = FileTokens::default();
        let a = t.issue(PathBuf::from("a"));
        let b = t.issue(PathBuf::from("a"));
        assert_ne!(a, b);
        assert_eq!(a.len(), 32);
        assert_eq!(t.lookup(&a), Some(PathBuf::from("a")));
        for i in 0..MAX_TOKENS {
            t.issue(PathBuf::from(format!("{}", i)));
        }
        assert_eq!(t.lookup(&a), None, "古いものから無効になる");
        assert_eq!(t.lookup("nonexistent"), None);
    }

    #[test]
    fn serves_ranges_and_hides_unknown() {
        let d = temp("serve");
        std::fs::write(d.join("v.mp4"), (0..=255u8).collect::<Vec<_>>()).unwrap();
        let t = FileTokens::default();
        let token = t.issue(d.join("v.mp4"));
        let req = |path: &str, range: Option<&str>| {
            let mut b = Request::builder().uri(format!("http://epfile.localhost/{}", path));
            if let Some(r) = range {
                b = b.header("range", r);
            }
            b.body(Vec::new()).unwrap()
        };
        let r = handle(&t, &req(&format!("{}/v.mp4", token), Some("bytes=10-19")));
        assert_eq!(r.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(r.body(), &(10..=19u8).collect::<Vec<_>>());
        assert_eq!(r.headers().get("content-range").unwrap(), "bytes 10-19/256");
        assert_eq!(r.headers().get("content-type").unwrap(), "video/mp4");
        assert_eq!(handle(&t, &req(&format!("{}/v.mp4", token), None)).body().len(), 256);
        assert_eq!(handle(&t, &req(&format!("{}/v.mp4", token), Some("bytes=999-"))).status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(handle(&t, &req("0000/v.mp4", None)).status(), StatusCode::NOT_FOUND);
    }
}
