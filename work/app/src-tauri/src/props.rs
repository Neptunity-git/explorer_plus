// ファイルの詳しい情報（ADR 0023）：写真の撮影日時・撮影場所、曲名・アーティスト、動画の長さ、画像の縦横など。
// 自分で形式を読み解かず、Windows のプロパティ（エクスプローラの「詳細」タブと同じもの）に任せる。
// 名前は Windows の正式な名前（"System.Photo.DateTaken" など）で受け取る。値は JSON（文字・数・文字の並び・時刻はミリ秒）にして返す。

use crate::fsops::{verify, EntryRef};
use serde_json::{Map, Value};
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::System::Com::StructuredStorage::{
    PropVariantClear, PropVariantToBoolean, PropVariantToDouble, PropVariantToFileTime, PropVariantToStringAlloc,
    PropVariantToStringVectorAlloc, PROPVARIANT,
};
use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Variant::{PSTF_UTC, VT_BOOL, VT_BSTR, VT_EMPTY, VT_FILETIME, VT_LPSTR, VT_LPWSTR, VT_NULL, VT_VECTOR};
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, PSGetPropertyKeyFromName, SHGetPropertyStoreFromParsingName, GPS_BESTEFFORT};

/// 一度に聞ける項目の数・名前の数
const MAX_ITEMS: usize = 500;
const MAX_NAMES: usize = 60;

/// 名前は "System." で始まる正式な名前だけ（英数字と点）
fn valid_name(n: &str) -> bool {
    n.starts_with("System.") && n.len() <= 80 && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '.')
}

/// FILETIME（1601年からの100ナノ秒）を、1970年からのミリ秒に
fn filetime_ms(low: u32, high: u32) -> f64 {
    let t = ((high as u64) << 32 | low as u64) as i64;
    ((t - 116_444_736_000_000_000) / 10_000) as f64
}

unsafe fn take_pwstr(p: windows::core::PWSTR) -> String {
    unsafe {
        let s = p.to_string().unwrap_or_default();
        CoTaskMemFree(Some(p.0 as _));
        s
    }
}

/// 値の種類に合わせて JSON にする。扱えない種類は、Windows に文字にしてもらう
unsafe fn to_json(pv: &PROPVARIANT) -> Option<Value> {
    unsafe {
        let vt = pv.Anonymous.Anonymous.vt;
        if vt == VT_EMPTY || vt == VT_NULL {
            return None;
        }
        if vt == VT_LPWSTR || vt == VT_BSTR || vt == VT_LPSTR {
            return PropVariantToStringAlloc(pv).ok().map(|p| Value::String(take_pwstr(p)));
        }
        if vt == VT_FILETIME {
            let ft = PropVariantToFileTime(pv, PSTF_UTC).ok()?;
            return serde_json::Number::from_f64(filetime_ms(ft.dwLowDateTime, ft.dwHighDateTime)).map(Value::Number);
        }
        if vt == VT_BOOL {
            return PropVariantToBoolean(pv).ok().map(|b| Value::Bool(b.as_bool()));
        }
        if vt.0 == VT_VECTOR.0 | VT_LPWSTR.0 {
            let mut list: *mut windows::core::PWSTR = std::ptr::null_mut();
            let mut n = 0u32;
            PropVariantToStringVectorAlloc(pv, &mut list, &mut n).ok()?;
            let items: Vec<Value> = (0..n as usize).map(|i| Value::String(take_pwstr(*list.add(i)))).collect();
            CoTaskMemFree(Some(list as _));
            return Some(Value::Array(items));
        }
        // 数（整数・小数）
        if matches!(vt.0, 2..=5 | 16..=23) {
            return PropVariantToDouble(pv).ok().and_then(serde_json::Number::from_f64).map(Value::Number);
        }
        PropVariantToStringAlloc(pv).ok().map(|p| Value::String(take_pwstr(p)))
    }
}

/// 1つのファイルの、names のプロパティ。値の無いものは入れない
pub fn properties_of(path: &str, keys: &[(String, PROPERTYKEY)]) -> Option<Map<String, Value>> {
    unsafe {
        let store: IPropertyStore = SHGetPropertyStoreFromParsingName(&HSTRING::from(path), None, GPS_BESTEFFORT).ok()?;
        let mut out = Map::new();
        for (name, key) in keys {
            if let Ok(mut pv) = store.GetValue(key) {
                if let Some(v) = to_json(&pv) {
                    out.insert(name.clone(), v);
                }
                let _ = PropVariantClear(&mut pv);
            }
        }
        Some(out)
    }
}

/// 項目ごとに、名前 → 値 の表を返す（ファイルが無い・読めないものは null）
#[tauri::command]
pub async fn file_properties(items: Vec<EntryRef>, names: Vec<String>) -> Result<Vec<Option<Map<String, Value>>>, String> {
    if items.len() > MAX_ITEMS || names.len() > MAX_NAMES {
        return Err("too-large: too many items or names".into());
    }
    if let Some(bad) = names.iter().find(|n| !valid_name(n)) {
        return Err(format!("invalid: property name {}", bad));
    }
    tauri::async_runtime::spawn_blocking(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        // 名前を Windows のプロパティの鍵にする（知らない名前は飛ばす）
        let keys: Vec<(String, PROPERTYKEY)> = names
            .iter()
            .filter_map(|n| {
                let w = HSTRING::from(n.as_str());
                let mut key = PROPERTYKEY::default();
                unsafe { PSGetPropertyKeyFromName(PCWSTR(w.as_ptr()), &mut key) }.ok().map(|_| (n.clone(), key))
            })
            .collect();
        // シェルの処理はまとめて1つずつ（アイコンの取り出しと同じく、同時に呼ぶと不安定なことがある）
        let _lock = crate::icons::SHELL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        Ok(items
            .iter()
            .map(|it| verify(it).ok().and_then(|p| properties_of(&p.to_string_lossy(), &keys)))
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_times() {
        assert!(valid_name("System.Photo.DateTaken"));
        assert!(valid_name("System.GPS.LatitudeDecimal"));
        assert!(!valid_name("Photo.DateTaken"));
        assert!(!valid_name("System.A;B"));
        assert_eq!(filetime_ms(0xD53E_8000, 0x019D_B1DE), 0.0, "1970-01-01");
    }

    #[test]
    fn reads_size_and_dates_of_a_text_file() {
        let d = std::env::temp_dir().join(format!("ep-props-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("a.txt");
        std::fs::write(&f, "hello").unwrap();
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        let names = ["System.Size", "System.DateModified", "System.ItemTypeText", "System.Photo.DateTaken"];
        let keys: Vec<(String, PROPERTYKEY)> = names
            .iter()
            .filter_map(|n| {
                let w = HSTRING::from(*n);
                let mut key = PROPERTYKEY::default();
                unsafe { PSGetPropertyKeyFromName(PCWSTR(w.as_ptr()), &mut key) }.ok().map(|_| (n.to_string(), key))
            })
            .collect();
        let m = properties_of(&f.to_string_lossy(), &keys).unwrap();
        assert_eq!(m.get("System.Size").and_then(|v| v.as_f64()), Some(5.0));
        let modified = m.get("System.DateModified").and_then(|v| v.as_f64()).unwrap();
        assert!(modified > 1.7e12, "1970年からのミリ秒");
        assert!(m.get("System.ItemTypeText").and_then(|v| v.as_str()).is_some());
        assert!(!m.contains_key("System.Photo.DateTaken"), "文章のファイルに撮影日時は無い");
    }
}
