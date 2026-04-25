import { useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const SCREEN_WIDTH = Dimensions.get("window").width;
const BUTTON_HEIGHT = 60;
const THUMB_SIZE = 52;
const PADDING = 4;

interface SwipeButtonProps {
  title: string;
  onSwipeComplete: () => void;
  color?: string;
  iconName?: string;
  disabled?: boolean;
  textColor?: string;
  iconColor?: string;
  thumbColor?: string;
}

export function SwipeButton({
  title,
  onSwipeComplete,
  color = "#4CAF50",
  iconName = "chevron-forward",
  disabled = false,
  textColor = "#000",
  iconColor,
  thumbColor = "#000",
}: SwipeButtonProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [containerWidth, setContainerWidth] = useState(SCREEN_WIDTH - 40);
  const maxSlide = containerWidth - THUMB_SIZE - PADDING * 2;
  const completed = useRef(false);

  // Keep latest values in refs so PanResponder (created once) always reads current state
  const disabledRef = useRef(disabled);
  const maxSlideRef = useRef(maxSlide);
  const onSwipeCompleteRef = useRef(onSwipeComplete);

  disabledRef.current = disabled;
  maxSlideRef.current = maxSlide;
  onSwipeCompleteRef.current = onSwipeComplete;

  const reset = useCallback(() => {
    completed.current = false;
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
  }, [translateX]);

  const resetRef = useRef(reset);
  resetRef.current = reset;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        !disabledRef.current && Math.abs(gestureState.dx) > 5,
      onPanResponderMove: (_, gestureState) => {
        if (disabledRef.current || completed.current) return;
        const newValue = Math.max(0, Math.min(gestureState.dx, maxSlideRef.current));
        translateX.setValue(newValue);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (disabledRef.current || completed.current) return;
        const threshold = maxSlideRef.current * 0.75;
        if (gestureState.dx >= threshold) {
          completed.current = true;
          Animated.spring(translateX, {
            toValue: maxSlideRef.current,
            useNativeDriver: true,
            tension: 80,
            friction: 10,
          }).start(() => {
            onSwipeCompleteRef.current();
            setTimeout(() => resetRef.current(), 500);
          });
        } else {
          resetRef.current();
        }
      },
    })
  ).current;

  const progressOpacity = translateX.interpolate({
    inputRange: [0, maxSlide],
    outputRange: [0, 0.3],
    extrapolate: "clamp",
  });

  const textOpacity = translateX.interpolate({
    inputRange: [0, maxSlide * 0.3],
    outputRange: [1, 0.3],
    extrapolate: "clamp",
  });

  const chevronAnim = useRef(new Animated.Value(0)).current;

  // Pulse animation for chevrons
  useState(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(chevronAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(chevronAnim, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    ).start();
  });

  const chevronOpacity = chevronAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.8],
  });

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: disabled ? "#555" : color },
        disabled && styles.disabled,
      ]}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {/* Progress fill */}
      <Animated.View
        style={[
          styles.progressFill,
          {
            backgroundColor: "#fff",
            opacity: progressOpacity,
            transform: [{
              scaleX: translateX.interpolate({
                inputRange: [0, maxSlide],
                outputRange: [0, 1],
                extrapolate: "clamp",
              })
            }],
          },
        ]}
      />

      {/* Chevron hints */}
      <Animated.View style={[styles.chevronsContainer, { opacity: chevronOpacity }]}>
        <Ionicons name="chevron-forward" size={12} color="rgba(0, 0, 0, 0.8)" />
        <Ionicons name="chevron-forward" size={12} color="rgba(0, 0, 0, 0.8)" />
      </Animated.View>

      {/* Title text */}
      <Animated.Text style={[styles.title, { opacity: textOpacity, color: textColor }]}>
        {title}
      </Animated.Text>

      {/* Draggable thumb */}
      <Animated.View
        style={[
          styles.thumb,
          { transform: [{ translateX }], backgroundColor: thumbColor },
        ]}
        {...panResponder.panHandlers}
      >
        <Ionicons
          name={iconName as any}
          size={24}
          color={disabled ? "#888" : (iconColor || color)}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: BUTTON_HEIGHT,
    borderRadius: BUTTON_HEIGHT / 2,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    position: "relative",
  },
  disabled: {
    opacity: 0.6,
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    right: 0,
    transformOrigin: "left",
  },
  chevronsContainer: {
    position: "absolute",
    flexDirection: "row",
    left: THUMB_SIZE + PADDING + 8,
    gap: -4,
  },
  title: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  thumb: {
    position: "absolute",
    left: PADDING,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
