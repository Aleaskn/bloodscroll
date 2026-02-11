import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import DeckBottomBar from '../../../../components/decks/DeckBottomBar';
import DeckHeader from '../../../../components/decks/DeckHeader';
import ManaSymbols, { parseManaCost } from '../../../../components/decks/ManaSymbols';
import { getDeckCardById, updateCardImageUri, updateDeckCardQuantity } from '../../../../data/db';
import { ensureCardImage, getCachedCardFaces } from '../../../../data/scryfall';

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
  const [faceImages, setFaceImages] = useState<string[]>([]);
  const [faces, setFaces] = useState<any[]>([]);
  const [activeFaceIndex, setActiveFaceIndex] = useState(0);
  const { width } = useWindowDimensions();
  const previewWidth = Math.max(220, width - 40);

  const load = useCallback(async () => {
    if (!cardId || !deckId) return;
    setLoading(true);
    const row = await getDeckCardById(String(deckId), String(cardId));
    if (!row) {
      setCard(null);
      setFaceImages([]);
      setFaces([]);
      setLoading(false);
      return;
    }
    const ensured = await ensureCardImage(row);
    if (ensured && ensured !== row.image_uri) {
      row.image_uri = ensured;
      await updateCardImageUri(String(cardId), ensured);
    }
    setCard(row);
    const faceData = await getCachedCardFaces(String(row.card_id));
    if (faceData.length > 1) {
      setFaces(faceData);
      setFaceImages(faceData.map((face) => face.image_uri).filter(Boolean));
    } else if (row.image_uri) {
      setFaces([]);
      setFaceImages([row.image_uri]);
    } else {
      setFaces([]);
      setFaceImages([]);
    }
    setActiveFaceIndex(0);
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
  const activeFace = faces[activeFaceIndex];
  const shownName = activeFace?.name || card?.name;
  const shownTypeLine = activeFace?.type_line || card?.type_line;
  const shownOracleText = activeFace?.oracle_text || card?.oracle_text;
  const shownManaCost = activeFace?.mana_cost || card?.mana_cost;
  const manaTokens = parseManaCost(shownManaCost);
  const hasMultipleFaces = faceImages.length > 1;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0d10' }} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <DeckHeader title={loading || !card ? 'Card' : shownName} subtitle={shownTypeLine} />
        {loading ? (
          <Text style={{ color: '#b6c0cf' }}>Loading...</Text>
        ) : !card ? (
          <Text style={{ color: '#ff8a8a' }}>Carta non trovata nel deck.</Text>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
            {faceImages.length ? (
              <View>
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(event) => {
                    const width = event.nativeEvent.layoutMeasurement.width || 1;
                    const index = Math.round(event.nativeEvent.contentOffset.x / width);
                    setActiveFaceIndex(index);
                  }}
                >
                  {faceImages.map((uri, index) => (
                    <Image
                      key={`${uri}-${index}`}
                      source={{ uri }}
                      style={{
                        width: previewWidth,
                        aspectRatio: 0.715,
                        borderRadius: 14,
                        backgroundColor: '#0f141c',
                      }}
                      contentFit="contain"
                    />
                  ))}
                </ScrollView>
                {hasMultipleFaces ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8, gap: 6 }}>
                    {faceImages.map((_, index) => (
                      <View
                        key={`dot-${index}`}
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 4,
                          backgroundColor:
                            index === activeFaceIndex ? '#ffffff' : 'rgba(255,255,255,0.35)',
                        }}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : (
              <View
                style={{
                  width: '100%',
                  aspectRatio: 0.715,
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
              {shownName}
            </Text>
            <Text style={{ color: '#9aa4b2', marginTop: 4 }}>{shownTypeLine}</Text>
            {manaTokens.length ? (
              <View style={{ marginTop: 8 }}>
                <ManaSymbols tokens={manaTokens} size={18} gap={4} />
              </View>
            ) : null}
            {shownOracleText ? (
              <Text style={{ color: '#e0e5ef', marginTop: 12, lineHeight: 20 }}>
                {shownOracleText}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 14 }}>
              <ManaSymbols tokens={identity} size={18} gap={4} />
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
