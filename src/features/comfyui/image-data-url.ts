export type ComfyUiImageDataUrlMimeSubtype = "png" | "jpg" | "jpeg" | "webp";

const imageDataUrlPrefixes = [
  { mimeSubtype: "png" as const, prefix: "data:image/png;base64," },
  { mimeSubtype: "jpg" as const, prefix: "data:image/jpg;base64," },
  { mimeSubtype: "jpeg" as const, prefix: "data:image/jpeg;base64," },
  { mimeSubtype: "webp" as const, prefix: "data:image/webp;base64," },
] as const;

function isBase64CharacterCode(code: number) {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 43 ||
    code === 47 ||
    code === 61
  );
}

export function parseComfyUiImageDataUrl(value: string) {
  const dataUrl = value.trim();
  const matched = imageDataUrlPrefixes.find(({ prefix }) => dataUrl.startsWith(prefix));
  if (!matched || dataUrl.length === matched.prefix.length) {
    return null;
  }

  for (let index = matched.prefix.length; index < dataUrl.length; index += 1) {
    if (!isBase64CharacterCode(dataUrl.charCodeAt(index))) {
      return null;
    }
  }

  return {
    base64: dataUrl.slice(matched.prefix.length),
    mimeSubtype: matched.mimeSubtype,
  };
}
