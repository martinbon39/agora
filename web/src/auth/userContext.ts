import { createContext, useContext } from "react";
import type { AuthUser } from "@/api";

/** Identity of the signed-in human (owner or invited guest), from /api/auth/me. */
export const UserCtx = createContext<AuthUser | null>(null);

export function useCurrentUser(): AuthUser | null {
  return useContext(UserCtx);
}
