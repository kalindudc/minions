import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => join(dir, file))
    .sort();
}

function specifiers(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(ROOT, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      found.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function importsOf(dir: string) {
  return sourceFiles(dir).flatMap((file) =>
    specifiers(file).map((specifier) => ({
      file,
      specifier,
      target: specifier.startsWith(".")
        ? relative(ROOT, resolve(ROOT, dirname(file), specifier))
        : null,
    })),
  );
}

const reachesInto = (target: string | null, dir: string) =>
  target !== null && (target === dir || target.startsWith(`${dir}/`));

describe("repository layout", () => {
  it("keeps the core engine in src/ free of pi, bb and the extensions", () => {
    const outside = importsOf("src").filter(({ specifier, target }) =>
      target === null
        ? !specifier.startsWith("node:") && specifier !== "yaml"
        : !reachesInto(target, "src"),
    );

    expect(outside).toEqual([]);
  });

  it("never lets the pi extension import bb code or the bb SDK", () => {
    const leaks = importsOf("extensions/pi").filter(
      ({ specifier, target }) =>
        reachesInto(target, "extensions/bb") || specifier.startsWith("@get-bb/"),
    );

    expect(leaks).toEqual([]);
  });

  it("never lets the bb plugin import pi code or pi packages", () => {
    const leaks = importsOf("extensions/bb").filter(
      ({ specifier, target }) =>
        reachesInto(target, "extensions/pi") ||
        specifier.startsWith("@earendil-works/") ||
        specifier.startsWith("@sinclair/"),
    );

    expect(leaks).toEqual([]);
  });

  it("points the pi and bb manifests at entry files that exist and ships core with the pi extension", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const skillDirs: string[] = manifest.bb.skills;

    expect(manifest.pi.extensions).toEqual(["./extensions/pi/index.ts"]);
    expect([manifest.bb.server, manifest.bb.app]).toEqual([
      "./extensions/bb/server.ts",
      "./extensions/bb/app.tsx",
    ]);
    for (const entry of [...manifest.pi.extensions, manifest.bb.server, manifest.bb.app]) {
      expect(existsSync(join(ROOT, entry)), entry).toBe(true);
    }
    expect(skillDirs.length).toBeGreaterThan(0);
    for (const dir of skillDirs) {
      const skills = readdirSync(join(ROOT, dir)).filter((name) =>
        existsSync(join(ROOT, dir, name, "SKILL.md")),
      );
      expect(skills, dir).not.toEqual([]);
    }
    expect(manifest.files).toEqual(expect.arrayContaining(["src/", "extensions/pi/"]));
  });
});
