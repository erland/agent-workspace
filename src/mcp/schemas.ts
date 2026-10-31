import * as z from "zod/v4";
import { DEFAULT_ARCHIVE_LIMITS } from "../archive/archive-validator.js";

export const MAX_ARCHIVE_BASE64_CHARS = Math.ceil(DEFAULT_ARCHIVE_LIMITS.maxCompressedBytes / 3) * 4;

export const EmptyInputSchema = z.object({}).strict();
export const WorkspaceIdInputSchema = z.object({ workspaceId: z.string().min(1) }).strict();
export const WorkspaceCreateInputSchema = z.object({
  java: z.enum(["17", "21", "25"]).optional(),
  node: z.enum(["20", "22"]).optional(),
  playwright: z.boolean().optional(),
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

export const JsonObjectOutputSchema = z.object({ result: z.unknown() }).strict();
export const CaptureFilesSchema = z.array(z.string().min(1).max(512)).max(12).optional();
export const ProjectVerifyInputSchema = z.object({ workspaceId: z.string().min(1), projectRoot: z.string().max(512).optional().describe("Optional archive-relative directory containing the pom.xml or package.json to verify"), captureFiles: CaptureFilesSchema }).strict();
export const FileReadInputSchema = z.object({ encoding: z.enum(["utf8", "base64"]).optional(), workspaceId: z.string().min(1).optional(), artifactId: z.string().min(1).optional(), path: z.string().min(1).max(1024).optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(65536).optional() }).strict().refine(x => Boolean(x.workspaceId) !== Boolean(x.artifactId), "Specify exactly one source");
export const ProjectBuildInputSchema = z.object({
  captureFiles: CaptureFilesSchema,
  workspaceId: z.string().min(1),
  projectRoot: z.string().max(512).optional().describe("Optional archive-relative directory containing the pom.xml or package.json to build"),
  outputs: z.array(z.object({
    path: z.string().min(1).max(512).describe("Project-relative path to a build output. May name either a single file or a directory. Files are published unchanged; directories are packaged as .tar.gz artifacts."),
    name: z.string().min(1).max(120).optional().describe("Optional human-readable artifact name. For directories this also forms the archive filename."),
    kind: z.string().min(1).max(80).optional().describe("Optional artifact kind label such as static-web, jar, war, zip, or report.")
  }).strict()).max(12).optional().describe("Explicit build outputs to publish. When omitted, Agent Workspace detects conventional npm or Maven outputs.")
}).strict();

export const ArtifactIdInputSchema = z.object({
  artifactId: z.string().min(1).max(128)
}).strict();


export const ArtifactDownloadLinkOutputSchema = z.object({
  result: z.object({
    artifactId: z.string(),
    filename: z.string(),
    mediaType: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    url: z.string().url(),
    expiresAt: z.string()
  }).strict()
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
