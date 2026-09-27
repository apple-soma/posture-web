import type { PostureMeasurement } from './postureMeasurement';
import { REFERENCE_CRITERIA, type ReferenceCriterion } from './referenceCriteria';
export type EvaluationStatus = 'REFERENCE' | 'OUTSIDE_REFERENCE' | 'RESEARCH_CUTOFF' | 'INSUFFICIENT_EVIDENCE' | 'MEASUREMENT_UNRELIABLE';
export type EvaluationResult = { measurementId: string; value?: number; unit: 'degree' | 'pixel' | 'normalized'; status: EvaluationStatus; reference?: ReferenceCriterion; explanation: string; confidence?: number };
const noEvidence = (measurementId: string, value: number | undefined, unit: EvaluationResult['unit']): EvaluationResult => ({ measurementId, value, unit, status: 'INSUFFICIENT_EVIDENCE', explanation: 'この測定値について、現在登録されている十分な評価基準はありません。' });
export function evaluateMeasurements(measurement: PostureMeasurement | null, confidence: number): EvaluationResult[] {
  if (!measurement) return [{ measurementId: 'measurement', unit: 'normalized', status: 'MEASUREMENT_UNRELIABLE', explanation: '必要な身体部位を十分に検出できなかったため、評価できません。', confidence }];
  const front = ['shoulderTilt', 'pelvisTilt'] as const;
  const results = front.filter(id => measurement[id] !== undefined).map(id => noEvidence(id, measurement[id], 'degree'));
  for (const id of ['earOffset', 'shoulderOffset', 'hipOffset', 'kneeOffset', 'ankleOffset'] as const) if (measurement[id] !== undefined) results.push(noEvidence(id, measurement[id], 'normalized'));
  const criterion = REFERENCE_CRITERIA.find(item => item.measurementId === 'cva');
  if (measurement.cva == null) results.unshift({ measurementId: 'cva', unit: 'degree', status: 'MEASUREMENT_UNRELIABLE', explanation: 'CVAを測定できません。C7の位置を手動で指定してください。', confidence });
  else if (criterion?.cutoff != null) results.unshift({ measurementId: 'cva', value: measurement.cva, unit: 'degree', status: measurement.cva < criterion.cutoff ? 'RESEARCH_CUTOFF' : 'REFERENCE', reference: criterion, confidence, explanation: measurement.cva < criterion.cutoff ? '今回の測定値は、この研究で報告された識別カットオフを下回っています。' : '今回の測定値は、この研究で報告された識別カットオフ以上です。' });
  return results;
}
