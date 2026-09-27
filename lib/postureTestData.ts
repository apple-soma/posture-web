export type TestPoseState = 'normal' | 'smallJitter' | 'tooClose' | 'tooFar' | 'left' | 'right' | 'feetOutside' | 'headOutside' | 'unstable' | 'lowConfidence' | 'tiltedShoulderFront' | 'tiltedPelvisFront' | 'normalSide' | 'forwardHeadSide' | 'cvaAboveCutoff' | 'cvaBelowCutoff';

export type TestScenario = {
  id: string;
  label: string;
  frames: TestPoseState[];
};

type Landmark = { x: number; y: number; z: number; visibility: number; presence: number };

const posePoints: Record<number, [number, number]> = {
  0: [.5, .13], 7: [.45, .16], 8: [.55, .16],
  11: [.37, .30], 12: [.63, .305], 13: [.31, .45], 14: [.69, .45], 15: [.29, .58], 16: [.71, .58],
  23: [.43, .58], 24: [.57, .585], 25: [.44, .75], 26: [.56, .75], 27: [.43, .90], 28: [.57, .90],
  29: [.40, .92], 30: [.54, .92], 31: [.45, .94], 32: [.59, .94],
};

export const testStateLabels: Record<TestPoseState, string> = {
  normal: '正常', smallJitter: '小さな揺れ', tooClose: '近すぎる', tooFar: '遠すぎる', left: '左寄り', right: '右寄り',
  feetOutside: '足が画面外', headOutside: '頭が画面外', unstable: '不安定', lowConfidence: '低信頼',
  tiltedShoulderFront: '肩傾き（正面）', tiltedPelvisFront: '骨盤傾き（正面）', normalSide: '正常（側面）', forwardHeadSide: '頭部前方（側面）',
  cvaAboveCutoff: 'CVA・カットオフを上回る', cvaBelowCutoff: 'CVA・カットオフを下回る',
};

export const testScenarios: TestScenario[] = [
  { id: 'SCENARIO_01', label: '正常 → 準備OK → 撮影成功', frames: Array(48).fill('normal') },
  { id: 'SCENARIO_02', label: '全身不足 → 正常 → 撮影成功', frames: [...Array(8).fill('feetOutside'), ...Array(48).fill('normal')] },
  { id: 'SCENARIO_03', label: 'カウント中に足が画面外 → リセット', frames: [...Array(12).fill('normal'), ...Array(18).fill('feetOutside')] },
  { id: 'SCENARIO_04', label: 'カウント中に身体が移動 → リセット', frames: [...Array(12).fill('normal'), ...Array(18).fill('left')] },
  { id: 'SCENARIO_05', label: '左寄り → 中央 → 撮影成功', frames: [...Array(10).fill('left'), ...Array(48).fill('normal')] },
  { id: 'SCENARIO_06', label: '低信頼 → 正常 → 撮影成功', frames: [...Array(10).fill('lowConfidence'), ...Array(48).fill('normal')] },
  { id: 'SCENARIO_07', label: '不安定で準備OKにならない', frames: Array(60).fill('unstable') },
  { id: 'TEST_SMALL_JITTER', label: '小さな揺れでも撮影成功', frames: Array(60).fill('smallJitter') },
  { id: 'PHASE2_FRONT_SHOULDER', label: '正面・肩ラインの確認', frames: Array(48).fill('tiltedShoulderFront') },
  { id: 'PHASE2_FRONT_PELVIS', label: '正面・骨盤ラインの確認', frames: Array(48).fill('tiltedPelvisFront') },
  { id: 'PHASE2_SIDE_NORMAL', label: '側面・垂直基準線の確認', frames: Array(48).fill('normalSide') },
  { id: 'PHASE2_SIDE_FORWARD_HEAD', label: '側面・頭部オフセットの確認', frames: Array(48).fill('forwardHeadSide') },
  { id: 'TEST_CVA_ABOVE_CUTOFF', label: 'CVA・45.5°を上回る', frames: Array(48).fill('cvaAboveCutoff') },
  { id: 'TEST_CVA_BELOW_CUTOFF', label: 'CVA・45.5°を下回る', frames: Array(48).fill('cvaBelowCutoff') },
];

export function createTestLandmarks(state: TestPoseState, frame = 0): Landmark[] {
  const landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1, presence: 1 }));
  Object.entries(posePoints).forEach(([index, [x, y]]) => { landmarks[Number(index)] = { x, y, z: 0, visibility: 1, presence: 1 }; });

  const move = (dx: number, dy = 0) => Object.values(landmarks).forEach(point => { point.x += dx; point.y += dy; });
  if (state === 'tooClose') { landmarks[0].y = -.02; landmarks[27].y = 1.02; landmarks[28].y = 1.02; }
  if (state === 'tooFar') { Object.values(landmarks).forEach(point => { point.x = .5 + (point.x - .5) * .38; point.y = .5 + (point.y - .5) * .38; }); }
  if (state === 'left') move(-.24);
  if (state === 'right') move(.24);
  if (state === 'feetOutside') { landmarks[27].y = 1.02; landmarks[28].y = 1.02; }
  if (state === 'headOutside') landmarks[0].y = -.02;
  if (state === 'unstable') move(frame % 2 ? .1 : -.1, frame % 2 ? .04 : -.04);
  if (state === 'smallJitter') move(Math.sin(frame * 1.7) * .008, Math.cos(frame * 1.7) * .006);
  if (state === 'lowConfidence') [0, 11, 12, 23].forEach(index => { landmarks[index].visibility = .25; landmarks[index].presence = .25; });
  if (state === 'tiltedShoulderFront') { landmarks[11].y = .27; landmarks[12].y = .34; }
  if (state === 'tiltedPelvisFront') { landmarks[23].y = .55; landmarks[24].y = .63; }
  if (state === 'normalSide' || state === 'forwardHeadSide') {
    const sidePoints: Record<number, [number, number]> = { 0: [.52, .13], 7: [.46, .16], 8: [.54, .16], 11: [.46, .30], 12: [.52, .30], 13: [.43, .45], 14: [.55, .45], 15: [.42, .58], 16: [.57, .58], 23: [.47, .58], 24: [.52, .58], 25: [.48, .75], 26: [.52, .75], 27: [.48, .90], 28: [.52, .90], 29: [.45, .92], 30: [.50, .92], 31: [.49, .94], 32: [.55, .94] };
    Object.entries(sidePoints).forEach(([index, [x, y]]) => { landmarks[Number(index)].x = x; landmarks[Number(index)].y = y; });
    [7, 11, 13, 15, 23, 25, 27, 29, 31].forEach(index => { landmarks[index].visibility = .35; });
    if (state === 'forwardHeadSide') { landmarks[0].x = .64; landmarks[8].x = .61; }
  }
  return landmarks;
}

export function getTestManualC7(state: TestPoseState): { x: number; y: number } | undefined {
  if (state === 'cvaAboveCutoff') return { x: .50, y: .50 };
  if (state === 'cvaBelowCutoff') return { x: .50, y: .42 };
  return undefined;
}
