// @vitest-environment node
// adm-zip's archive parsing fails under the jsdom realm (Buffer/typed-array
// identity checks); the upload code runs server-side, so node is the accurate
// environment for these tests anyway.
import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { expandResumeUploads } from "@/lib/resume-upload-files";

function zipFile(name: string, build: (zip: AdmZip) => void) {
  const zip = new AdmZip();
  build(zip);
  return new File([new Uint8Array(zip.toBuffer())], name, { type: "application/zip" });
}

describe("resume upload ZIP expansion", () => {
  it("expands supported resume entries and records the source archive", async () => {
    const file = zipFile("batch.zip", (zip) => {
      zip.addFile("resumes/alex-smith.txt", Buffer.from("Alex Smith\nTypeScript engineer with AWS experience."));
    });

    const result = await expandResumeUploads([file]);

    expect(result.failures).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.name).toBe("alex-smith.txt");
    expect(result.files[0]!.type).toBe("text/plain");
    expect(result.files[0]!.sourceArchive).toBe("batch.zip");
    await expect(result.files[0]!.text()).resolves.toContain("Alex Smith");
  });

  it("passes non-zip files through unchanged", async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "resume.pdf", {
      type: "application/pdf"
    });

    const result = await expandResumeUploads([pdf]);

    expect(result.failures).toEqual([]);
    expect(result.files).toEqual([pdf]);
  });

  it("skips nested archives instead of expanding them", async () => {
    const inner = new AdmZip();
    inner.addFile("hidden.txt", Buffer.from("nested content"));

    const file = zipFile("nested.zip", (zip) => {
      zip.addFile("inner.zip", inner.toBuffer());
    });

    const result = await expandResumeUploads([file]);

    expect(result.files).toEqual([]);
    expect(result.failures).toEqual([
      { fileName: "nested.zip", error: "Zip did not contain any supported resume files." }
    ]);
  });

  it("rejects archives with too many entries", async () => {
    const file = zipFile("many.zip", (zip) => {
      for (let index = 0; index < 51; index += 1) {
        zip.addFile(`resume-${index}.txt`, Buffer.from(`Candidate ${index}`));
      }
    });

    const result = await expandResumeUploads([file]);

    expect(result.files).toEqual([]);
    expect(result.failures[0]?.error).toContain("too many files");
  });

  it("rejects entries with a decompression-bomb compression ratio", async () => {
    const file = zipFile("bomb.zip", (zip) => {
      // 5 MB of a single repeated byte deflates to a few KB: ratio far above the cap.
      zip.addFile("bomb.txt", Buffer.alloc(5 * 1024 * 1024, 0x61));
    });

    const result = await expandResumeUploads([file]);

    expect(result.files).toEqual([]);
    expect(result.failures[0]?.error).toContain("compression ratio");
  });

  it("rejects entries that exceed the per-file size limit before decompressing", async () => {
    const file = zipFile("large.zip", (zip) => {
      const chunk = "The quick brown fox jumps over the lazy dog. ";
      // ~9 MB of varied text stays under the ratio cap but over the 8 MB per-file limit.
      zip.addFile(
        "large.txt",
        Buffer.from(chunk.repeat(Math.ceil((9 * 1024 * 1024) / chunk.length)))
      );
    });

    const result = await expandResumeUploads([file]);

    expect(result.files).toEqual([]);
    expect(result.failures[0]?.error).toContain("per-file limit");
  });
});
