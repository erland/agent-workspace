import type { SandboxProvider, WorkspaceHandle } from "../core/sandbox-provider.js";
import type { ProjectType } from "../project/project-detector.js";

export interface RequestedBuildOutput {
  path: string;
  name?: string;
  kind?: string;
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
  projectType: "NPM" | "MAVEN";
  outputs: BuildArtifactOutput[];
}

export class ProjectBuildService {
  constructor(
    private readonly provider: SandboxProvider,
    private readonly projectRoot: string
  ) {}

  async build(
    handle: WorkspaceHandle,
    projectType: ProjectType,
    requested: readonly RequestedBuildOutput[] = []
  ): Promise<ProjectBuildResult> {
    if (projectType === "NPM") return this.buildNpm(handle, requested);
    if (projectType === "MAVEN") return this.buildMaven(handle, requested);
    throw new Error(`Unsupported build project type: ${projectType}`);
  }

  private async buildNpm(handle: WorkspaceHandle, requested: readonly RequestedBuildOutput[]): Promise<ProjectBuildResult> {
    const info = await this.exec(handle, [
      "node", "-e",
      "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));process.stdout.write(JSON.stringify({lock:fs.existsSync('package-lock.json'),build:typeof p.scripts?.build==='string'}));"
    ]);
    const parsed = JSON.parse(info.stdout) as { lock?: boolean; build?: boolean };
    if (!parsed.build) throw new Error("NPM project has no build script");

    await this.mustExec(handle, parsed.lock ? ["npm","ci","--no-audit","--no-fund"] : ["npm","install","--no-audit","--no-fund"]);
    await this.mustExec(handle, ["npm","run","build"]);

    const outputs = requested.length > 0
      ? [...requested]
      : await this.detectNpmOutputs(handle);
    if (outputs.length === 0) throw new Error("NPM build completed but no build output was detected");
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
    return {
      status: "PASSED",
      projectType: "MAVEN",
      outputs: await this.collectOutputs(handle, outputs)
    };
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
      const type = (await this.exec(handle, ["bash","-lc",`if [ -f ${shellQuote(requested.path)} ]; then printf file; elif [ -d ${shellQuote(requested.path)} ]; then printf dir; else exit 2; fi`])).stdout.trim();
      if (type === "file") {
        const bytes = await this.provider.readFile(handle, `${this.projectRoot}/${requested.path}`);
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
  if (filename.endsWith(".jar")) return "jar";
  if (filename.endsWith(".war")) return "war";
  if (filename.endsWith(".zip")) return "zip";
  if (filename.endsWith(".pdf")) return "report";
  return "generic";
}

function inferMediaType(filename: string): string {
  if (filename.endsWith(".jar")) return "application/java-archive";
  if (filename.endsWith(".war")) return "application/java-archive";
  if (filename.endsWith(".zip")) return "application/zip";
  if (filename.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}
