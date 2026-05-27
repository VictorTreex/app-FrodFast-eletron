/**
 * Converte imagens (JPEG/PNG) para WebP no client antes do upload.
 * - Qualidade 0.82 — equilíbrio entre nitidez e leveza (~30% menor que 0.9)
 * - Redimensiona para no máximo 1200px (suficiente para cards, carrega bem no mobile)
 * - Pula GIF/SVG/WebP (já otimizados ou animados)
 * - Fallback: se a conversão falhar por qualquer motivo, devolve o arquivo original
 *   para nunca quebrar o upload.
 */

const MAX_DIMENSION = 1200;
const WEBP_QUALITY = 0.82;

const SKIP_TYPES = new Set(["image/webp", "image/gif", "image/svg+xml"]);

export async function compressToWebp(file: File): Promise<File> {
  try {
    if (!file.type.startsWith("image/")) return file;
    if (SKIP_TYPES.has(file.type)) return file;
    if (typeof document === "undefined") return file;

    const bitmap = await loadBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_DIMENSION);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", WEBP_QUALITY),
    );
    if (!blob) return file;

    // Se o WebP ficou maior que o original (raro, mas possível em PNGs já comprimidos),
    // mantém o arquivo original.
    if (blob.size >= file.size && file.type !== "image/png") return file;

    const newName = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return new File([blob], newName, { type: "image/webp", lastModified: Date.now() });
  } catch {
    return file;
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fallthrough
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function fitWithin(w: number, h: number, max: number) {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = w > h ? max / w : max / h;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}
