// 自分の表示名とアイコン（ADR 0040）。アプリのデータ（profile）に1つだけ覚える。
// 決める画面は、コマンドの一覧の「自分の表示名とアイコン…」と、MOD に初めて identity.get を許可したとき。
import type { SettingDef } from "../api/types";
import { PROFILE_ICON_MAX, PROFILE_NAME_MAX } from "../api/types";
import { normalizeProfile, type Profile } from "../core/profile";
import { backend } from "./backend";
import { settingsDialog } from "./mod-ui";

const FIELDS: SettingDef[] = [
  { key: "name", type: "text", label: "表示名", default: "", maxLength: PROFILE_NAME_MAX },
  { key: "icon", type: "text", label: "アイコン（絵文字など）", default: "", maxLength: PROFILE_ICON_MAX },
];

class ProfileService {
  private profile: Profile = { name: null, icon: null };
  private loading: Promise<void> | null = null;
  private readonly listeners = new Set<(p: Profile) => void>();

  load(): Promise<void> {
    this.loading ??= backend
      .appDataLoad("profile")
      .then((text) => {
        this.profile = normalizeProfile(text ? JSON.parse(text) : null);
      })
      .catch(() => {});
    return this.loading;
  }

  async get(): Promise<Profile> {
    await this.load();
    return { ...this.profile };
  }

  /** 決める画面を出す。保存したら新しい値、やめたら null */
  async edit(): Promise<Profile | null> {
    const now = await this.get();
    const change = await settingsDialog("自分の表示名とアイコン", FIELDS, { name: now.name ?? "", icon: now.icon ?? "" });
    if (!change) return null;
    this.profile = normalizeProfile(change.values);
    await backend.appDataSave("profile", JSON.stringify(this.profile));
    this.notify();
    return { ...this.profile };
  }

  /** ほかのウィンドウが保存した：読み直して知らせる */
  async reload() {
    this.loading = null;
    await this.load();
    this.notify();
  }

  onChange(cb: (p: Profile) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify() {
    for (const cb of this.listeners) cb({ ...this.profile });
  }
}

export const profileService = new ProfileService();
