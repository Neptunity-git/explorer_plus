import { USES, SUPPORTED_API_VERSIONS, type Manifest, type Use } from "../api/types";
import { checkSettings } from "./settings";
import { checkNetwork } from "./network";

export type ManifestResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; errors: string[] };

const ID_RE = /^[a-z0-9][a-z0-9.-]{1,62}[a-z0-9]$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function checkId(raw: unknown, errors: string[], allowBuiltin: boolean): string | undefined {
  if (typeof raw !== "string") {
    errors.push("id: must be a string");
    return undefined;
  }
  if (!ID_RE.test(raw)) {
    errors.push("id: must match /^[a-z0-9][a-z0-9.-]{1,62}[a-z0-9]$/ (3-64 chars)");
    return undefined;
  }
  if (raw.startsWith("builtin.") && !allowBuiltin) {
    errors.push("id: ids starting with \"builtin.\" are reserved");
    return undefined;
  }
  return raw;
}

function checkName(raw: unknown, errors: string[]): string | undefined {
  if (typeof raw !== "string") {
    errors.push("name: must be a string");
    return undefined;
  }
  if (raw.trim() === "") {
    errors.push("name: must not be empty");
    return undefined;
  }
  if ([...raw].length > 40) {
    errors.push("name: must be 40 characters or fewer");
    return undefined;
  }
  return raw;
}

function checkVersion(raw: unknown, errors: string[]): string | undefined {
  if (typeof raw !== "string") {
    errors.push("version: must be a string");
    return undefined;
  }
  if (!VERSION_RE.test(raw)) {
    errors.push("version: must match /\\d+.\\d+.\\d+/ (major.minor.patch)");
    return undefined;
  }
  return raw;
}

function checkApiVersion(raw: unknown, errors: string[]): number | undefined {
  if (!Number.isInteger(raw)) {
    errors.push("apiVersion: must be an integer");
    return undefined;
  }
  const n = raw as number;
  if (n < SUPPORTED_API_VERSIONS.min || n > SUPPORTED_API_VERSIONS.max) {
    errors.push(
      `apiVersion: must be between ${SUPPORTED_API_VERSIONS.min} and ${SUPPORTED_API_VERSIONS.max}`
    );
    return undefined;
  }
  return n;
}

function checkEntry(raw: unknown, errors: string[]): string | undefined {
  if (typeof raw !== "string") {
    errors.push("entry: must be a string");
    return undefined;
  }
  if (!raw.endsWith(".js")) {
    errors.push("entry: must end with \".js\"");
    return undefined;
  }
  if (raw.startsWith("/")) {
    errors.push("entry: must not start with \"/\"");
    return undefined;
  }
  if (raw.includes("\\")) {
    errors.push("entry: must not contain \"\\\"");
    return undefined;
  }
  if (raw.includes(":")) {
    errors.push("entry: must not contain \":\"");
    return undefined;
  }
  const parts = raw.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    errors.push("entry: must not contain empty, \".\", or \"..\" path segments");
    return undefined;
  }
  return raw;
}

function checkUses(raw: unknown, errors: string[]): Use[] | undefined {
  if (!Array.isArray(raw)) {
    errors.push("uses: must be an array");
    return undefined;
  }
  const seen = new Set<string>();
  const result: Use[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      errors.push(`uses: unknown name "${String(item)}"`);
      continue;
    }
    if (seen.has(item)) continue;
    seen.add(item);
    if (!(USES as readonly string[]).includes(item)) {
      errors.push(`uses: unknown name "${item}"`);
      continue;
    }
    result.push(item as Use);
  }
  return result;
}

function checkDescription(raw: unknown, errors: string[]): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    errors.push("description: must be a string");
    return undefined;
  }
  if ([...raw].length > 200) {
    errors.push("description: must be 200 characters or fewer");
    return undefined;
  }
  return raw;
}

function checkLocation(raw: unknown, errors: string[]): "folder" | "none" | undefined {
  if (raw === undefined) return undefined;
  if (raw === "folder" || raw === "none") return raw;
  errors.push('location: must be "folder" or "none"');
  return undefined;
}

export function validateManifest(
  raw: unknown,
  options?: { allowBuiltin?: boolean }
): ManifestResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ["manifest: must be an object"] };
  }

  const allowBuiltin = options?.allowBuiltin === true;
  const errors: string[] = [];

  const id = checkId(raw.id, errors, allowBuiltin);
  const name = checkName(raw.name, errors);
  const version = checkVersion(raw.version, errors);
  const apiVersion = checkApiVersion(raw.apiVersion, errors);
  const entry = checkEntry(raw.entry, errors);
  const uses = checkUses(raw.uses, errors);
  const description = checkDescription(raw.description, errors);
  const location = checkLocation(raw.location, errors);
  const settings = checkSettings(raw.settings, errors);
  const network = checkNetwork(raw.network, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const manifest: Manifest = {
    id: id as string,
    name: name as string,
    version: version as string,
    apiVersion: apiVersion as number,
    entry: entry as string,
    uses: uses as Use[],
  };
  if (description !== undefined) {
    manifest.description = description;
  }
  if (location !== undefined) {
    manifest.location = location;
  }
  if (settings !== undefined && settings.length > 0) {
    manifest.settings = settings;
  }
  if (network !== undefined && network.length > 0) {
    manifest.network = network;
  }

  return { ok: true, manifest };
}
