import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DeckBottomBar from '../../../components/decks/DeckBottomBar';
import DeckHeader from '../../../components/decks/DeckHeader';
import DeckCardRow from '../../../components/decks/DeckCardRow';
import { getCard, getDeck } from '../../../data/db';

const SECTION_ORDER = [
  'CREATURE',
  'ARTEFATTI',
  'INCANTESIMI',
  'ISTANTANEI',
  'STREGONERIE',
  'PLANESWALKER',
  'BATTAGLIE',
  'TERRE',
  'ALTRO',
];

const SECTION_LABELS = {
  CREATURE: 'CREATURE',
  ARTEFATTI: 'ARTEFATTI',
  INCANTESIMI: 'INCANTESIMI',
  ISTANTANEI: 'ISTANTANEI',
  STREGONERIE: 'STREGONERIE',
  PLANESWALKER: 'PLANESWALKER',
  BATTAGLIE: 'BATTAGLIE',
  TERRE: 'TERRE',
  ALTRO: 'ALTRO',
};

function mapTypeToSection(typeLine) {
  const type = (typeLine ?? '').toLowerCase();
  if (type.includes('creature')) return 'CREATURE';
  if (type.includes('artifact')) return 'ARTEFATTI';
  if (type.includes('enchantment')) return 'INCANTESIMI';
  if (type.includes('instant')) return 'ISTANTANEI';
  if (type.includes('sorcery')) return 'STREGONERIE';
  if (type.includes('planeswalker')) return 'PLANESWALKER';
  if (type.includes('battle')) return 'BATTAGLIE';
  if (type.includes('land')) return 'TERRE';
  return 'ALTRO';
}

function groupDeckCardsByType(cards) {
  const grouped = cards.reduce((acc, card) => {
    const key = mapTypeToSection(card.type_line);
    if (!acc[key]) acc[key] = [];
    acc[key].push(card);
    return acc;
  }, {});

  return SECTION_ORDER.map((sectionKey) => {
    const data = (grouped[sectionKey] ?? []).sort((a, b) => a.name.localeCompare(b.name));
    return {
      key: sectionKey,
      title: SECTION_LABELS[sectionKey],
      data,
      count: data.reduce((sum, card) => sum + (card.quantity || 0), 0),
    };
  }).filter((section) => section.data.length > 0);
}

export default function DeckDetailScreen() {
  const { deckId } = useLocalSearchParams();
  const router = useRouter();
  const [deck, setDeck] = useState(null);
  const [loading, setLoading] = useState(true);
  const [commander, setCommander] = useState(null);

  const load = useCallback(async () => {
    if (!deckId) return;
    setLoading(true);
    const data = await getDeck(String(deckId));
    setDeck(data);
    if (data?.commander_card_id) {
      const cmd = await getCard(data.commander_card_id);
      setCommander(cmd);
    } else {
      setCommander(null);
    }
    setLoading(false);
  }, [deckId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const totalCards = deck?.cards?.reduce((sum, c) => sum + (c.quantity || 0), 0) ?? 0;
  const nonCommanderCards =
    deck?.cards?.filter((c) => !c.is_commander).reduce((sum, c) => sum + c.quantity, 0) ?? 0;
  const sections = groupDeckCardsByType(deck?.cards ?? []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0d10' }} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <DeckHeader
          title={loading || !deck ? 'Deck' : deck.name}
          subtitle={
            loading || !deck
              ? undefined
              : `Total ${totalCards} • Non-Commander ${nonCommanderCards}`
          }
        />
        {loading || !deck ? (
          <Text style={{ color: '#b6c0cf' }}>Loading...</Text>
        ) : (
          <>
            <Text style={{ color: '#9aa4b2', marginTop: 2 }}>
              Commander: {commander?.name ?? 'None'}
            </Text>
            {!commander ? (
              <Text style={{ color: '#ffb347', marginTop: 6 }}>
                Set a Commander to unlock card validation.
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable
                onPress={() => router.push(`/(tabs)/decks/search?deckId=${deck.id}&mode=commander`)}
                style={{
                  minHeight: 44,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.4)',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: '#ffffff' }}>Set Commander</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push(`/(tabs)/decks/search?deckId=${deck.id}`)}
                style={{
                  minHeight: 44,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.4)',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: '#ffffff' }}>Search & Add Cards</Text>
              </Pressable>
            </View>
            <SectionList
              sections={sections}
              keyExtractor={(item) => item.card_id}
              contentContainerStyle={{ paddingVertical: 16, gap: 8, paddingBottom: 100 }}
              renderSectionHeader={({ section }) => (
                <View
                  style={{
                    marginTop: 12,
                    marginBottom: 8,
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: 8,
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#ffffff', fontSize: 20, fontWeight: '700' }}>
                    {section.title}
                  </Text>
                  <Text style={{ color: '#9aa4b2', fontSize: 14 }}>{section.count} carte</Text>
                </View>
              )}
              renderItem={({ item }) => (
                <DeckCardRow
                  name={item.name}
                  imageUri={item.art_image_uri || item.image_uri}
                  manaCost={item.mana_cost}
                  typeLine={item.type_line}
                  quantity={item.quantity}
                  onPress={() =>
                    router.push(`/(tabs)/decks/card/${item.card_id}?deckId=${deck.id}`)
                  }
                />
              )}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              stickySectionHeadersEnabled={false}
              ListEmptyComponent={
                <Text style={{ color: '#9aa4b2' }}>
                  Nessuna carta ancora. Usa Search & Add Cards.
                </Text>
              }
            />
          </>
        )}
      </View>
      <DeckBottomBar />
    </SafeAreaView>
  );
}
