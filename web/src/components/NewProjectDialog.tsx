import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/api";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "./ui/dialog";

/** Create a project (optionally with its GitHub repo) or import one by clone.
 *  Standalone twin of the dialog embedded in the Home composer. */
export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (projectPath: string) => void;
}) {
  const [tab, setTab] = useState<"create" | "import">("create");
  const [name, setName] = useState("");
  const [repo, setRepo] = useState(true);
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<
    { nameWithOwner: string; description: string; url: string }[] | null
  >(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open && tab === "import" && repos === null) {
      api
        .githubRepos()
        .then(({ repos }) => setRepos(repos))
        .catch((e) => {
          setRepos([]);
          setError(String(e).replace(/^Error:\s*\d*:?\s*/, ""));
        });
    }
  }, [open, tab, repos]);

  const finish = (p: { path: string }) => {
    onOpenChange(false);
    setName("");
    setError(null);
    onCreated(p.path);
  };

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { project } = await api.createProject({
        name: name.trim(),
        createRepo: repo,
        isPrivate,
      });
      finish(project);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*\d*:?\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const importRepo = async (r: { url: string }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { project } = await api.createProject({ cloneUrl: r.url });
      finish(project);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*\d*:?\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setError(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="flex gap-1 rounded-lg bg-accent/50 p-1 text-xs font-medium">
            {(["create", "import"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex-1 rounded-md py-1.5 transition-colors",
                  tab === t ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t === "create" ? "Create" : "Import from GitHub"}
              </button>
            ))}
          </div>
          <div className="mt-3 space-y-3">
            {tab === "create" ? (
              <>
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && create()}
                  placeholder="project-name"
                />
                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <Checkbox checked={repo} onCheckedChange={(c) => setRepo(c === true)} />
                  Create the GitHub repo
                </label>
                {repo && (
                  <label className="flex cursor-pointer items-center gap-2.5 pl-6 text-sm text-muted-foreground">
                    <Checkbox checked={isPrivate} onCheckedChange={(c) => setIsPrivate(c === true)} />
                    Private
                  </label>
                )}
                {error && <p className="text-xs text-destructive">{error}</p>}
              </>
            ) : (
              <>
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter your repos…"
                />
                <div className="max-h-60 space-y-0.5 overflow-y-auto">
                  {repos === null && (
                    <p className="py-4 text-center text-xs text-muted-foreground">Loading…</p>
                  )}
                  {(repos ?? [])
                    .filter((r) => r.nameWithOwner.toLowerCase().includes(query.toLowerCase()))
                    .map((r) => (
                      <button
                        key={r.nameWithOwner}
                        disabled={busy}
                        onClick={() => importRepo(r)}
                        className="flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left hover:bg-accent/60 disabled:opacity-50"
                      >
                        <span className="text-[13px] font-medium">{r.nameWithOwner}</span>
                        <span className="line-clamp-1 text-xs text-muted-foreground">
                          {busy ? "Cloning…" : r.description || " "}
                        </span>
                      </button>
                    ))}
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
              </>
            )}
          </div>
        </DialogPanel>
        {tab === "create" && (
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!name.trim() || busy} onClick={create}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
