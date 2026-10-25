// Local development convenience: persistent bearer credential for this browser origin.
// Do not use this storage model for production authentication (use secure HttpOnly cookies).
export const SESSION_KEY = "lu4-rb:session-token";
export function readSavedToken(): string {
  try { return localStorage.getItem(SESSION_KEY) ?? ""; } catch { return ""; }
}
export function saveToken(token: string): void {
  try { localStorage.setItem(SESSION_KEY, token); } catch { /* private browsing / blocked storage */ }
}
export function clearSavedToken(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* blocked storage */ }
}
