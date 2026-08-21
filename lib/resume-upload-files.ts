import AdmZip from "adm-zip";
import zlib from "node:zlib";
import { resumeUploadConfig } from "./upload-config";
import { isAllowedResumeUpload, isAllowedResumeZipUpload } from "./resume-upload-validation";

export type UploadableResumeFile = File & {
  sourceArchive?: string;
};

const zipEntryLimit = 50;
const zipMaxExpandedBytes = 40 * 1024 * 1024;
const zipMaxEntryBytes = resumeUploadConfig.maxResumeFileSizeBytes;
// Legitimate resumes (even plain text) rarely compress beyond ~50:1; far higher
// ratios are the signature of a decompression bomb.
const zipMaxCompressionRatio = 120;

const compressionMethodStored = 0;
const compressionMethodDeflated = 8;

function mimeTypeForFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".txt")) {
    return "text/plain";
  }
  return "application/octet-stream";
}

function baseFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/**
 * Decompresses one ZIP entry with a hard output ceiling, so a forged size header
 * cannot trigger an unbounded allocation. Claimed sizes and compression ratios are
 * validated before any inflation happens, and `maxOutputLength` bounds the actual
 * inflated buffer regardless of what the headers claim.
 */
function readZipEntryBytes(entry: AdmZip.IZipEntry, maxBytes: number): Uint8Array<ArrayBuffer> {
  const claimedSize = entry.header.size;
  if (claimedSize > maxBytes) {
    throw new Error(`Zip entry exceeds the ${resumeUploadConfig.maxResumeFileSizeLabel} per-file limit.`);
  }

  const compressed = entry.getCompressedData();

  if (entry.header.method === compressionMethodStored) {
    if (compressed.byteLength > maxBytes) {
      throw new Error(`Zip entry exceeds the ${resumeUploadConfig.maxResumeFileSizeLabel} per-file limit.`);
    }
    return new Uint8Array(compressed);
  }

  if (entry.header.method !== compressionMethodDeflated) {
    throw new Error("Zip entry uses an unsupported compression method.");
  }

  if (compressed.byteLength > 0 && claimedSize / compressed.byteLength > zipMaxCompressionRatio) {
    throw new Error("Zip entry compression ratio is suspicious and was rejected.");
  }

  let inflated: Buffer;
  try {
    inflated = zlib.inflateRawSync(compressed, { maxOutputLength: maxBytes });
  } catch {
    throw new Error("Zip entry could not be safely decompressed.");
  }

  return new Uint8Array(inflated);
}

async function expandZipUpload(file: File): Promise<UploadableResumeFile[]> {
  const zip = new AdmZip(Buffer.from(await file.arrayBuffer()));
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const expanded: UploadableResumeFile[] = [];
  let totalBytes = 0;

  if (entries.length > zipEntryLimit) {
    throw new Error(`Zip contains too many files. Include ${zipEntryLimit} files or fewer.`);
  }

  for (const entry of entries) {
    const fileName = baseFileName(entry.entryName);
    // Nested archives and other unsupported types are skipped, never expanded.
    if (!isAllowedResumeUpload(fileName, mimeTypeForFileName(fileName))) {
      continue;
    }

    const remainingBudget = Math.min(zipMaxEntryBytes, zipMaxExpandedBytes - totalBytes);
    if (remainingBudget <= 0) {
      throw new Error("Zip expands beyond the 40 MB safety limit.");
    }

    const bytes = readZipEntryBytes(entry, remainingBudget);
    totalBytes += bytes.byteLength;
    if (totalBytes > zipMaxExpandedBytes) {
      throw new Error("Zip expands beyond the 40 MB safety limit.");
    }

    const expandedFile = new File([bytes], fileName, {
      type: mimeTypeForFileName(fileName),
      lastModified: file.lastModified
    }) as UploadableResumeFile;
    expandedFile.sourceArchive = file.name;
    expanded.push(expandedFile);
  }

  return expanded;
}

export async function expandResumeUploads(files: File[]) {
  const expanded: UploadableResumeFile[] = [];
  const failures: Array<{ fileName: string; error: string }> = [];

  for (const file of files) {
    try {
      if (isAllowedResumeZipUpload(file.name, file.type)) {
        const zipFiles = await expandZipUpload(file);
        if (!zipFiles.length) {
          failures.push({ fileName: file.name, error: "Zip did not contain any supported resume files." });
        }
        expanded.push(...zipFiles);
      } else {
        expanded.push(file as UploadableResumeFile);
      }
    } catch (error) {
      failures.push({
        fileName: file.name,
        error: error instanceof Error ? error.message : "Could not read zip archive."
      });
    }
  }

  return { files: expanded, failures };
}
