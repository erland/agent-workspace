import path from "node:path";
import { NODE_PROJECT_INSPECTION, selectNodePackageManager } from "../project/node-package-manager.js";
import type { SandboxProvider, WorkspaceHandle } from "../core/sandbox-provider.js";
import type { ProjectType } from "../project/project-detector.js";

export interface RequestedBuildOutput {
  path: string;
  name?: string | undefined;
  kind?: string | undefined;
}

export interface BuildArtifactOutput {
  name: string;
  kind: string;
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
  sourcePath: string;
}

export interface ProjectBuildResult {
  status: "PASSED";
  projectType: "NPM" | "MAVEN" | "PYTHON" | "GRADLE" | "CARGO" | "GO";
  outputs: BuildArtifactOutput[];
}

export class ProjectBuildService {
  constructor(
    private readonly provider: SandboxProvider,
    private readonly projectRoot: string,
    private readonly maxOutputBytes = 100 * 1024 * 1024
  ) {}

  async build(
    handle: WorkspaceHandle,
    projectType: ProjectType,
    requested: readonly RequestedBuildOutput[] = []
  ): Promise<ProjectBuildResult> {
    if (projectType === "NPM") return this.buildNpm(handle, requested);
    if (projectType === "MAVEN") return this.buildMaven(handle, requested);
    if (projectType === "PYTHON") return this.buildPython(handle, requested);
    if (projectType === "GRADLE") return this.buildGradle(handle, requested);
    if (projectType === "CARGO") return this.buildCargo(handle, requested);
    if (projectType === "GO") return this.buildGo(handle, requested);
    throw new Error(`Unsupported build project type: ${projectType}`);
  }

  private async buildNpm(handle: WorkspaceHandle, requested: readonly RequestedBuildOutput[]): Promise<ProjectBuildResult> {
    const info = await this.exec(handle, [
      "node", "-e",
      NODE_PROJECT_INSPECTION
    ]);
    const parsed = JSON.parse(info.stdout) as { hasPackageLock?: boolean; hasPnpmLock?: boolean; packageManager?: string; scripts?: { build?: string } };
    if (typeof parsed.scripts?.build !== "string") throw new Error("NPM project has no build script");
    const selected = selectNodePackageManager(parsed);

    await this.mustExec(handle, selected.install);
    await this.mustExec(handle, selected.build);

    const outputs = requested.length > 0
      ? [...requested]
      : await this.detectNpmOutputs(handle);
    if (outputs.length === 0) throw new Error("NPM build completed but no build output was detected");
    if (outputs.length > 12) throw new Error("Build produced more than 12 publishable outputs");
    return {
      status: "PASSED",
      projectType: "NPM",
      outputs: await this.collectOutputs(handle, outputs)
    };
  }

  private async buildMaven(handle: WorkspaceHandle, requested: readonly RequestedBuildOutput[]): Promise<ProjectBuildResult> {
    const executable = (await this.exec(handle, ["bash","-lc","if [ -f ./mvnw ]; then chmod +x ./mvnw && printf './mvnw'; else printf 'mvn'; fi"])).stdout.trim();
    if (executable !== "./mvnw" && executable !== "mvn") throw new Error("Could not determine Maven executable");
    await this.mustExec(handle, [executable, "package", "-DskipTests"]);

    const outputs = requested.length > 0
      ? [...requested]
      : await this.detectMavenOutputs(handle);
    if (outputs.length === 0) throw new Error("Maven build completed but no JAR/WAR output was detected");
    if (outputs.length > 12) throw new Error("Build produced more than 12 publishable outputs");
    return {
      status: "PASSED",
      projectType: "MAVEN",
      outputs: await this.collectOutputs(handle, outputs)
    };
  }

  private async buildGradle(handle: WorkspaceHandle, requested: readonly RequestedBuildOutput[]): Promise<ProjectBuildResult> {
    const probe = await this.exec(handle, ["bash", "-lc",
      "test -f ./gradlew && test -f ./gradle/wrapper/gradle-wrapper.jar && test -f ./gradle/wrapper/gradle-wrapper.properties"]);
    if (probe.exitCode !== 0) {
      throw new Error("Gradle Wrapper files (gradlew, gradle-wrapper.jar, gradle-wrapper.properties) are required");
    }
    // Use the project's wrapper, never install an unpinned globally shared Gradle.
    await this.mustExec(handle, ["bash", "./gradlew", "--no-daemon", "--console=plain", "assemble"]);
    const outputs = requested.length > 0 ? [...requested] : await this.detectGradleOutputs(handle);
    if (outputs.length === 0) throw new Error("Gradle build completed but no JAR/WAR output was detected");
    if (outputs.length > 12) throw new Error("Build produced more than 12 publishable outputs");
    return {status: "PASSED", projectType: "GRADLE", outputs: await this.collectOutputs(handle, outputs)};
  }

  private async detectGradleOutputs(handle: WorkspaceHandle): Promise<RequestedBuildOutput[]> {
    const result = await this.exec(handle, ["bash", "-lc",
      "find . -type f \\( -path '*/build/libs/*.jar' -o -path '*/build/libs/*.war' \\) ! -name '*-plain.jar' ! -name '*-sources.jar' ! -name '*-javadoc.jar' ! -name '*-tests.jar' ! -path '*/.gradle/*' -printf '%p\\n' | sort"]);
    if (result.exitCode !== 0) throw new Error(result.stderr || "Could not discover Gradle build outputs");
    return result.stdout.split("\n").map(x => x.trim().replace(/^\.\//, "")).filter(Boolean).map(path => ({
      path,
      name: path.split("/").at(-1)?.replace(/\.(jar|war)$/, "") ?? "application",
      kind: path.endsWith(".war") ? "war" : "jar"
    }));
  }

  private async buildCargo(handle: WorkspaceHandle, requested: readonly RequestedBuildOutput[]): Promise<ProjectBuildResult> {
    const probe = await this.exec(handle, ["bash", "-lc",
      "test -f Cargo.toml && test ! -f rust-toolchain && test ! -f rust-toolchain.toml"]);
    if (probe.exitCode !== 0) throw new Error("Cargo.toml is required; project-defined rust-toolchain files are not yet supported");
    // Removing release outputs guards against publishing stale binaries from the ZIP.
    await this.mustExec(handle, ["cargo", "clean", "--release"]);
    await this.mustExec(handle, ["cargo", "build", "--release", "--workspace"]);
    const outputs = requested.length ? [...requested] : await this.detectCargoOutputs(handle);
    if (!outputs.length) throw new Error("Cargo build succeeded but no binary targets were found; supply explicit outputs for library-only projects");
    if (outputs.length > 12) throw new Error("Build produced more than 12 publishable outputs");
    return {status:"PASSED", projectType:"CARGO", outputs: await this.collectOutputs(handle, outputs)};
  }

  private async detectCargoOutputs(handle: WorkspaceHandle): Promise<RequestedBuildOutput[]> {
    const result = await this.exec(handle, ["cargo", "metadata", "--no-deps", "--format-version", "1"]);
    if (result.exitCode !== 0) throw new Error(result.stderr || "Could not inspect Cargo workspace metadata");
    let raw: unknown;
    try { raw = JSON.parse(result.stdout); } catch { throw new Error("Invalid Cargo metadata JSON"); }
    if (!raw || typeof raw !== "object") throw new Error("Invalid Cargo metadata");
    const metadata = raw as {workspace_members?: unknown; packages?: unknown};
    if (!Array.isArray(metadata.workspace_members) || !Array.isArray(metadata.packages)) throw new Error("Invalid Cargo workspace packages");
    const members = new Set(metadata.workspace_members.filter((x):x is string=>typeof x==="string"));
    const names = new Set<string>();
    for (const rawPackage of metadata.packages) {
      if (!rawPackage || typeof rawPackage !== "object") continue;
      const pkg = rawPackage as {id?:unknown;targets?:unknown};
      if (typeof pkg.id !== "string" || !members.has(pkg.id) || !Array.isArray(pkg.targets)) continue;
      for (const rawTarget of pkg.targets) {
        if (!rawTarget || typeof rawTarget !== "object") continue;
        const target = rawTarget as {name?:unknown;kind?:unknown};
        if (typeof target.name === "string" && Array.isArray(target.kind) && target.kind.includes("bin")) {
          if (!/^[A-Za-z0-9_-]+$/.test(target.name)) throw new Error("Unsupported Cargo binary name");
          names.add(target.name);
        }
      }
    }
    return [...names].sort().map(name=>({path:`target/release/${name}`,name,kind:"linux-binary"}));
  }


  /** Build Linux/amd64 binaries from main packages, including go.work modules. */
  private async buildGo(handle: WorkspaceHandle, requested: readonly RequestedBuildOutput[]): Promise<ProjectBuildResult> {
    if (requested.length > 12) throw new Error("Build produced more than 12 publishable outputs");
    // Never use source-provided executable scripts to find binaries. Go itself reports
    // main packages; all commands execute in the pinned, non-root Go sandbox.
    const probe = await this.exec(handle, ["bash", "-lc",
      "if [ -f go.work ]; then printf workspace; elif [ -f go.mod ]; then printf module; else exit 2; fi"]);
    if (probe.exitCode !== 0) throw new Error("Go build requires go.mod or go.work");
    let modules = [this.projectRoot];
    if (probe.stdout.trim() === "workspace") {
      const work = await this.exec(handle, ["go", "work", "edit", "-json"]);
      if (work.exitCode !== 0) throw new Error(work.stderr || "Cannot inspect go.work");
      let raw: unknown;
      try { raw = JSON.parse(work.stdout); } catch { throw new Error("Invalid go.work metadata"); }
      if (!raw || typeof raw !== "object" || !("Use" in raw) || !Array.isArray(raw.Use)) {
        throw new Error("Invalid go.work module list");
      }
      const uses: unknown[] = raw.Use;
      if (uses.length < 1 || uses.length > 12) throw new Error("go.work requires 1–12 local modules");
      const base = path.posix.resolve(this.projectRoot);
      const resolved: string[] = [];
      for (const value of uses) {
        if (!value || typeof value !== "object" || !("DiskPath" in value) || typeof value.DiskPath !== "string") {
          throw new Error("Invalid go.work module path");
        }
        const relative: string = value.DiskPath;
        const directory = path.posix.resolve(base, relative);
        if (path.posix.isAbsolute(relative) || (directory !== base && !directory.startsWith(base + "/"))) {
          throw new Error("go.work module path escapes uploaded project");
        }
        resolved.push(directory);
      }
      modules = [...new Set(resolved)];
    } else if (probe.stdout.trim() !== "module") {
      throw new Error("Could not identify Go module or workspace");
    }

    // Remove stale outputs supplied in an uploaded ZIP. Refuse symlinked output
    // directories to avoid following links outside the project.
    await this.mustExec(handle, ["bash", "-lc",
      "if [ -L .agent-workspace-go-bin ]; then exit 2; fi; rm -rf -- .agent-workspace-go-bin && mkdir -m 700 -- .agent-workspace-go-bin"]);
    const discovered: Array<{module: string; importPath: string; name: string}> = [];
    for (const module of modules) {
      const prefix = module === this.projectRoot ? [] : ["-C", module];
      await this.mustExec(handle, ["go", ...prefix, "mod", "download"]);
      const listing = await this.exec(handle, ["go", ...prefix, "list", "-f",
        "{{if eq .Name \\"main\\"}}{{.ImportPath}}{{end}}", "./..."]);
      if (listing.exitCode !== 0) throw new Error(listing.stderr || "Cannot enumerate Go main packages");
      for (const line of listing.stdout.split(/\\r?\\n/)) {
        const importPath = line.trim();
        if (!importPath) continue;
        // Import paths are passed as argv, never interpolated into a shell command.
        if (!/^[A-Za-z0-9._~+\\/@-]+$/.test(importPath) || importPath.startsWith("-")) {
          throw new Error("Unsupported Go package import path");
        }
        const name = importPath.split("/").at(-1) ?? "application";
        if (!/^[A-Za-z0-9._-]+$/.test(name) || name === "." || name === "..") {
          throw new Error("Unsupported Go binary target name");
        }
        discovered.push({module, importPath, name});
        if (discovered.length > 12) throw new Error("Build produced more than 12 Go binary targets");
      }
    }
    if (discovered.length === 0) {
      throw new Error("Go build found no executable main packages; library-only modules do not produce binaries");
    }
    const names = new Set<string>();
    const outputs: RequestedBuildOutput[] = [];
    for (const [index, pkg] of discovered.entries()) {
      let name = pkg.name;
      if (names.has(name)) name = `${name}-${index + 1}`;
      names.add(name);
      const target = `.agent-workspace-go-bin/${name}`;
      const destination = `${this.projectRoot}/${target}`;
      const prefix = pkg.module === this.projectRoot ? [] : ["-C", pkg.module];
      await this.mustExec(handle, ["go", ...prefix, "build", "-trimpath", "-o", destination, pkg.importPath]);
      outputs.push({path:target, name, kind:"linux-binary"});
    }
    return {
      status: "PASSED", projectType: "GO",
      outputs: await this.collectOutputs(handle, requested.length ? requested : outputs)
    };
  }

  private async buildPython(handle: WorkspaceHandle, requested: readonly RequestedBuildOutput[]): Promise<ProjectBuildResult> {
    // Only pyproject-based projects are distributable Python packages. A lone
    // requirements.txt is sufficient for verification, not for wheel/sdist.
    const manifest = await this.exec(handle, ["bash", "-lc", "test -f pyproject.toml"]);
    if (manifest.exitCode !== 0) throw new Error("Python build requires pyproject.toml");

    const python = ".agent-workspace-build-venv/bin/python";
    await this.mustExec(handle, ["python3", "-m", "venv", ".agent-workspace-build-venv"]);
    // A versioned frontend, installed only in the sandbox; PEP 517 manages
    // the backend requirements specified by each individual project.
    await this.mustExec(handle, [python, "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "build==1.3.0"]);
    await this.mustExec(handle, [python, "-m", "build", "--outdir", ".agent-workspace-dist"]);

    const outputs = requested.length > 0 ? [...requested] : await this.detectPythonOutputs(handle);
    if (outputs.length === 0) throw new Error("Python build completed but no wheel/sdist output was detected");
    if (outputs.length > 12) throw new Error("Build produced more than 12 publishable outputs");
    return {
      status: "PASSED",
      projectType: "PYTHON",
      outputs: await this.collectOutputs(handle, outputs)
    };
  }

  private async detectPythonOutputs(handle: WorkspaceHandle): Promise<RequestedBuildOutput[]> {
    const outputDir = ".agent-workspace-dist";
    const result = await this.exec(handle, ["bash", "-lc",
      `if [ -d ${outputDir} ]; then find ${outputDir} -maxdepth 1 -type f \\( -name '*.whl' -o -name '*.tar.gz' \\) -printf '%p\\n' | sort; fi`
    ]);
    if (result.exitCode !== 0) throw new Error(result.stderr || "Could not discover Python build outputs");
    return result.stdout.split("\n").map(x => x.trim()).filter(Boolean).map(path => ({
      path, name: path.split("/").at(-1) ?? "python-package",
      kind: path.endsWith(".whl") ? "wheel" : "sdist"
    }));
  }

  private async detectNpmOutputs(handle: WorkspaceHandle): Promise<RequestedBuildOutput[]> {
    const result = await this.exec(handle, [
      "bash","-lc",
      "for p in dist build out; do if [ -d \"$p\" ]; then printf '%s\\n' \"$p\"; fi; done"
    ]);
    return result.stdout.split("\n").map((v) => v.trim()).filter(Boolean).map((path) => ({
      path,
      name: path,
      kind: "static-web"
    }));
  }

  private async detectMavenOutputs(handle: WorkspaceHandle): Promise<RequestedBuildOutput[]> {
    const result = await this.exec(handle, [
      "bash","-lc",
      "find target -maxdepth 1 -type f \\( -name '*.jar' -o -name '*.war' \\) ! -name '*-sources.jar' ! -name '*-javadoc.jar' ! -name '*-tests.jar' ! -name 'original-*' -printf '%p\\n' | sort"
    ]);
    return result.stdout.split("\n").map((v) => v.trim()).filter(Boolean).map((path) => ({
      path,
      name: path.split("/").at(-1)?.replace(/\.(jar|war)$/,"") ?? "application",
      kind: path.endsWith(".war") ? "war" : "jar"
    }));
  }

  private async collectOutputs(handle: WorkspaceHandle, outputs: readonly RequestedBuildOutput[]): Promise<BuildArtifactOutput[]> {
    const result: BuildArtifactOutput[] = [];
    for (let index = 0; index < outputs.length; index += 1) {
      const requested = outputs[index]!;
      validateRelativePath(requested.path);
      const inspection = await this.exec(handle, ["bash","-lc",`if [ -f ${shellQuote(requested.path)} ]; then printf file; elif [ -d ${shellQuote(requested.path)} ]; then printf dir; else exit 2; fi`]);
      if (inspection.exitCode === 2) {
        throw new Error(`Requested build output does not exist: ${requested.path}`);
      }
      if (inspection.exitCode !== 0) {
        throw new Error(inspection.stderr || inspection.stdout || `Could not inspect build output: ${requested.path}`);
      }
      const type = inspection.stdout.trim();
      if (type === "file") {
        const absolutePath = `${this.projectRoot}/${requested.path}`;
        await this.assertOutputSize(handle, absolutePath);
        const bytes = await this.provider.readFile(handle, absolutePath);
        const filename = requested.path.split("/").at(-1) ?? `artifact-${index + 1}`;
        result.push({
          name: requested.name ?? filename,
          kind: requested.kind ?? inferKind(filename),
          filename,
          mediaType: inferMediaType(filename),
          bytes,
          sourcePath: requested.path
        });
        continue;
      }
      if (type === "dir") {
        const archivePath = `/tmp/agent-workspace-build-${index}.tar.gz`;
        await this.mustExec(handle, ["bash","-lc",`tar -czf ${shellQuote(archivePath)} -C ${shellQuote(requested.path)} .`]);
        await this.assertOutputSize(handle, archivePath);
        const bytes = await this.provider.readFile(handle, archivePath);
        const base = (requested.name ?? requested.path.split("/").at(-1) ?? `artifact-${index + 1}`).replace(/[^A-Za-z0-9._-]+/g,"-");
        result.push({
          name: requested.name ?? base,
          kind: requested.kind ?? "directory",
          filename: `${base}.tar.gz`,
          mediaType: "application/gzip",
          bytes,
          sourcePath: requested.path
        });
        continue;
      }
      throw new Error(`Unsupported build output type: ${requested.path}`);
    }
    return result;
  }

  private async assertOutputSize(handle: WorkspaceHandle, path: string): Promise<void> {
    const result = await this.provider.exec(handle, {
      argv: ["stat", "-c", "%s", path],
      workdir: this.projectRoot,
      timeoutMs: 30_000
    });
    if (result.exitCode !== 0) throw new Error(`Could not inspect build output size: ${path}`);
    const size = Number.parseInt(result.stdout.trim(), 10);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid build output size: ${path}`);
    if (size > this.maxOutputBytes) {
      throw new Error(`Build output exceeds maximum size of ${this.maxOutputBytes} bytes: ${path}`);
    }
  }

  private exec(handle: WorkspaceHandle, argv: readonly string[]) {
    return this.provider.exec(handle, { argv, workdir: this.projectRoot, timeoutMs: 5 * 60_000 });
  }

  private async mustExec(handle: WorkspaceHandle, argv: readonly string[]): Promise<void> {
    const result = await this.exec(handle, argv);
    if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout || `Command failed: ${argv.join(" ")}`);
  }
}

function validateRelativePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`Invalid build output path: ${path}`);
  }
  if (!/^[A-Za-z0-9._@+\/-]+$/.test(path)) throw new Error(`Unsupported characters in build output path: ${path}`);
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function inferKind(filename: string): string {
  if (filename.endsWith(".whl")) return "wheel";
  if (filename.endsWith(".tar.gz")) return "sdist";
  if (filename.endsWith(".jar")) return "jar";
  if (filename.endsWith(".war")) return "war";
  if (filename.endsWith(".zip")) return "zip";
  if (filename.endsWith(".pdf")) return "report";
  return "generic";
}

function inferMediaType(filename: string): string {
  if (filename.endsWith(".whl")) return "application/zip";
  if (filename.endsWith(".tar.gz")) return "application/gzip";
  if (filename.endsWith(".jar")) return "application/java-archive";
  if (filename.endsWith(".war")) return "application/java-archive";
  if (filename.endsWith(".zip")) return "application/zip";
  if (filename.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}
