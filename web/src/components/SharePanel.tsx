import { useState } from "react";
import { toast } from "sonner";
import { UserRoundPlus, X, RotateCcw } from "lucide-react";
import { api, type Invite, type PresencePeer, type Project } from "@/api";
import { cn } from "@/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const projectName = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

/** Owner-only multiplayer panel: invite a Google account by email, scoped to
 *  ONE project (or the whole cockpit), see who's live, revoke instantly
 *  (kills their sessions AND live sockets). */
export function SharePanel({
  peers,
  projects,
  activeProject,
}: {
  peers: PresencePeer[];
  projects: Project[];
  activeProject: string | null;
}) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [scope, setScope] = useState<string>(activeProject ?? "");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .listInvites()
      .then(({ invites }) => setInvites(invites))
      .catch(() => {});

  const add = async () => {
    const target = email.trim().toLowerCase();
    if (!target) return;
    setBusy(true);
    try {
      const { invites } = await api.addInvite(target, scope || null);
      setInvites(invites);
      setEmail("");
      toast.success(`${target} can now sign in with Google`, {
        description: scope
          ? `Limited to the "${projectName(scope)}" canvas. Send them the agora URL.`
          : "Access to all of agora. Send them the agora URL.",
      });
    } catch (e) {
      toast.error("Invitation failed", { description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (target: string) => {
    try {
      const { invites } = await api.revokeInvite(target);
      setInvites(invites);
      toast.success(`Revoked access for ${target}`, {
        description: "Sessions and live connections cut.",
      });
    } catch (e) {
      toast.error("Could not revoke", { description: String(e) });
    }
  };

  const onlineEmails = new Set(peers.map((p) => p.user.email));

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) return;
        // re-anchor on every open: the scope offered is the canvas Martin is
        // looking at NOW, not the one from when the page loaded
        setScope(activeProject ?? "");
        load();
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              aria-label="Multiplayer — invite someone"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <UserRoundPlus className="size-3.5" />
            </PopoverTrigger>
          }
        />
        <TooltipPopup side="bottom">Multiplayer — invite a Google account</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="end" className="w-80">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold">Multiplayer</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Guests sign in with their Google account and collaborate live:
              canvas, cursors, terminals.
            </p>
          </div>
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <div className="flex gap-1.5">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@gmail.com"
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2.5 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring/40"
              />
              <button
                type="submit"
                disabled={busy || !email.trim()}
                className="h-8 shrink-0 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Invite
              </button>
            </div>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40 [&>option]:bg-popover"
              title="What the guest will see"
            >
              {projects.map((p) => (
                <option key={p.path} value={p.path}>
                  "{p.name}" canvas only
                </option>
              ))}
              <option value="">⚠ All of agora (every canvas)</option>
            </select>
          </form>
          {invites.length > 0 && (
            <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              {invites.map((inv) => {
                const revoked = inv.revoked_at != null;
                const online = !revoked && onlineEmails.has(inv.email);
                return (
                  <li
                    key={inv.email}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-accent/50"
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        online
                          ? "bg-emerald-400"
                          : revoked
                            ? "bg-destructive/60"
                            : "bg-muted-foreground/30"
                      )}
                      title={online ? "online" : revoked ? "revoked" : "offline"}
                    />
                    <span className={cn("flex min-w-0 flex-1 flex-col", revoked && "opacity-50")}>
                      <span className={cn("truncate", revoked && "line-through")}>{inv.email}</span>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {inv.project ? `"${projectName(inv.project)}" canvas` : "all of agora"}
                      </span>
                    </span>
                    {revoked ? (
                      <button
                        title="Re-invite (same scope)"
                        onClick={() => {
                          api.addInvite(inv.email, inv.project).then(({ invites }) => {
                            setInvites(invites);
                            toast.success(`${inv.email} re-invited`);
                          });
                        }}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <RotateCcw className="size-3" />
                      </button>
                    ) : (
                      <button
                        title="Revoke access"
                        onClick={() => revoke(inv.email)}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
