import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  GitBranchIcon,
  Folder01Icon,
  ArrowUp02Icon,
  PlusSignIcon,
  SquareLock02Icon,
  PencilEdit02Icon,
  SquareUnlock02Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { api, type ClaudeAccount, type Project } from "@/api";
import { HarnessIcon } from "./HarnessIcon";
import { HARNESSES } from "./HarnessAvatar";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "./ui/dialog";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select";

export const HARNESS_LABEL: Record<string, string> = {
  claude: "claude",
  shell: "shell",
  codex: "codex",
  opencode: "opencode",
  gemini: "gemini",
};

export const MODELS = ["default", "fable", "opus", "sonnet", "haiku"];

// the ui-kit trigger inflates to touch sizes below `sm` (text-base, min-h-8) —
// too big for the composer row on a phone; keep it as compact as desktop
const COMPACT_TRIGGER =
  "max-sm:min-h-7 max-sm:text-xs max-sm:[&_svg:not([class*='size-'])]:size-3.5";

// t3code-style permission modes; "default" sends no flag → claude's normal prompts
export const PERMISSION_MODES = [
  {
    value: "default",
    label: "Supervised",
    icon: SquareLock02Icon,
    desc: "Ask before commands and file changes",
  },
  {
    value: "acceptEdits",
    label: "Auto edits",
    icon: PencilEdit02Icon,
    desc: "Auto-approve edits, ask before the rest",
  },
  {
    value: "bypassPermissions",
    label: "Full access",
    icon: SquareUnlock02Icon,
    desc: "Run everything without prompts",
  },
];

export interface ComposerLaunchBody {
  projectPath?: string;
  text: string;
  model?: string;
  mode: string;
  harness: string;
}

/** The session composer: project/harness/model/mode selects + prompt textarea.
 *  Used full-page on Home (mobile) and inside the canvas "New session" dialog.
 *  `text` is controlled so the host can inject suggestion prompts. */
export function Composer({
  projects,
  onLaunch,
  onProjectsChanged,
  text,
  onTextChange,
  autoFocus = false,
  textareaRef: externalTextareaRef,
}: {
  projects: Project[];
  onLaunch: (body: ComposerLaunchBody) => Promise<void>;
  onProjectsChanged: () => void;
  text: string;
  onTextChange: (text: string) => void;
  autoFocus?: boolean;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [project, setProject] = useState<string>("");
  const [accounts, setAccounts] = useState<ClaudeAccount[]>([]);
  // which Claude identity this PROJECT's agents sign in as; "" = the default
  const [account, setAccount] = useState<string>("");
  // launching several agents onto ONE task is the common case, and doing it
  // one-by-one is how they ended up scattered across the project in the first
  // place: same frame, same channel, same brief, in one gesture
  const [count, setCount] = useState(1);
  const [harness, setHarness] = useState("claude");
  const [model, setModel] = useState("default");
  const [mode, setMode] = useState("bypassPermissions");
  const [launching, setLaunching] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newTab, setNewTab] = useState<"create" | "import">("create");
  const [newName, setNewName] = useState("");
  const [newRepo, setNewRepo] = useState(true);
  const [newPrivate, setNewPrivate] = useState(true);
  const [newBusy, setNewBusy] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);
  const [repos, setRepos] = useState<
    { nameWithOwner: string; description: string; url: string }[] | null
  >(null);
  const [repoQuery, setRepoQuery] = useState("");
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalTextareaRef ?? internalTextareaRef;

  // only the claude harness consumes the prompt/model/mode (as CLI args)
  const isClaude = harness === "claude";

  // default to the most recently listed project once the list arrives
  useEffect(() => {
    if (!project && projects.length) setProject(projects[0].name);
  }, [projects, project]);

  const selected = projects.find((p) => p.name === project);

  // The account is a property of the PROJECT, not of this form: load whatever
  // was chosen before, and write it back the moment it changes.
  useEffect(() => {
    let cancelled = false;
    api
      .listAccounts()
      .then(({ accounts, byProject }) => {
        if (cancelled) return;
        setAccounts(accounts);
        setAccount(selected?.path ? (byProject[selected.path] ?? "") : "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selected?.path]);

  /** agora cannot do the OAuth dance: it prepares an isolated config dir and
   *  opens a terminal pointed at it, where `claude` runs the real login. */
  const addAccount = async () => {
    const label = window.prompt(
      "Name this Claude account (e.g. Personal, Work) — a terminal will open for you to sign in.",
      ""
    );
    if (label === null || !label.trim()) return;
    try {
      const { account: created } = await api.createAccount(label.trim());
      setAccounts((a) => [...a, created]);
      await api.loginAccount(created.id);
      toast.success(`Terminal opened for ${created.label}`, {
        description: "Run `claude` in it and sign in; the tokens land in that account only.",
        duration: 12_000,
      });
      await chooseAccount(created.id);
    } catch (e) {
      toast.error("Could not add the account", { description: String(e) });
    }
  };

  const chooseAccount = async (id: string) => {
    if (!selected?.path) return;
    const previous = account;
    setAccount(id);
    try {
      await api.setProjectAccount(selected.path, id || null);
      const acc = accounts.find((a) => a.id === id);
      toast.success(
        `${selected.name} now signs in as ${acc?.label ?? "the default account"}`,
        { description: "Applies to the next session opened here; running agents keep theirs." }
      );
    } catch (e) {
      setAccount(previous);
      toast.error("Could not switch account", { description: String(e) });
    }
  };

  const launch = async () => {
    const t = text.trim();
    if (launching) return;
    setLaunching(true);
    try {
      // sequential, not Promise.all: each session picks its name from the ones
      // already taken, and a parallel burst would hand out the same one twice
      for (let i = 0; i < count; i++) {
        await onLaunch({
          projectPath: selected?.name,
          text: t,
          model: model === "default" ? undefined : model,
          mode,
          harness,
        });
      }
      onTextChange("");
    } finally {
      setLaunching(false);
    }
  };

  const importRepo = async (r: { nameWithOwner: string; url: string }) => {
    if (newBusy) return;
    setNewBusy(true);
    setNewError(null);
    try {
      const { project: p } = await api.createProject({ cloneUrl: r.url });
      onProjectsChanged();
      setProject(p.name);
      setNewOpen(false);
    } catch (e) {
      setNewError(String(e).replace(/^Error:\s*\d*:?\s*/, ""));
    } finally {
      setNewBusy(false);
    }
  };

  // load the GitHub repo list the first time the import tab opens
  useEffect(() => {
    if (newOpen && newTab === "import" && repos === null) {
      api
        .githubRepos()
        .then(({ repos }) => setRepos(repos))
        .catch((e) => {
          setRepos([]);
          setNewError(String(e).replace(/^Error:\s*\d*:?\s*/, ""));
        });
    }
  }, [newOpen, newTab, repos]);

  const createProject = async () => {
    if (!newName.trim() || newBusy) return;
    setNewBusy(true);
    setNewError(null);
    try {
      const { project: p } = await api.createProject({
        name: newName.trim(),
        createRepo: newRepo,
        isPrivate: newPrivate,
      });
      onProjectsChanged();
      setProject(p.name);
      setNewOpen(false);
      setNewName("");
    } catch (e) {
      setNewError(String(e).replace(/^Error:\s*\d*:?\s*/, ""));
    } finally {
      setNewBusy(false);
    }
  };

  return (
    <div className="group w-full rounded-[22px] p-px transition-colors duration-200">
      <div className="chat-composer-glass chat-composer-shared-blur rounded-[20px] border border-border transition-colors duration-200 has-focus-visible:border-ring/45">
        <div className="relative px-3 pb-2 pt-3.5 sm:px-4 sm:pt-4">
          <textarea
            ref={textareaRef}
            autoFocus={autoFocus}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                launch();
              }
            }}
            rows={3}
            placeholder={
              isClaude
                ? "Describe a task — Enter launches a claude session on it"
                : `Opens a ${HARNESS_LABEL[harness]} terminal — message optional`
            }
            className="w-full resize-none bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/80"
          />
        </div>

        <div className="flex min-w-0 flex-nowrap items-center justify-between gap-2 px-2.5 pb-2.5 sm:px-3 sm:pb-3">
          <div className="-m-1 flex min-w-0 flex-1 items-center gap-1 p-1 max-sm:flex-wrap sm:overflow-x-auto sm:[scrollbar-width:none] sm:[&::-webkit-scrollbar]:hidden">
            <Select
              value={project}
              onValueChange={(v) => v && (v === "__new" ? setNewOpen(true) : setProject(v))}
            >
              <SelectTrigger
                variant="ghost"
                size="sm"
                className={cn("max-w-[45%] font-medium", COMPACT_TRIGGER)}
              >
                <HugeiconsIcon icon={Folder01Icon} size={13} className="shrink-0" />
                <span className="truncate">{project || "~"}</span>
                {selected?.branch && (
                  <span className="hidden items-center gap-1 text-muted-foreground/70 sm:inline-flex">
                    <HugeiconsIcon icon={GitBranchIcon} size={12} />
                    {selected.branch}
                    {selected.dirty && (
                      <span
                        title="Uncommitted changes"
                        className="size-1.5 rounded-full bg-warning"
                      />
                    )}
                  </span>
                )}
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    <span className="flex items-center gap-2">
                      <HugeiconsIcon
                        icon={Folder01Icon}
                        size={13}
                        className="text-muted-foreground"
                      />
                      {p.name}
                    </span>
                  </SelectItem>
                ))}
                <SelectItem value="__new">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <HugeiconsIcon icon={PlusSignIcon} size={13} />
                    New project…
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>

            {/* Which Claude account this PROJECT bills to. Per project on
                purpose: an identity belongs to a body of work, and being asked
                at every launch is a question nobody wants five times a day. */}
            {isClaude && (
              <Select
                value={account || "__default"}
                onValueChange={(v) => {
                  if (!v) return;
                  if (v === "__newaccount") void addAccount();
                  else void chooseAccount(v === "__default" ? "" : v);
                }}
              >
                <SelectTrigger
                  variant="ghost"
                  size="sm"
                  className={cn("max-w-[38%]", COMPACT_TRIGGER)}
                >
                  <HarnessIcon harness="claude" size={13} />
                  <span className="truncate">
                    {accounts.find((a) => a.id === account)?.label ?? "Default"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id || "__default"} value={a.id || "__default"}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{a.label}</span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {a.loggedIn ? (a.email ?? "signed in") : "not signed in"}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value="__newaccount">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <HugeiconsIcon icon={PlusSignIcon} size={13} />
                      Add a Claude account…
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            )}

            {/* several agents on the SAME task, in one gesture */}
            <Select value={String(count)} onValueChange={(v) => v && setCount(Number(v))}>
              <SelectTrigger variant="ghost" size="sm" className={COMPACT_TRIGGER}>
                <span className="tabular-nums">{count === 1 ? "1 agent" : `${count} agents`}</span>
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    <span className="tabular-nums">{n === 1 ? "1 agent" : `${n} agents`}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={harness} onValueChange={(v) => v && setHarness(v)}>
              <SelectTrigger variant="ghost" size="sm" className={COMPACT_TRIGGER}>
                <HarnessIcon harness={harness} size={13} />
                {HARNESS_LABEL[harness]}
              </SelectTrigger>
              <SelectContent>
                {HARNESSES.map((h) => (
                  <SelectItem key={h} value={h}>
                    <span className="flex items-center gap-2">
                      <HarnessIcon harness={h} size={13} />
                      {HARNESS_LABEL[h] ?? h}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {isClaude && (
              <Select value={model} onValueChange={(v) => v && setModel(v)}>
                <SelectTrigger variant="ghost" size="sm" className={COMPACT_TRIGGER}>
                  {model}
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {isClaude && (
              <Select value={mode} onValueChange={(v) => v && setMode(v)}>
                <SelectTrigger
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "font-medium",
                    COMPACT_TRIGGER,
                    mode === "bypassPermissions" &&
                      "text-warning [:hover,[data-pressed]]:text-warning"
                  )}
                >
                  <HugeiconsIcon
                    icon={PERMISSION_MODES.find((m) => m.value === mode)!.icon}
                    size={13}
                  />
                  <span className="hidden sm:inline">
                    {PERMISSION_MODES.find((m) => m.value === mode)!.label}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {PERMISSION_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      <span className="flex items-start gap-2.5 py-0.5">
                        <HugeiconsIcon
                          icon={m.icon}
                          size={15}
                          className="mt-0.5 shrink-0 text-muted-foreground"
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[13px] font-medium">{m.label}</span>
                          <span className="text-xs text-muted-foreground">{m.desc}</span>
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
            <button
              onClick={launch}
              disabled={launching}
              aria-label="Start"
              className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground inset-shadow-[0_1px_rgb(255_255_255/16%)] transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-40 sm:size-8"
            >
              {launching ? (
                <span className="size-3.5 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
              ) : (
                <HugeiconsIcon icon={ArrowUp02Icon} size={16} />
              )}
            </button>
          </div>
        </div>
      </div>

      <Dialog
        open={newOpen}
        onOpenChange={(o) => {
          setNewOpen(o);
          if (!o) setNewError(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex gap-1 rounded-lg bg-accent/50 p-1 text-xs font-medium">
              {(["create", "import"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setNewTab(t)}
                  className={cn(
                    "flex-1 rounded-md py-1.5 transition-colors",
                    newTab === t
                      ? "bg-card shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t === "create" ? "Create" : "Import from GitHub"}
                </button>
              ))}
            </div>
            <div className="mt-3 space-y-3">
              {newTab === "create" ? (
                <>
                  <Input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createProject()}
                    placeholder="project-name"
                  />
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                    <Checkbox checked={newRepo} onCheckedChange={(c) => setNewRepo(c === true)} />
                    Create the GitHub repo
                  </label>
                  {newRepo && (
                    <label className="flex cursor-pointer items-center gap-2.5 pl-6 text-sm text-muted-foreground">
                      <Checkbox
                        checked={newPrivate}
                        onCheckedChange={(c) => setNewPrivate(c === true)}
                      />
                      Private
                    </label>
                  )}
                  {newError && <p className="text-xs text-destructive">{newError}</p>}
                </>
              ) : (
                <>
                  <Input
                    autoFocus
                    value={repoQuery}
                    onChange={(e) => setRepoQuery(e.target.value)}
                    placeholder="Filter your repos…"
                  />
                  <div className="max-h-60 space-y-0.5 overflow-y-auto">
                    {repos === null && (
                      <p className="py-4 text-center text-xs text-muted-foreground">Loading…</p>
                    )}
                    {(repos ?? [])
                      .filter((r) =>
                        r.nameWithOwner.toLowerCase().includes(repoQuery.toLowerCase())
                      )
                      .map((r) => (
                        <button
                          key={r.nameWithOwner}
                          disabled={newBusy}
                          onClick={() => importRepo(r)}
                          className="flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left hover:bg-accent/60 disabled:opacity-50"
                        >
                          <span className="text-[13px] font-medium">{r.nameWithOwner}</span>
                          <span className="line-clamp-1 text-xs text-muted-foreground">
                            {newBusy ? "Cloning…" : r.description || " "}
                          </span>
                        </button>
                      ))}
                  </div>
                  {newError && <p className="text-xs text-destructive">{newError}</p>}
                </>
              )}
            </div>
          </DialogPanel>
          {newTab === "create" && (
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setNewOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={!newName.trim() || newBusy} onClick={createProject}>
                {newBusy ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
