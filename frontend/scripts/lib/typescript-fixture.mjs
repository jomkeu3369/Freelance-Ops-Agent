import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const frontendRoot = fileURLToPath(new URL("../../", import.meta.url));

// 실제 API 모듈과 의존 모듈을 임시 ESM으로 변환해 브라우저나 서버 없이 검증한다.
export async function createApiFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "freelance-ops-api-"));
  const compiled = new Map();

  function destination(sourcePath) {
    const relative = path.relative(frontendRoot, sourcePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("검증 모듈이 frontend 폴더 밖을 참조합니다.");
    }
    return path.join(directory, relative.replace(/\.(?:tsx?|mts)$/, ".mjs"));
  }

  async function compile(sourcePath) {
    if (compiled.has(sourcePath)) return compiled.get(sourcePath);
    const target = destination(sourcePath);
    compiled.set(sourcePath, target);
    const source = await readFile(sourcePath, "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: sourcePath,
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 }
    });
    const parsed = ts.createSourceFile(sourcePath, outputText, ts.ScriptTarget.Latest, true);
    const imports = [];
    for (const statement of parsed.statements) {
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith(".")) continue;
      const base = path.resolve(path.dirname(sourcePath), specifier.text);
      const dependency = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.mjs`].find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile() && !candidate.endsWith(".css")
      );
      if (!dependency) throw new Error(`검증 모듈을 찾을 수 없습니다: ${specifier.text}`);
      const dependencyTarget = await compile(dependency);
      let relative = path.relative(path.dirname(target), dependencyTarget).replaceAll(path.sep, "/");
      if (!relative.startsWith(".")) relative = `./${relative}`;
      imports.push({ start: specifier.getStart(parsed), end: specifier.end, value: JSON.stringify(relative) });
    }
    let output = outputText;
    for (const replacement of imports.reverse()) {
      output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, output);
    return target;
  }

  async function cleanup() {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(directory));
    if (relative.startsWith("..") || path.isAbsolute(relative) || !relative.startsWith("freelance-ops-api-")) {
      throw new Error("임시 검증 폴더 경로가 올바르지 않습니다.");
    }
    await rm(directory, { recursive: true, force: true });
  }

  try {
    const apiPath = await compile(path.join(frontendRoot, "app/lib/api.ts"));
    const cachePath = await compile(path.join(frontendRoot, "app/lib/query-cache.ts"));
    return {
      api: await import(pathToFileURL(apiPath)),
      queryCache: await import(pathToFileURL(cachePath)),
      async importModule(relativePath) {
        const target = await compile(path.resolve(frontendRoot, relativePath));
        return import(pathToFileURL(target));
      },
      cleanup
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
