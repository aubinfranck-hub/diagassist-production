// Clés Gemini disponibles : GEMINI_API_KEY (une ou plusieurs clés séparées par des virgules)
// et GEMINI_API_KEY_2. Dédoublonnées, dans cet ordre.
export function getGeminiKeys(): string[] {
  const raw = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2]
    .filter(Boolean)
    .flatMap((v) => String(v).split(","))
    .map((k) => k.trim())
    .filter(Boolean);
  return Array.from(new Set(raw));
}
