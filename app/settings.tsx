import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DeckHeader from '../components/decks/DeckHeader';
import {
  checkForCatalogUpdate,
  downloadAndApplyCatalogUpdate,
  getCatalogMeta,
} from '../data/catalogUpdate';
import { getFingerprintStats } from '../data/catalogDb';
import { getScanMetricsSummary } from '../data/scanMetrics';

function formatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString();
}

function percent(value) {
  if (value == null || Number.isNaN(Number(value))) return '0.0%';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

export default function SettingsScreen() {
  const [meta, setMeta] = useState<any>(null);
  const [fingerprintStats, setFingerprintStats] = useState({ total: 0, uniqueCards: 0 });
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');

  const refreshAll = useCallback(async () => {
    const [catalogMeta, fpStats, metricsSummary] = await Promise.all([
      getCatalogMeta(),
      getFingerprintStats(),
      getScanMetricsSummary({ sinceDays: 7 }),
    ]);
    setMeta(catalogMeta);
    setFingerprintStats(fpStats);
    setMetrics(metricsSummary);
  }, []);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        await refreshAll();
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [refreshAll]);

  const applyUpdate = useCallback(
    async (manifestItem) => {
      setChecking(true);
      setMessage('');
      try {
        const result = await downloadAndApplyCatalogUpdate(manifestItem);
        await refreshAll();
        setMessage(`Catalog updated: ${result.version}`);
      } catch {
        setMessage('Update failed. Please retry later.');
      } finally {
        setChecking(false);
      }
    },
    [refreshAll]
  );

  const checkNow = useCallback(async () => {
    setChecking(true);
    setMessage('');
    try {
      const result = await checkForCatalogUpdate({ force: true });
      if (result.status === 'update_available' && result.manifestItem) {
        const targetVersion = result.manifestVersion ?? result.manifestItem.version;
        Alert.alert('Catalog update available', `New version ${targetVersion} found.`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Download',
            onPress: () => {
              void applyUpdate(result.manifestItem);
            },
          },
        ]);
      } else if (result.status === 'up_to_date') {
        setMessage('Catalog is already up to date.');
      } else if (result.status === 'throttled') {
        setMessage(`Update check throttled. Next check: ${formatDate(result.nextCheckAt)}`);
      } else if (result.status === 'error') {
        setMessage(`Update check failed: ${result.reason}`);
      } else {
        setMessage('No updates available right now.');
      }
      await refreshAll();
    } finally {
      setChecking(false);
    }
  }, [applyUpdate, refreshAll]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0d10' }} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, paddingHorizontal: 20, gap: 12 }}>
        <DeckHeader title="Impostazioni" subtitle="Catalogo locale scanner" />

        <View
          style={{
            borderRadius: 12,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.2)',
            backgroundColor: 'rgba(255,255,255,0.03)',
            padding: 12,
            gap: 6,
          }}
        >
          {loading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color="#ffffff" />
              <Text style={{ color: '#b6c0cf' }}>Loading catalog status...</Text>
            </View>
          ) : (
            <>
              <Text style={{ color: '#ffffff' }}>Version: {meta?.version ?? 'bootstrap'}</Text>
              <Text style={{ color: '#9aa4b2' }}>Source: {meta?.source ?? 'bundled asset'}</Text>
              <Text style={{ color: '#9aa4b2' }}>Updated: {formatDate(meta?.updatedAt)}</Text>
              <Text style={{ color: '#9aa4b2' }}>Last check: {formatDate(meta?.lastCheckAt)}</Text>
              <Text style={{ color: '#9aa4b2' }}>Fingerprints: {fingerprintStats.total}</Text>
              <Text style={{ color: '#9aa4b2' }}>Fingerprint cards: {fingerprintStats.uniqueCards}</Text>
            </>
          )}
        </View>

        <View
          style={{
            borderRadius: 12,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.2)',
            backgroundColor: 'rgba(255,255,255,0.03)',
            padding: 12,
            gap: 8,
          }}
        >
          <Text style={{ color: '#ffffff', fontWeight: '700' }}>Scanner mode</Text>
          <Text style={{ color: '#9aa4b2' }}>Fingerprint + Perspective Warp (hash-only)</Text>
          <Text style={{ color: '#9aa4b2' }}>
            Binary gate active: frame is processed only when quad detection confidence is high.
          </Text>
        </View>

        <View
          style={{
            borderRadius: 12,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.2)',
            backgroundColor: 'rgba(255,255,255,0.03)',
            padding: 12,
            gap: 6,
          }}
        >
          <Text style={{ color: '#ffffff', fontWeight: '700' }}>Scanner metrics (7d)</Text>
          <Text style={{ color: '#9aa4b2' }}>Samples: {metrics?.total ?? 0}</Text>
          <Text style={{ color: '#9aa4b2' }}>Direct match rate: {percent(metrics?.directMatchRate)}</Text>
          <Text style={{ color: '#9aa4b2' }}>Ambiguous rate: {percent(metrics?.ambiguousRate)}</Text>
          <Text style={{ color: '#9aa4b2' }}>False positive rate: {percent(metrics?.falsePositiveRate)}</Text>
          <Text style={{ color: '#9aa4b2' }}>Avg time to match: {metrics?.avgLatencyMs ?? 'N/A'} ms</Text>
        </View>

        <Pressable
          onPress={checkNow}
          disabled={checking}
          style={{
            minHeight: 44,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: checking ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.45)',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: checking ? 0.6 : 1,
          }}
        >
          <Text style={{ color: '#ffffff' }}>{checking ? 'Checking updates...' : 'Check updates now'}</Text>
        </Pressable>

        {message ? <Text style={{ color: '#9aa4b2' }}>{message}</Text> : null}
      </View>
    </SafeAreaView>
  );
}
