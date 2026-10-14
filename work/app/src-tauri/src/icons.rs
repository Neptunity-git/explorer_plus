// Windows の標準アイコンを PNG にして、独自の通信先 http://icon.localhost/ から配る（ADR 0003）。
//   /ext/<拡張子>?size=16|32|48|256   … 拡張子ごとのアイコン（"folder" はフォルダのアイコン）
//   /file?path=<パス>&size=...       … そのファイル自身のアイコン（exe・lnk・ico など、ファイルごとに絵が違うもの）
//   /place/<種類>?size=...           … 左の欄の場所（desktop・downloads・drive-C など）の、Windows が使っているアイコン
//   /kind/launch.svg・/kind/config.svg … 独自アイコン（押しボタン・歯車。ADR 0003）
// 一度作った PNG は覚えておく。

use std::collections::HashMap;
use std::os::windows::ffi::OsStrExt;
use std::sync::Mutex;
use tauri::http::{Request, Response, StatusCode};
use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_FLAGS_AND_ATTRIBUTES};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Controls::{IImageList, ILD_TRANSPARENT};
use windows::Win32::UI::Shell::{
    SHGetFileInfoW, SHGetImageList, SHFILEINFOW, SHGFI_FLAGS, SHGFI_SYSICONINDEX, SHGFI_USEFILEATTRIBUTES,
    SHIL_EXTRALARGE, SHIL_JUMBO, SHIL_LARGE, SHIL_SMALL,
};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

/// ファイルごとにアイコンが違う拡張子（パスを渡してそのファイル自身のアイコンを使う）
pub const PER_FILE_EXTS: &[&str] = &["exe", "lnk", "ico", "url", "msi", "cur", "ani"];

#[derive(Default)]
pub struct IconCache {
    icons: Mutex<HashMap<String, Vec<u8>>>,
    thumbs: Mutex<HashMap<String, Vec<u8>>>,
}

fn image_list_for(size: u32) -> i32 {
    (match size {
        16 => SHIL_SMALL,
        32 => SHIL_LARGE,
        48 => SHIL_EXTRALARGE,
        _ => SHIL_JUMBO,
    }) as i32
}

/// target がファイル名（拡張子だけでよい）なら use_attributes = true、実在するパスなら false
/// Windows のアイコン・縮小画像の取り出しを、1つずつ順番に行うための鍵。
/// たくさんのアイコンを同時に取り出すと、まれに空の絵になる（memo.txt のアイコンが壊れて見えた）ため
static SHELL_LOCK: Mutex<()> = Mutex::new(());

fn icon_png(target: &str, use_attributes: bool, is_dir: bool, size: u32) -> Result<Vec<u8>, String> {
    let _guard = SHELL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let name: Vec<u16> = std::ffi::OsStr::new(target).encode_wide().chain(std::iter::once(0)).collect();
        let mut sfi = SHFILEINFOW::default();
        let mut flags: SHGFI_FLAGS = SHGFI_SYSICONINDEX;
        let mut attrs: FILE_FLAGS_AND_ATTRIBUTES = FILE_ATTRIBUTE_NORMAL;
        if use_attributes {
            flags |= SHGFI_USEFILEATTRIBUTES;
            if is_dir {
                attrs = FILE_ATTRIBUTE_DIRECTORY;
            }
        }
        if SHGetFileInfoW(PCWSTR(name.as_ptr()), attrs, Some(&mut sfi), std::mem::size_of::<SHFILEINFOW>() as u32, flags)
            == 0
        {
            return Err("SHGetFileInfoW failed".into());
        }
        let list: IImageList = SHGetImageList(image_list_for(size)).map_err(|e| e.to_string())?;
        let hicon = list.GetIcon(sfi.iIcon, ILD_TRANSPARENT.0).map_err(|e| e.to_string())?;
        let mut ii = ICONINFO::default();
        let got = GetIconInfo(hicon, &mut ii);
        let _ = DestroyIcon(hicon);
        got.map_err(|e| e.to_string())?;
        let mut bm = BITMAP::default();
        GetObjectW(HGDIOBJ(ii.hbmColor.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut _));
        let (w, h) = (bm.bmWidth, bm.bmHeight);
        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut px = vec![0u8; (w * h * 4) as usize];
        let hdc = CreateCompatibleDC(None);
        GetDIBits(hdc, ii.hbmColor, 0, h as u32, Some(px.as_mut_ptr() as *mut _), &mut bmi, DIB_RGB_COLORS);
        let _ = DeleteDC(hdc);
        let _ = DeleteObject(HGDIOBJ(ii.hbmColor.0));
        let _ = DeleteObject(HGDIOBJ(ii.hbmMask.0));
        for p in px.chunks_mut(4) {
            p.swap(0, 2); // BGRA -> RGBA
        }
        encode_png(&px, w as u32, h as u32)
    }
}

/// Windows が作る縮小画像（サムネイル。ADR 0014 判断6）。画像・PDF・動画などで、Windows が持っている絵を使う
fn thumbnail_png(path: &str, size: u32) -> Result<Vec<u8>, String> {
    let _guard = SHELL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_RESIZETOFIT};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let name: Vec<u16> = std::ffi::OsStr::new(path).encode_wide().chain(std::iter::once(0)).collect();
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR(name.as_ptr()), None).map_err(|e| e.to_string())?;
        let s = size as i32;
        let hbm = factory
            .GetImage(SIZE { cx: s, cy: s }, SIIGBF_RESIZETOFIT | SIIGBF_BIGGERSIZEOK)
            .map_err(|e| e.to_string())?;
        let mut bm = BITMAP::default();
        GetObjectW(HGDIOBJ(hbm.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut _));
        let (w, h) = (bm.bmWidth, bm.bmHeight);
        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut px = vec![0u8; (w * h * 4) as usize];
        let hdc = CreateCompatibleDC(None);
        GetDIBits(hdc, hbm, 0, h as u32, Some(px.as_mut_ptr() as *mut _), &mut bmi, DIB_RGB_COLORS);
        let _ = DeleteDC(hdc);
        let _ = DeleteObject(HGDIOBJ(hbm.0));
        // 透明度を持たない絵（写真など）は、取り出すと全部透明（アルファが 0）になるので、不透明に直す
        let has_alpha = px.chunks(4).any(|p| p[3] != 0);
        for p in px.chunks_mut(4) {
            p.swap(0, 2); // BGRA -> RGBA
            if !has_alpha {
                p[3] = 255;
            }
        }
        encode_png(&px, w as u32, h as u32)
    }
}

fn encode_png(rgba: &[u8], w: u32, h: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// 拡張子として受け付けるのは英数字だけ（"folder" はフォルダ）
fn valid_ext(ext: &str) -> bool {
    !ext.is_empty() && ext.len() <= 16 && ext.chars().all(|c| c.is_ascii_alphanumeric())
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| percent_decode(v))
    })
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn parse_size(query: &str) -> u32 {
    match query_param(query, "size").and_then(|s| s.parse().ok()) {
        Some(s @ (16 | 32 | 48 | 256)) => s,
        _ => 32,
    }
}

/// リクエストのパスとクエリから、(キャッシュのキー, 対象, 拡張子扱いか, フォルダか, 大きさ) を決める
fn plan(path: &str, query: &str) -> Option<(String, String, bool, bool, u32)> {
    let size = parse_size(query);
    if let Some(ext) = path.strip_prefix("/ext/") {
        let ext = ext.to_ascii_lowercase();
        if !valid_ext(&ext) {
            return None;
        }
        let is_dir = ext == "folder";
        let target = if is_dir { "folder".to_string() } else { format!("x.{}", ext) };
        return Some((format!("ext:{}:{}", ext, size), target, true, is_dir, size));
    }
    if let Some(name) = path.strip_prefix("/place/") {
        // 任意のパスは受け付けず、よく使う場所（list_places）の中から選ぶ。実物を見るので、ダウンロードなどの専用の絵になる
        let target = crate::fsops::list_places().into_iter().find(|p| place_key(&p.kind, &p.name) == name)?.path;
        return Some((format!("place:{}:{}", name, size), target, false, false, size));
    }
    if path == "/file" {
        let p = query_param(query, "path")?;
        let ext = p.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
        // ファイルごとに絵が違う種類だけ、実物を見る。それ以外は拡張子のアイコンで足りる
        if !PER_FILE_EXTS.contains(&ext.as_str()) {
            return None;
        }
        return Some((format!("file:{}:{}", p.to_lowercase(), size), p, false, false, size));
    }
    None
}

/// 左の欄の場所の呼び名。ドライブは "drive-C"、ほかは種類（"desktop" など）
pub fn place_key(kind: &str, name: &str) -> String {
    if kind == "drive" { format!("drive-{}", name.trim_end_matches(':')) } else { kind.to_string() }
}

/// 縮小画像は数が多くなるので、覚えておくのはこの数まで（超えたら覚え直す）
const THUMB_CACHE_MAX: usize = 400;

/// /thumb?path=<パス>&size=<32〜256>&m=<更新日時>。m はファイルが変わったら別のものとして作り直すための印
fn thumb_response(cache: &IconCache, query: &str) -> Response<Vec<u8>> {
    let Some(path) = query_param(query, "path") else {
        return Response::builder().status(StatusCode::BAD_REQUEST).body(Vec::new()).unwrap();
    };
    let size = query_param(query, "size").and_then(|s| s.parse::<u32>().ok()).unwrap_or(96).clamp(32, 256);
    let key = format!("thumb:{}:{}:{}", path.to_lowercase(), size, query_param(query, "m").unwrap_or_default());
    if let Some(png) = cache.thumbs.lock().unwrap().get(&key) {
        return png_response(png.clone());
    }
    match thumbnail_png(&path, size) {
        Ok(png) => {
            let mut thumbs = cache.thumbs.lock().unwrap();
            if thumbs.len() >= THUMB_CACHE_MAX {
                thumbs.clear();
            }
            thumbs.insert(key, png.clone());
            png_response(png)
        }
        Err(_) => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap(),
    }
}

const KIND_LAUNCH_SVG: &str = include_str!("../assets/kind-launch.svg");
const KIND_CONFIG_SVG: &str = include_str!("../assets/kind-config.svg");

pub fn handle(cache: &IconCache, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri();
    let svg = match uri.path() {
        "/kind/launch.svg" => Some(KIND_LAUNCH_SVG),
        "/kind/config.svg" => Some(KIND_CONFIG_SVG),
        _ => None,
    };
    if let Some(svg) = svg {
        return Response::builder()
            .header("Content-Type", "image/svg+xml")
            .header("Cache-Control", "max-age=3600")
            .header("Access-Control-Allow-Origin", "*")
            .body(svg.as_bytes().to_vec())
            .unwrap();
    }
    if uri.path() == "/thumb" {
        return thumb_response(cache, uri.query().unwrap_or(""));
    }
    let Some((key, target, by_ext, is_dir, size)) = plan(uri.path(), uri.query().unwrap_or("")) else {
        return Response::builder().status(StatusCode::BAD_REQUEST).body(Vec::new()).unwrap();
    };
    if let Some(png) = cache.icons.lock().unwrap().get(&key) {
        return png_response(png.clone());
    }
    match icon_png(&target, by_ext, is_dir, size) {
        Ok(png) => {
            cache.icons.lock().unwrap().insert(key, png.clone());
            png_response(png)
        }
        Err(_) => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap(),
    }
}

fn png_response(png: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .header("Content-Type", "image/png")
        .header("Cache-Control", "max-age=3600")
        .header("Access-Control-Allow-Origin", "*")
        .body(png)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_ext_and_file_requests() {
        let (key, target, by_ext, is_dir, size) = plan("/ext/DOCX", "size=256").unwrap();
        assert_eq!((key.as_str(), target.as_str(), by_ext, is_dir, size), ("ext:docx:256", "x.docx", true, false, 256));
        let (_, target, _, is_dir, size) = plan("/ext/folder", "").unwrap();
        assert_eq!((target.as_str(), is_dir, size), ("folder", true, 32));
        assert!(plan("/ext/../x", "").is_none());
        assert!(plan("/ext/", "").is_none());
        let (_, target, by_ext, _, size) = plan("/file", "path=C%3A%5Capp%5Ctool.exe&size=48").unwrap();
        assert_eq!((target.as_str(), by_ext, size), ("C:\\app\\tool.exe", false, 48));
        // exe などでなければ、パスでのアイコンは出さない
        assert!(plan("/file", "path=C%3A%5Csecret.docx").is_none());
        assert!(plan("/place/nowhere", "").is_none());
        assert_eq!(place_key("drive", "C:"), "drive-C");
        assert_eq!(place_key("downloads", "ダウンロード"), "downloads");
        assert_eq!(parse_size("size=999"), 32);
    }

    #[test]
    fn makes_png_for_extension() {
        let png = icon_png("x.txt", true, false, 32).unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }
}

#[cfg(test)]
mod thumb_tests {
    use super::*;

    #[test]
    fn makes_thumbnail_for_wallpaper() {
        // Windows 11 に入っている壁紙で試す（無い環境では試さない）
        let p = r"C:\Windows\Web\Wallpaper\Windows\img0.jpg";
        if !std::path::Path::new(p).exists() {
            return;
        }
        let png = thumbnail_png(p, 96).unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }
}
