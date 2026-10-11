/**
 * The provider marks the models tiles show, from the repository's brand assets
 * (`packages/ui/src/assets/brands`), drawn the way the product kit draws a model's mark in the
 * composer's model pill: a monochrome mask in the text color. Names are brand names and are never
 * translated; they match `content.brands` index for index.
 */
import anthropic from '@atd/ui/assets/brands/lndev/anthropic.svg';
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
import openai from '@atd/ui/assets/brands/openai.svg';

/** One mark per entry of `content.brands`, in the same order. */
export const BRAND_MARKS: readonly string[] = [
  claude,
  openai,
  gemini,
  ollama,
  deepseek,
  qwen,
  mistral,
  xai,
  lmStudio,
  openrouter,
  kimi,
  vllm,
];

/** The connected-providers list's marks, matching `content.providers.rows`. */
export const PROVIDER_MARKS: readonly string[] = [openai, anthropic, gemini, openrouter, ollama];

/** The composer's model pill mark. */
export const MODEL_MARK = claude;
