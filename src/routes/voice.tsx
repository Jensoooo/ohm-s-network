import { createFileRoute } from "@tanstack/react-router";
import { VoiceChat } from "@/components/VoiceChat";

export const Route = createFileRoute("/voice")({
  component: VoiceChat,
});
