'use client';

import { useEffect, useMemo, useState } from 'react';
import { CALC_VERSION, LOGGED_METRICS, loadRecords, recordsToCsv, saveRecords, summarize, type MeasurementRecord } from '../../lib/measurementLog';

export type PendingMeasurement = Pick<MeasurementRecord, 'metrics' | 'shots' | 'source'>;

const SUBJECT_KEY = 'posture:measurementLog:lastSubject';
const format = (value: number | null | undefined, digits = 1) => value == null ? '—' : value.toFixed(digits);

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function MeasurementLogPanel({ pending }: { pending: PendingMeasurement | null }) {
  const [records, setRecords] = useState<MeasurementRecord[]>([]);
  const [subjectId, setSubjectId] = useState('');
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [savedPending, setSavedPending] = useState<PendingMeasurement | null>(null);

  useEffect(() => {
    setRecords(loadRecords());
    try { setSubjectId(localStorage.getItem(SUBJECT_KEY) ?? ''); } catch { /* optional convenience */ }
  }, []);

  const summary = useMemo(() => summarize(records), [records]);
  const alreadySaved = pending != null && pending === savedPending;

  function update(next: MeasurementRecord[], okMessage: string) {
    if (saveRecords(next)) { setRecords(next); setMessage(okMessage); }
    else setMessage('端末に保存できませんでした（プライベートブラウズ等では保存できません）。先にCSVを書き出してください。');
  }

  function addRecord() {
    if (!pending) return;
    const subject = subjectId.trim();
    if (!subject) { setMessage('対象者IDを入力してください（例：A、B）。'); return; }
    const sameSubject = records.filter(record => record.subjectId === subject).length;
    const record: MeasurementRecord = {
      id: `m-${Date.now()}`,
      subjectId: subject,
      label: label.trim() || `${sameSubject + 1}回目`,
      recordedAt: new Date().toISOString(),
      calcVersion: CALC_VERSION,
      ...pending,
    };
    try { localStorage.setItem(SUBJECT_KEY, subject); } catch { /* optional convenience */ }
    update([...records, record], `${subject}・${record.label} を記録しました（${records.length + 1}件）。`);
    setSavedPending(pending);
    setLabel('');
  }

  function removeRecord(id: string) {
    update(records.filter(record => record.id !== id), '1件削除しました。');
  }

  function clearAll() {
    if (!confirmClear) { setConfirmClear(true); return; }
    update([], 'すべての記録を削除しました。');
    setConfirmClear(false);
  }

  async function copyCsv() {
    try { await navigator.clipboard.writeText(recordsToCsv(records)); setMessage('CSVをクリップボードにコピーしました。'); }
    catch { setMessage('コピーできませんでした。CSVの書き出しをお使いください。'); }
  }

  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');

  return <section className="card measurementLog">
    <div className="sectionHead"><div><span className="step">開発用</span><h2>再現性確認の記録</h2></div></div>
    <p className="logNote">同じ人を、撮影をやり直して繰り返し測るための記録です（仕様書 6.3節）。測定値とランドマーク座標だけをこの端末に保存し、写真は保存しません。計算方法の版：{CALC_VERSION}</p>

    <div className="logForm">
      <label>対象者ID<input value={subjectId} onChange={event => setSubjectId(event.target.value)} placeholder="例：A" /></label>
      <label>メモ（任意）<input value={label} onChange={event => setLabel(event.target.value)} placeholder="例：1日目-1回目" /></label>
      <button className="primary" onClick={addRecord} disabled={!pending || alreadySaved}>{alreadySaved ? '記録済み' : 'この測定を記録'}</button>
    </div>
    {!pending && <p className="logNote">4枚を撮影して「姿勢を評価する」を押すと記録できます。</p>}
    {pending && pending.metrics.cva == null && <p className="logNote">CVA は C7 が未指定のため空欄で記録されます。</p>}
    {message && <p className="logMessage" aria-live="polite">{message}</p>}

    <h3>指標ごとのばらつき（目安）</h3>
    <div className="logTableWrap"><table className="logTable">
      <thead><tr><th>指標</th><th>対象者数</th><th>測定数</th><th>SEM</th><th>MDC95</th></tr></thead>
      <tbody>{summary.map(row => <tr key={row.key}><td>{row.label}</td><td>{row.subjects}</td><td>{row.measurements}</td><td>{format(row.sem, 2)}{row.sem != null && row.unit}</td><td>{format(row.mdc95, 2)}{row.mdc95 != null && row.unit}</td></tr>)}</tbody>
    </table></div>
    <p className="logNote">SEM は同じ人の繰り返し測定のばらつき（対象者内SDをプール）、MDC95 = 1.96 × √2 × SEM。2回以上測った対象者だけで計算します。少数の記録では値が安定しないため、正式な値の判断には仕様書 6.3節の手順で集めた記録を使ってください。</p>

    <h3>記録一覧（{records.length}件）</h3>
    {records.length > 0 && <div className="logTableWrap"><table className="logTable">
      <thead><tr><th>対象者</th><th>メモ</th><th>日時</th>{LOGGED_METRICS.map(metric => <th key={metric.key}>{metric.label}</th>)}<th /></tr></thead>
      <tbody>{records.map(record => <tr key={record.id}><td>{record.subjectId}</td><td>{record.label}{record.source === 'test' && '（テスト）'}</td><td>{new Date(record.recordedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>{LOGGED_METRICS.map(metric => <td key={metric.key}>{format(record.metrics[metric.key])}</td>)}<td><button className="ghost" onClick={() => removeRecord(record.id)}>削除</button></td></tr>)}</tbody>
    </table></div>}

    <div className="testButtons">
      <button className="ghost" disabled={!records.length} onClick={() => download(`posture-log-${stamp()}.csv`, '﻿' + recordsToCsv(records), 'text/csv;charset=utf-8')}>CSVを書き出す</button>
      <button className="ghost" disabled={!records.length} onClick={() => download(`posture-log-${stamp()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), calcVersion: CALC_VERSION, records }, null, 2), 'application/json')}>JSON（座標つき）を書き出す</button>
      <button className="ghost" disabled={!records.length} onClick={copyCsv}>CSVをコピー</button>
      <button className="ghost" disabled={!records.length} onClick={clearAll}>{confirmClear ? 'もう一度押すと全件削除' : 'すべて削除'}</button>
    </div>
  </section>;
}
