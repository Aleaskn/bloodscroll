import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { resolveScannedCardFromOcr } from '../data/scryfall';

const OCR_API_KEY = process.env.EXPO_PUBLIC_OCR_SPACE_API_KEY || 'helloworld';
const OCR_SCAN_INTERVAL_MS = 1800;
const NOT_FOUND_HINT_DELAY_MS = 12000;

async function extractTextFromImage(base64Image, language = 'eng') {
  const form = new FormData();
  form.append('base64Image', `data:image/jpeg;base64,${base64Image}`);
  form.append('language', language);
  form.append('isOverlayRequired', 'false');
  form.append('OCREngine', '2');

  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: {
      apikey: OCR_API_KEY,
    },
    body: form,
  });

  if (!response.ok) return '';
  const payload = await response.json();
  return payload?.ParsedResults?.[0]?.ParsedText?.trim() ?? '';
}

export default function ScanScreen() {
  const router = useRouter();
  const [cameraModule, setCameraModule] = useState<any>(null);
  const [cameraInstallError, setCameraInstallError] = useState('');
  const [permission, setPermission] = useState<'loading' | 'granted' | 'denied'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hintText, setHintText] = useState('Point your camera at a card');
  const CameraView = cameraModule?.CameraView;
  const cameraRef = useRef<any>(null);
  const scanningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigatedRef = useRef(false);
  const firstMissAtRef = useRef<number | null>(null);

  const canScan = useMemo(() => !!CameraView && !busy, [CameraView, busy]);

  useEffect(() => {
    let mounted = true;
    import('expo-camera')
      .then(async (mod) => {
        if (!mounted) return;
        setCameraModule(mod);
        setCameraInstallError('');
        try {
          const current = await mod.Camera.getCameraPermissionsAsync();
          if (current.granted) {
            setPermission('granted');
            return;
          }
          const requested = await mod.Camera.requestCameraPermissionsAsync();
          setPermission(requested.granted ? 'granted' : 'denied');
        } catch {
          setPermission('denied');
        }
      })
      .catch(() => {
        if (!mounted) return;
        setCameraModule(null);
        setPermission('denied');
        setCameraInstallError('Scanner camera non disponibile. Installa il modulo expo-camera.');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const clearScanningTimer = useCallback(() => {
    if (!scanningTimeoutRef.current) return;
    clearTimeout(scanningTimeoutRef.current);
    scanningTimeoutRef.current = null;
  }, []);

  const runOcrScan = useCallback(async () => {
    if (!cameraRef.current || !canScan || navigatedRef.current) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.45,
        skipProcessing: true,
        shutterSound: false,
      });
      if (!photo?.base64) return;

      const [ocrEng, ocrJpn] = await Promise.all([
        extractTextFromImage(photo.base64, 'eng'),
        extractTextFromImage(photo.base64, 'jpn'),
      ]);
      const mergedText = [ocrEng, ocrJpn].filter(Boolean).join('\n');
      if (!mergedText) return;

      const card = await resolveScannedCardFromOcr(mergedText);
      if (!card?.id) return;

      firstMissAtRef.current = null;
      setHintText('Card recognized');
      setError('');
      navigatedRef.current = true;
      router.push(`/search/card/${card.id}`);
    } catch {
      setError('Errore durante la scansione. Riprova.');
    } finally {
      setBusy(false);
    }
  }, [canScan, router]);

  useEffect(() => {
    clearScanningTimer();
    if (!canScan || permission !== 'granted' || navigatedRef.current) return undefined;

    const loop = async () => {
      await runOcrScan();
      if (!navigatedRef.current) {
        if (firstMissAtRef.current == null) {
          firstMissAtRef.current = Date.now();
        }
        const elapsed = Date.now() - firstMissAtRef.current;
        if (elapsed >= NOT_FOUND_HINT_DELAY_MS) {
          setHintText('Card not recognized yet. Hold steady and improve light');
        } else {
          setHintText('Point your camera at a card');
        }
        scanningTimeoutRef.current = setTimeout(loop, OCR_SCAN_INTERVAL_MS);
      }
    };

    scanningTimeoutRef.current = setTimeout(loop, 500);
    return clearScanningTimer;
  }, [canScan, permission, clearScanningTimer, runOcrScan]);

  useEffect(() => {
    return clearScanningTimer;
  }, [clearScanningTimer]);

  useFocusEffect(
    useCallback(() => {
      navigatedRef.current = false;
      firstMissAtRef.current = null;
      setError('');
      setHintText('Point your camera at a card');
      return () => {
        clearScanningTimer();
      };
    }, [clearScanningTimer])
  );

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

        {!CameraView ? (
          <View style={{ gap: 12 }}>
            <Text style={{ color: '#ffb5b5' }}>{cameraInstallError}</Text>
            <Text style={{ color: '#9aa4b2', fontSize: 12 }}>
              Esegui: npx expo install expo-camera
            </Text>
          </View>
        ) : permission === 'loading' ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
            <ActivityIndicator size="small" color="#ffffff" />
            <Text style={{ color: '#9aa4b2', marginTop: 8 }}>Richiesta permesso fotocamera...</Text>
          </View>
        ) : permission === 'denied' ? (
          <View style={{ gap: 10 }}>
            <Text style={{ color: '#ffb5b5' }}>
              Accesso alla fotocamera negato. Abilitalo nelle impostazioni del telefono.
            </Text>
            <Pressable
              onPress={async () => {
                if (!cameraModule?.Camera) return;
                try {
                  const requested = await cameraModule.Camera.requestCameraPermissionsAsync();
                  setPermission(requested.granted ? 'granted' : 'denied');
                } catch {
                  setPermission('denied');
                }
              }}
              style={{
                minHeight: 44,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.3)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#ffffff' }}>Riprova permessi</Text>
            </Pressable>
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
              <CameraView
                ref={cameraRef}
                style={{ width: '100%', height: '100%' }}
                mode="picture"
                facing="back"
                autofocus="off"
              />
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
                    width: '72%',
                    aspectRatio: 0.72,
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
                  }}
                >
                  <Text style={{ color: '#d8dde5', fontSize: 14, textAlign: 'center' }}>{hintText}</Text>
                </View>
              </View>
            </View>
            {error ? <Text style={{ color: '#ff8a8a', textAlign: 'center' }}>{error}</Text> : null}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
