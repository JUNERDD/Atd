/**
 * Providers Atd connects to, shown with their marks from the repository's brand assets
 * (packages/ui/src/assets/brands, sourced from logos.lndev.me). Marks the sources file renders in
 * the foreground color are drawn as an ink mask, as the app's settings do; the rest keep their own
 * colors. Brand names are never translated.
 */
import anthropic from '@atd/ui/assets/brands/lndev/anthropic.svg';
import deepseek from '@atd/ui/assets/brands/lndev/deepseek.svg';
import githubCopilot from '@atd/ui/assets/brands/lndev/github-copilot.svg';
import gemini from '@atd/ui/assets/brands/lndev/google-gemini-symbol.svg';
import groq from '@atd/ui/assets/brands/lndev/groq.svg';
import huggingFace from '@atd/ui/assets/brands/lndev/hugging-face.svg';
import kimi from '@atd/ui/assets/brands/lndev/kimi.svg';
import lmStudio from '@atd/ui/assets/brands/lndev/lm-studio.svg';
import meta from '@atd/ui/assets/brands/lndev/meta.svg';
import mistral from '@atd/ui/assets/brands/lndev/mistral-ai.svg';
import ollama from '@atd/ui/assets/brands/lndev/ollama.svg';
import openrouter from '@atd/ui/assets/brands/lndev/openrouter.svg';
import qwen from '@atd/ui/assets/brands/lndev/qwen.svg';
import xai from '@atd/ui/assets/brands/lndev/x-ai.svg';
import zai from '@atd/ui/assets/brands/lndev/z-ai.svg';
import openai from '@atd/ui/assets/brands/openai.svg';

export interface Brand {
  name: string;
  src: string;
  /** Drawn in ink through the mark's shape, rather than in its own colors. */
  ink: boolean;
}

export const BRANDS: readonly Brand[] = [
  { name: 'OpenAI', src: openai, ink: true },
  { name: 'Anthropic', src: anthropic, ink: true },
  { name: 'Gemini', src: gemini, ink: false },
  { name: 'DeepSeek', src: deepseek, ink: false },
  { name: 'Mistral', src: mistral, ink: false },
  { name: 'Qwen', src: qwen, ink: false },
  { name: 'Kimi', src: kimi, ink: false },
  { name: 'xAI', src: xai, ink: true },
  { name: 'Meta', src: meta, ink: false },
  { name: 'Ollama', src: ollama, ink: true },
  { name: 'LM Studio', src: lmStudio, ink: true },
  { name: 'OpenRouter', src: openrouter, ink: true },
  { name: 'Groq', src: groq, ink: false },
  { name: 'GitHub Copilot', src: githubCopilot, ink: true },
  { name: 'Hugging Face', src: huggingFace, ink: false },
  { name: 'Z.ai', src: zai, ink: true },
];
