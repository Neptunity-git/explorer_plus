// ウィンドウ（ADR 0030）。Chrome や Win11 のエクスプローラのように、タブの並んだウィンドウをいくつも開ける。
// どのウィンドウも同じ画面（index.html）で、最初に開く場所とビューは URL の ?path=・?view= で渡す。
// 最後のウィンドウを閉じると、アプリが終わる（Tauri の決まり）。

use serde::Serialize;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetCursorPos, WindowFromPoint, GA_ROOT};

fn cursor() -> Option<POINT> {
    let mut pt = POINT::default();
    unsafe { GetCursorPos(&mut pt) }.ok().map(|_| pt)
}

/// マウスの下にある、このアプリのウィンドウ（ADR 0030 第2段階：タブをほかのウィンドウへ移す）
#[derive(Serialize)]
pub struct CursorTarget {
    /// ウィンドウの名前（最初のウィンドウは "main"）
    label: String,
    /// そのウィンドウの画面の中の位置（CSS の px）
    x: f64,
    y: f64,
}

/// マウスの下にあるのが、このアプリのウィンドウなら、その名前と、その中の位置。ほかのアプリの窓・デスクトップなら null
#[tauri::command]
pub fn window_under_cursor(app: AppHandle) -> Option<CursorTarget> {
    let pt = cursor()?;
    let root = unsafe { GetAncestor(WindowFromPoint(pt), GA_ROOT) };
    for (label, w) in app.webview_windows() {
        let Ok(h) = w.hwnd() else { continue };
        // Tauri が使う windows クレートの版と、このアプリの版が違うことがあるので、生の値で比べる
        let hwnd = HWND(h.0 as _);
        if hwnd != root {
            continue;
        }
        let mut local = pt;
        let _ = unsafe { ScreenToClient(hwnd, &mut local) };
        let scale = w.scale_factor().unwrap_or(1.0);
        return Some(CursorTarget { label, x: local.x as f64 / scale, y: local.y as f64 / scale });
    }
    None
}

/// そのウィンドウを前に出す
#[tauri::command]
pub fn focus_window(app: AppHandle, label: String) {
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

static NEXT: AtomicU32 = AtomicU32::new(1);

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{:02X}", b) })
        .collect()
}

/// 新しいウィンドウを開く。path があればそのフォルダ（view のビューで）、無ければホーム
#[tauri::command]
pub async fn open_window(app: AppHandle, window: tauri::Window, path: Option<String>, view: Option<String>, at_cursor: Option<bool>) -> Result<String, String> {
    let mut query = Vec::new();
    if let Some(p) = path.filter(|p| !p.is_empty()) {
        query.push(format!("path={}", encode(&p)));
    }
    if let Some(v) = view.filter(|v| crate::mods::valid_id(v)) {
        query.push(format!("view={}", encode(&v)));
    }
    let url = if query.is_empty() { "index.html".to_string() } else { format!("index.html?{}", query.join("&")) };
    let label = format!("w{}", NEXT.fetch_add(1, Ordering::SeqCst));
    // 開いたウィンドウから少しずらして、同じ大きさで開く（重なって見分けられなくならないように）
    let (pos, size) = match (window.outer_position(), window.inner_size(), window.scale_factor()) {
        (Ok(p), Ok(s), Ok(f)) => (Some((p.x as f64 / f + 32.0, p.y as f64 / f + 32.0)), Some((s.width as f64 / f, s.height as f64 / f))),
        _ => (None, None),
    };
    // タブを引き出したときは、マウスの所にタブの列が来るように開く（画面からはみ出さないように）
    let pos = match (at_cursor.unwrap_or(false), cursor(), window.scale_factor()) {
        (true, Some(c), Ok(f)) => {
            let (w, h) = size.unwrap_or((1100.0, 640.0));
            let (mut x, mut y) = (c.x as f64 / f - 120.0, c.y as f64 / f - 50.0);
            if let Ok(Some(m)) = window.app_handle().monitor_from_point(c.x as f64, c.y as f64) {
                let mf = m.scale_factor();
                let (mx, my) = (m.position().x as f64 / mf, m.position().y as f64 / mf);
                let (mw, mh) = (m.size().width as f64 / mf, m.size().height as f64 / mf);
                // タスクバーの分（48）も空ける
                x = x.min(mx + mw - w).max(mx);
                y = y.min(my + mh - h - 48.0 - 32.0).max(my);
            }
            Some((x, y))
        }
        _ => pos,
    };
    let mut b = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title("explorer_plus")
        .inner_size(size.map_or(1100.0, |s| s.0), size.map_or(640.0, |s| s.1))
        .min_inner_size(640.0, 400.0);
    b = match pos {
        Some((x, y)) => b.position(x, y),
        None => b.center(),
    };
    let w = b.build().map_err(|e| format!("io: {}", e))?;
    let _ = w.set_focus();
    Ok(label)
}

/// 最後のタブを閉じた：ほかにウィンドウがあれば、このウィンドウを閉じる（閉じたら true）。1つだけなら閉じない
#[tauri::command]
pub fn close_window_if_others(app: AppHandle, window: tauri::Window) -> Result<bool, String> {
    if app.webview_windows().len() < 2 {
        return Ok(false);
    }
    window.close().map_err(|e| format!("io: {}", e))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_query() {
        assert_eq!(encode(r"C:\写真 a&b"), "C%3A%5C%E5%86%99%E7%9C%9F%20a%26b");
        assert_eq!(encode("builtin.notes"), "builtin.notes");
    }
}
