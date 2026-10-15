// ファイルの詳しい情報の形（files.info。ADR 0023）
import { describe, expect, it } from "vitest";
import { toFileInfo } from "../src/core/fileinfo";

describe("toFileInfo", () => {
  it("写真：縦横・撮影日時・カメラ・撮影場所", () => {
    expect(
      toFileInfo({
        "System.ItemTypeText": "JPG ファイル",
        "System.Image.HorizontalSize": 4032,
        "System.Image.VerticalSize": 3024,
        "System.Photo.DateTaken": 1700000000000,
        "System.Photo.CameraModel": "iPhone 15",
        "System.GPS.LatitudeDecimal": 36.4,
        "System.GPS.LongitudeDecimal": 139.06,
      }),
    ).toEqual({ typeName: "JPG ファイル", width: 4032, height: 3024, dateTaken: 1700000000000, cameraModel: "iPhone 15", latitude: 36.4, longitude: 139.06 });
  });

  it("曲：アーティストは並び、長さは 100 ナノ秒からミリ秒へ", () => {
    expect(
      toFileInfo({ "System.Title": "曲", "System.Music.Artist": "歌手", "System.Music.Genre": ["Pop", "J-Pop"], "System.Media.Duration": 2_345_670_000, "System.Media.Year": 2024 }),
    ).toEqual({ title: "曲", artists: ["歌手"], genres: ["Pop", "J-Pop"], duration: 234567, year: 2024 });
  });

  it("動画：縦横は動画の値、フレームレートは 1 秒あたり", () => {
    expect(toFileInfo({ "System.Video.FrameWidth": 1920, "System.Video.FrameHeight": 1080, "System.Video.FrameRate": 29970 })).toEqual({
      width: 1920,
      height: 1080,
      frameRate: 29.97,
    });
  });

  it("空・おかしな値は入れない", () => {
    expect(toFileInfo({ "System.Title": "", "System.Image.HorizontalSize": "x", "System.Music.Artist": [] })).toEqual({});
  });
});
