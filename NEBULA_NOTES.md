# Nebula Background Notes

This file captures the current state of the `background-only` nebula sketch so we can pick up where we left off.

## Files

- `background-only.html`
- `background-only.js`

The main Kandinsky sketch (`index.html` + `sketchdesktopreset.js`) is left as a separate experience.

## Entry point

Open in browser (with a local HTTP server running in this folder):

- `http://localhost:8000/background-only.html`

## Control Panel (top-left)

### Radial
- **Slider:** `radialSpeedSlider` (`params.radialSpeed`)
- **Meaning:** scales radial drift speed away from canvas center.
- **Usage in code:**
  - `radialSpeed = BASE_UNIT * params.radialSpeed;`
  - `radialOffset = radialSpeed * t;  // t = time * 0.0005`

### Flow
- **Slider:** `flowStrengthSlider` (`params.flowStrength`)
- **Meaning:** strength of the flow-field currents.
- **Usage:**
  - `flowSpeed = BASE_UNIT * 0.0006 * params.flowStrength;`

### Size (Scale)
- **Sliders:**
  - `sizeDepthSlider` → `params.sizeDepth`
  - `sizeSpeedSlider` → `params.sizeSpeed`
  - `sizeFxCheckbox` → `params.sizeFxEnabled`
- **Meaning:**
  - Depth = amplitude of size pulsing (how much blobs grow/shrink).
  - Speed = how fast size pulsing occurs.
  - Checkbox = turn size modulation on/off.
- **Usage (per blob):**
  - `basePulseAmt` from noise (`0.08..0.22`).
  - `pulseAmp = basePulseAmt * sizeDepth`.
  - `sizePhase = time * sizeSpeed + i * 0.8`.
  - `sizeWave = 0.5 * (1 + sin(sizePhase))`.
  - `easedSize = sizeWave^2 * (3 - 2*sizeWave)`.
  - `signedWave = (easedSize - 0.5) * 2` (−1..1).
  - `pulse = 1 + pulseAmp * signedWave` (used as scale factor).

### Opacity
- **Sliders:**
  - `opacityDepthSlider` → `params.opacityDepth`
  - `opacitySpeedSlider` → `params.opacitySpeed`
  - `opacityFxCheckbox` → `params.opacityFxEnabled`
- **Meaning:**
  - Depth = how far alpha dips toward 0 (0 = no fade, 1 = full 0→1 range).
  - Speed = upper bound for fade oscillation frequency.
  - Checkbox = turn opacity modulation on/off.
- **Usage (per sub-shape in a blob):**
  - `noiseSeed = i*5.17 + formIndex*3.41`.
  - `localSpeed = opacitySpeed * noise(noiseSeed)` (0..opacitySpeed).
  - `phaseOffset = noise(noiseSeed + 1000) * TWO_PI`.
  - `fadePhase = time * localSpeed + phaseOffset`.
  - `wave = 0.5 * (1 + sin(fadePhase))` (0..1).
  - `fadeFactor = 1 - opacityDepth * (1 - wave)`.
  - `alpha = baseAlpha * fadeFactor`.

### Attract / Repel (blob–blob forces)
- **Sliders:**
  - `attractSlider` → `params.attractStrength`
  - `repelSlider`   → `params.repelStrength`
- **Meaning:**
  - Attraction pulls blobs toward each other; repulsion pushes them apart.
- **Usage (per blob i vs all others j):**
  - `dx, dy` = vector between blob positions.
  - `distSq = dx^2 + dy^2 + 1e-3`.
  - Ignore if `dist > BASE_UNIT * 0.6`.
  - `dirN = (dx, dy) / dist`.
  - `attract = (attractStrength * 0.0003 * BASE_UNIT) / distSq`.
  - `repel   = (repelStrength   * 0.0003 * BASE_UNIT) / distSq`.
  - `force   = attract - repel`.
  - Sum `interactX/Y += dirN * force` and add into overall drift.

## Default Coefficients on Reload

These are defined both in the HTML slider `value` attributes and in the `params` object in `background-only.js`:

```js
params = {
  radialSpeed:   0.003,  // scaled by BASE_UNIT
  flowStrength:  1.0,
  sizeDepth:     2.0,
  sizeSpeed:     0.002,
  opacityDepth:  1.0,
  opacitySpeed:  0.004,
  sizeFxEnabled: true,
  opacityFxEnabled: true,
  attractStrength: 0.3,
  repelStrength:   0.3,
};
```

This matches the "everything maxed" control-panel screenshot.

## Interaction

- Sliders update parameters live; no page reload needed.
- Press **N** (with no input focused) to reseed (`randomSeedValue`) and get a new field.
- `mousePressed` is disabled for reseeding.

## Known Behavior / Notes

- Opacity is continuous but can *look* steppy when depth + speed are high, due to many overlapping shapes. We mitigated this by:
  - Driving opacity per sub-shape, not per blob.
  - Giving each sub-shape its own local speed and phase derived from noise.
- There is no true global period now; `opacitySpeed` is a cap, and each form chooses a local speed in `[0, opacitySpeed]`.
- For calmer behavior, start with lower `opacityDepth`, `opacitySpeed`, `sizeDepth`, and `sizeSpeed`, and set `attractStrength/repelStrength` closer to 0.

## Next Steps (Wishlist)

- Add true orbital attractor points for galaxy-like motion.
- Normalize **all** effects (radial, flow, attract/repel) to the same sine-wave **speed + depth** pattern, with on/off toggles.
- Consider adding preset buttons (e.g. Calm, Nebula, Storm) that set all params at once.
