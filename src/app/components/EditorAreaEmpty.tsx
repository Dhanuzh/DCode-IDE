import { Kbd } from "@/components/ui/kbd";
import { type ShortcutId, useShortcutLabel } from "@/modules/shortcuts";

export type EditorAreaAction = {
  id: ShortcutId;
  label: string;
  run: () => void;
};

/** Watermark for an editor area with no open editors, VS Code style. */
export function EditorAreaEmpty({ actions }: { actions: EditorAreaAction[] }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="flex w-full max-w-xs flex-col gap-1">
        {actions.map((action) => (
          <ActionRow key={action.id} action={action} />
        ))}
      </div>
    </div>
  );
}

function ActionRow({ action }: { action: EditorAreaAction }) {
  const keys = useShortcutLabel(action.id);
  return (
    <button
      type="button"
      onClick={action.run}
      className="flex items-center justify-between gap-4 rounded-md px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
    >
      <span className="truncate">{action.label}</span>
      {keys ? <Kbd className="shrink-0">{keys}</Kbd> : null}
    </button>
  );
}
