// Repeatability log (spec 6.3 / chapter 10-1).
// Stores measured values and landmark coordinates on this device only — never photos —
// so that the same person can be measured several times and SEM / MDC95 estimated.

// v0.1: CVA, shoulder/pelvis tilt. v0.2: + trunk lateral tilt, neck tilt, trunk lean (spec 6.1).
export const CALC_VERSION = 'calc-v0.2';
const STORAGE_KEY = 'posture:measurementLog';

export type LoggedLandmark = { x: number; y: number; z?: number; visibility?: number };
export type LoggedShot = { landmarks: LoggedLandmark[] | null; imageWidth?: number; imageHeight?: number; manualC7?: { x: number; y: number } };
export type ShotKey = 'frontUpper' | 'frontLower' | 'sideUpper' | 'sideLower';

// Add new indicators (spec 6.1) here; CSV columns and the summary follow automatically.
export const LOGGED_METRICS = [
  { key: 'cva', label: 'CVA', unit: '°' },
  { key: 'shoulderTilt', label: '肩の傾き', unit: '°' },
  { key: 'pelvisTilt', label: '骨盤の傾き', unit: '°' },
  { key: 'trunkLateralTilt', label: '体幹の左右の傾き', unit: '°' },
  { key: 'neckTilt', label: '首の傾き', unit: '°' },
  { key: 'trunkLean', label: '体幹の前傾', unit: '°' },
] as const;
export type MetricKey = typeof LOGGED_METRICS[number]['key'];

export type MeasurementRecord = {
  id: string;
  subjectId: string;
  label: string;
  recordedAt: string;
  calcVersion: string;
  source: 'camera' | 'test';
  metrics: Record<MetricKey, number | null>;
  shots: Record<ShotKey, LoggedShot>;
};

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

export function compactShot(shot: LoggedShot): LoggedShot {
  return {
    imageWidth: shot.imageWidth,
    imageHeight: shot.imageHeight,
    manualC7: shot.manualC7 && { x: round(shot.manualC7.x, 5), y: round(shot.manualC7.y, 5) },
    landmarks: shot.landmarks?.map(point => ({ x: round(point.x, 5), y: round(point.y, 5), z: point.z == null ? undefined : round(point.z, 5), visibility: point.visibility == null ? undefined : round(point.visibility, 3) })) ?? null,
  };
}

export function loadRecords(): MeasurementRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecords(records: MeasurementRecord[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

const csvCell = (value: string | number | null | undefined) => {
  if (value == null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function recordsToCsv(records: MeasurementRecord[]): string {
  const header = ['id', 'subject', 'label', 'recordedAt', 'calcVersion', 'source', ...LOGGED_METRICS.map(metric => metric.key)];
  const rows = records.map(record => [record.id, record.subjectId, record.label, record.recordedAt, record.calcVersion, record.source, ...LOGGED_METRICS.map(metric => record.metrics[metric.key] == null ? null : round(record.metrics[metric.key]!, 2))]);
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
}

export type MetricSummary = {
  key: MetricKey;
  label: string;
  unit: string;
  subjects: number; // subjects with 2+ values (those that contribute to SEM)
  measurements: number;
  sem: number | null;
  mdc95: number | null;
};

// SEM is estimated as the pooled within-subject SD:
//   SEM = sqrt( Σ(n_i − 1)·s_i² / Σ(n_i − 1) ),  MDC95 = 1.96 × √2 × SEM (spec 6.3).
export function summarize(records: MeasurementRecord[]): MetricSummary[] {
  return LOGGED_METRICS.map(metric => {
    const bySubject = new Map<string, number[]>();
    for (const record of records) {
      const value = record.metrics[metric.key];
      if (value == null || !Number.isFinite(value)) continue;
      bySubject.set(record.subjectId, [...(bySubject.get(record.subjectId) ?? []), value]);
    }
    let sumSquares = 0, degrees = 0, subjects = 0, measurements = 0;
    for (const values of bySubject.values()) {
      measurements += values.length;
      if (values.length < 2) continue;
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      sumSquares += values.reduce((total, value) => total + (value - mean) ** 2, 0);
      degrees += values.length - 1;
      subjects += 1;
    }
    const sem = degrees > 0 ? Math.sqrt(sumSquares / degrees) : null;
    return { key: metric.key, label: metric.label, unit: metric.unit, subjects, measurements, sem, mdc95: sem == null ? null : 1.96 * Math.SQRT2 * sem };
  });
}
