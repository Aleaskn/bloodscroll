import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { SafeAreaView, StatusBar } from "react-native";
import { FontAwesome5 } from "@expo/vector-icons";
import { useKeepAwake } from "expo-keep-awake";
import { Audio } from "expo-av";
import styled from "styled-components/native";
import { useRouter } from "expo-router";
import PlayerCard from "./components/PlayerCard";
import SetupScreen from "./components/SetupScreen";
import MenuModal from "./components/MenuModal";

const initialState = {
  playerCount: 4,
  players: [],
  showSetup: true,
  menuOpen: false,
  soundEnabled: true,
};

const MANA_ACCENTS = [
  "#d9c27c", // white
  "#3f83c8", // blue
  "#1f8a60", // green
  "#b13a3a", // red
  "#4b3a5a", // black
  "#9c9c9c", // colorless
];

const CARD_COLORS = [
  "#2b6cb0", // blue
  "#2f855a", // green
  "#c05621", // orange
  "#b83280", // magenta
  "#805ad5", // purple
  "#d69e2e", // yellow
  "#718096", // gray
  "#38b2ac", // teal
];

const ELIMINATION_SFX = [
  require("./assets/sfx/emotional_damage.mp3"),
  require("./assets/sfx/gta_wasted.mp3"),
  require("./assets/sfx/roblox_oof.mp3"),
  require("./assets/sfx/xp_shutdown.mp3"),
];

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildPlayers(count) {
  const colors = shuffle(CARD_COLORS);
  return Array.from({ length: count }, (_, i) => {
    const id = String(i + 1);
    return {
      id,
      name: "Player name",
      life: 40,
      poison: 0,
      tax: 0,
      energy: 0,
      commanderDamage: {},
      accent: MANA_ACCENTS[i % MANA_ACCENTS.length],
      cardColor: colors[i % colors.length],
      isDead: false,
    };
  }).map((player, _, all) => {
    const damage = {};
    all.forEach((p) => {
      if (p.id !== player.id) damage[p.id] = 0;
    });
    return { ...player, commanderDamage: damage };
  });
}

function hasLost(player) {
  if (player.life <= 0) return true;
  if (player.poison >= 10) return true;
  const cmdValues = Object.values(player.commanderDamage || {});
  return cmdValues.some((value) => value >= 21);
}

function withLoss(player) {
  return { ...player, isDead: hasLost(player) };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function reducer(state, action) {
  switch (action.type) {
    case "SET_COUNT":
      return { ...state, playerCount: action.count };
    case "INIT_PLAYERS":
      return {
        ...state,
        players: buildPlayers(state.playerCount),
        showSetup: false,
      };
    case "OPEN_SETUP":
      return { ...state, showSetup: true, menuOpen: false };
    case "TOGGLE_SOUND":
      return { ...state, soundEnabled: !state.soundEnabled };
    case "TOGGLE_MENU":
      return { ...state, menuOpen: !state.menuOpen };
    case "RESET_MATCH":
      const colors = shuffle(CARD_COLORS);
      return {
        ...state,
        menuOpen: false,
        players: state.players.map((p, idx) => {
          const resetDamage = {};
          Object.keys(p.commanderDamage).forEach((k) => (resetDamage[k] = 0));
          return withLoss({
            ...p,
            life: 40,
            poison: 0,
            tax: 0,
            energy: 0,
            commanderDamage: resetDamage,
            cardColor: colors[idx % colors.length],
            isDead: false,
          });
        }),
      };
    case "SET_NAME":
      return {
        ...state,
        players: state.players.map((p) =>
          p.id === action.playerId ? { ...p, name: action.name } : p
        ),
      };
    case "ADJUST_LIFE":
    case "ADJUST_POISON":
    case "ADJUST_TAX":
    case "ADJUST_ENERGY": {
      const keyMap = {
        ADJUST_LIFE: "life",
        ADJUST_POISON: "poison",
        ADJUST_TAX: "tax",
        ADJUST_ENERGY: "energy",
      };
      const key = keyMap[action.type];
      const maxMap = {
        life: Infinity,
        poison: 10,
        tax: Infinity,
        energy: Infinity,
      };
      const max = maxMap[key] ?? Infinity;
      return {
        ...state,
        players: state.players.map((p) =>
          p.id === action.playerId
            ? withLoss({
                ...p,
                [key]: clamp(p[key] + action.delta, 0, max),
              })
            : p
        ),
      };
    }
    case "ADJUST_CMD_DAMAGE":
      return {
        ...state,
        players: state.players.map((p) =>
          p.id === action.playerId
            ? {
                ...withLoss({
                  ...p,
                  commanderDamage: {
                    ...p.commanderDamage,
                    [action.fromId]: clamp(
                      (p.commanderDamage[action.fromId] || 0) + action.delta,
                      0,
                      21
                    ),
                  },
                  life: clamp(
                    p.life -
                      (clamp(
                        (p.commanderDamage[action.fromId] || 0) + action.delta,
                        0,
                        21
                      ) -
                        (p.commanderDamage[action.fromId] || 0)),
                    0,
                    Infinity
                  ),
                }),
              }
            : p
        ),
      };
    default:
      return state;
  }
}

function buildRows(count) {
  const layouts = {
    2: [[180], [0]],
    3: [[90], [90, 270]],
    4: [[90, 270], [90, 270]],
    5: [[90, 270], [90, 270], [90]],
    6: [[90, 270], [90, 270], [90, 270]],
  };

  return layouts[count] || layouts[4];
}

export default function App() {
  useKeepAwake();
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initialState);
  const rows = useMemo(() => buildRows(state.playerCount), [state.playerCount]);
  const prevPlayersRef = useRef(state.players);
  const lastSfxRef = useRef(null);
  const [highrollOpen, setHighrollOpen] = useState(false);
  const [highrollResults, setHighrollResults] = useState([]);

  useEffect(() => {
    const prevPlayers = prevPlayersRef.current;
    if (!prevPlayers.length) {
      prevPlayersRef.current = state.players;
      return;
    }

    const newlyDead = state.players.filter((p) => {
      const prev = prevPlayers.find((x) => x.id === p.id);
      return prev && !prev.isDead && p.isDead;
    });

    if (newlyDead.length && state.soundEnabled) {
      let nextIndex = Math.floor(Math.random() * ELIMINATION_SFX.length);
      if (ELIMINATION_SFX.length > 1) {
        while (nextIndex === lastSfxRef.current) {
          nextIndex = Math.floor(Math.random() * ELIMINATION_SFX.length);
        }
      }
      lastSfxRef.current = nextIndex;
      const source = ELIMINATION_SFX[nextIndex];
      Audio.Sound.createAsync(source, { shouldPlay: true })
        .then(({ sound }) => {
          sound.setOnPlaybackStatusUpdate((status) => {
            if (status.isLoaded && status.didJustFinish) {
              sound.unloadAsync();
            }
          });
        })
        .catch(() => {});
    }

    prevPlayersRef.current = state.players;
  }, [state.players, state.soundEnabled]);

  const resolveHighroll = (initial) => {
    let results = [...initial];
    let attempts = 0;
    while (attempts < 20) {
      const max = Math.max(0, ...results.map((r) => r.roll || 0));
      const tied = results.filter((r) => r.roll === max);
      if (tied.length <= 1) break;
      const tiedIds = new Set(tied.map((t) => t.id));
      results = results.map((r) =>
        tiedIds.has(r.id)
          ? { ...r, roll: Math.floor(Math.random() * 20) + 1 }
          : r
      );
      attempts += 1;
    }
    return results;
  };

  const runHighroll = () => {
    const initial = state.players.map((p) => ({
      id: p.id,
      name: p.name,
      cardColor: p.cardColor,
      roll: Math.floor(Math.random() * 20) + 1,
    }));
    const resolved = resolveHighroll(initial);
    setHighrollResults(resolved);
    setHighrollOpen(true);
  };

  const maxRoll = Math.max(0, ...highrollResults.map((r) => r.roll || 0));
  const winners = highrollResults.filter((r) => r.roll === maxRoll);
  const isTie = winners.length > 1;

  const rerollHighroll = () => {
    if (!highrollResults.length) return;
    const resolved = resolveHighroll(highrollResults);
    setHighrollResults(resolved);
  };

  if (state.showSetup) {
    return (
      <ScreenRoot>
      <StatusBar barStyle="light-content" />
        <SetupScreen
          playerCount={state.playerCount}
          onSelect={(count) => dispatch({ type: "SET_COUNT", count })}
          onStart={() => dispatch({ type: "INIT_PLAYERS" })}
        />
      </ScreenRoot>
    );
  }

  return (
    <ScreenRoot>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={{ flex: 1 }}>
        <Board>
          {rows.map((row, rowIndex) => {
            return (
              <Row key={`row-${rowIndex}`}>
                {row.map((rotation, colIndex) => {
                  const playerIndex =
                    rows.slice(0, rowIndex).reduce((sum, r) => sum + r.length, 0) +
                    colIndex;
                  const player = state.players[playerIndex];
                  if (!player) return <CardSlot key={`empty-${rowIndex}-${colIndex}`} />;
                  return (
                    <CardSlot key={player.id}>
                      <PlayerCard
                        player={player}
                        rotation={rotation}
                        opponents={state.players.filter((p) => p.id !== player.id)}
                        onAdjustLife={(delta) =>
                          dispatch({ type: "ADJUST_LIFE", playerId: player.id, delta })
                        }
                        onAdjustPoison={(delta) =>
                          dispatch({
                            type: "ADJUST_POISON",
                            playerId: player.id,
                            delta,
                          })
                        }
                        onAdjustTax={(delta) =>
                          dispatch({ type: "ADJUST_TAX", playerId: player.id, delta })
                        }
                        onAdjustEnergy={(delta) =>
                          dispatch({
                            type: "ADJUST_ENERGY",
                            playerId: player.id,
                            delta,
                          })
                        }
                        onAdjustCommanderDamage={(fromId, delta) =>
                          dispatch({
                            type: "ADJUST_CMD_DAMAGE",
                            playerId: player.id,
                            fromId,
                            delta,
                          })
                        }
                        onRename={(name) =>
                          dispatch({
                            type: "SET_NAME",
                            playerId: player.id,
                            name,
                          })
                        }
                      />
                    </CardSlot>
                  );
                })}
              </Row>
            );
          })}
        </Board>
      </SafeAreaView>

      <MenuButton onPress={() => dispatch({ type: "TOGGLE_MENU" })}>
        <MenuCore>
          <FontAwesome5 name="dice-d20" size={32} color="#eef2f6" />
        </MenuCore>
      </MenuButton>

      <MenuModal
        visible={state.menuOpen}
        onClose={() => dispatch({ type: "TOGGLE_MENU" })}
        onReset={() => dispatch({ type: "RESET_MATCH" })}
        onChangePlayers={() => dispatch({ type: "OPEN_SETUP" })}
        soundEnabled={state.soundEnabled}
        onToggleSound={() => dispatch({ type: "TOGGLE_SOUND" })}
        onHighroll={() => {
          dispatch({ type: "TOGGLE_MENU" });
          runHighroll();
        }}
        onDecks={() => {
          dispatch({ type: "TOGGLE_MENU" });
          router.push("/(tabs)/decks");
        }}
      />

      {highrollOpen ? (
        <HighrollOverlay>
          <HighrollGrid>
            {rows.map((row, rowIndex) => (
              <HighrollRow key={`hr-row-${rowIndex}`}>
                {row.map((rotation, colIndex) => {
                  const playerIndex =
                    rows.slice(0, rowIndex).reduce((sum, r) => sum + r.length, 0) +
                    colIndex;
                  const player = state.players[playerIndex];
                  const result = highrollResults.find((r) => r.id === player?.id);
                  const isWinner =
                    result && !isTie && result.roll === maxRoll && maxRoll > 0;
                  if (!player) return <HighrollCell key={`empty-${rowIndex}-${colIndex}`} />;
                  return (
                    <HighrollCell
                      key={player.id}
                      style={{
                        backgroundColor: isWinner
                          ? "#f7d774"
                          : "rgba(25, 28, 36, 0.95)",
                      }}
                    >
                      {isWinner ? (
                        <CrownWrap>
                          <FontAwesome5 name="crown" size={28} color="#1b1b1b" />
                        </CrownWrap>
                      ) : null}
                      <HighrollNumber
                        style={{
                          transform: [{ rotate: `${rotation}deg` }],
                          color: isWinner ? "#1b1b1b" : "#ffffff",
                        }}
                      >
                        {result?.roll ?? "-"}
                      </HighrollNumber>
                    </HighrollCell>
                  );
                })}
              </HighrollRow>
            ))}
          </HighrollGrid>

          <HighrollClose onPress={() => setHighrollOpen(false)}>
            <FontAwesome5 name="times" size={24} color="#111111" />
          </HighrollClose>

          <HighrollReroll onPress={rerollHighroll}>
            <HighrollRerollText>
              {isTie ? "Reroll Tied" : "Reroll"}
            </HighrollRerollText>
          </HighrollReroll>
        </HighrollOverlay>
      ) : null}
    </ScreenRoot>
  );
}

const ScreenRoot = styled.View`
  flex: 1;
  background-color: #0b0d10;
`;

const Board = styled.View`
  flex: 1;
  padding: 0px;
  gap: 0px;
  justify-content: flex-start;
  align-items: stretch;
`;

const Row = styled.View`
  flex: 1;
  flex-direction: row;
  gap: 0px;
  align-items: stretch;
`;

const CardSlot = styled.View`
  flex: 1;
  align-items: stretch;
  justify-content: stretch;
`;

const MenuButton = styled.Pressable`
  position: absolute;
  align-self: center;
  top: 50%;
  left: 50%;
  width: 60px;
  height: 60px;
  margin-left: -30px;
  margin-top: -30px;
  align-items: center;
  justify-content: center;
`;

const MenuCore = styled.View`
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background-color: transparent;
  align-items: center;
  justify-content: center;
`;

const HighrollOverlay = styled.View`
  position: absolute;
  inset: 0px;
  background-color: rgba(0, 0, 0, 0.92);
  justify-content: center;
  align-items: center;
`;

const HighrollGrid = styled.View`
  width: 100%;
  height: 100%;
  padding: 0px;
  justify-content: center;
  gap: 0px;
`;

const HighrollRow = styled.View`
  flex: 1;
  flex-direction: row;
  gap: 0px;
`;

const HighrollCell = styled.View`
  flex: 1;
  border-radius: 18px;
  margin: 2px;
  justify-content: center;
  align-items: center;
`;

const HighrollNumber = styled.Text`
  font-size: 72px;
  font-weight: 700;
`;

const CrownWrap = styled.View`
  position: absolute;
  top: 14px;
`;

const HighrollClose = styled.Pressable`
  position: absolute;
  align-self: center;
  top: 50%;
  left: 50%;
  width: 56px;
  height: 56px;
  margin-left: -28px;
  margin-top: -28px;
  border-radius: 16px;
  background-color: rgba(255, 255, 255, 0.9);
  align-items: center;
  justify-content: center;
`;

const HighrollReroll = styled.Pressable`
  position: absolute;
  bottom: 28px;
  align-self: center;
  padding: 10px 20px;
  border-radius: 16px;
  background-color: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.6);
`;

const HighrollRerollText = styled.Text`
  color: #ffffff;
  font-size: 16px;
  letter-spacing: 1px;
`;
