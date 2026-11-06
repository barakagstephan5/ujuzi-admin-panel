const MAX_SIDE = 1280;
const TARGET_BYTES = 300 * 1024;

const encode = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// Makes a cover light before upload: at most 1280 px on the long side and about
// 300 KB. Browsers that cannot write WebP send a JPEG.
export async function makeCover(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('Could not read this photo. Use a JPG, PNG or WebP image.'); }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const type = (await encode(canvas, 'image/webp', 0.8))?.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  if (type === 'image/jpeg') {
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  let blob;
  for (const quality of [0.8, 0.7, 0.6, 0.5]) {
    blob = await encode(canvas, type, quality);
    if (blob && blob.size <= TARGET_BYTES) break;
  }
  if (!blob) throw new Error('Could not prepare this photo. Try another one.');
  return blob;
}
