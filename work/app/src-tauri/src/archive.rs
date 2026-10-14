// 圧縮・展開（ADR 0021）。右クリックのメニューから、どのビューでも使える。
// - 圧縮：zip・7z。選んだ項目と同じフォルダに「最初の項目の名前.zip」を作る（同じ名前があれば「 (2)」を付ける）
// - 展開：zip・7z・tar・tar.gz（.tgz）。同じフォルダに、書庫の名前のフォルダを作って、その中に出す
// 7-Zip などを入れていなくても動くよう、アプリ自身で扱う。rar は形式の決まりの都合で扱わない。
// 日本語の Windows で作られた zip は、ファイル名が Shift_JIS のことが多いので、UTF-8 として読めなければ Shift_JIS として読む。

use crate::fsops::{verify, EntryRef};
use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::{Component, Path, PathBuf};

fn io_err(e: impl std::fmt::Display) -> String {
    format!("io: {}", e)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    Zip,
    SevenZ,
    Tar,
    TarGz,
}

/// 書庫の種類と、拡張子を除いた名前（展開先のフォルダの名前になる）
pub fn kind_of(name: &str) -> Option<(Kind, String)> {
    let lower = name.to_lowercase();
    for (ext, kind) in [(".tar.gz", Kind::TarGz), (".tgz", Kind::TarGz), (".tar", Kind::Tar), (".zip", Kind::Zip), (".7z", Kind::SevenZ)] {
        if lower.ends_with(ext) && lower.len() > ext.len() {
            return Some((kind, name[..name.len() - ext.len()].to_string()));
        }
    }
    None
}

/// dir の中で使われていない名前（"名前.ext"、なければ "名前 (2).ext" …）。ext は "" ならフォルダ
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let make = |n: u32| {
        let base = if n == 1 { stem.to_string() } else { format!("{} ({})", stem, n) };
        dir.join(if ext.is_empty() { base } else { format!("{}.{}", base, ext) })
    };
    (1..).map(make).find(|p| !p.exists()).unwrap()
}

/// 書庫の中の名前を、展開先の中の安全なパスにする（外へ出る .. やドライブの指定は拒む）
fn safe_rel(name: &str) -> Option<PathBuf> {
    let name = name.replace('\\', "/");
    let rel = Path::new(name.trim_start_matches('/'));
    if name.starts_with('/') || name.contains(':') {
        return None;
    }
    let mut out = PathBuf::new();
    for c in rel.components() {
        match c {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

/// zip の中の名前：UTF-8 として読めればそのまま、読めなければ Shift_JIS（日本語の Windows で作った zip）
fn zip_name(raw: &[u8]) -> String {
    match std::str::from_utf8(raw) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::SHIFT_JIS.decode(raw).0.into_owned(),
    }
}

// ---------------------------------------------------------------- 圧縮

/// 項目（ファイル・フォルダ）を、書庫の中の名前（相対パス）と一緒に並べる。フォルダは中身まで
fn walk(base: &Path, path: &Path, out: &mut Vec<(PathBuf, String, bool)>) -> Result<(), String> {
    let rel = path.strip_prefix(base).map_err(io_err)?.to_string_lossy().replace('\\', "/");
    if path.is_dir() {
        out.push((path.to_path_buf(), rel, true));
        let mut items: Vec<PathBuf> = std::fs::read_dir(path).map_err(io_err)?.filter_map(|e| e.ok()).map(|e| e.path()).collect();
        items.sort();
        for p in items {
            walk(base, &p, out)?;
        }
    } else {
        out.push((path.to_path_buf(), rel, false));
    }
    Ok(())
}

/// ファイルの更新日時を、zip に入れる形（その PC の時刻。zip の決まり）にする。取れなければ None（zip の部品の既定の日時になる）
fn zip_time(path: &Path) -> Option<zip::DateTime> {
    use std::os::windows::fs::MetadataExt;
    use windows::Win32::Foundation::{FILETIME, SYSTEMTIME};
    use windows::Win32::System::Time::{FileTimeToSystemTime, SystemTimeToTzSpecificLocalTime};
    let t = std::fs::metadata(path).ok()?.last_write_time();
    let ft = FILETIME { dwLowDateTime: t as u32, dwHighDateTime: (t >> 32) as u32 };
    let (mut utc, mut local) = (SYSTEMTIME::default(), SYSTEMTIME::default());
    unsafe {
        FileTimeToSystemTime(&ft, &mut utc).ok()?;
        SystemTimeToTzSpecificLocalTime(None, &utc, &mut local).ok()?;
    }
    zip::DateTime::from_date_and_time(local.wYear, local.wMonth as u8, local.wDay as u8, local.wHour as u8, local.wMinute as u8, local.wSecond as u8).ok()
}

pub fn create_zip(sources: &[PathBuf], dest: &Path) -> Result<(), String> {
    let mut zw = zip::ZipWriter::new(BufWriter::new(File::create(dest).map_err(io_err)?));
    let mut list = Vec::new();
    for s in sources {
        walk(s.parent().unwrap_or(s), s, &mut list)?;
    }
    for (path, name, is_dir) in list {
        let mut base = zip::write::SimpleFileOptions::default();
        if let Some(t) = zip_time(&path) {
            base = base.last_modified_time(t);
        }
        if is_dir {
            zw.add_directory(name, base).map_err(io_err)?;
            continue;
        }
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let opts = base
            .compression_method(zip::CompressionMethod::Deflated)
            // 4GB を超えるファイルは、大きなファイル用の形（zip64）で入れる
            .large_file(size >= u32::MAX as u64);
        zw.start_file(name, opts).map_err(io_err)?;
        std::io::copy(&mut BufReader::new(File::open(&path).map_err(io_err)?), &mut zw).map_err(io_err)?;
    }
    zw.finish().map_err(io_err)?;
    Ok(())
}

pub fn create_7z(sources: &[PathBuf], dest: &Path) -> Result<(), String> {
    let mut w = sevenz_rust2::ArchiveWriter::create(dest).map_err(io_err)?;
    let mut list = Vec::new();
    for s in sources {
        walk(s.parent().unwrap_or(s), s, &mut list)?;
    }
    for (path, name, is_dir) in list {
        let entry = sevenz_rust2::ArchiveEntry::from_path(&path, name);
        if is_dir {
            w.push_archive_entry::<&[u8]>(entry, None).map_err(io_err)?;
        } else {
            w.push_archive_entry(entry, Some(BufReader::new(File::open(&path).map_err(io_err)?))).map_err(io_err)?;
        }
    }
    w.finish().map_err(io_err)?;
    Ok(())
}

// ---------------------------------------------------------------- 展開

fn extract_zip(archive: &Path, dest: &Path) -> Result<(), String> {
    let mut z = zip::ZipArchive::new(BufReader::new(File::open(archive).map_err(io_err)?)).map_err(|e| format!("invalid: {}", e))?;
    for i in 0..z.len() {
        let mut e = z.by_index(i).map_err(|e| format!("invalid: {}", e))?;
        let name = zip_name(e.name_raw());
        let Some(rel) = safe_rel(&name) else { return Err(format!("invalid: unsafe path in archive ({})", name)) };
        let out = dest.join(rel);
        if e.is_dir() || name.ends_with('/') {
            std::fs::create_dir_all(&out).map_err(io_err)?;
            continue;
        }
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p).map_err(io_err)?;
        }
        std::io::copy(&mut e, &mut BufWriter::new(File::create(&out).map_err(io_err)?)).map_err(io_err)?;
    }
    Ok(())
}

fn extract_tar<R: std::io::Read>(reader: R, dest: &Path) -> Result<(), String> {
    let mut t = tar::Archive::new(reader);
    for entry in t.entries().map_err(|e| format!("invalid: {}", e))? {
        let mut entry = entry.map_err(|e| format!("invalid: {}", e))?;
        let name = entry.path().map_err(io_err)?.to_string_lossy().into_owned();
        if safe_rel(&name).is_none() {
            return Err(format!("invalid: unsafe path in archive ({})", name));
        }
        // unpack_in は、展開先の外へ出るものを書かない（リンクも含めて確かめる）
        entry.unpack_in(dest).map_err(io_err)?;
    }
    Ok(())
}

pub fn extract(archive: &Path, kind: Kind, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(io_err)?;
    match kind {
        Kind::Zip => extract_zip(archive, dest),
        Kind::SevenZ => sevenz_rust2::decompress_file(archive, dest).map_err(|e| format!("invalid: {}", e)),
        Kind::Tar => extract_tar(BufReader::new(File::open(archive).map_err(io_err)?), dest),
        Kind::TarGz => extract_tar(flate2::read::GzDecoder::new(BufReader::new(File::open(archive).map_err(io_err)?)), dest),
    }
}

// ---------------------------------------------------------------- コマンド

/// 選んだ項目を圧縮する。format は "zip" か "7z"。作った書庫のパスを返す
#[tauri::command]
pub async fn archive_create(items: Vec<EntryRef>, format: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ext = match format.as_str() {
            "zip" | "7z" => format.clone(),
            _ => return Err(format!("invalid: format {}", format)),
        };
        let sources: Vec<PathBuf> = items.iter().map(verify).collect::<Result<_, _>>()?;
        let first = sources.first().ok_or("invalid: no items")?;
        let dir = first.parent().ok_or("invalid: cannot compress a drive")?;
        // 名前は最初の項目から（ファイルなら拡張子を除く。Win11 と同じ）
        let stem = if first.is_dir() { first.file_name() } else { first.file_stem() }.map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "archive".into());
        let dest = unique_path(dir, &stem, &ext);
        let result = if ext == "zip" { create_zip(&sources, &dest) } else { create_7z(&sources, &dest) };
        if result.is_err() {
            let _ = std::fs::remove_file(&dest);
        }
        result.map(|_| dest.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 書庫を、同じフォルダの「書庫の名前」のフォルダへ展開する。作ったフォルダのパスを返す
#[tauri::command]
pub async fn archive_extract(item: EntryRef) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = verify(&item)?;
        let name = path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let (kind, stem) = kind_of(&name).ok_or_else(|| format!("invalid: not an archive ({})", name))?;
        let dest = unique_path(path.parent().ok_or("invalid")?, &stem, "");
        let result = extract(&path, kind, &dest);
        if result.is_err() {
            // 途中まで出したものは片付ける（展開のために作ったフォルダなので、ほかの物は入っていない）
            let _ = std::fs::remove_dir_all(&dest);
        }
        result.map(|_| dest.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ep-archive-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn sample(d: &Path) -> Vec<PathBuf> {
        std::fs::create_dir_all(d.join("資料/中")).unwrap();
        std::fs::write(d.join("資料/a.txt"), "あいう").unwrap();
        std::fs::write(d.join("資料/中/b.txt"), "b").unwrap();
        std::fs::write(d.join("c.txt"), "c").unwrap();
        vec![d.join("資料"), d.join("c.txt")]
    }

    fn check(out: &Path) {
        assert_eq!(std::fs::read_to_string(out.join("資料/a.txt")).unwrap(), "あいう");
        assert_eq!(std::fs::read_to_string(out.join("資料/中/b.txt")).unwrap(), "b");
        assert_eq!(std::fs::read_to_string(out.join("c.txt")).unwrap(), "c");
    }

    #[test]
    fn zip_round_trip_with_japanese_names() {
        let d = temp("zip");
        let src = sample(&d.join("src"));
        create_zip(&src, &d.join("x.zip")).unwrap();
        extract(&d.join("x.zip"), Kind::Zip, &d.join("out")).unwrap();
        check(&d.join("out"));
    }

    #[test]
    fn sevenz_round_trip() {
        let d = temp("7z");
        let src = sample(&d.join("src"));
        create_7z(&src, &d.join("x.7z")).unwrap();
        extract(&d.join("x.7z"), Kind::SevenZ, &d.join("out")).unwrap();
        check(&d.join("out"));
    }

    #[test]
    fn reads_shift_jis_names_in_zip() {
        // 日本語の Windows の「送る → 圧縮」で作った zip は、名前が Shift_JIS のまま入っている。
        // zip の部品は名前を UTF-8 でしか書けないので、名前の読み方（zip_name）を確かめる
        let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode("課題/レポート.txt");
        assert_eq!(zip_name(&sjis), "課題/レポート.txt");
        assert_eq!(zip_name("普通の名前.txt".as_bytes()), "普通の名前.txt");
    }

    #[test]
    fn tar_gz_extracts() {
        let d = temp("tgz");
        let f = File::create(d.join("x.tar.gz")).unwrap();
        let mut b = tar::Builder::new(flate2::write::GzEncoder::new(f, flate2::Compression::default()));
        let mut h = tar::Header::new_gnu();
        h.set_size(5);
        h.set_cksum();
        b.append_data(&mut h, "dir/hello.txt", &b"hello"[..]).unwrap();
        b.into_inner().unwrap().finish().unwrap().flush().unwrap();
        extract(&d.join("x.tar.gz"), Kind::TarGz, &d.join("out")).unwrap();
        assert_eq!(std::fs::read_to_string(d.join("out/dir/hello.txt")).unwrap(), "hello");
    }

    #[test]
    fn rejects_escaping_names() {
        assert!(safe_rel("../evil.txt").is_none());
        assert!(safe_rel("a/../../evil.txt").is_none());
        assert!(safe_rel("C:/Windows/x.dll").is_none());
        assert!(safe_rel("/abs.txt").is_none());
        assert_eq!(safe_rel("a\\b.txt").unwrap(), PathBuf::from("a").join("b.txt"));
        let d = temp("evil");
        let mut zw = zip::ZipWriter::new(File::create(d.join("e.zip")).unwrap());
        zw.start_file("../evil.txt", zip::write::SimpleFileOptions::default()).unwrap();
        zw.write_all(b"x").unwrap();
        zw.finish().unwrap();
        assert!(extract(&d.join("e.zip"), Kind::Zip, &d.join("out")).is_err());
        assert!(!d.join("evil.txt").exists());
    }

    #[test]
    fn names_and_kinds() {
        assert_eq!(kind_of("課題.ZIP"), Some((Kind::Zip, "課題".into())));
        assert_eq!(kind_of("a.tar.gz"), Some((Kind::TarGz, "a".into())));
        assert_eq!(kind_of("a.tgz"), Some((Kind::TarGz, "a".into())));
        assert_eq!(kind_of("a.7z"), Some((Kind::SevenZ, "a".into())));
        assert_eq!(kind_of("a.rar"), None);
        assert_eq!(kind_of(".zip"), None);
        let d = temp("unique");
        assert_eq!(unique_path(&d, "x", "zip"), d.join("x.zip"));
        std::fs::write(d.join("x.zip"), "").unwrap();
        assert_eq!(unique_path(&d, "x", "zip"), d.join("x (2).zip"));
        std::fs::create_dir(d.join("x")).unwrap();
        assert_eq!(unique_path(&d, "x", ""), d.join("x (2)"));
    }
}
