import React from "react";
import { Modal, Pressable, Switch } from "react-native";
import styled from "styled-components/native";

export default function MenuModal({
  visible,
  onClose,
  onHome,
  onReset,
  onChangePlayers,
  soundEnabled,
  onToggleSound,
  onHighroll,
  onDecks,
  onSearch,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Overlay>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <Sheet>
          <SheetTitle>Game Menu</SheetTitle>
          <ActionButton onPress={onHome}>
            <ActionText>Home</ActionText>
          </ActionButton>
          <ActionButton onPress={onDecks}>
            <ActionText>Decks</ActionText>
          </ActionButton>
          <ActionButton onPress={onSearch}>
            <ActionText>Search</ActionText>
          </ActionButton>
          <ActionButton onPress={onHighroll}>
            <ActionText>Highroll</ActionText>
          </ActionButton>
          <ActionButton onPress={onReset}>
            <ActionText>Restart Match</ActionText>
          </ActionButton>
          <ActionButton onPress={onChangePlayers}>
            <ActionText>Change Players</ActionText>
          </ActionButton>
          <ToggleRow>
            <ActionText>Elimination Sounds</ActionText>
            <Switch
              value={soundEnabled}
              onValueChange={onToggleSound}
              trackColor={{ false: "#2a3340", true: "#3b82f6" }}
              thumbColor={soundEnabled ? "#f3f5f7" : "#9ca8bb"}
            />
          </ToggleRow>
          <CloseButton onPress={onClose}>
            <CloseText>Close</CloseText>
          </CloseButton>
        </Sheet>
      </Overlay>
    </Modal>
  );
}

const Overlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.65);
  justify-content: flex-end;
`;

const Sheet = styled.View`
  background-color: #121722;
  padding: 24px;
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
  gap: 12px;
`;

const SheetTitle = styled.Text`
  color: #f3f5f7;
  font-size: 18px;
  margin-bottom: 4px;
`;

const ActionButton = styled(Pressable)`
  padding: 12px 16px;
  border-radius: 14px;
  background-color: #1b2230;
  border: 1px solid #2c3647;
`;

const ActionText = styled.Text`
  color: #f3f5f7;
  font-size: 15px;
`;

const ToggleRow = styled.View`
  padding: 8px 4px;
  border-radius: 12px;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

const CloseButton = styled(Pressable)`
  padding: 10px 16px;
  align-items: center;
`;

const CloseText = styled.Text`
  color: #9ca8bb;
  font-size: 14px;
`;
