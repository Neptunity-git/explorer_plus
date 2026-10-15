// 開いているフォルダの見張り（ADR 0018）。ほかのアプリ（普通のエクスプローラなど）でファイルが増えた・消えた・名前が変わったとき、
// 本体の画面に "folder-changed"（変わったフォルダのパス）を知らせる。本体はそのフォルダを開いているタブを読み直す。
// 見張るのはフォルダの直下だけ（下の階層までは見ない。開いているのは直下の一覧なので）。
// あわせて、1件ずつの変化（作られた・消えた・名前が変わった・書き換わった）を "folder-change" で知らせる（ADR 0023。MOD のアニメーション用）。

use notify::event::{EventKind, ModifyKind, RenameMode};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// 見張りの係と、いま見張っているフォルダ（知らせの中でも読むので共有する）
type Watched = Arc<Mutex<HashSet<PathBuf>>>;

/// ウィンドウが複数あるとき（ADR 0030）は、ウィンドウごとに見張りたいフォルダを覚え、その全部を見張る
#[derive(Default)]
pub struct FolderWatch {
    inner: Mutex<Option<(RecommendedWatcher, Watched)>>,
    wanted: Mutex<HashMap<String, HashSet<PathBuf>>>,
}

/// ウィンドウが閉じたら、そのウィンドウの分の見張りをやめる
pub fn forget_window(app: &AppHandle, label: &str) {
    use tauri::Manager;
    let state = app.state::<FolderWatch>();
    let wanted = {
        let mut w = state.wanted.lock().unwrap();
        w.remove(label);
        w.values().flatten().cloned().collect::<HashSet<PathBuf>>()
    };
    let mut guard = state.inner.lock().unwrap();
    if let Some((watcher, watched)) = guard.as_mut() {
        apply(watcher, watched, &wanted);
    }
}

/// 見張っているフォルダを、wanted に合わせる
fn apply(watcher: &mut RecommendedWatcher, watched: &Watched, wanted: &HashSet<PathBuf>) {
    let mut current = watched.lock().unwrap();
    for p in current.difference(wanted).cloned().collect::<Vec<_>>() {
        let _ = watcher.unwatch(&p);
        current.remove(&p);
    }
    for p in wanted.difference(&current).cloned().collect::<Vec<_>>() {
        // 見張れないフォルダ（権限が無い、など）は、F5 で読み直せばよいので飛ばす
        if watcher.watch(&p, RecursiveMode::NonRecursive).is_ok() {
            current.insert(p);
        }
    }
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

/// 1件の変化。kind は "created"・"removed"・"modified"・"renamed"（from あり）・"renamedFrom"・"renamedTo"
/// （Windows は名前の変更を「前の名前」「後の名前」の2つに分けて知らせることがある。組み合わせるのは本体）
#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    folder: String,
    kind: &'static str,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    from: Option<String>,
}

/// 見張っているフォルダの直下の項目の変化だけを、1件ずつにする
fn changes_of(event: &Event, watched: &HashSet<PathBuf>) -> Vec<Change> {
    let folder_of = |p: &Path| -> Option<String> {
        let parent = p.parent()?;
        let name = p.file_name()?.to_string_lossy();
        if name.eq_ignore_ascii_case(crate::folderdata::DATA_DIR) {
            return None;
        }
        watched.iter().any(|w| same_path(w, parent)).then(|| parent.to_string_lossy().into_owned())
    };
    let one = |kind: &'static str, p: &PathBuf| folder_of(p).map(|folder| Change { folder, kind, path: p.to_string_lossy().into_owned(), from: None });
    match &event.kind {
        EventKind::Create(_) => event.paths.iter().filter_map(|p| one("created", p)).collect(),
        EventKind::Remove(_) => event.paths.iter().filter_map(|p| one("removed", p)).collect(),
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if event.paths.len() == 2 => {
            let (from, to) = (&event.paths[0], &event.paths[1]);
            match (folder_of(from), folder_of(to)) {
                (_, Some(folder)) => vec![Change { folder, kind: "renamed", path: to.to_string_lossy().into_owned(), from: Some(from.to_string_lossy().into_owned()) }],
                (Some(_), None) => one("removed", from).into_iter().collect(),
                _ => vec![],
            }
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => event.paths.iter().filter_map(|p| one("renamedFrom", p)).collect(),
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => event.paths.iter().filter_map(|p| one("renamedTo", p)).collect(),
        EventKind::Modify(_) => event.paths.iter().filter_map(|p| one("modified", p)).collect(),
        _ => vec![],
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().trim_end_matches('\\').eq_ignore_ascii_case(b.to_string_lossy().trim_end_matches('\\'))
}

/// 見張るフォルダの一覧を、まるごと置き換える（タブで開いているフォルダが変わるたびに呼ぶ）
#[tauri::command]
pub fn watch_folders(app: AppHandle, window: tauri::Window, state: tauri::State<'_, FolderWatch>, paths: Vec<String>) -> Result<(), String> {
    let mine: HashSet<PathBuf> = paths.iter().map(PathBuf::from).filter(|p| p.is_dir()).collect();
    let wanted: HashSet<PathBuf> = {
        let mut w = state.wanted.lock().unwrap();
        w.insert(window.label().to_string(), mine);
        w.values().flatten().cloned().collect()
    };
    let mut guard = state.inner.lock().unwrap();
    if guard.is_none() {
        let watched: Watched = Arc::default();
        let shared = watched.clone();
        let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };
            if event.kind.is_access() {
                return;
            }
            let watched = shared.lock().unwrap();
            for change in changes_of(&event, &watched) {
                let _ = app.emit("folder-change", change);
            }
            for folder in changed_folders(&event, &watched) {
                let _ = app.emit("folder-changed", folder);
            }
        })
        .map_err(|e| format!("io: {}", e))?;
        *guard = Some((watcher, watched));
    }
    let (watcher, watched) = guard.as_mut().unwrap();
    apply(watcher, watched, &wanted);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, EventKind};

    #[test]
    fn describes_each_change() {
        use notify::event::{ModifyKind, RemoveKind, RenameMode};
        let watched: HashSet<PathBuf> = [PathBuf::from(r"C:\A")].into_iter().collect();
        let ev = |k: EventKind, paths: &[&str]| paths.iter().fold(Event::new(k), |e, p| e.add_path(PathBuf::from(p)));
        let c = changes_of(&ev(EventKind::Create(CreateKind::File), &[r"C:\A\new.txt"]), &watched);
        assert_eq!((c[0].kind, c[0].folder.as_str()), ("created", r"C:\A"));
        assert_eq!(changes_of(&ev(EventKind::Remove(RemoveKind::Any), &[r"C:\A\x"]), &watched)[0].kind, "removed");
        let r = changes_of(&ev(EventKind::Modify(ModifyKind::Name(RenameMode::Both)), &[r"C:\A\old", r"C:\A\new"]), &watched);
        assert_eq!((r[0].kind, r[0].path.as_str(), r[0].from.as_deref()), ("renamed", r"C:\A\new", Some(r"C:\A\old")));
        assert_eq!(changes_of(&ev(EventKind::Modify(ModifyKind::Name(RenameMode::From)), &[r"C:\A\old"]), &watched)[0].kind, "renamedFrom");
        // 見張っていないフォルダ・下の階層・.explorer_plus は知らせない
        assert!(changes_of(&ev(EventKind::Create(CreateKind::File), &[r"C:\B\x"]), &watched).is_empty());
        assert!(changes_of(&ev(EventKind::Create(CreateKind::File), &[r"C:\A\sub\x"]), &watched).is_empty());
        assert!(changes_of(&ev(EventKind::Create(CreateKind::Folder), &[r"C:\A\.explorer_plus"]), &watched).is_empty());
    }

    #[test]
    fn reports_parent_and_self_when_watched() {
        let watched: HashSet<PathBuf> = [PathBuf::from(r"C:\Data\A")].into_iter().collect();
        let ev = Event::new(EventKind::Create(CreateKind::File)).add_path(PathBuf::from(r"C:\data\a\new.txt"));
        assert_eq!(changed_folders(&ev, &watched), [r"C:\data\a".to_string()].into_iter().collect());
        let ev = Event::new(EventKind::Create(CreateKind::File)).add_path(PathBuf::from(r"C:\Other\x.txt"));
        assert!(changed_folders(&ev, &watched).is_empty());
    }
}
