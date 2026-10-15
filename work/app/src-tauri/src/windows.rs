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

// ---- 最初のウィンドウの大きさ・位置を覚える（アプリを起動し直しても同じ所に開く） ----
// アプリのデータの window.json に { x, y, width, height, maximized }（画面の実際の点の数）。
// 最大化しているときは、最大化する前の大きさ・位置を覚えておく（戻したときに使う）

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Default, Debug, PartialEq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

/// 最後に見た、最大化していないときの大きさ・位置
static LAST: std::sync::Mutex<Option<Bounds>> = std::sync::Mutex::new(None);

fn bounds_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    crate::mods::data_root(app).ok().map(|d| d.join("window.json"))
}

/// 覚えていた大きさが使えるか：小さすぎない・大きすぎない、どこかの画面に、題名の辺りが入っている
pub fn usable(b: &Bounds, screens: &[(i32, i32, u32, u32)]) -> bool {
    if b.width < 400 || b.height < 300 || b.width > 20000 || b.height > 20000 {
        return false;
    }
    let (px, py) = (b.x + 60, b.y + 15);
    screens.iter().any(|&(sx, sy, sw, sh)| px >= sx && py >= sy && px < sx + sw as i32 && py < sy + sh as i32)
}

/// 起動したとき：最初のウィンドウを、覚えていた大きさ・位置にして、見せる（見せる前に動かすので、ちらつかない）
pub fn restore_main(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else { return };
    let saved: Option<Bounds> = bounds_file(app).and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok());
    let screens: Vec<(i32, i32, u32, u32)> = w
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| (m.position().x, m.position().y, m.size().width, m.size().height))
        .collect();
    if let Some(b) = saved.filter(|b| usable(b, &screens)) {
        let _ = w.set_size(tauri::PhysicalSize::new(b.width, b.height));
        let _ = w.set_position(tauri::PhysicalPosition::new(b.x, b.y));
        *LAST.lock().unwrap() = Some(Bounds { maximized: false, ..b });
        if b.maximized {
            let _ = w.maximize();
        }
    }
    let _ = w.show();
    let _ = w.set_focus();
}

/// 最初のウィンドウが動いた・大きさが変わった：最大化・最小化していなければ、今の大きさ・位置を覚える
pub fn track_main(window: &tauri::Window) {
    if window.label() != "main" || window.is_maximized().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return;
    }
    if let (Ok(p), Ok(s)) = (window.outer_position(), window.outer_size()) {
        // 最小化したときなど、とても遠くに置かれることがあるので、それは覚えない
        if p.x > -10000 && p.y > -10000 && s.width > 0 {
            *LAST.lock().unwrap() = Some(Bounds { x: p.x, y: p.y, width: s.width, height: s.height, maximized: false });
        }
    }
}

/// 最初のウィンドウを閉じるとき：覚えた大きさ・位置をファイルに書く
pub fn save_main(window: &tauri::Window) {
    if window.label() != "main" {
        return;
    }
    let Some(mut b) = *LAST.lock().unwrap() else { return };
    b.maximized = window.is_maximized().unwrap_or(false);
    if let (Some(p), Ok(text)) = (bounds_file(window.app_handle()), serde_json::to_string(&b)) {
        let _ = std::fs::create_dir_all(p.parent().unwrap_or(&p));
        let _ = std::fs::write(p, text);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usable_bounds() {
        let screens = [(0, 0, 1920, 1080), (1920, 0, 2560, 1440)];
        let b = |x, y, width, height| Bounds { x, y, width, height, maximized: false };
        assert!(usable(&b(100, 100, 1100, 640), &screens));
        assert!(usable(&b(2000, 50, 1100, 640), &screens));
        // 外した画面の上・小さすぎる
        assert!(!usable(&b(5000, 100, 1100, 640), &screens));
        assert!(!usable(&b(-3000, 100, 1100, 640), &screens));
        assert!(!usable(&b(100, 100, 200, 100), &screens));
    }

    #[test]
    fn encodes_query() {
        assert_eq!(encode(r"C:\写真 a&b"), "C%3A%5C%E5%86%99%E7%9C%9F%20a%26b");
        assert_eq!(encode("builtin.notes"), "builtin.notes");
    }
}
