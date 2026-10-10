/**
 * The providers Atd connects to, by ring: models in the cloud, and models served on the Mac itself
 * (each one a provider in the service's catalog). Marks come from the repository's brand assets
 * (packages/ui/src/assets/brands); those `sources.json` renders in the foreground color are drawn
 * in ink, the rest keep their own colors. Brand names are never translated.
 */
import claude from '@atd/ui/assets/brands/lndev/claude.svg';
import deepseek from '@atd/ui/assets/brands/lndev/deepseek.svg';
import gemini from '@atd/ui/assets/brands/lndev/google-gemini-symbol.svg';
import kimi from '@atd/ui/assets/brands/lndev/kimi.svg';
import lmStudio from '@atd/ui/assets/brands/lndev/lm-studio.svg';
import mistral from '@atd/ui/assets/brands/lndev/mistral-ai.svg';
import ollama from '@atd/ui/assets/brands/lndev/ollama.svg';
import openrouter from '@atd/ui/assets/brands/lndev/openrouter.svg';
import qwen from '@atd/ui/assets/brands/lndev/qwen.svg';
import vllm from '@atd/ui/assets/brands/lndev/vllm.svg';
import xai from '@atd/ui/assets/brands/lndev/x-ai.svg';
import llamacpp from '@atd/ui/assets/brands/external/llamacpp.svg';
import openai from '@atd/ui/assets/brands/openai.svg';

export interface Brand {
  name: string;
  src: string;
  /** Drawn as an ink silhouette (white on the film's night) rather than in its own colors. */
  ink: boolean;
}

/** The outer ring, in orbit order. */
export const CLOUD: readonly Brand[] = [
  { name: 'Claude', src: claude, ink: false },
  { name: 'OpenAI', src: openai, ink: true },
  { name: 'Gemini', src: gemini, ink: false },
  { name: 'DeepSeek', src: deepseek, ink: false },
  { name: 'xAI', src: xai, ink: true },
  { name: 'Mistral', src: mistral, ink: false },
  { name: 'Qwen', src: qwen, ink: false },
  { name: 'OpenRouter', src: openrouter, ink: true },
  { name: 'Kimi', src: kimi, ink: false },
];

/** The inner ring: servers that run models on this Mac. */
export const LOCAL: readonly Brand[] = [
  { name: 'Ollama', src: ollama, ink: true },
  { name: 'LM Studio', src: lmStudio, ink: true },
  { name: 'llama.cpp', src: llamacpp, ink: false },
  { name: 'vLLM', src: vllm, ink: false },
];
