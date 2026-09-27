import type { CaptureType, PosePoint, PoseSkeleton } from '../components/posture/PoseOverlay';

export type Point = { x: number; y: number };
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
  // C7 is not available from Pose Landmarker, so this remains unavailable.
  cva: number | null;
};
export type MeasurementOverlay = { referenceLines: ReferenceLine[]; measurement: PostureMeasurement; side?: 'left' | 'right' };

const pointMap = (pose: PoseSkeleton) => new Map(pose.points.map(point => [point.name, point]));
const average = (a: PosePoint, b: PosePoint): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const signedHorizontalAngle = (a: Point, b: Point) => Math.atan2(-(b.y - a.y), b.x - a.x) * 180 / Math.PI;
const offset = (point: PosePoint | undefined, plumbX: number) => point ? point.x - plumbX : undefined;

function visibleSide(points: Map<string, PosePoint>): 'left' | 'right' {
  const names = (side: 'left' | 'right') => [`${side}Ear`, `${side}Shoulder`, `${side}Hip`, `${side}Knee`, `${side}Ankle`];
  const score = (side: 'left' | 'right') => names(side).reduce((total, name) => total + (points.get(name)?.visibility ?? 0), 0);
  return score('left') >= score('right') ? 'left' : 'right';
}

export function createMeasurementOverlay(pose: PoseSkeleton | null, captureType: CaptureType, manualC7?: Point): MeasurementOverlay | null {
  if (!pose) return null;
  const points = pointMap(pose);
  if (captureType === 'front') {
    const leftShoulder = points.get('leftShoulder'), rightShoulder = points.get('rightShoulder');
    const leftHip = points.get('leftHip'), rightHip = points.get('rightHip');
    if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;
    const shoulders = average(leftShoulder, rightShoulder);
    const hips = average(leftHip, rightHip);
    const centerX = (shoulders.x + hips.x) / 2;
    return {
      referenceLines: [
        { id: 'shoulder-horizontal', type: 'horizontal', start: { x: .08, y: shoulders.y }, end: { x: .92, y: shoulders.y }, label: '肩の水平基準' },
        { id: 'shoulder-line', type: 'shoulder', start: leftShoulder, end: rightShoulder, label: '肩ライン' },
        { id: 'pelvis-line', type: 'pelvis', start: leftHip, end: rightHip, label: '骨盤ライン' },
        { id: 'body-center', type: 'vertical', start: { x: centerX, y: .08 }, end: { x: centerX, y: .95 }, label: '身体中心線' },
      ],
      measurement: { shoulderTilt: signedHorizontalAngle(leftShoulder, rightShoulder), pelvisTilt: signedHorizontalAngle(leftHip, rightHip), cva: null },
    };
  }

  const side = visibleSide(points);
  const ear = points.get(`${side}Ear`), shoulder = points.get(`${side}Shoulder`), hip = points.get(`${side}Hip`), knee = points.get(`${side}Knee`), ankle = points.get(`${side}Ankle`);
  if (!ankle) return null;
  const plumbX = ankle.x;
  const cva = manualC7 && ear ? Math.abs(Math.atan2(manualC7.y - ear.y, ear.x - manualC7.x) * 180 / Math.PI) : null;
  return {
    side,
    referenceLines: [{ id: 'plumb-line', type: 'plumb', start: { x: plumbX, y: .08 }, end: { x: plumbX, y: .95 }, label: '足首を通る垂直基準線' }],
    measurement: { earOffset: offset(ear, plumbX), shoulderOffset: offset(shoulder, plumbX), hipOffset: offset(hip, plumbX), kneeOffset: offset(knee, plumbX), ankleOffset: 0, cva },
  };
}

export function toImagePoint(point: Point, imageWidth: number, imageHeight: number): Point {
  return { x: point.x * imageWidth, y: point.y * imageHeight };
}
