import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import DeckBottomBar from '../../../components/decks/DeckBottomBar';
import { DeckIdentityDots } from '../../../components/decks/DeckCardRow';
import { createDeck, initDb, listDecksWithCommanderMeta, renameDeck } from '../../../data/db';

export default function DecksScreen() {
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const router = useRouter();

  const load = async () => {
    setLoading(true);
    await initDb();
    const data = await listDecksWithCommanderMeta();
    setDecks(data);
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const createDeckOptimistic = async () => {
    const optimistic = {
      id: `tmp_${Date.now()}`,
      name: '',
      updated_at: new Date().toISOString(),
      commander_name: null,
      commander_image_uri: null,
      commander_art_image_uri: null,
      commander_color_identity: null,
    };
    setDecks((prev) => [optimistic, ...prev]);
    await createDeck('');
    await load();
  };

  const parseIdentity = (value) => {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const getDeckAutoName = (deck, index) => {
    const current = (deck?.name ?? '').trim();
    if (current) return current;
    const commanderName = (deck?.commander_name ?? '').trim();
    if (commanderName) return commanderName;
    return `New Deck ${index + 1}`;
  };

  const startRename = (deck, index) => {
    setRenameTarget({ ...deck, fallbackName: getDeckAutoName(deck, index) });
    setRenameValue(deck?.name ?? '');
  };

  const saveRename = async () => {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    const computedName = trimmed || renameTarget.commander_name?.trim() || renameTarget.fallbackName;
    setDecks((prev) =>
      prev.map((deck) => (deck.id === renameTarget.id ? { ...deck, name: computedName } : deck))
    );
    await renameDeck(renameTarget.id, computedName);
    setRenameTarget(null);
    setRenameValue('');
    await load();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0d10' }} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <Text style={{ color: '#ffffff', fontSize: 30, fontWeight: '700', marginTop: 8 }}>Decks</Text>
        <Pressable
          onPress={createDeckOptimistic}
          style={{
            marginTop: 16,
            minHeight: 44,
            paddingVertical: 10,
            paddingHorizontal: 16,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.6)',
            alignSelf: 'flex-start',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#ffffff', fontSize: 18 }}>Crea Deck</Text>
        </Pressable>
        {loading ? (
          <Text style={{ color: '#b6c0cf', marginTop: 16 }}>Loading...</Text>
        ) : (
          <>
            {decks.length === 0 ? (
              <Text style={{ color: '#9aa4b2', marginTop: 16 }}>
                Nessun deck ancora. Crea il tuo primo deck.
              </Text>
            ) : null}
            <FlatList
              data={decks}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingVertical: 16, gap: 10, paddingBottom: 100 }}
              renderItem={({ item, index }) => (
                <Pressable
                  onPress={() => router.push(`/(tabs)/decks/${item.id}`)}
                  style={{
                    padding: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.1)',
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Pressable
                      onPress={(event) => {
                        event.stopPropagation();
                        startRename(item, index);
                      }}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      <Text style={{ color: '#ffffff', fontSize: 16 }} numberOfLines={1}>
                        {getDeckAutoName(item, index)}
                      </Text>
                    </Pressable>
                    <Text style={{ color: '#9aa4b2', fontSize: 12, marginTop: 4 }}>
                      Updated {new Date(item.updated_at).toLocaleString()}
                    </Text>
                  </View>
                  <Pressable
                    onPress={(event) => {
                      event.stopPropagation();
                      startRename(item, index);
                    }}
                    style={{
                      minWidth: 36,
                      minHeight: 36,
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Feather name="edit-2" size={16} color="#ffffff" />
                  </Pressable>
                  <View
                    style={{
                      width: 92,
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    {item.commander_art_image_uri || item.commander_image_uri ? (
                      <Image
                        source={{ uri: item.commander_art_image_uri || item.commander_image_uri }}
                        style={{ width: 74, height: 54, borderRadius: 8 }}
                        contentFit="cover"
                        contentPosition="top"
                      />
                    ) : (
                      <View
                        style={{
                          width: 74,
                          height: 54,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.2)',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: '#7f8794', fontSize: 10 }}>No commander</Text>
                      </View>
                    )}
                    <DeckIdentityDots identity={parseIdentity(item.commander_color_identity)} />
                  </View>
                </Pressable>
              )}
            />
          </>
        )}
      </View>
      <Modal
        visible={!!renameTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.65)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <View
            style={{
              width: '100%',
              borderRadius: 14,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.2)',
              backgroundColor: '#131822',
              padding: 14,
              gap: 12,
            }}
          >
            <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '600' }}>Rinomina Deck</Text>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Nome deck"
              placeholderTextColor="#8a93a0"
              autoFocus
              style={{
                minHeight: 44,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.2)',
                color: '#ffffff',
                paddingHorizontal: 12,
                backgroundColor: 'rgba(255,255,255,0.03)',
              }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
              <Pressable
                onPress={() => {
                  setRenameTarget(null);
                  setRenameValue('');
                }}
                style={{
                  minHeight: 40,
                  minWidth: 90,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.25)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 10,
                }}
              >
                <Text style={{ color: '#ffffff' }}>Annulla</Text>
              </Pressable>
              <Pressable
                onPress={saveRename}
                style={{
                  minHeight: 40,
                  minWidth: 90,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.4)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 10,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '600' }}>Salva</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <DeckBottomBar />
    </SafeAreaView>
  );
}
