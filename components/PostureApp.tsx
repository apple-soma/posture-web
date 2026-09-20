'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { gradeAbs, lineTiltDeg, midpoint, refs, scoreMetrics, verticalTiltDeg, type Metrics } from '../lib/posture';

type View = 'front' | 'side';
type CameraFacing = 'user' | 'environment';
type Shot = { dataUrl: string; landmarks: any[] | null };
type Candidate = Shot & { score: number };
type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;
const emptyShot: Shot = { dataUrl: '', landmarks: null };
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const REQUIRED = [11, 12, 23, 24, 27, 28];

function assess(landmarks: any[] | null) {
  if (!landmarks) return { score: 0, message: '人物を検出しています。枠内に入ってください。' };
  const p = REQUIRED.map(i => landmarks[i]).filter(Boolean);
  if (p.length !== REQUIRED.length || p.some(x => (x.visibility ?? 1) < .55)) return { score: 0, message: '頭から足首までが見える位置に移動してください。' };
  const xs = p.map(x => x.x), ys = p.map(x => x.y);
  const top = Math.min(...ys), bottom = Math.max(...ys), left = Math.min(...xs), right = Math.max(...xs);
  const height = bottom - top, width = right - left;
  if (top < .04 || bottom > .96 || left < .04 || right > .96 || height > .84) return { score: 0, message: '体が画面から切れています。少し離れてください。' };
  if (height < .48) return { score: 0, message: '遠すぎます。ガイドの人物枠に近づいてください。' };
  if (width < .12) return { score: 0, message: '体をまっすぐ向け、画面の中央に合わせてください。' };
  const centered = 1 - Math.min(1, Math.abs((left + right) / 2 - .5) * 3);
  return { score: Math.round((centered * .4 + (1 - Math.min(1, Math.abs(height - .66) / .22)) * .6) * 100), message: '全身を確認できました。このまま自然に静止してください。' };
}

export default function PostureApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const [landmarker, setLandmarker] = useState<PoseLandmarker | null>(null);
  const [loading, setLoading] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [guide, setGuide] = useState('カメラを起動して、案内に従ってください。');
  const [view, setView] = useState<View>('front');
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>('user');
  const [front, setFront] = useState<Shot>(emptyShot);
  const [side, setSide] = useState<Shot>(emptyShot);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [previous, setPrevious] = useState<Metrics | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('posture:last');
    if (saved) setPrevious(JSON.parse(saved));
    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        const instance = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' }, runningMode: 'IMAGE', numPoses: 1, minPoseDetectionConfidence: .55, minPosePresenceConfidence: .55 });
        landmarkerRef.current = instance; setLandmarker(instance);
      } catch (error) { console.error(error); setGuide('姿勢モデルを読み込めませんでした。通信状態を確認してください。'); }
      finally { setLoading(false); }
    })();
    return () => {
      recognitionRef.current?.stop();
      landmarkerRef.current?.close();
    };
  }, []);

  async function startCamera(facing = cameraFacing) {
    try {
      // Full-body shots are taken upright on phones, so request a portrait feed.
      const isMobileViewport = window.matchMedia('(max-width: 680px)').matches;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: isMobileViewport ? 1080 : 1920 },
          height: { ideal: isMobileViewport ? 1920 : 1080 },
          aspectRatio: { ideal: isMobileViewport ? 3 / 4 : 4 / 3 },
        },
        audio: false,
      });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream; await videoRef.current.play(); setCameraOn(true);
      setGuide(view === 'front' ? '正面を向き、頭から足首までをガイド内に入れてください。' : '体の側面を向き、頭から足首までをガイド内に入れてください。');
    } catch { setGuide('カメラを開始できません。カメラの利用を許可してください。'); }
  }
  async function startCameraAndVoiceCapture() {
    await startCamera();
    if (videoRef.current?.srcObject) startVoiceCapture();
  }
  function stopCamera() {
    stopVoiceCapture();
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false); setCapturing(false); setCountdown(0);
  }
  async function switchCamera() {
    const next: CameraFacing = cameraFacing === 'user' ? 'environment' : 'user';
    stopCamera(); setCameraFacing(next);
    await startCamera(next);
  }
  function snapshot(landmarks: any[]): Shot | null {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return null;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/jpeg', .9), landmarks };
  }
  function saveShot(shot: Shot) {
    if (view === 'front') {
      setFront(shot); setView('side'); setGuide('正面を保存しました。続けて側面を撮影してください。');
    } else {
      setSide(shot); setGuide('側面を保存しました。姿勢を評価できます。');
    }
    stopCamera();
  }
  function stopVoiceCapture() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setVoiceListening(false);
  }
  function captureByVoice() {
    const video = videoRef.current, detector = landmarkerRef.current;
    if (!video || !detector) return;
    const landmarks = detector.detect(video).landmarks?.[0] ?? null;
    const check = assess(landmarks);
    if (!landmarks || check.score === 0) {
      setGuide(`「OK」を受け取りましたが、${check.message}`);
      return;
    }
    const shot = snapshot(landmarks);
    if (!shot) { setGuide('撮影できませんでした。もう一度「OK」と話してください。'); return; }
    saveShot(shot);
  }
  function startVoiceCapture() {
    if (capturing || voiceListening) return;
    const SpeechRecognition = (window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition
      ?? (window as typeof window & { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setGuide('このブラウザは音声撮影に対応していません。Chrome または Edge でお試しください。');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length - event.resultIndex }, (_, index) => event.results[event.resultIndex + index][0].transcript).join('');
      if (/^(?:\s)*(?:ok|おーけー|オーケー|オッケー|おっけー)(?:\s)*[。.!！]?$/i.test(transcript)) captureByVoice();
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') setGuide('マイクの利用を許可してください。');
      else if (event.error !== 'aborted') setGuide('音声を認識できませんでした。もう一度開始してください。');
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) { recognitionRef.current = null; setVoiceListening(false); }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start(); setVoiceListening(true); setGuide('マイクで「OK」を待っています。撮影したい瞬間に「OK」と話してください。');
    } catch { setGuide('音声撮影を開始できませんでした。もう一度お試しください。'); }
  }
  function autoCapture() {
    if (!landmarker || capturing) return;
    setCapturing(true); setGuide('3秒間のベストショットを選んでいます。自然に静止してください。');
    const candidates: Candidate[] = [], started = Date.now();
    const timer = window.setInterval(() => {
      const video = videoRef.current, detector = landmarkerRef.current;
      if (!video || !detector) return;
      const landmarks = detector.detect(video).landmarks?.[0] ?? null;
      const check = assess(landmarks);
      setCountdown(Math.max(0, Math.ceil((3000 - (Date.now() - started)) / 1000))); setGuide(check.message);
      if (landmarks && check.score > 0) { const shot = snapshot(landmarks); if (shot) candidates.push({ ...shot, score: check.score }); }
      if (Date.now() - started >= 3000) {
        window.clearInterval(timer); const best = candidates.sort((a, b) => b.score - a.score)[0];
        if (!best) { setGuide('全身を確認できるフレームを選べませんでした。もう一度試してください。'); setCapturing(false); setCountdown(0); return; }
        saveShot(best);
      }
    }, 200);
  }
  function evaluate() {
    if (!front.landmarks || !side.landmarks) { setGuide('正面と側面の両方を撮影してください。'); return; }
    const f = front.landmarks;
    const base = { cva: null, shoulderTilt: lineTiltDeg(f[11], f[12]), pelvisTilt: lineTiltDeg(f[23], f[24]), trunkTilt: verticalTiltDeg(midpoint(f[11], f[12]), midpoint(f[23], f[24])) };
    const next: Metrics = { ...base, score: scoreMetrics(base) };
    setMetrics(next); localStorage.setItem('posture:last', JSON.stringify(next)); setGuide('評価が完了しました。');
  }
  const rows = useMemo(() => !metrics ? [] : [
    { key: 'shoulder', label: '肩の左右差', value: metrics.shoulderTilt, grade: gradeAbs(metrics.shoulderTilt, refs.shoulderTilt.good, refs.shoulderTilt.caution), prev: previous?.shoulderTilt ?? null },
    { key: 'pelvis', label: '骨盤の左右差', value: metrics.pelvisTilt, grade: gradeAbs(metrics.pelvisTilt, refs.pelvisTilt.good, refs.pelvisTilt.caution), prev: previous?.pelvisTilt ?? null },
    { key: 'trunk', label: '体幹の傾き', value: metrics.trunkTilt, grade: gradeAbs(metrics.trunkTilt, refs.trunkTilt.good, refs.trunkTilt.caution), prev: previous?.trunkTilt ?? null },
  ], [metrics, previous]);

  return <main className="shell">
    <header className="hero"><div><span className="eyebrow">POSTURE CHECK</span><h1>姿勢から、改善を数字で確認する。</h1><p>カメラ映像を端末内で解析します。写真はサーバーへ送信しません。</p></div><div className="heroScore"><span>測定項目</span><strong>3</strong><small>肩 / 骨盤 / 体幹</small></div></header>
    <section className="card"><div className="sectionHead"><div><span className="step">STEP 1</span><h2>自動・音声撮影</h2></div><span className={loading ? 'status wait' : 'status ok'}>{loading ? 'モデル読込中' : 'カメラ準備OK'}</span></div>
      <div className="guideGrid"><div><b>正面</b><p>体の正面を向き、腕を自然に下ろします。</p></div><div><b>側面</b><p>体の側面を向き、普段どおりに立ちます。</p></div></div>
      <div className="tabs"><button className={view === 'front' ? 'active' : ''} onClick={() => setView('front')} disabled={capturing}>正面を撮影</button><button className={view === 'side' ? 'active' : ''} onClick={() => setView('side')} disabled={capturing}>側面を撮影</button></div>
      <div className="cameraBox"><video ref={videoRef} playsInline muted className={cameraOn ? '' : 'hidden'} style={{ transform: cameraFacing === 'user' ? 'scaleX(-1)' : undefined }} />{!cameraOn && <div className="cameraPlaceholder"><div className="silhouette">♙</div><p>{view === 'front' ? '正面撮影ガイド' : '側面撮影ガイド'}</p><div className="guideLine" /></div>}{cameraOn && <><div className="frameGuide" /><div className="liveGuide"><b>{voiceListening ? '「OK」で撮影' : capturing ? `あと ${countdown} 秒` : '全身をガイド内へ'}</b><span>{guide}</span></div></>}</div><canvas ref={canvasRef} className="hidden" />
      <div className="actions">{!cameraOn ? <><button className="primary" onClick={() => startCamera()} disabled={loading}>インカメラを起動</button><button className="ghost" onClick={startCameraAndVoiceCapture} disabled={loading}>「OK」で撮影</button></> : <><button className="primary" onClick={autoCapture} disabled={capturing || voiceListening}>{capturing ? '自動選定中…' : '3秒自動撮影を開始'}</button><button className={voiceListening ? 'primary' : 'ghost'} onClick={voiceListening ? stopVoiceCapture : startVoiceCapture} disabled={capturing}>{voiceListening ? '音声撮影を停止' : '「OK」で撮影'}</button><button className="ghost" onClick={switchCamera} disabled={capturing || voiceListening}>{cameraFacing === 'user' ? '背面カメラへ' : 'インカメラへ'}</button><button className="ghost" onClick={stopCamera}>キャンセル</button></>}</div><p className="notice">{guide}</p>
    </section>
    <section className="card"><div className="sectionHead"><div><span className="step">STEP 2</span><h2>撮影の確認</h2></div></div><div className="shots"><ShotCard title="正面" shot={front} /><ShotCard title="側面" shot={side} /></div><button className="primary wide" onClick={evaluate}>姿勢を評価する</button></section>
    <section className="card"><div className="sectionHead"><div><span className="step">STEP 3・4</span><h2>姿勢評価・測定結果</h2></div>{metrics && <div className="scorePill"><span>総合姿勢スコア</span><b>{metrics.score}</b><small>/100</small></div>}</div>{!metrics ? <div className="emptyResult">正面・側面を撮影すると、ここに測定結果が表示されます。</div> : <><div className="resultTable">{rows.map(r => <div className="resultRow" key={r.key}><div><b>{r.label}</b><span className={`grade ${r.grade}`}>{r.grade}</span></div><strong>{r.value.toFixed(1)}°</strong><p>±2° 良好 / 2〜5° 注意 / &gt;5° 改善推奨</p><p className="delta">前回との差：{r.prev == null ? '前回データなし' : `${(r.value - r.prev).toFixed(1)}°`}</p></div>)}</div><div className="insight"><b>改善ポイント</b><p>{rows.filter(r => r.grade !== '良好').length ? `${rows.filter(r => r.grade !== '良好').map(r => r.label).join('・')}を意識して取り組むと分かりやすいです。` : '今回の3指標はすべて良好です。現在の姿勢を保つことを意識しましょう。'}</p></div></>}<div className="evidence"><b>測定について</b><p>C7はMediaPipeが検出しないため、誤差が大きい手動タップによるCVA測定を廃止しました。肩・骨盤・体幹の3指標を、全身が確認できたフレームから評価します。</p></div></section>
    <footer>このサービスは姿勢の改善目安を示すもので、医療診断を行うものではありません。強い痛みやしびれがある場合は医療機関にご相談ください。</footer>
  </main>;
}
function ShotCard({ title, shot }: { title: string; shot: Shot }) { return <div className="shotCard"><div className="shotTitle"><b>{title}</b><span>{shot.landmarks ? '最適フレーム選定済み' : '未撮影'}</span></div>{shot.dataUrl ? <img src={shot.dataUrl} alt={`${title}姿勢`} /> : <div className="emptyShot">{title}写真</div>}<small>3秒間の映像から、全身が収まり姿勢を検出できたフレームを自動選定します。</small></div>; }
