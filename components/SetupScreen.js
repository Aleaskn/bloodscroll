import React from "react";
import { Pressable } from "react-native";
import styled from "styled-components/native";

const COUNTS = [2, 3, 4, 5, 6];

export default function SetupScreen({ playerCount, onSelect, onStart }) {
  return (
    <Root>
      <Title>Commander Life Counter</Title>
      <Subtitle>Choose players</Subtitle>

      <Options>
        {COUNTS.map((count) => (
          <CountButton
            key={count}
            onPress={() => onSelect(count)}
            $active={count === playerCount}
          >
            <CountText>{count}</CountText>
          </CountButton>
        ))}
      </Options>

      <StartButton onPress={onStart}>
        <StartText>Start Game</StartText>
      </StartButton>
    </Root>
  );
}

const Root = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background-color: #0b0d10;
  padding: 24px;
`;

const Title = styled.Text`
  color: #f6f8fb;
  font-size: 26px;
  letter-spacing: 0.8px;
`;

const Subtitle = styled.Text`
  color: #9ca8bb;
  font-size: 14px;
  letter-spacing: 1px;
  text-transform: uppercase;
`;

const Options = styled.View`
  flex-direction: row;
  gap: 12px;
`;

const CountButton = styled(Pressable)`
  width: 44px;
  height: 44px;
  border-radius: 22px;
  align-items: center;
  justify-content: center;
  background-color: ${(props) => (props.$active ? "#2b3a4f" : "#1b2230")};
  border: 1px solid #344255;
`;

const CountText = styled.Text`
  color: #f3f5f7;
  font-size: 16px;
`;

const StartButton = styled(Pressable)`
  margin-top: 12px;
  padding: 14px 28px;
  border-radius: 26px;
  background-color: #1f2a3a;
  border: 1px solid #334257;
`;

const StartText = styled.Text`
  color: #f6f8fb;
  font-size: 16px;
  letter-spacing: 0.6px;
`;
