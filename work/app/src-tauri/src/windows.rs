// ウィンドウ（ADR 0030）。Chrome や Win11 のエクスプローラのように、タブの並んだウィンドウをいくつも開ける。
// どのウィンドウも同じ画面（index.html）で、最初に開く場所とビューは URL の ?path=・?view= で渡す。
// 最後のウィンドウを閉じると、アプリが終わる（Tauri の決まり）。

use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

static NEXT: AtomicU32 = AtomicU32::new(1);

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{:02X}", b) })
        .collect()
}

/// 新しいウィンドウを開く。path があればそのフォルダ（view のビューで）、無ければホーム
#[tauri::command]
pub async fn open_window(app: AppHandle, window: tauri::Window, path: Option<String>, view: Option<String>) -> Result<String, String> {
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
