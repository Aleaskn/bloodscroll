import React, { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { searchCards } from '../../data/scryfall';

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  const runSearch = async () => {
    const next = query.trim();
    if (!next) return;
    setSearching(true);
    setError('');
    try {
      const data = await searchCards(next);
      setResults(data);
    } catch {
      setResults([]);
      setError('Ricerca non disponibile in questo momento.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0d10' }} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, paddingHorizontal: 20, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <Pressable
            onPress={() => router.back()}
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
          <Text style={{ color: '#ffffff', fontSize: 30, fontWeight: '700' }}>Search</Text>
        </View>

        <TextInput
          placeholder="Search Scryfall"
          placeholderTextColor="#8a93a0"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={runSearch}
          style={{
            backgroundColor: '#111722',
            color: '#ffffff',
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            minHeight: 44,
          }}
        />

        <Pressable
          onPress={runSearch}
          style={{
            minHeight: 44,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: query.trim() ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)',
            alignSelf: 'flex-start',
            opacity: query.trim() ? 1 : 0.6,
            justifyContent: 'center',
          }}
          disabled={!query.trim()}
        >
          <Text style={{ color: '#ffffff' }}>Search</Text>
        </Pressable>

        {error ? <Text style={{ color: '#ff8a8a' }}>{error}</Text> : null}
        {searching ? (
          <Text style={{ color: '#b6c0cf' }}>Searching...</Text>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ gap: 8, paddingBottom: 24 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => router.push(`/search/card/${item.id}`)}
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
            ListEmptyComponent={
              <Text style={{ color: '#9aa4b2' }}>
                Cerca una carta per vedere i risultati.
              </Text>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}
