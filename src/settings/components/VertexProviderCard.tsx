import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ProviderInfo } from "@/modules/ai/config";
import {
  ArrowUpRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { ProviderIcon } from "./ProviderIcon";

type VertexLoginResult = { refreshToken: string; email: string };

type Props = {
  provider: ProviderInfo;
  refreshToken: string | null;
  projectId: string;
  location: string;
  accountEmail: string;
  onSignIn: (refreshToken: string, email: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  onProjectIdChange: (v: string) => Promise<void>;
  onLocationChange: (v: string) => Promise<void>;
  onRemove: () => void;
};

export function VertexProviderCard({
  provider,
  refreshToken,
  projectId,
  location,
  accountEmail,
  onSignIn,
  onSignOut,
  onProjectIdChange,
  onLocationChange,
  onRemove,
}: Props) {
  const [projectDraft, setProjectDraft] = useState(projectId);
  const [locationDraft, setLocationDraft] = useState(location);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setProjectDraft(projectId), [projectId]);
  useEffect(() => setLocationDraft(location), [location]);

  const signIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      const result = await invoke<VertexLoginResult>("vertex_oauth_login");
      await onSignIn(result.refreshToken, result.email);
    } catch (e) {
      setError(`Sign-in failed: ${String(e)}`);
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <ProviderIcon provider={provider.id} size={15} />
        <span className="text-[12.5px] font-medium">{provider.label}</span>
        {refreshToken ? (
          <Badge
            variant="outline"
            className="ml-1 h-4 gap-1 border-border/60 bg-muted/40 px-1.5 text-[10px] font-normal text-muted-foreground"
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={9}
              strokeWidth={2}
            />
            Connected
          </Badge>
        ) : null}
        <button
          type="button"
          onClick={() => void openUrl(provider.consoleUrl)}
          className="ml-auto inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Console
          <HugeiconsIcon
            icon={ArrowUpRight01Icon}
            size={11}
            strokeWidth={1.75}
          />
        </button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onRemove}
          title="Remove provider"
          className="size-7 text-muted-foreground hover:text-destructive"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </Button>
      </div>

      <span className="text-[10.5px] leading-relaxed text-muted-foreground">
        Sign in with the Google account that has Vertex AI access on your GCP
        project. Model calls run against your project's own quota and
        billing.
      </span>

      <div className="mt-0.5 flex flex-col gap-2.5">
        <FieldRow label="Project ID">
          <Input
            value={projectDraft}
            onChange={(e) => setProjectDraft(e.target.value)}
            onBlur={() => {
              const v = projectDraft.trim();
              if (v !== projectId) void onProjectIdChange(v);
            }}
            placeholder="my-gcp-project"
            spellCheck={false}
            className="h-8 font-mono text-[11.5px]"
          />
        </FieldRow>

        <FieldRow label="Location">
          <Input
            value={locationDraft}
            onChange={(e) => setLocationDraft(e.target.value)}
            onBlur={() => {
              const v = locationDraft.trim();
              if (v !== location) void onLocationChange(v);
            }}
            placeholder="us-central1"
            spellCheck={false}
            className="h-8 font-mono text-[11.5px]"
          />
        </FieldRow>

        {refreshToken ? (
          <div className="flex items-center gap-1.5">
            <code className="flex-1 truncate rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {accountEmail ? `Signed in as ${accountEmail}` : "Signed in"}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onSignOut()}
              className="h-8 px-3 text-[11px]"
            >
              Sign out
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            onClick={() => void signIn()}
            disabled={signingIn}
            className="h-8 gap-1.5 px-3 text-[11px]"
          >
            {signingIn ? <Spinner className="size-3" /> : null}
            Sign in with Google
          </Button>
        )}

        {error ? (
          <p className="text-[10.5px] text-destructive">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] tracking-tight text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-1 items-center">{children}</div>
    </div>
  );
}
