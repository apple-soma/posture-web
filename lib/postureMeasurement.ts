import type { CaptureType, PosePoint, PoseSkeleton } from '../components/posture/PoseOverlay';

export type Point = { x: number; y: number };
export type CaptureSegment = 'full' | 'upper' | 'lower';
export type ReferenceLineType = 'vertical' | 'horizontal' | 'shoulder' | 'pelvis' | 'plumb';
export type ReferenceLine = { id: string; type: ReferenceLineType; start: Point; end: Point; label?: string };
export type PostureMeasurement = {
  shoulderTilt?: number;
  pelvisTilt?: number;
  earOffset?: number;
  shoulderOffset?: number;
  hipOffset?: number;
  kneeOffset?: number;
  ankleOffset?: number;
  // C7 is not available from Pose Landmarker; it is tapped by the user on the side-upper photo.
  cva: number | null;
};
export type MeasurementOverlay = { referenceLines: ReferenceLine[]; measurement: PostureMeasurement; side?: 'left' | 'right' };

const pointMap = (pose: PoseSkeleton) => new Map(pose.points.map(point => [point.name, point]));
const average = (a: PosePoint, b: PosePoint): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
// Landmarks are normalized separately on each axis, so angles must be computed
// in pixel space. Points are ordered by image x so that MediaPipe's anatomical
// left/right (which appears mirrored in a front photo) does not flip the angle
// to ±180°. A positive value means the image-right point is higher.
const signedHorizontalAngle = (a: Point, b: Point, width: number, height: number) => {
  const [l, r] = a.x <= b.x ? [a, b] : [b, a];
  return Math.atan2(-(r.y - l.y) * height, (r.x - l.x) * width) * 180 / Math.PI;
};
// CVA: angle between the horizontal and the C7→ear line, independent of facing direction.
const craniovertebralAngle = (c7: Point, ear: Point, width: number, height: number) =>
  Math.atan2((c7.y - ear.y) * height, Math.abs(ear.x - c7.x) * width) * 180 / Math.PI;
const offset = (point: PosePoint | undefined, plumbX: number) => point ? point.x - plumbX : undefined;

function visibleSide(points: Map<string, PosePoint>): 'left' | 'right' {
  const names = (side: 'left' | 'right') => [`${side}Ear`, `${side}Shoulder`, `${side}Hip`, `${side}Knee`, `${side}Ankle`];
  const score = (side: 'left' | 'right') => names(side).reduce((total, name) => total + (points.get(name)?.visibility ?? 0), 0);
  return score('left') >= score('right') ? 'left' : 'right';
}

export function createMeasurementOverlay(pose: PoseSkeleton | null, captureType: CaptureType, manualC7?: Point, segment: CaptureSegment = 'full'): MeasurementOverlay | null {
  if (!pose) return null;
  const points = pointMap(pose);
  const width = pose.imageWidth || 1, height = pose.imageHeight || 1;
  if (captureType === 'front') {
    const leftShoulder = points.get('leftShoulder'), rightShoulder = points.get('rightShoulder');
    const leftHip = points.get('leftHip'), rightHip = points.get('rightHip');
    const shoulders = leftShoulder && rightShoulder ? average(leftShoulder, rightShoulder) : undefined;
    const hips = leftHip && rightHip ? average(leftHip, rightHip) : undefined;
    if ((segment !== 'lower' && !shoulders) || !hips) return null;
    const centerX = shoulders ? (shoulders.x + hips.x) / 2 : hips.x;
    return {
      referenceLines: [
        ...(shoulders ? [{ id: 'shoulder-horizontal', type: 'horizontal' as const, start: { x: .08, y: shoulders.y }, end: { x: .92, y: shoulders.y }, label: '肩の水平基準' }, { id: 'shoulder-line', type: 'shoulder' as const, start: leftShoulder!, end: rightShoulder!, label: '肩ライン' }] : []),
        { id: 'pelvis-line', type: 'pelvis', start: leftHip!, end: rightHip!, label: '骨盤ライン' },
        { id: 'body-center', type: 'vertical', start: { x: centerX, y: .08 }, end: { x: centerX, y: .95 }, label: '身体中心線' },
      ],
      measurement: { shoulderTilt: leftShoulder && rightShoulder ? signedHorizontalAngle(leftShoulder, rightShoulder, width, height) : undefined, pelvisTilt: signedHorizontalAngle(leftHip!, rightHip!, width, height), cva: null },
    };
  }

  const side = visibleSide(points);
  const ear = points.get(`${side}Ear`), shoulder = points.get(`${side}Shoulder`), hip = points.get(`${side}Hip`), knee = points.get(`${side}Knee`), ankle = points.get(`${side}Ankle`);
  const reference = segment === 'upper' ? hip : segment === 'lower' ? hip : ankle;
  if (!reference) return null;
  const plumbX = reference.x;
  const cva = manualC7 && ear ? craniovertebralAngle(manualC7, ear, width, height) : null;
  return {
    side,
    referenceLines: [{ id: 'plumb-line', type: 'plumb', start: { x: plumbX, y: .08 }, end: { x: plumbX, y: .95 }, label: segment === 'full' ? '足首を通る垂直基準線' : '股関節を通る垂直基準線' }],
    measurement: {
      earOffset: segment === 'lower' ? undefined : offset(ear, plumbX),
      shoulderOffset: segment === 'lower' ? undefined : offset(shoulder, plumbX),
      hipOffset: offset(hip, plumbX),
      kneeOffset: segment === 'upper' ? undefined : offset(knee, plumbX),
      ankleOffset: segment === 'upper' ? undefined : offset(ankle, plumbX),
      cva,
    },
  };
}

export function toImagePoint(point: Point, imageWidth: number, imageHeight: number): Point {
  return { x: point.x * imageWidth, y: point.y * imageHeight };
}
