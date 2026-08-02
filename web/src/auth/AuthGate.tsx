import { useCallback, useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { HugeiconsIcon } from "@hugeicons/react";
import { FingerPrintIcon } from "@hugeicons/core-free-icons";
import { api, type AuthUser } from "../api";
import { Logo } from "../components/Logo";
import { Button } from "../components/ui/button";
import { UserCtx } from "./userContext";
import { Landing } from "../marketing/Landing";
import googleSvg from "../assets/brands/google.svg?raw";

async function postJson(path: string, body?: object) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status}`);
  return res.json();
}

function registerTokenFromHash(): string | null {
  const m = location.hash.match(/register\?token=([\w-]+)/);
  return m?.[1] ?? null;
}

/** An invitation someone was sent. In the fragment, like the enrolment token
 *  above and for the same reason: a fragment never reaches a server, so the
 *  token stays out of every access log between here and agora. */
function inviteTokenFromHash(): string | null {
  const m = location.hash.match(/^#\/join\/([\w-]+)/);
  return m?.[1] ?? null;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"checking" | "login" | "ok">("checking");
  const [enrolled, setEnrolled] = useState(true);
  const [google, setGoogle] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  // the Google callback lands non-invited accounts here
  const [denied, setDenied] = useState(location.hash === "#denied");
  const enrollToken = registerTokenFromHash();
  const inviteToken = inviteTokenFromHash();
  // An anonymous visitor gets the landing page; the sign-in card is one click
  // away. An enrolment link or a denied callback skips it — both are people who
  // already know what this is and are mid-flow.
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    const run = async () => {
      // Clear the fragment before anything can throw. The token is already in
      // `inviteToken`; leaving it in the address bar means it survives in
      // browser history and in whatever the user pastes when the first request
      // fails because the server is restarting.
      if (inviteToken) history.replaceState(null, "", "/");
      let me = await api.authMe();
      // Redeem an invitation before rendering, so someone arriving on their
      // link is signed in rather than shown a login screen they have no way to
      // satisfy. Only when nobody is signed in yet: redeeming over a live
      // session would REPLACE it, and the first person to click an invite link
      // is usually the owner checking that it works — who would land as a guest
      // of their own cockpit, without the panel that issued the link.
      if (inviteToken && !me.authed) {
        try {
          await postJson("/api/auth/invite", { token: inviteToken });
          me = await api.authMe();
        } catch {
          setDenied(true); // dead or revoked link — the "not invited" screen
        }
      }
      setEnrolled(me.enrolled);
      setGoogle(me.google ?? false);
      setUser(me.user ?? null);
      if (me.authed && location.hash === "#denied") {
        // stale hash from a previous attempt — signed in now
        history.replaceState(null, "", "/");
        setDenied(false);
      }
      setStatus(me.authed ? "ok" : "login");
    };
    run().catch(() => setStatus("login"));
  }, []);

  const login = useCallback(async () => {
    setError(null);
    try {
      const options = await postJson("/api/auth/login/options");
      const response = await startAuthentication({ optionsJSON: options });
      await postJson("/api/auth/login/verify", { response });
      setStatus("ok");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const register = useCallback(async () => {
    setError(null);
    try {
      const options = await postJson("/api/auth/register/options", { token: enrollToken });
      const response = await startRegistration({ optionsJSON: options });
      await postJson("/api/auth/register/verify", { response });
      history.replaceState(null, "", "/");
      setStatus("ok");
    } catch (e) {
      setError(String(e));
    }
  }, [enrollToken]);

  if (status === "checking") return null;
  if (status === "ok") return <UserCtx.Provider value={user}>{children}</UserCtx.Provider>;

  if (denied) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-border bg-card p-10 text-center shadow-sm"
        >
          <Logo className="size-12 text-foreground" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Not invited yet</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              This invitation is not valid. A link stops working once it has been
              replaced or revoked, and an account has to be on the invite list.
              Ask whoever invited you for a new link.
            </p>
          </div>
          <Button
            size="lg"
            variant="outline"
            className="w-full"
            onClick={() => {
              history.replaceState(null, "", "/");
              location.href = "/api/auth/google";
            }}
          >
            <span
              className="inline-flex size-[17px] [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: googleSvg }}
            />
            Try again with Google
          </Button>
        </motion.div>
      </div>
    );
  }

  if (!showAuth && !enrollToken) return <Landing onSignIn={() => setShowAuth(true)} />;

  return (
    <div className="flex h-full items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-border bg-card p-10 text-center shadow-sm"
      >
        <Logo className="size-12 text-foreground" />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">agora</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {enrollToken
              ? "Register a passkey for this device."
              : enrolled
                ? "Sign in with your passkey."
                : "No passkey enrolled."}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2.5">
          {google && !enrollToken && (
            <Button size="lg" className="w-full" onClick={() => (location.href = "/api/auth/google")}>
              <span
                className="inline-flex size-[17px] [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: googleSvg }}
              />
              Continue with Google
            </Button>
          )}
          {enrollToken ? (
            <Button size="lg" className="w-full" onClick={register}>
              <HugeiconsIcon icon={FingerPrintIcon} size={17} />
              Create passkey
            </Button>
          ) : enrolled ? (
            <Button
              size="lg"
              variant={google ? "outline" : "default"}
              className="w-full"
              onClick={login}
            >
              <HugeiconsIcon icon={FingerPrintIcon} size={17} />
              Passkey
            </Button>
          ) : !google ? (
            <p className="text-xs text-muted-foreground">
              On the server: <code className="rounded bg-muted px-1.5 py-0.5">agoractl enroll</code>{" "}
              then open the generated link.
            </p>
          ) : null}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </motion.div>
    </div>
  );
}
