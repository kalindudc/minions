import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

function normalizeWindowsShellPath(filePath: string): string {
  if (!filePath.startsWith("/") || filePath.startsWith("//") || filePath.includes("\\")) {
    return filePath;
  }
  const match = filePath.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
  if (!match) return filePath;
  const suffix = match[2]?.replaceAll("/", "\\");
  return `${match[1].toUpperCase()}:\\${suffix ?? ""}`;
}

// Mirrors pi 1.2.0's getAgentDir, which runs PI_CODING_AGENT_DIR through normalizePath's defaults
// (config.ts and utils/paths.ts).
export function getAgentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (!envDir) return join(homedir(), ".pi", "agent");
  const windows = process.platform === "win32";
  const normalized = windows ? normalizeWindowsShellPath(envDir) : envDir;
  const home = homedir();
  if (normalized === "~") return home;
  if (normalized.startsWith("~/") || (windows && normalized.startsWith("~\\"))) {
    return join(home, normalized.slice(2));
  }
  if (/^file:\/\//.test(normalized)) return fileURLToPath(normalized);
  return normalized;
}

// Mirrors pi's parseFrontmatter (BOM strip, newline normalization, `---` fences, raw YAML values)
// so the bb server can read personas without loading pi at runtime.
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const unmarked = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const normalized = unmarked.replace(/\r\n?/g, "\n");
  const end = normalized.startsWith("---") ? normalized.indexOf("\n---", 3) : -1;
  if (end === -1) return { frontmatter: {}, body: normalized };

  const yamlString = normalized.slice(4, end);
  const body = normalized.slice(end + 4).trim();
  if (!yamlString) return { frontmatter: {}, body };
  return { frontmatter: (parse(yamlString) ?? {}) as Record<string, unknown>, body };
}
