import { EditorShell } from "@/features/editor/components/EditorShell";

function readBooleanEnvFlag(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export default function EditorPage() {
  return <EditorShell showNsfwButton={readBooleanEnvFlag(process.env.SCENEFORGE_SHOW_NSFW_BUTTON)} />;
}
