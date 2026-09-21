# Codicons

Vendored from [`@vscode/codicons`](https://github.com/microsoft/vscode-codicons)
0.0.46. VS Code injects this icon font into every webview, and extension UIs
render their buttons with `codicon-*` classes; without it every icon is a blank
box. The app serves these two files to webviews over the `dcode-webview`
scheme.

Icons are licensed CC BY 4.0 (`LICENSE-CC-BY-4.0.txt`), the accompanying code
MIT (`LICENSE-MIT.txt`), both Copyright (c) Microsoft Corporation.

To update: `npm pack @vscode/codicons`, then copy `dist/codicon.ttf` and
`dist/codicon.css` here.
