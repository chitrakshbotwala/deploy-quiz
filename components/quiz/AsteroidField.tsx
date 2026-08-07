import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { gsap } from '@/lib/gsap';

/**
 * The desktop renderer: a real asteroid field you fly through, one rock per
 * question, drawn behind the question panel.
 *
 * Why WebGL here and not on a phone: the flight between two questions is a
 * camera move with warp streaks and a per-rock key light, and a mid-range phone
 * running that under a full-viewport DOM panel is exactly the jank the main
 * page already spends effort avoiding (see the mobile branches in
 * JourneySection). The phone gets the warp-panel renderer instead, which is the
 * same choreography expressed in transforms the compositor already owns.
 *
 * Everything here is deliberate about cost:
 *  - Stars are NOT drawn in WebGL. The page keeps the same canvas Starfield the
 *    main page uses, behind this canvas, so the two surfaces share one star
 *    field and this context only ever draws rock.
 *  - Geometry is generated once and shared. Chapter rocks get their own material
 *    (they flash), debris shares one.
 *  - The loop pauses on `document.hidden` and on `prefers-reduced-motion` this
 *    component is never mounted at all.
 */

/** Deterministic PRNG. The field must not reshuffle on remount or HMR. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A rock, not a ball. An icosahedron subdivided twice, then every vertex pushed
 * along its own normal by a couple of octaves of value noise, then flat-shaded
 * so the facets read as fractured stone rather than a smooth potato.
 */
function makeRock(radius: number, rand: () => number, detail = 3) {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  // Three scales of displacement, because a rock read at this size fails in
  // three different ways without all three:
  //   craters — a few deep negative lobes. These are what stop the silhouette
  //             from being convex, which is the single thing that separates a
  //             rock from a gem.
  //   lobes   — broad positive swells that make it lopsided.
  //   grain   — high-frequency roughness so the facets are not flat planes.
  // All three are functions of the vertex direction only, so displacement is
  // continuous across the icosahedron's shared vertices and the rock can never
  // split along a seam.
  const dir = () => new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
  const craters = Array.from({ length: 3 + Math.floor(rand() * 3) }, () => ({
    axis: dir(),
    depth: 0.16 + rand() * 0.2,
    // Higher exponent = tighter crater. Low ones read as a bite taken out.
    tightness: 5 + rand() * 10
  }));
  const lobes = Array.from({ length: 3 }, () => ({ axis: dir(), amp: 0.14 + rand() * 0.18 }));
  const seed = rand() * 20;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let d = 1;
    for (const l of lobes) d += l.amp * Math.max(0, v.dot(l.axis)) ** 2;
    for (const c of craters) d -= c.depth * Math.max(0, v.dot(c.axis)) ** c.tightness;
    d += 0.05 * Math.sin(v.x * 8.3 + seed) * Math.cos(v.y * 6.9 - seed) * Math.sin(v.z * 7.1);
    d += 0.028 * Math.sin(v.x * 21.7 - v.z * 17.3 + seed) * Math.cos(v.y * 19.1);
    v.multiplyScalar(radius * d);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Camera-local hyperspace streaks. Inert until a flight scales them out. */
function makeStreaks(rand: () => number) {
  const COUNT = 240;
  const positions = new Float32Array(COUNT * 6);
  for (let i = 0; i < COUNT; i++) {
    // Annulus, so nothing spawns dead centre where the rock is being read.
    const a = rand() * Math.PI * 2;
    const r = 4 + rand() * 34;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * 0.7;
    const z = -12 - rand() * 130;
    const len = 4 + rand() * 7;
    positions.set([x, y, z, x, y, z + len], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  return new THREE.LineSegments(geo, mat);
}

export interface AsteroidFieldProps {
  /** Rock currently parked at. `total` itself is the final readout rock. */
  index: number;
  total: number;
  accent: string;
  /** Fires the surface reaction once, on the transition out of 'none'. */
  outcome: 'none' | 'correct' | 'wrong';
}

export default function AsteroidField({ index, total, accent, outcome }: AsteroidFieldProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  // The scene is built once and never rebuilt, so anything inside it that needs
  // to know where the run currently is has to read it through a ref. Closing
  // over the `index` prop would pin it at 0 for the life of the page.
  const indexRef = useRef(index);
  indexRef.current = index;
  // Imperative handles the React props drive. Kept in one ref so the effects
  // that react to prop changes never depend on the setup effect re-running.
  const apiRef = useRef<{
    flyTo: (i: number) => void;
    pulse: (kind: 'correct' | 'wrong', color: string) => void;
    setAccent: (color: string) => void;
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch {
      // No context: the DOM starfield behind is still a complete background, and
      // the panel is fully usable on top of it.
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(52, mount.clientWidth / mount.clientHeight, 0.1, 600);
    scene.add(camera);

    const rand = mulberry32(0x5eed7a);
    const stops = total + 1; // one rock per question, plus the readout rock

    // ── The corridor ─────────────────────────────────────────────────────────
    // Rocks are strung along -Z with lateral and vertical wander, so the flight
    // is never a straight tunnel: each leg banks a little because the next rock
    // is genuinely somewhere else.
    const rocks: THREE.Mesh[] = [];
    const rockMats: THREE.MeshStandardMaterial[] = [];
    const spins: THREE.Vector3[] = [];
    for (let i = 0; i < stops; i++) {
      const last = i === stops - 1;
      const radius = last ? 6.4 : 3.4 + rand() * 1.6;
      const geo = makeRock(radius, rand);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x2c2836),
        roughness: 1,
        metalness: 0,
        flatShading: true,
        emissive: new THREE.Color(0x000000)
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(Math.sin(i * 1.83) * 9 + (rand() - 0.5) * 5, Math.cos(i * 1.27) * 4.4 + (rand() - 0.5) * 3, -i * 52);
      mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      scene.add(mesh);
      rocks.push(mesh);
      rockMats.push(mat);
      spins.push(new THREE.Vector3((rand() - 0.5) * 0.055, (rand() - 0.5) * 0.07, (rand() - 0.5) * 0.04));
    }

    // Debris. One geometry, one material, scattered wide and far off the
    // corridor purely to give the flight parallax to measure itself against.
    const debrisGeo = makeRock(1, rand, 2);
    const debrisMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x241f2c),
      roughness: 1,
      metalness: 0,
      flatShading: true
    });
    const debris: THREE.Mesh[] = [];
    for (let i = 0; i < 46; i++) {
      const m = new THREE.Mesh(debrisGeo, debrisMat);
      const s = 0.6 + rand() * 2.6;
      m.scale.setScalar(s);
      m.position.set((rand() - 0.5) * 120, (rand() - 0.5) * 66, -rand() * (stops * 52) - 20);
      m.rotation.set(rand() * 6.28, rand() * 6.28, rand() * 6.28);
      scene.add(m);
      debris.push(m);
    }

    // Deliberately dim. The white key and the ambient exist only to keep the
    // unlit side of a rock from going to pure black; if they carry the exposure,
    // every rock is grey and the per-question accent has nothing left to say.
    scene.add(new THREE.AmbientLight(0x353052, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 0.5);
    key.position.set(-0.6, 1, 0.8);
    scene.add(key);
    // The accent light is parked ON the current rock rather than on the camera:
    // riding the camera put it 30-odd units out, where inverse-square had already
    // eaten it, and the rock you were reading a question at came out the same
    // grey as the debris behind it. Repositioned per frame in the loop.
    const accentLight = new THREE.PointLight(new THREE.Color(accent), 300, 70, 2);
    scene.add(accentLight);

    const streaks = makeStreaks(rand);
    camera.add(streaks);

    // Contact ring, billboarded at the rock being answered.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 96),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.visible = false;
    scene.add(ring);

    // ── Camera rig ───────────────────────────────────────────────────────────
    // `base` is what tweens; `shake` and `parallax` are added on top every frame,
    // so a flight in progress is never fighting a pointer move or an impact.
    const base = new THREE.Vector3();
    const look = new THREE.Vector3();
    const shake = new THREE.Vector3();
    const parallax = new THREE.Vector2();
    const pointer = new THREE.Vector2();
    // Looking left of the rock puts the rock on the right of frame, clear of the
    // question column, which is held to the left half of the panel. The offset
    // is generous: at a shorter one the rock's limb crossed the answer rows,
    // and an answer row is not a thing to make anyone read over a lit boulder.
    const LOOK_OFFSET = new THREE.Vector3(-13, 1.2, 0);
    // The readout is the only stop whose panel uses the full width (score on the
    // left, answer log on the right), so its rock has to be pushed further out
    // and further right than a question's or the log reads over a boulder.
    const READOUT_LOOK = new THREE.Vector3(-22, 2, 0);
    const isReadout = (i: number) => i >= rocks.length - 1;
    const camFor = (i: number) => {
      const p = rocks[Math.min(i, rocks.length - 1)].position;
      return isReadout(i)
        ? new THREE.Vector3(p.x + 9, p.y + 4, p.z + 62)
        : new THREE.Vector3(p.x + 6, p.y + 2.4, p.z + 35);
    };
    const lookFor = (i: number) =>
      rocks[Math.min(i, rocks.length - 1)].position.clone().add(isReadout(i) ? READOUT_LOOK : LOOK_OFFSET);
    // Parked well behind the first rock at build time. The mount-time `flyTo(0)`
    // then has real distance to cover, so the page arrives the way the hero
    // does: dropping out of a warp onto the first stop, rather than cutting to
    // an already-parked camera with streaks firing over a still frame.
    base.copy(camFor(0)).add(new THREE.Vector3(0, 0, 82));
    look.copy(lookFor(0));

    const onPointer = (e: PointerEvent) => {
      pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      if (document.hidden) return;

      for (let i = 0; i < rocks.length; i++) {
        rocks[i].rotation.x += spins[i].x * dt;
        rocks[i].rotation.y += spins[i].y * dt;
        rocks[i].rotation.z += spins[i].z * dt;
      }
      for (let i = 0; i < debris.length; i++) {
        debris[i].rotation.y += 0.06 * dt;
        debris[i].rotation.x += 0.035 * dt;
      }

      // Pointer parallax, eased rather than snapped, and small: it is depth cue,
      // not a control.
      parallax.x += (pointer.x * 1.5 - parallax.x) * Math.min(1, dt * 2.6);
      parallax.y += (pointer.y * 0.9 - parallax.y) * Math.min(1, dt * 2.6);
      camera.position.set(base.x + parallax.x + shake.x, base.y - parallax.y + shake.y, base.z + shake.z);
      camera.lookAt(look);
      const lit = rocks[Math.min(indexRef.current, rocks.length - 1)].position;
      accentLight.position.set(lit.x + 7, lit.y + 6, lit.z + 11);
      if (ring.visible) ring.lookAt(camera.position);

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    apiRef.current = {
      setAccent: color => {
        accentLight.color.set(color);
        (streaks.material as THREE.LineBasicMaterial).color.set(color);
      },
      flyTo: i => {
        const to = camFor(i);
        const toLook = lookFor(i);
        gsap.killTweensOf([base, look, streaks.scale, streaks.material]);
        const tl = gsap.timeline();
        tl.to(base, { x: to.x, y: to.y, z: to.z, duration: 1.65, ease: 'power3.inOut' }, 0)
          // The look target eases faster than the body, so the camera swings onto
          // the next rock early in the leg and then travels toward what it is
          // already looking at. Arriving and turning at the same moment reads as
          // a cut.
          .to(look, { x: toLook.x, y: toLook.y, z: toLook.z, duration: 1.35, ease: 'power2.inOut' }, 0.12)
          // Streaks stretch out of nothing, hold through the fastest part of the
          // leg, and are gone before the camera settles: at rest there is no
          // streak to explain.
          .fromTo(
            streaks.scale,
            { z: 1 },
            { z: 3.6, duration: 1, ease: 'power2.in' },
            0
          )
          .fromTo(
            streaks.material,
            { opacity: 0 },
            { opacity: 0.5, duration: 0.55, ease: 'power2.in' },
            0.05
          )
          .to(streaks.material, { opacity: 0, duration: 0.6, ease: 'power2.out' }, 0.95)
          .to(streaks.scale, { z: 1, duration: 0.5, ease: 'power2.out' }, 1.1);
      },
      pulse: (kind, color) => {
        const at = Math.min(indexRef.current, rocks.length - 1);
        const rock = rocks[at];
        const mat = rockMats[at];
        const c = new THREE.Color(color);

        // The rock takes the charge and lets it go. Emissive only: the albedo
        // stays stone, so a correct answer lights the rock rather than repainting
        // it green.
        gsap.killTweensOf(mat.emissive);
        mat.emissive.copy(c);
        const glow = { v: 0 };
        gsap.to(glow, {
          v: 0,
          duration: 0.9,
          ease: 'power2.out',
          startAt: { v: kind === 'correct' ? 0.85 : 0.5 },
          onUpdate: () => mat.emissive.copy(c).multiplyScalar(glow.v)
        });

        // Scan ring across the surface, the same contact-ring beat the astronaut
        // lands with on the main page.
        ring.position.copy(rock.position);
        (ring.material as THREE.MeshBasicMaterial).color.set(color);
        ring.visible = true;
        gsap.killTweensOf([ring.scale, ring.material]);
        gsap.fromTo(
          ring.scale,
          { x: 3, y: 3, z: 3 },
          { x: 13, y: 13, z: 13, duration: 1.1, ease: 'power2.out' }
        );
        gsap.fromTo(
          ring.material as THREE.MeshBasicMaterial,
          { opacity: 0.75 },
          {
            opacity: 0,
            duration: 1.1,
            ease: 'power2.out',
            onComplete: () => {
              ring.visible = false;
            }
          }
        );

        if (kind === 'wrong') {
          // A miss is felt, not narrated: two hard knocks on the rig, decaying.
          // Written into `shake`, which is summed onto the camera every frame,
          // so it cannot corrupt a flight already tweening `base`.
          gsap.killTweensOf(shake);
          gsap
            .timeline()
            .set(shake, { x: 0.55, y: -0.4 })
            .to(shake, { x: -0.4, y: 0.3, duration: 0.07, ease: 'none' })
            .to(shake, { x: 0.22, y: -0.16, duration: 0.06, ease: 'none' })
            .to(shake, { x: 0, y: 0, duration: 0.28, ease: 'power2.out' });
        }
      }
    };
    apiRef.current.setAccent(accent);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      gsap.killTweensOf([base, look, shake, streaks.scale, streaks.material, ring.scale, ring.material]);
      apiRef.current = null;
      // Three keeps no registry of what a scene owns, so anything allocated here
      // is disposed here or it leaks the GPU buffer on every remount.
      rocks.forEach(r => r.geometry.dispose());
      rockMats.forEach(m => m.dispose());
      debrisGeo.dispose();
      debrisMat.dispose();
      streaks.geometry.dispose();
      (streaks.material as THREE.Material).dispose();
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // Built once for the life of the page. `index`/`accent`/`outcome` are driven
    // through the imperative handle by the effects below, because rebuilding a
    // scene of this size on every answer is not a thing to do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  useEffect(() => {
    apiRef.current?.setAccent(accent);
  }, [accent]);

  useEffect(() => {
    apiRef.current?.flyTo(index);
  }, [index]);

  useEffect(() => {
    if (outcome === 'none') return;
    apiRef.current?.pulse(
      outcome,
      outcome === 'correct'
        ? getComputedStyle(document.documentElement).getPropertyValue('--color-signal-ok').trim() || '#6fbf97'
        : getComputedStyle(document.documentElement).getPropertyValue('--color-signal-off').trim() || '#db8079'
    );
  }, [outcome, index]);

  return <div ref={mountRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />;
}
