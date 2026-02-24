import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import { ensureCatalogReady } from '../data/catalogDb';
import { processFrameAndResolveCard } from '../data/scanEngine';
import { isOnDeviceOcrAvailable } from '../data/ocrOnDevice';
import { recordScanMetric } from '../data/scanMetrics';
import { getScanSettings, SCANNER_ENGINES } from '../data/scanSettings';
import { HASH_GRAYSCALE_BIT_DEPTH, HASH_RESIZE_ALGO, MTG_CARD_ASPECT_RATIO } from '../data/hashConfig';

const LEGACY_SCAN_INTERVAL_MS = 1200;
const HYBRID_SCAN_INTERVAL_MS = 260;
const NOT_FOUND_HINT_DELAY_MS = 9000;
const CARD_FRAME = {
  left: 0.18,
  top: 0.22,
  width: 0.64,
  aspectRatio: MTG_CARD_ASPECT_RATIO,
};
const EDITION_FRAME = {
  leftInCard: 0.035,
  topInCard: 0.91,
  widthInCard: 0.5,
  heightInCard: 0.065,
};
const FULL_CARD_HASH_FRAME = {
  leftInCard: 0.02,
  topInCard: 0.02,
  widthInCard: 0.96,
  heightInCard: 0.96,
};
const DECISION_CONFIDENCE_THRESHOLD = 0.95;
const DECISION_STABLE_FRAMES = 2;
const CAPTURE_TIMEOUT_MS = 3500;
const PROCESS_TIMEOUT_MS = 7000;

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

export default function ScanScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const [scanSettings, setScanSettings] = useState({
    engine: SCANNER_ENGINES.HYBRID_HASH_BETA,
    multilingualFallback: false,
  });
  const [cameraModule, setCameraModule] = useState<any>(null);
  const [visionCameraModule, setVisionCameraModule] = useState<any>(null);
  const [visionDevice, setVisionDevice] = useState<any>(null);
  const [cameraInstallError, setCameraInstallError] = useState('');
  const [permission, setPermission] = useState<'loading' | 'granted' | 'denied'>('loading');
  const [cameraReady, setCameraReady] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hintText, setHintText] = useState('Loading scanner...');
  const [debugOverlay, setDebugOverlay] = useState({
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
  });
  const [candidates, setCandidates] = useState<any[]>([]);
  const CameraView = cameraModule?.CameraView;
  const VisionCamera = visionCameraModule?.Camera;
  const legacyCameraRef = useRef<any>(null);
  const hybridCameraRef = useRef<any>(null);
  const scanningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigatedRef = useRef(false);
  const pausedRef = useRef(false);
  const hasCandidatesRef = useRef(false);
  const firstMissAtRef = useRef<number | null>(null);
  const missStreakRef = useRef(0);
  const scanInFlightRef = useRef(false);
  const scanCycleIdRef = useRef(0);
  const scanWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syntheticFrameOnceRef = useRef(true);
  const stableMatchRef = useRef<{ cardId: string; count: number }>({ cardId: '', count: 0 });

  const usingHybrid = scanSettings.engine === SCANNER_ENGINES.HYBRID_HASH_BETA;
  const hasCandidates = candidates.length > 0;
  const canScan = useMemo(() => {
    const cameraAvailable = usingHybrid ? !!VisionCamera && !!visionDevice : !!CameraView;
    return (
      isFocused &&
      cameraAvailable &&
      catalogReady &&
      cameraReady &&
      permission === 'granted' &&
      !hasCandidates &&
      !busy
    );
  }, [
    isFocused,
    usingHybrid,
    VisionCamera,
    visionDevice,
    CameraView,
    catalogReady,
    cameraReady,
    permission,
    hasCandidates,
    busy,
  ]);

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

  const refreshScanSettings = useCallback(async () => {
    const next = await getScanSettings();
    setScanSettings(next);
  }, []);

  useEffect(() => {
    let mounted = true;

    const setupCore = async () => {
      try {
        setHintText('Loading scanner...');
        await refreshScanSettings();

        // OCR availability is optional in Hybrid mode during bootstrap.
        const ocrReady = await isOnDeviceOcrAvailable();
        if (!ocrReady && !usingHybrid) {
          throw new Error('OCR on-device non disponibile. Verifica la build di sviluppo.');
        }

        await ensureCatalogReady();
        if (!mounted) return;
        setCatalogReady(true);
        setHintText('Point your camera at a card');
      } catch (setupError) {
        if (!mounted) return;
        setCatalogReady(false);
        setHintText('Scanner init failed. Check catalog and retry.');
        setError(
          setupError instanceof Error
            ? setupError.message
            : 'Errore inizializzazione scanner.'
        );
      }
    };

    void setupCore();
    return () => {
      mounted = false;
    };
  }, [refreshScanSettings, usingHybrid]);

  useEffect(() => {
    let mounted = true;
    setCameraReady(false);
    setPermission('loading');
    setCameraInstallError('');

    const setupLegacyCamera = async () => {
      try {
        const mod = await import('expo-camera');
        if (!mounted) return;
        setCameraModule(mod);
        const current = await mod.Camera.getCameraPermissionsAsync();
        if (current.granted) {
          setPermission('granted');
        } else {
          const requested = await mod.Camera.requestCameraPermissionsAsync();
          setPermission(requested.granted ? 'granted' : 'denied');
        }
      } catch {
        if (!mounted) return;
        setCameraModule(null);
        setPermission('denied');
        setCameraInstallError('Scanner legacy non disponibile. Installa expo-camera.');
      }
    };

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
      } catch {
        if (!mounted) return;
        setVisionCameraModule(null);
        setVisionDevice(null);
        setPermission('denied');
        setCameraInstallError('Scanner hash beta non disponibile. Installa react-native-vision-camera.');
      }
    };

    if (usingHybrid) {
      void setupHybridCamera();
    } else {
      void setupLegacyCamera();
    }

    return () => {
      mounted = false;
    };
  }, [usingHybrid]);

  useFocusEffect(
    useCallback(() => {
      void refreshScanSettings();
      navigatedRef.current = false;
      pausedRef.current = false;
      firstMissAtRef.current = null;
      missStreakRef.current = 0;
      stableMatchRef.current = { cardId: '', count: 0 };
      setCandidates([]);
      setError('');
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
        cycleId: '0',
        lastStage: '-',
        lastDurationMs: '-',
        lastError: '-',
      });
      if (catalogReady) setHintText('Point your camera at a card');
      return () => {
        clearScanningTimer();
        clearScanWatchdog();
      };
    }, [catalogReady, clearScanningTimer, clearScanWatchdog, refreshScanSettings])
  );

  const navigateToCard = useCallback(
    (cardId: string) => {
      clearScanningTimer();
      pausedRef.current = true;
      missStreakRef.current = 0;
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

  const captureLegacyUri = useCallback(async () => {
    if (!legacyCameraRef.current) return '';
    const photo = await legacyCameraRef.current.takePictureAsync({
      quality: 0.45,
      skipProcessing: false,
      shutterSound: false,
    });
    return photo?.uri || '';
  }, []);

  const captureHybridUri = useCallback(async () => {
    const camera = hybridCameraRef.current;
    if (!camera) return '';

    // iOS is generally more stable with takePhoto in dev builds.
    if (typeof camera.takePhoto === 'function') {
      try {
        const photo = await camera.takePhoto({
          qualityPrioritization: 'speed',
          enableShutterSound: false,
          skipMetadata: true,
        });
        const fromPhoto = await ensureExistingFileUri(photo?.path ?? photo?.uri ?? photo);
        if (fromPhoto) return fromPhoto;
      } catch {
        // fallback below
      }
    }

    if (typeof camera.takeSnapshot === 'function') {
      try {
        const snapshot = await camera.takeSnapshot({
          quality: 85,
          skipMetadata: true,
        });
        const fromSnapshot = await ensureExistingFileUri(snapshot?.path ?? snapshot?.uri ?? snapshot);
        if (fromSnapshot) return fromSnapshot;
      } catch {
        // no-op
      }
    }

    return '';
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
    let capturedUri = '';

    try {
      console.log(`[scan] cycle=${cycleId} stage=capturing:start`);
      setHintText(usingHybrid ? 'Recognizing (Hybrid Hash)...' : 'Recognizing...');
      setDebugOverlay((prev) => ({ ...prev, lastStage: 'capturing' }));
      capturedUri = usingHybrid
        ? await withTimeout(captureHybridUri(), CAPTURE_TIMEOUT_MS, 'hybrid_capture')
        : await withTimeout(captureLegacyUri(), CAPTURE_TIMEOUT_MS, 'legacy_capture');
      console.log(`[scan] cycle=${cycleId} stage=capturing:done uri=${capturedUri ? 'ok' : 'empty'}`);
      if (!capturedUri) {
        setDebugOverlay((prev) => ({ ...prev, lastStage: 'capture_empty' }));
        return;
      }

      const shouldAllowOcrFallback = !usingHybrid || missStreakRef.current >= 1;

      setDebugOverlay((prev) => ({ ...prev, lastStage: 'processing' }));
      console.log(
        `[scan] cycle=${cycleId} stage=processing:start synthetic=${
          syntheticFrameOnceRef.current ? '1' : '0'
        }`
      );
      const result = await withTimeout(
        processFrameAndResolveCard({
          imageUri: capturedUri,
          cardFrame: CARD_FRAME,
          editionFrameInCard: EDITION_FRAME,
          fullCardFrameInCard: FULL_CARD_HASH_FRAME,
          enableMultilingualFallback: scanSettings.multilingualFallback,
          allowOcrFallback: shouldAllowOcrFallback,
          skipEditionOcrInPrimary: usingHybrid,
          useSyntheticPixels: syntheticFrameOnceRef.current,
        }),
        PROCESS_TIMEOUT_MS,
        'process_frame'
      );
      syntheticFrameOnceRef.current = false;
      console.log(`[scan] cycle=${cycleId} stage=processing:done status=${result?.status ?? 'unknown'}`);
      const cycleDebug = result?.debug || result?.evidence?.debug || null;
      setDebugOverlay((prev) => ({ ...prev, lastStage: `processed:${result?.status ?? 'unknown'}` }));
      if (cycleDebug) {
        setDebugOverlay({
          phashHi: String(cycleDebug.phash_hi ?? '-'),
          phashLo: String(cycleDebug.phash_lo ?? '-'),
          dhashHi: String(cycleDebug.dhash_hi ?? '-'),
          dhashLo: String(cycleDebug.dhash_lo ?? '-'),
          bucket16: String(cycleDebug.bucket16 ?? '-'),
          rawHits: String(cycleDebug.rawHitsCount ?? '-'),
          minHamming: String(cycleDebug.minHammingDistance ?? '-'),
          minHamSwap: String(cycleDebug.minHammingDistanceSwapHiLo ?? '-'),
          hashPreviewUri: cycleDebug.hashPreviewBase64
            ? `data:image/jpeg;base64,${cycleDebug.hashPreviewBase64}`
            : '',
          cycleId: String(cycleId),
          lastStage: `processed:${result?.status ?? 'unknown'}`,
          lastDurationMs: String(Date.now() - cycleStartedAt),
          lastError: '-',
        });
      } else {
        setDebugOverlay((prev) => ({
          ...prev,
          rawHits: '-',
          minHamming: '-',
          minHamSwap: '-',
          hashPreviewUri: '',
          cycleId: String(cycleId),
          lastDurationMs: String(Date.now() - cycleStartedAt),
          lastError: '-',
        }));
      }

      if (result.status === 'matched' && result.cardId) {
        const confidence = Number(result.confidence ?? 0);
        const matchedBy = String(result.matchedBy ?? '');
        const isFingerprintDriven =
          matchedBy.startsWith('fingerprint') || matchedBy.includes('consensus');
        const threshold = isFingerprintDriven ? 0.88 : DECISION_CONFIDENCE_THRESHOLD;
        const requiredStableFrames = isFingerprintDriven ? 1 : DECISION_STABLE_FRAMES;
        if (confidence >= threshold) {
          if (stableMatchRef.current.cardId === String(result.cardId)) {
            stableMatchRef.current.count += 1;
          } else {
            stableMatchRef.current = { cardId: String(result.cardId), count: 1 };
          }
          if (stableMatchRef.current.count >= requiredStableFrames) {
            missStreakRef.current = 0;
            await recordScanMetric({
              engine: scanSettings.engine,
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
        missStreakRef.current = 0;
        pausedRef.current = true;
        clearScanningTimer();
        await recordScanMetric({
          engine: scanSettings.engine,
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
        engine: scanSettings.engine,
        status: 'none',
        matchedBy: result?.matchedBy ?? null,
        confidence: result?.confidence ?? null,
        latencyMs: Date.now() - startedAt,
      });

      missStreakRef.current += 1;

      if (firstMissAtRef.current == null) {
        firstMissAtRef.current = Date.now();
      }
      const elapsed = Date.now() - firstMissAtRef.current;
      if (elapsed >= NOT_FOUND_HINT_DELAY_MS) {
        setHintText('No confident hash match yet. Hold steady on artwork');
      } else {
        setHintText(
          shouldAllowOcrFallback
            ? 'Hash miss: OCR fallback enabled'
            : 'Hash-first scan active (OCR fallback delayed)'
        );
      }
      if (error) setError('');
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : '';
      console.error(`[scan] cycle=${cycleId} stage=error message=${message || 'unknown'}`);
      setDebugOverlay((prev) => ({
        ...prev,
        lastStage: `error:${message || 'unknown'}`,
        lastDurationMs: String(Date.now() - cycleStartedAt),
        lastError: message || 'unknown',
      }));
      if (message.startsWith('timeout:')) {
        setError('Scanner temporaneamente lento. Riprovo automaticamente.');
      } else {
        setError('Errore durante la scansione locale. Riprova.');
      }
    } finally {
      clearScanWatchdog();
      if (capturedUri) {
        await FileSystem.deleteAsync(capturedUri, { idempotent: true }).catch(() => {});
      }
      setBusy(false);
      scanInFlightRef.current = false;
    }
  }, [
    canScan,
    clearScanningTimer,
    usingHybrid,
    captureHybridUri,
    captureLegacyUri,
    scanSettings.engine,
    scanSettings.multilingualFallback,
    error,
    navigateToCard,
    clearScanWatchdog,
  ]);

  useEffect(() => {
    clearScanningTimer();
    if (!canScan || pausedRef.current || navigatedRef.current) return undefined;

    const interval = usingHybrid ? HYBRID_SCAN_INTERVAL_MS : LEGACY_SCAN_INTERVAL_MS;
    const loop = async () => {
      await runScanCycle();
      if (!pausedRef.current && !navigatedRef.current && !hasCandidatesRef.current) {
        scanningTimeoutRef.current = setTimeout(loop, interval);
      }
    };

    scanningTimeoutRef.current = setTimeout(loop, 450);
    return clearScanningTimer;
  }, [canScan, usingHybrid, runScanCycle, clearScanningTimer]);

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

        <Text style={{ color: '#9aa4b2', fontSize: 12 }}>
          Engine: {usingHybrid ? 'Hybrid Hash (Beta)' : 'Legacy OCR'}
        </Text>

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
              {usingHybrid ? (
                VisionCamera && visionDevice ? (
                  <VisionCamera
                    ref={hybridCameraRef}
                    style={{ width: '100%', height: '100%' }}
                    device={visionDevice}
                    isActive={isFocused && !hasCandidates}
                    photo
                    onInitialized={() => setCameraReady(true)}
                  />
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#ffb5b5' }}>{cameraInstallError || 'Hybrid camera unavailable'}</Text>
                  </View>
                )
              ) : CameraView ? (
                <CameraView
                  ref={legacyCameraRef}
                  style={{ width: '100%', height: '100%' }}
                  mode="picture"
                  facing="back"
                  onCameraReady={() => setCameraReady(true)}
                  autofocus="off"
                />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#ffb5b5' }}>{cameraInstallError || 'Legacy camera unavailable'}</Text>
                </View>
              )}

              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  inset: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    position: 'absolute',
                    left: `${CARD_FRAME.left * 100}%`,
                    top: `${CARD_FRAME.top * 100}%`,
                    width: `${CARD_FRAME.width * 100}%`,
                    aspectRatio: CARD_FRAME.aspectRatio,
                    borderWidth: 3,
                    borderRadius: 10,
                    borderColor: 'rgba(255,255,255,0.85)',
                    backgroundColor: 'rgba(255,255,255,0.06)',
                  }}
                />
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
                      ? usingHybrid
                        ? 'Fingerprint-first + OCR footer disambiguation'
                        : 'OCR title first, edition only for ambiguous matches'
                      : 'Preparing local catalog...'}
                  </Text>
                </View>

                {usingHybrid ? (
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
                      bucket16: {debugOverlay.bucket16} | hits(raw): {debugOverlay.rawHits} | minHam:{' '}
                      {debugOverlay.minHamming}
                    </Text>
                    <Text style={{ color: '#c6d0de', fontSize: 10 }}>
                      minHamSwap(hi/lo): {debugOverlay.minHamSwap}
                    </Text>
                    <Text style={{ color: '#9fb2c9', fontSize: 10 }}>
                      perm:{permission} cam:{cameraReady ? '1' : '0'} cat:{catalogReady ? '1' : '0'}
                    </Text>
                    <Text style={{ color: '#9fb2c9', fontSize: 10 }}>
                      scan:{canScan ? '1' : '0'} focus:{isFocused ? '1' : '0'} busy:{busy ? '1' : '0'} modal:
                      {hasCandidates ? '1' : '0'}
                    </Text>
                    <Text style={{ color: '#9fb2c9', fontSize: 10 }}>
                      cycle:{debugOverlay.cycleId} stage:{debugOverlay.lastStage} dur:{debugOverlay.lastDurationMs}ms
                    </Text>
                    <Text style={{ color: '#ffb5b5', fontSize: 10 }}>
                      err:{debugOverlay.lastError}
                    </Text>
                    <Text style={{ color: '#9fb2c9', fontSize: 10 }}>
                      resize:{HASH_RESIZE_ALGO} gray:{HASH_GRAYSCALE_BIT_DEPTH}bit ar:
                      {MTG_CARD_ASPECT_RATIO.toFixed(3)}
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
                ) : null}
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
                missStreakRef.current = 0;
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
