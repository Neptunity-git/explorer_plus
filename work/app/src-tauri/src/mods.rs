// ビュー MOD の置き場所・配信・保存（ADR 0007、docs/design/mod-api-v1.md）。
//   http://mod.localhost/<id>/__frame.html   … 本体が作るページ。ランタイムと MOD の入口を読み込む
//   http://mod.localhost/<id>/<パス>          … MOD のフォルダの中のファイル
//   http://mod.localhost/__runtime/<パス>     … ランタイム（window.explorerPlus を作るスクリプト）
// MOD のページには、通信先を自分のフォルダなどに限る CSP を応答ヘッダで付ける（ADR 0007 判断6）。
// manifest の細かい検査は TypeScript（src/core/manifest.ts）が行う。ここでは、配信に要る id と entry を安全に読むだけ。

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

const RUNTIME_PREFIX: &str = "__runtime";
const FRAME_FILE: &str = "__frame.html";
const RUNTIME_FILE: &str = "explorer-plus-runtime.js";
const STORAGE_MAX_BYTES: usize = 32 * 1024 * 1024;
/// ページ（WebView2）から見た MOD の配信先。Rust にはリクエストが "mod://localhost/..." の形で届くが、
/// CSP はページから見た住所で書く必要がある（Windows の Tauri は独自の通信先を http://<名前>.localhost で見せる）
const MOD_ORIGIN: &str = "http://mod.localhost";

#[derive(Default)]
pub struct ModRegistry(RwLock<HashMap<String, ModDir>>);

#[derive(Clone)]
struct ModDir {
    dir: PathBuf,
    entry: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModSource {
    /// "builtin"（標準のビュー）か "user"（ユーザーが入れた MOD）
    pub source: String,
    pub dir: String,
    /// manifest.json の中身（文字列のまま。検査は TypeScript で行う）
    pub manifest_text: Option<String>,
    /// 読めなかった・配信に使えなかった理由
    pub error: Option<String>,
}

/// manifest の id の決まり（docs/design/mod-api-v1.md）。パスに使うので、ここでも確かめる
pub fn valid_id(id: &str) -> bool {
    let b = id.as_bytes();
    let edge = |c: u8| c.is_ascii_lowercase() || c.is_ascii_digit();
    (3..=64).contains(&b.len())
        && edge(b[0])
        && edge(b[b.len() - 1])
        && b.iter().all(|&c| edge(c) || c == b'.' || c == b'-')
}

/// MOD の中の相対パスとして安全か（.. や絶対パス、ドライブ指定、\ を含まない）
fn safe_segments(rel: &str) -> Option<Vec<&str>> {
    if rel.is_empty() || rel.starts_with('/') || rel.contains('\\') || rel.contains(':') || rel.contains('\0') {
        return None;
    }
    let segs: Vec<&str> = rel.split('/').collect();
    if segs.iter().any(|s| s.is_empty() || *s == "." || *s == "..") {
        return None;
    }
    Some(segs)
}

fn valid_entry(entry: &str) -> bool {
    entry.ends_with(".js") && safe_segments(entry).is_some()
}

fn builtin_root(app: &AppHandle, name: &str) -> PathBuf {
    if cfg!(debug_assertions) {
        // 開発中は、ソースのフォルダを直接見る（保存すればすぐ反映される）
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join(name)
    } else {
        app.path().resource_dir().unwrap_or_default().join(name)
    }
}

fn user_mods_root(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_default().join("mods")
}

fn read_manifest(dir: &Path) -> Result<(String, String, String), String> {
    let text = std::fs::read_to_string(dir.join("manifest.json")).map_err(|e| format!("manifest.json: {}", e))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("manifest.json: {}", e))?;
    let id = v.get("id").and_then(|x| x.as_str()).unwrap_or_default().to_string();
    let entry = v.get("entry").and_then(|x| x.as_str()).unwrap_or_default().to_string();
    Ok((text, id, entry))
}

fn scan(root: &Path, source: &str, registry: &mut HashMap<String, ModDir>, out: &mut Vec<ModSource>) {
    let Ok(items) = std::fs::read_dir(root) else { return };
    let mut dirs: Vec<PathBuf> = items.filter_map(|i| i.ok()).map(|i| i.path()).filter(|p| p.is_dir()).collect();
    dirs.sort();
    for dir in dirs {
        let mut src = ModSource {
            source: source.into(),
            dir: dir.to_string_lossy().into_owned(),
            manifest_text: None,
            error: None,
        };
        match read_manifest(&dir) {
            Err(e) => src.error = Some(e),
            Ok((text, id, entry)) => {
                src.manifest_text = Some(text);
                if !valid_id(&id) {
                    src.error = Some(format!("id: invalid \"{}\"", id));
                } else if !valid_entry(&entry) {
                    src.error = Some(format!("entry: invalid \"{}\"", entry));
                } else if (source == "user") == id.starts_with("builtin.") {
                    src.error = Some(format!("id: \"builtin.\" is only for built-in views ({})", id));
                } else if registry.contains_key(&id) {
                    src.error = Some(format!("id: \"{}\" is already used by another MOD", id));
                } else {
                    registry.insert(id, ModDir { dir: dir.clone(), entry });
                }
            }
        }
        out.push(src);
    }
}

/// 標準のビューとユーザーの MOD を探し、配信の一覧を作り直す
#[tauri::command]
pub fn list_mods(app: AppHandle, registry: tauri::State<'_, ModRegistry>) -> Vec<ModSource> {
    let user_root = user_mods_root(&app);
    let _ = std::fs::create_dir_all(&user_root);
    let mut map = HashMap::new();
    let mut out = Vec::new();
    scan(&builtin_root(&app, "views"), "builtin", &mut map, &mut out);
    scan(&user_root, "user", &mut map, &mut out);
    *registry.0.write().unwrap() = map;
    out
}

/// ユーザーが MOD を入れるフォルダ（「MOD のフォルダを開く」に使う）
#[tauri::command]
pub fn user_mods_dir(app: AppHandle) -> String {
    let p = user_mods_root(&app);
    let _ = std::fs::create_dir_all(&p);
    p.to_string_lossy().into_owned()
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("html") => "text/html; charset=utf-8",
        Some("json") => "application/json",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("wasm") => "application/wasm",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("glb") => "model/gltf-binary",
        Some("gltf") => "model/gltf+json",
        Some("mp3") => "audio/mpeg",
        Some("ogg") => "audio/ogg",
        Some("wav") => "audio/wav",
        _ => "application/octet-stream",
    }
}

/// MOD のページに付ける CSP。origin は "http://mod.localhost" の形
pub fn frame_csp(origin: &str, id: &str) -> String {
    let base = format!("{}/{}/", origin, id);
    let runtime = format!("{}/{}/", origin, RUNTIME_PREFIX);
    let icons = origin.replacen("://mod.", "://icon.", 1);
    format!(
        "default-src 'none'; \
         script-src {base} {runtime} 'wasm-unsafe-eval'; \
         style-src {base} {runtime} 'unsafe-inline'; \
         img-src {base} {icons} data: blob:; \
         font-src {base} data:; \
         connect-src {base}; \
         media-src {base} data: blob:; \
         worker-src blob:"
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;")
}

fn frame_html(id: &str, entry: &str) -> String {
    let src: String = entry.split('/').map(percent_encode_segment).collect::<Vec<_>>().join("/");
    format!(
        "<!doctype html>\n<html><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
         <style>html,body{{margin:0;height:100%;}}</style>\
         <script src=\"/{rt}/{rf}\"></script>\
         <script type=\"module\" src=\"/{id}/{src}\"></script>\
         </head><body></body></html>\n",
        rt = RUNTIME_PREFIX,
        rf = RUNTIME_FILE,
        id = id,
        src = html_escape(&src),
    )
}

fn percent_encode_segment(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect()
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let b = u8::from_str_radix(s.get(i + 1..i + 3)?, 16).ok()?;
            out.push(b);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// root の中の rel を、外にはみ出さないことを確かめてから返す
fn resolve_inside(root: &Path, rel: &str) -> Option<PathBuf> {
    let segs = safe_segments(rel)?;
    let mut p = root.to_path_buf();
    for s in segs {
        p.push(s);
    }
    let real = p.canonicalize().ok()?;
    let real_root = root.canonicalize().ok()?;
    (real.starts_with(&real_root) && real.is_file()).then_some(real)
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(code).body(Vec::new()).unwrap()
}

fn file_response(path: &Path, csp: &str) -> Response<Vec<u8>> {
    match std::fs::read(path) {
        Ok(body) => Response::builder()
            .header("Content-Type", content_type(path))
            .header("Content-Security-Policy", csp)
            .header("X-Content-Type-Options", "nosniff")
            // MOD のページは出どころ null なので、ES モジュールを読み込むには許可のヘッダが要る
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "no-store")
            .body(body)
            .unwrap(),
        Err(_) => status(StatusCode::NOT_FOUND),
    }
}

pub fn handle(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri();
    let Some(path) = percent_decode(uri.path().trim_start_matches('/')) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let Some((first, rest)) = path.split_once('/') else {
        return status(StatusCode::NOT_FOUND);
    };
    if first == RUNTIME_PREFIX {
        let root = builtin_root(app, "runtime");
        return match resolve_inside(&root, rest) {
            Some(p) => file_response(&p, "default-src 'none'"),
            None => status(StatusCode::NOT_FOUND),
        };
    }
    let registry = app.state::<ModRegistry>();
    let Some(m) = registry.0.read().unwrap().get(first).cloned() else {
        return status(StatusCode::NOT_FOUND);
    };
    let csp = frame_csp(MOD_ORIGIN, first);
    if rest == FRAME_FILE {
        return Response::builder()
            .header("Content-Type", "text/html; charset=utf-8")
            .header("Content-Security-Policy", &csp)
            .header("X-Content-Type-Options", "nosniff")
            .header("Cache-Control", "no-store")
            .body(frame_html(first, &m.entry).into_bytes())
            .unwrap();
    }
    match resolve_inside(&m.dir, rest) {
        Some(p) => file_response(&p, &csp),
        None => status(StatusCode::NOT_FOUND),
    }
}

// ---- ビューごとの保存（ADR 0005 判断4：仮想ディレクトリの構造はビューごと） ----

fn storage_file(app: &AppHandle, view_id: &str) -> Result<PathBuf, String> {
    if !valid_id(view_id) {
        return Err(format!("invalid: view id \"{}\"", view_id));
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("view-storage");
    std::fs::create_dir_all(&dir).map_err(|e| format!("io: {}", e))?;
    Ok(dir.join(format!("{}.json", view_id)))
}

fn load_json(p: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("io: {}", e)),
    }
}

/// まるごと書き換える。途中で落ちても壊れないよう、別のファイルに書いてから置き換える
fn save_json(p: &Path, json: &str) -> Result<(), String> {
    if json.len() > STORAGE_MAX_BYTES {
        return Err("too-large: storage exceeds 32MB".into());
    }
    serde_json::from_str::<serde_json::Value>(json).map_err(|e| format!("invalid: {}", e))?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("io: {}", e))?;
    std::fs::rename(&tmp, p).map_err(|e| format!("io: {}", e))
}

/// そのビューの保存内容（JSON の文字列）。まだ無ければ None
#[tauri::command]
pub fn view_storage_load(app: AppHandle, view_id: String) -> Result<Option<String>, String> {
    load_json(&storage_file(&app, &view_id)?)
}

#[tauri::command]
pub fn view_storage_save(app: AppHandle, view_id: String, json: String) -> Result<(), String> {
    save_json(&storage_file(&app, &view_id)?, &json)
}

// ---- アプリ全体のデータ（ADR 0010：タグと時間割） ----

/// 保存してよい名前。ここに無い名前は断る（ファイル名に使うので）
const APP_DATA_NAMES: &[&str] = &["tags", "timetable"];

fn app_data_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !APP_DATA_NAMES.contains(&name) {
        return Err(format!("invalid: app data \"{}\"", name));
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("app-data");
    std::fs::create_dir_all(&dir).map_err(|e| format!("io: {}", e))?;
    Ok(dir.join(format!("{}.json", name)))
}

#[tauri::command]
pub fn app_data_load(app: AppHandle, name: String) -> Result<Option<String>, String> {
    load_json(&app_data_file(&app, &name)?)
}

#[tauri::command]
pub fn app_data_save(app: AppHandle, name: String, json: String) -> Result<(), String> {
    save_json(&app_data_file(&app, &name)?, &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids() {
        assert!(valid_id("neo.voxel-chest"));
        assert!(valid_id("builtin.win11"));
        assert!(!valid_id("ab"));
        assert!(!valid_id("Neo.view"));
        assert!(!valid_id("neo.view."));
        assert!(!valid_id("-neo"));
        assert!(!valid_id("__runtime"));
        assert!(!valid_id("a/b/c"));
    }

    #[test]
    fn segments() {
        assert!(safe_segments("index.js").is_some());
        assert!(safe_segments("lib/three.module.js").is_some());
        for bad in ["", "/index.js", "../x.js", "a/../x.js", "a//b.js", "a\\b.js", "C:x.js", "./x.js"] {
            assert!(safe_segments(bad).is_none(), "{}", bad);
        }
        assert!(valid_entry("dist/main.js"));
        assert!(!valid_entry("index.ts"));
    }

    #[test]
    fn resolve_stays_inside() {
        let root = std::env::temp_dir().join(format!("explorer-plus-mods-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("m").join("lib")).unwrap();
        std::fs::write(root.join("m").join("lib").join("a.js"), "1").unwrap();
        std::fs::write(root.join("secret.txt"), "s").unwrap();
        let m = root.join("m");
        assert!(resolve_inside(&m, "lib/a.js").is_some());
        assert!(resolve_inside(&m, "../secret.txt").is_none());
        assert!(resolve_inside(&m, "lib").is_none()); // フォルダは配らない
        assert!(resolve_inside(&m, "nope.js").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn csp_limits_to_own_folder() {
        let csp = frame_csp("http://mod.localhost", "neo.view");
        assert!(csp.starts_with("default-src 'none';"));
        assert!(csp.contains("script-src http://mod.localhost/neo.view/ http://mod.localhost/__runtime/ "));
        assert!(csp.contains("connect-src http://mod.localhost/neo.view/;"));
        // TUI 風の部品（__runtime/tui.css）を読み込めるように
        assert!(csp.contains("style-src http://mod.localhost/neo.view/ http://mod.localhost/__runtime/ 'unsafe-inline';"));
        assert!(csp.contains("img-src http://mod.localhost/neo.view/ http://icon.localhost data: blob:;"));
        assert!(!csp.contains("ipc.localhost"));
        assert!(!csp.contains("*"));
    }

    #[test]
    fn frame_loads_runtime_then_entry() {
        let html = frame_html("neo.view", "dist/my main.js");
        let rt = html.find("/__runtime/explorer-plus-runtime.js").unwrap();
        let entry = html.find("src=\"/neo.view/dist/my%20main.js\"").unwrap();
        assert!(rt < entry);
        assert!(html.contains("type=\"module\""));
    }

    #[test]
    fn decode() {
        assert_eq!(percent_decode("a%20b/%E3%81%82").unwrap(), "a b/あ");
        assert!(percent_decode("bad%zz").is_none());
        assert!(percent_decode("cut%2").is_none());
    }
}
