import { useCallback, useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, type ClaudeAccount } from "@/api";
import { serverEvents } from "@/events";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "./ui/menu";

/**
 * Which Claude account the ACTIVE PROJECT's agents sign in as.
 *
 * It lives in the top bar rather than in the launch form because the setting
 * belongs to the project, not to one launch — and because the launch form is a
 * mobile surface: on the desktop canvas terminals open straight from the dock,
 * so anything buried in the composer is invisible where the work happens.
 */
export function AccountPicker({ project, className }: { project: string; className?: string }) {
  const [accounts, setAccounts] = useState<ClaudeAccount[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .listAccounts()
      .then(({ accounts, byProject }) => {
        setAccounts(accounts);
        setCurrent(byProject[project] ?? "");
      })
      .catch(() => {});
  }, [project]);

  useEffect(() => {
    load();
    return serverEvents.subscribe((m) => {
      if (m.type === "accounts_changed") load();
    });
  }, [load]);

  const choose = async (id: string) => {
    const previous = current;
    setCurrent(id);
    setBusy(true);
    try {
      await api.setProjectAccount(project, id || null);
      const acc = accounts.find((a) => a.id === id);
      toast.success(`This project signs in as ${acc?.label ?? "the default account"}`, {
        description: "Applies to the next terminal opened here; running agents keep theirs.",
      });
    } catch (e) {
      setCurrent(previous);
      toast.error("Could not switch account", { description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  /** agora cannot do the OAuth dance: prepare the isolated config dir, then
   *  open a terminal pointed at it where `claude` runs the real login. */
  const add = async () => {
    const label = window.prompt(
      "Name this Claude account (Personal, Work…).\n\nA terminal will open — run `claude` in it and sign in.",
      ""
    );
    if (label === null || !label.trim()) return;
    setBusy(true);
    try {
      const { account } = await api.createAccount(label.trim());
      await api.loginAccount(account.id);
      load();
      toast.success(`Terminal opened for ${account.label}`, {
        description: "Run `claude` there and sign in — the tokens land in that account only.",
        duration: 12_000,
      });
    } catch (e) {
      toast.error("Could not add the account", { description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const active = accounts.find((a) => a.id === current);
  // one account and no alternative: nothing to toggle, so say nothing
  if (accounts.length <= 1 && !current) {
    return (
      <Menu>
        <MenuTrigger
          aria-label="Claude account"
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground",
            className
          )}
        >
          <UserRound className="size-3.5" />
        </MenuTrigger>
        <MenuPopup side="bottom" align="end" className="min-w-56">
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
            Agents here sign in as{" "}
            <span className="text-foreground/80">{accounts[0]?.email ?? "your Claude account"}</span>.
          </p>
          <MenuSeparator />
          <MenuItem onClick={add} disabled={busy}>
            Add a second account…
          </MenuItem>
        </MenuPopup>
      </Menu>
    );
  }

  return (
    <Menu>
      <MenuTrigger
        aria-label="Claude account"
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          !!current && "bg-accent/50 text-foreground",
          className
        )}
      >
        <UserRound className="size-3.5" />
        <span className="max-w-28 truncate">{active?.label ?? "Default"}</span>
      </MenuTrigger>
      <MenuPopup side="bottom" align="end" className="min-w-64">
        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
          Which Claude account this project's agents sign in as.
        </p>
        <MenuSeparator />
        {accounts.map((a) => (
          <MenuItem key={a.id || "__default"} onClick={() => choose(a.id)} disabled={busy}>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className={cn("truncate", a.id === current && "font-medium text-foreground")}>
                {a.label}
              </span>
              <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                {a.loggedIn ? (a.email ?? "signed in") : "not signed in"}
              </span>
            </span>
            {a.id === current && <span className="text-[10px] text-muted-foreground">current</span>}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onClick={add} disabled={busy}>
          Add a Claude account…
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
