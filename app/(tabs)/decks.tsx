import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, Modal, TextInput } from 'react-native';
import { addCardToDeck, createDeck, initDb, listDecks, upsertCard } from '../../data/db';
import { getCachedImageUri, normalizeCard, searchCards } from '../../data/scryfall';

export default function DecksScreen() {
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [activeDeckId, setActiveDeckId] = useState(null);

  const load = async () => {
    setLoading(true);
    await initDb();
    const data = await listDecks();
    setDecks(data);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const runSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await searchCards(searchQuery.trim());
      setSearchResults(results);
    } catch (e) {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const addCard = async (card) => {
    if (!activeDeckId) return;
    const imageUri = await getCachedImageUri(card);
    const normalized = normalizeCard(card, imageUri);
    await upsertCard(normalized);
    await addCardToDeck(activeDeckId, normalized.id, 1);
    setSearchOpen(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0d10', padding: 20 }}>
      <Text style={{ color: '#ffffff', fontSize: 22, fontWeight: '600', marginBottom: 12 }}>
        Decks
      </Text>
      <Pressable
        onPress={async () => {
          await createDeck(`New Deck ${decks.length + 1}`);
          await load();
        }}
        style={{
          paddingVertical: 10,
          paddingHorizontal: 16,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.6)',
          alignSelf: 'flex-start',
        }}
      >
        <Text style={{ color: '#ffffff' }}>Crea Deck</Text>
      </Pressable>
      {loading ? (
        <Text style={{ color: '#b6c0cf', marginTop: 16 }}>Loading…</Text>
      ) : (
        <FlatList
          data={decks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingVertical: 16, gap: 8 }}
          renderItem={({ item }) => (
            <View
              style={{
                padding: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.1)',
                backgroundColor: 'rgba(255,255,255,0.03)',
                gap: 8,
              }}
            >
              <Text style={{ color: '#ffffff', fontSize: 16 }}>{item.name}</Text>
              <Text style={{ color: '#9aa4b2', fontSize: 12, marginTop: 4 }}>
                Updated {new Date(item.updated_at).toLocaleString()}
              </Text>
              <Pressable
                onPress={() => {
                  setActiveDeckId(item.id);
                  setSearchResults([]);
                  setSearchQuery('');
                  setSearchOpen(true);
                }}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.4)',
                  alignSelf: 'flex-start',
                }}
              >
                <Text style={{ color: '#ffffff' }}>Add Card</Text>
              </Pressable>
            </View>
          )}
        />
      )}

      <Modal visible={searchOpen} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', padding: 20 }}>
          <View
            style={{
              backgroundColor: '#111722',
              borderRadius: 16,
              padding: 16,
              flex: 1,
              gap: 12,
            }}
          >
            <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '600' }}>
              Search Cards
            </Text>
            <TextInput
              placeholder="Search Scryfall"
              placeholderTextColor="#8a93a0"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={runSearch}
              style={{
                backgroundColor: '#0b0d10',
                color: '#ffffff',
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            />
            <Pressable
              onPress={runSearch}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.4)',
                alignSelf: 'flex-start',
              }}
            >
              <Text style={{ color: '#ffffff' }}>Search</Text>
            </Pressable>
            {searching ? (
              <Text style={{ color: '#b6c0cf' }}>Searching…</Text>
            ) : (
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ gap: 8, paddingBottom: 16 }}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => addCard(item)}
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.15)',
                    }}
                  >
                    <Text style={{ color: '#ffffff', fontSize: 14 }}>{item.name}</Text>
                    <Text style={{ color: '#9aa4b2', fontSize: 12 }}>{item.type_line}</Text>
                  </Pressable>
                )}
              />
            )}
            <Pressable
              onPress={() => setSearchOpen(false)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 10,
                alignSelf: 'flex-end',
              }}
            >
              <Text style={{ color: '#9aa4b2' }}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
