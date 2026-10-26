// フォルダの中の、PC ごとの「追記だけの記録」（ADR 0040）。OneDrive・NAS などの共有フォルダを、何人かで書き合う MOD のため。
// 置き場所：<フォルダ>\.explorer_plus\log.<MOD の id>\<書いた人の ID>\<年-月>.jsonl（1行に1件の JSON）
// - 1つのファイルを書くのは、いつも1台の PC だけ（書いた人の ID は PC ごと・MOD ごと。identity.rs）。だから同期でぶつからない
// - 1行ごとに本体が署名する。読むときは、置き場所の名前（書いた人の ID ＝公開鍵）で確かめ、合わない行は返さない
// - 月ごとに分ける：OneDrive は書き足すたびにファイル全体を送り直すので、1つのファイルを大きくしすぎない

use crate::folderdata::{mark_hidden, DATA_DIR};
use crate::fsops::{verify, EntryRef};
use crate::identity::{from_hex, id_of, key_for, to_hex, verifying_key};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 1件の data の大きさの上限（JSON にしたときのバイト数）
const RECORD_MAX: usize = 64 * 1024;
/// 1回の読み取りで読む量の上限。残りがあれば more
const READ_BUDGET: usize = 2 * 1024 * 1024;
/// 署名する中身の頭に付ける印（ほかの用途の署名と取り違えないように）
const DOMAIN: &[u8] = b"explorer_plus/folderLog/v1\n";
/// 行の末尾 `,"sig":"<128 文字>"}` の長さ
const SIG_TAIL: usize = 8 + 128 + 2;

/// この PC の中で、同じファイルへの追記を1つずつにする（改行の確かめと書き込みのあいだに、ほかの書き込みが入らないように）
static APPEND_LOCK: Mutex<()> = Mutex::new(());

fn io_err(e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::PermissionDenied { format!("denied: {}", e) } else { format!("io: {}", e) }
}

/// 1件の記録。author は書いた人の ID
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Record {
    id: String,
    author: String,
    t: u64,
    data: serde_json::Value,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    records: Vec<Record>,
    /// 次の since に渡す（中身は MOD に見せない約束。今は「ファイルごとの読んだ位置」の JSON）
    cursor: String,
    /// 1回で読める量を超えたので、残りがある
    more: bool,
    /// 署名が合わない・形が壊れている行の数（読まなかった）
    rejected: u32,
    /// この PC の、この MOD の ID
    me: String,
}

/// その MOD の記録の置き場所（無くてもよい）
fn log_dir(folder: &EntryRef, view_id: &str) -> Result<PathBuf, String> {
    if !crate::mods::valid_id(view_id) {
        return Err(format!("invalid: id \"{}\"", view_id));
    }
    let dir = verify(folder)?;
    if !dir.is_dir() {
        return Err(format!("invalid: not a folder {}", dir.display()));
    }
    Ok(dir.join(DATA_DIR).join(format!("log.{}", view_id)))
}

/// 時刻（ミリ秒）の、世界時での「年-月」
fn month_of(t_ms: u64) -> String {
    // 日数から年月日を出す（Howard Hinnant の civil_from_days）
    let z = (t_ms / 86_400_000) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{:04}-{:02}", y, m)
}

fn is_month_file(name: &str) -> bool {
    let b = name.as_bytes();
    name.len() == 13 && name.ends_with(".jsonl") && b[4] == b'-' && b[..4].iter().chain(&b[5..7]).all(|c| c.is_ascii_digit())
}

/// 1行を作る：`{"id":…,"t":…,"data":…,"sig":"…"}` と改行。署名するのは sig を除いた `{"id":…,"t":…,"data":…}`
fn encode_line(key: &SigningKey, id: &str, t: u64, data_json: &str) -> String {
    let body = format!("{{\"id\":\"{}\",\"t\":{},\"data\":{}}}", id, t, data_json);
    let sig = key.sign(&[DOMAIN, body.as_bytes()].concat());
    format!("{},\"sig\":\"{}\"}}\n", &body[..body.len() - 1], to_hex(&sig.to_bytes()))
}

/// 1行を読み、署名を確かめる。合わない・壊れていれば None
fn decode_line(author: &VerifyingKey, author_id: &str, line: &str) -> Option<Record> {
    if line.len() < SIG_TAIL + 2 || !line.is_char_boundary(line.len() - SIG_TAIL) {
        return None;
    }
    let (head, tail) = line.split_at(line.len() - SIG_TAIL);
    if !tail.starts_with(",\"sig\":\"") || !tail.ends_with("\"}") {
        return None;
    }
    let sig = Signature::from_bytes(&from_hex::<64>(&tail[8..136])?);
    let body = format!("{}}}", head);
    author.verify(&[DOMAIN, body.as_bytes()].concat(), &sig).ok()?;
    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    let id = v.get("id")?.as_str()?;
    from_hex::<16>(id)?;
    Some(Record { id: id.to_string(), author: author_id.to_string(), t: v.get("t")?.as_u64()?, data: v.get("data")?.clone() })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 末尾に1件足す。data_json は MOD の値を JSON にしたもの（ここで1行の形に整え直す）
fn append(dir: &Path, key: &SigningKey, data_json: &str, t: u64) -> Result<Record, String> {
    let value: serde_json::Value = serde_json::from_str(data_json).map_err(|_| "invalid: data is not JSON".to_string())?;
    let data = serde_json::to_string(&value).map_err(|e| format!("invalid: {}", e))?;
    if data.len() > RECORD_MAX {
        return Err(format!("too-large: {} bytes (up to {})", data.len(), RECORD_MAX));
    }
    let mut raw = [0u8; 16];
    getrandom::fill(&mut raw).map_err(|e| format!("io: {}", e))?;
    let id = to_hex(&raw);
    let author = id_of(key);
    let file = dir.join(&author).join(format!("{}.jsonl", month_of(t)));
    let line = encode_line(key, &id, t, &data);

    let _guard = APPEND_LOCK.lock().unwrap();
    std::fs::create_dir_all(file.parent().ok_or("invalid")?).map_err(io_err)?;
    if let Some(data_dir) = dir.parent() {
        mark_hidden(data_dir);
    }
    // 同期の道具がファイルを握っていると開けない（共有違反・ロック違反）。少し待って、数回やり直す
    let mut tries = 0;
    loop {
        match append_line(&file, &line) {
            Err(e) if matches!(e.raw_os_error(), Some(32) | Some(33)) && tries < 5 => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
            r => break r.map_err(io_err)?,
        }
    }
    Ok(Record { id, author, t, data: value })
}

fn append_line(file: &Path, line: &str) -> std::io::Result<()> {
    let mut f = std::fs::OpenOptions::new().read(true).append(true).create(true).open(file)?;
    let len = f.metadata()?.len();
    // 前の書き込みが途中で止まって、改行で終わっていなければ、先に改行を足す（半端な行に続けて書かない）
    let mut text = String::new();
    if len > 0 {
        let mut last = [0u8; 1];
        f.seek(SeekFrom::End(-1))?;
        f.read_exact(&mut last)?;
        if last[0] != b'\n' {
            text.push('\n');
        }
    }
    text.push_str(line);
    f.write_all(text.as_bytes())?;
    f.flush()
}

/// 書いた人ごとのフォルダ（名前が ID の形のものだけ）と、その中の月ごとのファイル。並び順はいつも同じ
fn log_files(dir: &Path) -> Vec<(String, VerifyingKey, Vec<(String, PathBuf, std::fs::Metadata)>)> {
    let Ok(authors) = std::fs::read_dir(dir) else { return vec![] };
    let mut out = vec![];
    for a in authors.flatten() {
        let name = a.file_name().to_string_lossy().into_owned();
        let Some(key) = verifying_key(&name) else { continue };
        let Ok(files) = std::fs::read_dir(a.path()) else { continue };
        let mut months: Vec<_> = files
            .flatten()
            .filter_map(|f| {
                let n = f.file_name().to_string_lossy().into_owned();
                let meta = f.metadata().ok()?;
                (is_month_file(&n) && meta.is_file()).then(|| (n, f.path(), meta))
            })
            .collect();
        months.sort_by(|x, y| x.0.cmp(&y.0));
        out.push((name, key, months));
    }
    out.sort_by(|x, y| x.0.cmp(&y.0));
    out
}

/// since（前回の cursor）の続きから読む
fn read(dir: &Path, since: &BTreeMap<String, u64>, me: String) -> Result<ReadResult, String> {
    let mut cursor = BTreeMap::new();
    let mut records = vec![];
    let mut seen = HashSet::new();
    let mut rejected = 0u32;
    let mut more = false;
    let mut budget = READ_BUDGET;
    for (author, key, months) in log_files(dir) {
        for (month, path, meta) in months {
            let name = format!("{}/{}", author, month);
            let len = meta.len();
            // 前回より短い：ファイルが置き換わった。初めから読み直す（同じ記録は MOD が id で見分ける）
            let mut offset = since.get(&name).copied().filter(|&o| o <= len).unwrap_or(0);
            if offset < len && budget == 0 {
                more = true;
            } else if offset < len {
                let rest = (len - offset) as usize;
                let want = rest.min(budget);
                let mut f = std::fs::File::open(&path).map_err(io_err)?;
                f.seek(SeekFrom::Start(offset)).map_err(io_err)?;
                let mut buf = vec![0u8; want];
                f.read_exact(&mut buf).map_err(io_err)?;
                // 改行で終わっている所までだけ使う（最後の行は、書いている途中かもしれない）
                let used = match buf.iter().rposition(|&b| b == b'\n') {
                    Some(i) => i + 1,
                    // 1回で読める量いっぱいに改行が無い：壊れた行として飛ばす（ずっとここで止まらないように）
                    None if want == READ_BUDGET => {
                        rejected += 1;
                        buf.clear();
                        want
                    }
                    None => 0,
                };
                for line in String::from_utf8_lossy(&buf[..used.min(buf.len())]).split('\n') {
                    let line = line.trim_end_matches('\r');
                    if line.is_empty() {
                        continue;
                    }
                    match decode_line(&key, &author, line) {
                        Some(r) if seen.insert(r.id.clone()) => records.push(r),
                        Some(_) => {}
                        None => rejected += 1,
                    }
                }
                offset += used as u64;
                budget -= used;
                // 読める量で切った（ファイルの終わりまで読んでいない）
                if want < rest {
                    more = true;
                }
            }
            cursor.insert(name, offset);
        }
    }
    records.sort_by(|a, b| (a.t, &a.id).cmp(&(b.t, &b.id)));
    Ok(ReadResult { records, cursor: serde_json::to_string(&cursor).unwrap_or_default(), more, rejected, me })
}

/// 記録が増えたかを安く見分けるための印（ファイルの数・大きさの合計・いちばん新しい更新時刻）。中身は読まない
fn stamp(dir: &Path) -> String {
    let (mut count, mut bytes, mut newest) = (0u64, 0u64, 0u128);
    for (_, _, months) in log_files(dir) {
        for (_, _, meta) in months {
            count += 1;
            bytes += meta.len();
            if let Ok(m) = meta.modified().map(|m| m.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)) {
                newest = newest.max(m);
            }
        }
    }
    format!("{}:{}:{}", count, bytes, newest)
}

fn parse_cursor(since: Option<String>) -> Result<BTreeMap<String, u64>, String> {
    match since {
        None => Ok(BTreeMap::new()),
        Some(s) if s.len() <= 4 * 1024 * 1024 => serde_json::from_str(&s).map_err(|_| "invalid: since is not a cursor from read".to_string()),
        Some(_) => Err("invalid: since is too long".into()),
    }
}

#[tauri::command]
pub async fn folder_log_append(view_id: String, folder: EntryRef, data: String) -> Result<Record, String> {
    tauri::async_runtime::spawn_blocking(move || append(&log_dir(&folder, &view_id)?, &key_for(&view_id)?, &data, now_ms()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn folder_log_read(view_id: String, folder: EntryRef, since: Option<String>) -> Result<ReadResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let since = parse_cursor(since)?;
        read(&log_dir(&folder, &view_id)?, &since, id_of(&key_for(&view_id)?))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn folder_log_stamp(view_id: String, folder: EntryRef) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(stamp(&log_dir(&folder, &view_id)?))).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ep-folderlog-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.join(DATA_DIR).join("log.my.board")
    }

    fn cursor_of(r: &ReadResult) -> BTreeMap<String, u64> {
        serde_json::from_str(&r.cursor).unwrap()
    }

    const T: u64 = 1_761_523_200_000; // 2025-10-27

    #[test]
    fn months() {
        assert_eq!(month_of(0), "1970-01");
        assert_eq!(month_of(T), "2025-10");
        assert_eq!(month_of(1_767_225_599_999), "2025-12");
        assert_eq!(month_of(1_767_225_600_000), "2026-01");
        assert_eq!(month_of(1_709_164_800_000), "2024-02"); // うるう日
        assert_eq!(month_of(1_709_251_200_000), "2024-03");
        assert!(is_month_file("2025-10.jsonl"));
        assert!(!is_month_file("2025-10.json") && !is_month_file("x025-10.jsonl") && !is_month_file("2025_10.jsonl"));
    }

    #[test]
    fn append_then_read_from_cursor() {
        let dir = temp("roundtrip");
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let me = id_of(&key);
        let a = append(&dir, &key, r#"{"text":"こんにちは","n":1}"#, T).unwrap();
        let b = append(&dir, &key, r#"{"text":"2つめ"}"#, T + 1).unwrap();
        assert_eq!(a.author, me);
        assert!(dir.join(&me).join("2025-10.jsonl").is_file());
        let attrs = { use std::os::windows::fs::MetadataExt; std::fs::metadata(dir.parent().unwrap()).unwrap().file_attributes() };
        assert!(attrs & 0x2 != 0, ".explorer_plus は隠しフォルダ");

        let r = read(&dir, &BTreeMap::new(), me.clone()).unwrap();
        assert_eq!(r.records, vec![a.clone(), b]);
        assert_eq!((r.more, r.rejected, r.me.as_str()), (false, 0, me.as_str()));
        // 続きから読むと、新しいものだけ
        let again = read(&dir, &cursor_of(&r), me.clone()).unwrap();
        assert!(again.records.is_empty());
        let c = append(&dir, &key, "[1,2,3]", T + 2).unwrap();
        assert_eq!(read(&dir, &cursor_of(&again), me.clone()).unwrap().records, vec![c]);
        // 月が変わると、別のファイル
        append(&dir, &key, "null", 1_767_225_600_000).unwrap();
        assert!(dir.join(&me).join("2026-01.jsonl").is_file());
        let _ = std::fs::remove_dir_all(dir.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn rejects_tampered_and_moved_lines() {
        let dir = temp("tamper");
        let alice = SigningKey::from_bytes(&[1u8; 32]);
        let bob = SigningKey::from_bytes(&[2u8; 32]);
        append(&dir, &alice, r#"{"text":"alice"}"#, T).unwrap();
        append(&dir, &bob, r#"{"text":"bob"}"#, T).unwrap();
        let bob_file = dir.join(id_of(&bob)).join("2025-10.jsonl");
        let alice_file = dir.join(id_of(&alice)).join("2025-10.jsonl");
        // ボブの行を書き換える・アリスの行をボブのファイルに写す（なりすまし）・ID の形でないフォルダ
        let bob_line = std::fs::read_to_string(&bob_file).unwrap();
        let alice_line = std::fs::read_to_string(&alice_file).unwrap();
        std::fs::write(&bob_file, format!("{}{}", bob_line.replace("bob", "eve"), alice_line)).unwrap();
        std::fs::create_dir_all(dir.join("not-an-id")).unwrap();
        std::fs::write(dir.join("not-an-id").join("2025-10.jsonl"), &alice_line).unwrap();
        let r = read(&dir, &BTreeMap::new(), String::new()).unwrap();
        assert_eq!(r.records.len(), 1, "残るのはアリス本人の行だけ");
        assert_eq!(r.records[0].author, id_of(&alice));
        assert_eq!(r.rejected, 2);
        let _ = std::fs::remove_dir_all(dir.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn partial_last_line_and_duplicates() {
        let dir = temp("partial");
        let key = SigningKey::from_bytes(&[3u8; 32]);
        let a = append(&dir, &key, r#"{"x":1}"#, T).unwrap();
        let file = dir.join(id_of(&key)).join("2025-10.jsonl");
        let line = std::fs::read_to_string(&file).unwrap();
        // 同じ行が2回（同期の道具のやり直しなど）と、書きかけの行
        std::fs::write(&file, format!("{}{}{{\"id\":\"ab", line, line)).unwrap();
        let r = read(&dir, &BTreeMap::new(), String::new()).unwrap();
        assert_eq!(r.records, vec![a]);
        assert_eq!(r.rejected, 0, "書きかけの行は、まだ数えない");
        assert_eq!(cursor_of(&r)[&format!("{}/2025-10.jsonl", id_of(&key))], (line.len() * 2) as u64, "書きかけの行の前で止まる");
        // 次に書くときは改行を足してから書くので、書きかけの行は壊れた1行になり、新しい行は読める
        let b = append(&dir, &key, r#"{"x":2}"#, T + 1).unwrap();
        let r2 = read(&dir, &cursor_of(&r), String::new()).unwrap();
        assert_eq!(r2.records, vec![b]);
        assert_eq!(r2.rejected, 1);
        let _ = std::fs::remove_dir_all(dir.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn limits_and_stamp() {
        let dir = temp("limits");
        let key = SigningKey::from_bytes(&[4u8; 32]);
        assert!(append(&dir, &key, "{not json", T).unwrap_err().starts_with("invalid"));
        assert!(append(&dir, &key, &format!("\"{}\"", "x".repeat(RECORD_MAX)), T).unwrap_err().starts_with("too-large"));
        assert_eq!(stamp(&dir), "0:0:0", "まだ何も無い");
        let empty = read(&dir, &BTreeMap::new(), String::new()).unwrap();
        assert!(empty.records.is_empty() && !empty.more);
        // 改行は JSON の中で \n になり、1行に収まる
        append(&dir, &key, r#"{"text":"1行目\n2行目"}"#, T).unwrap();
        let s1 = stamp(&dir);
        assert!(s1.starts_with("1:"));
        append(&dir, &key, "1", T).unwrap();
        assert_ne!(stamp(&dir), s1, "足すと印が変わる");
        let r = read(&dir, &BTreeMap::new(), String::new()).unwrap();
        assert_eq!(r.records[0].data["text"], "1行目\n2行目");
        assert!(parse_cursor(Some("nope".into())).is_err());
        let _ = std::fs::remove_dir_all(dir.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn reads_in_parts_when_large() {
        let dir = temp("large");
        let key = SigningKey::from_bytes(&[5u8; 32]);
        let big = format!("\"{}\"", "y".repeat(60_000));
        // 2MB を超えるまで足す
        let n = READ_BUDGET / 60_000 + 3;
        for i in 0..n {
            append(&dir, &key, &big, T + i as u64).unwrap();
        }
        let first = read(&dir, &BTreeMap::new(), String::new()).unwrap();
        assert!(first.more, "1回で読み切れない");
        assert!(!first.records.is_empty() && first.records.len() < n);
        let rest = read(&dir, &cursor_of(&first), String::new()).unwrap();
        assert!(!rest.more);
        assert_eq!(first.records.len() + rest.records.len(), n);
        assert_eq!(first.rejected + rest.rejected, 0);
        let _ = std::fs::remove_dir_all(dir.parent().unwrap().parent().unwrap());
    }
}
