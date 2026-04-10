import React from "react";
import { Text, StyleSheet, Platform } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";

interface GradientTextProps {
  text: string;
  style?: any;
}

// Brand gradient: orange → pink → purple → blue
const BRAND_COLORS = ["#FF7A1A", "#FF5A8A", "#8B5CFF", "#4FA8FF"];

export default function GradientText({ text, style }: GradientTextProps) {
  if (Platform.OS === "web") {
    // Web: use CSS gradient
    return (
      <Text
        style={[
          style,
          {
            // @ts-ignore - web-only style
            backgroundImage: `linear-gradient(90deg, ${BRAND_COLORS.join(", ")})`,
            // @ts-ignore
            WebkitBackgroundClip: "text",
            // @ts-ignore
            WebkitTextFillColor: "transparent",
            // @ts-ignore
            backgroundClip: "text",
          },
        ]}
      >
        {text}
      </Text>
    );
  }

  return (
    <MaskedView
      maskElement={
        <Text style={[style, { backgroundColor: "transparent" }]}>{text}</Text>
      }
    >
      <LinearGradient
        colors={BRAND_COLORS as any}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
      >
        <Text style={[style, { opacity: 0 }]}>{text}</Text>
      </LinearGradient>
    </MaskedView>
  );
}
