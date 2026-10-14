// MOD を入れる・外す・作る・配る形にする（ADR 0020）。
// - 入れる：zip を選ぶ（または落とす）→ 一時の場所に展開して manifest を本体に見せる → ユーザーが確かめたら MOD のフォルダへ移す
// - 開発中の MOD：好きな場所のフォルダを登録して読み込む。中身を保存すると "mod-changed" を知らせ、本体がビューを読み直す
// - ひな形：アプリに同梱した mod-template を、選んだ場所にコピーして、開発中の MOD として登録する
// - zip にする：開発中の MOD のフォルダを、配れる zip にまとめる

use crate::mods::{builtin_root, data_root, read_manifest, user_mods_root, valid_id};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

/// zip の中のファイルの数・展開したあとの大きさの上限（壊れた zip や、展開すると巨大になる zip を防ぐ）
const MAX_FILES: usize = 2000;
const MAX_BYTES: u64 = 50 * 1024 * 1024;
/// zip にするとき入れないもの（見張りでも無視する）
const PACK_SKIP: &[&str] = &["node_modules", ".git", ".vscode"];
/// zip にするとき入れない、作る人だけが使うファイル（ひな形が入れるもの）
const PACK_SKIP_FILES: &[&str] = &["MOD開発ガイド.html", "explorer-plus.d.ts", "jsconfig.json"];

fn io_err(e: impl std::fmt::Display) -> String {
    format!("io: {}", e)
}

fn staging_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_root(app)?.join("mods-staging"))
}

/// 一時の場所の名前（英数字だけ。パスの悪用を防ぐ）
fn staging_dir(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("invalid: staging".into());
    }
    Ok(staging_root(app)?.join(name))
}

/// zip を dest に展開する。中のパスは dest の外を指せない（enclosed_name）
fn extract(zip_path: &Path, dest: &Path) -> Result<(usize, u64), String> {
    let mut z = zip::ZipArchive::new(File::open(zip_path).map_err(io_err)?).map_err(|e| format!("invalid: not a zip file ({})", e))?;
    if z.len() > MAX_FILES {
        return Err(format!("too-large: more than {} files", MAX_FILES));
    }
    let mut total: u64 = 0;
    let mut files = 0;
    for i in 0..z.len() {
        let mut e = z.by_index(i).map_err(|e| format!("invalid: {}", e))?;
        let Some(rel) = e.enclosed_name() else { return Err(format!("invalid: unsafe path in zip ({})", e.name().unwrap_or_default())) };
        let out = dest.join(rel);
        if e.is_dir() {
            std::fs::create_dir_all(&out).map_err(io_err)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(io_err)?;
        }
        let mut w = File::create(&out).map_err(io_err)?;
        // 書いてある大きさを信じず、実際に読んだ量で上限を確かめる
        let left = MAX_BYTES - total;
        let n = std::io::copy(&mut (&mut e).take(left + 1), &mut w).map_err(io_err)?;
        total += n;
        if total > MAX_BYTES {
            return Err(format!("too-large: more than {} MB", MAX_BYTES / 1024 / 1024));
        }
        files += 1;
    }
    Ok((files, total))
}

/// manifest.json のある場所：zip の一番上か、一番上にフォルダが1つだけあるならその中
fn mod_root(dir: &Path) -> Result<PathBuf, String> {
    if dir.join("manifest.json").is_file() {
        return Ok(dir.to_path_buf());
    }
    let subs: Vec<PathBuf> = std::fs::read_dir(dir).map_err(io_err)?.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    if subs.len() == 1 && subs[0].is_dir() && subs[0].join("manifest.json").is_file() {
        return Ok(subs[0].clone());
    }
    Err("invalid: manifest.json not found in the zip".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspected {
    /// 一時の場所の名前（mod_install・mod_discard に渡す）
    staging: String,
    manifest_text: String,
    files: usize,
    bytes: u64,
    /// 同じ id の MOD がもう入っていれば、その版（更新になる）
    installed_version: Option<String>,
}

fn new_staging_name() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("s{:x}{:x}", t, std::process::id())
}

/// zip を一時の場所に展開して、manifest を返す（まだ入れない。本体が確かめの画面を出す）
#[tauri::command]
pub async fn mod_inspect(app: AppHandle, zip_path: String) -> Result<Inspected, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = new_staging_name();
        let dir = staging_dir(&app, &name)?;
        std::fs::create_dir_all(&dir).map_err(io_err)?;
        let result = (|| {
            let (files, bytes) = extract(Path::new(&zip_path), &dir)?;
            let root = mod_root(&dir)?;
            let (text, id, _) = read_manifest(&root)?;
            let installed = user_mods_root(&app).join(&id);
            let installed_version = (valid_id(&id) && installed.is_dir())
                .then(|| read_manifest(&installed).ok())
                .flatten()
                .and_then(|(t, _, _)| serde_json::from_str::<serde_json::Value>(&t).ok())
                .and_then(|v| v.get("version").and_then(|x| x.as_str()).map(String::from));
            Ok(Inspected { staging: name.clone(), manifest_text: text, files, bytes, installed_version })
        })();
        if result.is_err() {
            let _ = std::fs::remove_dir_all(&dir);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 確かめが済んだ MOD を入れる。同じ id のものがあれば、古い方はごみ箱へ送って置き換える
#[tauri::command]
pub async fn mod_install(app: AppHandle, staging: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = staging_dir(&app, &staging)?;
        let root = mod_root(&dir)?;
        let (_, id, _) = read_manifest(&root)?;
        if !valid_id(&id) || id.starts_with("builtin.") {
            return Err(format!("invalid: id \"{}\"", id));
        }
        let mods = user_mods_root(&app);
        std::fs::create_dir_all(&mods).map_err(io_err)?;
        let target = mods.join(&id);
        if target.exists() {
            trash::delete(&target).map_err(io_err)?;
        }
        std::fs::rename(&root, &target).map_err(io_err)?;
        let _ = std::fs::remove_dir_all(&dir);
        Ok(id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 入れるのをやめた：一時の場所を消す
#[tauri::command]
pub fn mod_discard(app: AppHandle, staging: String) -> Result<(), String> {
    let dir = staging_dir(&app, &staging)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(io_err)?;
    }
    Ok(())
}

/// MOD を外す。入れた MOD はフォルダをごみ箱へ（戻せる）、開発中の MOD は登録をやめる（フォルダはそのまま）。
/// MOD が保存していたもの（ep.storage）は残す。入れ直せば続きから使える
#[tauri::command]
pub async fn mod_remove(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !valid_id(&id) || id.starts_with("builtin.") {
            return Err(format!("invalid: id \"{}\"", id));
        }
        let before = dev_dirs(&app);
        let rest: Vec<PathBuf> = before.iter().filter(|d| read_manifest(d).map(|(_, i, _)| i != id).unwrap_or(true)).cloned().collect();
        if rest.len() != before.len() {
            return save_dev_dirs(&app, &rest);
        }
        let target = user_mods_root(&app).join(&id);
        if !target.is_dir() {
            return Err(format!("not-found: {}", id));
        }
        trash::delete(&target).map_err(io_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------- 開発中の MOD

fn dev_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_root(app)?.join("dev-mods.json"))
}

/// 登録してある開発中の MOD のフォルダ（今もあるものだけ）
pub(crate) fn dev_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let Ok(p) = dev_file(app) else { return Vec::new() };
    let Ok(text) = std::fs::read_to_string(p) else { return Vec::new() };
    let list: Vec<String> = serde_json::from_str(&text).unwrap_or_default();
    list.into_iter().map(PathBuf::from).filter(|d| d.is_dir()).collect()
}

fn save_dev_dirs(app: &AppHandle, dirs: &[PathBuf]) -> Result<(), String> {
    let p = dev_file(app)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(io_err)?;
    }
    let list: Vec<String> = dirs.iter().map(|d| d.to_string_lossy().into_owned()).collect();
    std::fs::write(p, serde_json::to_string_pretty(&list).unwrap()).map_err(io_err)
}

fn add_dev_dir(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let (_, id, _) = read_manifest(dir)?;
    if !valid_id(&id) || id.starts_with("builtin.") {
        return Err(format!("invalid: id \"{}\"", id));
    }
    let mut dirs = dev_dirs(app);
    if !dirs.iter().any(|d| d == dir) {
        dirs.push(dir.to_path_buf());
    }
    save_dev_dirs(app, &dirs)
}

/// 開発中の MOD のフォルダを選んで、登録する。選ばなければ None
#[tauri::command]
pub async fn dev_mod_add(app: AppHandle, window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(dir) = app.dialog().file().set_parent(&window).set_title("開発中の MOD のフォルダ（manifest.json があるフォルダ）").blocking_pick_folder() else {
            return Ok(None);
        };
        let dir = dir.into_path().map_err(io_err)?;
        add_dev_dir(&app, &dir)?;
        Ok(Some(dir.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 名前から、MOD の id に使える部分を作る（英数字以外は - に。足りなければ作った時刻）
fn slug(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if s.len() >= 3 {
        s.chars().take(48).collect()
    } else {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        format!("view-{:x}", t)
    }
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(io_err)?;
    for e in std::fs::read_dir(from).map_err(io_err)? {
        let e = e.map_err(io_err)?;
        let dest = to.join(e.file_name());
        if e.path().is_dir() {
            copy_dir(&e.path(), &dest)?;
        } else {
            std::fs::copy(e.path(), dest).map_err(io_err)?;
        }
    }
    Ok(())
}

/// ひな形から新しい MOD を作る：置き場所を選んでもらい、そこに name のフォルダを作って、開発中の MOD として登録する
#[tauri::command]
pub async fn dev_mod_create(app: AppHandle, window: tauri::WebviewWindow, name: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = name.trim().to_string();
        if name.is_empty() || name.chars().any(|c| "\\/:*?\"<>|".contains(c)) {
            return Err("invalid: name".into());
        }
        let Some(parent) = app.dialog().file().set_parent(&window).set_title("新しい MOD のフォルダを作る場所").blocking_pick_folder() else {
            return Ok(None);
        };
        let parent = parent.into_path().map_err(io_err)?;
        let dir = parent.join(&name);
        if dir.exists() {
            return Err(format!("exists: {}", dir.display()));
        }
        copy_dir(&builtin_root(&app, "mod-template"), &dir)?;
        // 型の定義と説明書は、アプリに入っている今のものを入れる（ひな形とずれないように）
        let _ = std::fs::copy(builtin_root(&app, "runtime").join("explorer-plus.d.ts"), dir.join("explorer-plus.d.ts"));
        let _ = std::fs::copy(builtin_root(&app, "mod-docs").join("index.html"), dir.join("MOD開発ガイド.html"));
        // manifest の id と名前を、この MOD のものにする
        let mp = dir.join("manifest.json");
        let mut v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&mp).map_err(io_err)?).map_err(io_err)?;
        v["id"] = serde_json::Value::String(format!("my.{}", slug(&name)));
        v["name"] = serde_json::Value::String(name.chars().take(40).collect());
        std::fs::write(&mp, serde_json::to_string_pretty(&v).unwrap() + "\n").map_err(io_err)?;
        add_dev_dir(&app, &dir)?;
        Ok(Some(dir.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 開発中の MOD を、配れる zip にまとめる。MOD のフォルダの隣に「id-版.zip」を作る
#[tauri::command]
pub async fn mod_pack(app: AppHandle, id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = dev_dirs(&app)
            .into_iter()
            .find(|d| read_manifest(d).map(|(_, i, _)| i == id).unwrap_or(false))
            .ok_or_else(|| format!("not-found: dev MOD {}", id))?;
        let (text, _, _) = read_manifest(&dir)?;
        let version = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.get("version").and_then(|x| x.as_str()).map(String::from))
            .unwrap_or_else(|| "0.0.0".into());
        let out = dir.parent().unwrap_or(&dir).join(format!("{}-{}.zip", id, version));
        let mut zw = zip::ZipWriter::new(File::create(&out).map_err(io_err)?);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        fn add(zw: &mut zip::ZipWriter<File>, base: &Path, dir: &Path, opts: zip::write::SimpleFileOptions) -> Result<(), String> {
            let mut items: Vec<PathBuf> = std::fs::read_dir(dir).map_err(io_err)?.filter_map(|e| e.ok()).map(|e| e.path()).collect();
            items.sort();
            for p in items {
                let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let top_file = dir == base && p.is_file() && PACK_SKIP_FILES.contains(&name.as_str());
                if PACK_SKIP.contains(&name.as_str()) || name.ends_with(".zip") || top_file {
                    continue;
                }
                let rel = p.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/");
                if p.is_dir() {
                    add(zw, base, &p, opts)?;
                } else {
                    zw.start_file(rel, opts).map_err(io_err)?;
                    let mut buf = Vec::new();
                    File::open(&p).map_err(io_err)?.read_to_end(&mut buf).map_err(io_err)?;
                    zw.write_all(&buf).map_err(io_err)?;
                }
            }
            Ok(())
        }
        add(&mut zw, &dir, &dir, opts)?;
        zw.finish().map_err(io_err)?;
        Ok(out.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// MOD の zip を選んでもらう。選ばなければ None
#[tauri::command]
pub async fn pick_mod_zip(app: AppHandle, window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(app
            .dialog()
            .file()
            // アプリの窓の子にする（窓の後ろに隠れず、選び終わるまでアプリを触れないように）
            .set_parent(&window)
            .set_title("入れる MOD（zip）")
            .add_filter("MOD（zip）", &["zip"])
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 開発者ツールを開く（MOD のエラーを見るため。インストールした版でも開ける）
#[tauri::command]
pub fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

/// アプリに同梱した MOD 開発ガイドを、既定のブラウザで開く
#[tauri::command]
pub fn open_mod_docs(app: AppHandle) -> Result<(), String> {
    let p = builtin_root(&app, "mod-docs").join("index.html");
    tauri_plugin_opener::open_path(p, None::<&str>).map_err(io_err)
}

// ---------------------------------------------------------------- 開発中の MOD の見張り（ホットリロード）

#[derive(Default)]
pub struct DevWatch(Mutex<Option<RecommendedWatcher>>);

/// 開発中の MOD のフォルダを見張り直す。中身が変わったら "mod-changed"（そのフォルダのパス）を知らせる
pub(crate) fn watch_dev(app: &AppHandle, dirs: &[PathBuf]) {
    let state = app.state::<DevWatch>();
    let mut guard = state.0.lock().unwrap();
    *guard = None;
    if dirs.is_empty() {
        return;
    }
    let roots = dirs.to_vec();
    let app2 = app.clone();
    let Ok(mut w) = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(event) = res else { return };
        if event.kind.is_access() {
            return;
        }
        for p in &event.paths {
            if p.components().any(|c| PACK_SKIP.iter().any(|s| c.as_os_str() == *s)) || p.extension().is_some_and(|e| e == "zip") {
                continue;
            }
            if let Some(root) = roots.iter().find(|r| p.starts_with(r)) {
                let _ = app2.emit("mod-changed", root.to_string_lossy().into_owned());
            }
        }
    }) else {
        return;
    };
    for d in dirs {
        let _ = w.watch(d, RecursiveMode::Recursive);
    }
    *guard = Some(w);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ep-modinstall-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn write_zip(path: &Path, files: &[(&str, &str)]) {
        let mut zw = zip::ZipWriter::new(File::create(path).unwrap());
        for (name, body) in files {
            zw.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            zw.write_all(body.as_bytes()).unwrap();
        }
        zw.finish().unwrap();
    }

    #[test]
    fn extracts_and_finds_manifest_at_top_or_in_one_folder() {
        let d = temp("a");
        write_zip(&d.join("top.zip"), &[("manifest.json", "{}"), ("index.js", "")]);
        let out = d.join("top");
        assert_eq!(extract(&d.join("top.zip"), &out).unwrap().0, 2);
        assert_eq!(mod_root(&out).unwrap(), out);
        write_zip(&d.join("nested.zip"), &[("my-view/manifest.json", "{}"), ("my-view/index.js", "")]);
        let out = d.join("nested");
        extract(&d.join("nested.zip"), &out).unwrap();
        assert_eq!(mod_root(&out).unwrap(), out.join("my-view"));
        write_zip(&d.join("none.zip"), &[("readme.txt", "")]);
        let out = d.join("none");
        extract(&d.join("none.zip"), &out).unwrap();
        assert!(mod_root(&out).is_err());
    }

    #[test]
    fn rejects_paths_that_escape() {
        let d = temp("b");
        write_zip(&d.join("bad.zip"), &[("../evil.js", "x")]);
        assert!(extract(&d.join("bad.zip"), &d.join("out")).unwrap_err().starts_with("invalid"));
        assert!(!d.join("evil.js").exists());
    }

    #[test]
    fn slug_makes_ids() {
        assert_eq!(slug("My Cool View!"), "my-cool-view");
        assert!(slug("時間割").starts_with("view-"));
        assert!(valid_id(&format!("my.{}", slug("Photo Map 2"))));
    }
}
