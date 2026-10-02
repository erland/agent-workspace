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
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096)
  }).strict()
]);
export const PrototypeScreenshotInputSchema = z.object({
  workspaceId: z.string().min(1),
  viewport: ScreenshotViewportSchema.optional()
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
    failureSummary: z.string().optional(),
    logExcerpt: z.string().optional()
  })
}).strict();
