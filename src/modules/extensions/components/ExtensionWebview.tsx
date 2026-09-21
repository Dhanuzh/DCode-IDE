import { cn } from "@/lib/utils";
import { useTheme } from "@/modules/theme";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  rememberWebviewState,
  useExtHostStore,
  webviewState,
  type WebviewState,
} from "../host/extHostStore";
import {
  buildWebviewDocument,
  themeUpdateMessage,
  WEBVIEW_SCHEME,
  webviewFileUrl,
} from "../host/webviewHtml";
import { APP_THEME_TOKENS, type WebviewThemeInput } from "../host/webviewTheme";

/** Reads the app's live theme tokens off the document. */
function readThemeTokens(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement);
  const tokens: Record<string, string> = {};
  for (const name of APP_THEME_TOKENS) {
    const value = styles.getPropertyValue(`--${name}`).trim();
    if (value) tokens[name] = value;
  }
  return tokens;
}

type Props = {
  view: WebviewState;
  className?: string;
};

/**
 * Renders one extension webview and relays messages between it and the host.
 *
 * The document is served over the `dcode-webview` scheme rather than injected
 * as `srcdoc`: a sandboxed frame has an opaque origin, where `localStorage`
 * throws and `type="module"` scripts fail CORS - which is most real webviews.
 */
export function ExtensionWebview({ view, className }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const resolveWebview = useExtHostStore((s) => s.resolveWebview);
  const clearWebviewErrors = useExtHostStore((s) => s.clearWebviewErrors);
  const postToWebview = useExtHostStore((s) => s.postToWebview);
  const [src, setSrc] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const { resolvedMode, activeTheme } = useTheme();

  // Extension UIs are written against VS Code's `--vscode-*` variables; the
  // app's own tokens stand in for them, re-read whenever the theme changes.
  const theme = useMemo<WebviewThemeInput>(
    () => ({ tokens: readThemeTokens(), kind: resolvedMode }),
    [resolvedMode, activeTheme],
  );

  // Ask the extension to fill the view in the first time it is shown.
  useEffect(() => {
    if (view.html === null && !view.resolving && !view.error) {
      void resolveWebview(view.viewId);
    }
  }, [view.html, view.resolving, view.error, view.viewId, resolveWebview]);

  // Hand the rewritten document to the scheme handler, then point the frame at it.
  useEffect(() => {
    if (!view.html) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    // The webview's own saved state goes back in, so a rebuilt frame restores
    // what the extension had on screen instead of starting over.
    const document = buildWebviewDocument(
      view.html,
      webviewFileUrl,
      theme,
      webviewState(view.viewId),
    );
    void invoke("ext_host_set_webview_html", {
      viewId: view.viewId,
      html: document,
    })
      .then(() => {
        if (cancelled) return;
        setPublishError(null);
        // Cache-bust so a re-resolved view repaints instead of reusing the frame.
        setSrc(
          `${convertFileSrc(`__view__/${view.viewId}`, WEBVIEW_SCHEME)}?v=${Date.now()}`,
        );
      })
      .catch((error) => {
        if (!cancelled) setPublishError(String(error));
      });
    return () => {
      cancelled = true;
    };
    // The theme is applied to a mounted frame by the effect below, so it must
    // not re-publish the document (which would reload the extension's UI).
  }, [view.html, view.viewId]);

  // Live theme swap for an already mounted frame.
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage(
      themeUpdateMessage(theme),
      "*",
    );
  }, [theme]);

  // extension -> iframe
  useEffect(() => {
    const onHostMessage = (event: Event) => {
      const detail = (
        event as CustomEvent<{ viewId: string; message: unknown }>
      ).detail;
      if (detail.viewId !== view.viewId) return;
      frameRef.current?.contentWindow?.postMessage(
        { __dcodeHost: true, message: detail.message },
        "*",
      );
    };
    window.addEventListener("dcode:webview-message", onHostMessage);
    return () =>
      window.removeEventListener("dcode:webview-message", onHostMessage);
  }, [view.viewId]);

  // iframe -> extension
  useEffect(() => {
    const onFrameMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as {
        __dcodeWebview?: boolean;
        __dcodeWebviewError?: string;
        __dcodeWebviewState?: boolean;
        state?: unknown;
        message?: unknown;
      };
      if (data?.__dcodeWebviewState) {
        rememberWebviewState(view.viewId, data.state);
        return;
      }
      if (data?.__dcodeWebviewError) {
        useExtHostStore
          .getState()
          .noteWebviewError(view.viewId, data.__dcodeWebviewError);
        return;
      }
      if (!data?.__dcodeWebview) return;
      void postToWebview(view.viewId, data.message);
    };
    window.addEventListener("message", onFrameMessage);
    return () => window.removeEventListener("message", onFrameMessage);
  }, [view.viewId, postToWebview]);

  const error = view.error ?? publishError;
  if (error) {
    return (
      <div
        className={cn(
          "overflow-auto p-3 text-[11px] text-destructive",
          className,
        )}
      >
        {error}
      </div>
    );
  }

  if (!src) {
    return (
      <div
        className={cn(
          "flex items-center justify-center p-3 text-[11px] text-muted-foreground",
          className,
        )}
      >
        Loading {view.viewId}…
      </div>
    );
  }

  return (
    <div className={cn("relative h-full w-full", className)}>
      <iframe
        ref={frameRef}
        title={view.viewId}
        src={src}
        // The frame is a different origin than the app, so allow-same-origin
        // only grants it its own storage - not access to the app. The sandbox
        // still blocks it from navigating the top window.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        className="h-full w-full border-0 bg-transparent"
      />
      {view.runtimeErrors.length > 0 ? (
        <WebviewErrors
          errors={view.runtimeErrors}
          onDismiss={() => clearWebviewErrors(view.viewId)}
        />
      ) : null}
    </div>
  );
}

/**
 * A webview whose bundle failed to load renders nothing at all, so the page's
 * own failures are shown over the frame instead of leaving it blank.
 */
function WebviewErrors({
  errors,
  onDismiss,
}: {
  errors: string[];
  onDismiss: () => void;
}) {
  return (
    <div className="absolute inset-x-0 bottom-0 max-h-40 overflow-auto border-t border-red-500/40 bg-red-50/95 p-2 text-[10.5px] leading-relaxed text-red-900 dark:bg-red-950/90 dark:text-red-100">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-medium">This view reported errors</span>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto rounded px-1 underline-offset-2 hover:underline"
        >
          Dismiss
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {errors.map((error) => (
          <li key={error} className="break-all font-mono">
            {error}
          </li>
        ))}
      </ul>
    </div>
  );
}
