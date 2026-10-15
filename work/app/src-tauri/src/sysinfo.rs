// PC の情報（ADR 0023）：ドライブの一覧（種類・名前・空き容量）と、Windows の強調色・言語。読むだけ。

use serde::Serialize;
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    /// "C:\\"
    path: String,
    /// "fixed"・"removable"・"network"・"cdrom"・"ramdisk"・"unknown"
    kind: String,
    /// ボリュームの名前（無ければ ""）
    label: String,
    /// "NTFS"・"FAT32" など（取れなければ ""）
    file_system: String,
    /// バイト（取れなければ null）
    total: Option<u64>,
    free: Option<u64>,
}

fn drive(letter: char) -> Drive {
    let path = format!("{}:\\", letter);
    let w = HSTRING::from(path.as_str());
    let kind = match unsafe { GetDriveTypeW(PCWSTR(w.as_ptr())) } {
        2 => "removable",
        3 => "fixed",
        4 => "network",
        5 => "cdrom",
        6 => "ramdisk",
        _ => "unknown",
    }
    .to_string();
    let mut d = Drive { path, kind, label: String::new(), file_system: String::new(), total: None, free: None };
    // つながっていないネットワークのドライブは、聞くと長く待たされるので聞かない
    if d.kind == "network" {
        return d;
    }
    let mut label = [0u16; 261];
    let mut fs = [0u16; 261];
    if unsafe { GetVolumeInformationW(PCWSTR(w.as_ptr()), Some(&mut label), None, None, None, Some(&mut fs)) }.is_ok() {
        let s = |b: &[u16]| String::from_utf16_lossy(&b[..b.iter().position(|&c| c == 0).unwrap_or(b.len())]);
        d.label = s(&label);
        d.file_system = s(&fs);
    }
    let (mut free, mut total) = (0u64, 0u64);
    if unsafe { GetDiskFreeSpaceExW(PCWSTR(w.as_ptr()), Some(&mut free), Some(&mut total), None) }.is_ok() {
        d.free = Some(free);
        d.total = Some(total);
    }
    d
}

#[tauri::command]
pub async fn system_drives() -> Vec<Drive> {
    tauri::async_runtime::spawn_blocking(|| {
        let mask = unsafe { GetLogicalDrives() };
        (0..26u8).filter(|i| mask & (1 << i) != 0).map(|i| drive((b'A' + i) as char)).collect()
    })
    .await
    .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    /// Windows の強調色 "#rrggbb"（取れなければ null）
    accent: Option<String>,
    /// "ja-JP" など
    locale: String,
}

fn accent() -> Option<String> {
    use windows::UI::ViewManagement::{UIColorType, UISettings};
    let c = UISettings::new().ok()?.GetColorValue(UIColorType::Accent).ok()?;
    Some(format!("#{:02x}{:02x}{:02x}", c.R, c.G, c.B))
}

fn locale() -> String {
    use windows::Win32::Globalization::GetUserDefaultLocaleName;
    let mut buf = [0u16; 85];
    let n = unsafe { GetUserDefaultLocaleName(&mut buf) };
    if n > 1 { String::from_utf16_lossy(&buf[..n as usize - 1]) } else { String::new() }
}

#[tauri::command]
pub fn system_info() -> SystemInfo {
    SystemInfo { accent: accent(), locale: locale() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_system_drive_and_info() {
        let c = drive('C');
        assert_eq!(c.kind, "fixed");
        assert!(c.total.unwrap() > 0 && c.free.unwrap() <= c.total.unwrap());
        assert!(!c.file_system.is_empty());
        let info = system_info();
        assert!(info.locale.contains('-'), "{}", info.locale);
        if let Some(a) = info.accent {
            assert!(a.starts_with('#') && a.len() == 7);
        }
    }
}
