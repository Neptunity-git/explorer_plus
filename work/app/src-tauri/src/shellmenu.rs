// Windows 本来の右クリックのメニュー（シェルのメニュー）を使う（ADR 0016）。
// OneDrive の「共有」などは、Windows や OneDrive がメニューに足している項目なので、自分では作らず、その項目を呼び出す。

use crate::fsops::{verify, EntryRef};
use std::os::windows::ffi::OsStrExt;
use windows::core::{Interface, PCSTR, PCWSTR, PSTR};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Shell::{
    BHID_SFUIObject, CMINVOKECOMMANDINFO, IContextMenu, IContextMenu2, IShellItem, SHCreateItemFromParsingName, CMF_NORMAL, GCS_VERBW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreatePopupMenu, DestroyMenu, GetMenuItemCount, GetMenuItemInfoW, HMENU, MENUITEMINFOW, MFT_SEPARATOR, MIIM_FTYPE,
    MIIM_ID, MIIM_STRING, MIIM_SUBMENU, SW_SHOWNORMAL, WM_INITMENUPOPUP,
};

/// メニューの項目の番号は、この数から始める（0 は「選ばなかった」の意味になるため）
const FIRST_ID: u32 = 1;

fn wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

/// メニューの1項目。path は親の項目の名前をたどったもの（例：["OneDrive", "共有"]）
#[derive(Debug, Clone)]
pub struct ShellMenuItem {
    pub path: Vec<String>,
    pub verb: String,
    pub id: u32,
}

/// そのファイル・フォルダの、Windows 本来の右クリックのメニューを作る
pub(crate) unsafe fn context_menu(path: &str) -> Result<(IContextMenu, HMENU), String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let w = wide(path);
        let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(w.as_ptr()), None).map_err(|_| format!("not-found: {}", path))?;
        let cm: IContextMenu = item.BindToHandler(None, &BHID_SFUIObject).map_err(|e| format!("io: {}", e))?;
        let menu = CreatePopupMenu().map_err(|e| format!("io: {}", e))?;
        cm.QueryContextMenu(menu, 0, FIRST_ID, 0x7FFF, CMF_NORMAL).ok().map_err(|e| format!("io: {}", e))?;
        Ok((cm, menu))
    }
}

/// メニューの項目を、下の階層まで全部並べる
pub(crate) unsafe fn list_items(cm: &IContextMenu, menu: HMENU, parents: &[String], out: &mut Vec<ShellMenuItem>) {
    unsafe {
        let cm2: Option<IContextMenu2> = cm.cast().ok();
        let n = GetMenuItemCount(Some(menu));
        for i in 0..n.max(0) {
            let mut buf = [0u16; 256];
            let mut info = MENUITEMINFOW {
                cbSize: std::mem::size_of::<MENUITEMINFOW>() as u32,
                fMask: MIIM_STRING | MIIM_ID | MIIM_SUBMENU | MIIM_FTYPE,
                dwTypeData: windows::core::PWSTR(buf.as_mut_ptr()),
                cch: buf.len() as u32,
                ..Default::default()
            };
            if GetMenuItemInfoW(menu, i as u32, true, &mut info).is_err() || (info.fType & MFT_SEPARATOR).0 != 0 {
                continue;
            }
            let text = String::from_utf16_lossy(&buf[..info.cch as usize]);
            let mut path = parents.to_vec();
            path.push(text);
            if !info.hSubMenu.is_invalid() {
                // 下の階層は、開くときに中身を作るものがあるので、「開くよ」と知らせてから読む
                if let Some(c2) = &cm2 {
                    let _ = c2.HandleMenuMsg(WM_INITMENUPOPUP, WPARAM(info.hSubMenu.0 as usize), LPARAM(i as isize));
                }
                list_items(cm, info.hSubMenu, &path, out);
                continue;
            }
            let mut verb = [0u8; 512];
            let mut v = String::new();
            if info.wID >= FIRST_ID
                && cm.GetCommandString((info.wID - FIRST_ID) as usize, GCS_VERBW, None, PSTR(verb.as_mut_ptr()), (verb.len() / 2) as u32).is_ok()
            {
                let wv: &[u16] = std::slice::from_raw_parts(verb.as_ptr() as *const u16, verb.len() / 2);
                let end = wv.iter().position(|&c| c == 0).unwrap_or(wv.len());
                v = String::from_utf16_lossy(&wv[..end]);
            }
            out.push(ShellMenuItem { path, verb: v, id: info.wID });
        }
    }
}

pub(crate) unsafe fn destroy(menu: HMENU) {
    unsafe {
        let _ = DestroyMenu(menu);
    }
}

/// OneDrive がメニューに足す項目の名前（verb）。末尾の2桁で、どの操作かが分かる。
/// 名前が見つからないとき（OneDrive の版の違いなど）は、表示の文字で探す
const ONEDRIVE_VERB_PREFIX: &str = "{5250E46F-BB09-D602-5891-F476DC89B7";

fn onedrive_match(action: &str, item: &ShellMenuItem) -> bool {
    let (suffix, texts): (&str, &[&str]) = match action {
        "share" => ("01}", &["共有", "Share"]),
        "copyLink" => ("02}", &["リンクのコピー", "Copy link"]),
        "manageAccess" => ("03}", &["アクセス許可の管理", "Manage access"]),
        "viewOnline" => ("04}", &["オンラインで表示", "View online"]),
        _ => return false,
    };
    let verb = item.verb.to_uppercase();
    if verb.starts_with(ONEDRIVE_VERB_PREFIX) {
        return verb.ends_with(suffix);
    }
    item.verb.is_empty() && item.path.len() == 1 && texts.iter().any(|t| item.path[0].starts_with(t))
}

/// そのファイル・フォルダが OneDrive の中にあるか（環境変数 OneDrive・OneDriveCommercial・OneDriveConsumer の下か）
fn in_onedrive(path: &str) -> bool {
    let p = path.to_lowercase();
    ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"].iter().filter_map(|k| std::env::var(k).ok()).any(|root| {
        let r = root.trim_end_matches('\\').to_lowercase();
        !r.is_empty() && (p == r || p.starts_with(&format!("{}\\", r)))
    })
}

#[tauri::command]
pub fn onedrive_contains(item: EntryRef) -> bool {
    verify(&item).map(|p| in_onedrive(&p.to_string_lossy())).unwrap_or(false)
}

/// OneDrive の操作（共有・リンクのコピー・アクセス許可の管理・オンラインで表示）を、Windows のメニューの項目を呼んで行う。
/// 画面は OneDrive が出す。同期のコマンドなので、画面を動かしているスレッドで動く
#[tauri::command]
pub fn onedrive_action(window: tauri::WebviewWindow, item: EntryRef, action: String) -> Result<(), String> {
    let path = verify(&item)?.to_string_lossy().into_owned();
    if !in_onedrive(&path) {
        return Err("invalid: not in OneDrive".into());
    }
    let owner = window.hwnd().ok().map(|h| HWND(h.0 as _));
    unsafe {
        let (cm, menu) = context_menu(&path)?;
        let mut items = Vec::new();
        list_items(&cm, menu, &[], &mut items);
        let found = items.iter().find(|it| onedrive_match(&action, it)).map(|it| it.id);
        let result = match found {
            None => Err(format!("not-found: OneDrive menu item {}", action)),
            Some(id) => {
                let info = CMINVOKECOMMANDINFO {
                    cbSize: std::mem::size_of::<CMINVOKECOMMANDINFO>() as u32,
                    hwnd: owner.unwrap_or_default(),
                    // 項目の番号で呼ぶ（文字の名前ではなく、番号を文字の場所に入れる決まり）
                    lpVerb: PCSTR((id - FIRST_ID) as usize as *const u8),
                    nShow: SW_SHOWNORMAL.0,
                    ..Default::default()
                };
                cm.InvokeCommand(&info).map_err(|e| format!("io: {}", e))
            }
        };
        destroy(menu);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(path: &[&str], verb: &str) -> ShellMenuItem {
        ShellMenuItem { path: path.iter().map(|s| s.to_string()).collect(), verb: verb.into(), id: 1 }
    }

    #[test]
    fn onedrive_items_are_found_by_verb_then_text() {
        let share = item(&["共有(&S)"], "{5250E46F-BB09-D602-5891-F476DC89B701}");
        let link = item(&["リンクのコピー"], "{5250e46f-bb09-d602-5891-f476dc89b702}");
        assert!(onedrive_match("share", &share));
        assert!(!onedrive_match("copyLink", &share));
        assert!(onedrive_match("copyLink", &link));
        // 名前（verb）の無い古い形の項目は、表示の文字で探す
        assert!(onedrive_match("share", &item(&["共有(&S)"], "")));
        // Windows 本来の「共有」（名前がある別の項目）や、下の階層の項目は選ばない
        assert!(!onedrive_match("share", &item(&["共有(&S)"], "Windows.ModernShare")));
        assert!(!onedrive_match("share", &item(&["7-Zip", "共有"], "")));
        assert!(!onedrive_match("unknown", &share));
    }

    /// 試作：OneDrive の中のフォルダのメニューを書き出す（実行はしない）。
    /// cargo test dump_onedrive_menu -- --ignored --nocapture
    #[test]
    #[ignore]
    fn dump_onedrive_menu() {
        let Ok(root) = std::env::var("OneDrive") else { return };
        let target = std::env::var("SHELLMENU_TARGET").unwrap_or(format!("{}\\testMCP", root));
        unsafe {
            let (cm, menu) = context_menu(&target).unwrap();
            let mut items = Vec::new();
            list_items(&cm, menu, &[], &mut items);
            for it in &items {
                println!("{:>5} | {:<30} | {}", it.id, it.verb, it.path.join(" > "));
            }
            destroy(menu);
        }
    }
}
