/**
 * useRequester — convenience hook for RequesterContext.
 *
 * Returns { requester, isLoaded, setRequester, clearRequester }.
 * Throws if used outside a <RequesterProvider>.
 */

import { useContext } from "react";
import { RequesterContext, type RequesterContextValue } from "../contexts/RequesterContext.js";

export function useRequester(): RequesterContextValue {
  const ctx = useContext(RequesterContext);
  if (!ctx) {
    throw new Error("useRequester must be used within a <RequesterProvider>");
  }
  return ctx;
}
