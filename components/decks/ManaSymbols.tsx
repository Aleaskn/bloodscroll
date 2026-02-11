import React from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';

const SYMBOL_BASE_URL = 'https://svgs.scryfall.io/card-symbols';

type ManaSymbolsProps = {
  tokens: string[];
  size?: number;
  gap?: number;
};

function buildSymbolUri(token: string) {
  return `${SYMBOL_BASE_URL}/${encodeURIComponent(token)}.svg`;
}

export function parseManaCost(manaCost?: string | null) {
  if (!manaCost) return [];
  const tokens: string[] = [];
  const regex = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null = regex.exec(manaCost);
  while (match) {
    if (match[1]) tokens.push(match[1]);
    match = regex.exec(manaCost);
  }
  return tokens;
}

export function renderManaSymbol(token: string, size = 16, key?: string) {
  if (!token) return null;
  return (
    <View
      key={key ?? token}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Image
        source={{ uri: buildSymbolUri(token) }}
        style={{ width: size, height: size }}
        contentFit="contain"
      />
    </View>
  );
}

export default function ManaSymbols({ tokens, size = 16, gap = 4 }: ManaSymbolsProps) {
  if (!tokens?.length) return null;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap }}>
      {tokens.map((token, index) => (
        <React.Fragment key={`${token}-${index}`}>
          {renderManaSymbol(token, size, `${token}-${index}`) ?? (
            <Text style={{ color: '#ffffff', fontSize: Math.max(10, size * 0.6) }}>{token}</Text>
          )}
        </React.Fragment>
      ))}
    </View>
  );
}
