// ファイルの詳しい情報（files.info。ADR 0023）を、Windows のプロパティから、MOD が使いやすい形にする。
// Windows の名前（"System.Photo.DateTaken" など）と単位の違い（時間は 100 ナノ秒、フレームレートは 1000 倍など）をここで吸収する。
import type { FileInfo } from "../api/types";

/** files.info で聞く Windows のプロパティ */
export const INFO_PROPERTY_NAMES = [
  "System.ItemTypeText",
  "System.DateCreated",
  "System.Image.HorizontalSize",
  "System.Image.VerticalSize",
  "System.Video.FrameWidth",
  "System.Video.FrameHeight",
  "System.Video.FrameRate",
  "System.Photo.DateTaken",
  "System.Photo.CameraManufacturer",
  "System.Photo.CameraModel",
  "System.GPS.LatitudeDecimal",
  "System.GPS.LongitudeDecimal",
  "System.Title",
  "System.Music.Artist",
  "System.Music.AlbumArtist",
  "System.Music.AlbumTitle",
  "System.Music.Genre",
  "System.Music.TrackNumber",
  "System.Media.Year",
  "System.Media.Duration",
  "System.Audio.EncodingBitrate",
  "System.Author",
  "System.Document.PageCount",
  "System.Document.WordCount",
] as const;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
/** 文字の並び（1つだけの文字も並びにする） */
const strs = (v: unknown): string[] | undefined => {
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : typeof v === "string" && v !== "" ? [v] : [];
  return list.length ? list : undefined;
};

/** Windows のプロパティの表 → FileInfo（値の無いものは入れない） */
export function toFileInfo(p: Record<string, unknown>): FileInfo {
  const duration100ns = num(p["System.Media.Duration"]);
  const frameRate = num(p["System.Video.FrameRate"]);
  const info: FileInfo = {
    typeName: str(p["System.ItemTypeText"]),
    created: num(p["System.DateCreated"]),
    width: num(p["System.Image.HorizontalSize"]) ?? num(p["System.Video.FrameWidth"]),
    height: num(p["System.Image.VerticalSize"]) ?? num(p["System.Video.FrameHeight"]),
    dateTaken: num(p["System.Photo.DateTaken"]),
    cameraMaker: str(p["System.Photo.CameraManufacturer"]),
    cameraModel: str(p["System.Photo.CameraModel"]),
    latitude: num(p["System.GPS.LatitudeDecimal"]),
    longitude: num(p["System.GPS.LongitudeDecimal"]),
    title: str(p["System.Title"]),
    artists: strs(p["System.Music.Artist"]),
    albumArtist: str(p["System.Music.AlbumArtist"]),
    album: str(p["System.Music.AlbumTitle"]),
    genres: strs(p["System.Music.Genre"]),
    track: num(p["System.Music.TrackNumber"]),
    year: num(p["System.Media.Year"]),
    // Windows は 100 ナノ秒の単位 → ミリ秒
    duration: duration100ns === undefined ? undefined : Math.round(duration100ns / 10_000),
    bitrate: num(p["System.Audio.EncodingBitrate"]),
    // Windows は「1000 秒あたりのフレーム数」 → 1 秒あたり
    frameRate: frameRate === undefined ? undefined : frameRate / 1000,
    authors: strs(p["System.Author"]),
    pageCount: num(p["System.Document.PageCount"]),
    wordCount: num(p["System.Document.WordCount"]),
  };
  for (const k of Object.keys(info) as (keyof FileInfo)[]) if (info[k] === undefined) delete info[k];
  return info;
}
