// Shrinks a phone photo before it is stored or uploaded. Phone cameras produce 2–5 MB images;
// at most 2000 px on the longest side and JPEG quality 0.85 keeps a vendor's bill readable and
// spoilage visible, at roughly a tenth of the size. Uses the browser's own canvas, no library.

export const PHOTO_MAX_SIDE = 2000;
export const PHOTO_QUALITY = 0.85;

export async function shrinkPhoto(file: File): Promise<{ file: Blob; filename: string }> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return { file, filename: file.name };
  let bitmap: ImageBitmap;
  try {
    // 'from-image' applies the camera's rotation, so photos are not saved sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { file, filename: file.name }; // a format this browser cannot open (e.g. some HEIC): keep the original
  }
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', PHOTO_QUALITY));
  // Keep whichever is smaller: an already-small photo is never made bigger or re-compressed for nothing.
  if (!blob || blob.size >= file.size) return { file, filename: file.name };
  return { file: blob, filename: `${(file.name || 'photo').replace(/\.[^.]+$/, '')}.jpg` };
}
