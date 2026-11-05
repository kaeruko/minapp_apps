"""Deploy explicitly registered MinApp Kobo ZIPs via the existing Hosted API.

No implicit storage/API fallback. New ZIPs are bound to a stable package_id,
reuploads of identical bytes do not create source revisions or published versions.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
import zipfile

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "deploy/kobo/apps.json"
HEX32 = re.compile(r"[0-9a-f]{32}\Z")
ALLOWED_SUFFIXES = {".html", ".css", ".js", ".mjs", ".json", ".txt", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp3", ".m4a", ".ogg", ".wav"}
ZIP_LIMIT = 2 * 1024 * 1024


def require_keys(value: object, expected: set[str], name: str) -> dict:
    if type(value) is not dict or set(value) != expected:
        raise ValueError(f"{name} must have exactly these keys: {sorted(expected)}")
    return value


def parse_registry(path: Path = REGISTRY) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    document = require_keys(raw, {"schema_version", "apps"}, "Kobo registry")
    if type(document["schema_version"]) is not int or document["schema_version"] != 1:
        raise ValueError("Unsupported Kobo registry schema_version")
    apps = document["apps"]
    if type(apps) is not dict or not apps:
        raise ValueError("Kobo registry must contain apps")
    identities: set[str] = set()
    for name, value in apps.items():
        if type(name) is not str or re.fullmatch(r"[a-z0-9_]+", name) is None:
            raise ValueError(f"Invalid app directory name: {name!r}")
        entry = require_keys(value, {"title", "files", "shop_visibility"}, f"apps.{name}")
        title = entry["title"]
        if type(title) is not str or not title or title != title.strip() or len(title) > 80:
            raise ValueError(f"Invalid title for {name}")
        if entry["shop_visibility"] not in ("listed", "unlisted"):
            raise ValueError(f"Invalid shop_visibility for {name}")
        files = entry["files"]
        if type(files) is not list or not files or len(files) > 100 or any(type(f) is not str for f in files) or len(files) != len(set(files)):
            raise ValueError(f"Invalid files list for {name}")
        if "index.html" not in files or "minapp-package.json" not in files:
            raise ValueError(f"{name}: index.html and minapp-package.json are required")
        for file in files:
            if type(file) is not str or file.startswith("/") or "\\" in file or "\x00" in file:
                raise ValueError(f"Invalid asset path {file!r}")
            parts = file.split("/")
            if any(part in ("", ".", "..") for part in parts) or PurePosixPath(file).suffix.lower() not in ALLOWED_SUFFIXES:
                raise ValueError(f"Invalid asset path {file!r}")
        package_file = ROOT / name / "minapp-package.json"
        package = require_keys(json.loads(package_file.read_text(encoding="utf-8")), {"schema_version", "package_id"}, f"{name} package")
        if type(package["schema_version"]) is not int or package["schema_version"] != 1:
            raise ValueError(f"{name}: invalid package schema_version")
        identity = package["package_id"]
        if type(identity) is not str or HEX32.fullmatch(identity) is None or identity in identities:
            raise ValueError(f"{name}: invalid or duplicated package_id")
        identities.add(identity)
    return apps


def build_zip(app: str, files: list[str]) -> bytes:
    if (ROOT / app).is_symlink():
        raise ValueError(f"App directory must not be a symlink: {app}")
    app_root = (ROOT / app).resolve(strict=True)
    output = io.BytesIO()
    total = 0
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for name in sorted(files):
            path = app_root / name
            if not path.is_file() or path.is_symlink() or not path.resolve(strict=True).is_relative_to(app_root):
                raise ValueError(f"Missing, symlinked or escaped asset: {app}/{name}")
            content = path.read_bytes()
            total += len(content)
            if len(content) > 4 * 1024 * 1024 or total > 8 * 1024 * 1024:
                raise ValueError(f"ZIP uncompressed size exceeds Hosted limit: {app}")
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            zf.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    payload = output.getvalue()
    if not payload or len(payload) > ZIP_LIMIT:
        raise ValueError(f"ZIP size exceeds 2 MiB Hosted limit: {app}")
    return payload


def require_origin(value: str) -> str:
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None or
            parsed.password is not None or parsed.path not in ("", "/") or
            parsed.query or parsed.fragment or parsed.port not in (None, 443) or
            parsed.hostname in ("localhost", "127.0.0.1", "::1")):
        raise ValueError("KOBO_API_BASE_URL must be an HTTPS public origin without path, query or credentials")
    return f"https://{parsed.netloc}"


def require_settings(environment: dict[str, str]) -> tuple[str, str, str, str]:
    names = ("KOBO_API_BASE_URL", "KOBO_LOGIN_ID", "KOBO_PASSWORD", "KOBO_GROUP_ID")
    missing = [name for name in names if not environment.get(name)]
    if missing:
        raise ValueError(f"Missing required GitHub Actions secrets: {', '.join(missing)}")
    base = require_origin(environment[names[0]])
    login_id, password, group_id = (environment[name] for name in names[1:])
    if HEX32.fullmatch(group_id) is None:
        raise ValueError("KOBO_GROUP_ID must be a 32-character lowercase hexadecimal group ID")
    if login_id != login_id.strip() or password != password.strip():
        raise ValueError("Login credentials must not include surrounding whitespace")
    return base, login_id, password, group_id


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise RuntimeError(f"Unexpected redirect (HTTP {code}) from {request.full_url}")


class HostedClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.access_token: str | None = None
        self.opener = build_opener(NoRedirect())

    def request(self, method: str, path: str, *, data: dict | bytes | None = None, status: int = 200) -> dict:
        if not path.startswith("/") or path.startswith("//"):
            raise ValueError("API path must be origin relative")
        if type(data) is dict:
            body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            content_type = "application/json"
        elif type(data) is bytes:
            body = data
            content_type = "application/zip"
        elif data is None:
            body = None
            content_type = None
        else:
            raise TypeError("API request data must be JSON object, ZIP bytes, or None")
        headers = {"Accept": "application/json"}
        if content_type:
            headers["Content-Type"] = content_type
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        request = Request(self.base_url + path, data=body, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=20) as response:
                if response.status != status:
                    raise RuntimeError(f"{method} {path}: unexpected HTTP {response.status}, expected {status}")
                if response.headers.get_content_type() != "application/json":
                    raise ValueError(f"{method} {path}: response must be application/json")
                raw = response.read(256 * 1024 + 1)
                if len(raw) > 256 * 1024:
                    raise ValueError(f"{method} {path}: response too large")
        except HTTPError as error:
            # Keep the original HTTP exception; never retry with a different identity or endpoint.
            detail = error.read(2048).decode("utf-8", errors="replace")
            raise RuntimeError(f"{method} {path}: HTTP {error.code}: {detail}") from error
        value = json.loads(raw.decode("utf-8"))
        if type(value) is not dict:
            raise ValueError(f"{method} {path}: JSON response must be an object")
        return value

    def login(self, login_id: str, password: str) -> None:
        result = self.request("POST", "/auth/login", data={"login_id": login_id, "password": password})
        if result.get("state") != "authenticated" or not isinstance(result.get("access_token"), str) or not result["access_token"]:
            raise ValueError("Kobo login did not return an authenticated session")
        self.access_token = result["access_token"]


def _positive_int(value: object, label: str) -> int:
    if type(value) is not int or value < 1:
        raise ValueError(f"Invalid positive integer: {label}")
    return value


def deploy(client: HostedClient, app_name: str, entry: dict, payload: bytes, group_id: str) -> str:
    groups = client.request("GET", "/hosted/groups")
    memberships = groups.get("groups")
    if type(memberships) is not list or not any(
        type(group) is dict and group.get("group_id") == group_id and group.get("status") == "active"
        for group in memberships
    ):
        raise ValueError("Authenticated Kobo account is not an active member of KOBO_GROUP_ID")

    title = entry["title"]
    response = client.request(
        "POST", f"/hosted/groups/{group_id}/apps/upload?title={quote(title, safe='')}",
        data=payload, status=201,
    )
    app_id = response.get("app_id")
    revision = _positive_int(response.get("source_revision"), "upload.source_revision")
    expected_sha = hashlib.sha256(payload).hexdigest()
    if (type(app_id) is not str or HEX32.fullmatch(app_id) is None or
            response.get("group_id") != group_id or response.get("title") != title or
            response.get("editable") is not True or response.get("source_kind") != "upload" or
            response.get("source_sha256") != expected_sha):
        raise ValueError("Uploaded Kobo app metadata does not match requested package")
    detail = client.request("GET", f"/hosted/my/apps/{app_id}")
    history = detail.get("published_history")
    if (detail.get("app_id") != app_id or detail.get("group_id") != group_id or
            detail.get("source_revision") != revision or type(history) is not list):
        raise ValueError("Managed Kobo app detail does not match upload")
    current_version = detail.get("published_version")
    if current_version is None:
        if history:
            raise ValueError("Unpublished app unexpectedly contains published_history")
        already_published = False
    else:
        _positive_int(current_version, "published_version")
        if not history or type(history[0]) is not dict or history[0].get("version") != current_version:
            raise ValueError("Published history does not match app version")
        previous_revision = _positive_int(history[0].get("source_revision"), "published_history.source_revision")
        if previous_revision > revision:
            raise ValueError("Published revision is newer than uploaded source")
        already_published = previous_revision == revision
        if already_published and history[0].get("sha256") != expected_sha:
            raise ValueError("Published SHA-256 does not match current source")
    if already_published:
        print(f"{app_name}: unchanged source revision {revision}, publication skipped")
    else:
        published = client.request(
            "POST", f"/hosted/groups/{group_id}/apps/{app_id}/publish",
            data={"revision": revision}, status=201,
        )
        if (published.get("app_id") != app_id or published.get("group_id") != group_id or
                published.get("source_revision") != revision):
            raise ValueError("Publish response does not match uploaded source")
        current_version = _positive_int(published.get("published_version"), "publish.published_version")
        print(f"{app_name}: published version {current_version}, source revision {revision}")

    if entry["shop_visibility"] == "listed":
        listing = client.request("GET", "/shop/apps")
        items = listing.get("apps")
        if type(items) is not list:
            raise ValueError("Shop catalog did not contain apps list")
        matches = [item for item in items if type(item) is dict and item.get("app_id") == app_id]
        if len(matches) > 1:
            raise ValueError("Shop catalog contains duplicated app ID")
        if not matches:
            result = client.request("PUT", f"/apps/{app_id}/shop-visibility", data={"visibility": "listed"})
            if result != {"app_id": app_id, "shop_visibility": "listed"}:
                raise ValueError("Shop listing response did not match app")
            listing = client.request("GET", "/shop/apps")
            matches = [item for item in listing.get("apps", []) if type(item) is dict and item.get("app_id") == app_id]
        if len(matches) != 1 or str(matches[0].get("version")) != str(current_version) or matches[0].get("sha256") != expected_sha:
            raise ValueError("Shop did not confirm the current published package")
    else:
        result = client.request("PUT", f"/apps/{app_id}/shop-visibility", data={"visibility": "unlisted"})
        if result != {"app_id": app_id, "shop_visibility": "unlisted"}:
            raise ValueError("Shop unlisting response did not match app")
    return app_id


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", required=True, help="Registered app directory name")
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--check", action="store_true", help="Validate and package without deployment")
    actions.add_argument("--publish", action="store_true", help="Upload, publish, and synchronize shop visibility")
    args = parser.parse_args()
    apps = parse_registry()
    if args.app not in apps:
        parser.error(f"Unregistered Kobo app: {args.app}")
    payload = build_zip(args.app, apps[args.app]["files"])
    print(f"{args.app}: package OK ({len(payload)} bytes, SHA-256 {hashlib.sha256(payload).hexdigest()})")
    if args.check:
        return
    base_url, login_id, password, group_id = require_settings(os.environ)
    client = HostedClient(base_url)
    client.login(login_id, password)
    app_id = deploy(client, args.app, apps[args.app], payload, group_id)
    print(f"{args.app}: deployed app_id={app_id} group_id={group_id}")


if __name__ == "__main__":
    main()
