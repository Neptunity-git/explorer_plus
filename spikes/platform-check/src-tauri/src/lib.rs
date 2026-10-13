// 技術の確認用の試作（ADR 0006 判断2）。本番のコードではない。
// 起動時にフロント側から各コマンドを順に呼び、結果を一時フォルダの JSON に書き出す。

use serde::Serialize;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

fn spike_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("explorer3d-spike");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

// ---- 1. 位置情報 ----

#[derive(Serialize)]
struct GeoResult {
    access: String,
    // 発案者の居場所を記録に残さないよう、小数2桁（約1km）に丸める
    lat_rounded: Option<f64>,
    lon_rounded: Option<f64>,
    accuracy_m: Option<f64>,
    source: Option<String>,
}

fn geolocation_blocking() -> windows::core::Result<GeoResult> {
    use windows::Devices::Geolocation::{GeolocationAccessStatus, Geolocator};
    let access = Geolocator::RequestAccessAsync()?.join()?;
    if access != GeolocationAccessStatus::Allowed {
        return Ok(GeoResult {
            access: format!("{:?}", access),
            lat_rounded: None,
            lon_rounded: None,
            accuracy_m: None,
            source: None,
        });
    }
    let geo = Geolocator::new()?;
    let pos = geo.GetGeopositionAsync()?.join()?;
    let coord = pos.Coordinate()?;
    let p = coord.Point()?.Position()?;
    Ok(GeoResult {
        access: "Allowed".into(),
        lat_rounded: Some((p.Latitude * 100.0).round() / 100.0),
        lon_rounded: Some((p.Longitude * 100.0).round() / 100.0),
        accuracy_m: Some(coord.Accuracy()?),
        source: Some(format!("{:?}", coord.PositionSource()?)),
    })
}

#[tauri::command]
async fn check_geolocation() -> Result<GeoResult, String> {
    tauri::async_runtime::spawn_blocking(|| geolocation_blocking().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

// ---- 2. ファイルID ----

fn file_id(path: &Path) -> Result<String, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FileIdInfo, GetFileInformationByHandleEx, FILE_FLAG_BACKUP_SEMANTICS, FILE_ID_INFO,
    };
    const FILE_READ_ATTRIBUTES: u32 = 0x80;
    let f = std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(7)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0)
        .open(path)
        .map_err(|e| e.to_string())?;
    let mut info = FILE_ID_INFO::default();
    unsafe {
        GetFileInformationByHandleEx(
            HANDLE(f.as_raw_handle()),
            FileIdInfo,
            &mut info as *mut _ as *mut _,
            std::mem::size_of::<FILE_ID_INFO>() as u32,
        )
    }
    .map_err(|e| e.to_string())?;
    let id: String = info.FileId.Identifier.iter().rev().map(|b| format!("{:02x}", b)).collect();
    Ok(format!("{:016x}:{}", info.VolumeSerialNumber, id))
}

#[derive(Serialize)]
struct FileIdResult {
    original: String,
    after_rename: String,
    after_move: String,
    folder: String,
    folder_after_rename: String,
    same_file: bool,
    same_folder: bool,
}

#[tauri::command]
fn check_file_id() -> Result<FileIdResult, String> {
    let dir = spike_dir()?.join("fileid");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("sub")).map_err(|e| e.to_string())?;
    let a = dir.join("a.txt");
    std::fs::write(&a, "hello").map_err(|e| e.to_string())?;
    let original = file_id(&a)?;
    let b = dir.join("b.txt");
    std::fs::rename(&a, &b).map_err(|e| e.to_string())?;
    let after_rename = file_id(&b)?;
    let c = dir.join("sub").join("c.txt");
    std::fs::rename(&b, &c).map_err(|e| e.to_string())?;
    let after_move = file_id(&c)?;
    let folder = file_id(&dir.join("sub"))?;
    std::fs::rename(dir.join("sub"), dir.join("sub2")).map_err(|e| e.to_string())?;
    let folder_after_rename = file_id(&dir.join("sub2"))?;
    let _ = std::fs::remove_dir_all(&dir);
    Ok(FileIdResult {
        same_file: original == after_rename && original == after_move,
        same_folder: folder == folder_after_rename,
        original,
        after_rename,
        after_move,
        folder,
        folder_after_rename,
    })
}

// ---- 3. ごみ箱 ----

#[derive(Serialize)]
struct TrashResult {
    gone_from_folder: bool,
    found_in_recycle_bin: bool,
    cleaned_up: bool,
}

#[tauri::command]
fn check_trash() -> Result<TrashResult, String> {
    let dir = spike_dir()?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let name = format!("explorer3d-trash-test-{}.txt", nanos);
    let p = dir.join(&name);
    std::fs::write(&p, "trash me").map_err(|e| e.to_string())?;
    trash::delete(&p).map_err(|e| e.to_string())?;
    let gone_from_folder = !p.exists();
    let items = trash::os_limited::list().map_err(|e| e.to_string())?;
    let mine: Vec<_> = items
        .into_iter()
        .filter(|i| i.name.to_string_lossy() == name)
        .collect();
    let found_in_recycle_bin = !mine.is_empty();
    // 試験用のファイルなので、ごみ箱からも消しておく
    let cleaned_up = found_in_recycle_bin && trash::os_limited::purge_all(mine).is_ok();
    Ok(TrashResult { gone_from_folder, found_in_recycle_bin, cleaned_up })
}

// ---- 4. Windows の標準アイコン ----

#[derive(Serialize)]
struct IconResult {
    ext: String,
    width: i32,
    height: i32,
    rgba: Vec<u8>,
}

fn icon_blocking(ext: &str, jumbo: bool) -> Result<IconResult, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Controls::{IImageList, ILD_TRANSPARENT};
    use windows::Win32::UI::Shell::{
        SHGetFileInfoW, SHGetImageList, SHFILEINFOW, SHGFI_SYSICONINDEX, SHGFI_USEFILEATTRIBUTES,
        SHIL_EXTRALARGE, SHIL_JUMBO,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let name = wide(&format!("x.{}", ext));
        let mut sfi = SHFILEINFOW::default();
        let r = SHGetFileInfoW(
            PCWSTR(name.as_ptr()),
            FILE_ATTRIBUTE_NORMAL,
            Some(&mut sfi),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_SYSICONINDEX | SHGFI_USEFILEATTRIBUTES,
        );
        if r == 0 {
            return Err("SHGetFileInfoW failed".into());
        }
        let list: IImageList =
            SHGetImageList((if jumbo { SHIL_JUMBO } else { SHIL_EXTRALARGE }) as i32)
                .map_err(|e| e.to_string())?;
        let hicon = list.GetIcon(sfi.iIcon, ILD_TRANSPARENT.0).map_err(|e| e.to_string())?;
        let mut ii = ICONINFO::default();
        GetIconInfo(hicon, &mut ii).map_err(|e| e.to_string())?;
        let mut bm = BITMAP::default();
        GetObjectW(
            HGDIOBJ(ii.hbmColor.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut _ as *mut _),
        );
        let (w, h) = (bm.bmWidth, bm.bmHeight);
        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h, // 上から下へ
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut buf = vec![0u8; (w * h * 4) as usize];
        let hdc = CreateCompatibleDC(None);
        GetDIBits(hdc, ii.hbmColor, 0, h as u32, Some(buf.as_mut_ptr() as *mut _), &mut bmi, DIB_RGB_COLORS);
        let _ = DeleteDC(hdc);
        let _ = DeleteObject(HGDIOBJ(ii.hbmColor.0));
        let _ = DeleteObject(HGDIOBJ(ii.hbmMask.0));
        let _ = DestroyIcon(hicon);
        for px in buf.chunks_mut(4) {
            px.swap(0, 2); // BGRA -> RGBA
        }
        Ok(IconResult { ext: ext.to_string(), width: w, height: h, rgba: buf })
    }
}

#[tauri::command]
async fn get_icon(ext: String, jumbo: bool) -> Result<IconResult, String> {
    tauri::async_runtime::spawn_blocking(move || icon_blocking(&ext, jumbo))
        .await
        .map_err(|e| e.to_string())?
}

// ---- 5. 既定のアプリで開く ----

#[tauri::command]
fn check_open(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let p = spike_dir()?.join("open-test.txt");
    std::fs::write(&p, "explorer3D の試作から、既定のアプリで開きました。閉じて構いません。")
        .map_err(|e| e.to_string())?;
    app.opener()
        .open_path(p.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().into_owned())
}

// ---- 結果の保存 ----

#[tauri::command]
fn save_report(json: String) -> Result<String, String> {
    let p = spike_dir()?.join("report.json");
    std::fs::write(&p, json).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_geolocation,
            check_file_id,
            check_trash,
            get_icon,
            check_open,
            save_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
