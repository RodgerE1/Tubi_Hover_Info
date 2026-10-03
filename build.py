"""Create both complete browser packages using Python's standard library."""
from pathlib import Path
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source"
MANIFEST = {
    "manifest_version": 3,
    "name": "Tubi Hover Info",
    "version": "1.1.0",
    "description": "Hover over Tubi movies and shows for details and an optional TMDB score.",
    "permissions": ["storage"],
    "host_permissions": ["https://*.tubitv.com/*", "https://*.tubi.tv/*", "https://api.themoviedb.org/*"],
    "icons": {str(size): f"icons/icon-{size}.png" for size in (16, 32, 48, 128)},
    "action": {
        "default_title": "Tubi Hover Info settings",
        "default_popup": "popup.html",
        "default_icon": {str(size): f"icons/icon-{size}.png" for size in (16, 32, 48)},
    },
    "content_scripts": [{
        "matches": ["https://*.tubitv.com/*", "https://*.tubi.tv/*"],
        "js": ["bridge.js"],
        "world": "MAIN",
        "run_at": "document_idle",
    }, {
        "matches": ["https://*.tubitv.com/*", "https://*.tubi.tv/*"],
        "js": ["core.js", "metadata.js", "content.js"],
        "css": ["content-host.css"],
        "run_at": "document_idle",
    }],
    "web_accessible_resources": [{
        "resources": ["panel.css"],
        "matches": ["https://*.tubitv.com/*", "https://*.tubi.tv/*"],
    }],
    "content_security_policy": {"extension_pages": "script-src 'self'; object-src 'self'"},
}

def build():
    packages = ROOT / "packages"
    for browser in ("Opera", "Firefox"):
        target = packages / browser
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(SOURCE, target)
        manifest = dict(MANIFEST)
        if browser == "Opera":
            manifest["background"] = {"service_worker": "background.js"}
            manifest["minimum_chrome_version"] = "111"
        else:
            manifest["background"] = {"scripts": ["core.js", "background.js"]}
            manifest["browser_specific_settings"] = {"gecko": {
                "id": "tubi-hover-info@local.extension",
                "strict_min_version": "128.0",
            }}
        (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("Built complete Opera and Firefox directories.")

def package():
    target = ROOT / "downloads" / "Tubi_Hover_Info_v1.1.0.zip"
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(ROOT.rglob("*")):
            if not path.is_file() or any(part in {"__pycache__", ".test-profile", "node_modules", ".git", "downloads"} for part in path.parts):
                continue
            if path.suffix == ".log":
                continue
            archive.write(path, Path("Tubi_Hover_Info") / path.relative_to(ROOT))
    print(target)
    return target

if __name__ == "__main__":
    build()
    package()
