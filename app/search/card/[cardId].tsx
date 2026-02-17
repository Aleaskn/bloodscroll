import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import ManaSymbols, { parseManaCost } from '../../../components/decks/ManaSymbols';
import { getCardById, getCachedCardFaces, getCachedImageUri } from '../../../data/scryfall';
import { getCatalogCardById } from '../../../data/catalogDb';

function buildPrimaryFace(card) {
  return {
    name: card?.name ?? 'Card',
    type_line: card?.type_line ?? '',
    oracle_text: card?.oracle_text ?? '',
    mana_cost:
      card?.mana_cost ??
      card?.card_faces?.map((face) => face?.mana_cost).filter(Boolean).join(' // ') ??
      '',
    image_uri: card?.image_uris?.normal ?? card?.card_faces?.[0]?.image_uris?.normal ?? null,
    color_identity: card?.color_identity ?? [],
  };
}

export default function SearchCardDetailScreen() {
  const router = useRouter();
  const { cardId } = useLocalSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offlineNotice, setOfflineNotice] = useState('');
  const [card, setCard] = useState<any>(null);
  const [faces, setFaces] = useState<any[]>([]);
  const [activeFaceIndex, setActiveFaceIndex] = useState(0);
  const { width } = useWindowDimensions();
  const previewWidth = Math.max(220, width - 40);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!cardId) return;
      setLoading(true);
      setError('');
      setOfflineNotice('');
      try {
        let fullCard = null;
        try {
          fullCard = await getCardById(String(cardId));
        } catch {
          fullCard = null;
        }

        if (fullCard) {
          const cachedPrimary = await getCachedImageUri(fullCard);
          const primaryFace = {
            ...buildPrimaryFace(fullCard),
            image_uri: cachedPrimary || buildPrimaryFace(fullCard).image_uri,
          };

          const cachedFaces = await getCachedCardFaces(String(cardId));
          if (cachedFaces.length > 1) {
            setFaces(cachedFaces);
          } else {
            setFaces([primaryFace]);
          }
          setCard(fullCard);
          setActiveFaceIndex(0);
          return;
        }

        const localCard = await getCatalogCardById(String(cardId));
        if (!localCard) {
          if (mounted) setError('Carta non trovata.');
          return;
        }

        const offlineFace = {
          name: localCard.name,
          type_line: localCard.type_line ?? '',
          oracle_text: '',
          mana_cost: localCard.mana_cost ?? '',
          image_uri: null,
          color_identity: [],
        };

        setCard({
          ...localCard,
          color_identity: [],
        });
        setFaces([offlineFace]);
        setActiveFaceIndex(0);
        setOfflineNotice('Modalità offline: dettagli ridotti, immagine non disponibile.');
      } catch {
        if (mounted) setError('Errore durante il caricamento della carta.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [cardId]);

  const activeFace = faces[activeFaceIndex];
  const manaTokens = useMemo(() => parseManaCost(activeFace?.mana_cost), [activeFace?.mana_cost]);
  const editionLabel = useMemo(() => {
    const setCode = card?.set ?? card?.set_code;
    const collector = card?.collector_number;
    if (!setCode && !collector) return '';
    return [setCode ? String(setCode).toUpperCase() : null, collector].filter(Boolean).join(' • ');
  }, [card?.collector_number, card?.set, card?.set_code]);
  const identityTokens = useMemo(
    () =>
      Array.isArray(card?.color_identity)
        ? card.color_identity
        : Array.isArray(activeFace?.color_identity)
          ? activeFace.color_identity
          : [],
    [activeFace?.color_identity, card?.color_identity]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0d10' }} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 0 }}>
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
          <Text
            style={{ color: '#ffffff', fontSize: 24, fontWeight: '700', flex: 1 }}
            numberOfLines={1}
          >
            {loading ? 'Card' : activeFace?.name || 'Card'}
          </Text>
        </View>

        {loading ? (
          <Text style={{ color: '#b6c0cf', marginTop: 12 }}>Loading...</Text>
        ) : error ? (
          <Text style={{ color: '#ff8a8a', marginTop: 12 }}>{error}</Text>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
            {offlineNotice ? (
              <Text style={{ color: '#f0c674', marginTop: 10 }}>{offlineNotice}</Text>
            ) : null}
            <View style={{ marginTop: 10 }}>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(event) => {
                  const pageWidth = event.nativeEvent.layoutMeasurement.width || 1;
                  const index = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
                  setActiveFaceIndex(index);
                }}
              >
                {faces.map((face, index) => (
                  <Image
                    key={`${face?.image_uri}-${index}`}
                    source={face?.image_uri ? { uri: face.image_uri } : undefined}
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
              {faces.length > 1 ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: 8,
                    gap: 6,
                  }}
                >
                  {faces.map((_, index) => (
                    <View
                      key={`face-dot-${index}`}
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

            <Text style={{ color: '#ffffff', fontSize: 28, fontWeight: '700', marginTop: 14 }}>
              {activeFace?.name}
            </Text>
            <Text style={{ color: '#9aa4b2', marginTop: 4 }}>{activeFace?.type_line}</Text>
            {editionLabel ? (
              <Text style={{ color: '#9aa4b2', marginTop: 4, fontSize: 12 }}>{editionLabel}</Text>
            ) : null}
            {manaTokens.length ? (
              <View style={{ marginTop: 8 }}>
                <ManaSymbols tokens={manaTokens} size={18} gap={4} />
              </View>
            ) : null}
            {activeFace?.oracle_text ? (
              <Text style={{ color: '#e0e5ef', marginTop: 12, lineHeight: 20 }}>
                {activeFace.oracle_text}
              </Text>
            ) : null}
            {identityTokens.length ? (
              <View style={{ marginTop: 14 }}>
                <ManaSymbols tokens={identityTokens} size={18} gap={4} />
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}
