// Windows の位置情報（ADR 0001 判断2）。ノート PC では Wi-Fi から推定され、精度は数十〜数百メートル。
// Wi-Fi の無い PC などでは取れないので、呼ぶ側（「今の授業」の判定）は、取れないときの備えを持つこと。

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub latitude: f64,
    pub longitude: f64,
    /// メートル
    pub accuracy: f64,
}

fn locate_blocking() -> Result<Location, String> {
    use windows::Devices::Geolocation::{GeolocationAccessStatus, Geolocator};
    use windows::Foundation::TimeSpan;
    let access = Geolocator::RequestAccessAsync().and_then(|op| op.join()).map_err(|e| format!("io: {}", e))?;
    if access != GeolocationAccessStatus::Allowed {
        return Err("denied: location access is not allowed in Windows settings".into());
    }
    let geo = Geolocator::new().map_err(|e| format!("io: {}", e))?;
    // 5分以内の結果があれば使い、新しく測るときは10秒で諦める（TimeSpan は100ナノ秒単位）
    let pos = geo
        .GetGeopositionAsyncWithAgeAndTimeout(TimeSpan { Duration: 5 * 60 * 10_000_000 }, TimeSpan { Duration: 10 * 10_000_000 })
        .and_then(|op| op.join())
        .map_err(|e| format!("not-found: {}", e))?;
    let coord = pos.Coordinate().map_err(|e| format!("io: {}", e))?;
    let p = coord.Point().and_then(|pt| pt.Position()).map_err(|e| format!("io: {}", e))?;
    Ok(Location { latitude: p.Latitude, longitude: p.Longitude, accuracy: coord.Accuracy().unwrap_or(f64::NAN) })
}

#[tauri::command]
pub async fn get_location() -> Result<Location, String> {
    tauri::async_runtime::spawn_blocking(locate_blocking).await.map_err(|e| e.to_string())?
}
