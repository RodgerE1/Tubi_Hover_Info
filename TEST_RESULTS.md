# Release verification — 1 October 2026

The Opera package was loaded in a separate Opera GX test profile on Windows. The browser reported Opera 136 and Chromium 152.0.7977.120. Final runs used software compositing; the live-page check blocked video streams. The user's normal browser profile was not used for these checks.

## Passed

- **8 helper checks:** movie/show/episode/localized URL parsing, rejecting unrelated or unsafe URLs, runtime formatting, safe poster URLs, validated IMDb links, bounded preferences, parsing serialized state without executing it, and malformed-state handling.
- **13 browser checks:** extension and CSS loading, hover delay, movie details, keeping the panel open while reading, cast expansion, pinning, Escape, TV-show details and season metadata, preferences, dynamically added cards and failed requests, asynchronous selection changes, malformed/unsafe metadata, already-loaded card data when detail HTML is unavailable, and keeping the panel inside a narrow viewport.
- **Live Tubi check:** hovered the actual **Spider-Man: Homecoming** card on Tubi's Action category page. The panel opened with the correct title, a populated synopsis, and the extension's actual styles. The page and metadata were not replaced by fixtures for this check.
- **Packaging:** JavaScript syntax, both browser manifests' local file references, matching source copies, and ZIP integrity were checked.

The repeatable browser UI suite uses controlled movie and show HTML fixtures, including unavailable and delayed responses. This separates UI behavior from Tubi's network variability. The separate live check verifies the real site's cards and loaded metadata. Detailed browser results are in `tests/RESULTS_Opera.json`.

## Limits

Opera is the tested and recommended version. The Firefox 128+ package was checked for packaging and syntax, but was not tested in a running Firefox browser. It is unsigned and can only be loaded temporarily in ordinary Firefox; Firefox removes it on restart.

Tubi's catalog and available information vary by region. Some fields may be absent, and future Tubi page changes may require updates. Missing information is omitted or explained rather than invented.

## Reproduce

Run `node --test tests/core.test.cjs` from the extracted project directory. The browser scripts require Node 22+ and a separately launched debugging browser with the Opera extension already loaded. Supply that isolated browser's loopback debugging port to `tests/browser.test.cjs`. Run `tests/live-site.test.cjs` after the UI suite to check the actual Tubi page. These scripts are developer checks; no Node or Python installation is required to use the extension.
