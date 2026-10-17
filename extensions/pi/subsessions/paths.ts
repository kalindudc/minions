import { homedir } from "node:os";
import { join } from "node:path";

function getDefaultSessionDir(cwd: string): string {
  // Replicate pi's standard session directory path logic
  // ~/.pi/agent/sessions/--<cwd>--/
  const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(homedir(), ".pi", "agent", "sessions", safePath);
}

export function getMinionsDir(cwd: string): string {
  // Use pi's standard session directory structure
  // This places minion sessions alongside the parent session in ~/.pi/agent/sessions/--<cwd>--/minions/
  return join(getDefaultSessionDir(cwd), "minions");
}

export function getTempSessionPath(cwd: string): string {
  // Return path in /tmp for ephemeral sessions
  return join("/tmp", "pi-minions", "sessions", hashCwd(cwd), "ephemeral.jsonl");
}

export function hashCwd(cwd: string): string {
  // Use full base64url encoding of cwd for uniqueness
  // Replace path separators to make it filesystem-safe
  // Note: This is now only used for temp session paths, as minion sessions
  // use pi's standard session directory structure
  return Buffer.from(cwd).toString("base64url");
}
