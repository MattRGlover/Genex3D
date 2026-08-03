let BASE_UNIT;
let randomSeedValue;
let reseedTimestamp = 0; // tracks when we last reseeded so we can fade in new fields
let blobStates = {};     // per-blob state so we can change visible subshapes gradually

// Dashboard-controlled parameters
const params = {
  globalSpeed: 0.6,       // overall animation speed multiplier (even slower default)
  radialSpeed: 0.003,    // scaled by BASE_UNIT (slider max)
  flowStrength: 1.0,     // multiplier on flowSpeed
  sizeDepth: 2.0,        // depth of size pulsing (slider max)
  sizeSpeed: 0.0015,     // frequency of size pulsing (slower default)
  opacityDepth: 0.8,     // how far toward invisible opacity can go (0..1)
  opacitySpeed: 0.002,   // frequency of opacity pulsing (slower by default)
  sizeFxEnabled: true,
  opacityFxEnabled: true,
  attractStrength: 0.3,  // blob-blob attraction, 0..1
  repelStrength: 0.3,    // blob-blob repulsion, 0..1
};

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
  BASE_UNIT = Math.min(width, height);

  // Initial seed so the structure is stable until user changes it
  randomSeedValue = int(random(1000000));
  // Start with a fade-in on first load as well
  reseedTimestamp = millis();

  setupControls();
}

function draw() {
  background(0);

  // Use a fixed seed each frame so the underlying layout stays coherent,
  // but pass time into the generator so blobs themselves can rotate/morph.
  try {
    randomSeed(randomSeedValue);
    generateWatercolorBackground(this, millis());
  } catch (err) {
    console.error('Error in draw/generateWatercolorBackground:', err);

    // On-canvas indicator so failures are visible even without console
    push();
    fill(255, 0, 0);
    noStroke();
    textSize(14);
    text('Render error - see console', 10, 20);
    pop();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  BASE_UNIT = Math.min(width, height);
}

function mousePressed() {
  // Do not reseed on every click anymore; interaction is via dashboard.
}

function keyPressed() {
  // Allow reseed only with "N" to avoid interfering with browser reload or normal typing.
  // Also avoid triggering when the user is focused on a UI control.
  const active = document.activeElement;
  const isInputFocused = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  if (isInputFocused) return;

  if (key === 'n' || key === 'N') {
    randomSeedValue = int(random(1000000));
    reseedTimestamp = millis();
    blobStates = {}; // reset per-blob state on reseed so cycles restart cleanly
    // Prevent default so it doesn't trigger browser shortcuts.
    return false;
  }
}

// ---- Copied background generation logic from sketchdesktopreset.js, with time-based blob animation ----

function generateWatercolorBackground(pg, time = 0) {
  pg.push();
  pg.colorMode(HSB, 360, 100, 100, 100);
  pg.angleMode(DEGREES);

  // Lock global evolution speed to real time (no globalTime scaling)
  const absoluteScaled = time; // ms since start
  const rawElapsedSinceReseed = reseedTimestamp > 0 ? (time - reseedTimestamp) : time;
  const reseedElapsedScaled = rawElapsedSinceReseed;

  pg.blendMode(pg.BLEND);
  // Warm off-white / cream canvas color
  pg.background(40, 8, 96);
  pg.blendMode(pg.MULTIPLY);

  const numSplotches = 6; // allow more concurrent blobs on screen
  const arr_num = 230; // many small sub-shapes per blob for rich texture

  // Shared one-shot life timing for all blobs
  const assembleDuration = 3000;   // ms
  const sustainDuration  = 20000;  // ms
  const fadeDuration     = 7000;   // ms
  const totalLife        = assembleDuration + sustainDuration + fadeDuration;
  const spawnInterval    = 7000;   // ms between blob spawns; with looping this yields 4+ overlaps

  const placedSplotches = [];
  const maxAttempts = 20;

  const boldCount = floor(random(1));
  let boldIndices = [];
  for (let j = 0; j < boldCount; j++) {
    let index;
    do {
      index = floor(random(numSplotches));
    } while (boldIndices.includes(index));
    boldIndices.push(index);
  }

  // No noticeable global fade; blobs themselves have their own long envelopes.
  const reseedFade = 1;

  for (let i = 0; i < numSplotches; i++) {
    const blobId = i; // stable index per blob

    // Per-blob spawn timing and life-cycle index so that each time a blob
    // loops through its life, it can appear in a new place.
    const spawnOffset   = i * spawnInterval;
    const timeSinceStart = rawElapsedSinceReseed - spawnOffset;
    const cycleIndex = timeSinceStart <= 0 ? 0 : Math.floor(timeSinceStart / totalLife);

    // Retrieve or initialize persistent state for this blob and life cycle.
    const prevState = blobStates[blobId] || { visible: 0, cycleIndex: -1 };
    let state = prevState;

    // Stable per-blob hue (no time component) so each splotch keeps a
    // consistent color over its life. Use a richer "Malibu sunset"
    // palette: oranges, corals, pinks, magentas, violets, sea-greens,
    // and soft sky blues. Avoid harsh, electric greens.
    const hueNoise = pg.noise(i * 0.71);
    let zone_hue;

    if (hueNoise < 0.28) {
      // ~28%: warm oranges and corals (~10°..40°)
      zone_hue = pg.map(hueNoise, 0.0, 0.28, 10, 40);
    } else if (hueNoise < 0.48) {
      // ~20%: peachy pinks (~340°..360° wrapping to 0°..15°)
      const tHue = pg.map(hueNoise, 0.28, 0.48, 0, 1);
      const warm1 = pg.map(tHue, 0, 0.5, 340, 360); // late sunset sky
      const warm2 = pg.map(tHue, 0.5, 1, 0, 15);    // soft rose
      zone_hue = tHue < 0.5 ? warm1 : warm2;
    } else if (hueNoise < 0.7) {
      // ~22%: magentas and violets (~280°..330°)
      zone_hue = pg.map(hueNoise, 0.48, 0.7, 280, 330);
    } else if (hueNoise < 0.86) {
      // ~16%: sea-greens / aqua (~165°..210°), soft and slightly desaturated
      zone_hue = pg.map(hueNoise, 0.7, 0.86, 165, 210);
    } else {
      // ~14%: soft sky blues (~205°..230°) for cooler twilight accents
      zone_hue = pg.map(hueNoise, 0.86, 1.0, 205, 230);
    }

    state.hue = zone_hue;
    blobStates[blobId] = state;

    // When we enter a new life cycle, choose a new radius and center once,
    // and then reuse them every frame so the blob doesn't drift mid-life.
    if (state.cycleIndex !== cycleIndex) {
      // Blob size varies independently per blob; slightly larger fields
      // overall so color washes feel broader, but still with variety.
      let baseRadius = pg.random(BASE_UNIT * 0.14, BASE_UNIT * 0.26) * 0.9;
      // Make very first-generation blobs a bit smaller so they don't
      // dominate the early composition compared to later cycles.
      if (cycleIndex === 0) {
        baseRadius *= 0.78;
      }
      const radius = pg.random(baseRadius * 0.8, baseRadius * 1.15);

      let zone_x, zone_y;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Use noise-based sampling keyed by blob index, life-cycle index, and
        // attempt so that respawns get new, but stable, positions without
        // relying on the global random seed. Allow centers to drift slightly
        // beyond the canvas so blobs can grow in from the edges.
        const baseKey = i * 10 + cycleIndex * 3.17;
        const edgeMargin = radius * 0.25;
        zone_x = pg.map(
          pg.noise(baseKey + attempt * 5.31),
          0,
          1,
          -edgeMargin,
          pg.width + edgeMargin
        );
        zone_y = pg.map(
          pg.noise(baseKey + 1000 + attempt * 4.79),
          0,
          1,
          -edgeMargin,
          pg.height + edgeMargin
        );
        let isOverlapping = false;
        for (const s of placedSplotches) {
          const d = pg.dist(zone_x, zone_y, s.x, s.y);

          // Avoid stacking blobs with very similar hues directly on top
          // of each other: if hues are close, enforce a larger minimum
          // separation so same-colored blobs form separate fields. Also
          // give extra space to near-complementary hues that can mix
          // toward gray when heavily layered.
          let hueDiff = Math.abs(state.hue - s.hue);
          if (hueDiff > 180) hueDiff = 360 - hueDiff;
          const sameHue = hueDiff < 25;       // very similar hues
          const complementary = hueDiff > 140 && hueDiff < 220; // near opposites
          const sepFactor = sameHue ? 0.9 : complementary ? 0.85 : 0.65;

          if (d < (radius + s.radius) * sepFactor) {
            isOverlapping = true;
            break;
          }
        }
        if (!isOverlapping) {
          break;
        }
      }

      state = {
        ...state,
        cycleIndex,
        radius,
        x: zone_x,
        y: zone_y,
      };
      blobStates[blobId] = state;
      placedSplotches.push({ x: zone_x, y: zone_y, radius: radius, hue: state.hue });
    }

    const radius = state.radius;
    const zone_x = state.x;
    const zone_y = state.y;

    let arr = [];

    // Animate each splotch:
    // - rotation (unique speed per splotch)
    // - gentle drifting based on noise
    // - pulsing (unique rate/amplitude per splotch)
    const t = absoluteScaled * 0.0005; // global time in seconds-ish

    // Unique spin speed and direction per splotch
    const spinSpeed = pg.map(pg.noise(i * 0.7), 0, 1, -6, 6); // deg/sec-ish
    const splotchAngle = t * spinSpeed + i * 20;

    // For now, keep blob centers fixed at their original zones to
    // eliminate whole-blob jumping. Internal pulsing and subshape
    // jitter still provide life, but the anchor position is stable.
    const driftX = 0;
    const driftY = 0;

    // Per-splotch size pulsing: base noise-driven depth, modulated by dashboard speed/depth
    let pulse = 1;
    if (params.sizeFxEnabled) {
      const basePulseAmt = pg.map(pg.noise(i * 1.1 + 1500), 0, 1, 0.08, 0.22); // base depth
      const pulseAmp = basePulseAmt * params.sizeDepth;
      const sizePhase = absoluteScaled * params.sizeSpeed + i * 0.8;
      const sizeWave = 0.5 * (1 + pg.sin(sizePhase)); // 0..1
      const easedSize = sizeWave * sizeWave * (3 - 2 * sizeWave); // smoothstep
      const signedWave = (easedSize - 0.5) * 2; // -1..1
      pulse = 1 + pulseAmp * signedWave;
    }

    pg.push();
    pg.translate(zone_x + driftX, zone_y + driftY);
    pg.rotate(splotchAngle);
    pg.scale(pulse);

    for (let k = 0; k < arr_num; k++) {
      let angle_sep = pg.int(3, pg.noise(k) * 7);
      let points = createShape(radius, angle_sep, pg);
      let form = transformShape(points, 4, 0.5, pg);
      arr.push(form);
    }

    // One-shot life curve for a single blob:
    // - 0..3s: assemble (geometry/alpha ramp up)
    // - 3..23s: sustain (full geometry/alpha)
    // - 23..30s: fade/undraw (geometry/alpha ramp down)
    // - >30s: dead (no geometry/alpha) and does NOT cycle.

    // Staggered spawn: each blob i starts its life at a different time
    // so they form one after another with overlap. After that, each
    // blob loops through the same smooth assemble/sustain/fade curve
    // repeatedly, so the field never "runs out" of blobs.
    // Before this blob's spawn time, it is simply absent.
    const lifeTime = timeSinceStart <= 0 ? 0 : (timeSinceStart % totalLife); // ms within current life cycle

    // Compute a normalized life position 0..1 over the life cycle
    const lifeT = lifeTime / totalLife;

    // Use the same lifeT to derive a target geometry count. We keep
    // this simple and let later smoothing enforce the 3-subshape-per-
    // frame pacing.
    let targetVisibleForms = 0;
    if (lifeTime <= 0) {
      targetVisibleForms = 0;
    } else if (lifeTime < assembleDuration) {
      // Assembly phase: ramp 0 -> full
      const t = lifeTime / assembleDuration; // 0..1
      targetVisibleForms = pg.floor(pg.map(t, 0, 1, 0, arr_num));
    } else if (lifeTime < assembleDuration + sustainDuration) {
      // Sustain: full geometry
      targetVisibleForms = arr_num;
    } else if (lifeTime < totalLife) {
      // Fade/undraw: ramp full -> 0
      const t = (lifeTime - assembleDuration - sustainDuration) / fadeDuration; // 0..1
      targetVisibleForms = pg.floor(pg.map(t, 0, 1, arr_num, 0));
    } else {
      // After death: stay at 0 geometry
      targetVisibleForms = 0;
    }

    // Smooth the change in visible form count so we never add/remove
    // too many forms in a single frame. This makes both assembly and
    // disassembly feel like individual strokes being laid down or
    // erased, rather than chunks popping in/out.
    const prevStateForVisible = blobStates[blobId] || state || { visible: 0 };
    const maxStepPerFrame = 3; // add/remove at most 3 subshapes per frame

    const diff = targetVisibleForms - prevStateForVisible.visible;
    let newVisible = prevStateForVisible.visible;
    if (diff > 0) {
      newVisible += Math.min(diff, maxStepPerFrame);
    } else if (diff < 0) {
      newVisible += Math.max(diff, -maxStepPerFrame);
    }
    newVisible = pg.constrain(newVisible, 0, arr_num);
    blobStates[blobId] = { ...state, visible: newVisible };
    const maxVisibleForms = newVisible;

    for (let formIndex = 0; formIndex < arr.length; formIndex++) {
      if (formIndex >= maxVisibleForms) break;
      const form = arr[formIndex];
      // Smooth, noise-based jitter instead of per-frame randomGaussian,
      // so subshapes drift gently instead of jumping.
      const jitterScale = radius * 0.15;
      const jx = (pg.noise(i * 10 + formIndex * 0.37, absoluteScaled * 0.0002) - 0.5) * 2 * jitterScale;
      const jy = (pg.noise(i * 10 + formIndex * 0.37 + 500, absoluteScaled * 0.0002) - 0.5) * 2 * jitterScale;
      pg.push();
      pg.translate(jx, jy);

      // Base alpha/saturation: keep per-subshape opacity low so
      // overlapping layers preserve texture instead of blowing out.
      let baseAlpha = (100 / arr_num) * 1.0; // was *1.2
      let baseSat   = 80; // default saturation for "older" blobs

      // One-shot life curve for brightness (lifeAlpha) that matches the
      // same timing as the geometry life above.
      let lifeAlpha = 0;
      if (lifeTime <= 0) {
        lifeAlpha = 0;
      } else if (lifeTime < assembleDuration) {
        // Assembly: 0 -> 1 with a gentle ease-in
        const t = lifeTime / assembleDuration; // 0..1
        const eased = t * t * (3 - 2 * t);     // smoothstep
        lifeAlpha = eased;
      } else if (lifeTime < assembleDuration + sustainDuration) {
        // Sustain: hold near full brightness
        lifeAlpha = 1;
      } else if (lifeTime < totalLife) {
        // Fade-out: 1 -> 0 with a gentle ease-out
        const t = (lifeTime - assembleDuration - sustainDuration) / fadeDuration; // 0..1
        const eased = t * t * (3 - 2 * t);     // smoothstep
        lifeAlpha = 1 - eased;
      } else {
        // After death: remain dark
        lifeAlpha = 0;
      }

      // Per-sub-shape opacity wave: center around 1, dip toward 0 based on depth.
      // Each form gets its own local speed and phase based on noise so timing is desynchronized.
      let fadeFactor = 1;
      if (params.opacityFxEnabled) {
        const noiseSeed = i * 5.17 + formIndex * 3.41;
        // Local speed range: 0..opacitySpeed, so slider is a cap, not a common base
        const localSpeed = params.opacitySpeed * pg.noise(noiseSeed);
        const phaseOffset = pg.noise(noiseSeed + 1000) * pg.TWO_PI;

        const fadePhase  = time * localSpeed + phaseOffset;
        const wave       = 0.5 * (1 + pg.sin(fadePhase));  // pure sine, 0..1

        // When opacityDepth=0 -> always 1; when =1 -> full 0..1 range across 0..1 wave
        fadeFactor = 1 - params.opacityDepth * (1 - wave);

        // For very dim blobs (birth/death), damp modulation based on lifeAlpha so entry/exit
        // feels smooth and not flickery. lifeAlpha is 0..1 across the entire bell.
        const dimFactor = pg.constrain(lifeAlpha / 0.3, 0, 1); // 0 when very dim, 1 once fairly bright
        fadeFactor = 1 - (1 - fadeFactor) * dimFactor;

        // Lift the minimum modulation so mid-life blobs can still reach a strong,
        // consistent vibrancy even as the composition evolves. This avoids them
        // getting stuck in a too-dim state from the local opacity wave.
        fadeFactor = 0.45 + 0.55 * fadeFactor; // clamp roughly to [0.45, 1]
      }

      // Radial attenuation so centers stay softer: reduce opacity near
      // the blob origin and let it build slightly toward a mid-ring,
      // then fall off toward the edge. This mimics watercolor pooling.
      const distFromCenter = pg.sqrt(jx * jx + jy * jy);
      const rNorm = pg.constrain(distFromCenter / radius, 0, 1); // 0 at center, 1 at approx edge
      const midRing = rNorm * (1 - rNorm); // 0 at center/edge, peak ~0.25 at rNorm=0.5
      const radialFactor = pg.map(midRing, 0, 0.25, 0.5, 1.0); // center ~0.5, mid ~1.0, edge ~0.5

      // Final alpha combines: baseAlpha * blob life envelope * local opacity FX * global reseed fade-in * radial
      let alpha = baseAlpha * lifeAlpha * fadeFactor * reseedFade * radialFactor;
      let saturation = baseSat;

      if (boldIndices.includes(i)) {
        // Make bold blobs only slightly stronger so they stand out
        // without flattening the texture.
        alpha *= 1.3; // was 2.5
        saturation = min(100, saturation * 1.05);
      }

      // Use a single stable hue (zone_hue) for all subshapes of this blob
      // so its color does not drift over time.
      drawShape(form, pg.color(zone_hue, saturation, 90, alpha), pg);
      pg.pop();
    }
    pg.pop();
  }
  pg.pop();
}

function setupControls() {
  // Sliders and DOM controls removed: params are now fixed by their
  // defaults at the top of this file.
}

function createShape(shape_radius, angle_sep, pg) {
  let points = [];
  let start_angle = pg.random(360);
  let angle_step = 360 / angle_sep;
  for (let angle = start_angle; angle < start_angle + 360; angle += angle_step) {
    let x = pg.cos(angle) * shape_radius;
    let y = pg.sin(angle) * shape_radius;
    let point = pg.createVector(x, y);
    points.push(point);
  }
  return points;
}

function transformShape(points, count, variance, pg) {
  if (count <= 0) {
    return points;
  }
  let new_points = [];
  for (let i = 0; i < points.length; i++) {
    let p1 = points[i];
    let p2 = points[(i + 1) % points.length];
    new_points.push(p1);
    let mid = p5.Vector.lerp(p1, p2, 0.5);
    let len = p5.Vector.dist(p1, p2);
    mid.x += pg.randomGaussian(0, variance * len);
    mid.y += pg.randomGaussian(0, variance * len);
    new_points.push(mid);
  }
  return transformShape(new_points, count - 1, variance, pg);
}

function drawShape(points, col, pg) {
  pg.push();
  pg.fill(col);
  pg.noStroke();
  pg.beginShape();
  for (let p of points) {
    pg.vertex(p.x, p.y);
  }
  pg.endShape(CLOSE);
  pg.pop();
}
