import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import DeckBottomBar from '../../../../components/decks/DeckBottomBar';
import DeckHeader from '../../../../components/decks/DeckHeader';
import { getDeckCardById, updateCardImageUri, updateDeckCardQuantity } from '../../../../data/db';
import { ensureCardImage } from '../../../../data/scryfall';

function parseIdentity(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function DeckCardPreviewScreen() {
  const { cardId, deckId } = useLocalSearchParams();
  const router = useRouter();
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!cardId || !deckId) return;
    setLoading(true);
    const row = await getDeckCardById(String(deckId), String(cardId));
    if (!row) {
      setCard(null);
      setLoading(false);
      return;
    }
    const ensured = await ensureCardImage(row);
    if (ensured && ensured !== row.image_uri) {
      row.image_uri = ensured;
      await updateCardImageUri(String(cardId), ensured);
    }
    setCard(row);
    setLoading(false);
  }, [cardId, deckId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const adjustQty = async (delta) => {
    if (!card || !deckId) return;
    const nextQty = Math.max(0, (card.quantity || 0) + delta);
    await updateDeckCardQuantity(String(deckId), String(card.card_id), nextQty);
    if (nextQty <= 0) {
      router.replace(`/(tabs)/decks/${String(deckId)}`);
      return;
    }
    setCard((prev) => ({ ...prev, quantity: nextQty }));
  };

  const identity = parseIdentity(card?.color_identity);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0d10' }} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <DeckHeader title={loading || !card ? 'Card' : card.name} subtitle={card?.type_line} />
        {loading ? (
          <Text style={{ color: '#b6c0cf' }}>Loading...</Text>
        ) : !card ? (
          <Text style={{ color: '#ff8a8a' }}>Carta non trovata nel deck.</Text>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
            {card.image_uri ? (
              <Image
                source={{ uri: card.image_uri }}
                style={{ width: '100%', height: 260, borderRadius: 14 }}
                contentFit="cover"
              />
            ) : (
              <View
                style={{
                  width: '100%',
                  height: 260,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.25)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: '#9aa4b2' }}>No image</Text>
              </View>
            )}
            <Text style={{ color: '#ffffff', fontSize: 24, fontWeight: '700', marginTop: 14 }}>
              {card.name}
            </Text>
            <Text style={{ color: '#9aa4b2', marginTop: 4 }}>{card.type_line}</Text>
            {card.oracle_text ? (
              <Text style={{ color: '#e0e5ef', marginTop: 12, lineHeight: 20 }}>
                {card.oracle_text}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 14 }}>
              {identity.map((symbol) => (
                <View
                  key={symbol}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.25)',
                  }}
                >
                  <Text style={{ color: '#ffffff', fontWeight: '600' }}>{symbol}</Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18, gap: 10 }}>
              <Pressable
                onPress={() => adjustQty(-1)}
                style={{
                  minWidth: 54,
                  minHeight: 44,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.35)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: '#ffffff', fontSize: 22 }}>-</Text>
              </Pressable>
              <Text style={{ color: '#ffffff', fontSize: 22, fontWeight: '700' }}>
                {card.quantity}
              </Text>
              <Pressable
                onPress={() => adjustQty(1)}
                style={{
                  minWidth: 54,
                  minHeight: 44,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.35)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: '#ffffff', fontSize: 22 }}>+</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}
      </View>
      <DeckBottomBar />
    </SafeAreaView>
  );
}
