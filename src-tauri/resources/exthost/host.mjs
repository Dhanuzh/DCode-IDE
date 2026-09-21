// DCode-IDE VS Code extension host.
//
// Runs one extension's Node entrypoint with a `vscode` module supplied by this
// file. Anything that needs the UI is forwarded to the app as an RPC over
// stdio; anything that is plain Node (fs, child_process, net) runs here
// natively, which is what most extensions spend their time doing.

import { createRequire } from "node:module";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";

const FRAME_SEPARATOR = "\r\n\r\n";

// ---------------------------------------------------------------- transport

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}${FRAME_SEPARATOR}`);
  process.stdout.write(body);
}

function log(level, ...parts) {
  send({
    type: "log",
    level,
    message: parts
      .map((p) => (typeof p === "string" ? p : safeStringify(p)))
      .join(" "),
  });
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

let nextRpcId = 1;
const pendingRpc = new Map();

/** Ask the app to do something that needs the UI. */
function rpc(method, params) {
  const id = nextRpcId++;
  send({ type: "rpc", id, method, params });
  return new Promise((resolve, reject) => {
    pendingRpc.set(id, { resolve, reject });
  });
}

/** Fire-and-forget notification to the app. */
function notify(method, params) {
  send({ type: "notify", method, params });
}

// ------------------------------------------------------------- vscode shim

class Disposable {
  constructor(callOnDispose) {
    this._callOnDispose = callOnDispose;
  }
  dispose() {
    this._callOnDispose?.();
    this._callOnDispose = undefined;
  }
  static from(...items) {
    return new Disposable(() => {
      for (const item of items) item?.dispose?.();
    });
  }
}

class EventEmitter {
  constructor() {
    this._listeners = new Set();
    this.event = (listener) => {
      this._listeners.add(listener);
      return new Disposable(() => this._listeners.delete(listener));
    };
  }
  fire(value) {
    for (const listener of [...this._listeners]) {
      try {
        listener(value);
      } catch (error) {
        log("error", `event listener threw: ${error?.stack ?? error}`);
      }
    }
  }
  dispose() {
    this._listeners.clear();
  }
}

class Uri {
  constructor(scheme, authority, fsPath) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = fsPath;
    this.fsPath = fsPath;
  }
  static file(p) {
    return new Uri("file", "", p);
  }
  static joinPath(base, ...segments) {
    const root = String(base?.fsPath ?? base?.path ?? base);
    return new Uri(base?.scheme ?? "file", base?.authority ?? "", path.join(root, ...segments));
  }
  static from(components) {
    return new Uri(
      components?.scheme ?? "file",
      components?.authority ?? "",
      components?.path ?? "",
    );
  }
  with(change) {
    return new Uri(
      change?.scheme ?? this.scheme,
      change?.authority ?? this.authority,
      change?.path ?? this.path,
    );
  }
  static parse(value) {
    const match = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)(.*)$/i.exec(value);
    if (!match) return new Uri("file", "", value);
    return new Uri(match[1], match[2], match[3]);
  }
  toString() {
    return this.scheme === "file"
      ? `file://${this.fsPath}`
      : `${this.scheme}://${this.authority}${this.path}`;
  }
  toJSON() {
    return { scheme: this.scheme, path: this.path, fsPath: this.fsPath };
  }
}

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(startLine, startCharacter, endLine, endCharacter) {
    this.start =
      startLine instanceof Position
        ? startLine
        : new Position(startLine, startCharacter);
    this.end =
      startLine instanceof Position
        ? startCharacter
        : new Position(endLine, endCharacter);
  }
  get isEmpty() {
    return (
      this.start.line === this.end.line &&
      this.start.character === this.end.character
    );
  }
}

class Selection extends Range {}

const commandRegistry = new Map();

function memento(namespace, storageFile) {
  let cache = null;
  const load = () => {
    if (cache) return cache;
    try {
      cache = JSON.parse(fs.readFileSync(storageFile, "utf8"));
    } catch {
      cache = {};
    }
    return cache;
  };
  const flush = () => {
    try {
      fs.mkdirSync(path.dirname(storageFile), { recursive: true });
      fs.writeFileSync(storageFile, JSON.stringify(cache ?? {}), "utf8");
    } catch (error) {
      log("warn", `${namespace} state write failed: ${error?.message ?? error}`);
    }
  };
  return {
    get(key, fallback) {
      const value = load()[key];
      return value === undefined ? fallback : value;
    },
    update(key, value) {
      load();
      if (value === undefined) delete cache[key];
      else cache[key] = value;
      flush();
      return Promise.resolve();
    },
    keys() {
      return Object.keys(load());
    },
    setKeysForSync() {},
  };
}

function buildVscodeModule(context) {
  const onDidChangeActiveTextEditor = new EventEmitter();
  const onDidChangeTextEditorSelection = new EventEmitter();
  const onDidChangeConfiguration = new EventEmitter();
  const onDidOpenTextDocument = new EventEmitter();
  const onDidCloseTextDocument = new EventEmitter();
  const onDidSaveTextDocument = new EventEmitter();
  const onDidChangeWorkspaceFolders = new EventEmitter();

  const api = {
    version: "1.94.0",
    Disposable,
    EventEmitter,
    Uri,
    Position,
    Range,
    Selection,
    ThemeIcon: class ThemeIcon {
      constructor(id) {
        this.id = id;
      }
    },
    ThemeColor: class ThemeColor {
      constructor(id) {
        this.id = id;
      }
    },
    CancellationTokenSource: class CancellationTokenSource {
      constructor() {
        this.token = { isCancellationRequested: false, onCancellationRequested: new EventEmitter().event };
      }
      cancel() {
        this.token.isCancellationRequested = true;
      }
      dispose() {}
    },
    MarkdownString: class MarkdownString {
      constructor(value = "") {
        this.value = value;
        this.isTrusted = false;
        this.supportThemeIcons = false;
      }
      appendText(v) {
        this.value += v;
        return this;
      }
      appendMarkdown(v) {
        this.value += v;
        return this;
      }
      appendCodeblock(code, lang = "") {
        this.value += `\n\u0060\u0060\u0060${lang}\n${code}\n\u0060\u0060\u0060\n`;
        return this;
      }
    },
    SnippetString: class SnippetString {
      constructor(value = "") {
        this.value = value;
      }
    },
    TextEdit: class TextEdit {
      constructor(range, newText) {
        this.range = range;
        this.newText = newText;
      }
      static replace(range, newText) {
        return new api.TextEdit(range, newText);
      }
      static insert(position, newText) {
        return new api.TextEdit(new Range(position, position), newText);
      }
      static delete(range) {
        return new api.TextEdit(range, "");
      }
    },
    WorkspaceEdit: class WorkspaceEdit {
      constructor() {
        this._edits = [];
      }
      replace(uri, range, newText) {
        this._edits.push({ uri, range, newText });
      }
      insert(uri, position, newText) {
        this._edits.push({ uri, range: new Range(position, position), newText });
      }
      delete(uri, range) {
        this._edits.push({ uri, range, newText: "" });
      }
      set() {}
      get size() {
        return this._edits.length;
      }
    },
    Location: class Location {
      constructor(uri, rangeOrPosition) {
        this.uri = uri;
        this.range = rangeOrPosition;
      }
    },
    Diagnostic: class Diagnostic {
      constructor(range, message, severity = 0) {
        this.range = range;
        this.message = message;
        this.severity = severity;
      }
    },
    RelativePattern: class RelativePattern {
      constructor(base, pattern) {
        this.base = String(base?.uri?.fsPath ?? base?.fsPath ?? base);
        this.baseUri = Uri.file(this.base);
        this.pattern = pattern;
      }
    },
    FileSystemError: Object.assign(
      class FileSystemError extends Error {},
      {
        FileNotFound: (m) => new Error(`file not found: ${m ?? ""}`),
        FileExists: (m) => new Error(`file exists: ${m ?? ""}`),
        FileNotADirectory: (m) => new Error(`not a directory: ${m ?? ""}`),
        NoPermissions: (m) => new Error(`no permissions: ${m ?? ""}`),
        Unavailable: (m) => new Error(`unavailable: ${m ?? ""}`),
      },
    ),
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    TextEditorRevealType: {
      Default: 0,
      InCenter: 1,
      InCenterIfOutsideViewport: 2,
      AtTop: 3,
    },
    CodeActionKind: {
      Empty: { value: "" },
      QuickFix: { value: "quickfix" },
      Refactor: { value: "refactor" },
      Source: { value: "source" },
    },
    CompletionItemKind: { Text: 0, Method: 1, Function: 2, Snippet: 14, File: 16 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    LogLevel: { Off: 0, Trace: 1, Debug: 2, Info: 3, Warning: 4, Error: 5 },
    EndOfLine: { LF: 1, CRLF: 2 },
    l10n: { t: (message, ...args) => String(message).replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? "")) },
    NotebookCellOutputItem: class NotebookCellOutputItem {
      constructor(data, mime) {
        this.data = data;
        this.mime = mime;
      }
      static error(error) {
        const payload = { name: error?.name, message: error?.message, stack: error?.stack };
        return new NotebookCellOutputItem(
          new TextEncoder().encode(JSON.stringify(payload)),
          "application/vnd.code.notebook.error",
        );
      }
      static stdout(value) {
        return new NotebookCellOutputItem(
          new TextEncoder().encode(value),
          "application/vnd.code.notebook.stdout",
        );
      }
      static stderr(value) {
        return new NotebookCellOutputItem(
          new TextEncoder().encode(value),
          "application/vnd.code.notebook.stderr",
        );
      }
      static text(value, mime = "text/plain") {
        return new NotebookCellOutputItem(new TextEncoder().encode(value), mime);
      }
      static json(value, mime = "text/x-json") {
        return new NotebookCellOutputItem(
          new TextEncoder().encode(JSON.stringify(value)),
          mime,
        );
      }
    },
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    UIKind: { Desktop: 1, Web: 2 },

    commands: {
      registerCommand(id, callback, thisArg) {
        commandRegistry.set(id, thisArg ? callback.bind(thisArg) : callback);
        notify("commands.register", { id });
        return new Disposable(() => {
          commandRegistry.delete(id);
          notify("commands.unregister", { id });
        });
      },
      registerTextEditorCommand(id, callback, thisArg) {
        return api.commands.registerCommand(id, callback, thisArg);
      },
      executeCommand(id, ...args) {
        const local = commandRegistry.get(id);
        if (local) return Promise.resolve(local(...args));
        return rpc("commands.execute", { id, args });
      },
      getCommands() {
        return Promise.resolve([...commandRegistry.keys()]);
      },
    },

    window: {
      get activeTextEditor() {
        return activeEditor;
      },
      visibleTextEditors: [],
      onDidChangeActiveTextEditor: onDidChangeActiveTextEditor.event,
      onDidChangeTextEditorSelection: onDidChangeTextEditorSelection.event,
      showInformationMessage: (message, ...items) =>
        rpc("window.showMessage", { level: "info", message, items: flatItems(items) }),
      showWarningMessage: (message, ...items) =>
        rpc("window.showMessage", { level: "warn", message, items: flatItems(items) }),
      showErrorMessage: (message, ...items) =>
        rpc("window.showMessage", { level: "error", message, items: flatItems(items) }),
      showQuickPick: (items, options) => rpc("window.showQuickPick", { items, options }),
      showInputBox: (options) => rpc("window.showInputBox", { options }),
      showTextDocument: (document, options) =>
        rpc("window.showTextDocument", { uri: String(document?.uri ?? document), options }),
      createOutputChannel(name) {
        // `{ log: true }` asks for a LogOutputChannel; giving every channel the
        // log methods keeps both shapes working.
        const write = (value) => notify("output.append", { name, value });
        const line = (level, parts) =>
          write(`[${level}] ${parts.map((p) => (typeof p === "string" ? p : safeStringify(p))).join(" ")}\n`);
        return {
          name,
          logLevel: 3,
          onDidChangeLogLevel: new EventEmitter().event,
          append: write,
          appendLine: (value) => write(`${value}\n`),
          replace: (value) => notify("output.replace", { name, value }),
          clear: () => notify("output.clear", { name }),
          show: () => notify("output.show", { name }),
          hide: () => {},
          trace: (...parts) => line("trace", parts),
          debug: (...parts) => line("debug", parts),
          info: (...parts) => line("info", parts),
          warn: (...parts) => line("warn", parts),
          error: (...parts) => line("error", parts),
          dispose: () => {},
        };
      },
      createStatusBarItem(alignment, priority) {
        const id = `status-${nextRpcId++}`;
        const item = {
          id,
          alignment,
          priority,
          text: "",
          tooltip: "",
          command: undefined,
          show: () => notify("statusBar.show", { id, text: item.text, tooltip: item.tooltip, command: item.command }),
          hide: () => notify("statusBar.hide", { id }),
          dispose: () => notify("statusBar.hide", { id }),
        };
        return item;
      },
      registerWebviewViewProvider(viewId, provider, options) {
        webviewProviders.set(viewId, { provider, options });
        notify("webview.registerProvider", { viewId });
        return new Disposable(() => {
          webviewProviders.delete(viewId);
          resolvedViews.delete(viewId);
        });
      },
      withProgress(_options, task) {
        return Promise.resolve(
          task({ report() {} }, { isCancellationRequested: false, onCancellationRequested: new EventEmitter().event }),
        );
      },
      setStatusBarMessage: (text) => {
        notify("statusBar.message", { text });
        return new Disposable(() => {});
      },
      createTerminal: (options) => {
        const id = `terminal-${nextRpcId++}`;
        notify("terminal.create", { id, options: normalizeTerminalOptions(options) });
        return {
          name: typeof options === "string" ? options : (options?.name ?? "Extension"),
          sendText: (text, addNewLine = true) =>
            notify("terminal.sendText", { id, text, addNewLine }),
          show: () => notify("terminal.show", { id }),
          hide: () => {},
          dispose: () => notify("terminal.dispose", { id }),
        };
      },
      terminals: [],
      activeTerminal: undefined,
      onDidOpenTerminal: new EventEmitter().event,
      onDidCloseTerminal: new EventEmitter().event,
      onDidChangeActiveTerminal: new EventEmitter().event,
      onDidChangeTerminalState: new EventEmitter().event,
      onDidChangeVisibleTextEditors: new EventEmitter().event,
      onDidChangeWindowState: new EventEmitter().event,
      onDidChangeTextEditorVisibleRanges: new EventEmitter().event,
      onDidChangeActiveColorTheme: new EventEmitter().event,
      activeColorTheme: { kind: 2 },
      state: { focused: true, active: true },
      registerUriHandler: () => new Disposable(() => {}),
      registerWebviewPanelSerializer: () => new Disposable(() => {}),
      registerFileDecorationProvider: () => new Disposable(() => {}),
      registerTerminalProfileProvider: () => new Disposable(() => {}),
      registerCustomEditorProvider: () => new Disposable(() => {}),
      registerTreeDataProvider: () => new Disposable(() => {}),
      createTreeView: () => ({
        onDidChangeVisibility: new EventEmitter().event,
        onDidChangeSelection: new EventEmitter().event,
        visible: false,
        dispose() {},
      }),
      createTextEditorDecorationType: () => ({ key: `decoration-${nextRpcId++}`, dispose() {} }),
      createWebviewPanel: (viewType, title) => makeWebviewPanel(viewType, title),
      showSaveDialog: (options) => rpc("window.showSaveDialog", { options }),
      showOpenDialog: (options) => rpc("window.showOpenDialog", { options }),
      showWorkspaceFolderPick: () => Promise.resolve(undefined),
      tabGroups: {
        all: [],
        activeTabGroup: { tabs: [], isActive: true, viewColumn: 1 },
        onDidChangeTabs: new EventEmitter().event,
        onDidChangeTabGroups: new EventEmitter().event,
        close: () => Promise.resolve(true),
      },
    },

    workspace: {
      get workspaceFolders() {
        return context.workspaceRoot
          ? [{ uri: Uri.file(context.workspaceRoot), name: path.basename(context.workspaceRoot), index: 0 }]
          : undefined;
      },
      get rootPath() {
        return context.workspaceRoot ?? undefined;
      },
      name: context.workspaceRoot ? path.basename(context.workspaceRoot) : undefined,
      onDidChangeWorkspaceFolders: onDidChangeWorkspaceFolders.event,
      onDidOpenTextDocument: onDidOpenTextDocument.event,
      onDidCloseTextDocument: onDidCloseTextDocument.event,
      onDidSaveTextDocument: onDidSaveTextDocument.event,
      onDidChangeTextDocument: new EventEmitter().event,
      onDidChangeConfiguration: onDidChangeConfiguration.event,
      textDocuments: [],
      getConfiguration(section) {
        const values = context.configuration ?? {};
        const prefix = section ? `${section}.` : "";
        return {
          get(key, fallback) {
            const value = values[`${prefix}${key}`];
            return value === undefined ? fallback : value;
          },
          has: (key) => `${prefix}${key}` in values,
          inspect: () => undefined,
          update: (key, value) =>
            rpc("workspace.updateConfiguration", { key: `${prefix}${key}`, value }),
        };
      },
      openTextDocument: (target) => rpc("workspace.openTextDocument", { target: String(target?.fsPath ?? target) }),
      asRelativePath: (target) => {
        const p = String(target?.fsPath ?? target);
        return context.workspaceRoot && p.startsWith(context.workspaceRoot)
          ? p.slice(context.workspaceRoot.length + 1)
          : p;
      },
      registerFileSystemProvider: () => new Disposable(() => {}),
      registerTextDocumentContentProvider: () => new Disposable(() => {}),
      registerNotebookSerializer: () => new Disposable(() => {}),
      onWillSaveTextDocument: new EventEmitter().event,
      onDidCreateFiles: new EventEmitter().event,
      onDidDeleteFiles: new EventEmitter().event,
      onDidRenameFiles: new EventEmitter().event,
      onWillRenameFiles: new EventEmitter().event,
      applyEdit: () => Promise.resolve(true),
      saveAll: () => Promise.resolve(true),
      findFiles: () => Promise.resolve([]),
      getWorkspaceFolder: () =>
        context.workspaceRoot
          ? { uri: Uri.file(context.workspaceRoot), name: path.basename(context.workspaceRoot), index: 0 }
          : undefined,
      isTrusted: true,
      onDidGrantWorkspaceTrust: new EventEmitter().event,
      notebookDocuments: [],
      createFileSystemWatcher: () => ({
        onDidCreate: new EventEmitter().event,
        onDidChange: new EventEmitter().event,
        onDidDelete: new EventEmitter().event,
        dispose() {},
      }),
      fs: {
        readFile: async (uri) => new Uint8Array(fs.readFileSync(uri.fsPath ?? uri)),
        writeFile: async (uri, content) => fs.writeFileSync(uri.fsPath ?? uri, Buffer.from(content)),
        stat: async (uri) => {
          const s = fs.statSync(uri.fsPath ?? uri);
          return { type: s.isDirectory() ? 2 : 1, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size };
        },
        createDirectory: async (uri) => fs.mkdirSync(uri.fsPath ?? uri, { recursive: true }),
        delete: async (uri) => fs.rmSync(uri.fsPath ?? uri, { recursive: true, force: true }),
        readDirectory: async (uri) =>
          fs.readdirSync(uri.fsPath ?? uri, { withFileTypes: true }).map((e) => [e.name, e.isDirectory() ? 2 : 1]),
      },
    },

    languages: {
      createDiagnosticCollection: (name) => ({
        name,
        set() {},
        delete() {},
        clear() {},
        dispose() {},
      }),
      registerCodeLensProvider: () => new Disposable(() => {}),
      registerHoverProvider: () => new Disposable(() => {}),
      registerCompletionItemProvider: () => new Disposable(() => {}),
      registerCodeActionsProvider: () => new Disposable(() => {}),
      registerDefinitionProvider: () => new Disposable(() => {}),
      registerDocumentLinkProvider: () => new Disposable(() => {}),
      registerInlineCompletionItemProvider: () => new Disposable(() => {}),
      registerDocumentFormattingEditProvider: () => new Disposable(() => {}),
      onDidChangeDiagnostics: new EventEmitter().event,
      match: () => 0,
      getDiagnostics: () => [],
    },

    env: {
      appName: "DCode-IDE",
      appHost: "desktop",
      uriScheme: "dcode",
      language: "en",
      machineId: context.machineId ?? "dcode",
      sessionId: `dcode-${process.pid}`,
      uiKind: 1,
      clipboard: {
        readText: () => rpc("env.clipboardRead", {}),
        writeText: (value) => rpc("env.clipboardWrite", { value }),
      },
      openExternal: (uri) => rpc("env.openExternal", { uri: String(uri) }),
      asExternalUri: (uri) => Promise.resolve(uri),
      appRoot: context.extensionPath ?? "",
      remoteName: undefined,
      isNewAppInstall: false,
      isTelemetryEnabled: false,
      onDidChangeTelemetryEnabled: new EventEmitter().event,
      shell: process.env.SHELL ?? process.env.ComSpec ?? "",
    },

    extensions: {
      getExtension: () => undefined,
      all: [],
      onDidChange: new EventEmitter().event,
    },
  };

  return api;
}

function flatItems(items) {
  const flat = items.flat();
  return flat.map((item) => (typeof item === "string" ? item : (item?.title ?? String(item))));
}

function normalizeTerminalOptions(options) {
  if (typeof options === "string") return { name: options };
  if (!options) return {};
  return {
    name: options.name,
    cwd: options.cwd ? String(options.cwd.fsPath ?? options.cwd) : undefined,
    shellPath: options.shellPath,
    shellArgs: options.shellArgs,
    env: options.env,
  };
}

const webviewProviders = new Map();
const webviewPanels = new Map();
const resolvedViews = new Map();

/**
 * Where the app serves extension files from. Set at activation because the
 * form differs per platform (`http://dcode-webview.localhost/` on Windows,
 * `dcode-webview://localhost/` elsewhere).
 */
let webviewUrlPrefix = null;

function setWebviewUrlPrefix(prefix) {
  webviewUrlPrefix = String(prefix);
}

/** Origin extensions name in their own CSP through `webview.cspSource`. */
function webviewCspSource() {
  if (!webviewUrlPrefix) return "dcode-resource:";
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(webviewUrlPrefix);
  return match ? match[0] : webviewUrlPrefix;
}

/**
 * Local files an extension references become real URLs on the webview origin.
 * A webview builds these at runtime as well as in its HTML (image sources in
 * bundled data, for instance), so they have to be loadable as they are.
 */
function asWebviewUri(uri) {
  const fsPath = String(uri?.fsPath ?? uri?.path ?? uri);
  const href = webviewUrlPrefix
    ? `${webviewUrlPrefix}${encodeURIComponent(fsPath)}`
    : `dcode-resource:${fsPath}`;
  return {
    scheme: webviewUrlPrefix ? "https" : "dcode-resource",
    path: fsPath,
    fsPath,
    toString: () => href,
    toJSON: () => href,
  };
}

function makeWebview(viewId) {
  const onDidReceiveMessage = new EventEmitter();
  const webview = {
    options: {},
    cspSource: webviewCspSource(),
    onDidReceiveMessage: onDidReceiveMessage.event,
    postMessage: (message) => {
      notify("webview.postMessage", { viewId, message });
      return Promise.resolve(true);
    },
    asWebviewUri,
    _receive: (message) => onDidReceiveMessage.fire(message),
  };
  Object.defineProperty(webview, "html", {
    get: () => webview._html ?? "",
    set: (value) => {
      webview._html = value;
      notify("webview.setHtml", { viewId, html: value });
    },
  });
  return webview;
}

/** Runs the extension's `resolveWebviewView`, which is what fills in the HTML. */
async function resolveWebviewView(viewId) {
  const entry = webviewProviders.get(viewId);
  if (!entry) throw new Error(`no webview provider for ${viewId}`);
  const existing = resolvedViews.get(viewId);
  if (existing) {
    // Already live: re-announce the HTML so a remounted panel repaints.
    if (existing.webview._html) {
      notify("webview.setHtml", { viewId, html: existing.webview._html });
    }
    return;
  }

  const onDidDispose = new EventEmitter();
  const onDidChangeVisibility = new EventEmitter();
  const webview = makeWebview(viewId);
  const view = {
    viewType: viewId,
    webview,
    title: undefined,
    description: undefined,
    badge: undefined,
    visible: true,
    onDidDispose: onDidDispose.event,
    onDidChangeVisibility: onDidChangeVisibility.event,
    _setVisible: (next) => {
      if (view.visible === next) return;
      view.visible = next;
      onDidChangeVisibility.fire();
    },
    show: () => notify("webview.show", { viewId }),
    dispose: () => {
      resolvedViews.delete(viewId);
      onDidDispose.fire();
    },
  };
  resolvedViews.set(viewId, view);

  const token = {
    isCancellationRequested: false,
    onCancellationRequested: new EventEmitter().event,
  };
  await entry.provider.resolveWebviewView(view, { state: undefined }, token);
}

/** A webview the app renders in an iframe; messages are relayed both ways. */
function makeWebviewPanel(viewType, title) {
  const id = `webview-${nextRpcId++}`;
  const onDidReceiveMessage = new EventEmitter();
  const onDidDispose = new EventEmitter();
  const onDidChangeViewState = new EventEmitter();
  const panel = {
    id,
    viewType,
    title,
    visible: true,
    active: true,
    viewColumn: 1,
    options: {},
    webview: {
      options: {},
      html: "",
      cspSource: webviewCspSource(),
      onDidReceiveMessage: onDidReceiveMessage.event,
      postMessage: (message) => rpc("webview.postMessage", { id, message }),
      asWebviewUri,
      _receive: (message) => onDidReceiveMessage.fire(message),
    },
    onDidDispose: onDidDispose.event,
    onDidChangeViewState: onDidChangeViewState.event,
    reveal: () => notify("webview.reveal", { id }),
    dispose: () => {
      webviewPanels.delete(id);
      onDidDispose.fire();
      notify("webview.dispose", { id });
    },
  };
  // The app needs the html whenever the extension sets it.
  Object.defineProperty(panel.webview, "html", {
    get: () => panel.webview._html ?? "",
    set: (value) => {
      panel.webview._html = value;
      notify("webview.setHtml", { id, html: value });
    },
  });
  webviewPanels.set(id, panel);
  notify("webview.createPanel", { id, viewType, title });
  return panel;
}
let activeEditor;

/** Mutations are collected so the app can apply them to terminals it spawns. */
function makeEnvironmentVariableCollection() {
  const entries = new Map();
  const collection = {
    persistent: true,
    description: undefined,
    get: (name) => entries.get(name),
    replace: (name, value) => {
      entries.set(name, { value, type: 1 });
      notify("env.collectionChanged", { name, value, type: 1 });
    },
    append: (name, value) => {
      entries.set(name, { value, type: 2 });
      notify("env.collectionChanged", { name, value, type: 2 });
    },
    prepend: (name, value) => {
      entries.set(name, { value, type: 3 });
      notify("env.collectionChanged", { name, value, type: 3 });
    },
    forEach: (callback, thisArg) => {
      for (const [name, mutator] of entries) {
        callback.call(thisArg, name, mutator, collection);
      }
    },
    delete: (name) => {
      entries.delete(name);
      notify("env.collectionChanged", { name, value: null, type: 0 });
    },
    clear: () => {
      entries.clear();
      notify("env.collectionCleared", {});
    },
    getScoped: () => collection,
    [Symbol.iterator]: () => entries.entries(),
  };
  return collection;
}

// -------------------------------------------------------------- activation

let extensionModule = null;
let vscodeApi = null;

async function activate(payload) {
  const { extensionPath, main, workspaceRoot, storagePath, configuration } = payload;
  if (payload.webviewUrlPrefix) setWebviewUrlPrefix(payload.webviewUrlPrefix);
  const context = { workspaceRoot, configuration };
  vscodeApi = buildVscodeModule(context);

  // `require("vscode")` must resolve to the shim before the extension loads.
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") return vscodeApi;
    return originalLoad.call(this, request, parent, isMain);
  };

  const entry = path.isAbsolute(main) ? main : path.join(extensionPath, main);
  if (!fs.existsSync(entry)) {
    throw new Error(`extension entry not found: ${entry}`);
  }

  const requireFromExtension = createRequire(entry);
  extensionModule = requireFromExtension(entry);

  const extensionContext = {
    subscriptions: [],
    extensionPath,
    extensionUri: Uri.file(extensionPath),
    storagePath,
    globalStoragePath: storagePath,
    storageUri: Uri.file(storagePath),
    globalStorageUri: Uri.file(storagePath),
    logUri: Uri.file(path.join(storagePath, "logs")),
    extensionMode: 1,
    environmentVariableCollection: makeEnvironmentVariableCollection(),
    globalState: memento("globalState", path.join(storagePath, "global-state.json")),
    workspaceState: memento("workspaceState", path.join(storagePath, "workspace-state.json")),
    secrets: {
      get: (key) => rpc("secrets.get", { key }),
      store: (key, value) => rpc("secrets.store", { key, value }),
      delete: (key) => rpc("secrets.delete", { key }),
      onDidChange: new EventEmitter().event,
    },
    asAbsolutePath: (relative) => path.join(extensionPath, relative),
    extension: { id: payload.extensionId, packageJSON: payload.packageJSON ?? {} },
  };

  if (typeof extensionModule.activate === "function") {
    await extensionModule.activate(extensionContext);
  }
  return { commands: [...commandRegistry.keys()] };
}

async function deactivate() {
  if (typeof extensionModule?.deactivate === "function") {
    await extensionModule.deactivate();
  }
}

// ------------------------------------------------------------ message loop

async function handle(message) {
  switch (message.type) {
    case "activate": {
      try {
        const result = await activate(message.payload);
        send({ type: "activated", extensionId: message.payload.extensionId, ...result });
      } catch (error) {
        send({
          type: "activationFailed",
          extensionId: message.payload?.extensionId,
          message: String(error?.stack ?? error),
        });
      }
      break;
    }
    case "deactivate": {
      try {
        await deactivate();
      } catch (error) {
        log("warn", `deactivate threw: ${error?.stack ?? error}`);
      }
      send({ type: "deactivated" });
      break;
    }
    case "executeCommand": {
      const handler = commandRegistry.get(message.id);
      if (!handler) {
        send({ type: "commandResult", requestId: message.requestId, error: `no command ${message.id}` });
        break;
      }
      try {
        const result = await handler(...(message.args ?? []));
        send({ type: "commandResult", requestId: message.requestId, result: result ?? null });
      } catch (error) {
        send({ type: "commandResult", requestId: message.requestId, error: String(error?.stack ?? error) });
      }
      break;
    }
    case "rpcResult": {
      const pending = pendingRpc.get(message.id);
      if (!pending) break;
      pendingRpc.delete(message.id);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
      break;
    }
    case "resolveWebview": {
      try {
        await resolveWebviewView(message.viewId);
        send({ type: "webviewResolved", viewId: message.viewId });
      } catch (error) {
        send({
          type: "webviewFailed",
          viewId: message.viewId,
          message: String(error?.stack ?? error),
        });
      }
      break;
    }
    case "webviewMessage": {
      const view = resolvedViews.get(message.viewId);
      if (view) {
        view.webview._receive(message.message);
        break;
      }
      const panel = webviewPanels.get(message.viewId);
      panel?.webview._receive(message.message);
      break;
    }
    case "webviewVisibility": {
      const view = resolvedViews.get(message.viewId);
      view?._setVisible(Boolean(message.visible));
      break;
    }
    case "ping": {
      send({ type: "pong" });
      break;
    }
    default:
      log("warn", `unknown message type: ${message.type}`);
  }
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf(FRAME_SEPARATOR);
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + FRAME_SEPARATOR.length);
      continue;
    }
    const length = Number.parseInt(match[1], 10);
    const bodyStart = headerEnd + FRAME_SEPARATOR.length;
    if (buffer.length < bodyStart + length) return;
    const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
    buffer = buffer.subarray(bodyStart + length);
    try {
      void handle(JSON.parse(body));
    } catch (error) {
      log("error", `bad frame: ${error?.message ?? error}`);
    }
  }
});

process.on("uncaughtException", (error) => {
  log("error", `uncaught: ${error?.stack ?? error}`);
});
process.on("unhandledRejection", (reason) => {
  log("error", `unhandled rejection: ${reason?.stack ?? reason}`);
});

send({ type: "ready", node: process.version });
