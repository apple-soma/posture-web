// Uploaded posture photos (for people who cannot take the shots alone).
// The image is decoded and analysed in the browser only; it is never sent anywhere.

type View = 'front' | 'side';
type Segment = 'upper' | 'lower';
type Landmark = { x: number; y: number; visibility?: number };

const MAX_EDGE = 1920; // keeps detection fast and the in-memory data URL small
const MIN_VISIBILITY = .5;

export type LoadedPhoto = { canvas: HTMLCanvasElement; dataUrl: string; width: number; height: number };

export async function loadPhoto(file: File): Promise<LoadedPhoto> {
  if (!file.type.startsWith('image/')) throw new Error('not-image');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode(); // browsers apply the EXIF orientation when drawing
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.round(image.naturalWidth * scale), height = Math.round(image.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
    return { canvas, dataUrl: canvas.toDataURL('image/jpeg', .9), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const visible = (landmarks: Landmark[], index: number) => (landmarks[index]?.visibility ?? 1) >= MIN_VISIBILITY;
// For side photos only the near side needs to be visible; the far side is usually hidden.
const eitherSide = (landmarks: Landmark[], left: number[], right: number[]) => left.every(i => visible(landmarks, i)) || right.every(i => visible(landmarks, i));

// Returns null when the landmarks needed for this photo are visible, otherwise a message.
export function checkUploadedPose(landmarks: Landmark[] | null, view: View, segment: Segment): string | null {
  if (!landmarks?.length) return '人物を検出できませんでした。全身が明るく写った写真を選んでください。';
  const ok = view === 'front'
    ? (segment === 'upper' ? [0, 11, 12, 23, 24] : [23, 24, 25, 26, 27, 28]).every(i => visible(landmarks, i))
    : segment === 'upper'
      ? visible(landmarks, 0) && eitherSide(landmarks, [7, 11, 23], [8, 12, 24])
      : eitherSide(landmarks, [23, 25, 27], [24, 26, 28]);
  if (ok) return null;
  return segment === 'upper'
    ? '頭・肩・骨盤の一部を認識できませんでした。頭から骨盤までがはっきり写った写真を選んでください。'
    : '骨盤・膝・足首の一部を認識できませんでした。骨盤から足首までがはっきり写った写真を選んでください。';
}
