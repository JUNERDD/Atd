import { OptimizedAsciiEffect } from './optimized-ascii-effect';

/** Angular velocity aligned with 0.0018 rad/frame at 60 Hz. */
const ELAPSED_STEP_PER_60FPS_FRAME = 0.0018;
const TARGET_FPS = 30;
const TARGET_FRAME_MS = 1000 / TARGET_FPS;

const ASCII_EFFECT_OPTIONS = {
  resolution: 0.14,
  scale: 1.2,
  invert: false,
} as const;

const ASCII_CHARSET = ' .:·-=+*#%@';

export interface HeroAsciiEngineOptions {
  reduceMotion: boolean;
}

/**
 * Mounts the 3D wireframe-lit ASCII sculpture into `container` and returns a cleanup handle.
 * Dynamically imports `three` so server rendering stays free of WebGL globals.
 */
export function mountHeroAsciiEngine(
  container: HTMLElement,
  options: HeroAsciiEngineOptions,
): () => void {
  let disposed = false;
  let cleanup: (() => void) | undefined;

  void (async () => {
    const THREE = await import('three');
    if (disposed) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const shouldAnimate = !prefersReducedMotion && !options.reduceMotion;

    let renderer: InstanceType<typeof THREE.WebGLRenderer>;
    let effect: OptimizedAsciiEffect;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      });
      renderer.setClearColor(0x000000, 0);
      effect = new OptimizedAsciiEffect(renderer, ASCII_CHARSET, ASCII_EFFECT_OPTIONS);
    } catch {
      return;
    }

    if (disposed) {
      renderer.dispose();
      return;
    }

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.028);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 50);
    camera.position.set(0, 0, 3.6);

    const asciiRoot = effect.domElement;
    asciiRoot.className = 'hero__ascii-effect';
    container.appendChild(asciiRoot);

    const sculpture = new THREE.Group();
    sculpture.scale.setScalar(1.38);

    const knot = new THREE.Mesh(
      new THREE.TorusKnotGeometry(1.38, 0.36, 112, 14, 2, 3),
      new THREE.MeshStandardMaterial({
        color: 0x8a8a8a,
        roughness: 0.76,
        metalness: 0.16,
        flatShading: true,
      }),
    );
    knot.position.set(-1.05, 0.15, 0);
    sculpture.add(knot);

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.08, 0),
      new THREE.MeshStandardMaterial({
        color: 0x6c6c6c,
        roughness: 0.8,
        flatShading: true,
      }),
    );
    core.position.set(1.35, -0.42, -0.15);
    sculpture.add(core);

    const orbit = new THREE.Mesh(
      new THREE.TorusGeometry(2.75, 0.026, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0x525252 }),
    );
    orbit.rotation.x = Math.PI / 2.4;
    sculpture.add(orbit);

    scene.add(sculpture);

    const key = new THREE.DirectionalLight(0xffffff, 0.94);
    key.position.set(3, 2, 4);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xb8b8b8, 0.28));

    const disposables: Array<{ dispose: () => void }> = [
      knot.geometry,
      knot.material,
      core.geometry,
      core.material,
      orbit.geometry,
      orbit.material,
    ];

    let frameId = 0;
    let elapsed = 0;
    let lastFrameTime = performance.now();
    let lastRenderTime = 0;
    let inView = true;
    let animating = shouldAnimate && !document.hidden;

    const applyMotion = (deltaSeconds: number) => {
      const frameScale = deltaSeconds * 60;
      elapsed += ELAPSED_STEP_PER_60FPS_FRAME * frameScale;
      sculpture.rotation.y = elapsed * 0.55;
      sculpture.rotation.x = Math.sin(elapsed * 0.35) * 0.06;
      knot.rotation.z = elapsed * 0.25;
    };

    const renderFrame = () => {
      effect.render(scene, camera);
      container.dataset.asciiReady = 'true';
    };

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      effect.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderFrame();
    };

    const schedule = () => {
      if (!animating || disposed) return;
      frameId = requestAnimationFrame(tick);
    };

    const syncAnimationState = () => {
      const nextAnimating = shouldAnimate && inView && !document.hidden;
      if (nextAnimating === animating) return;
      animating = nextAnimating;
      if (animating) {
        lastFrameTime = performance.now();
        lastRenderTime = 0;
        schedule();
      } else if (frameId) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      }
    };

    const tick = (now: number) => {
      frameId = 0;
      if (disposed || !animating) return;

      if (now - lastRenderTime < TARGET_FRAME_MS) {
        schedule();
        return;
      }

      const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
      lastFrameTime = now;
      lastRenderTime = now;

      applyMotion(deltaSeconds);
      renderFrame();
      schedule();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        inView = entries.some((entry) => entry.isIntersecting);
        syncAnimationState();
      },
      { threshold: 0.01 },
    );
    intersectionObserver.observe(container);

    document.addEventListener('visibilitychange', syncAnimationState);

    if (animating) {
      schedule();
    }

    cleanup = () => {
      disposed = true;
      animating = false;
      if (frameId) cancelAnimationFrame(frameId);
      document.removeEventListener('visibilitychange', syncAnimationState);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      delete container.dataset.asciiReady;
      asciiRoot.remove();
      for (const resource of disposables) {
        resource.dispose();
      }
      renderer.dispose();
    };
  })();

  return () => {
    disposed = true;
    cleanup?.();
  };
}
