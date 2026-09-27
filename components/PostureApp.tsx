'use client';

import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { EvaluationResult } from '../lib/postureEvaluation';
import { evaluateMeasurements } from '../lib/postureEvaluation';
import { createTestLandmarks, getTestManualC7, testScenarios, testStateLabels, type TestPoseState, type TestScenario } from '../lib/postureTestData';
import { PoseOverlay, createPoseSkeleton } from './posture/PoseOverlay';
import { createMeasurementOverlay } from '../lib/postureMeasurement';
import PlanBuilder from './phase4/PlanBuilder';

type View = 'front' | 'side';
type CameraFacing = 'user' | 'environment';
type Shot = { dataUrl: string; landmarks: any[] | null; imageWidth?: number; imageHeight?: number; manualC7?: { x: number; y: number } };
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
// A valid shot must include the head, shoulders, hips, and both ankles.
// This is the source of truth for the capture decision, not the drawn guide.
const REQUIRED = [0, 11, 12, 23, 24, 27, 28];
const TEST_MODE_ENABLED = process.env.NODE_ENV === 'development';
type TestDebug = { scenario: string; state: string; fullBody: boolean; centered: boolean; stable: boolean; confidence: number };
type GuidanceState = 'TOO_FAR' | 'TOO_CLOSE' | 'MOVE_LEFT' | 'MOVE_RIGHT' | 'CENTERED' | 'UNSTABLE' | 'READY' | 'COUNTDOWN' | 'CAPTURED' | 'DETECTING';
const GUIDANCE: Record<GuidanceState, string> = { TOO_FAR: 'もう少し前に進んでください', TOO_CLOSE: 'もう少し後ろに下がってください', MOVE_LEFT: '少し左に移動してください', MOVE_RIGHT: '少し右に移動してください', CENTERED: '画面の中央に立ってください', UNSTABLE: 'その場で動かずに立ってください', READY: '準備できました。このまま動かないでください', COUNTDOWN: '撮影まで', CAPTURED: '撮影しました', DETECTING: '全身が入る位置に立ってください' };

function createTestShot(view: View): Shot {
  const landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1 }));
  const points = view === 'front'
    ? { 0: [.5, .13], 7: [.45, .16], 8: [.55, .16], 11: [.37, .30], 12: [.63, .305], 13: [.31, .45], 14: [.69, .45], 15: [.29, .58], 16: [.71, .58], 23: [.43, .58], 24: [.57, .585], 25: [.44, .75], 26: [.56, .75], 27: [.43, .90], 28: [.57, .90], 29: [.40, .92], 30: [.54, .92], 31: [.45, .94], 32: [.59, .94] }
    : { 0: [.5, .13], 7: [.47, .16], 8: [.53, .16], 11: [.46, .30], 12: [.54, .305], 13: [.43, .45], 14: [.57, .45], 15: [.42, .58], 16: [.58, .58], 23: [.47, .58], 24: [.53, .585], 25: [.47, .75], 26: [.53, .75], 27: [.47, .90], 28: [.53, .90], 29: [.45, .92], 30: [.51, .92], 31: [.49, .94], 32: [.55, .94] };
  Object.entries(points).forEach(([index, [x, y]]) => { landmarks[Number(index)] = { x, y, visibility: 1 }; });
  const label = view === 'front' ? '正面テスト' : '側面テスト';
  const image = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960" viewBox="0 0 540 960"><rect width="540" height="960" fill="#eaf2ed"/><rect x="58" y="54" width="424" height="850" rx="24" fill="none" stroke="#1c6b50" stroke-width="5"/><circle cx="270" cy="125" r="42" fill="#1c6b50" opacity=".85"/><path d="M200 288 L232 557 L238 720 L232 864 M340 293 L308 562 L302 720 L308 864 M200 288 L167 432 L157 557 M340 293 L373 432 L383 557 M232 557 L308 562" fill="none" stroke="#1c6b50" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/><text x="270" y="930" text-anchor="middle" fill="#13201c" font-family="sans-serif" font-size="28">${label}・テストデータ</text></svg>`;
  return { landmarks, imageWidth: 540, imageHeight: 960, dataUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(image)}` };
}

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
  if ((left + right) / 2 < .36) return { score: 0, message: '少し右に移動してください。' };
  if ((left + right) / 2 > .64) return { score: 0, message: '少し左に移動してください。' };
  const centered = 1 - Math.min(1, Math.abs((left + right) / 2 - .5) * 3);
  return { score: Math.round((centered * .4 + (1 - Math.min(1, Math.abs(height - .66) / .22)) * .6) * 100), message: '全身を確認できました。このまま自然に静止してください。' };
}

function guidanceFrom(message: string, ready: boolean, moved: boolean): GuidanceState {
  if (ready) return 'READY';
  if (moved) return 'UNSTABLE';
  if (message.includes('遠すぎ')) return 'TOO_FAR';
  if (message.includes('切れ') || message.includes('頭から足首') || message.includes('人物を検出')) return 'TOO_CLOSE';
  if (message.includes('右に移動')) return 'MOVE_RIGHT';
  if (message.includes('左に移動')) return 'MOVE_LEFT';
  if (message.includes('全身を確認')) return 'CENTERED';
  if (message.includes('中央')) return 'CENTERED';
  return 'DETECTING';
}

export default function PostureApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const stableFramesRef = useRef(0);
  const lastPoseRef = useRef<{ x: number; y: number } | null>(null);
  const testRunRef = useRef<{ scenario: TestScenario; index: number } | null>(null);
  const testModeRef = useRef(false);
  const captureTimerRef = useRef<number | null>(null);
  const speechRef = useRef({ message: '', at: 0 });
  const voiceGuidanceRef = useRef(true);
  const speechInitializedRef = useRef(false);
  const [landmarker, setLandmarker] = useState<PoseLandmarker | null>(null);
  const [loading, setLoading] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [guide, setGuide] = useState('カメラを起動して、案内に従ってください。');
  const [guidanceState, setGuidanceState] = useState<GuidanceState>('DETECTING');
  const [view, setView] = useState<View>('front');
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>('user');
  const [captureReady, setCaptureReady] = useState(false);
  const [voiceGuidance, setVoiceGuidance] = useState(true);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechInitialized, setSpeechInitialized] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [testModeActive, setTestModeActive] = useState(false);
  const [testScenario, setTestScenario] = useState<TestScenario | null>(null);
  const [testDebug, setTestDebug] = useState<TestDebug | null>(null);
  const [front, setFront] = useState<Shot>(emptyShot);
  const [side, setSide] = useState<Shot>(emptyShot);
  const [evaluationResults, setEvaluationResults] = useState<EvaluationResult[]>([]);

  function speak(message: string, allowRapid = false) {
    if (!voiceGuidanceRef.current || !speechInitializedRef.current || typeof window === 'undefined' || !('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
    const now = Date.now();
    if (!allowRapid && speechRef.current.message === message && now - speechRef.current.at < 4000) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = 'ja-JP'; utterance.rate = 1;
      utterance.onerror = () => setSpeechError('音声を再生できませんでした。画面の案内をご利用ください。');
      window.speechSynthesis.speak(utterance);
      speechRef.current = { message, at: now };
    } catch { /* Speech is optional: capture state and timers must keep running. */ }
  }

  // This function is called only from a user tap. It unlocks speech playback on
  // iPhone Safari and Android Chrome without making the camera flow depend on it.
  function activateVoiceGuidance() {
    const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    setSpeechSupported(supported);
    voiceGuidanceRef.current = supported;
    setVoiceGuidance(supported);
    setSpeechError(supported ? null : 'このブラウザでは音声ガイドを利用できません。');
    if (!supported) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance('音声ガイドを開始します');
      utterance.lang = 'ja-JP';
      utterance.onerror = () => setSpeechError('音声を再生できませんでした。画面の案内をご利用ください。');
      window.speechSynthesis.speak(utterance);
      speechInitializedRef.current = true;
      setSpeechInitialized(true);
      speechRef.current = { message: '音声ガイドを開始します', at: Date.now() };
    } catch {
      setSpeechError('音声を初期化できませんでした。画面の案内をご利用ください。');
    }
  }

  function toggleVoiceGuidance() {
    if (voiceGuidanceRef.current) {
      window.speechSynthesis?.cancel();
      voiceGuidanceRef.current = false;
      setVoiceGuidance(false);
      return;
    }
    activateVoiceGuidance();
  }

  function poseCenter(landmarks: any[] | null) {
    const points = REQUIRED.map(index => landmarks?.[index]).filter(Boolean);
    if (points.length !== REQUIRED.length) return null;
    const xs = points.map(point => point.x), ys = points.map(point => point.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }

  function nextTestLandmarks() {
    const run = testRunRef.current;
    if (!run) return null;
    const state = run.scenario.frames[Math.min(run.index, run.scenario.frames.length - 1)] as TestPoseState;
    const landmarks = createTestLandmarks(state, run.index);
    run.index += 1;
    return { landmarks, state };
  }

  function startTestScenario(scenario: TestScenario) {
    activateVoiceGuidance();
    stopCamera();
    testRunRef.current = { scenario, index: 0 };
    testModeRef.current = true;
    stableFramesRef.current = 0;
    lastPoseRef.current = null;
    setTestScenario(scenario);
    setTestDebug(null);
    setTestModeActive(true);
    setCameraOn(true);
    setGuide(`テスト開始: ${scenario.id}`);
  }

  function startTestState(state: TestPoseState) {
    startTestScenario({ id: `STATE_${state.toUpperCase()}`, label: testStateLabels[state], frames: Array(60).fill(state) });
  }

  useEffect(() => {
    if (!cameraOn || capturing || !voiceGuidance || guidanceState === 'COUNTDOWN' || guidanceState === 'CAPTURED') return;
    const message = GUIDANCE[guidanceState];
    speak(message);
    const retry = window.setInterval(() => speak(message), 1000);
    return () => window.clearInterval(retry);
  }, [guidanceState, cameraOn, capturing, voiceGuidance]);

  useEffect(() => {
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

  useEffect(() => {
    if (!cameraOn || capturing) return;
    const timer = window.setInterval(() => {
      const testFrame = testModeActive ? nextTestLandmarks() : null;
      const video = videoRef.current;
      const detector = landmarkerRef.current;
      const landmarks = testFrame?.landmarks ?? (video && detector && video.videoWidth ? detector.detect(video).landmarks?.[0] ?? null : null);
      if (!landmarks) return;

      const check = assess(landmarks);
      const currentPose = poseCenter(landmarks);
      const moved = !!(currentPose && lastPoseRef.current && (Math.abs(currentPose.x - lastPoseRef.current.x) > .035 || Math.abs(currentPose.y - lastPoseRef.current.y) > .035));
      stableFramesRef.current = check.score > 0 && !moved ? stableFramesRef.current + 1 : 0;
      lastPoseRef.current = currentPose;
      const ready = stableFramesRef.current >= (testModeActive ? 4 : 7);
      setCaptureReady(ready);
      setGuide(ready ? '準備OK。撮影ボタンをタップするか、「OK」と話してください。' : check.message);
      setGuidanceState(guidanceFrom(check.message, ready, moved));
      if (testModeActive && testFrame) {
        const visibility = Math.min(...REQUIRED.map(index => landmarks[index]?.visibility ?? 0));
        setTestDebug({ scenario: testScenario?.id ?? '', state: testStateLabels[testFrame.state], fullBody: check.score > 0, centered: !check.message.includes('中央'), stable: !moved && stableFramesRef.current > 0, confidence: visibility });
        if (ready && stableFramesRef.current === 4) window.setTimeout(() => autoCapture(true), 0);
      }
    }, testModeActive ? 50 : 250);
    return () => window.clearInterval(timer);
  }, [cameraOn, capturing, testModeActive, testScenario]);

  async function startCamera(facing = cameraFacing) {
    try {
      // Full-body shots are taken upright on phones, so request a portrait feed.
      const isMobileViewport = window.matchMedia('(max-width: 680px)').matches;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: isMobileViewport ? 1080 : 1920 },
          height: { ideal: isMobileViewport ? 1920 : 1080 },
          aspectRatio: { ideal: isMobileViewport ? 9 / 16 : 4 / 3 },
        },
        audio: false,
      });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      // When the device exposes optical/digital zoom controls, the minimum
      // zoom is its widest available view and gives the best chance of fitting
      // a whole body in frame. Devices without this capability simply skip it.
      const track = stream.getVideoTracks()[0] as MediaStreamTrack & {
        getCapabilities?: () => { zoom?: { min: number } };
      };
      const capabilities = track?.getCapabilities?.() as { zoom?: { min: number } } | undefined;
      if (track && capabilities?.zoom) {
        try {
          await track.applyConstraints({ advanced: [{ zoom: capabilities.zoom.min } as MediaTrackConstraintSet] });
        } catch {
          // The camera stream remains usable if a browser exposes, but rejects, zoom.
        }
      }

      setCameraOn(true);
      setGuidanceState('DETECTING');
      setCaptureReady(false);
      stableFramesRef.current = 0;
      setGuide(view === 'front' ? '正面を向き、頭から足首までをガイド内に入れてください。' : '体の側面を向き、頭から足首までをガイド内に入れてください。');
    } catch { setGuide('カメラを開始できません。カメラの利用を許可してください。'); }
  }
  async function startCameraWithVoice() {
    activateVoiceGuidance();
    await startCamera(cameraFacing);
  }
  async function startCameraWithoutVoice() {
    voiceGuidanceRef.current = false;
    setVoiceGuidance(false);
    await startCamera(cameraFacing);
  }
  function stopCamera() {
    stopVoiceCapture();
    if (captureTimerRef.current != null) window.clearInterval(captureTimerRef.current);
    captureTimerRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    testRunRef.current = null;
    testModeRef.current = false;
    setTestModeActive(false); setCameraOn(false); setCapturing(false); setCaptureReady(false); setCountdown(0); setGuidanceState('DETECTING');
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
    return { dataUrl: canvas.toDataURL('image/jpeg', .9), landmarks, imageWidth: canvas.width, imageHeight: canvas.height };
  }
  function saveShot(shot: Shot) {
    if (view === 'front') {
      setFront(shot); setView('side'); setGuide('正面を保存しました。続けて側面を撮影してください。');
    } else {
      setSide(shot); setGuide('側面を保存しました。姿勢を評価できます。');
    }
    speak('撮影しました。');
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
    if (!captureReady) {
      setGuide('全身が安定して映ると「OK」で撮影できます。ガイド内で少し静止してください。');
      return;
    }
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
  function autoCapture(force = false) {
    const isTestRun = testModeRef.current;
    if ((!landmarker && !isTestRun) || capturing) return;
    if (!captureReady && !force) {
      setGuide('全身が安定して映るまでお待ちください。頭から足首まで入れてください。');
      return;
    }
    const duration = isTestRun ? 1000 : 5000;
    setCapturing(true); setCountdown(isTestRun ? 1 : 5); setGuidanceState('COUNTDOWN'); setGuide(`${isTestRun ? 'テスト: 1秒後' : '5秒後'}に撮影します。姿勢を保ってください。`); speak(isTestRun ? 'テスト撮影を開始します。' : '5秒後に撮影します。');
    const candidates: Candidate[] = [], started = Date.now();
    let lastSpokenCountdown = 0;
    const timer = window.setInterval(() => {
      const testFrame = isTestRun ? nextTestLandmarks() : null;
      const video = videoRef.current, detector = landmarkerRef.current;
      if (!testFrame && (!video || !detector || !video.videoWidth || !video.videoHeight)) return;
      const landmarks = testFrame?.landmarks ?? detector?.detect(video!).landmarks?.[0] ?? null;
      const check = assess(landmarks);
      const seconds = Math.max(0, Math.ceil((duration - (Date.now() - started)) / 1000));
      setCountdown(seconds); setGuide(check.message);
      if (seconds > 0 && seconds !== lastSpokenCountdown) { speak(String(seconds), true); lastSpokenCountdown = seconds; }
      if (!landmarks || check.score === 0) {
        window.clearInterval(timer); captureTimerRef.current = null; stableFramesRef.current = 0; setCaptureReady(false); setCapturing(false); setCountdown(0); setGuide('姿勢が崩れたため、カウントダウンをリセットしました。'); speak('姿勢が崩れたため、撮影をやり直します。'); return;
      }
      const shot = isTestRun ? { ...createTestShot(view), landmarks, manualC7: testFrame ? getTestManualC7(testFrame.state) : undefined } : snapshot(landmarks);
      if (shot) candidates.push({ ...shot, score: check.score });
      if (Date.now() - started >= duration) {
        window.clearInterval(timer); captureTimerRef.current = null; const best = candidates.sort((a, b) => b.score - a.score)[0];
        if (!best) { setGuide('全身を確認できるフレームを選べませんでした。もう一度試してください。'); setCapturing(false); setCountdown(0); return; }
        setGuidanceState('CAPTURED'); saveShot(best);
      }
    }, isTestRun ? 50 : 200);
    captureTimerRef.current = timer;
  }
  function evaluate() {
    if (!front.landmarks || !side.landmarks) { setGuide('正面と側面の両方を撮影してください。'); return; }
    const frontMeasurement = createMeasurementOverlay(createPoseSkeleton(front.landmarks, front.imageWidth ?? 1, front.imageHeight ?? 1), 'front')?.measurement;
    const sideMeasurement = createMeasurementOverlay(createPoseSkeleton(side.landmarks, side.imageWidth ?? 1, side.imageHeight ?? 1), 'side', side.manualC7)?.measurement;
    setEvaluationResults([...evaluateMeasurements(sideMeasurement ?? null, 1), ...evaluateMeasurements(frontMeasurement ?? null, 1).filter(result => result.measurementId !== 'cva')]);
    setGuide('研究情報に基づく項目別の参考評価を表示しました。');
  }

  return <main className="shell">
    <header className="hero"><div><span className="eyebrow">POSTURE CHECK</span><h1>姿勢から、改善を数字で確認する。</h1><p>カメラ映像を端末内で解析します。写真はサーバーへ送信しません。</p></div><div className="heroScore"><span>測定項目</span><strong>3</strong><small>肩 / 骨盤 / 体幹</small></div></header>
    <section className="card"><div className="sectionHead"><div><span className="step">STEP 1</span><h2>自動・音声撮影</h2></div><span className={loading ? 'status wait' : 'status ok'}>{loading ? 'モデル読込中' : 'カメラ準備OK'}</span></div>
      <div className="guideGrid"><div><b>正面</b><p>体の正面を向き、腕を自然に下ろします。</p></div><div><b>側面</b><p>体の側面を向き、普段どおりに立ちます。</p></div></div>
      {TEST_MODE_ENABLED && <aside className="testMode" aria-label="開発用テストモード"><b>TEST MODE（開発用）</b><p>実カメラを使わず、MediaPipeと共通の判定ロジックへランドマークを入力します。</p><div className="testButtons">{testScenarios.map(scenario => <button key={scenario.id} className="ghost" onClick={() => startTestScenario(scenario)}>{scenario.id}</button>)}</div><div className="testButtons">{(Object.keys(testStateLabels) as TestPoseState[]).map(state => <button key={state} className="ghost" onClick={() => startTestState(state)}>{testStateLabels[state]}</button>)}</div>{testDebug && <div className="testDebug"><b>{testDebug.scenario}</b><span>状態: {testDebug.state}</span><span>全身: {testDebug.fullBody ? 'OK' : 'NG'} / 中央: {testDebug.centered ? 'OK' : 'NG'} / 安定: {testDebug.stable ? 'OK' : 'NG'}</span><span>Visibility: {testDebug.confidence.toFixed(2)} / カウント: {countdown}</span><span>Speech: {speechSupported ? '対応' : '未確認・未対応'} / 有効: {voiceGuidance ? 'ON' : 'OFF'} / 初期化: {speechInitialized ? '済' : '未'}</span><span>最終発話: {speechRef.current.at ? new Date(speechRef.current.at).toLocaleTimeString() : 'なし'} / 状態: {guidanceState}</span>{speechError && <span>{speechError}</span>}</div>}</aside>}
      <div className="tabs"><button className={view === 'front' ? 'active' : ''} onClick={() => setView('front')} disabled={capturing}>正面を撮影</button><button className={view === 'side' ? 'active' : ''} onClick={() => setView('side')} disabled={capturing}>側面を撮影</button></div>
      <div className="cameraBox"><video ref={videoRef} playsInline muted className={cameraOn ? '' : 'hidden'} style={{ transform: cameraFacing === 'user' ? 'scaleX(-1)' : undefined }} />{!cameraOn && <div className="cameraPlaceholder"><div className="silhouette">♙</div><p>{view === 'front' ? '正面撮影ガイド' : '側面撮影ガイド'}</p><div className="guideLine" /></div>}{cameraOn && <><div className="frameGuide" /><div className="liveGuide"><b>{capturing ? `撮影まで ${countdown}` : GUIDANCE[guidanceState]}</b><span>{guide}</span></div></>}</div><canvas ref={canvasRef} className="hidden" />
      <div className="actions">{!cameraOn ? <><button className="primary" onClick={startCameraWithVoice} disabled={loading}>音声ONで撮影開始</button><button className="ghost" onClick={startCameraWithoutVoice} disabled={loading}>音声OFFで撮影開始</button></> : <><button className="primary" onClick={() => autoCapture()} disabled={capturing || voiceListening || !captureReady}>{capturing ? '自動選定中…' : '5秒カウントダウン撮影'}</button><button className={voiceListening ? 'primary' : 'ghost'} onClick={voiceListening ? stopVoiceCapture : startVoiceCapture} disabled={capturing || !captureReady}>{voiceListening ? '音声撮影を停止' : '「OK」で撮影'}</button><button className="ghost" onClick={toggleVoiceGuidance}>{`音声案内 ${voiceGuidance ? 'ON' : 'OFF'}`}</button><button className="ghost" onClick={switchCamera} disabled={capturing || voiceListening}>{cameraFacing === 'user' ? '背面カメラへ' : 'インカメラへ'}</button><button className="ghost" onClick={stopCamera}>キャンセル</button></>}</div><p className="notice" aria-live="polite">{guide}</p>
    </section>
    <section className="card"><div className="sectionHead"><div><span className="step">STEP 2</span><h2>撮影の確認</h2></div></div><div className="shots"><ShotCard title="正面" shot={front} /><ShotCard title="側面" shot={side} /></div><button className="primary wide" onClick={evaluate}>姿勢を評価する</button></section>
    <section className="card"><div className="sectionHead"><div><span className="step">STEP 3</span><h2>測定値と研究上の参考情報</h2></div></div>{!evaluationResults.length ? <div className="emptyResult">正面・側面を撮影後、「姿勢を評価する」を押すと項目別の参考情報を表示します。</div> : <div className="resultTable">{evaluationResults.map(result => <div className="resultRow" key={result.measurementId}><div><b>{{ cva: 'CVA', shoulderTilt: '肩の傾き', pelvisTilt: '骨盤の傾き', earOffset: '耳の前後位置', shoulderOffset: '肩の前後位置', hipOffset: '股関節の前後位置', kneeOffset: '膝の前後位置', ankleOffset: '足首の前後位置' }[result.measurementId] ?? result.measurementId}</b></div>{result.value != null && <strong>{`${result.value >= 0 ? '+' : ''}${result.value.toFixed(result.unit === 'normalized' ? 3 : 1)}${result.unit === 'degree' ? '°' : '（正規化座標）'}`}</strong>}<p>{result.explanation}</p>{result.reference && <details><summary>出典を見る</summary><p>{result.reference.sourceTitle}</p><p>{result.reference.sourceAuthors}（{result.reference.sourceYear}）</p><p>対象: {result.reference.population}</p><p>方法: {result.reference.measurementMethod}</p><a href={result.reference.sourceUrl} target="_blank" rel="noreferrer">PubMedで確認</a></details>}</div>)}</div>}<div className="evidence"><b>ご利用にあたって</b><p>本サービスの姿勢測定・評価は研究情報に基づく参考情報であり、医療上の診断を行うものではありません。</p></div></section>
    {evaluationResults.length > 0 && <PlanBuilder results={evaluationResults} onRemeasure={() => { setView('front'); setGuide('再測定する場合は、正面からカメラを起動してください。'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
    <footer>このサービスは姿勢の改善目安を示すもので、医療診断を行うものではありません。強い痛みやしびれがある場合は医療機関にご相談ください。</footer>
  </main>;
}
function ShotCard({ title, shot }: { title: string; shot: Shot }) {
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showReferences, setShowReferences] = useState(true);
  const [showMeasurements, setShowMeasurements] = useState(true);
  const captureType = title === '正面' ? 'front' : 'side';
  const pose = createPoseSkeleton(shot.landmarks, shot.imageWidth ?? 1, shot.imageHeight ?? 1);
  const overlay = createMeasurementOverlay(pose, captureType);
  const signedAngle = (value?: number) => value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}°`;
  const normalized = (value?: number) => value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
  return <div className="shotCard"><div className="shotTitle"><b>{title}</b><span>{shot.landmarks ? '最適フレーム選定済み' : '未撮影'}</span></div>{shot.dataUrl ? <><PoseOverlay imageUrl={shot.dataUrl} pose={pose} captureType={captureType} layers={{ skeleton: showSkeleton, references: showReferences, measurements: showMeasurements }} /><div className="overlayToggles"><button className="skeletonToggle" onClick={() => setShowSkeleton(value => !value)}>{`骨格 ${showSkeleton ? 'ON' : 'OFF'}`}</button><button className="skeletonToggle" onClick={() => setShowReferences(value => !value)}>{`基準線 ${showReferences ? 'ON' : 'OFF'}`}</button><button className="skeletonToggle" onClick={() => setShowMeasurements(value => !value)}>{`測定値 ${showMeasurements ? 'ON' : 'OFF'}`}</button></div>{showMeasurements && overlay && <div className="measurementPanel"><b>{captureType === 'front' ? '正面の測定値' : `側面の測定値（${overlay.side === 'left' ? '左側' : '右側'}）`}</b>{captureType === 'front' ? <><span>肩ライン: {signedAngle(overlay.measurement.shoulderTilt)}</span><span>骨盤ライン: {signedAngle(overlay.measurement.pelvisTilt)}</span></> : <><span>耳: {normalized(overlay.measurement.earOffset)}（正規化座標）</span><span>肩: {normalized(overlay.measurement.shoulderOffset)} / 腰: {normalized(overlay.measurement.hipOffset)}</span><span>膝: {normalized(overlay.measurement.kneeOffset)} / 足首: {normalized(overlay.measurement.ankleOffset)}</span></>}</div>}</> : <div className="emptyShot">{title}写真</div>}<small>撮影画像と同じ座標系で、骨格・基準線・測定値を重ねて表示します。</small></div>;
}
