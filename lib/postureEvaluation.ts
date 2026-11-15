import type { PostureMeasurement } from './postureMeasurement';
import { REFERENCE_CRITERIA, type ReferenceCriterion } from './referenceCriteria';
export type EvaluationStatus = 'REFERENCE' | 'OUTSIDE_REFERENCE' | 'RESEARCH_CUTOFF' | 'INSUFFICIENT_EVIDENCE' | 'MEASUREMENT_UNRELIABLE';
export type EvaluationResult = { measurementId: string; value?: number; unit: 'degree' | 'pixel' | 'normalized'; status: EvaluationStatus; reference?: ReferenceCriterion; explanation: string; confidence?: number };
const noEvidence = (measurementId: string, value: number | undefined, unit: EvaluationResult['unit']): EvaluationResult => ({ measurementId, value, unit, status: 'INSUFFICIENT_EVIDENCE', explanation: 'この測定値について、現在登録されている十分な評価基準はありません。' });
export function evaluateMeasurements(measurement: PostureMeasurement | null, confidence: number): EvaluationResult[] {
  if (!measurement) return [{ measurementId: 'measurement', unit: 'normalized', status: 'MEASUREMENT_UNRELIABLE', explanation: '必要な身体部位を十分に検出できなかったため、評価できません。', confidence }];
  const front = ['shoulderTilt', 'pelvisTilt'] as const;
  const results = front.filter(id => measurement[id] !== undefined).map(id => noEvidence(id, measurement[id], 'degree'));
  // Display-only indicators (spec 6.1): no judgement, value and reference only.
  const displayOnly: Record<'trunkLateralTilt' | 'neckTilt' | 'trunkLean', string> = {
    trunkLateralTilt: '表示・記録のみの指標で、判定はしません。＋は上半身が画像の右側へ傾いている向きです。',
    neckTilt: '表示・記録のみの指標で、判定はしません。＋は耳が肩より前にある向きです。参考値（健康な成人の平均±SD）：男性13.6°±3.2、女性15.4°±3.3。',
    trunkLean: '表示・記録のみの指標で、判定はしません。＋は肩が股関節より前にある向きです。参考値（健康な成人の平均±SD）：男性2.3°±1.4、女性1.5°±1.1。',
  };
  for (const id of ['trunkLateralTilt', 'neckTilt', 'trunkLean'] as const) if (measurement[id] !== undefined) results.push({ measurementId: id, value: measurement[id], unit: 'degree', status: 'INSUFFICIENT_EVIDENCE', explanation: displayOnly[id] });
  for (const id of ['earOffset', 'shoulderOffset', 'hipOffset', 'kneeOffset', 'ankleOffset'] as const) if (measurement[id] !== undefined) results.push(noEvidence(id, measurement[id], 'normalized'));
  const criterion = REFERENCE_CRITERIA.find(item => item.measurementId === 'cva');
  if (measurement.cva == null) results.unshift({ measurementId: 'cva', unit: 'degree', status: 'MEASUREMENT_UNRELIABLE', explanation: 'CVAを測定できません。STEP 2の「側面・上半身」の写真でC7の位置をタップしてください。', confidence });
  else if (criterion?.cutoff != null) results.unshift({ measurementId: 'cva', value: measurement.cva, unit: 'degree', status: measurement.cva < criterion.cutoff ? 'RESEARCH_CUTOFF' : 'REFERENCE', reference: criterion, confidence, explanation: measurement.cva < criterion.cutoff ? '今回の測定値は、この研究で報告された識別カットオフを下回っています。' : '今回の測定値は、この研究で報告された識別カットオフ以上です。' });
  return results;
}
