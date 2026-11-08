import {
  DEFAULT_JAVA_VERSION,
  DEFAULT_NODE_VERSION,
  SUPPORTED_JAVA_VERSIONS,
  SUPPORTED_NODE_VERSIONS,
  type JavaVersion,
  type NodeVersion,
  type RuntimeProfileId
} from "../core/runtime-profile.js";
import { readZipTextEntries } from "../archive/zip-entry-reader.js";
import type { ArchiveValidationResult } from "../archive/archive-validator.js";

export type ProjectType = "MAVEN" | "NPM" | "PYTHON" | "GRADLE" | "MAVEN_NPM" | "MIXED" | "UNKNOWN";

export interface RuntimeDetection<T extends string> {
  version: T;
  source: string;
  supported: boolean;
}

export interface ProjectWarning {
  code:
    | "AMBIGUOUS_PROJECT"
    | "UNSUPPORTED_JAVA_VERSION"
    | "UNSUPPORTED_NODE_VERSION"
    | "JAVA_RUNTIME_MISMATCH"
    | "NODE_RUNTIME_MISMATCH"
    | "INVALID_PACKAGE_JSON";
  message: string;
}

export interface ProjectAnalysis {
  projectType: ProjectType;
  projectRoots: readonly string[];
  projectManifests: readonly { root: string; type: "MAVEN" | "NPM" | "PYTHON" | "GRADLE" }[];
  java?: RuntimeDetection<string>;
  node?: RuntimeDetection<string>;
  recommendedRuntime: {
    java: JavaVersion;
    node: NodeVersion;
  };
  warnings: readonly ProjectWarning[];
}

export interface AnalyzeProjectOptions {
  workspaceRuntimeProfile?: RuntimeProfileId;
}

export function analyzeProjectArchive(
  archive: Uint8Array,
  validation: ArchiveValidationResult,
  options: AnalyzeProjectOptions = {}
): ProjectAnalysis {
  const candidates = discoverMetadataPaths(validation);
  const contents = readZipTextEntries(archive, candidates.metadataPaths);
  const warnings: ProjectWarning[] = [];

  const pomPaths = candidates.pomPaths;
  const packagePaths = candidates.packagePaths;
  const pythonPaths = candidates.pythonPaths;
  const gradlePaths = candidates.gradlePaths;
  const kinds = [pomPaths.length > 0 ? "MAVEN" : undefined, packagePaths.length > 0 ? "NPM" : undefined, pythonPaths.length > 0 ? "PYTHON" : undefined, gradlePaths.length > 0 ? "GRADLE" : undefined].filter(Boolean);
  const projectType: ProjectType = kinds.length === 0 ? "UNKNOWN"
    : kinds.length === 1 ? kinds[0] as ProjectType
    : kinds.length === 2 && kinds.includes("MAVEN") && kinds.includes("NPM") ? "MAVEN_NPM" : "MIXED";

  const manifests = [...pomPaths.map(path => ({ root: parentPath(path), type: "MAVEN" as const })), ...packagePaths.map(path => ({ root: parentPath(path), type: "NPM" as const })),
    ...pythonPaths.map(path => ({ root: parentPath(path), type: "PYTHON" as const })),
    ...gradlePaths.map(path => ({ root: parentPath(path), type: "GRADLE" as const }))];
  const roots = [...new Set(manifests.map(item => item.root))].sort();
  if (pomPaths.length > 1 || packagePaths.length > 1 || new Set(pythonPaths.map(parentPath)).size > 1 || gradlePaths.length > 1) {
    warnings.push({
      code: "AMBIGUOUS_PROJECT",
      message: `Multiple project manifests detected (${pomPaths.length} pom.xml, ${packagePaths.length} package.json, ${pythonPaths.length} Python manifests, ${gradlePaths.length} Gradle roots)`
    });
  }

  const java = detectJava(pomPaths, contents) ?? detectGradleJava(gradlePaths, contents);
  const node = detectNode(packagePaths, contents, candidates.nodeVersionPaths, warnings);

  if (java !== undefined && !java.supported) {
    warnings.push({
      code: "UNSUPPORTED_JAVA_VERSION",
      message: `Project requests Java ${java.version} from ${java.source}; supported versions are ${SUPPORTED_JAVA_VERSIONS.join(", ")}`
    });
  }
  if (node !== undefined && !node.supported) {
    warnings.push({
      code: "UNSUPPORTED_NODE_VERSION",
      message: `Project requests Node ${node.version} from ${node.source}; supported versions are ${SUPPORTED_NODE_VERSIONS.join(", ")}`
    });
  }

  const recommendedJava = supportedJava(java?.version) ?? DEFAULT_JAVA_VERSION;
  const recommendedNode = supportedNode(node?.version) ?? DEFAULT_NODE_VERSION;

  if (options.workspaceRuntimeProfile !== undefined) {
    const locked = parseRuntimeProfile(options.workspaceRuntimeProfile);
    if (java?.supported === true && java.version !== locked.java) {
      warnings.push({
        code: "JAVA_RUNTIME_MISMATCH",
        message: `Project requests Java ${java.version}, but workspace is locked to Java ${locked.java}`
      });
    }
    if (node?.supported === true && node.version !== locked.node) {
      warnings.push({
        code: "NODE_RUNTIME_MISMATCH",
        message: `Project requests Node ${node.version}, but workspace is locked to Node ${locked.node}`
      });
    }
  }

  return {
    projectType,
    projectRoots: roots,
    projectManifests: manifests,
    ...(java !== undefined ? { java } : {}),
    ...(node !== undefined ? { node } : {}),
    recommendedRuntime: { java: recommendedJava, node: recommendedNode },
    warnings
  };
}

function discoverMetadataPaths(validation: ArchiveValidationResult): {
  pomPaths: string[];
  packagePaths: string[];
  pythonPaths: string[];
  gradlePaths: string[];
  nodeVersionPaths: string[];
  metadataPaths: string[];
} {
  const paths = validation.entries.filter((entry) => !entry.directory).map((entry) => entry.path);
  const pomPaths = paths.filter((path) => basename(path) === "pom.xml" && !ignoredPath(path)).sort();
  const packagePaths = paths.filter((path) => basename(path) === "package.json" && !ignoredPath(path)).sort();
  const pythonPaths = paths.filter(path =>
    ["pyproject.toml", "requirements.txt", "uv.lock"].includes(basename(path)) && !ignoredPath(path)
  ).sort();
  const allGradlePaths = paths.filter(path => ["build.gradle", "build.gradle.kts"].includes(basename(path)) && !ignoredPath(path)).sort();
  const gradlePaths = [...new Map(allGradlePaths.map(path => [parentPath(path), path])).values()];
  // Multiple Python metadata files in one directory represent a single project.
  const selectedPythonPaths = [...new Map(pythonPaths.map(path => [parentPath(path), path])).values()];
  const roots = [...new Set([...pomPaths, ...packagePaths, ...selectedPythonPaths, ...gradlePaths].map(parentPath))];
  const nodeVersionPaths = paths.filter((path) => {
    const base = basename(path);
    if (base !== ".nvmrc" && base !== ".node-version") return false;
    const root = parentPath(path);
    return roots.length === 0 || roots.includes(root);
  }).sort();
  return {
    pomPaths,
    packagePaths,
    pythonPaths: selectedPythonPaths,
    gradlePaths,
    nodeVersionPaths,
    metadataPaths: [...new Set([...pomPaths, ...packagePaths, ...gradlePaths, ...nodeVersionPaths])]
  };
}

/** A conservative Java toolchain hint; Gradle Kotlin and Groovy project scripts are untrusted text. */
function detectGradleJava(paths: readonly string[], contents: ReadonlyMap<string, string>): RuntimeDetection<string> | undefined {
  for (const path of paths) {
    const script = contents.get(path);
    if (!script) continue;
    const match = /JavaLanguageVersion\\.of\\(\\s*(17|21|25|\\d{1,3})\\s*\\)/.exec(script);
    if (match?.[1]) return {version: match[1], source: path + ":toolchain",
      supported: supportedJava(match[1]) !== undefined};
  }
  return undefined;
}

function detectJava(
  pomPaths: readonly string[],
  contents: ReadonlyMap<string, string>
): RuntimeDetection<string> | undefined {
  if (pomPaths.length === 0) return undefined;
  const path = pomPaths[0]!;
  const pom = contents.get(path);
  if (pom === undefined) return undefined;

  const properties = parseXmlSimpleProperties(pom);
  const candidates: Array<[string, string | undefined]> = [
    ["maven.compiler.release", properties.get("maven.compiler.release")],
    ["java.version", properties.get("java.version")],
    ["maven.compiler.source", properties.get("maven.compiler.source")],
    ["maven.compiler.target", properties.get("maven.compiler.target")]
  ];

  for (const [key, raw] of candidates) {
    const resolved = resolveProperty(raw, properties);
    const major = extractMajor(resolved);
    if (major !== undefined) {
      return { version: major, source: `${path}:${key}`, supported: supportedJava(major) !== undefined };
    }
  }
  return undefined;
}

function detectNode(
  packagePaths: readonly string[],
  contents: ReadonlyMap<string, string>,
  nodeVersionPaths: readonly string[],
  warnings: ProjectWarning[]
): RuntimeDetection<string> | undefined {
  if (packagePaths.length === 0 && nodeVersionPaths.length === 0) return undefined;
  const packagePath = packagePaths[0];
  const root = packagePath === undefined ? "" : parentPath(packagePath);
  const nearbyVersionFiles = nodeVersionPaths.filter((path) => parentPath(path) === root);

  for (const name of [".nvmrc", ".node-version"] as const) {
    const path = nearbyVersionFiles.find((candidate) => basename(candidate) === name);
    if (path !== undefined) {
      const major = extractMajor(contents.get(path)?.trim());
      if (major !== undefined) {
        return { version: major, source: path, supported: supportedNode(major) !== undefined };
      }
    }
  }

  if (packagePath === undefined) return undefined;
  const raw = contents.get(packagePath);
  if (raw === undefined) return undefined;
  let pkg: unknown;
  try {
    pkg = JSON.parse(raw);
  } catch {
    warnings.push({ code: "INVALID_PACKAGE_JSON", message: `${packagePath} is not valid JSON` });
    return undefined;
  }
  if (!isRecord(pkg)) return undefined;

  const volta = isRecord(pkg.volta) ? pkg.volta.node : undefined;
  if (typeof volta === "string") {
    const major = extractMajor(volta);
    if (major !== undefined) {
      return { version: major, source: `${packagePath}:volta.node`, supported: supportedNode(major) !== undefined };
    }
  }
  const engines = isRecord(pkg.engines) ? pkg.engines.node : undefined;
  if (typeof engines === "string") {
    const major = extractMajor(engines);
    if (major !== undefined) {
      return { version: major, source: `${packagePath}:engines.node`, supported: supportedNode(major) !== undefined };
    }
  }
  return undefined;
}

function parseXmlSimpleProperties(xml: string): Map<string, string> {
  const properties = new Map<string, string>();
  const regex = /<([A-Za-z0-9_.-]+)>\s*([^<]+?)\s*<\/\1>/g;
  for (const match of xml.matchAll(regex)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) properties.set(key, value.trim());
  }
  return properties;
}

function resolveProperty(raw: string | undefined, properties: ReadonlyMap<string, string>): string | undefined {
  if (raw === undefined) return undefined;
  const match = /^\$\{([^}]+)\}$/.exec(raw.trim());
  return match?.[1] !== undefined ? properties.get(match[1]) : raw.trim();
}

function extractMajor(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const match = /(?:^|[^0-9])(\d{1,3})(?:\.|\b)/.exec(raw.trim());
  return match?.[1];
}

function supportedJava(version: string | undefined): JavaVersion | undefined {
  return SUPPORTED_JAVA_VERSIONS.find((candidate) => candidate === version);
}

function supportedNode(version: string | undefined): NodeVersion | undefined {
  return SUPPORTED_NODE_VERSIONS.find((candidate) => candidate === version);
}

function parseRuntimeProfile(id: RuntimeProfileId): { java: JavaVersion; node: NodeVersion } {
  if (id === "playwright-chromium-node22") return { java: "21", node: "22" };
  const match = /^java(17|21|25)-node(20|22)$/.exec(id);
  if (match === null) throw new Error(`Invalid runtime profile id: ${id}`);
  return { java: match[1] as JavaVersion, node: match[2] as NodeVersion };
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function parentPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

function ignoredPath(path: string): boolean {
  const normalized = `/${path.replaceAll("\\", "/")}/`;
  return ["/node_modules/", "/target/", "/.git/", "/.venv/", "/venv/", "/site-packages/", "/__pycache__/", "/dist/"].some(part => normalized.includes(part));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
