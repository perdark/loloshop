/**
 * Downscale a picked image in the browser BEFORE it is uploaded.
 *
 * Why this exists: students attach logos and reference photos straight from a phone
 * camera roll. Those files are 3-8 MB, and on the mobile uplinks this shop actually runs
 * on that is 20-50 seconds behind a spinner with no progress. The server shrinks these
 * too (`backend/lib/upload.js`), but that only helps the people who DOWNLOAD the photo —
 * the bytes still have to crawl up the wire first. This is the only fix for the upload leg.
 *
 * Policy is kept deliberately identical to the server's so the two layers can't disagree:
 * cap the long edge at 2000px, keep PNG when the image has transparency, JPEG otherwise.
 *
 * This NEVER throws and NEVER rejects. Any failure — an unsupported codec (Android Chrome
 * cannot decode HEIC), a tainted canvas, an out-of-memory bitmap on a low-end device —
 * returns the original File untouched and lets the server deal with it. A slow upload is
 * a far better outcome than a blocked one.
 */

/** Matches REENCODE_MIN_BYTES in backend/lib/upload.js — below this it isn't worth it. */
const MIN_BYTES = 500 * 1024;
/** Matches MAX_IMAGE_DIMENSION in backend/lib/upload.js. */
const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 0.85;

/** Any pixel that isn't fully opaque means we must not flatten to JPEG (black background). */
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const { data } = ctx.getImageData(0, 0, w, h);
    // Stride of 4 pixels (16 bytes). Real transparency in a logo covers large regions,
    // so this cannot plausibly miss one, and it keeps the scan cheap on a slow phone.
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    // getImageData can throw on a tainted canvas — assume alpha and keep PNG (lossless).
    return true;
  }
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    // `from-image` applies the EXIF orientation, so portrait phone shots stop
    // arriving sideways once the EXIF block is dropped by the re-encode.
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= MIN_BYTES) return file;
  if (typeof document === "undefined") return file;

  let bitmap: ImageBitmap | HTMLImageElement | null = null;
  try {
    bitmap = await decode(file);
    const srcW = "width" in bitmap ? bitmap.width : 0;
    const srcH = "height" in bitmap ? bitmap.height : 0;
    if (!srcW || !srcH) return file;

    // Never upscale — a small-but-heavy image only needs re-encoding.
    const scale = Math.min(1, MAX_DIMENSION / Math.max(srcW, srcH));
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return file;
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);

    const keepAlpha = file.type === "image/png" && hasTransparency(ctx, w, h);
    const type = keepAlpha ? "image/png" : "image/jpeg";

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, keepAlpha ? undefined : JPEG_QUALITY)
    );
    // A "compressed" file that grew is not an optimisation.
    if (!blob || blob.size >= file.size) return file;

    // The API rejects a MIME/extension mismatch (`imageFilter` in backend/lib/upload.js),
    // and FormData sends `file.name` verbatim — so the extension HAS to be rewritten
    // whenever a PNG was flattened to JPEG, or the upload 400s.
    const base = file.name.replace(/\.[^./\\]+$/, "") || "upload";
    const name = `${base}${keepAlpha ? ".png" : ".jpg"}`;
    return new File([blob], name, { type, lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    if (bitmap && "close" in bitmap) bitmap.close();
  }
}
