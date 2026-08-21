import mammoth from "mammoth";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";

PDFParse.setWorker(pathToFileURL(path.join(process.cwd(), "node_modules/pdf-parse/dist/worker/pdf.worker.mjs")).href);

const minimumUsefulTextCharacters = 20;

export function normalizeExtractedResumeText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n--\s+\d+\s+of\s+\d+\s+--\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function usefulTextCharacterCount(text: string) {
  return (text.match(/[a-z0-9]/gi) ?? []).length;
}

function pdfBytesContainImageObject(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("latin1").includes("/Subtype /Image");
}

async function pdfHasEmbeddedImages(parser: PDFParse, bytes: Uint8Array) {
  if (pdfBytesContainImageObject(bytes)) {
    return true;
  }

  try {
    const result = await parser.getImage({
      first: 3,
      imageBuffer: false,
      imageDataUrl: false,
      imageThreshold: 0,
    });
    return result.pages.some((page) => page.images.length > 0);
  } catch {
    return pdfBytesContainImageObject(bytes);
  }
}

async function extractTextFromPdfBytes(bytes: Uint8Array) {
  const parser = new PDFParse({ data: Buffer.from(bytes) });

  try {
    let result;
    try {
      result = await parser.getText({
        lineEnforce: true,
        pageJoiner: "\n-- page_number of total_number --\n",
      });
    } catch {
      throw new Error("Could not read PDF resume. The file may be corrupt, encrypted, or an unsupported PDF.");
    }

    const text = normalizeExtractedResumeText(result.text);

    if (!text) {
      if (await pdfHasEmbeddedImages(parser, bytes)) {
        throw new Error("Image-only or scanned PDF resumes are not supported in this MVP. Upload a text-based PDF, DOCX, or TXT resume.");
      }
      throw new Error("The PDF resume appears blank. Upload a resume with extractable text.");
    }

    if (usefulTextCharacterCount(text) < minimumUsefulTextCharacters) {
      if (await pdfHasEmbeddedImages(parser, bytes)) {
        throw new Error("Image-only or scanned PDF resumes are not supported in this MVP. Upload a text-based PDF, DOCX, or TXT resume.");
      }
      throw new Error("PDF text extraction returned too little usable resume text. Upload a text-based PDF, DOCX, or TXT resume.");
    }

    return text;
  } finally {
    await parser.destroy();
  }
}

function bytesStartWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

// File signatures are validated against actual content, never the client-supplied
// extension or MIME type alone.
const pdfSignature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const zipLocalFileSignature = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 (DOCX container)

function looksLikeBinaryText(bytes: Uint8Array) {
  const sample = bytes.subarray(0, 8192);
  return sample.includes(0);
}

export async function extractResumeText(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lowerName = file.name.toLowerCase();

  if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
    if (!bytesStartWith(bytes, pdfSignature)) {
      throw new Error("File content does not match a valid PDF document.");
    }
    return { text: await extractTextFromPdfBytes(bytes), bytes };
  }

  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx")
  ) {
    if (!bytesStartWith(bytes, zipLocalFileSignature)) {
      throw new Error("File content does not match a valid DOCX document.");
    }
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { text: normalizeExtractedResumeText(result.value), bytes };
  }

  if (file.type === "text/plain" || lowerName.endsWith(".txt")) {
    if (looksLikeBinaryText(bytes)) {
      throw new Error("File content does not look like a plain-text resume.");
    }
    return { text: normalizeExtractedResumeText(Buffer.from(bytes).toString("utf8")), bytes };
  }

  throw new Error("Unsupported file type. Upload PDF, DOCX, or TXT resumes.");
}
