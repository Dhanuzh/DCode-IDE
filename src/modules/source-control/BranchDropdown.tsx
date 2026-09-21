import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { type GitBranchEntry, native } from "@/modules/ai/lib/native";
import {
  Folder01Icon,
  FolderGitTwoIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SourceControlRepositoryTarget } from "./repositoryTarget";
import { basename } from "./sourceControlShared";

export function BranchDropdown({
  repoRoot,
  repoLabel,
  displayRepoRoot,
  repositoryTarget,
  onFollowRepositoryContext,
  onNavigateToPath,
  onRefresh,
}: {
  repoRoot: string | null;
  repoLabel: string;
  displayRepoRoot: string | null;
  repositoryTarget: SourceControlRepositoryTarget;
  onFollowRepositoryContext: () => void;
  onNavigateToPath?: (path: string) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const requestRef = useRef(0);
  const checkoutInFlight = useRef(false);

  const loadBranches = useCallback(async () => {
    const id = ++requestRef.current;
    if (!repoRoot) {
      setBranches([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await native.gitListBranches(repoRoot);
      if (id !== requestRef.current) return;
      setBranches(result.branches);
    } catch (e) {
      if (id !== requestRef.current) return;
      setError(String(e));
      setBranches([]);
    } finally {
      if (id === requestRef.current) {
        setLoading(false);
      }
    }
  }, [repoRoot]);

  useEffect(() => {
    if (open) {
      void loadBranches();
    }
  }, [open, loadBranches]);

  const handleCheckout = useCallback(
    async (branch: string) => {
      if (!repoRoot || checkoutInFlight.current) return;
      checkoutInFlight.current = true;
      setCheckingOut(true);
      try {
        await native.gitCheckoutBranch(repoRoot, branch);
        setBranches([]);
        setOpen(false);
        onRefresh();
      } catch (e) {
        toast.error(String(e));
      } finally {
        checkoutInFlight.current = false;
        setCheckingOut(false);
      }
    },
    [repoRoot, onRefresh],
  );

  const localBranches = useMemo(
    () => branches.filter((b) => b.kind === "local"),
    [branches],
  );
  const worktrees = useMemo(
    () => branches.filter((b) => b.kind === "worktree"),
    [branches],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={checkingOut}
          title={displayRepoRoot ?? repoLabel}
          className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md bg-foreground/5 px-2 py-1 text-[11.5px] font-medium leading-none text-foreground transition-colors hover:bg-foreground/10 disabled:cursor-default disabled:opacity-70"
        >
          <HugeiconsIcon
            icon={FolderGitTwoIcon}
            size={12}
            strokeWidth={1.9}
            className="shrink-0 text-muted-foreground"
          />
          {displayRepoRoot ? (
            <>
              <span className="max-w-22 truncate">
                {basename(displayRepoRoot)}
              </span>
              <span className="text-muted-foreground/60">/</span>
            </>
          ) : null}
          <span className="max-w-24 truncate">{repoLabel}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {displayRepoRoot ? (
          <>
            <DropdownMenuLabel className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/85">
              Repository
            </DropdownMenuLabel>
            <div
              className="truncate px-2 pb-1.5 text-[11px] text-muted-foreground"
              title={displayRepoRoot}
            >
              {displayRepoRoot}
            </div>
            {repositoryTarget.mode === "fixed" ? (
              <DropdownMenuItem
                onSelect={() => {
                  onFollowRepositoryContext();
                  setOpen(false);
                }}
                className="cursor-pointer text-[12px]"
              >
                Follow Active Context
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
          </>
        ) : null}
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
            <Spinner className="size-3" />
            Loading branches…
          </div>
        ) : error ? (
          <div className="px-3 py-3 text-[11px] leading-snug text-destructive">
            {error}
          </div>
        ) : (
          <>
            {localBranches.length > 0 && (
              <>
                <DropdownMenuLabel className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/85">
                  Local Branches
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  {localBranches.map((b) => (
                    <DropdownMenuItem
                      key={b.name}
                      onSelect={() => void handleCheckout(b.name)}
                      className="flex cursor-pointer items-center gap-2 text-[12px]"
                    >
                      {b.isHead ? (
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          size={14}
                          strokeWidth={1.8}
                          className="shrink-0"
                        />
                      ) : (
                        <span className="w-3.5 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            )}
            {worktrees.length > 0 && (
              <>
                {localBranches.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/85">
                  Worktrees
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  {worktrees.map((b) => (
                    <DropdownMenuItem
                      key={b.worktreePath ?? b.name}
                      onSelect={() => {
                        if (b.worktreePath && onNavigateToPath) {
                          onNavigateToPath(b.worktreePath);
                        }
                      }}
                      className="flex cursor-pointer items-center gap-2 text-[12px]"
                    >
                      <HugeiconsIcon
                        icon={Folder01Icon}
                        size={14}
                        strokeWidth={1.5}
                        className="shrink-0 text-muted-foreground"
                      />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{b.name}</span>
                        {b.worktreePath && (
                          <span className="truncate text-[10px] text-muted-foreground">
                            {b.worktreePath}
                          </span>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            )}
            {branches.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-muted-foreground">
                No branches found.
              </div>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
