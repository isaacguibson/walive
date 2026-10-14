import type { ModelCapabilities } from '@shared/ai/types';

const UNKNOWN: ModelCapabilities = { image: 'unknown', tools: 'unknown', streaming: 'unknown', efforts: [], contextWindow: null };

/** Models that are not chat models and so are never offered. */
const OPENAI_NON_CHAT = /embedding|whisper|tts|dall-e|moderation|transcribe|realtime|audio|image|search|computer-use|davinci|babbage|instruct/i;

/**
 * Capabilities of well-known model families, used when the provider's model list carries no
 * metadata. Anything not recognized stays `unknown`; nothing is guessed.
 */
export function openAiCapabilities(modelId: string): ModelCapabilities | null {
  if (OPENAI_NON_CHAT.test(modelId)) {
    return null;
  }
  if (/^(gpt-5|o\d)/.test(modelId)) {
    const vision = !/^o\d-mini/.test(modelId);
    return { image: vision ? 'yes' : 'no', tools: 'yes', streaming: 'yes', efforts: ['low', 'medium', 'high'], contextWindow: null };
  }
  if (/^gpt-(4o|4\.1|4-turbo)/.test(modelId)) {
    return { image: 'yes', tools: 'yes', streaming: 'yes', efforts: [], contextWindow: null };
  }
  if (/^gpt-3\.5/.test(modelId)) {
    return { image: 'no', tools: 'yes', streaming: 'yes', efforts: [], contextWindow: null };
  }
  return UNKNOWN;
}

export function anthropicCapabilities(modelId: string): ModelCapabilities {
  return /^claude/.test(modelId) ? { image: 'yes', tools: 'yes', streaming: 'yes', efforts: [], contextWindow: null } : UNKNOWN;
}

export const UNKNOWN_CAPABILITIES = UNKNOWN;
