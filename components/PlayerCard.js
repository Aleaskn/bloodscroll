import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { Feather, FontAwesome5 } from "@expo/vector-icons";
import styled from "styled-components/native";
import CommanderDamagePanel from "./CommanderDamagePanel";

export default function PlayerCard({
  player,
  rotation,
  opponents,
  onAdjustLife,
  onAdjustPoison,
  onAdjustTax,
  onAdjustEnergy,
  onAdjustCommanderDamage,
  onRename,
}) {
  const [view, setView] = useState("main");
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 });
  const [lifeDelta, setLifeDelta] = useState(0);
  const repeatRef = useRef({ timeout: null, interval: null });
  const lifeDeltaTimeoutRef = useRef(null);
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
  const updateLifeDeltaHint = (delta) => {
    setLifeDelta((prev) => prev + delta);
    if (lifeDeltaTimeoutRef.current) {
      clearTimeout(lifeDeltaTimeoutRef.current);
    }
    lifeDeltaTimeoutRef.current = setTimeout(() => {
      setLifeDelta(0);
    }, 1200);
  };
  const adjustLifeWithHint = (delta) => {
    onAdjustLife(delta);
    updateLifeDeltaHint(delta);
  };
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(player.name);
  useEffect(
    () => () => {
      if (lifeDeltaTimeoutRef.current) {
        clearTimeout(lifeDeltaTimeoutRef.current);
      }
      stopRepeat();
    },
    []
  );
  const isSide = rotation === 90 || rotation === 270;
  const contentWidth = cardSize.width && cardSize.height
    ? isSide
      ? cardSize.height
      : cardSize.width
    : 220;
  const contentHeight = cardSize.width && cardSize.height
    ? isSide
      ? cardSize.width
      : cardSize.height
    : 220;
  const base = Math.min(contentWidth || 220, contentHeight || 220);
  const density = base < 180 ? 0.88 : 0.95;
  const padding = Math.max(6, Math.round(base * 0.06 * density));
  const controlSize = Math.max(28, Math.round(base * 0.2 * density));
  const vGap = Math.max(4, Math.round(base * 0.028));
  const digits = String(player.life).length;
  const maxLifeFont = Math.max(22, Math.round(base * 0.28 * density));
  const availableWidth = Math.max(0, (contentWidth || base) - padding * 2 - controlSize * 2);
  const fittedLifeFont = Math.floor((availableWidth / Math.max(1, digits)) * 0.9);
  const lifeFont = Math.max(20, Math.min(maxLifeFont, fittedLifeFont || maxLifeFont));
  const nameFont = Math.max(11, Math.round(base * 0.11 * density));
  const labelFont = Math.max(9, Math.round(base * 0.07 * density));
  const miniButton = Math.max(18, Math.round(base * 0.11 * density));
  const miniFont = Math.max(10, Math.round(base * 0.07 * density));
  const miniValueFont = Math.max(12, Math.round(base * 0.09 * density));
  const expandFont = Math.max(9, Math.round(base * 0.07 * density));
  const controlFont = Math.max(16, Math.round(controlSize * 0.5));

  return (
    <Card
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width !== cardSize.width || height !== cardSize.height) {
          setCardSize({ width, height });
        }
      }}
      style={{
        backgroundColor: player.cardColor || "#141820",
        opacity: player.isDead ? 0.3 : 1,
      }}
    >
      <CardContent
        style={{
          width: contentWidth,
          height: contentHeight,
          left: cardSize.width && cardSize.height ? (cardSize.width - contentWidth) / 2 : 0,
          top: cardSize.width && cardSize.height ? (cardSize.height - contentHeight) / 2 : 0,
          padding,
          transform: [{ rotate: `${rotation}deg` }],
        }}
      >
        {view === "main" ? (
        <>
          <Header>
            <NamePressable
              onPress={() => {
                setDraftName(player.name);
                setEditingName(true);
              }}
            >
              {editingName ? (
                <NameInput
                  value={draftName}
                  onChangeText={setDraftName}
                  autoFocus
                  onSubmitEditing={() => {
                    const next = draftName.trim() || "Player name";
                    onRename?.(next);
                    setEditingName(false);
                  }}
                  onBlur={() => {
                    const next = draftName.trim() || "Player name";
                    onRename?.(next);
                    setEditingName(false);
                  }}
                  style={{ fontSize: nameFont }}
                  returnKeyType="done"
                  maxLength={18}
                />
              ) : (
                <NameRow>
                  <PlayerName style={{ fontSize: nameFont }}>{player.name}</PlayerName>
                  <Feather name="edit-2" size={Math.max(12, nameFont - 2)} color="#ffffff" />
                </NameRow>
              )}
            </NamePressable>
          </Header>

          <LifeRow style={{ minHeight: controlSize * 1.5, marginTop: vGap }}>
            <LifeStrip
              onPress={() => handlePress(() => adjustLifeWithHint(-1))}
              onPressIn={() => { longPressRef.current = false; }}
              onLongPress={() => {
                longPressRef.current = true;
                adjustLifeWithHint(-10);
                startRepeat(() => adjustLifeWithHint(-10));
              }}
              onPressOut={stopRepeat}
              onPressCancel={stopRepeat}
            >
              <ControlText style={{ fontSize: controlFont }}>-</ControlText>
            </LifeStrip>

            <LifeValueWrap>
              {lifeDelta !== 0 ? (
                <LifeDeltaHint style={{ fontSize: Math.max(12, Math.round(labelFont * 1.1)) }}>
                  {lifeDelta > 0 ? `+${lifeDelta}` : `${lifeDelta}`}
                </LifeDeltaHint>
              ) : null}
              <LifeValue style={{ fontSize: lifeFont }}>{player.life}</LifeValue>
            </LifeValueWrap>

            <LifeStrip
              onPress={() => handlePress(() => adjustLifeWithHint(1))}
              onPressIn={() => { longPressRef.current = false; }}
              onLongPress={() => {
                longPressRef.current = true;
                adjustLifeWithHint(10);
                startRepeat(() => adjustLifeWithHint(10));
              }}
              onPressOut={stopRepeat}
              onPressCancel={stopRepeat}
            >
              <ControlText style={{ fontSize: controlFont }}>+</ControlText>
            </LifeStrip>
          </LifeRow>

          <StatGrid style={{ marginTop: vGap }}>
            <MiniStat>
              <MiniLabel style={{ fontSize: labelFont }}>Tax</MiniLabel>
              <MiniControls>
                <MiniStrip
                  onPress={() => handlePress(() => onAdjustTax(-2))}
                  onPressIn={() => { longPressRef.current = false; }}
                  onLongPress={() => {
                    longPressRef.current = true;
                    onAdjustTax(-10);
                    startRepeat(() => onAdjustTax(-10));
                  }}
                  onPressOut={stopRepeat}
                  onPressCancel={stopRepeat}
                >
                  <MiniText style={{ fontSize: miniFont }}>-</MiniText>
                </MiniStrip>
                <MiniValue style={{ fontSize: miniValueFont }}>{player.tax}</MiniValue>
                <MiniStrip
                  onPress={() => handlePress(() => onAdjustTax(2))}
                  onPressIn={() => { longPressRef.current = false; }}
                  onLongPress={() => {
                    longPressRef.current = true;
                    onAdjustTax(10);
                    startRepeat(() => onAdjustTax(10));
                  }}
                  onPressOut={stopRepeat}
                  onPressCancel={stopRepeat}
                >
                  <MiniText style={{ fontSize: miniFont }}>+</MiniText>
                </MiniStrip>
              </MiniControls>
            </MiniStat>
          </StatGrid>

                    <ExpandButton onPress={() => setView("detail")} style={{ marginTop: vGap }}>
            <ExpandText style={{ fontSize: expandFont }}>Commander Damage</ExpandText>
          </ExpandButton>
        </>
        ) : (
        <DetailWrap
          style={{
            backgroundColor: player.cardColor || "#141820",
            borderWidth: 1,
            borderColor: "rgba(255, 255, 255, 0.7)",
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          <DetailHeader>
            <PlayerName style={{ fontSize: nameFont }}>{player.name}</PlayerName>
          </DetailHeader>
          <DetailTitle style={{ fontSize: labelFont }}>
            Commander & Counters
          </DetailTitle>
          <DetailScroll
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 8 }}
          >
            <CommanderDamagePanel
              opponents={opponents}
              commanderDamage={player.commanderDamage}
              onAdjust={onAdjustCommanderDamage}
              poison={player.poison}
              energy={player.energy}
              onAdjustPoison={onAdjustPoison}
              onAdjustEnergy={onAdjustEnergy}
              baseSize={base}
              cardColor={player.cardColor}
            />
          </DetailScroll>
          <ExpandButton onPress={() => setView("main")} style={{ marginTop: vGap }}>
            <ExpandText style={{ fontSize: expandFont }}>Back</ExpandText>
          </ExpandButton>
        </DetailWrap>
        )}
      </CardContent>
      {player.isDead ? (
        <EliminatedOverlay
          pointerEvents="none"
          style={{ transform: [{ rotate: `${rotation}deg` }] }}
        >
          <FontAwesome5 name="skull" size={Math.max(32, base * 0.3)} color="#000000" />
          <EliminatedText style={{ color: "#000000" }}>ELIMINATED</EliminatedText>
        </EliminatedOverlay>
      ) : null}
    </Card>
  );
}

const Card = styled.View`
  flex: 1;
  background-color: #141820;
  border-radius: 18px;
  border: 1px solid #263041;
  overflow: hidden;
  position: relative;
`;

const CardContent = styled.View`
  position: absolute;
  align-self: center;
  justify-content: space-between;
`;

const Header = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

const NamePressable = styled(Pressable)`
  flex: 1;
  margin-right: 6px;
`;

const NameRow = styled(View)`
  flex-direction: row;
  align-items: center;
  gap: 6px;
`;

const NameInput = styled(TextInput)`
  color: #f3f5f7;
  padding: 0px;
`;

const PlayerName = styled.Text`
  color: #f3f5f7;
  font-size: 18px;
  letter-spacing: 0.5px;
`;

const LifeRow = styled.View`
  margin-top: 12px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  position: relative;
`;

const LifeStrip = styled(Pressable)`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const LifeValue = styled.Text`
  color: #f6f8fb;
  font-size: 42px;
  font-weight: 700;
`;

const LifeValueWrap = styled.View`
  align-items: center;
  justify-content: center;
  position: relative;
`;

const LifeDeltaHint = styled.Text`
  color: #f3f5f7;
  opacity: 0.85;
  position: absolute;
  top: -16px;
  align-self: center;
  font-weight: 600;
`;

const ControlButton = styled(Pressable)`
  width: 54px;
  height: 54px;
  border-radius: 27px;
  background-color: #1f2633;
  align-items: center;
  justify-content: center;
  border: 1px solid #2c3647;
`;

const ControlText = styled.Text`
  color: #f3f5f7;
  font-size: 26px;
`;

const StatGrid = styled.View`
  margin-top: 10px;
  flex-direction: row;
  justify-content: center;
  gap: 8px;
`;

const MiniStat = styled.View`
  align-items: center;
  min-width: 90px;
`;

const MiniLabel = styled.Text`
  color: #ffffff;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
`;

const MiniControls = styled.View`
  margin-top: 6px;
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

const MiniButton = styled(Pressable)`
  width: 24px;
  height: 24px;
  border-radius: 12px;
  background-color: transparent;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.7);
`;

const MiniText = styled.Text`
  color: #f3f5f7;
  font-size: 14px;
`;

const MiniValue = styled.Text`
  color: #f6f8fb;
  font-size: 16px;
  min-width: 22px;
  text-align: center;
`;

const ExpandButton = styled(Pressable)`
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 14px;
  background-color: transparent;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.7);
`;

const ExpandText = styled.Text`
  color: #c9d3e2;
  font-size: 12px;
  letter-spacing: 0.4px;
`;

const DetailWrap = styled.View`
  flex: 1;
  justify-content: space-between;
  border-radius: 12px;
  padding: 4px;
`;

const DetailHeader = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

const DetailTitle = styled.Text`
  color: #ffffff;
  font-size: 12px;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-top: 6px;
`;


const EliminatedOverlay = styled.View`
  position: absolute;
  inset: 0px;
  align-items: center;
  justify-content: center;
  gap: 6px;
`;

const EliminatedText = styled.Text`
  color: #ffffff;
  font-size: 16px;
  letter-spacing: 2px;
`;

const DetailScroll = styled(ScrollView)`
  flex: 1;
  margin-top: 6px;
`;
