# Better Justel maintenance

Better Justel is a Manifest V3 browser extension for the French Justel legislation pages. Shared modules receive a `ctx` object from `scripts/content.js`. Keep Chrome, Firefox and offline entry points consistent.

## Browser verification

- Use the agent-browser skill for inspecting Justel HTML and checking changes in a real browser. Read its `SKILL.md` and run `agent-browser skills get core` before first use. Work in a named session so other browser sessions are not disturbed.
- Load the unpacked extension with `agent-browser --session <name> --extension <absolute-repository-path> open <Justel URL>`. Use a Chrome for Testing executable via `--executable-path` if the installed Chrome ignores extension-loading flags. Reload the extension or restart the session after manifest changes. Ask the user to install the extension only if automatic loading is unavailable.
- Inspect actual pages before assuming their markup. Current and archived pages use different IDs for “Fiche des modifications”; find that section by its heading. Legacy pages can use Windows-1252 and inline amendment references. Match articles by their number, never their generated `node...` IDs across snapshots.
- For history changes, verify Judicial Code Part I Art. 23 (`1967101052`), repealed Civil Code Art. 1130 (`1804032153`), and several articles (including inserted Art. 6ter) of the special law of 8 August 1980 (`1980080801`). Check hover/focus, spinner, date previews, visible slider ticks, archive links, centred dates, sticky controls within the article, readable paragraph-label spacing, restored highlights, errors/retries, and both storage-clear controls.
- Serve the repository locally with `python3 -m http.server 8765 --bind 127.0.0.1` and use agent-browser to open `/tests/history.html`. Verify `window.historyDone === true`, no `window.historyError`, and every `window.historyChecks` entry passing. If `tests/regressions.html` is present locally, run its existing checks too. Run `node --check` on changed JavaScript and validate both manifests as JSON.

## Storage and historical text

- Use extension-local storage (`chrome.storage.local`) through the existing helpers, consistent with stored acts. Archives are keyed by act ELI and archive number; the latest index snapshot also records the act's update date. Store each full snapshot once, even when it doubles as the index. Keep snapshots reusable when new archives appear. Bump the history cache schema if the stored format changes.
- Fetch the latest archive index lazily, then only full archives relevant to the selected article. Share in-flight requests and cached pages between articles; bound download concurrency.
- Analyse detached archive documents with the shared article parser. Preserve the current article DOM, highlights and annotations while showing read-only historical text. Do not save archived highlights under current-text keys.
- Both the information pane and popup must clear an act's archives. Preserve other acts and highlights, and invalidate pending downloads so clearing storage cannot immediately repopulate it.

## Version and documentation

- Bump `version` in **both** `manifest.json` and `manifest.firefox.json` for each release. Use a minor version for a substantial feature and a patch version for a small fix; follow an explicit version requested by the user. Keep the versions identical.
- Update `README.md` to describe changed user behaviour and any concrete limitations. Append an entry to its **Release history** with the same version and concise feature/fix descriptions.
- Add new content scripts to both manifests and `html/offline.html`. Keep maintenance documents and test fixtures out of packaged extensions using `.packageignore`.
- Review `git diff` before finishing. Preserve unrelated edits, report the changes and validation, and do not publish, commit or create releases unless requested.
