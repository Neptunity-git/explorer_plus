// 開いているフォルダの見張り（ADR 0018）。ほかのアプリ（普通のエクスプローラなど）でファイルが増えた・消えた・名前が変わったとき、
// 本体の画面に "folder-changed"（変わったフォルダのパス）を知らせる。本体はそのフォルダを開いているタブを読み直す。
// 見張るのはフォルダの直下だけ（下の階層までは見ない。開いているのは直下の一覧なので）。

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// 見張りの係と、いま見張っているフォルダ（知らせの中でも読むので共有する）
type Watched = Arc<Mutex<HashSet<PathBuf>>>;

#[derive(Default)]
pub struct FolderWatch {
    inner: Mutex<Option<(RecommendedWatcher, Watched)>>,
}

/// 変化のあったパスから、知らせるフォルダを決める：そのパスの親（直下の項目が変わった）と、そのパス自身（見張っているフォルダそのものが変わった）
fn changed_folders(event: &Event, watched: &HashSet<PathBuf>) -> HashSet<String> {
    let mut out = HashSet::new();
    for p in &event.paths {
        for cand in [p.parent(), Some(p.as_path())].into_iter().flatten() {
            if watched.iter().any(|w| same_path(w, cand)) {
                out.insert(cand.to_string_lossy().into_owned());
            }
        }
    }
    out
}

fn same_path(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().trim_end_matches('\\').eq_ignore_ascii_case(b.to_string_lossy().trim_end_matches('\\'))
}

/// 見張るフォルダの一覧を、まるごと置き換える（タブで開いているフォルダが変わるたびに呼ぶ）
#[tauri::command]
pub fn watch_folders(app: AppHandle, state: tauri::State<'_, FolderWatch>, paths: Vec<String>) -> Result<(), String> {
    let wanted: HashSet<PathBuf> = paths.iter().map(PathBuf::from).filter(|p| p.is_dir()).collect();
    let mut guard = state.inner.lock().unwrap();
    if guard.is_none() {
        let watched: Watched = Arc::default();
        let shared = watched.clone();
        let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };
            if event.kind.is_access() {
                return;
            }
            for folder in changed_folders(&event, &shared.lock().unwrap()) {
                let _ = app.emit("folder-changed", folder);
            }
        })
        .map_err(|e| format!("io: {}", e))?;
        *guard = Some((watcher, watched));
    }
    let (watcher, watched) = guard.as_mut().unwrap();
    let mut current = watched.lock().unwrap();
    for p in current.difference(&wanted).cloned().collect::<Vec<_>>() {
        let _ = watcher.unwatch(&p);
        current.remove(&p);
    }
    for p in wanted.difference(&current).cloned().collect::<Vec<_>>() {
        // 見張れないフォルダ（権限が無い、など）は、F5 で読み直せばよいので飛ばす
        if watcher.watch(&p, RecursiveMode::NonRecursive).is_ok() {
            current.insert(p);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, EventKind};

    #[test]
    fn reports_parent_and_self_when_watched() {
        let watched: HashSet<PathBuf> = [PathBuf::from(r"C:\Data\A")].into_iter().collect();
        let ev = Event::new(EventKind::Create(CreateKind::File)).add_path(PathBuf::from(r"C:\data\a\new.txt"));
        assert_eq!(changed_folders(&ev, &watched), [r"C:\data\a".to_string()].into_iter().collect());
        let ev = Event::new(EventKind::Create(CreateKind::File)).add_path(PathBuf::from(r"C:\Other\x.txt"));
        assert!(changed_folders(&ev, &watched).is_empty());
    }
}
