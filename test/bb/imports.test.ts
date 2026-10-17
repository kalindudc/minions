import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

function runtimeSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings;
      const onlyTypes =
        clause !== undefined &&
        clause.name === undefined &&
        named !== undefined &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((element) => element.isTypeOnly);
      if (!onlyTypes) specifiers.push((statement.moduleSpecifier as ts.StringLiteral).text);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      !statement.isTypeOnly
    ) {
      specifiers.push((statement.moduleSpecifier as ts.StringLiteral).text);
    }
  }
  return specifiers;
}

function resolveLocal(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ];
  const found = candidates.find((candidate) => candidate.match(/\.tsx?$/) && existsSync(candidate));
  if (!found) throw new Error(`Cannot resolve ${specifier} from ${relative(ROOT, from)}`);
  return found;
}

function reachableFrom(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [join(ROOT, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of runtimeSpecifiers(file)) {
      if (specifier.startsWith(".")) queue.push(resolveLocal(file, specifier));
      else packages.add(specifier);
    }
  }
  return {
    files: [...files].map((file) => relative(ROOT, file)).sort(),
    packages: [...packages].sort(),
  };
}

describe("bb runtime import boundary", () => {
  it("keeps the bb server's runtime imports inside the package, on declared dependencies and free of pi", () => {
    const { files, packages } = reachableFrom("extensions/bb/server.ts");

    expect(files).toEqual([
      "extensions/bb/server.ts",
      "extensions/bb/spawn.ts",
      "extensions/bb/state.ts",
      "src/agents.ts",
      "src/persona-frontmatter.ts",
    ]);
    expect(packages.filter((name) => !name.startsWith("node:"))).toEqual([
      "@get-bb/plugin-sdk",
      "yaml",
      "zod",
    ]);
  });

  it("finds pi's runtime imports when walking the pi extension, so the boundary checks are not vacuous", () => {
    const { files, packages } = reachableFrom("extensions/pi/index.ts");

    expect(packages).toContain("@earendil-works/pi-coding-agent");
    expect(files).toContain("extensions/pi/config.ts");
  });

  it("keeps the bb frontend off server code, Node built-ins and pi", () => {
    const { files, packages } = reachableFrom("extensions/bb/app.tsx");
    const pluginModules = files.filter((file) => /^extensions\/bb\/[^/]+\.tsx?$/.test(file));

    expect(pluginModules).toEqual(["extensions/bb/app.tsx"]);
    expect(files.some((file) => file.startsWith("src/") || file.startsWith("extensions/pi/"))).toBe(
      false,
    );
    expect(
      packages.filter((name) => name.startsWith("node:") || name.startsWith("@earendil-works/")),
    ).toEqual([]);
  });

  it("uses only public SDK entry points and no private bb packages", () => {
    const scan = experimental_scanPublicSdkOnly(ROOT, {
      allow: [
        /^@earendil-works\/pi-(ai|coding-agent|tui)$/,
        /^@sinclair\/typebox(\/value)?$/,
        /^@get-bb\/plugin-sdk\/testing(\/app)?$/,
        /^@radix-ui\/react-(checkbox|dialog|slot)$/,
        /^@testing-library\/react$/,
        /^(class-variance-authority|clsx|react|react-dom|tailwind-merge|typescript|yaml)$/,
        /^vitest(\/config)?$/,
      ],
    });
    const ownFiles = (file: string) =>
      /^(extensions|src|test)\//.test(file) || file === "vitest.config.ts";

    expect(scan.violations.filter((violation) => ownFiles(violation.file))).toEqual([]);
    expect(scan.privateDependencies).toEqual([]);
  });
});
