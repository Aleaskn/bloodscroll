import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { ensureCatalogReady } from '../data/catalogDb';
import { resolveLocalScannedCard } from '../data/catalogResolver';
import {
  extractCardTextOnDevice,
  extractEditionTextOnDevice,
  isOnDeviceOcrAvailable,
} from '../data/ocrOnDevice';

const OCR_SCAN_INTERVAL_MS = 1400;
const NOT_FOUND_HINT_DELAY_MS = 9000;

function formatEditionLabel(candidate) {
  const edition = candidate?.set_code ? String(candidate.set_code).toUpperCase() : null;
  const collector = candidate?.collector_number ? String(candidate.collector_number) : null;
  return [edition, collector].filter(Boolean).join(' • ');
}

export default function ScanScreen() {
  const router = useRouter();
  const [cameraModule, setCameraModule] = useState<any>(null);
  const [cameraInstallError, setCameraInstallError] = useState('');
  const [permission, setPermission] = useState<'loading' | 'granted' | 'denied'>('loading');
  const [catalogReady, setCatalogReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hintText, setHintText] = useState('Loading local catalog...');
  const [candidates, setCandidates] = useState<any[]>([]);
  const CameraView = cameraModule?.CameraView;
  const cameraRef = useRef<any>(null);
  const scanningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigatedRef = useRef(false);
  const firstMissAtRef = useRef<number | null>(null);

  const hasCandidates = candidates.length > 0;
  const canScan = useMemo(
    () => !!CameraView && !busy && catalogReady && !hasCandidates,
    [CameraView, busy, catalogReady, hasCandidates]
  );

  useEffect(() => {
    let mounted = true;

    const setupCatalog = async () => {
      try {
        const ocrReady = await isOnDeviceOcrAvailable();
        if (!ocrReady) {
          throw new Error('OCR on-device non disponibile. Verifica la build di sviluppo.');
        }
        await ensureCatalogReady();
        if (!mounted) return;
        setCatalogReady(true);
        setHintText('Point your camera at a card');
      } catch (setupError) {
        if (!mounted) return;
        setCatalogReady(false);
        setHintText('Scanner unavailable');
        setError(setupError instanceof Error ? setupError.message : 'Errore inizializzazione scanner locale.');
      }
    };

    const setupCamera = async () => {
      try {
        const mod = await import('expo-camera');
        if (!mounted) return;
        setCameraModule(mod);
        setCameraInstallError('');

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
        setCameraInstallError('Scanner camera non disponibile. Installa il modulo expo-camera.');
      }
    };

    setupCatalog();
    setupCamera();

    return () => {
      mounted = false;
    };
  }, []);

  const clearScanningTimer = useCallback(() => {
    if (!scanningTimeoutRef.current) return;
    clearTimeout(scanningTimeoutRef.current);
    scanningTimeoutRef.current = null;
  }, []);

  const navigateToCard = useCallback(
    (cardId: string) => {
      clearScanningTimer();
      setCandidates([]);
      setError('');
      setHintText('Card recognized');
      firstMissAtRef.current = null;
      navigatedRef.current = true;
      router.push(`/search/card/${cardId}`);
    },
    [clearScanningTimer, router]
  );

  const runLocalScan = useCallback(async () => {
    if (!cameraRef.current || !canScan || navigatedRef.current) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.55,
        skipProcessing: true,
        shutterSound: false,
      });
      if (!photo?.uri) return;

      const [cardText, editionText] = await Promise.all([
        extractCardTextOnDevice(photo.uri),
        extractEditionTextOnDevice(photo.uri),
      ]);

      if (!cardText && !editionText) return;

      const result = await resolveLocalScannedCard({
        cardText,
        editionText,
      });

      if (result.status === 'matched' && result.cardId) {
        navigateToCard(String(result.cardId));
        return;
      }

      if (result.status === 'ambiguous' && Array.isArray(result.candidates) && result.candidates.length) {
        setCandidates(result.candidates);
        setHintText('Multiple editions found. Select one');
        return;
      }
    } catch {
      setError('Errore durante la scansione locale. Riprova.');
    } finally {
      setBusy(false);
    }
  }, [canScan, navigateToCard]);

  useEffect(() => {
    clearScanningTimer();
    if (!canScan || permission !== 'granted' || navigatedRef.current) return undefined;

    const loop = async () => {
      await runLocalScan();
      if (!navigatedRef.current && candidates.length === 0) {
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
  }, [canScan, candidates.length, clearScanningTimer, permission, runLocalScan]);

  useEffect(() => clearScanningTimer, [clearScanningTimer]);

  useFocusEffect(
    useCallback(() => {
      navigatedRef.current = false;
      firstMissAtRef.current = null;
      setCandidates([]);
      setError('');
      if (catalogReady) setHintText('Point your camera at a card');
      return () => {
        clearScanningTimer();
      };
    }, [catalogReady, clearScanningTimer])
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
            <Text style={{ color: '#9aa4b2', fontSize: 12 }}>Esegui: npx expo install expo-camera</Text>
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
                    position: 'absolute',
                    left: '14%',
                    bottom: '23%',
                    width: '28%',
                    aspectRatio: 1.8,
                    borderRadius: 8,
                    borderWidth: 2,
                    borderColor: 'rgba(255,255,255,0.75)',
                    backgroundColor: 'rgba(255,255,255,0.08)',
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
                    OCR title + edition code (bottom-left)
                  </Text>
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
              OCR found multiple candidates. Choose the exact printing.
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

