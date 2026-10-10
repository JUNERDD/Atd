import { Config } from '@remotion/cli/config';
import { ENCODING } from './render-settings.ts';

// The encode lives in `render-settings.ts`, which `scripts/render.ts` reads as well.
Config.setVideoImageFormat(ENCODING.imageFormat);
Config.setJpegQuality(ENCODING.jpegQuality);
Config.setCodec(ENCODING.codec);
Config.setCrf(ENCODING.crf);
Config.setX264Preset(ENCODING.x264Preset);
Config.setPixelFormat(ENCODING.pixelFormat);
Config.setColorSpace(ENCODING.colorSpace);
Config.setAudioBitrate(ENCODING.audioBitrate);
Config.setOverwriteOutput(ENCODING.overwrite);
