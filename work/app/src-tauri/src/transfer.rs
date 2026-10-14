// 切り取り・コピー・貼り付けと、ドラッグ＆ドロップの移動・コピー（ADR 0015）。
// クリップボードは Windows のエクスプローラと同じ形式（CF_HDROP と Preferred DropEffect）を使い、
// コピー・移動は Windows の仕組み（IFileOperation）に任せる。進み具合・同じ名前のときの画面は Windows が出す。

use crate::fsops::{verify, EntryRef};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::core::{w, BOOL, HRESULT, PCWSTR};
use windows::Win32::Foundation::{DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, HANDLE, HGLOBAL, HWND, S_OK};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, IDataObject, CLSCTX_ALL, COINIT_APARTMENTTHREADED};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::{DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_MOVE, DROPEFFECT_NONE};
use windows::Win32::System::SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    DragQueryFileW, FileOperation, IFileOperation, IShellItem, BHID_DataObject, IShellItemArray, SHCreateItemFromParsingName, SHCreateShellItemArrayFromIDLists, SHParseDisplayName, DROPFILES,
    FOF_ALLOWUNDO, FOF_RENAMEONCOLLISION, HDROP,
};

/// エクスプローラの「切り取りかコピーか」の印（DROPEFFECT_MOVE = 2、DROPEFFECT_COPY | DROPEFFECT_LINK = 5）
const EFFECT_MOVE: u32 = 2;
const EFFECT_COPY: u32 = 5;

fn wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

/// ほかのアプリがクリップボードを使っている間は開けないので、少し待って何度か試す。
/// 書き込むときは owner（このアプリのウィンドウ）が要る（None で開くと、SetClipboardData が失敗する。Windows の決まり）
fn open_clipboard(owner: Option<HWND>) -> Result<(), String> {
    for _ in 0..10 {
        if unsafe { OpenClipboard(owner) }.is_ok() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(30));
    }
    Err("io: the clipboard is busy".into())
}

fn global_with(bytes: &[u8]) -> Result<HGLOBAL, String> {
    unsafe {
        let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|e| format!("io: {}", e))?;
        let p = GlobalLock(h) as *mut u8;
        if p.is_null() {
            return Err("io: GlobalLock failed".into());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
        let _ = GlobalUnlock(h);
        Ok(h)
    }
}

fn drop_effect_format() -> u32 {
    unsafe { RegisterClipboardFormatW(w!("Preferred DropEffect")) }
}

/// ファイルの一覧を、エクスプローラと同じ形式でクリップボードに入れる
fn set_clipboard_files(paths: &[String], cut: bool, owner: Option<HWND>) -> Result<(), String> {
    // DROPFILES の後ろに、0 で区切ったパスを並べ、最後にもう1つ 0 を置く
    let header = std::mem::size_of::<DROPFILES>();
    let mut names: Vec<u16> = Vec::new();
    for p in paths {
        names.extend(std::ffi::OsStr::new(p).encode_wide());
        names.push(0);
    }
    names.push(0);
    let df = DROPFILES { pFiles: header as u32, fWide: true.into(), ..Default::default() };
    let mut bytes = vec![0u8; header + names.len() * 2];
    unsafe {
        std::ptr::copy_nonoverlapping(&df as *const DROPFILES as *const u8, bytes.as_mut_ptr(), header);
        std::ptr::copy_nonoverlapping(names.as_ptr() as *const u8, bytes.as_mut_ptr().add(header), names.len() * 2);
    }
    let effect = (if cut { EFFECT_MOVE } else { EFFECT_COPY }).to_le_bytes();
    open_clipboard(owner)?;
    let result = (|| unsafe {
        EmptyClipboard().map_err(|e| format!("io: {}", e))?;
        SetClipboardData(CF_HDROP.0 as u32, Some(HANDLE(global_with(&bytes)?.0))).map_err(|e| format!("io: {}", e))?;
        SetClipboardData(drop_effect_format(), Some(HANDLE(global_with(&effect)?.0))).map_err(|e| format!("io: {}", e))?;
        Ok(())
    })();
    unsafe {
        let _ = CloseClipboard();
    }
    result
}

/// クリップボードのファイルの一覧と、切り取りかどうか。ファイルが入っていなければ None
fn get_clipboard_files() -> Result<Option<(Vec<String>, bool)>, String> {
    open_clipboard(None)?;
    let result = unsafe {
        match GetClipboardData(CF_HDROP.0 as u32) {
            Err(_) => None,
            Ok(h) => {
                let hdrop = HDROP(h.0);
                let count = DragQueryFileW(hdrop, u32::MAX, None);
                let mut paths = Vec::new();
                for i in 0..count {
                    let len = DragQueryFileW(hdrop, i, None) as usize;
                    let mut buf = vec![0u16; len + 1];
                    DragQueryFileW(hdrop, i, Some(&mut buf));
                    paths.push(String::from_utf16_lossy(&buf[..len]));
                }
                let cut = match GetClipboardData(drop_effect_format()) {
                    Ok(e) => {
                        let p = GlobalLock(HGLOBAL(e.0)) as *const u32;
                        let v = if p.is_null() { EFFECT_COPY } else { p.read_unaligned() };
                        let _ = GlobalUnlock(HGLOBAL(e.0));
                        v & EFFECT_MOVE != 0
                    }
                    Err(_) => false,
                };
                Some((paths, cut))
            }
        }
    };
    unsafe {
        let _ = CloseClipboard();
    }
    Ok(result)
}

fn parent_of(path: &str) -> String {
    Path::new(path).parent().map(|p| p.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// Windows の仕組みでコピー・移動する。進み具合・同じ名前のときの画面は Windows が出す。中止されたら Err("denied: …")
fn shell_transfer(sources: &[String], dest: &str, is_move: bool, owner: Option<HWND>) -> Result<usize, String> {
    if !Path::new(dest).is_dir() {
        return Err(format!("not-found: {}", dest));
    }
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL).map_err(|e| format!("io: {}", e))?;
        if let Some(h) = owner {
            let _ = op.SetOwnerWindow(h);
        }
        // 同じフォルダへのコピー（Ctrl を押して同じ場所に落とす・同じフォルダに貼り付ける）は、エクスプローラと同じく「- コピー」の名前で作る
        let same_folder = sources.iter().any(|s| parent_of(s) == dest.trim_end_matches('\\').to_lowercase());
        let mut flags = FOF_ALLOWUNDO.0 as u32;
        if same_folder && !is_move {
            flags |= FOF_RENAMEONCOLLISION.0 as u32;
        }
        op.SetOperationFlags(windows::Win32::UI::Shell::FILEOPERATION_FLAGS(flags)).map_err(|e| format!("io: {}", e))?;
        let d = wide(dest);
        let dest_item: IShellItem = SHCreateItemFromParsingName(PCWSTR(d.as_ptr()), None).map_err(|e| format!("io: {}", e))?;
        for s in sources {
            let sw = wide(s);
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(sw.as_ptr()), None).map_err(|_| format!("not-found: {}", s))?;
            if is_move {
                op.MoveItem(&item, &dest_item, PCWSTR::null(), None).map_err(|e| format!("io: {}", e))?;
            } else {
                op.CopyItem(&item, &dest_item, PCWSTR::null(), None).map_err(|e| format!("io: {}", e))?;
            }
        }
        // ユーザーが Windows の画面で「キャンセル」を押すと、ここが失敗するか、中止の印が立つ
        op.PerformOperations().map_err(|_| "denied: cancelled".to_string())?;
        if op.GetAnyOperationsAborted().map(|b| b.as_bool()).unwrap_or(false) {
            return Err("denied: cancelled".into());
        }
    }
    Ok(sources.len())
}

fn owner_hwnd(window: &tauri::WebviewWindow) -> Option<HWND> {
    // Tauri が使う windows クレートの版と、このアプリの版が違うことがあるので、生の値で渡す
    window.hwnd().ok().map(|h| HWND(h.0 as _))
}

/// MOD から頼まれた項目は、ファイルID の一致を確かめてから扱う（ADR 0002 判断3）
fn verified_paths(items: &[EntryRef]) -> Result<Vec<String>, String> {
    items.iter().map(|r| verify(r).map(|p| p.to_string_lossy().into_owned())).collect()
}

#[tauri::command]
pub async fn clipboard_set(window: tauri::WebviewWindow, items: Vec<EntryRef>, cut: bool) -> Result<(), String> {
    let owner = owner_hwnd(&window).map(|h| h.0 as isize);
    tauri::async_runtime::spawn_blocking(move || set_clipboard_files(&verified_paths(&items)?, cut, owner.map(|h| HWND(h as _))))
        .await
        .map_err(|e| e.to_string())?
}

/// クリップボードのファイルを dest へ貼り付ける。切り取りなら移動して、クリップボードを空にする（エクスプローラと同じ）
#[tauri::command]
pub async fn clipboard_paste(window: tauri::WebviewWindow, dest: String) -> Result<usize, String> {
    let owner = owner_hwnd(&window).map(|h| h.0 as isize);
    tauri::async_runtime::spawn_blocking(move || {
        let Some((paths, cut)) = get_clipboard_files()? else { return Ok(0) };
        if paths.is_empty() {
            return Ok(0);
        }
        let n = shell_transfer(&paths, &dest, cut, owner.map(|h| HWND(h as _)))?;
        if cut {
            open_clipboard(owner.map(|h| HWND(h as _)))?;
            unsafe {
                let _ = EmptyClipboard();
                let _ = CloseClipboard();
            }
        }
        Ok(n)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// ドラッグ＆ドロップで落としたときの移動・コピー。effect は "move" か "copy"
#[tauri::command]
pub async fn transfer(window: tauri::WebviewWindow, items: Vec<EntryRef>, dest: String, effect: String) -> Result<usize, String> {
    let owner = owner_hwnd(&window).map(|h| h.0 as isize);
    tauri::async_runtime::spawn_blocking(move || {
        let is_move = match effect.as_str() {
            "move" => true,
            "copy" => false,
            _ => return Err(format!("invalid: effect {}", effect)),
        };
        shell_transfer(&verified_paths(&items)?, &dest, is_move, owner.map(|h| HWND(h as _)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 普通のエクスプローラなど、アプリの外からドロップされたファイルを dest へ移動・コピーする（ADR 0016）。
/// パスは Windows が渡してきたもの（本体の画面だけが呼ぶ。MOD は呼べない）なので、ファイルID の確かめはない
#[tauri::command]
pub async fn transfer_paths(window: tauri::WebviewWindow, paths: Vec<String>, dest: String, effect: String) -> Result<usize, String> {
    let owner = owner_hwnd(&window).map(|h| h.0 as isize);
    tauri::async_runtime::spawn_blocking(move || {
        let is_move = match effect.as_str() {
            "move" => true,
            "copy" => false,
            _ => return Err(format!("invalid: effect {}", effect)),
        };
        if paths.is_empty() {
            return Ok(0);
        }
        shell_transfer(&paths, &dest, is_move, owner.map(|h| HWND(h as _)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// ドラッグの「持ち主」側の約束事。ボタンを離したら落とす・Esc で取りやめる
#[windows::core::implement(IDropSource)]
struct DragSource;

impl IDropSource_Impl for DragSource_Impl {
    fn QueryContinueDrag(&self, escape_pressed: BOOL, key_state: MODIFIERKEYS_FLAGS) -> HRESULT {
        if escape_pressed.as_bool() {
            DRAGDROP_S_CANCEL
        } else if key_state.0 & MK_LBUTTON.0 == 0 {
            DRAGDROP_S_DROP
        } else {
            S_OK
        }
    }

    fn GiveFeedback(&self, _effect: DROPEFFECT) -> HRESULT {
        DRAGDROP_S_USEDEFAULTCURSORS
    }
}

/// アプリの外（普通のエクスプローラ・デスクトップなど）へファイルをドラッグして落とす（ADR 0016）。
/// マウスのボタンが押されている間だけ呼ぶ。落とされるまで戻らない。戻り値は "dropped"（どこかに落とされた）か "cancelled"。
/// 同期のコマンドなので、画面を動かしているスレッドで動く（OLE のドラッグはそのスレッドで動かす決まり）
#[tauri::command]
pub fn drag_out(items: Vec<EntryRef>) -> Result<String, String> {
    let paths = verified_paths(&items)?;
    if paths.is_empty() {
        return Ok("none".into());
    }
    unsafe {
        let _ = OleInitialize(None);
        let mut pidls: Vec<*mut ITEMIDLIST> = Vec::new();
        for p in &paths {
            let w = wide(p);
            let mut pidl: *mut ITEMIDLIST = std::ptr::null_mut();
            if SHParseDisplayName(PCWSTR(w.as_ptr()), None, &mut pidl, 0, None).is_err() {
                for q in &pidls {
                    CoTaskMemFree(Some(*q as _));
                }
                return Err(format!("not-found: {}", p));
            }
            pidls.push(pidl);
        }
        let list: Vec<*const ITEMIDLIST> = pidls.iter().map(|p| *p as *const ITEMIDLIST).collect();
        // 項目のまとまり（エクスプローラで選んだときと同じもの）から、ドラッグで渡すデータを作ってもらう
        let data: Result<IDataObject, _> = SHCreateShellItemArrayFromIDLists(&list).and_then(|arr: IShellItemArray| arr.BindToHandler(None, &BHID_DataObject));
        for q in &pidls {
            CoTaskMemFree(Some(*q as _));
        }
        let data = data.map_err(|e| format!("io: {}", e))?;
        let source: IDropSource = DragSource.into();
        let mut effect = DROPEFFECT_NONE;
        let hr = DoDragDrop(&data, &source, DROPEFFECT_COPY | DROPEFFECT_MOVE, &mut effect);
        // 移動のときは、落とした先（エクスプローラ）が自分で移動して、結果は「何もしない」と返ってくる（Windows の決まり）。
        // なので、結果ではなく「落とされたか」で答える
        Ok(if hr == DRAGDROP_S_DROP { "dropped" } else { "cancelled" }.into())
    }
}

/// 「プログラムから開く」：Windows の「アプリを選ぶ」画面を出し、選んだアプリで開く（ADR 0015 判断5）。
/// 「常にこのアプリを使う」も、その画面で選べる。やめたら Err("denied: …")
#[tauri::command]
pub async fn open_with(window: tauri::WebviewWindow, item: EntryRef) -> Result<(), String> {
    use windows::Win32::UI::Shell::{SHOpenWithDialog, OAIF_ALLOW_REGISTRATION, OAIF_EXEC, OAIF_REGISTER_EXT, OPENASINFO};
    let owner = owner_hwnd(&window).map(|h| h.0 as isize);
    tauri::async_runtime::spawn_blocking(move || {
        let path = verify(&item)?;
        if path.is_dir() {
            return Err("invalid: folders cannot be opened with a program".into());
        }
        let file = wide(&path.to_string_lossy());
        let info = OPENASINFO {
            pcszFile: PCWSTR(file.as_ptr()),
            pcszClass: PCWSTR::null(),
            oaifInFlags: OAIF_ALLOW_REGISTRATION | OAIF_REGISTER_EXT | OAIF_EXEC,
        };
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            SHOpenWithDialog(owner.map(|h| HWND(h as _)), &info).map_err(|_| "denied: cancelled".to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("explorer-plus-transfer-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn shell_copy_and_move() {
        let d = temp_dir("ops");
        let a = d.join("a");
        let b = d.join("b");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        let f = a.join("f.txt");
        std::fs::write(&f, "x").unwrap();
        let fs = f.to_string_lossy().into_owned();
        // コピー：元は残る
        assert_eq!(shell_transfer(&[fs.clone()], &b.to_string_lossy(), false, None).unwrap(), 1);
        assert!(f.exists() && b.join("f.txt").exists());
        // 同じフォルダへのコピー：「- コピー」の名前で増える（名前は Windows の言語で変わるので、数だけ確かめる）
        shell_transfer(&[fs.clone()], &a.to_string_lossy(), false, None).unwrap();
        assert_eq!(std::fs::read_dir(&a).unwrap().count(), 2);
        // 移動：元から消える
        let c = d.join("c");
        std::fs::create_dir_all(&c).unwrap();
        shell_transfer(&[fs.clone()], &c.to_string_lossy(), true, None).unwrap();
        assert!(!f.exists() && c.join("f.txt").exists());
        assert!(shell_transfer(&[fs], &d.join("nope").to_string_lossy(), true, None).unwrap_err().starts_with("not-found"));
        let _ = std::fs::remove_dir_all(&d);
    }

    // 本物のクリップボードの中身を書き換えるので、ふだんは流さない（cargo test -- --ignored で流す）
    #[test]
    #[ignore]
    fn clipboard_round_trip() {
        let paths = vec![r"C:\explorer-plus-test\a.txt".to_string(), r"C:\explorer-plus-test\b c.txt".to_string()];
        // 試験の前のクリップボードの中身は戻せないので、ファイルの一覧の形だけを確かめる
        // 書き込みには持ち主のウィンドウが要るので、試験ではコンソールのウィンドウを使う（無い環境では試さない）
        let owner = unsafe { windows::Win32::System::Console::GetConsoleWindow() };
        if owner.is_invalid() {
            return;
        }
        let owner = Some(owner);
        set_clipboard_files(&paths, true, owner).unwrap();
        let (got, cut) = get_clipboard_files().unwrap().unwrap();
        assert_eq!(got, paths);
        assert!(cut);
        set_clipboard_files(&paths[..1], false, owner).unwrap();
        let (got, cut) = get_clipboard_files().unwrap().unwrap();
        assert_eq!(got, paths[..1]);
        assert!(!cut);
        open_clipboard(owner).unwrap();
        unsafe {
            let _ = EmptyClipboard();
            let _ = CloseClipboard();
        }
    }
}
