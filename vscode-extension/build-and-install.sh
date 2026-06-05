#!/usr/bin/env bash
#
# Vendors the grammar sources, packages the extension, and installs it into
# VS Code. Re-run this whenever spruce.js / stdlib.js or the extension changes.
set -euo pipefail

# Run from the extension root (this script's directory) regardless of cwd.
cd "$(dirname "$0")"

VSIX="spruce-language.vsix"

echo "==> Vendoring grammar sources into server/"
cp ../spruce.js ../stdlib.js server/

echo "==> Packaging extension -> $VSIX"
vsce package --allow-missing-repository --out "$VSIX"

echo "==> Locating VS Code 'code' CLI"
if command -v code >/dev/null 2>&1; then
	CODE=code
elif [ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
	CODE="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
else
	echo "Could not find the 'code' CLI." >&2
	echo "In VS Code run: Cmd+Shift+P -> \"Shell Command: Install 'code' command in PATH\", then re-run this script." >&2
	exit 1
fi

echo "==> Installing into VS Code"
"$CODE" --install-extension "$VSIX" --force

echo
echo "Done. Reload VS Code (Cmd+Shift+P -> \"Developer: Reload Window\") to pick up the new build."
