export interface ClipboardImageItem {
  kind: string;
  type: string;
  getAsFile: () => File | null;
}

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

function isSupportedImageType(type: string): boolean {
  return SUPPORTED_IMAGE_TYPES.has(type.toLowerCase());
}

function ensureImageFilename(file: File, fallbackType = file.type): File {
  if (file.name && file.type) return file;

  const type = file.type || fallbackType;
  const extension = type === 'image/jpeg' ? 'jpg' : type.split('/')[1] || 'png';
  const filename = file.name || `pasted-image.${extension}`;

  return new File([file], filename, {
    type,
    lastModified: file.lastModified,
  });
}

export function getImageFileFromClipboardItems(
  items: Iterable<ClipboardImageItem>
): File | null {
  for (const item of items) {
    if (item.kind !== 'file' || !isSupportedImageType(item.type)) continue;

    const file = item.getAsFile();
    if (file) return ensureImageFilename(file, item.type);
  }

  return null;
}

export function getImageFileFromDroppedFiles(
  files: Iterable<File>
): File | null {
  for (const file of files) {
    if (isSupportedImageType(file.type)) return ensureImageFilename(file);
  }

  return null;
}

export function getFileDropEffect(
  hasFiles: boolean,
  disabled: boolean,
  busy: boolean
): 'copy' | 'none' | null {
  if (!hasFiles) return null;
  return disabled || busy ? 'none' : 'copy';
}

export function isCurrentMediaUpload(
  uploadId: number,
  activeUploadId: number,
  mounted: boolean
): boolean {
  return mounted && uploadId === activeUploadId;
}
