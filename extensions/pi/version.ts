import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read version from package.json at module load time
const packageJsonPath = resolve(__dirname, "../../package.json");
logger.debug("version", "loading-package-json", { path: packageJsonPath });
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

export const VERSION: string = packageJson.version;
logger.debug("version", "version-loaded", { version: VERSION });
