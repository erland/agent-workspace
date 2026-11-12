import type { SandboxProvider, WorkspaceHandle } from "../core/sandbox-provider.js";
import { CargoVerifier } from "./cargo-verifier.js";
import { GoVerifier } from "./go-verifier.js";
import { MavenVerifier } from "./maven-verifier.js";
import { GradleVerifier } from "./gradle-verifier.js";
import { NpmVerifier } from "./npm-verifier.js";
import { PythonVerifier } from "./python-verifier.js";
import type { ProjectVerificationResult } from "./verification-result.js";

/** Verifiable project kinds. Kept separate from aggregate/detection-only types. */
export type VerifierKind = "MAVEN" | "NPM" | "PYTHON" | "GRADLE" | "CARGO" | "GO";

/** Implemented by each engine; the sandbox lifecycle remains owned by WorkspaceService. */
export interface ProjectVerifier {
  verify(handle: WorkspaceHandle): Promise<ProjectVerificationResult>;
}

export interface VerifierContext {
  provider: SandboxProvider;
  projectRoot: string;
  playwrightRuntime: boolean;
}

export interface VerifierRegistration {
  kind: VerifierKind;
  /** Files that identify this build system; detection is still managed centrally. */
  manifests: readonly string[];
  create(context: VerifierContext): ProjectVerifier;
}

/**
 * One registry per server; never accepts executable code from uploaded ZIPs.
 * New engines register a factory here, without branching in WorkspaceService.
 */
export class VerifierRegistry {
  private readonly registrations = new Map<VerifierKind, VerifierRegistration>();

  constructor(registrations: readonly VerifierRegistration[]) {
    for (const registration of registrations) {
      if (this.registrations.has(registration.kind)) {
        throw new Error(`Duplicate verifier registration: ${registration.kind}`);
      }
      if (registration.manifests.length === 0) {
        throw new Error(`Verifier has no discovery manifests: ${registration.kind}`);
      }
      this.registrations.set(registration.kind, registration);
    }
  }

  get(kind: VerifierKind): VerifierRegistration {
    const registration = this.registrations.get(kind);
    if (!registration) throw new Error(`No verifier registered for project type: ${kind}`);
    return registration;
  }

  create(kind: VerifierKind, context: VerifierContext): ProjectVerifier {
    return this.get(kind).create(context);
  }

  list(): readonly Pick<VerifierRegistration, "kind" | "manifests">[] {
    return [...this.registrations.values()].map(({ kind, manifests }) => ({ kind, manifests }));
  }
}

export const defaultVerifierRegistry = new VerifierRegistry([
  { kind: "CARGO", manifests: ["Cargo.toml"],
    create: ({provider,projectRoot}) => new CargoVerifier(provider,{projectRoot}) },
  { kind: "GO", manifests: ["go.mod", "go.work"],
    create: ({provider,projectRoot}) => new GoVerifier(provider,{projectRoot}) },
  { kind: "GRADLE", manifests: ["build.gradle", "build.gradle.kts"],
    create: ({provider,projectRoot}) => new GradleVerifier(provider,{projectRoot}) },
  {
    kind: "MAVEN",
    manifests: ["pom.xml"],
    create: ({ provider, projectRoot }) => new MavenVerifier(provider, { projectRoot })
  },
  {
    kind: "NPM",
    manifests: ["package.json"],
    create: ({ provider, projectRoot, playwrightRuntime }) =>
      new NpmVerifier(provider, { projectRoot, playwrightRuntime })
  },
  {
    kind: "PYTHON",
    manifests: ["pyproject.toml", "requirements.txt", "uv.lock"],
    create: ({ provider, projectRoot }) => new PythonVerifier(provider, { projectRoot })
  }
]);
