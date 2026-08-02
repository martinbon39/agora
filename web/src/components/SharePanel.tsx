import { useState } from "react";
import { toast } from "sonner";
import { UserRoundPlus, X, RotateCcw, Link as LinkIcon } from "lucide-react";
import { api, type Invite, type PresencePeer, type Project } from "@/api";
import { cn } from "@/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const projectName = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

/** Owner-only multiplayer panel: invite someone by email, scoped to ONE project
 *  (or the whole cockpit), hand them a sign-in link, see who's live, revoke
 *  instantly (kills their sessions AND live sockets).
 *
 *  The email is the guest's identity — what scoping, presence and the audit
 *  list key on. It is also the address they would use if this install has
 *  Google sign-in configured, in which case the same invite works both ways. */
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
  // A link is readable exactly once, when it is minted — only its hash is
  // stored. So it is held here until the panel closes, and never re-fetched.
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);

  const copy = (url: string, note: string) =>
    navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success("Invite link copied", { description: note }))
      .catch(() => toast.info("Copy the link below", { description: note }));

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
      const { invites, link } = await api.addInvite(target, scope || null);
      setInvites(invites);
      setEmail("");
      setLink({ email: target, url: link });
      copy(
        link,
        scope
          ? `${target} lands on the "${projectName(scope)}" canvas and sees nothing else.`
          : `${target} gets all of agora.`
      );
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
      if (link?.email === target) setLink(null); // that link is dead now
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
        if (!open) {
          setLink(null); // it cannot be shown again anyway
          return;
        }
        // re-anchor on every open: the scope offered is the canvas the owner is
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
        <TooltipPopup side="bottom">Multiplayer — invite someone</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="end" className="w-80">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold">Multiplayer</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Invite someone and send them the link. They collaborate live:
              canvas, cursors, terminals. Anyone holding the link gets in, so
              send it the way you would a password.
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
          {link && (
            <div className="flex flex-col gap-1 rounded-md border border-input bg-muted/40 p-2">
              <p className="text-[10px] text-muted-foreground">
                Sign-in link for <span className="font-medium text-foreground">{link.email}</span> —
                shown once, copy it now.
              </p>
              <div className="flex items-center gap-1.5">
                <input
                  readOnly
                  value={link.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-7 min-w-0 flex-1 rounded border border-input bg-transparent px-1.5 font-mono text-[10px] outline-none"
                />
                <button
                  onClick={() => copy(link.url, `for ${link.email}`)}
                  className="h-7 shrink-0 rounded bg-primary px-2 text-[10px] font-medium text-primary-foreground hover:opacity-90"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
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
                          api.addInvite(inv.email, inv.project).then(({ invites, link }) => {
                            setInvites(invites);
                            setLink({ email: inv.email, url: link });
                            copy(link, `${inv.email} re-invited — the old link stays dead.`);
                          });
                        }}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <RotateCcw className="size-3" />
                      </button>
                    ) : (
                      <>
                        <button
                          title={
                            inv.hasLink
                              ? "New sign-in link — the current one stops working"
                              : "Create a sign-in link"
                          }
                          onClick={() => {
                            api.newInviteLink(inv.email).then(({ invites, link }) => {
                              setInvites(invites);
                              setLink({ email: inv.email, url: link });
                              copy(
                                link,
                                inv.hasLink
                                  ? `New link for ${inv.email}. The previous one no longer works.`
                                  : `Link for ${inv.email}.`
                              );
                            });
                          }}
                          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <LinkIcon className="size-3" />
                        </button>
                        <button
                          title="Revoke access"
                          onClick={() => revoke(inv.email)}
                          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                        >
                          <X className="size-3" />
                        </button>
                      </>
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
