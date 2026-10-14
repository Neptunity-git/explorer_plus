// explorer_plus の Rust 側。Windows の機能を呼ぶ薄い層で、見せ方の判断は持たない（ADR 0006）。
// エラーは "<code>: <説明>" の文字列で返す。code は MOD の API のエラーと同じ（not-found・denied・invalid・io など）。

mod fsops;
mod geo;
mod icons;
mod mods;

/// 開発中だけ、環境変数 EXPLORER_PLUS_START_DIR のフォルダで起動する（試験の操作が、ふだんのフォルダに及ばないように）。
/// リリース版では常に None
#[tauri::command]
fn dev_start_dir() -> Option<String> {
    if cfg!(debug_assertions) {
        std::env::var("EXPLORER_PLUS_START_DIR").ok().filter(|p| std::path::Path::new(p).is_dir())
    } else {
        None
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(icons::IconCache::default())
        .manage(mods::ModRegistry::default())
        .register_asynchronous_uri_scheme_protocol("icon", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            // アイコンの取り出しは COM を使い時間もかかるので、画面のスレッドを止めないよう別のスレッドで行う
            tauri::async_runtime::spawn_blocking(move || {
                use tauri::Manager;
                let cache = app.state::<icons::IconCache>();
                responder.respond(icons::handle(&cache, &request));
            });
        })
        .register_asynchronous_uri_scheme_protocol("mod", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let response = mods::handle(&app, &request);
                #[cfg(debug_assertions)]
                eprintln!("[mod] {} -> {}", request.uri(), response.status());
                responder.respond(response)
            });
        })
        .invoke_handler(tauri::generate_handler![
            fsops::list_dir,
            fsops::folder_sizes,
            fsops::resolve,
            fsops::open_entry,
            fsops::trash_entries,
            fsops::rename_entry,
            fsops::create_folder,
            fsops::list_places,
            mods::list_mods,
            mods::user_mods_dir,
            mods::view_storage_load,
            mods::view_storage_save,
            mods::app_data_load,
            mods::app_data_save,
            fsops::file_ids,
            fsops::path_kind,
            fsops::run_command,
            geo::get_location,
            dev_start_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
