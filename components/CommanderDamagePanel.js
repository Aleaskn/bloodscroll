import React, { useRef } from "react";
import { Pressable } from "react-native";
import styled from "styled-components/native";

export default function CommanderDamagePanel({
  opponents,
  commanderDamage,
  onAdjust,
  poison,
  energy,
  onAdjustPoison,
  onAdjustEnergy,
  baseSize,
  cardColor,
}) {
  const repeatRef = useRef({ timeout: null, interval: null });
  const longPressRef = useRef(false);
  const startRepeat = (fn) => {
    if (repeatRef.current.timeout || repeatRef.current.interval) return;
    repeatRef.current.timeout = setTimeout(() => {
      repeatRef.current.interval = setInterval(fn, 500);
    }, 500);
  };
  const handlePress = (fn) => {
    if (longPressRef.current) {
      longPressRef.current = false;
      return;
    }
    fn();
  };

  const stopRepeat = () => {
    if (repeatRef.current.timeout) {
      clearTimeout(repeatRef.current.timeout);
      repeatRef.current.timeout = null;
    }
    if (repeatRef.current.interval) {
      clearInterval(repeatRef.current.interval);
      repeatRef.current.interval = null;
    }
  };

  const base = baseSize || 220;
  const density = 0.95;
  const miniButton = Math.max(18, Math.round(base * 0.11 * density));
  const miniFont = Math.max(10, Math.round(base * 0.07 * density));
  const labelFont = Math.max(9, Math.round(base * 0.07 * density));
  const valueFont = Math.max(12, Math.round(base * 0.09 * density));

  return (
    <Panel>
      <SubSection>
        <SubLabel style={{ fontSize: labelFont }}>Poison</SubLabel>
        <SubControls>
          <MiniStrip
            onPress={() => handlePress(() => onAdjustPoison(-1))}
            onPressIn={() => { longPressRef.current = false; }}
            onLongPress={() => {
              longPressRef.current = true;
              onAdjustPoison(-5);
              startRepeat(() => onAdjustPoison(-5));
            }}
            onPressOut={stopRepeat}
            onPressCancel={stopRepeat}
          >
            <MiniText style={{ fontSize: miniFont }}>-</MiniText>
          </MiniStrip>
          <RowValue style={{ fontSize: valueFont }}>{poison}</RowValue>
          <MiniStrip
            onPress={() => handlePress(() => onAdjustPoison(1))}
            onPressIn={() => { longPressRef.current = false; }}
            onLongPress={() => {
              longPressRef.current = true;
              onAdjustPoison(5);
              startRepeat(() => onAdjustPoison(5));
            }}
            onPressOut={stopRepeat}
            onPressCancel={stopRepeat}
          >
            <MiniText style={{ fontSize: miniFont }}>+</MiniText>
          </MiniStrip>
        </SubControls>
      </SubSection>

      <SubSection>
        <SubLabel style={{ fontSize: labelFont }}>Energy</SubLabel>
        <SubControls>
          <MiniStrip
            onPress={() => handlePress(() => onAdjustEnergy(-1))}
            onPressIn={() => { longPressRef.current = false; }}
            onLongPress={() => {
              longPressRef.current = true;
              onAdjustEnergy(-5);
              startRepeat(() => onAdjustEnergy(-5));
            }}
            onPressOut={stopRepeat}
            onPressCancel={stopRepeat}
          >
            <MiniText style={{ fontSize: miniFont }}>-</MiniText>
          </MiniStrip>
          <RowValue style={{ fontSize: valueFont }}>{energy}</RowValue>
          <MiniStrip
            onPress={() => handlePress(() => onAdjustEnergy(1))}
            onPressIn={() => { longPressRef.current = false; }}
            onLongPress={() => {
              longPressRef.current = true;
              onAdjustEnergy(5);
              startRepeat(() => onAdjustEnergy(5));
            }}
            onPressOut={stopRepeat}
            onPressCancel={stopRepeat}
          >
            <MiniText style={{ fontSize: miniFont }}>+</MiniText>
          </MiniStrip>
        </SubControls>
      </SubSection>

      <Divider />

      {opponents.map((opponent) => (
        <Row key={opponent.id}>
          <OpponentName
            style={{
              fontSize: labelFont,
              color: opponent.cardColor || "#ffffff",
            }}
          >
            {opponent.name}
          </OpponentName>
          <RowControls>
            <MiniStrip
              onPress={() => handlePress(() => onAdjust(opponent.id, -1))}
              onPressIn={() => { longPressRef.current = false; }}
              onLongPress={() => {
                longPressRef.current = true;
                onAdjust(opponent.id, -5);
                startRepeat(() => onAdjust(opponent.id, -5));
              }}
              onPressOut={stopRepeat}
              onPressCancel={stopRepeat}
            >
              <MiniText style={{ fontSize: miniFont }}>-</MiniText>
            </MiniStrip>
            <RowValue style={{ fontSize: valueFont }}>
              {commanderDamage[opponent.id] || 0}
            </RowValue>
            <MiniStrip
              onPress={() => handlePress(() => onAdjust(opponent.id, 1))}
              onPressIn={() => { longPressRef.current = false; }}
              onLongPress={() => {
                longPressRef.current = true;
                onAdjust(opponent.id, 5);
                startRepeat(() => onAdjust(opponent.id, 5));
              }}
              onPressOut={stopRepeat}
              onPressCancel={stopRepeat}
            >
              <MiniText style={{ fontSize: miniFont }}>+</MiniText>
            </MiniStrip>
          </RowControls>
        </Row>
      ))}
    </Panel>
  );
}

const Panel = styled.View`
  margin-top: 8px;
  padding: 8px;
  border-radius: 12px;
  background-color: transparent;
  gap: 6px;
`;

const SubSection = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
`;

const SubLabel = styled.Text`
  color: #ffffff;
  font-size: 11px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
`;

const SubControls = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 2px;
  justify-content: center;
`;

const MiniStrip = styled(Pressable)`
  flex: 2;
  min-height: 28px;
  align-items: center;
  justify-content: center;
`;

const Divider = styled.View`
  height: 1px;
  background-color: #1b2230;
  margin: 4px 0 6px 0;
`;

const Row = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  min-height: 26px;
`;

const OpponentName = styled.Text`
  color: #ffffff;
  font-size: 12px;
`;

const RowControls = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 2px;
  justify-content: center;
`;

const RowValue = styled.Text`
  color: #f3f5f7;
  font-size: 14px;
  min-width: 24px;
  text-align: center;
`;

const MiniButton = styled(Pressable)`
  width: 22px;
  height: 22px;
  border-radius: 11px;
  background-color: transparent;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.7);
`;

const MiniText = styled.Text`
  color: #f3f5f7;
  font-size: 12px;
`;
