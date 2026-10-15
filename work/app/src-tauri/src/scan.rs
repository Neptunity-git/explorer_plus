// フォルダを下の階層までたどる：検索と集計（ADR 0023）。読むだけ。
// - リンク（ジャンクション・シンボリックリンク）の先へは入らない（同じ所をぐるぐる回らないように）
// - フォルダの一覧と同じく、.explorer_plus と隠し＋システムの項目は数えない（fsops::listed）
// - OneDrive の「クラウドにだけある」ファイルの中身は読まない（読むとダウンロードが始まるため）
// - 数・時間に上限があり、超えたら truncated: true で途中までを返す

use crate::fsops::{entry_with_id, listed, verify, EntryRef, RawEntry};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const MAX_DEPTH: u32 = 64;
const MAX_VISITS: usize = 300_000;
const MAX_RESULTS: usize = 5000;
const TIME_LIMIT: Duration = Duration::from_secs(20);
/// 中身の検索で読むファイルの大きさの上限
const CONTENT_MAX: u64 = 4 * 1024 * 1024;

const ATTR_REPARSE: u32 = 0x400;
const ATTR_OFFLINE: u32 = 0x1000;
const ATTR_RECALL_ON_OPEN: u32 = 0x40000;
const ATTR_RECALL_ON_DATA_ACCESS: u32 = 0x400000;

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Query {
    /// 名前に含む文字（大文字・小文字を区別しない）。* と ? があれば、名前全体と比べる形（例 "*.jpg"）
    pub name: Option<String>,
    /// 拡張子（小文字・点なし）のどれか
    pub ext: Option<Vec<String>>,
    /// "file" か "folder"
    pub kind: Option<String>,
    pub min_size: Option<u64>,
    pub max_size: Option<u64>,
    /// 1970年からのミリ秒
    pub modified_after: Option<i64>,
    pub modified_before: Option<i64>,
    /// 中身に含む文字（大文字・小文字を区別しない。文章のファイルだけ）
    pub content: Option<String>,
    /// false なら隠し項目を除く
    pub hidden: Option<bool>,
}

/// * と ? の比べ方（大文字・小文字は呼ぶ側でそろえる）
fn glob(pat: &[char], s: &[char]) -> bool {
    match (pat.first(), s.first()) {
        (None, None) => true,
        (Some('*'), _) => glob(&pat[1..], s) || (!s.is_empty() && glob(pat, &s[1..])),
        (Some('?'), Some(_)) => glob(&pat[1..], &s[1..]),
        (Some(p), Some(c)) if p == c => glob(&pat[1..], &s[1..]),
        _ => false,
    }
}

pub struct Matcher {
    name: Option<(String, bool)>,
    ext: Option<Vec<String>>,
    kind: Option<bool>,
    q: Query,
    content: Option<String>,
}

impl Matcher {
    pub fn new(q: Query) -> Matcher {
        let name = q.name.as_ref().filter(|n| !n.is_empty()).map(|n| (n.to_lowercase(), n.contains('*') || n.contains('?')));
        let ext = q.ext.as_ref().map(|v| v.iter().map(|e| e.trim_start_matches('.').to_lowercase()).collect());
        let kind = q.kind.as_deref().map(|k| k == "folder");
        let content = q.content.as_ref().filter(|c| !c.is_empty()).map(|c| c.to_lowercase());
        Matcher { name, ext, kind, q, content }
    }

    /// 名前・種類・大きさ・日時で合うか（中身は別）
    fn matches_meta(&self, name: &str, is_dir: bool, size: u64, modified: i64, hidden: bool) -> bool {
        if self.q.hidden == Some(false) && hidden {
            return false;
        }
        if let Some(k) = self.kind {
            if k != is_dir {
                return false;
            }
        }
        if let Some((pat, is_glob)) = &self.name {
            let lower = name.to_lowercase();
            let ok = if *is_glob {
                glob(&pat.chars().collect::<Vec<_>>(), &lower.chars().collect::<Vec<_>>())
            } else {
                lower.contains(pat.as_str())
            };
            if !ok {
                return false;
            }
        }
        if let Some(exts) = &self.ext {
            let e = if is_dir { String::new() } else { Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default() };
            if !exts.contains(&e) {
                return false;
            }
        }
        if !is_dir {
            if self.q.min_size.is_some_and(|m| size < m) || self.q.max_size.is_some_and(|m| size > m) {
                return false;
            }
        }
        if self.q.modified_after.is_some_and(|t| modified < t) || self.q.modified_before.is_some_and(|t| modified > t) {
            return false;
        }
        true
    }

    /// 中身に含むか。クラウドにだけあるファイル・大きなファイル・文章でないファイルは false
    fn matches_content(&self, path: &Path, attrs: u32, size: u64) -> bool {
        let Some(needle) = &self.content else { return true };
        if attrs & (ATTR_OFFLINE | ATTR_RECALL_ON_OPEN | ATTR_RECALL_ON_DATA_ACCESS) != 0 || size > CONTENT_MAX {
            return false;
        }
        let Ok(bytes) = std::fs::read(path) else { return false };
        if bytes.contains(&0) && !bytes.starts_with(&[0xFF, 0xFE]) {
            return false; // 文章ではない
        }
        let text = match std::str::from_utf8(&bytes) {
            Ok(s) => s.to_string(),
            Err(_) => encoding_rs::SHIFT_JIS.decode_without_bom_handling(&bytes).0.into_owned(),
        };
        text.to_lowercase().contains(needle.as_str())
    }
}

fn filetime_ms(ft: u64) -> i64 {
    (ft as i64 - 116_444_736_000_000_000) / 10_000
}

/// 1つの項目（たどる途中で見たもの）
struct Seen {
    path: PathBuf,
    name: String,
    is_dir: bool,
    size: u64,
    modified: i64,
    hidden: bool,
    attrs: u32,
}

/// 下の階層までたどり、見た項目ごとに visit を呼ぶ。visit が false を返したら止める。止まった・上限に達したら true（途中まで）
fn walk(root: &Path, depth: u32, visit: &mut dyn FnMut(&Seen) -> bool) -> bool {
    let start = Instant::now();
    let mut visits = 0usize;
    let mut stack = vec![(root.to_path_buf(), 0u32)];
    while let Some((dir, d)) = stack.pop() {
        let Ok(items) = std::fs::read_dir(&dir) else { continue };
        for item in items.flatten() {
            visits += 1;
            if visits > MAX_VISITS || start.elapsed() > TIME_LIMIT {
                return true;
            }
            let Ok(meta) = item.metadata() else { continue };
            let attrs = meta.file_attributes();
            let name = item.file_name().to_string_lossy().into_owned();
            if !listed(&name, attrs) {
                continue;
            }
            let is_dir = meta.is_dir();
            let seen = Seen {
                path: item.path(),
                name,
                is_dir,
                size: if is_dir { 0 } else { meta.len() },
                modified: filetime_ms(meta.last_write_time()),
                hidden: attrs & 0x2 != 0,
                attrs,
            };
            if !visit(&seen) {
                return true;
            }
            // リンクの先へは入らない
            if is_dir && attrs & ATTR_REPARSE == 0 && d + 1 < depth {
                stack.push((seen.path, d + 1));
            }
        }
    }
    false
}

fn raw(s: &Seen) -> RawEntry {
    entry_with_id(&s.path, s.name.clone(), s.is_dir, s.hidden, s.size, s.modified)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    entries: Vec<RawEntry>,
    truncated: bool,
}

pub fn find(root: &Path, query: Query, depth: u32, limit: usize) -> Found {
    let m = Matcher::new(query);
    let limit = limit.clamp(1, MAX_RESULTS);
    let mut entries = Vec::new();
    let mut full = false;
    let truncated = walk(root, depth.clamp(1, MAX_DEPTH), &mut |s| {
        if m.matches_meta(&s.name, s.is_dir, s.size, s.modified, s.hidden) && (s.is_dir || m.matches_content(&s.path, s.attrs, s.size)) {
            if m.content.is_some() && s.is_dir {
                return true; // 中身の検索では、フォルダは出さない
            }
            entries.push(raw(s));
            if entries.len() >= limit {
                full = true;
                return false;
            }
        }
        true
    });
    Found { entries, truncated: truncated || full }
}

#[tauri::command]
pub async fn search_find(folder: EntryRef, query: Query, depth: Option<u32>, limit: Option<usize>) -> Result<Found, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = verify(&folder)?;
        if !root.is_dir() {
            return Err("invalid: not a folder".into());
        }
        Ok(find(&root, query, depth.unwrap_or(MAX_DEPTH), limit.unwrap_or(1000)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtStat {
    ext: String,
    count: u64,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    files: u64,
    folders: u64,
    bytes: u64,
    /// 拡張子ごと（大きい順に 50 まで。拡張子なしは ""）
    by_ext: Vec<ExtStat>,
    /// 大きいファイル（20 まで）
    largest: Vec<RawEntry>,
    /// 新しく変わったファイル（20 まで）
    newest: Vec<RawEntry>,
    truncated: bool,
}

/// 上位 n 個を保つ（小さい方から捨てる）
fn keep_top(list: &mut Vec<(i128, PathBuf, String, bool, u64, i64)>, item: (i128, PathBuf, String, bool, u64, i64), n: usize) {
    if list.len() < n || item.0 > list.last().map(|x| x.0).unwrap_or(i128::MIN) {
        list.push(item);
        list.sort_by(|a, b| b.0.cmp(&a.0));
        list.truncate(n);
    }
}

pub fn stats(root: &Path, depth: u32) -> Stats {
    let (mut files, mut folders, mut bytes) = (0u64, 0u64, 0u64);
    let mut exts: HashMap<String, ExtStat> = HashMap::new();
    let mut largest = Vec::new();
    let mut newest = Vec::new();
    let truncated = walk(root, depth.clamp(1, MAX_DEPTH), &mut |s| {
        if s.is_dir {
            folders += 1;
            return true;
        }
        files += 1;
        bytes += s.size;
        let ext = Path::new(&s.name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        let e = exts.entry(ext.clone()).or_insert(ExtStat { ext, count: 0, bytes: 0 });
        e.count += 1;
        e.bytes += s.size;
        let row = |key: i128| (key, s.path.clone(), s.name.clone(), s.hidden, s.size, s.modified);
        keep_top(&mut largest, row(s.size as i128), 20);
        keep_top(&mut newest, row(s.modified as i128), 20);
        true
    });
    let mut by_ext: Vec<ExtStat> = exts.into_values().collect();
    by_ext.sort_by(|a, b| b.bytes.cmp(&a.bytes).then(b.count.cmp(&a.count)));
    by_ext.truncate(50);
    let to_raw = |v: Vec<(i128, PathBuf, String, bool, u64, i64)>| v.into_iter().map(|(_, p, n, h, sz, m)| entry_with_id(&p, n, false, h, sz, m)).collect();
    Stats { files, folders, bytes, by_ext, largest: to_raw(largest), newest: to_raw(newest), truncated }
}

#[tauri::command]
pub async fn search_stats(folder: EntryRef, depth: Option<u32>) -> Result<Stats, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = verify(&folder)?;
        if !root.is_dir() {
            return Err("invalid: not a folder".into());
        }
        Ok(stats(&root, depth.unwrap_or(MAX_DEPTH)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 試験ごとに別のフォルダ（試験は同時に走るので、同じフォルダを使うと消し合う）
    fn tree(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ep-scan-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("写真/2024")).unwrap();
        std::fs::create_dir_all(d.join("課題")).unwrap();
        std::fs::write(d.join("写真/2024/海.JPG"), vec![0u8; 3000]).unwrap();
        std::fs::write(d.join("写真/山.jpg"), vec![0u8; 1000]).unwrap();
        std::fs::write(d.join("課題/レポート.txt"), "締め切りは金曜").unwrap();
        let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode("提出は月曜");
        std::fs::write(d.join("課題/古いメモ.txt"), &*sjis).unwrap();
        std::fs::create_dir_all(d.join(".explorer_plus")).unwrap();
        std::fs::write(d.join(".explorer_plus/view.x.json"), "{}").unwrap();
        d
    }

    fn names(f: &Found) -> Vec<String> {
        let mut v: Vec<String> = f.entries.iter().map(|e| e.name.clone()).collect();
        v.sort();
        v
    }

    #[test]
    fn globs() {
        let g = |p: &str, s: &str| glob(&p.chars().collect::<Vec<_>>(), &s.chars().collect::<Vec<_>>());
        assert!(g("*.jpg", "海.jpg"));
        assert!(g("img_??.png", "img_01.png"));
        assert!(!g("*.jpg", "a.jpeg"));
        assert!(g("*", ""));
    }

    #[test]
    fn finds_by_name_ext_size_content() {
        let d = tree("find");
        let q = |q: Query| names(&find(&d, q, 64, 100));
        assert_eq!(q(Query { ext: Some(vec!["jpg".into()]), ..Default::default() }), vec!["山.jpg", "海.JPG"]);
        assert_eq!(q(Query { name: Some("*.jpg".into()), min_size: Some(2000), ..Default::default() }), vec!["海.JPG"]);
        assert_eq!(q(Query { kind: Some("folder".into()), ..Default::default() }), vec!["2024", "写真", "課題"]);
        assert_eq!(q(Query { content: Some("締め切り".into()), ..Default::default() }), vec!["レポート.txt"]);
        assert_eq!(q(Query { content: Some("提出".into()), ..Default::default() }), vec!["古いメモ.txt"], "Shift_JIS の中身も探せる");
        assert!(q(Query { name: Some("view".into()), ..Default::default() }).is_empty(), ".explorer_plus の中は見ない");
        // 深さ 1 なら直下だけ
        assert_eq!(names(&find(&d, Query { kind: Some("file".into()), ..Default::default() }, 1, 100)), Vec::<String>::new());
        // 上限
        let f = find(&d, Query::default(), 64, 2);
        assert_eq!(f.entries.len(), 2);
        assert!(f.truncated);
    }

    #[test]
    fn counts() {
        let d = tree("stats");
        let s = stats(&d, 64);
        assert_eq!((s.files, s.folders), (4, 3));
        assert_eq!(s.bytes, 3000 + 1000 + "締め切りは金曜".len() as u64 + "提出は月曜".len() as u64 / 3 * 2);
        assert_eq!(s.by_ext[0].ext, "jpg");
        assert_eq!(s.by_ext[0].count, 2);
        assert_eq!(s.largest[0].name, "海.JPG");
        assert!(!s.truncated);
    }
}
