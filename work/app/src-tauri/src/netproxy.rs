// 本体が MOD の代わりに通信する（ADR 0027）。
// MOD の画面は隔離されていて、ブラウザの決まり（CORS）や「どこのページからか」が無いことで断られるサービスがある。
// そこで本体（Rust）が通信して、結果を MOD に渡す。決まり：
// - 宛先は、その MOD の manifest の network に書いた先だけ（転送（リダイレクト）の先も、1回ごとに確かめる）
// - 宛先の名前が PC の中・家の中の住所（127.0.0.1・192.168.x.x など）を指していたら通信しない（ルーターの画面などを守る）
// - 送り元として「explorer_plus の、この MOD から」と名乗る（User-Agent）。クッキーは送らず、受け取らない
// - 秘密の設定（API キー）は、manifest に書いた宛先にだけ本体が付ける。MOD には値を見せない（MOD に返す URL からも除く）
// 渡し方は2つ：net.fetch（結果を MOD に返す）と net.url（<img> などにそのまま使える URL。http://epnet.localhost/<印>）

use crate::mods::{forbidden_header, net_of, valid_header_name, valid_id, SecretDef, SecretSend};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::http::{Request, Response, StatusCode};
use tauri::AppHandle;
use url::Url;

/// 受け取る大きさの上限
pub const BODY_MAX: usize = 16 * 1024 * 1024;
/// 送る大きさの上限
const SEND_MAX: usize = 4 * 1024 * 1024;
const REDIRECTS_MAX: usize = 5;
const HEADERS_MAX: usize = 30;
/// 発行しておく URL の数の上限（超えたら古いものから無効にする）
const MAX_TOKENS: usize = 4000;
/// MOD の画面から見た、本体が代わりに取ってくる URL の配信元
pub const NET_HOST: &str = "epnet.localhost";

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetRequest {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body_base64: Option<String>,
    /// 付ける秘密の設定の key
    #[serde(default)]
    pub secret: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NetMeta {
    pub status: u16,
    pub status_text: String,
    /// 転送のあとの URL（秘密の値は除いたもの）
    pub url: String,
    pub headers: Vec<(String, String)>,
}

/// PC の外（インターネット）の住所か
fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => {
            let o = a.octets();
            !(a.is_private()
                || a.is_loopback()
                || a.is_link_local()
                || a.is_unspecified()
                || a.is_broadcast()
                || a.is_documentation()
                || o[0] == 0
                || (o[0] == 100 && (o[1] & 0xc0) == 64)
                || (o[0] == 198 && (o[1] & 0xfe) == 18)
                || o[0] >= 224)
        }
        IpAddr::V6(a) => {
            if let Some(v4) = a.to_ipv4_mapped() {
                return public_ip(IpAddr::V4(v4));
            }
            let s = a.segments();
            !(a.is_loopback() || a.is_unspecified() || a.is_multicast() || (s[0] & 0xfe00) == 0xfc00 || (s[0] & 0xffc0) == 0xfe80 || s[0] == 0x2001 && s[1] == 0x0db8)
        }
    }
}

fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            // 転送は自分で1回ずつ確かめる
            .redirects(0)
            .timeout_connect(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .resolver(|netloc: &str| -> std::io::Result<Vec<SocketAddr>> {
                let addrs: Vec<SocketAddr> = netloc.to_socket_addrs()?.filter(|a| public_ip(a.ip())).collect();
                if addrs.is_empty() {
                    return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "the name points to an address inside this PC or network"));
                }
                Ok(addrs)
            })
            .build()
    })
}

/// URL の origin（"https://name" か "https://name:port"）
fn origin_of(u: &Url) -> String {
    match u.port() {
        Some(p) => format!("https://{}:{}", u.host_str().unwrap_or(""), p),
        None => format!("https://{}", u.host_str().unwrap_or("")),
    }
}

/// manifest の network の1つ（"https://name"・"https://*.name"・ポート付き）に URL が当てはまるか
fn origin_matches(entry: &str, host: &str, port: Option<u16>) -> bool {
    let Some(rest) = entry.strip_prefix("https://") else { return false };
    let (h, p) = match rest.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().ok().filter(|&p| p != 443)),
        None => (rest, None),
    };
    if p != port {
        return false;
    }
    match h.strip_prefix("*.") {
        Some(suffix) => host.len() > suffix.len() + 1 && host.ends_with(suffix) && host.as_bytes()[host.len() - suffix.len() - 1] == b'.',
        None => host == h,
    }
}

/// 通信してよい URL か：https で、利用者名などが無く、名前（IP アドレスでない）で、network に書いた先に当てはまる
fn allowed(u: &Url, network: &[String]) -> bool {
    if u.scheme() != "https" || !u.username().is_empty() || u.password().is_some() {
        return false;
    }
    let Some(url::Host::Domain(host)) = u.host() else { return false };
    network.iter().any(|o| origin_matches(o, host, u.port()))
}

fn parse_url(s: &str, network: &[String]) -> Result<Url, String> {
    let mut u = Url::parse(s).map_err(|_| format!("invalid: url \"{}\"", s))?;
    u.set_fragment(None);
    if !allowed(&u, network) {
        return Err(format!("not-declared: {} is not in the manifest's network", origin_of(&u)));
    }
    Ok(u)
}

/// URL の ?name= を value にする（同じ名前の項目は除いてから足す）
fn with_query(u: &Url, name: &str, value: Option<&str>) -> Url {
    let pairs: Vec<(String, String)> = u.query_pairs().filter(|(k, _)| k != name).map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    let mut out = u.clone();
    if pairs.is_empty() && value.is_none() {
        out.set_query(None);
        return out;
    }
    {
        let mut q = out.query_pairs_mut();
        q.clear();
        for (k, v) in &pairs {
            q.append_pair(k, v);
        }
        if let Some(v) = value {
            q.append_pair(name, v);
        }
    }
    out
}

fn user_agent(view_id: &str) -> String {
    format!("explorer_plus/{} (MOD {}; desktop file manager for Windows)", env!("CARGO_PKG_VERSION"), view_id)
}

/// 本体が代わりに通信する。秘密の設定と値は secret で渡す（資格情報マネージャーから読むのは呼ぶ側）
fn fetch_with(view_id: &str, network: &[String], secret: Option<(&SecretDef, &str)>, req: &NetRequest) -> Result<(NetMeta, Vec<u8>), String> {
    let mut method = req.method.as_deref().unwrap_or("GET").to_ascii_uppercase();
    if !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].contains(&method.as_str()) {
        return Err(format!("invalid: method \"{}\"", method));
    }
    if req.headers.len() > HEADERS_MAX {
        return Err(format!("invalid: at most {} headers", HEADERS_MAX));
    }
    for (k, v) in &req.headers {
        if !valid_header_name(k) || forbidden_header(k) || v.len() > 8192 || v.bytes().any(|b| b < 0x20 && b != b'\t' || b == 0x7f) {
            return Err(format!("invalid: header \"{}\" cannot be set", k));
        }
    }
    let mut body = match &req.body_base64 {
        Some(b) => Some(base64::engine::general_purpose::STANDARD.decode(b).map_err(|_| "invalid: body".to_string())?),
        None => None,
    };
    if body.as_ref().is_some_and(|b| b.len() > SEND_MAX) {
        return Err(format!("too-large: the body is over {} MB", SEND_MAX / 1024 / 1024));
    }
    let mut url = parse_url(&req.url, network)?;
    if let Some((SecretDef { how: SecretSend::Query { name }, .. }, _)) = secret {
        // MOD が同じ名前を URL に書いていても、本体の値に入れ替える（MOD に返す URL にも残さない）
        url = with_query(&url, name, None);
    }
    for hop in 0..=REDIRECTS_MAX {
        // 秘密の値は、manifest に書いた宛先と同じ origin のときだけ付ける
        let attach = secret.filter(|(d, _)| origin_of(&url) == d.origin);
        let send_url = match attach {
            Some((d, v)) => match &d.how {
                SecretSend::Query { name } => with_query(&url, name, Some(v)),
                SecretSend::Header { .. } => url.clone(),
            },
            None => url.clone(),
        };
        let mut r = agent().request(&method, send_url.as_str()).set("User-Agent", &user_agent(view_id));
        for (k, v) in &req.headers {
            r = r.set(k, v);
        }
        if let Some((d, v)) = attach {
            if let SecretSend::Header { name, prefix } = &d.how {
                r = r.set(name, &format!("{}{}", prefix, v));
            }
        }
        let result = match &body {
            Some(b) => r.send_bytes(b),
            None => r.call(),
        };
        let resp = match result {
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r,
            Err(ureq::Error::Transport(t)) => return Err(format!("network: {}", t)),
        };
        let status = resp.status();
        if (300..400).contains(&status) && status != 304 {
            if let Some(loc) = resp.header("Location") {
                if hop == REDIRECTS_MAX {
                    return Err("network: too many redirects".into());
                }
                let next = url.join(loc).map_err(|_| "network: bad redirect".to_string())?;
                let mut next = next;
                next.set_fragment(None);
                if !allowed(&next, network) {
                    return Err(format!("not-declared: redirected to {}, which is not in the manifest's network", origin_of(&next)));
                }
                // 303 と、POST の 301・302 は GET でやり直す（ブラウザと同じ）
                if status == 303 || (matches!(status, 301 | 302) && method == "POST") {
                    method = "GET".into();
                    body = None;
                }
                url = next;
                continue;
            }
        }
        let headers: Vec<(String, String)> = resp
            .headers_names()
            .into_iter()
            .filter(|n| !n.eq_ignore_ascii_case("set-cookie") && !n.eq_ignore_ascii_case("set-cookie2"))
            .map(|n| {
                let v = resp.all(&n).join(", ");
                (n.to_ascii_lowercase(), v)
            })
            .collect();
        if resp.header("Content-Length").and_then(|l| l.parse::<usize>().ok()).is_some_and(|l| l > BODY_MAX) {
            return Err(format!("too-large: the response is over {} MB", BODY_MAX / 1024 / 1024));
        }
        let meta = NetMeta { status, status_text: resp.status_text().to_string(), url: url.to_string(), headers };
        let mut out = Vec::new();
        resp.into_reader().take(BODY_MAX as u64 + 1).read_to_end(&mut out).map_err(|e| format!("network: {}", e))?;
        if out.len() > BODY_MAX {
            return Err(format!("too-large: the response is over {} MB", BODY_MAX / 1024 / 1024));
        }
        return Ok((meta, out));
    }
    Err("network: too many redirects".into())
}

/// その MOD の通信先・秘密の設定を調べてから通信する
fn fetch(app: &AppHandle, view_id: &str, req: &NetRequest) -> Result<(NetMeta, Vec<u8>), String> {
    if !valid_id(view_id) {
        return Err(format!("invalid: id \"{}\"", view_id));
    }
    let (network, secrets) = net_of(app, view_id).ok_or_else(|| format!("not-found: MOD {}", view_id))?;
    if network.is_empty() {
        return Err("not-declared: this view has no \"network\" in its manifest".into());
    }
    let Some(key) = &req.secret else { return fetch_with(view_id, &network, None, req) };
    let def = secrets
        .iter()
        .find(|d| &d.key == key)
        .ok_or_else(|| format!("not-declared: \"{}\" is not a secret setting with \"send\" in the manifest", key))?;
    let value = crate::secrets::read(view_id, key)?.ok_or_else(|| format!("not-found: the secret \"{}\" is not set (ask the user to set it in this view's settings)", key))?;
    fetch_with(view_id, &network, Some((def, &value)), req)
}

/// 結果を1つのバイト列にまとめる：[説明の長さ（4バイト、リトルエンディアン）][説明（JSON）][中身]
fn frame(meta: &NetMeta, body: Vec<u8>) -> Vec<u8> {
    let json = serde_json::to_vec(meta).unwrap_or_default();
    let mut out = Vec::with_capacity(4 + json.len() + body.len());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    out.extend_from_slice(&body);
    out
}

/// MOD の代わりに通信する（net.fetch）
#[tauri::command]
pub async fn net_fetch(app: AppHandle, view_id: String, request: NetRequest) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || fetch(&app, &view_id, &request).map(|(meta, body)| tauri::ipc::Response::new(frame(&meta, body))))
        .await
        .map_err(|e| e.to_string())?
}

// ---- net.url：<img> などにそのまま使える URL ----

#[derive(Clone, PartialEq, Eq, Hash)]
struct Target {
    view_id: String,
    url: String,
    secret: Option<String>,
}

#[derive(Default)]
pub struct NetTokens {
    inner: Mutex<TokenMap>,
}

#[derive(Default)]
struct TokenMap {
    map: HashMap<String, Target>,
    /// 同じ URL には同じ印を返す（画面の側で、読んだ画像を使い回せるように）
    rev: HashMap<Target, String>,
    order: VecDeque<String>,
}

impl NetTokens {
    fn issue(&self, t: Target) -> String {
        let mut g = self.inner.lock().unwrap();
        if let Some(token) = g.rev.get(&t) {
            return token.clone();
        }
        let mut raw = [0u8; 16];
        getrandom::fill(&mut raw).expect("random");
        let token: String = raw.iter().map(|b| format!("{:02x}", b)).collect();
        g.map.insert(token.clone(), t.clone());
        g.rev.insert(t, token.clone());
        g.order.push_back(token.clone());
        while g.order.len() > MAX_TOKENS {
            if let Some(old) = g.order.pop_front() {
                if let Some(t) = g.map.remove(&old) {
                    g.rev.remove(&t);
                }
            }
        }
        token
    }

    fn lookup(&self, token: &str) -> Option<Target> {
        self.inner.lock().unwrap().map.get(token).cloned()
    }
}

/// 本体が代わりに取ってくる URL を発行する（net.url）。宛先と秘密の設定は、ここでも確かめる
#[tauri::command]
pub fn net_url(app: AppHandle, tokens: tauri::State<'_, NetTokens>, view_id: String, url: String, secret: Option<String>) -> Result<String, String> {
    let (network, secrets) = net_of(&app, &view_id).ok_or_else(|| format!("not-found: MOD {}", view_id))?;
    let u = parse_url(&url, &network)?;
    if let Some(key) = &secret {
        if !secrets.iter().any(|d| &d.key == key) {
            return Err(format!("not-declared: \"{}\" is not a secret setting with \"send\" in the manifest", key));
        }
    }
    let token = tokens.issue(Target { view_id, url: u.to_string(), secret });
    Ok(format!("http://{}/{}", NET_HOST, token))
}

fn plain(code: StatusCode, text: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(code)
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Access-Control-Allow-Origin", "*")
        .body(text.as_bytes().to_vec())
        .unwrap()
}

/// 発行した URL への読み込みに答える（GET だけ）
pub fn handle(app: &AppHandle, tokens: &NetTokens, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() != "GET" {
        return plain(StatusCode::METHOD_NOT_ALLOWED, "GET only");
    }
    let token = request.uri().path().trim_start_matches('/');
    let Some(t) = tokens.lookup(token) else { return plain(StatusCode::NOT_FOUND, "unknown or expired URL") };
    let req = NetRequest { url: t.url, secret: t.secret, ..Default::default() };
    match fetch(app, &t.view_id, &req) {
        Ok((meta, body)) => {
            let get = |name: &str| meta.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone());
            let mut ctype = get("content-type").unwrap_or_else(|| "application/octet-stream".into());
            // ページやスクリプトとしては使わせない（画像・音・データとしてだけ）
            let lower = ctype.to_ascii_lowercase();
            if ["html", "javascript", "ecmascript", "xml"].iter().any(|k| lower.contains(k)) && !lower.starts_with("image/svg") {
                ctype = "text/plain; charset=utf-8".into();
            }
            let mut b = Response::builder()
                .status(meta.status)
                .header("Content-Type", ctype)
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
                .header("Access-Control-Allow-Origin", "*");
            for name in ["cache-control", "expires", "last-modified", "etag"] {
                if let Some(v) = get(name) {
                    b = b.header(name, v);
                }
            }
            b.body(body).unwrap_or_else(|_| plain(StatusCode::BAD_GATEWAY, "bad response"))
        }
        Err(e) => {
            #[cfg(debug_assertions)]
            eprintln!("[epnet] {}", e);
            plain(StatusCode::BAD_GATEWAY, &e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn net() -> Vec<String> {
        vec!["https://api.example.com".into(), "https://*.tiles.example.org".into(), "https://data.example.net:8443".into()]
    }

    #[test]
    fn only_listed_origins() {
        let n = net();
        for ok in ["https://api.example.com/v1?q=1", "https://API.example.com/", "https://a.tiles.example.org/1/2/3.png", "https://data.example.net:8443/x", "https://api.example.com:443/"] {
            assert!(parse_url(ok, &n).is_ok(), "{}", ok);
        }
        for ng in [
            "http://api.example.com/",
            "https://tiles.example.org/",
            "https://evil.com/?https://api.example.com",
            "https://api.example.com.evil.com/",
            "https://user@api.example.com/",
            "https://data.example.net/x",
            "https://api.example.com:8443/",
            "https://127.0.0.1/",
            "file:///C:/Windows/win.ini",
        ] {
            assert!(parse_url(ng, &n).is_err(), "{}", ng);
        }
        assert!(parse_url("https://evil.com/", &n).unwrap_err().starts_with("not-declared:"));
    }

    #[test]
    fn private_addresses_are_refused() {
        for ip in ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.5.4", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:192.168.0.1"] {
            assert!(!public_ip(ip.parse().unwrap()), "{}", ip);
        }
        for ip in ["8.8.8.8", "151.101.1.1", "2606:4700::1111"] {
            assert!(public_ip(ip.parse().unwrap()), "{}", ip);
        }
    }

    #[test]
    fn query_secret_replaces_and_is_removable() {
        let u = Url::parse("https://api.example.com/w?q=tokyo&appid=fake").unwrap();
        assert_eq!(with_query(&u, "appid", Some("real")).as_str(), "https://api.example.com/w?q=tokyo&appid=real");
        assert_eq!(with_query(&u, "appid", None).as_str(), "https://api.example.com/w?q=tokyo");
        let bare = Url::parse("https://api.example.com/w?appid=x").unwrap();
        assert_eq!(with_query(&bare, "appid", None).as_str(), "https://api.example.com/w");
    }

    #[test]
    fn bad_requests_are_refused_before_sending() {
        let n = net();
        let req = |method: &str, headers: Vec<(&str, &str)>| NetRequest {
            url: "https://api.example.com/".into(),
            method: Some(method.into()),
            headers: headers.into_iter().map(|(a, b)| (a.into(), b.into())).collect(),
            ..Default::default()
        };
        assert!(fetch_with("my.view", &n, None, &req("CONNECT", vec![])).unwrap_err().starts_with("invalid:"));
        assert!(fetch_with("my.view", &n, None, &req("GET", vec![("Cookie", "a=1")])).unwrap_err().starts_with("invalid:"));
        assert!(fetch_with("my.view", &n, None, &req("GET", vec![("User-Agent", "x")])).unwrap_err().starts_with("invalid:"));
        assert!(fetch_with("my.view", &n, None, &req("GET", vec![("X-A", "1\r\nX-B: 2")])).unwrap_err().starts_with("invalid:"));
    }

    #[test]
    fn frame_layout() {
        let meta = NetMeta { status: 200, status_text: "OK".into(), url: "https://a.com/".into(), headers: vec![] };
        let f = frame(&meta, vec![1, 2, 3]);
        let n = u32::from_le_bytes([f[0], f[1], f[2], f[3]]) as usize;
        let m: serde_json::Value = serde_json::from_slice(&f[4..4 + n]).unwrap();
        assert_eq!(m["status"], 200);
        assert_eq!(m["statusText"], "OK");
        assert_eq!(&f[4 + n..], &[1, 2, 3]);
    }

    #[test]
    fn tokens_reuse_and_expire() {
        let t = NetTokens::default();
        let a = Target { view_id: "v.a".into(), url: "https://a.com/1".into(), secret: None };
        let first = t.issue(a.clone());
        assert_eq!(t.issue(a.clone()), first);
        assert_eq!(first.len(), 32);
        for i in 0..MAX_TOKENS {
            t.issue(Target { view_id: "v.a".into(), url: format!("https://a.com/n{}", i), secret: None });
        }
        assert!(t.lookup(&first).is_none());
    }
}
