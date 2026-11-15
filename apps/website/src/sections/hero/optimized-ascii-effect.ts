import type { Camera, Scene, WebGLRenderer } from 'three';

/** WebGL supersampling multiplier relative to the ASCII sampling grid. */
const RENDER_SUPERSAMPLE = 2;

export interface OptimizedAsciiEffectOptions {
  resolution?: number;
  scale?: number;
  invert?: boolean;
}

/**
 * Monochrome ASCII rasterizer backed by a downsampled WebGL target: renders Three.js at a multiple
 * of the character grid instead of full viewport resolution, then maps luminance to `charSet`.
 */
export class OptimizedAsciiEffect {
  readonly domElement: HTMLDivElement;
  readonly setSize: (width: number, height: number) => void;
  readonly render: (scene: Scene, camera: Camera) => void;

  constructor(
    renderer: WebGLRenderer,
    charSet = ' .:·-=+*#%@',
    options: OptimizedAsciiEffectOptions = {},
  ) {
    const fResolution = options.resolution ?? 0.15;
    const iScale = options.scale ?? 1;
    const bInvert = options.invert ?? false;

    let width = 0;
    let height = 0;
    let iWidth = 0;
    let iHeight = 0;

    const dom = document.createElement('div');
    this.domElement = dom;

    const oAscii = document.createElement('table');
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    row.appendChild(cell);
    oAscii.appendChild(row);
    dom.appendChild(oAscii);

    const oCanvasImg = renderer.domElement;
    const oCanvas = document.createElement('canvas');
    const oCtx = oCanvas.getContext('2d', { willReadFrequently: true });
    if (!oCtx) {
      throw new Error('OptimizedAsciiEffect: Canvas 2D context unavailable');
    }

    const aCharList = charSet.split('');
    const maxIdx = aCharList.length - 1;
    const fFontSize = (2 / fResolution) * iScale;
    const fLineHeight = (2 / fResolution) * iScale;

    oAscii.cellSpacing = '0';
    oAscii.cellPadding = '0';
    oAscii.style.whiteSpace = 'pre';
    oAscii.style.margin = '0px';
    oAscii.style.padding = '0px';
    oAscii.style.letterSpacing = '0px';
    oAscii.style.fontFamily = 'courier new, monospace';
    oAscii.style.fontSize = `${fFontSize}px`;
    oAscii.style.lineHeight = `${fLineHeight}px`;
    oAscii.style.textAlign = 'left';
    oAscii.style.textDecoration = 'none';

    cell.style.display = 'block';
    cell.style.padding = '0px';
    cell.style.overflow = 'hidden';

    const initAsciiSize = () => {
      iWidth = Math.floor(width * fResolution);
      iHeight = Math.floor(height * fResolution);
      if (iWidth < 1 || iHeight < 1) return;

      const renderWidth = iWidth * RENDER_SUPERSAMPLE;
      const renderHeight = iHeight * RENDER_SUPERSAMPLE;

      oCanvas.width = iWidth;
      oCanvas.height = iHeight;

      renderer.setPixelRatio(1);
      renderer.setSize(renderWidth, renderHeight, false);

      cell.style.width = `${width}px`;
      cell.style.height = `${height}px`;
    };

    const asciifyImage = () => {
      oCtx.clearRect(0, 0, iWidth, iHeight);
      oCtx.drawImage(oCanvasImg, 0, 0, iWidth, iHeight);
      const oImgData = oCtx.getImageData(0, 0, iWidth, iHeight).data;

      let output = '';
      for (let y = 0; y < iHeight; y += 2) {
        if (y > 0) output += '\n';
        for (let x = 0; x < iWidth; x++) {
          const offset = (y * iWidth + x) * 4;
          const red = oImgData[offset] ?? 0;
          const green = oImgData[offset + 1] ?? 0;
          const blue = oImgData[offset + 2] ?? 0;
          const alpha = oImgData[offset + 3] ?? 0;

          let brightness = (0.3 * red + 0.59 * green + 0.11 * blue) / 255;
          if (alpha === 0) {
            brightness = 1;
          }

          let charIdx = Math.round((1 - brightness) * maxIdx);
          if (bInvert) {
            charIdx = maxIdx - charIdx;
          }

          output += aCharList[charIdx] ?? ' ';
        }
      }

      cell.textContent = output;
    };

    this.setSize = (nextWidth: number, nextHeight: number) => {
      width = nextWidth;
      height = nextHeight;
      initAsciiSize();
    };

    this.render = (scene: Scene, camera: Camera) => {
      renderer.render(scene, camera);
      if (iWidth > 0 && iHeight > 0) {
        asciifyImage();
      }
    };
  }
}
