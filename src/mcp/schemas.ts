import * as z from "zod/v4";
import { DEFAULT_ARCHIVE_LIMITS } from "../archive/archive-validator.js";

export const MAX_ARCHIVE_BASE64_CHARS = Math.ceil(DEFAULT_ARCHIVE_LIMITS.maxCompressedBytes / 3) * 4;

export const EmptyInputSchema = z.object({}).strict();
export const WorkspaceIdInputSchema = z.object({ workspaceId: z.string().min(1) }).strict();
export const WorkspaceCreateInputSchema = z.object({
  java: z.enum(["17", "21", "25"]).optional(),
  node: z.enum(["20", "22"]).optional(),
  lifetimeMinutes: z.number().positive().max(60).optional()
}).strict();

export const OpenAIFileParameterSchema = z.object({
  download_url: z.string().url(),
  file_id: z.string().min(1),
  mime_type: z.string().optional(),
  file_name: z.string().min(1).max(255).optional()
}).strict();

export const WorkspaceUploadZipInputSchema = z.object({
  workspaceId: z.string().min(1),
  filename: z.string().min(1).max(255).default("project.zip"),
  archive: OpenAIFileParameterSchema.optional(),
  archiveBase64: z.string().min(1).max(MAX_ARCHIVE_BASE64_CHARS).optional()
}).strict().refine(
  (input) => (input.archive === undefined) !== (input.archiveBase64 === undefined),
  { message: "Exactly one of archive or archiveBase64 must be supplied" }
);

export const WorkspaceUploadZipFromUrlInputSchema = z.object({
  workspaceId: z.string().min(1),
  url: z.string().url(),
  filename: z.string().min(1).max(255).default("project.zip")
}).strict();

export const ScreenshotViewportSchema = z.union([
  z.enum(["desktop", "tablet", "mobile"]),
  z.object({
    device: z.enum(["iphone", "iphone-large", "ipad", "android", "android-large"]),
    orientation: z.enum(["portrait", "landscape"]).default("portrait")
  }).strict(),
  z.object({
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096)
  }).strict()
]);
export const PrototypeScreenshotInputSchema = z.object({
  workspaceId: z.string().min(1),
  viewport: ScreenshotViewportSchema.optional()
}).strict();

export const PrototypeScreenshotGalleryInputSchema = z.object({
  workspaceId: z.string().min(1),
  screenshots: z.array(z.object({
    artifactId: z.string().min(1).max(128),
    label: z.string().min(1).max(80),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional()
  }).strict()).min(1).max(12),
  selectedArtifactId: z.string().min(1).max(128).optional()
}).strict();

export const JsonObjectOutputSchema = z.object({ result: z.unknown() }).strict();
export const ScreenshotOutputSchema = z.object({
  result: z.object({
    status: z.enum(["PASSED", "FAILED"]),
    mimeType: z.literal("image/png").optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    durationMs: z.number(),
    resourceUri: z.string().optional(),
    fileName: z.string().optional(),
    byteSize: z.number().int().nonnegative().optional(),
    artifactId: z.string().optional(),
    failureSummary: z.string().optional(),
    logExcerpt: z.string().optional()
  })
}).strict();


export const ScreenshotGalleryOutputSchema = z.object({
  result: z.object({
    status: z.literal("PASSED"),
    selectedArtifactId: z.string(),
    screenshots: z.array(z.object({
      artifactId: z.string(),
      label: z.string(),
      mimeType: z.literal("image/png"),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      resourceUri: z.string(),
      fileName: z.string(),
      byteSize: z.number().int().nonnegative()
    }).strict()).min(1)
  }).strict()
}).strict();


export const PrototypePreviewOutputSchema = z.object({
  result: z.object({
    status: z.literal("AVAILABLE"),
    url: z.string().url(),
    expiresAt: z.string(),
    access: z.literal("temporary-public"),
    port: z.number().int().positive()
  }).strict()
}).strict();


export const ProjectBuildInputSchema = z.object({
  workspaceId: z.string().min(1),
  outputs: z.array(z.object({
    path: z.string().min(1).max(512).describe("Project-relative path to a build output. May name either a single file or a directory. Files are published unchanged; directories are packaged as .tar.gz artifacts."),
    name: z.string().min(1).max(120).optional().describe("Optional human-readable artifact name. For directories this also forms the archive filename."),
    kind: z.string().min(1).max(80).optional().describe("Optional artifact kind label such as static-web, jar, war, zip, or report.")
  }).strict()).max(12).optional().describe("Explicit build outputs to publish. When omitted, Agent Workspace detects conventional npm or Maven outputs.")
}).strict();

export const ArtifactIdInputSchema = z.object({
  artifactId: z.string().min(1).max(128)
}).strict();

export const ArtifactOutputSchema = z.object({
  result: z.object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string(),
    kind: z.string(),
    filename: z.string(),
    mediaType: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
    resourceUri: z.string().optional()
  }).passthrough()
}).strict();
