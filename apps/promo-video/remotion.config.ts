import { Config } from '@remotion/cli/config';

// Frames are captured as near-lossless JPEG: the LED dots and the interface's small type band
// visibly at the default quality. The encode keeps that detail through H.264.
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(96);
Config.setCodec('h264');
Config.setCrf(15);
Config.setX264Preset('slow');
Config.setPixelFormat('yuv420p');
// Without it the frames' full-range JPEG colour passes through as full range, which many players
// and upload pipelines misread (lifted blacks or crushed shadows). Limited-range BT.709, tagged, is
// what they all expect.
Config.setColorSpace('bt709');
Config.setAudioBitrate('320k');
Config.setOverwriteOutput(true);
