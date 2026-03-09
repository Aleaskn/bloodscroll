import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import { ensureCatalogReady } from '../data/catalogDb';
import { analyzeFrameForQuadTracking, processFrameAndResolveCard } from '../data/scanEngine';
import { warmFingerprintResolverCache } from '../data/fingerprintResolver';
import { recordScanMetric } from '../data/scanMetrics';
import { SCANNER_ENGINES } from '../data/scanSettings';
import { HASH_GRAYSCALE_BIT_DEPTH, HASH_RESIZE_ALGO, MTG_CARD_ASPECT_RATIO } from '../data/hashConfig';

const HYBRID_SCAN_INTERVAL_MS = 90;
const NOT_FOUND_HINT_DELAY_MS = 9000;
const QUAD_CONFIDENCE_GATE = 0.35;
const QUAD_STABLE_FRAMES_REQUIRED = 2;
const TRACK_PROCESS_TIMEOUT_MS = 5000;
const HASH_PROCESS_TIMEOUT_MS = 3000;
const HASH_COOLDOWN_MS = 180;
const MIN_HAM_HARD_MATCH = 15;
const MIN_HAM_SOFT_LOCK_MIN = 16;
const MIN_HAM_SOFT_LOCK_MAX = 22;
const MIN_HAM_SOFT_LOCK_MS = 500;
const FINGERPRINT_MATCH_THRESHOLD = 0.88;
const FINGERPRINT_STABLE_FRAMES = 1;
const CAPTURE_TIMEOUT_MS = 5000;
const PROCESS_TIMEOUT_MS = TRACK_PROCESS_TIMEOUT_MS + HASH_PROCESS_TIMEOUT_MS + 650;
const MAX_QUAD_SHIFT_PX_FOR_HASH = 15;
const CARD_FRAME = {
  left: 0.18,
  top: 0.22,
  width: 0.64,
  aspectRatio: MTG_CARD_ASPECT_RATIO,
};
const CARD_FRAME_HEIGHT_RATIO = CARD_FRAME.width / CARD_FRAME.aspectRatio;
const FULL_CARD_HASH_FRAME = {
  leftInCard: 0.02,
  topInCard: 0.02,
  widthInCard: 0.96,
  heightInCard: 0.96,
};

type QuadPointNorm = { x: number; y: number };
type QuadBBoxNorm = { left: number; top: number; width: number; height: number };
type OverlaySize = { width: number; height: number };
type CapturedFrame = { uri: string; width: number; height: number; base64: string };

type DebugOverlayState = {
  phashHi: string;
  phashLo: string;
  dhashHi: string;
  dhashLo: string;
  bucket16: string;
  rawHits: string;
  minHamming: string;
  minHamSwap: string;
  hashPreviewUri: string;
  cycleId: string;
  lastStage: string;
  lastDurationMs: string;
  lastError: string;
  blurVariance: string;
  quadConfidence: string;
  quadDetected: string;
  quadGate: string;
  quadPointsCardNorm: QuadPointNorm[] | null;
  edgePointsCardNorm: QuadPointNorm[] | null;
  quadBBoxCardNorm: QuadBBoxNorm | null;
};

function createInitialDebugOverlay(): DebugOverlayState {
  return {
    phashHi: '-',
    phashLo: '-',
    dhashHi: '-',
    dhashLo: '-',
    bucket16: '-',
    rawHits: '-',
    minHamming: '-',
    minHamSwap: '-',
    hashPreviewUri: '',
    cycleId: '0',
    lastStage: '-',
    lastDurationMs: '-',
    lastError: '-',
    blurVariance: '-',
    quadConfidence: '-',
    quadDetected: '0',
    quadGate: String(QUAD_CONFIDENCE_GATE),
    quadPointsCardNorm: null,
    edgePointsCardNorm: null,
    quadBBoxCardNorm: null,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`timeout:${label}`));
      }, timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatEditionLabel(candidate) {
  const edition = candidate?.set_code ? String(candidate.set_code).toUpperCase() : null;
  const collector = candidate?.collector_number ? String(candidate.collector_number) : null;
  return [edition, collector].filter(Boolean).join(' • ');
}

function toFileUri(pathOrUri) {
  if (!pathOrUri) return '';
  if (String(pathOrUri).startsWith('file://')) return String(pathOrUri);
  return `file://${pathOrUri}`;
}

async function ensureExistingFileUri(pathOrUri) {
  const uri = toFileUri(pathOrUri);
  if (!uri) return '';
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info?.exists ? uri : '';
  } catch {
    return '';
  }
}

function isVisionCameraPermissionGranted(status: string) {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'granted' || normalized === 'authorized';
}

function clamp01(value: number) {
  if (!Number.isFinite(Number(value))) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function parseQuadPoints(value: any): QuadPointNorm[] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const parsed = value
    .map((entry) => ({
      x: clamp01(Number(entry?.x ?? 0)),
      y: clamp01(Number(entry?.y ?? 0)),
    }))
    .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y));
  return parsed.length === 4 ? parsed : null;
}

function parseEdgePoints(value: any, maxPoints = 220): QuadPointNorm[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const parsed = value
    .map((entry) => ({
      x: clamp01(Number(entry?.x ?? 0)),
      y: clamp01(Number(entry?.y ?? 0)),
    }))
    .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y));
  if (!parsed.length) return null;
  if (parsed.length <= maxPoints) return parsed;
  const step = Math.max(1, Math.ceil(parsed.length / maxPoints));
  const sampled = [];
  for (let i = 0; i < parsed.length; i += step) {
    sampled.push(parsed[i]);
    if (sampled.length >= maxPoints) break;
  }
  return sampled;
}

function parseQuadBBox(value: any): QuadBBoxNorm | null {
  if (!value || typeof value !== 'object') return null;
  const left = clamp01(Number(value.left ?? 0));
  const top = clamp01(Number(value.top ?? 0));
  const width = clamp01(Number(value.width ?? 0));
  const height = clamp01(Number(value.height ?? 0));
  if (width <= 0 || height <= 0) return null;
  return {
    left,
    top,
    width,
    height,
  };
}

function mapCardPointToOverlay(point: QuadPointNorm, overlay: OverlaySize) {
  const maxX = Math.max(1, overlay.width);
  const maxY = Math.max(1, overlay.height);
  const x = (CARD_FRAME.left + point.x * CARD_FRAME.width) * maxX;
  const y = (CARD_FRAME.top + point.y * CARD_FRAME_HEIGHT_RATIO) * maxY;
  return {
    x: Math.max(0, Math.min(maxX, x)),
    y: Math.max(0, Math.min(maxY, y)),
  };
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeAverageQuadShiftPx(
  prevPoints: QuadPointNorm[] | null,
  nextPoints: QuadPointNorm[] | null,
  overlay: OverlaySize
) {
  if (!prevPoints || !nextPoints || prevPoints.length !== 4 || nextPoints.length !== 4) return 0;
  if (!overlay.width || !overlay.height) return 0;
  let sum = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = mapCardPointToOverlay(prevPoints[i], overlay);
    const b = mapCardPointToOverlay(nextPoints[i], overlay);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    sum += Math.sqrt(dx * dx + dy * dy);
  }
  return sum / 4;
}

function pickLeanScanFormat(visionModule: any, device: any) {
  if (!visionModule || !device?.formats?.length) return null;
  if (typeof visionModule.getCameraFormat === 'function') {
    try {
      return visionModule.getCameraFormat(device, [
        { videoResolution: { width: 1280, height: 720 } },
        { photoResolution: { width: 1280, height: 720 } },
        { fps: 30 },
      ]);
    } catch {
      // fallback below
    }
  }

  const formats = Array.isArray(device.formats) ? device.formats : [];
  const candidates = formats
    .filter((format) => {
      const videoPixels = Number(format?.videoWidth ?? 0) * Number(format?.videoHeight ?? 0);
      const photoPixels = Number(format?.photoWidth ?? 0) * Number(format?.photoHeight ?? 0);
      return videoPixels > 0 && photoPixels > 0 && videoPixels <= (1280 * 720) && photoPixels <= (1280 * 720);
    })
    .sort((a, b) => {
      const aVideo = Number(a?.videoWidth ?? 0) * Number(a?.videoHeight ?? 0);
      const bVideo = Number(b?.videoWidth ?? 0) * Number(b?.videoHeight ?? 0);
      return bVideo - aVideo;
    });
  return candidates[0] ?? formats[0] ?? null;
}

export default function ScanScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const [visionCameraModule, setVisionCameraModule] = useState<any>(null);
  const [visionDevice, setVisionDevice] = useState<any>(null);
  const [visionFormat, setVisionFormat] = useState<any>(null);
  const [cameraInstallError, setCameraInstallError] = useState('');
  const [permission, setPermission] = useState<'loading' | 'granted' | 'denied'>('loading');
  const [cameraReady, setCameraReady] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hintText, setHintText] = useState('Loading scanner...');
  const [debugOverlay, setDebugOverlay] = useState<DebugOverlayState>(createInitialDebugOverlay());
  const [candidates, setCandidates] = useState<any[]>([]);
  const [overlaySize, setOverlaySize] = useState<OverlaySize>({ width: 0, height: 0 });
  const debugMode = __DEV__;

  const VisionCamera = visionCameraModule?.Camera;
  const hybridCameraRef = useRef<any>(null);
  const scanningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigatedRef = useRef(false);
  const pausedRef = useRef(false);
  const hasCandidatesRef = useRef(false);
  const firstMissAtRef = useRef<number | null>(null);
  const scanInFlightRef = useRef(false);
  const scanCycleIdRef = useRef(0);
  const scanWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableMatchRef = useRef<{ cardId: string; count: number }>({ cardId: '', count: 0 });
  const stableQuadFramesRef = useRef(0);
  const hashCooldownUntilRef = useRef(0);
  const softHamLockRef = useRef<{ startedAt: number; cardId: string; bestMinHam: number } | null>(null);
  const previousReadyQuadRef = useRef<QuadPointNorm[] | null>(null);

  const hasCandidates = candidates.length > 0;
  const canScan = useMemo(() => {
    const cameraAvailable = !!VisionCamera && !!visionDevice;
    return (
      isFocused &&
      cameraAvailable &&
      catalogReady &&
      cameraReady &&
      permission === 'granted' &&
      !hasCandidates &&
      !busy
    );
  }, [isFocused, VisionCamera, visionDevice, catalogReady, cameraReady, permission, hasCandidates, busy]);

  const clearScanningTimer = useCallback(() => {
    if (!scanningTimeoutRef.current) return;
    clearTimeout(scanningTimeoutRef.current);
    scanningTimeoutRef.current = null;
  }, []);

  const clearScanWatchdog = useCallback(() => {
    if (!scanWatchdogRef.current) return;
    clearTimeout(scanWatchdogRef.current);
    scanWatchdogRef.current = null;
  }, []);

  const frameProcessorAvailable = useMemo(() => {
    const proxy = visionCameraModule?.VisionCameraProxy;
    if (!proxy) return false;
    return (
      typeof proxy.setFrameProcessor === 'function' ||
      typeof proxy.initFrameProcessorPlugin === 'function'
    );
  }, [visionCameraModule]);

  useEffect(() => {
    hasCandidatesRef.current = hasCandidates;
  }, [hasCandidates]);

  useEffect(() => {
    if (!isFocused || hasCandidates) return;
    if (pausedRef.current || navigatedRef.current || scanInFlightRef.current) {
      pausedRef.current = false;
      navigatedRef.current = false;
      scanInFlightRef.current = false;
      clearScanningTimer();
      setHintText('Point your camera at a card');
    }
  }, [isFocused, hasCandidates, clearScanningTimer]);

  useEffect(() => {
    let mounted = true;

    const setupCore = async () => {
      try {
        setHintText('Loading scanner...');
        await ensureCatalogReady();
        setHintText('Warming fingerprint cache...');
        try {
          await withTimeout(warmFingerprintResolverCache({ chunkSize: 8000 }), 20000, 'warm_fingerprint_cache');
        } catch {
          // Non-blocking fallback: resolver will use sqlite path.
        }
        if (!mounted) return;
        setCatalogReady(true);
        setHintText('Point your camera at a card');
      } catch (setupError) {
        if (!mounted) return;
        setCatalogReady(false);
        setHintText('Scanner init failed. Check catalog and retry.');
        setError(setupError instanceof Error ? setupError.message : 'Errore inizializzazione scanner.');
      }
    };

    void setupCore();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    setCameraReady(false);
    setPermission('loading');
    setCameraInstallError('');

    const setupHybridCamera = async () => {
      try {
        const visionModuleName = 'react-native-vision-camera';
        const mod = await import(visionModuleName);
        if (!mounted) return;
        setVisionCameraModule(mod);
        const status = await mod.Camera.getCameraPermissionStatus();
        if (isVisionCameraPermissionGranted(status)) {
          setPermission('granted');
        } else {
          const requested = await mod.Camera.requestCameraPermission();
          setPermission(isVisionCameraPermissionGranted(requested) ? 'granted' : 'denied');
        }
        const devices = mod.Camera.getAvailableCameraDevices?.() ?? [];
        const back = devices.find((device: any) => device?.position === 'back') ?? null;
        setVisionDevice(back);
        setVisionFormat(pickLeanScanFormat(mod, back));
      } catch {
        if (!mounted) return;
        setVisionCameraModule(null);
        setVisionDevice(null);
        setVisionFormat(null);
        setPermission('denied');
        setCameraInstallError('Scanner hash non disponibile. Installa react-native-vision-camera.');
      }
    };

    void setupHybridCamera();

    return () => {
      mounted = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      navigatedRef.current = false;
      pausedRef.current = false;
      firstMissAtRef.current = null;
      stableMatchRef.current = { cardId: '', count: 0 };
      stableQuadFramesRef.current = 0;
      hashCooldownUntilRef.current = 0;
      softHamLockRef.current = null;
      previousReadyQuadRef.current = null;
      setCandidates([]);
      setError('');
      setDebugOverlay(createInitialDebugOverlay());
      if (catalogReady) setHintText('Point your camera at a card');
      return () => {
        clearScanningTimer();
        clearScanWatchdog();
      };
    }, [catalogReady, clearScanningTimer, clearScanWatchdog])
  );

  const navigateToCard = useCallback(
    (cardId: string) => {
      clearScanningTimer();
      pausedRef.current = true;
      setCandidates([]);
      setError('');
      setHintText('Matched');
      firstMissAtRef.current = null;
      navigatedRef.current = true;
      try {
        router.push(`/search/card/${cardId}`);
      } catch {
        navigatedRef.current = false;
        setError('Errore apertura dettaglio carta. Riprova.');
      }
    },
    [clearScanningTimer, router]
  );

  const captureHybridFrame = useCallback(async (): Promise<CapturedFrame> => {
    const empty: CapturedFrame = { uri: '', width: 0, height: 0, base64: '' };
    const camera = hybridCameraRef.current;
    if (!camera) return empty;

    if (typeof camera.takeSnapshot === 'function') {
      try {
        const snapshot = await camera.takeSnapshot({
          quality: 65,
          skipMetadata: true,
        });
        const uri = await ensureExistingFileUri(snapshot?.path ?? snapshot?.uri ?? snapshot);
        if (uri) {
          let base64 = '';
          try {
            base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
          } catch {
            base64 = '';
          }
          return {
            uri,
            width: Number(snapshot?.width ?? 0),
            height: Number(snapshot?.height ?? 0),
            base64,
          };
        }
      } catch {
        // fallback below
      }
    }

    if (typeof camera.takePhoto === 'function') {
      try {
        const photo = await camera.takePhoto({
          qualityPrioritization: 'speed',
          enableShutterSound: false,
          skipMetadata: true,
        });
        const uri = await ensureExistingFileUri(photo?.path ?? photo?.uri ?? photo);
        if (uri) {
          return {
            uri,
            width: Number(photo?.width ?? 0),
            height: Number(photo?.height ?? 0),
            base64: '',
          };
        }
      } catch {
        // no-op
      }
    }

    return empty;
  }, []);

  const runScanCycle = useCallback(async () => {
    if (!canScan || pausedRef.current || navigatedRef.current || scanInFlightRef.current) return;
    const cycleId = ++scanCycleIdRef.current;
    const cycleStartedAt = Date.now();
    scanInFlightRef.current = true;
    setBusy(true);
    setDebugOverlay((prev) => ({
      ...prev,
      cycleId: String(cycleId),
      lastStage: 'cycle_start',
      lastDurationMs: '-',
    }));

    clearScanWatchdog();
    scanWatchdogRef.current = setTimeout(() => {
      scanInFlightRef.current = false;
      setBusy(false);
      setDebugOverlay((prev) => ({
        ...prev,
        lastStage: 'watchdog_recovered',
      }));
      setError('Watchdog: scanner cycle stalled and was recovered.');
    }, PROCESS_TIMEOUT_MS + 2500);

    const startedAt = Date.now();
    let capturedFrame: CapturedFrame = { uri: '', width: 0, height: 0, base64: '' };

    try {
      console.log(`[scan] cycle=${cycleId} stage=capturing:start`);
      setHintText('Tracking card quad...');
      setDebugOverlay((prev) => ({ ...prev, lastStage: 'capturing' }));
      capturedFrame = await withTimeout(captureHybridFrame(), CAPTURE_TIMEOUT_MS, 'hybrid_capture');
      console.log(`[scan] cycle=${cycleId} stage=capturing:done uri=${capturedFrame.uri ? 'ok' : 'empty'}`);
      if (!capturedFrame.uri) {
        setDebugOverlay((prev) => ({ ...prev, lastStage: 'capture_empty' }));
        return;
      }

      setDebugOverlay((prev) => ({ ...prev, lastStage: 'tracking' }));
      const trackingResult = await withTimeout(
        analyzeFrameForQuadTracking({
          imageUri: capturedFrame.uri,
          imageBase64: capturedFrame.base64,
          imageWidth: capturedFrame.width,
          imageHeight: capturedFrame.height,
          cardFrame: CARD_FRAME,
          fullCardFrameInCard: FULL_CARD_HASH_FRAME,
        }),
        TRACK_PROCESS_TIMEOUT_MS,
        'track_frame'
      );
      const trackingDebug = trackingResult?.debug || null;
      let trackingQuadPoints: QuadPointNorm[] | null = null;
      if (trackingDebug) {
        const quadPoints = parseQuadPoints(trackingDebug.quadPointsCardNorm);
        trackingQuadPoints = quadPoints;
        const edgePoints = debugMode ? parseEdgePoints(trackingDebug.edgePointsCardNorm) : null;
        const quadBBox = parseQuadBBox(trackingDebug.quadBBoxCardNorm);
        setDebugOverlay({
          phashHi: '-',
          phashLo: '-',
          dhashHi: '-',
          dhashLo: '-',
          bucket16: '-',
          rawHits: '-',
          minHamming: '-',
          minHamSwap: '-',
          hashPreviewUri: '',
          cycleId: String(cycleId),
          lastStage: `tracking:${trackingResult?.status ?? 'none'}`,
          lastDurationMs: String(Date.now() - cycleStartedAt),
          lastError: '-',
          blurVariance: String(trackingDebug.blurVariance ?? '-'),
          quadConfidence: String(trackingDebug.quadConfidence ?? '-'),
          quadDetected: trackingDebug.quadDetected ? '1' : '0',
          quadGate: String(trackingDebug.quadGate ?? QUAD_CONFIDENCE_GATE),
          quadPointsCardNorm: quadPoints,
          edgePointsCardNorm: edgePoints,
          quadBBoxCardNorm: quadBBox,
        });
      }

      if (trackingResult?.reason === 'blur_too_low') {
        softHamLockRef.current = null;
        stableQuadFramesRef.current = 0;
        stableMatchRef.current = { cardId: '', count: 0 };
        previousReadyQuadRef.current = null;
        setHintText('Frame blurred. Hold steady');
        setError((prev) => (prev ? '' : prev));
        return;
      }

      if (trackingResult?.status !== 'ready') {
        softHamLockRef.current = null;
        stableQuadFramesRef.current = 0;
        stableMatchRef.current = { cardId: '', count: 0 };
        previousReadyQuadRef.current = null;
        if (trackingResult?.reason === 'quad_confidence_low') {
          setHintText('Tracking quad... center full card');
        } else {
          setHintText('Searching card edges...');
        }
        setError((prev) => (prev ? '' : prev));
        return;
      }

      const quadShiftPx = computeAverageQuadShiftPx(
        previousReadyQuadRef.current,
        trackingQuadPoints,
        overlaySize
      );
      if (quadShiftPx > MAX_QUAD_SHIFT_PX_FOR_HASH) {
        previousReadyQuadRef.current = trackingQuadPoints;
        stableQuadFramesRef.current = 0;
        setHintText(`Quad moving (${quadShiftPx.toFixed(1)}px). Hold steady`);
        setError((prev) => (prev ? '' : prev));
        return;
      }
      if (trackingQuadPoints?.length === 4) {
        previousReadyQuadRef.current = trackingQuadPoints;
      }

      stableQuadFramesRef.current += 1;
      if (stableQuadFramesRef.current < QUAD_STABLE_FRAMES_REQUIRED) {
        setHintText(`Quad stable ${stableQuadFramesRef.current}/${QUAD_STABLE_FRAMES_REQUIRED}`);
        setError((prev) => (prev ? '' : prev));
        return;
      }

      if (Date.now() < hashCooldownUntilRef.current) {
        return;
      }
      hashCooldownUntilRef.current = Date.now() + HASH_COOLDOWN_MS;

      setHintText('Recognizing (Fingerprint + Warp)...');
      setDebugOverlay((prev) => ({ ...prev, lastStage: 'hashing' }));
      const result = await withTimeout(
        processFrameAndResolveCard({
          imageUri: capturedFrame.uri,
          cardFrame: CARD_FRAME,
          fullCardFrameInCard: FULL_CARD_HASH_FRAME,
          maxVariantsPrimary: 1,
          maxVariantsExtended: 2,
          enableExtendedPass: false,
          includeDebugPreview: false,
        }),
        HASH_PROCESS_TIMEOUT_MS,
        'hash_frame'
      );

      const cycleDebug = result?.debug || null;
      setDebugOverlay((prev) => ({ ...prev, lastStage: `hash:${result?.status ?? 'unknown'}` }));

      if (cycleDebug) {
        const quadPoints = parseQuadPoints(cycleDebug.quadPointsCardNorm);
        const edgePoints = debugMode ? parseEdgePoints(cycleDebug.edgePointsCardNorm) : null;
        const quadBBox = parseQuadBBox(cycleDebug.quadBBoxCardNorm);
        setDebugOverlay({
          phashHi: String(cycleDebug.phash_hi ?? '-'),
          phashLo: String(cycleDebug.phash_lo ?? '-'),
          dhashHi: String(cycleDebug.dhash_hi ?? '-'),
          dhashLo: String(cycleDebug.dhash_lo ?? '-'),
          bucket16: String(cycleDebug.bucket16 ?? '-'),
          rawHits: String(cycleDebug.rawHitsCount ?? '-'),
          minHamming: String(cycleDebug.minHammingDistance ?? '-'),
          minHamSwap: String(cycleDebug.minHammingDistanceSwapHiLo ?? '-'),
          hashPreviewUri: cycleDebug.hashPreviewBase64 ? `data:image/jpeg;base64,${cycleDebug.hashPreviewBase64}` : '',
          cycleId: String(cycleId),
          lastStage: `hash:${result?.status ?? 'unknown'}`,
          lastDurationMs: String(Date.now() - cycleStartedAt),
          lastError: '-',
          blurVariance: String(cycleDebug.blurVariance ?? '-'),
          quadConfidence: String(cycleDebug.quadConfidence ?? '-'),
          quadDetected: cycleDebug.quadDetected ? '1' : '0',
          quadGate: String(cycleDebug.quadGate ?? QUAD_CONFIDENCE_GATE),
          quadPointsCardNorm: quadPoints,
          edgePointsCardNorm: edgePoints,
          quadBBoxCardNorm: quadBBox,
        });
      } else {
        setDebugOverlay((prev) => ({
          ...prev,
          cycleId: String(cycleId),
          lastDurationMs: String(Date.now() - cycleStartedAt),
          lastError: '-',
        }));
      }

      const minHamValue = toFiniteNumber(cycleDebug?.minHammingDistance);
      let softLockExpired = false;
      if (
        minHamValue != null &&
        minHamValue >= MIN_HAM_SOFT_LOCK_MIN &&
        minHamValue <= MIN_HAM_SOFT_LOCK_MAX
      ) {
        const now = Date.now();
        const cardKey = String(result?.cardId ?? '');
        const currentLock = softHamLockRef.current;
        if (!currentLock || currentLock.cardId !== cardKey) {
          softHamLockRef.current = {
            startedAt: now,
            cardId: cardKey,
            bestMinHam: minHamValue,
          };
        } else {
          currentLock.bestMinHam = Math.min(currentLock.bestMinHam, minHamValue);
        }
        const elapsedSoftLock = now - (softHamLockRef.current?.startedAt ?? now);
        if (elapsedSoftLock < MIN_HAM_SOFT_LOCK_MS) {
          setHintText(
            `Soft-lock minHam ${minHamValue}. Cerco <= ${MIN_HAM_HARD_MATCH} (${MIN_HAM_SOFT_LOCK_MS - elapsedSoftLock}ms)`
          );
          setError((prev) => (prev ? '' : prev));
          return;
        }
        softLockExpired = true;
        softHamLockRef.current = null;
      } else {
        softHamLockRef.current = null;
      }

      if (result.status === 'matched' && result.cardId) {
        const confidence = Number(result.confidence ?? 0);
        const definitiveByHamming = minHamValue != null && minHamValue <= MIN_HAM_HARD_MATCH;
        const definitiveByConfidenceFallback =
          minHamValue == null && confidence >= FINGERPRINT_MATCH_THRESHOLD;
        if (!softLockExpired && (definitiveByHamming || definitiveByConfidenceFallback)) {
          if (stableMatchRef.current.cardId === String(result.cardId)) {
            stableMatchRef.current.count += 1;
          } else {
            stableMatchRef.current = { cardId: String(result.cardId), count: 1 };
          }

          if (stableMatchRef.current.count >= FINGERPRINT_STABLE_FRAMES) {
            await recordScanMetric({
              engine: SCANNER_ENGINES.HYBRID_HASH_BETA,
              status: 'matched',
              matchedBy: result.matchedBy,
              confidence,
              latencyMs: Date.now() - startedAt,
            });
            navigateToCard(String(result.cardId));
            return;
          }
        } else {
          stableMatchRef.current = { cardId: '', count: 0 };
        }
      } else {
        stableMatchRef.current = { cardId: '', count: 0 };
      }

      if (result.status === 'ambiguous' && Array.isArray(result.candidates) && result.candidates.length) {
        pausedRef.current = true;
        clearScanningTimer();
        await recordScanMetric({
          engine: SCANNER_ENGINES.HYBRID_HASH_BETA,
          status: 'ambiguous',
          matchedBy: result.matchedBy,
          confidence: result.confidence,
          latencyMs: Date.now() - startedAt,
        });
        setCandidates(result.candidates);
        setHintText('Need manual select');
        return;
      }

      await recordScanMetric({
        engine: SCANNER_ENGINES.HYBRID_HASH_BETA,
        status: 'none',
        matchedBy: result?.matchedBy ?? null,
        confidence: result?.confidence ?? null,
        latencyMs: Date.now() - startedAt,
      });

      if (firstMissAtRef.current == null) {
        firstMissAtRef.current = Date.now();
      }
      const elapsed = Date.now() - firstMissAtRef.current;
      if (result?.reason === 'quad_confidence_low') {
        stableQuadFramesRef.current = 0;
        setHintText('Quad low confidence. Keep full card in frame and hold steady');
      } else if (softLockExpired) {
        setHintText('Soft-lock scaduto: serve un frame piu pulito (minHam <= 15)');
      } else if (elapsed >= NOT_FOUND_HINT_DELAY_MS) {
        setHintText('No confident hash match yet. Hold steady on full card');
      } else {
        setHintText('Fingerprint scan active');
      }

      setError((prev) => (prev ? '' : prev));
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : '';
      console.error(`[scan] cycle=${cycleId} stage=error message=${message || 'unknown'}`);
      setDebugOverlay((prev) => ({
        ...prev,
        lastStage: `error:${message || 'unknown'}`,
        lastDurationMs: String(Date.now() - cycleStartedAt),
        lastError: message || 'unknown',
      }));
      if (message === 'timeout:hash_frame') {
        setHintText('Frame dropped (slow hash), continuing...');
        setError((prev) => (prev ? '' : prev));
      } else if (message.startsWith('timeout:')) {
        setError('Scanner temporaneamente lento. Riprovo automaticamente.');
      } else {
        setError('Errore durante la scansione locale. Riprova.');
      }
    } finally {
      clearScanWatchdog();
      if (capturedFrame.uri) {
        await FileSystem.deleteAsync(capturedFrame.uri, { idempotent: true }).catch(() => {});
      }
      setBusy(false);
      scanInFlightRef.current = false;
    }
  }, [canScan, clearScanWatchdog, clearScanningTimer, captureHybridFrame, debugMode, navigateToCard, overlaySize]);

  useEffect(() => {
    clearScanningTimer();
    if (!canScan || pausedRef.current || navigatedRef.current) return undefined;

    const loop = async () => {
      await runScanCycle();
      if (!pausedRef.current && !navigatedRef.current && !hasCandidatesRef.current) {
        scanningTimeoutRef.current = setTimeout(loop, HYBRID_SCAN_INTERVAL_MS);
      }
    };

    scanningTimeoutRef.current = setTimeout(loop, 450);
    return clearScanningTimer;
  }, [canScan, runScanCycle, clearScanningTimer]);

  const mappedQuad = useMemo(() => {
    const points = debugOverlay.quadPointsCardNorm;
    const confidence = Number(debugOverlay.quadConfidence);
    if (!points || points.length !== 4) return null;
    if (!Number.isFinite(confidence) || confidence < QUAD_CONFIDENCE_GATE) return null;
    if (!overlaySize.width || !overlaySize.height) return null;

    const mappedPoints = points.map((point) => mapCardPointToOverlay(point, overlaySize));
    const segments = mappedPoints.map((start, index) => {
      const end = mappedPoints[(index + 1) % mappedPoints.length];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const angle = Math.atan2(dy, dx);
      return {
        key: `seg-${index}`,
        left: (start.x + end.x) / 2 - length / 2,
        top: (start.y + end.y) / 2 - 1,
        width: length,
        angle,
      };
    });

    let mappedBBox = null;
    if (debugOverlay.quadBBoxCardNorm) {
      const bbox = debugOverlay.quadBBoxCardNorm;
      const topLeft = mapCardPointToOverlay({ x: bbox.left, y: bbox.top }, overlaySize);
      const bottomRight = mapCardPointToOverlay(
        {
          x: clamp01(bbox.left + bbox.width),
          y: clamp01(bbox.top + bbox.height),
        },
        overlaySize
      );
      mappedBBox = {
        left: Math.min(topLeft.x, bottomRight.x),
        top: Math.min(topLeft.y, bottomRight.y),
        width: Math.abs(bottomRight.x - topLeft.x),
        height: Math.abs(bottomRight.y - topLeft.y),
      };
    }

    return {
      points: mappedPoints,
      segments,
      bbox: mappedBBox,
      confidence,
    };
  }, [debugOverlay.quadPointsCardNorm, debugOverlay.quadBBoxCardNorm, debugOverlay.quadConfidence, overlaySize]);

  const mappedEdgePoints = useMemo(() => {
    if (!debugMode) return [];
    const points = debugOverlay.edgePointsCardNorm;
    if (!points || !points.length) return [];
    if (!overlaySize.width || !overlaySize.height) return [];
    return points.map((point, index) => {
      const mapped = mapCardPointToOverlay(point, overlaySize);
      return {
        key: `edge-${index}`,
        x: mapped.x,
        y: mapped.y,
      };
    });
  }, [debugMode, debugOverlay.edgePointsCardNorm, overlaySize]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0d10' }} edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingBottom: 10, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <Pressable
            onPress={() => {
              clearScanningTimer();
              navigatedRef.current = true;
              router.back();
            }}
            style={{
              minWidth: 44,
              minHeight: 44,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.2)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="chevron-back" size={22} color="#ffffff" />
          </Pressable>
          <Text style={{ color: '#ffffff', fontSize: 30, fontWeight: '700' }}>Scan</Text>
        </View>

        <Text style={{ color: '#9aa4b2', fontSize: 12 }}>Engine: Fingerprint + Perspective Warp</Text>

        {permission === 'loading' ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
            <ActivityIndicator size="small" color="#ffffff" />
            <Text style={{ color: '#9aa4b2', marginTop: 8 }}>Requesting camera permission...</Text>
          </View>
        ) : permission === 'denied' ? (
          <View style={{ gap: 10 }}>
            <Text style={{ color: '#ffb5b5' }}>
              Camera permission denied. Enable it in phone settings and reopen scanner.
            </Text>
            {cameraInstallError ? <Text style={{ color: '#ffb5b5' }}>{cameraInstallError}</Text> : null}
          </View>
        ) : (
          <View style={{ gap: 12, flex: 1, minHeight: 0 }}>
            <View
              style={{
                flex: 1,
                minHeight: 0,
                borderRadius: 14,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.2)',
              }}
            >
              {VisionCamera && visionDevice ? (
                <VisionCamera
                  ref={hybridCameraRef}
                  style={{ width: '100%', height: '100%' }}
                  device={visionDevice}
                  format={visionFormat || undefined}
                  isActive={isFocused && !hasCandidates}
                  photo
                  video
                  photoQualityBalance="speed"
                  onInitialized={() => setCameraReady(true)}
                />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#ffb5b5' }}>{cameraInstallError || 'Hybrid camera unavailable'}</Text>
                </View>
              )}

              <View
                pointerEvents="none"
                onLayout={(event) => {
                  const { width, height } = event.nativeEvent.layout;
                  setOverlaySize({ width, height });
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {mappedEdgePoints.map((point) => (
                  <View
                    key={point.key}
                    style={{
                      position: 'absolute',
                      left: point.x - 1,
                      top: point.y - 1,
                      width: 2,
                      height: 2,
                      borderRadius: 1,
                      backgroundColor: 'rgba(255,210,90,0.9)',
                    }}
                  />
                ))}
                {mappedQuad ? (
                  <>
                    {mappedQuad.segments.map((segment) => (
                      <View
                        key={segment.key}
                        style={{
                          position: 'absolute',
                          left: segment.left,
                          top: segment.top,
                          width: segment.width,
                          height: 2,
                          backgroundColor: '#3ef57c',
                          transform: [{ rotateZ: `${segment.angle}rad` }],
                          opacity: 0.95,
                        }}
                      />
                    ))}
                    {mappedQuad.points.map((point, index) => (
                      <View
                        key={`pt-${index}`}
                        style={{
                          position: 'absolute',
                          left: point.x - 3,
                          top: point.y - 3,
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: '#3ef57c',
                        }}
                      />
                    ))}
                    {mappedQuad.bbox ? (
                      <View
                        style={{
                          position: 'absolute',
                          left: mappedQuad.bbox.left,
                          top: mappedQuad.bbox.top,
                          width: mappedQuad.bbox.width,
                          height: mappedQuad.bbox.height,
                          borderWidth: 2,
                          borderColor: 'rgba(62,245,124,0.8)',
                          borderRadius: 6,
                        }}
                      />
                    ) : null}
                  </>
                ) : null}

                <View
                  style={{
                    marginTop: 14,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.45)',
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    backgroundColor: 'rgba(10,12,16,0.75)',
                    minWidth: 260,
                    maxWidth: '82%',
                    gap: 4,
                  }}
                >
                  <Text style={{ color: '#d8dde5', fontSize: 14, textAlign: 'center' }}>{hintText}</Text>
                  <Text style={{ color: '#9aa4b2', fontSize: 11, textAlign: 'center' }}>
                    {catalogReady
                      ? 'Hash-only pipeline: edge quad + perspective warp + fingerprint'
                      : 'Preparing local catalog...'}
                  </Text>
                </View>

                <View
                  style={{
                    position: 'absolute',
                    left: 8,
                    right: 8,
                    top: 8,
                    borderRadius: 8,
                    paddingHorizontal: 8,
                    paddingVertical: 6,
                    backgroundColor: 'rgba(10,12,16,0.72)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.18)',
                    gap: 2,
                  }}
                >
                  <Text style={{ color: '#c6d0de', fontSize: 10 }}>
                    p_hi: {debugOverlay.phashHi} | p_lo: {debugOverlay.phashLo}
                  </Text>
                  <Text style={{ color: '#c6d0de', fontSize: 10 }}>
                    d_hi: {debugOverlay.dhashHi} | d_lo: {debugOverlay.dhashLo}
                  </Text>
                  <Text style={{ color: '#c6d0de', fontSize: 10 }}>
                    bucket16: {debugOverlay.bucket16} | hits(raw): {debugOverlay.rawHits} | minHam: {debugOverlay.minHamming}
                  </Text>
                  <Text style={{ color: '#c6d0de', fontSize: 10 }}>minHamSwap(hi/lo): {debugOverlay.minHamSwap}</Text>
                  <Text style={{ color: '#c6d0de', fontSize: 10 }}>
                    quad:{debugOverlay.quadDetected} conf:{debugOverlay.quadConfidence} gate:{debugOverlay.quadGate} blur:{' '}
                    {debugOverlay.blurVariance}
                  </Text>
                  <Text style={{ color: '#c6d0de', fontSize: 10 }}>
                    edgePts:{debugOverlay.edgePointsCardNorm?.length ?? 0}
                  </Text>
                  <Text style={{ color: '#9fb2c9', fontSize: 10 }}>
                    perm:{permission} cam:{cameraReady ? '1' : '0'} cat:{catalogReady ? '1' : '0'} fp:
                    {frameProcessorAvailable ? '1' : '0'}
                  </Text>
                  <Text style={{ color: '#9fb2c9', fontSize: 10 }}>
                    scan:{canScan ? '1' : '0'} focus:{isFocused ? '1' : '0'} busy:{busy ? '1' : '0'} modal:{hasCandidates ? '1' : '0'}
                  </Text>
                  <Text style={{ color: '#9fb2c9', fontSize: 10 }}>
                    cycle:{debugOverlay.cycleId} stage:{debugOverlay.lastStage} dur:{debugOverlay.lastDurationMs}ms
                  </Text>
                  <Text style={{ color: '#ffb5b5', fontSize: 10 }}>err:{debugOverlay.lastError}</Text>
                  <Text style={{ color: '#9fb2c9', fontSize: 10 }}>
                    resize:{HASH_RESIZE_ALGO} gray:{HASH_GRAYSCALE_BIT_DEPTH}bit ar:{MTG_CARD_ASPECT_RATIO.toFixed(3)}
                  </Text>
                  {debugOverlay.hashPreviewUri ? (
                    <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ color: '#9fb2c9', fontSize: 10 }}>hash-img:</Text>
                      <Image
                        source={{ uri: debugOverlay.hashPreviewUri }}
                        style={{ width: 48, height: 48, borderRadius: 4, borderWidth: 1, borderColor: '#5b6470' }}
                      />
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
            {error ? <Text style={{ color: '#ff8a8a', textAlign: 'center' }}>{error}</Text> : null}
          </View>
        )}
      </View>

      <Modal visible={hasCandidates} transparent animationType="fade" onRequestClose={() => setCandidates([])}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.72)',
            justifyContent: 'center',
            paddingHorizontal: 20,
            paddingVertical: 24,
          }}
        >
          <View
            style={{
              borderRadius: 16,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.25)',
              backgroundColor: '#121722',
              padding: 14,
              maxHeight: '78%',
              gap: 10,
            }}
          >
            <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '700' }}>Select Card Edition</Text>
            <Text style={{ color: '#9aa4b2', fontSize: 13 }}>
              Scanner found multiple candidates. Choose the exact printing.
            </Text>
            <FlatList
              data={candidates}
              keyExtractor={(item, index) => `${item.id}-${item.set_code}-${item.collector_number}-${index}`}
              contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => navigateToCard(String(item.id))}
                  style={{
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.18)',
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: 'rgba(255,255,255,0.03)',
                  }}
                >
                  <Text style={{ color: '#ffffff', fontSize: 14 }} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={{ color: '#9aa4b2', fontSize: 12, marginTop: 4 }} numberOfLines={1}>
                    {formatEditionLabel(item)}
                  </Text>
                </Pressable>
              )}
            />
            <Pressable
              onPress={() => {
                pausedRef.current = false;
                setCandidates([]);
                firstMissAtRef.current = Date.now();
                setHintText('Point your camera at a card');
              }}
              style={{
                minHeight: 44,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.35)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#ffffff' }}>Continue scanning</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
