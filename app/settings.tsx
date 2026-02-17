import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DeckHeader from '../components/decks/DeckHeader';
import {
  checkForCatalogUpdate,
  downloadAndApplyCatalogUpdate,
  getCatalogMeta,
} from '../data/catalogUpdate';

function formatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString();
}

export default function SettingsScreen() {
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');

  const refreshMeta = useCallback(async () => {
    const next = await getCatalogMeta();
    setMeta(next);
  }, []);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const next = await getCatalogMeta();
        if (!mounted) return;
        setMeta(next);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const applyUpdate = useCallback(
    async (manifestItem) => {
      setChecking(true);
      setMessage('');
      try {
        const result = await downloadAndApplyCatalogUpdate(manifestItem);
        await refreshMeta();
        setMessage(`Catalog updated: ${result.version}`);
      } catch {
        setMessage('Update failed. Please retry later.');
      } finally {
        setChecking(false);
      }
    },
    [refreshMeta]
  );

  const checkNow = useCallback(async () => {
    setChecking(true);
    setMessage('');
    try {
      const result = await checkForCatalogUpdate({ force: true });
      if (result.status === 'update_available' && result.manifestItem) {
        const targetVersion = result.manifestVersion ?? result.manifestItem.version;
        Alert.alert(
          'Catalog update available',
          `New version ${targetVersion} found.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Download',
              onPress: () => {
                void applyUpdate(result.manifestItem);
              },
            },
          ]
        );
      } else if (result.status === 'up_to_date') {
        setMessage('Catalog is already up to date.');
      } else if (result.status === 'throttled') {
        setMessage(`Update check throttled. Next check: ${formatDate(result.nextCheckAt)}`);
      } else if (result.status === 'error') {
        setMessage(`Update check failed: ${result.reason}`);
      } else {
        setMessage('No updates available right now.');
      }
      await refreshMeta();
    } finally {
      setChecking(false);
    }
  }, [applyUpdate, refreshMeta]);

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
            </>
          )}
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

