export interface NodeProjectMetadata {
  packageManager?: unknown;
  hasPackageLock?: unknown;
  hasPnpmLock?: unknown;
  scripts?: Record<string, unknown>;
}

export type NodePackageManager = "npm" | "pnpm";

export function selectNodePackageManager(info: NodeProjectMetadata): {
  manager: NodePackageManager;
  install: string[];
  test: string[];
  build: string[];
} {
  const declared = typeof info.packageManager === "string" ? info.packageManager.trim() : "";
  const name = declared.split("@")[0];
  // Do not silently run npm when the manifest explicitly requires an unsupported manager.
  if (declared && !["npm", "pnpm"].includes(name)) {
    throw new Error(`Unsupported packageManager: ${declared}`);
  }
  if (declared && !/^(@?)(npm|pnpm)@[^\s]+$/.test(declared)) {
    throw new Error(`Invalid packageManager declaration: ${declared}`);
  }
  const manager: NodePackageManager = name === "pnpm" || (!declared && info.hasPnpmLock === true) ? "pnpm" : "npm";
  if (manager === "pnpm" && info.hasPackageLock === true && info.hasPnpmLock !== true) {
    throw new Error("pnpm selected but pnpm-lock.yaml is missing while package-lock.json exists");
  }
  const locked = manager === "pnpm" ? info.hasPnpmLock === true : info.hasPackageLock === true;
  return {
    manager,
    install: manager === "pnpm"
      ? ["pnpm", "install", ...(locked ? ["--frozen-lockfile"] : ["--no-frozen-lockfile"])]
      : locked ? ["npm", "ci", "--no-audit", "--no-fund"] : ["npm", "install", "--no-audit", "--no-fund"],
    test: [manager, "test"],
    build: [manager, "run", "build"]
  };
}

export const NODE_PROJECT_INSPECTION = [
  "const fs=require('fs');",
  "const p=JSON.parse(fs.readFileSync('package.json','utf8'));",
  "process.stdout.write(JSON.stringify({packageManager:p.packageManager,hasPackageLock:fs.existsSync('package-lock.json'),hasPnpmLock:fs.existsSync('pnpm-lock.yaml'),scripts:p.scripts||{}}));"
].join("");
