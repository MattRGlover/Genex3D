// Babylon.js 3D Mode Integration
// Converts P5.js 2D Kandinsky shapes to navigable 3D space

console.log('🎮 babylon3D.js loading...');

let babylonEngine = null;
let babylonScene = null;
let camera3D = null;
let is3DMode = false;
let firstEntry3DHintsShown = false;
// "View Now in AR" hint (see activate3DMode/deactivate3DMode below): shown
// once ever, not once per 3D-mode visit - like firstEntry3DHintsShown, once
// someone has found the button (or been shown the hint) it doesn't need to
// nudge again for the rest of the session.
let arHintShown = false;
let arHintTimer = null;
const AR_HINT_DELAY_MS = 15000;
// How many 2D elements existed at the last successful convertShapesTo3D()
// build (from any source - activate3DMode, setScrambleMode, or a future
// caller) - null until that first build. activate3DMode compares this
// against window.getCompositionProgress()'s current count to skip
// rebuilding (and re-growing every strut) on a 2D->3D->2D->3D round trip
// that drew nothing new in between; scramble's own rebuild (setScrambleMode)
// keeps this in sync too, so toggling scramble then leaving and returning
// to 3D with nothing else changed also correctly reuses the already-
// scrambled scene instead of rebuilding it back to a fresh unscrambled one.
let lastBuild3DElementCount = null;
let gestureDemoGen = 0; // bumped whenever a run is superseded or cancelled
// The CURRENT run's own cancel closure (playGestureDemo below), so
// deactivate3DMode can interrupt it too - that cancel only used to be
// wired to a pointerdown on #babylon-canvas, so leaving 3D mid-demo any
// OTHER way (the "2D" button) skipped it entirely: the fingers were left
// frozen at full opacity, hidden only by #gesture-hint's own
// body:not(.in-3d) display:none, and reappeared exactly where they'd
// frozen the moment 3D was re-entered.
let cancelCurrentGestureDemo = null;
let scrambleAnimGen = 0; // bumped whenever a scramble transition is superseded (rapid re-toggling) or the scene tears down
let strutGrowthQueue = []; // struts createSolidTube3D built this pass, waiting to be grown in - see animateStrutGrowth
let strutGrowGen = 0; // bumped whenever a strut-growth run is superseded or cancelled
let baseRevealGen = 0; // bumped whenever a base-reveal run is superseded or cancelled

// Wait for everything to load
window.addEventListener('load', () => {
  setTimeout(initBabylon3D, 1000);
});

// requestAnimationFrame tween that hands the CALLER a raw 0-1 t rather than
// pre-applying an easing curve - camera-linked motion and purely decorative
// flourishes (a materialize pulse, a turnaround "breathe") want different
// curves, and forcing one easing on everything is how demos end up feeling
// generic instead of considered. isActive() is checked every frame; the
// tween resolves early (without finishing) the moment it goes false - used
// both for "the user grabbed the camera" and "a newer run superseded this
// one".
function tweenRaw(durationMs, isActive, onFrame) {
  return new Promise((resolve) => {
    const start = performance.now();
    function step(now) {
      if (!isActive()) { resolve(); return; }
      const t = Math.min(1, (now - start) / durationMs);
      onFrame(t);
      if (t < 1) requestAnimationFrame(step); else resolve();
    }
    requestAnimationFrame(step);
  });
}
// Smooth, no overshoot - what actually drives the camera, so it arrives
// rather than wobbles.
function easeInOutSine(t) { return 0.5 - 0.5 * Math.cos(t * Math.PI); }
// A touch of overshoot-and-settle - reserved for decoration (materializing,
// the weight of a hand arriving/lifting), never for the camera itself.
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  const p = t - 1;
  return 1 + c3 * p * p * p + c1 * p * p;
}
function setFinger(el, dx, dy, scale, opacity, rotationDeg) {
  const rot = rotationDeg || 0;
  // Position first, then rotate/scale - both act around the element's OWN
  // (already-repositioned) centre, not the pre-translate origin, so the
  // icon spins and grows in place rather than swinging around the anchor.
  el.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${scale})`;
  el.style.opacity = opacity;
}
// fa-hand-pointer's glyph points "up" in its own un-rotated state, i.e.
// along screen angle -90deg in the dx/dy convention below (0deg = +x/right,
// positive = clockwise, since screen y grows downward). Rotating it by
// (angleDeg + 90) turns it to face along angleDeg instead.
function pointerRotationFor(angleDeg) { return angleDeg + 90; }
// Interpolates the SHORT way around the circle - without this, animating
// from e.g. 64deg to 308deg would spin the long way (244deg) instead of the
// equivalent short hop (-116deg).
function lerpAngleDeg(fromDeg, toDeg, t) {
  let delta = (toDeg - fromDeg) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return fromDeg + delta * t;
}

// First-time-in-3D onboarding: fingerprints floating directly over the
// scene (no panel), driven frame-by-frame from the real camera - true to
// how the gestures actually work, not just symmetric-looking: ONE finger
// drags to orbit (a two-finger drag would be wrong - it only takes one),
// then a second finger joins it for an actual pinch - apart to zoom in,
// together to zoom out - while the camera really does both in step. Their
// motion IS the camera's motion, not a separate illustration of it. Used
// both for the real first entry and for #help-btn, which replays it on
// demand.
//
// The choreography is deliberate rather than a straight there-and-back:
// fingers materialize with a touch of weight (a slight overshoot as they
// settle, not a flat fade), each drag eases smoothly with the camera but
// pauses and "breathes" for a beat at the far end before reversing - the
// way a real hand rests a moment before pulling back - and the second
// finger joins for the pinch rather than just appearing.
// Resolves true if the demo ran to its natural end, false if the user
// interrupted it (or it never had anything to show) - play3DIntroSequence
// uses this to decide whether the SECOND half of the same intro (the
// button-label walkthrough) still gets to run, or whether an interruption
// here must cancel that too.
async function playGestureDemo() {
  if (!camera3D || !is3DMode) return false;
  const f1 = document.getElementById('gesture-finger-1');
  const f2 = document.getElementById('gesture-finger-2');
  const layer = document.getElementById('gesture-hint');
  if (!f1 || !f2 || !layer) return false;

  // A generation token rather than a plain cancelled flag: a run only ever
  // touches show/hide and removes its own pointerdown listener if it's
  // still the CURRENT run when it finishes. Without that check, calling
  // this twice in quick succession (a double-click on #help-btn) could let
  // the older run's cleanup hide the newer run's fingers out from under it.
  const myGen = ++gestureDemoGen;
  const isCurrent = () => myGen === gestureDemoGen && is3DMode;

  const canvas = document.getElementById('babylon-canvas');
  let interrupted = false;
  const cancel = () => {
    if (myGen !== gestureDemoGen) return;
    gestureDemoGen++;
    interrupted = true;
    // Bumping the generation only stops the tween loop from updating the
    // fingers further - on its own that left them FROZEN wherever they
    // happened to be on the interrupting frame, visible indefinitely,
    // since nothing else was left to fade them out. A real drag means "I'm
    // taking over now" - dismiss immediately rather than leaving a stuck
    // ghost of the demo on screen.
    f1.style.transition = 'opacity 0.2s';
    f2.style.transition = 'opacity 0.2s';
    f1.style.opacity = '0';
    f2.style.opacity = '0';
  };
  cancelCurrentGestureDemo = cancel;
  if (canvas) canvas.addEventListener('pointerdown', cancel, { once: true });

  // Angled rather than axis-aligned, and reaching well past a literal
  // fingertip-sized nudge, so the swipe and the pinch both read clearly at
  // a glance instead of looking like a twitch. The two gestures tilt in
  // different directions so they're visually distinct from each other, not
  // just two motions along the same line. Each icon is rotated to face
  // along its own gesture's angle (pointerRotationFor), rather than sitting
  // upright regardless of where it's actually headed.
  const ORBIT_ANGLE_DEG = -26;
  const ORBIT_ANGLE = ORBIT_ANGLE_DEG * Math.PI / 180;
  const ORBIT_UX = Math.cos(ORBIT_ANGLE), ORBIT_UY = Math.sin(ORBIT_ANGLE);
  const ORBIT_DIST = 88;
  // The finger has to swipe in the OPPOSITE direction from camera3D.alpha/
  // beta's own +ORBIT_UX/+ORBIT_UY increase below - that's just how a real
  // drag maps to orbit here (verified against real dragging, left alone).
  // Showing the finger travelling the SAME way as alpha/beta increase was
  // demonstrating the reverse of what an actual drag needs, even though the
  // camera motion it played back was itself correct. +180 keeps the icon
  // pointing the way it's now actually travelling.
  const ORBIT_ROT = pointerRotationFor(ORBIT_ANGLE_DEG + 180);

  const PINCH_ANGLE_DEG = 38;
  const PINCH_ANGLE = PINCH_ANGLE_DEG * Math.PI / 180;
  const PINCH_UX = Math.cos(PINCH_ANGLE), PINCH_UY = Math.sin(PINCH_ANGLE);
  const PINCH_MIN = 20, PINCH_MAX = 96;
  // The two pinch fingers point outward, away from each other, along the
  // same line they're spreading on - f2 along the pinch angle itself, f1
  // along its exact opposite.
  const PINCH_ROT_OUT = pointerRotationFor(PINCH_ANGLE_DEG);
  const PINCH_ROT_IN = pointerRotationFor(PINCH_ANGLE_DEG + 180);

  // Tracks each finger's last-set position so the "breathe" beats - which
  // pulse scale/opacity only - can hold position steady without needing to
  // know which phase came before.
  let pos1 = { dx: 0, dy: 0 }, pos2 = { dx: 0, dy: 0 };
  const place1 = (dx, dy) => { pos1 = { dx, dy }; };
  const place2 = (dx, dy) => { pos2 = { dx, dy }; };
  const materializeFinger = async (el, get, rotationDeg, delayMs) => {
    if (delayMs > 0) await tweenRaw(delayMs, isCurrent, () => {});
    await tweenRaw(360, isCurrent, (t) => {
      const p = get();
      setFinger(el, p.dx, p.dy, easeOutBack(t), Math.min(1, t * 1.3), rotationDeg);
    });
  };

  // MATERIALIZE: just the one finger that's about to do the orbit drag -
  // the second doesn't exist yet, since orbiting only ever takes one.
  place1(ORBIT_DIST * ORBIT_UX, ORBIT_DIST * ORBIT_UY);
  await materializeFinger(f1, () => pos1, ORBIT_ROT, 0);
  // A beat of stillness before the drag - a hand settling before it moves,
  // not motion for its own sake.
  await tweenRaw(160, isCurrent, () => {});

  const startAlpha = camera3D.alpha;
  const startBeta = camera3D.beta;
  const startRadius = camera3D.radius;
  // The swipe is diagonal, not horizontal, so the orbit it drives is split
  // the same way across both camera axes - alpha (the horizontal orbit)
  // gets the swipe's ORBIT_UX share, beta (tilting the view up over the top
  // or down under the bottom) gets its ORBIT_UY share - rather than only
  // ever spinning flat, which was the actual bug being fixed here: the
  // demo showed a purely horizontal orbit no matter how the swipe was
  // angled. Clamped to the camera's own configured tilt limits.
  const ORBIT_ROT_BUDGET = 0.5;
  const lowerBeta = camera3D.lowerBetaLimit != null ? camera3D.lowerBetaLimit : 0.05;
  const upperBeta = camera3D.upperBetaLimit != null ? camera3D.upperBetaLimit : Math.PI - 0.05;
  const clampBeta = (b) => Math.max(lowerBeta, Math.min(upperBeta, b));

  if (isCurrent()) {
    // ORBIT: one finger swipes along a diagonal while the camera actually
    // orbits AND tilts by that same amount, in step - proof it can be
    // explored from above and below, not just spun flat.
    await tweenRaw(900, isCurrent, (t) => {
      const e = easeInOutSine(t);
      camera3D.alpha = startAlpha + e * ORBIT_ROT_BUDGET * ORBIT_UX;
      camera3D.beta = clampBeta(startBeta + e * ORBIT_ROT_BUDGET * ORBIT_UY);
      const d = ORBIT_DIST - e * (2 * ORBIT_DIST);
      const dx = d * ORBIT_UX, dy = d * ORBIT_UY;
      place1(dx, dy);
      setFinger(f1, dx, dy, 1, 1, ORBIT_ROT);
    });
    // The turnaround "breathe" - a soft press-and-release right where a
    // real fingertip would pause before pulling back, position held steady.
    await tweenRaw(260, isCurrent, (t) => {
      const s = 1 + 0.08 * Math.sin(t * Math.PI);
      setFinger(f1, pos1.dx, pos1.dy, s, 1, ORBIT_ROT);
    });
    await tweenRaw(900, isCurrent, (t) => {
      const e = easeInOutSine(t);
      camera3D.alpha = startAlpha + ORBIT_ROT_BUDGET * ORBIT_UX * (1 - e);
      camera3D.beta = clampBeta(startBeta + ORBIT_ROT_BUDGET * ORBIT_UY * (1 - e));
      const d = -ORBIT_DIST + e * (2 * ORBIT_DIST);
      const dx = d * ORBIT_UX, dy = d * ORBIT_UY;
      place1(dx, dy);
      setFinger(f1, dx, dy, 1, 1, ORBIT_ROT);
    });
  }

  if (isCurrent()) {
    // TRANSITION: the orbit finger settles onto one end of the pinch's
    // diagonal - rotating to face that new direction along the way rather
    // than snapping - while a second finger materializes at the other end,
    // already facing outward. One finger becoming two, forming the pair
    // for an actual pinch rather than it just appearing.
    const startDx1 = pos1.dx, startDy1 = pos1.dy;
    const targetDx1 = -PINCH_MIN * PINCH_UX, targetDy1 = -PINCH_MIN * PINCH_UY;
    place2(PINCH_MIN * PINCH_UX, PINCH_MIN * PINCH_UY);
    await Promise.all([
      tweenRaw(320, isCurrent, (t) => {
        const e = easeInOutSine(t);
        const dx = startDx1 + (targetDx1 - startDx1) * e;
        const dy = startDy1 + (targetDy1 - startDy1) * e;
        const rot = lerpAngleDeg(ORBIT_ROT, PINCH_ROT_IN, e);
        place1(dx, dy);
        setFinger(f1, dx, dy, 1, 1, rot);
      }),
      (async () => {
        await tweenRaw(140, isCurrent, () => {});
        await materializeFinger(f2, () => pos2, PINCH_ROT_OUT, 0);
      })(),
    ]);
  }

  if (isCurrent()) {
    // PINCH: two fingers spread apart along a diagonal (zoom in) then
    // pinch back together (zoom out), while the camera actually zooms in
    // step - the gesture that actually controls zoom, not a stand-in.
    const lower = camera3D.lowerRadiusLimit || 1;
    const zoomedRadius = Math.max(startRadius * 0.72, lower);
    await tweenRaw(700, isCurrent, (t) => {
      const e = easeInOutSine(t);
      camera3D.radius = startRadius + (zoomedRadius - startRadius) * e;
      const d = PINCH_MIN + e * (PINCH_MAX - PINCH_MIN);
      const dx = d * PINCH_UX, dy = d * PINCH_UY;
      place1(-dx, -dy);
      place2(dx, dy);
      setFinger(f1, -dx, -dy, 1, 1, PINCH_ROT_IN);
      setFinger(f2, dx, dy, 1, 1, PINCH_ROT_OUT);
    });
    await tweenRaw(260, isCurrent, (t) => {
      const s = 1 + 0.08 * Math.sin(t * Math.PI);
      setFinger(f1, pos1.dx, pos1.dy, s, 1, PINCH_ROT_IN);
      setFinger(f2, pos2.dx, pos2.dy, s, 1, PINCH_ROT_OUT);
    });
    await tweenRaw(700, isCurrent, (t) => {
      const e = easeInOutSine(t);
      camera3D.radius = zoomedRadius + (startRadius - zoomedRadius) * e;
      const d = PINCH_MAX - e * (PINCH_MAX - PINCH_MIN);
      const dx = d * PINCH_UX, dy = d * PINCH_UY;
      place1(-dx, -dy);
      place2(dx, dy);
      setFinger(f1, -dx, -dy, 1, 1, PINCH_ROT_IN);
      setFinger(f2, dx, dy, 1, 1, PINCH_ROT_OUT);
    });
  }

  if (isCurrent()) {
    // DEMATERIALIZE: both fingers lift away with the same weight they
    // arrived with, staggered so it reads as two hands lifting, not one
    // shape vanishing.
    const dematerializeFinger = async (el, get, rotationDeg, delayMs) => {
      if (delayMs > 0) await tweenRaw(delayMs, isCurrent, () => {});
      await tweenRaw(320, isCurrent, (t) => {
        const e = easeInOutSine(t);
        const p = get();
        setFinger(el, p.dx, p.dy, 1 - 0.3 * e, 1 - e, rotationDeg);
      });
    };
    await Promise.all([
      dematerializeFinger(f1, () => pos1, PINCH_ROT_IN, 60),
      dematerializeFinger(f2, () => pos2, PINCH_ROT_OUT, 0),
    ]);
  }

  if (canvas) canvas.removeEventListener('pointerdown', cancel);
  if (cancelCurrentGestureDemo === cancel) cancelCurrentGestureDemo = null;
  return !interrupted;
}

// The button-label walkthrough used to fire on its own independent timer
// and pile on top of the gesture demo above the bar; this plays them as
// one sequence instead. Used both for the real first entry (mobile only -
// isReplay is false/omitted, so it stays gated behind isCoarse the same as
// it always was; desktop has hover for that) and for #help-btn's replay
// (isReplay true), which runs on ANY device - someone who explicitly asked
// to see it again should get it even with a mouse.
function play3DIntroSequence(isReplay) {
  const isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const wantsBarSweep = (isReplay || isCoarse) && typeof window.replayBarPreviews === 'function';
  // Chained off the ACTUAL end of the finger demo (previously a fixed
  // 5200ms timer racing independently) - "all elements of the demo must
  // disappear if it's interrupted" means an interrupted finger demo has to
  // cancel the button-label walkthrough too, not leave it to fire moments
  // later as though the user hadn't already grabbed the camera. completed
  // is false both when the user interrupted it and when there was nothing
  // to show in the first place (see playGestureDemo's own early returns).
  playGestureDemo().then((completed) => {
    if (!completed || !is3DMode || !wantsBarSweep) return;
    window.replayBarPreviews();
    // Second half of the same interruption contract: a drag/tap that lands
    // DURING the label sweep itself (playGestureDemo's own cancel only
    // covers the finger phase, already finished by now) must cancel it too.
    const canvas = document.getElementById('babylon-canvas');
    if (!canvas || typeof window.cancelBarFlash !== 'function') return;
    const cancelSweep = () => window.cancelBarFlash();
    canvas.addEventListener('pointerdown', cancelSweep, { once: true });
    // 1s/button (walkBarPreviews' own STEP_MS) - drop the listener once the
    // sweep has naturally finished so a later, unrelated tap doesn't call
    // cancelBarFlash() for no reason.
    const btnCount = document.querySelectorAll('#bottom-bar button[data-tip]').length;
    setTimeout(() => canvas.removeEventListener('pointerdown', cancelSweep), (btnCount + 1) * 1000);
  });
}

// #help-btn: "show me the messages again", any time. In 3D that's the full
// intro sequence (ignoring whether it already played once); in 2D it's the
// same draw demo + button-label walkthrough the canvas shows on its own
// first appearance (window.triggerFirstCanvasHints, index3D.html), not the
// palette/3D hint toasts - those are contextual nudges tied to how much has
// actually been drawn, not a "how does this work" tour.
window.replayHelp = function () {
  if (is3DMode) {
    play3DIntroSequence(true);
    return;
  }
  if (typeof window.triggerFirstCanvasHints === 'function') window.triggerFirstCanvasHints();
};

function initBabylon3D() {
  console.log('Initializing Babylon 3D system...');

  const toggleBtn = document.getElementById('mode-toggle-btn');

  if (!toggleBtn) {
    console.error('Mode toggle button not found');
    return;
  }

  // Gated on actually having something to look at - see
  // window.updateElementCount (index3D.html), which flips toggleBtn's
  // disabled state live as totalElementsCreated changes (creation, undo,
  // reset). "At least one shape must be drawn to go into 3D mode."

  toggleBtn.addEventListener('click', () => {
    // Once it's actually been used, it no longer needs to draw the eye.
    toggleBtn.classList.add('pulse-done');
    if (!is3DMode) {
      activate3DMode();
    } else {
      deactivate3DMode();
    }
  });

  // ESC to exit 3D mode
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && is3DMode) {
      deactivate3DMode();
    }
  });
}

function activate3DMode() {
  console.log('Activating 3D mode...');

  // The 2D screen's own first-appearance button-label sweep may still be
  // mid-flight (it can run for several seconds) - without cancelling it
  // here, a leftover timer from THAT sweep can still land on a button
  // visible in both modes (fullscreen, help) and flash it over whatever
  // 3D shows next.
  if (typeof window.cancelBarFlash === 'function') window.cancelBarFlash();

  // Get or create Babylon canvas
  let canvas = document.getElementById('babylon-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'babylon-canvas';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
  }
  
  // Babylon canvas stays INVISIBLE for now (see the executeWhenReady gate
  // below, right before is3DMode flips) - only its stacking is set up
  // here. P5's input is disabled immediately either way (nothing should
  // still draw new shapes once 3D is on its way in), but its CANVAS stays
  // up and visible a little longer, so there's a live frame on screen
  // throughout instead of a blank gap while Babylon gets ready.
  //
  // display:block (not the CSS default display:none) + visibility:hidden,
  // deliberately NOT display:none, despite both looking identical to the
  // user - display:none removes the canvas from layout entirely, and a
  // canvas with no layout box reports clientWidth/clientHeight as 0. The
  // engine's own hardware-scaling-level resize (right below) computes its
  // target buffer size FROM clientWidth/clientHeight, so hiding it that way
  // made every resize() during setup compute 0 and silently keep whatever
  // stale size the canvas already had - permanently undoing the >1x device-
  // pixel-ratio supersampling this whole block exists to apply, on every
  // single 3D entry. visibility:hidden keeps the canvas fully painted-out
  // (and non-interactive) while still occupying real, measurable layout.
  canvas.style.display = 'block';
  canvas.style.visibility = 'hidden';
  canvas.style.zIndex = '10'; // Put Babylon on top once it's shown

  const p5Canvas = document.querySelector('canvas');
  if (p5Canvas && p5Canvas.id !== 'babylon-canvas') {
    p5Canvas.style.pointerEvents = 'none'; // Disable P5 input
    console.log('P5 input disabled');
  }

  // Create Babylon engine and scene
  if (!babylonEngine) {
    // Fill the viewport and render at native device resolution - without
    // this, phones render at CSS pixels and the 3D view looks noticeably
    // blurrier than the 2D one. Capped at 3x, not the 2D sketch's own 2x
    // (that cap is about ITS multiple full-resolution offscreen p5 layers -
    // finalBgLayer/lineLayer/foregroundLayer/fadeLayer - getting expensive
    // fast at higher densities, a constraint this single WebGL canvas
    // doesn't share). Most current phones (the entire iPhone line included)
    // report devicePixelRatio 3, and a 2x cap there means the actual render
    // buffer is only 2/3 of the screen's real resolution - the browser then
    // has to upscale it to fill the physical display, which reads as
    // legitimately lower-res 3D than the same phone's own 2D view, and
    // softer than a desktop hitting its own (usually <=2) devicePixelRatio
    // with room to spare under this cap.
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    babylonEngine = new BABYLON.Engine(canvas, true);
    babylonEngine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 3));
    babylonEngine.resize();
    babylonScene = createBabylonScene(canvas);

    // Render loop
    babylonEngine.runRenderLoop(() => {
      if (babylonScene && is3DMode) {
        babylonScene.render();
      }
    });
    
    // Resize
    window.addEventListener('resize', () => {
      if (babylonEngine) {
        babylonEngine.resize();
      }
    });
  }
  
  // Convert P5 shapes to 3D - but only if there's actually something new
  // to show. The scene/meshes already persist across a 2D<->3D round trip
  // (deactivate3DMode only hides the canvas, never disposes anything), so
  // re-running this unconditionally on every re-entry was throwing away
  // and rebuilding an identical scene - struts included - purely because
  // the user looked away and back, not because anything changed. Only a
  // real change earns a rebuild: nothing built yet (first entry this
  // visit), or the element count differs from the last build (new shapes
  // drawn/undone in 2D, or a scramble toggle's own rebuild - see
  // lastBuild3DElementCount's own comment for why that one's covered too).
  let currentElementCount = null;
  if (typeof window.getCompositionProgress === 'function') {
    try { currentElementCount = window.getCompositionProgress().created; } catch (e) {}
  }
  const needsRebuild = lastBuild3DElementCount === null || currentElementCount !== lastBuild3DElementCount;
  let strutGrowthDone = Promise.resolve();
  if (needsRebuild) {
    convertShapesTo3D();
    strutGrowthDone = animateStrutGrowth(1500);
  } else {
    console.log('3D scene unchanged since last build - reusing it as-is, no rebuild');
  }

  // NOTE: the p5 draw loop is intentionally left running (not noLoop()'d)
  // while in 3D. New-shape creation is blocked separately (isUiEvent() in
  // sketchdesktopreset.js bails out of handleDrag() while is3DMode is true),
  // but existing in-progress growth animations keep advancing in real time
  // so 2D doesn't "resume" a stale animation when you come back to it.
  is3DMode = true;

  // Lets the 2D-only chrome (the palette button and its hint) hide itself -
  // the palette only affects newly drawn 2D elements, so it has nothing to
  // do while the 3D view is up.
  document.body.classList.add('in-3d');

  // Update button
  const toggleBtn = document.getElementById('mode-toggle-btn');
  toggleBtn.textContent = '2D';
  toggleBtn.dataset.tip = 'Back to the canvas'; // hover label tracks what the button now does

  // There's a real mesh to export now - the export button starts disabled
  // (see isBabylonSceneReady) since there's nothing to export before this.
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn && typeof window.isBabylonSceneReady === 'function') {
    exportBtn.disabled = !window.isBabylonSceneReady();
  }

  // Only NOW actually reveal the canvas - once every material's shader is
  // genuinely compiled and every texture ready, not the instant the meshes
  // exist. Babylon compiles shaders asynchronously (KHR_parallel_shader_
  // compile): a material with no compiled effect yet simply isn't drawn
  // for a frame rather than blocking, so showing the canvas immediately
  // after convertShapesTo3D() meant the render loop's first several frames
  // could each be missing whichever materials hadn't finished compiling -
  // cheap unlit skeleton/wire materials first, the heavier lit+shadowed
  // shape/base materials a beat later once their more complex shaders
  // caught up. Slow enough on a phone GPU to see as "the skeleton shows,
  // then the rest fills in ~0.25s later." executeWhenReady is the same
  // fix already used for the skybox screenshot capture (see
  // renderSphereBackgroundTo2D) - waiting for it here means the very first
  // frame the user ever sees already has everything in it, every time this
  // runs (re-entering 3D rebuilds fresh materials too, not just the first
  // visit ever).
  babylonScene.executeWhenReady(() => {
    canvas.style.visibility = 'visible'; // see the visibility (not display) note above
    if (p5Canvas && p5Canvas.id !== 'babylon-canvas') p5Canvas.style.display = 'none';
  });

  // First time 3D actually becomes usable this visit: play the onboarding
  // sequence (gesture demo, then the button-label sweep). Every later entry
  // is silent - #help-btn is there if it's wanted again. Waits for the
  // struts to actually finish drawing themselves in first - starting the
  // demo while they're still growing meant the gesture animation and the
  // struts were both fighting for attention on screen at once.
  if (!firstEntry3DHintsShown) {
    firstEntry3DHintsShown = true;
    strutGrowthDone.then(() => play3DIntroSequence());
  }

  // "View Now in AR" - nudges iPhone users toward the AR button once
  // they've had a moment to actually look around in 3D. ar-capable is set
  // once, at page load (see index3D.html's arFab wiring), so it's already
  // correct here regardless of which visit this is. Timer, not tied to
  // strutGrowthDone/the intro sequence - AR is a separate, always-available
  // feature, not part of the onboarding walkthrough, so it shouldn't wait
  // on (or race) that sequence.
  if (!arHintShown && document.body.classList.contains('ar-capable')) {
    clearTimeout(arHintTimer);
    arHintTimer = setTimeout(() => {
      if (!is3DMode || arHintShown) return; // left 3D, or already dismissed via the AR button itself
      arHintShown = true;
      if (typeof window.showArToast === 'function') window.showArToast();
    }, AR_HINT_DELAY_MS);
  }

  console.log('3D mode activated!');
}

// Exposed so #ar-btn's own click handler (index3D.html) can mark the hint
// "seen" the moment someone actually finds and uses the button - whether or
// not the timer above ever got to show it.
window.markArHintSeen = function () {
  arHintShown = true;
  clearTimeout(arHintTimer);
  if (typeof window.hideArToast === 'function') window.hideArToast();
};

function deactivate3DMode() {
  console.log('Deactivating 3D mode...');
  clearTimeout(arHintTimer);
  if (typeof window.hideArToast === 'function') window.hideArToast();

  // Same reasoning as activate3DMode's own call - the 3D sweep might still
  // be mid-flight if the user backs out quickly.
  if (typeof window.cancelBarFlash === 'function') window.cancelBarFlash();
  // And the OTHER half of the same intro - the gesture demo's own cancel
  // only used to be reachable via a pointerdown on #babylon-canvas, so
  // backing out through the "2D" button skipped it: the fingers were left
  // frozen (full opacity, mid-transform) behind #gesture-hint's own
  // body:not(.in-3d) display:none, then reappeared exactly where they'd
  // frozen the moment 3D was re-entered.
  if (cancelCurrentGestureDemo) cancelCurrentGestureDemo();

  // Hide Babylon canvas, show P5 canvas
  const canvas = document.getElementById('babylon-canvas');
  if (canvas) {
    canvas.style.display = 'none';
    canvas.style.zIndex = '0';
  }
  
  const p5Canvas = document.querySelector('canvas');
  if (p5Canvas && p5Canvas.id !== 'babylon-canvas') {
    p5Canvas.style.display = 'block';
    p5Canvas.style.pointerEvents = 'auto'; // Re-enable P5 input
    console.log('P5 canvas shown and input enabled');
  }
  
  is3DMode = false;
  document.body.classList.remove('in-3d');

  // Update button
  const toggleBtn = document.getElementById('mode-toggle-btn');
  toggleBtn.textContent = '3D';
  toggleBtn.dataset.tip = '3D View';

  console.log('Returned to 2D mode');
}

function createBabylonScene(canvas) {
  const scene = new BABYLON.Scene(babylonEngine);

  // Order-independent transparency (dual depth peeling) was tried here -
  // correct in theory for this scene's deliberately overlapping translucent
  // shapes, but in practice it caused more damage than the "poking through"
  // glitch it was meant to fix: framerate dropped badly, then geometry
  // started disappearing outright - not just the lattice divider (three
  // different approaches, including a version built from geometrically
  // DISJOINT meshes that cannot possibly lose a depth-sort race, still
  // didn't render), but concentricArc's nested rings and a concentricCircle
  // halo's outline too - shapes this session never touched. That combination
  // (a disjoint mesh failing to render + unrelated shapes breaking at the
  // same time) points at the depth-peeling pipeline itself misbehaving with
  // this scene's material setup, not any individual shape's geometry - and
  // Babylon's own docs mark OIT as beta with known rough edges. Reverted;
  // the standard alpha-blend path's occasional mesh-order ambiguity from an
  // oblique angle is a much smaller problem than shapes vanishing outright.

  // Capture P5 canvas as background texture
  captureP5Background(scene);
  
  // Paper base wash color (identical to the texture borders, so any hairline
  // gap between skybox faces is invisible)
  scene.clearColor = new BABYLON.Color4(229 / 255, 214 / 255, 184 / 255, 1);
  
  // Camera - ORBITS a fixed target at the center of the sculpture, matching
  // the 2D view exactly on entry. Babylon's ArcRotateCamera gives us the
  // whole requested control scheme for free via its default pointer input:
  // drag (mouse OR one-finger touch) in any direction revolves around the
  // target at a constant radius, and mouse wheel / two-finger pinch both
  // change that radius (zoom) - no custom input plumbing needed.
  camera3D = new BABYLON.ArcRotateCamera(
    "camera", -Math.PI / 2, Math.PI / 2, 50, new BABYLON.Vector3(0, 0, 0), scene
  );
  camera3D.fov = 0.45; // Narrow FOV to avoid fisheye distortion
  camera3D.attachControl(canvas, true);
  camera3D.maxZ = 5000; // Far clip - keep shapes visible when zoomed far out (also raised dynamically per-composition, see convertShapesTo3D's camera framing)
  camera3D.minZ = 0.5; // Near clip - a WebGL depth buffer's precision is dominated by the maxZ/minZ RATIO, not either value alone; too-small a minZ (the default) spreads precision worthlessly thin near the camera and starves it everywhere farther out
  // Standard fix for z-fighting across a wide range of viewing distances -
  // a plain depth buffer allocates precision non-linearly (most of it
  // wasted very close to the camera), so two large, nearly-coplanar
  // surfaces (e.g. a concentricCircle's outer ring sitting close in front
  // of a big rect behind it - both legitimately non-overlapping, just with
  // a thin real gap) can still flicker/interleave once the camera sits
  // more than a few hundred units out, which now happens routinely since
  // upperRadiusLimit was raised to fit wide, unrearranged compositions.
  // Briefly swapped for `engine.useReverseDepthBuffer` to avoid a conflict
  // with order-independent transparency's multi-pass depth reads, but OIT
  // was reverted entirely (caused worse problems than it solved), so that
  // reasoning no longer applies - back to this, the original, proven setting.
  camera3D.useLogarithmicDepth = true;

  // Orbit-only: no panning, so drag/swipe can never drift the target off
  // the sculpture's center - it only ever revolves around it.
  camera3D.panningSensibility = 0;
  // Keep the orbit above/below the poles (prevents the view flipping
  // upside-down if a drag pushes straight over the top or bottom)
  camera3D.lowerBetaLimit = 0.05;
  camera3D.upperBetaLimit = Math.PI - 0.05;
  // Zoom range: close enough to inspect detail, far enough to see the
  // whole piece, but never so close/far the framing breaks down
  camera3D.lowerRadiusLimit = 5;
  camera3D.upperRadiusLimit = 2000;
  camera3D.wheelPrecision = 3; // mouse wheel zoom speed
  camera3D.angularSensibilityX = 2000; // drag/swipe orbit speed (lower = faster)
  camera3D.angularSensibilityY = 2000;
  camera3D.inertia = 0.9; // brief natural glide after a drag/flick, then settles

  // PINCH ZOOM: fed through Babylon's REAL movement/zoom system
  // (camera.movement.zoomAccumulatedPixels) - confirmed by reading the
  // actual loaded engine source (this CDN build is a much newer Babylon
  // than the classic inertialRadiusOffset-based API most docs/examples
  // describe): ArcRotateCamera._applyRotationAndZoomDelta does
  // `radius -= zoomDeltaCurrentFrame` every frame, where that delta is a
  // physically-based, frame-rate-independent velocity computed FROM
  // zoomAccumulatedPixels and decayed by camera.movement.zoomInertia - i.e.
  // positive zoomAccumulatedPixels = zoom IN, and it already has its own
  // real momentum system built in. Earlier attempts hand-rolled a parallel
  // velocity/decay loop on the side, which only reached the camera through
  // an inconsistent legacy compatibility shim (a getter/setter pair on
  // camera.inertialRadiusOffset that doesn't reliably route through this
  // same system) - using the real mechanism directly is both simpler and
  // actually correct.
  camera3D.movement.zoomInertia = 0.95; // longer coast than drag/orbit's camera3D.inertia (0.9) above - set AFTER it, since that setter would otherwise overwrite this to match
  function addZoomInput(pixels) {
    camera3D.movement.activeInput = true;
    camera3D.movement.zoomAccumulatedPixels += pixels;
  }

  // PER-GESTURE ZOOM CAP: the radius-proportional sensitivity below is
  // largest exactly when furthest out, and zoomInertia's momentum keeps
  // coasting after release - together a single vigorous pinch/flick
  // starting at the far limit could build up enough velocity to sail all
  // the way to the near limit in one continuous motion. Rather than
  // weakening the feel for normal gestures, clamp how far ONE gesture
  // (including its post-release coast) is allowed to move the camera,
  // relative to wherever that gesture started - startZoomGesture() is
  // called when a new pinch/wheel gesture begins, below.
  const MAX_ZOOM_FACTOR_PER_GESTURE = 8; // one gesture can change radius by up to this multiple, not the full lower/upper range
  const GESTURE_COAST_CLEAR_MS = 2000; // matches roughly how long zoomInertia's momentum takes to settle
  let gestureMinRadius = null, gestureMaxRadius = null, gestureClearTimer = null;
  function startZoomGesture() {
    clearTimeout(gestureClearTimer);
    const r = camera3D.radius;
    gestureMinRadius = Math.max(camera3D.lowerRadiusLimit, r / MAX_ZOOM_FACTOR_PER_GESTURE);
    gestureMaxRadius = Math.min(camera3D.upperRadiusLimit, r * MAX_ZOOM_FACTOR_PER_GESTURE);
  }
  function scheduleZoomGestureClear() {
    clearTimeout(gestureClearTimer);
    gestureClearTimer = setTimeout(() => {
      gestureMinRadius = null;
      gestureMaxRadius = null;
    }, GESTURE_COAST_CLEAR_MS);
  }
  scene.onBeforeRenderObservable.add(() => {
    if (gestureMinRadius === null) return;
    if (camera3D.radius < gestureMinRadius) {
      camera3D.radius = gestureMinRadius;
      camera3D.movement.resetZoomVelocity();
    } else if (camera3D.radius > gestureMaxRadius) {
      camera3D.radius = gestureMaxRadius;
      camera3D.movement.resetZoomVelocity();
    }
  });

  // TOUCH PINCH: driven ourselves instead of Babylon's built-in multi-touch
  // handling. Its default pinch divides raw finger-distance pixels by
  // (pinchPrecision * average angularSensibility / 2) - at our
  // angularSensibility of 2000 that's a huge divisor, so a real pinch barely
  // moves the radius, reading as disconnected from the gesture. Neutralize
  // its contribution and feed the real zoom system above from our own
  // pinch-distance-ratio calculation instead, scaled to feel powerful
  // ("fly" in/out), with a floor on the radius-proportional scale so it
  // doesn't go anemic once already zoomed in close.
  camera3D.pinchPrecision = 1e6;
  const PINCH_ZOOM_SENSITIVITY = 0.15;
  const pinchTouches = new Map();
  let pinchStartDist = null;
  const pinchDist = () => {
    const [a, b] = [...pinchTouches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    pinchTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchTouches.size === 2) {
      pinchStartDist = pinchDist();
      startZoomGesture();
    } else {
      pinchStartDist = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pinchTouches.has(e.pointerId)) return;
    pinchTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchTouches.size !== 2) return;
    const d = pinchDist();
    if (pinchStartDist) {
      // Fingers spreading (d > start) = zoom in = positive input
      const radiusScale = Math.max(camera3D.radius, 40) / 300;
      addZoomInput((d - pinchStartDist) * PINCH_ZOOM_SENSITIVITY * radiusScale);
    }
    pinchStartDist = d;
  });
  const endPinch = (e) => {
    if (!pinchTouches.delete(e.pointerId)) return;
    pinchStartDist = pinchTouches.size === 2 ? pinchDist() : null;
    if (pinchTouches.size < 2) scheduleZoomGestureClear();
  };
  canvas.addEventListener('pointerup', endPinch);
  canvas.addEventListener('pointercancel', endPinch);

  // TRACKPAD PINCH (Chrome/Firefox): these engines report a trackpad pinch
  // as a 'wheel' event with ctrlKey set (no separate pinch event exists on
  // them). Replicates Babylon's own wheel-to-zoom formula directly (now
  // confirmed from source: pixels = -deltaY / (40*wheelPrecision), positive
  // = zoom in) rather than routing through Babylon's own handler, then
  // scales it up - its natural per-tick magnitude is tuned for a mouse
  // wheel's ~100-unit clicks, small next to a trackpad pinch's finer
  // deltas. A previous version ALSO multiplied by gesture speed on top of
  // this, which double-counted it (deltaY itself already scales with
  // gesture speed) and made fast flicks overshoot - kept here as just a
  // light edge, not the dominant factor. Captured on `document` so it can
  // preventDefault before Chrome/Firefox's native page-zoom reaction to it.
  const TRACKPAD_PINCH_BOOST = 30;
  let lastTrackpadPinchTime = 0;
  document.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    // Still block the browser's native page-zoom above (matching the page-
    // wide pinch hard-block in index3D.html), but never feed the 3D camera
    // while 2D mode is showing - this listener lives on `document`, so
    // without this a trackpad pinch in 2D mode silently moved the hidden
    // camera's radius behind the user's back.
    if (!is3DMode) return;

    const scaledDeltaY = e.deltaY * (e.deltaMode === 1 ? 40 : 1); // DOM_DELTA_LINE
    const naturalPixels = -scaledDeltaY / (40 * camera3D.wheelPrecision);

    const now = performance.now();
    const rawGap = now - lastTrackpadPinchTime;
    lastTrackpadPinchTime = now;
    // A real trackpad pinch fires these every ~16-30ms; a gap bigger than
    // that means fingers lifted and this is a fresh gesture - same per-
    // gesture zoom cap as touch pinch above.
    if (gestureMinRadius === null || rawGap > 400) startZoomGesture();
    const dt = Math.max(1, rawGap);
    const speed = Math.abs(e.deltaY) / dt; // roughly px of pinch motion per ms
    const boost = TRACKPAD_PINCH_BOOST * (1 + Math.min(speed * 0.5, 1));

    addZoomInput(naturalPixels * boost);
    scheduleZoomGestureClear();
  }, { passive: false, capture: true });

  // No lights: every material is unlit/emissive for exact 2D color match.
  // Adding lights would shift colors away from the 2D original.

  console.log('Babylon scene created');
  return scene;
}

// CUBE SKYBOX: 6 inward-facing planes around the viewer. The 4 side faces are
// adjacent square slices of ONE horizontally-tileable strip texture, so every
// side seam is continuous by construction (shared pixel columns) - no seams,
// no mirroring. Top/bottom are their own watercolor textures (same style), so
// there are no sphere poles and nothing stretches.
// Slice order rightward around the cube: left [0], front [1], right [2],
// back [3]; the back-left seam is the strip's wrap edge (tileable).
const SKY_BASE_RGB = [229, 214, 184]; // paper base wash fallback
function buildSkybox(scene) {
  const bigCanvas = (window.bigBgLayer || window.finalBgLayer || {}).canvas;
  if (!bigCanvas) {
    console.warn('Background layer not found');
    return null;
  }
  const capTop = window.bgCapTop && window.bgCapTop.canvas;
  const capBottom = window.bgCapBottom && window.bgCapBottom.canvas;
  const size = 1000, D = size / 2;
  const sliceW = bigCanvas.width / 4;
  // rot = [rotation.x, rotation.y] turning each plane's front toward the origin
  const faces = [
    { name: 'front',  pos: [0, 0, D],  rot: [0, 0],                src: 'slice', slice: 1 },
    { name: 'right',  pos: [D, 0, 0],  rot: [0, Math.PI / 2],      src: 'slice', slice: 2 },
    { name: 'back',   pos: [0, 0, -D], rot: [0, Math.PI],          src: 'slice', slice: 3 },
    { name: 'left',   pos: [-D, 0, 0], rot: [0, -Math.PI / 2],     src: 'slice', slice: 0 },
    { name: 'top',    pos: [0, D, 0],  rot: [-Math.PI / 2, 0],     src: 'cap', cap: capTop },
    { name: 'bottom', pos: [0, -D, 0], rot: [Math.PI / 2, 0],      src: 'cap', cap: capBottom },
  ];
  const root = new BABYLON.TransformNode('skyboxRoot', scene);
  for (const f of faces) {
    let srcCanvas, sx, sw, sh;
    if (f.src === 'slice') {
      srcCanvas = bigCanvas; sx = f.slice * sliceW; sw = sliceW; sh = bigCanvas.height;
    } else {
      srcCanvas = f.cap; sx = 0;
      sw = srcCanvas ? srcCanvas.width : 4; sh = srcCanvas ? srcCanvas.height : 4;
    }
    const tex = new BABYLON.DynamicTexture('skyTex_' + f.name, { width: sw, height: sh }, scene, false);
    const ctx = tex.getContext();
    if (srcCanvas) {
      ctx.drawImage(srcCanvas, sx, 0, sw, sh, 0, 0, sw, sh);
    } else {
      ctx.fillStyle = `rgb(${SKY_BASE_RGB[0]},${SKY_BASE_RGB[1]},${SKY_BASE_RGB[2]})`;
      ctx.fillRect(0, 0, sw, sh);
    }
    tex.update();
    tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    tex.updateSamplingMode(BABYLON.Texture.BILINEAR_SAMPLINGMODE);
    const mat = new BABYLON.StandardMaterial('skyMat_' + f.name, scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex; // Self-illuminated, exact 2D colors
    mat.disableLighting = true;
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    const plane = BABYLON.MeshBuilder.CreatePlane('skyFace_' + f.name, { size: size }, scene);
    plane.position.set(f.pos[0], f.pos[1], f.pos[2]);
    plane.rotation.x = f.rot[0];
    plane.rotation.y = f.rot[1];
    plane.material = mat;
    plane.isPickable = false;
    plane.parent = root;
  }
  return root;
}

function captureP5Background(scene) {
  const skybox = buildSkybox(scene);
  if (!skybox) return;

  // Make skybox follow camera so you can never reach it
  scene.registerBeforeRender(() => {
    if (camera3D && skybox) {
      skybox.position.copyFrom(camera3D.position);
    }
  });

  console.log('World background cube skybox created');
}

// Silently render the cube skybox and screenshot it. The 2D sketch uses this
// screenshot as its background, so entering 3D shows the IDENTICAL background
// (same skybox, same textures, same camera pose: looking at the front face).
function renderSphereBackgroundTo2D(targetLayer, bigCanvas, viewW, viewH, onReady) {
  if (typeof BABYLON === 'undefined') return false;
  try {
    const glCanvas = document.createElement('canvas');
    // Render at native device resolution (capped 2x) so the 2D background is
    // as sharp on phones as on desktop
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    glCanvas.width = viewW * dpr;
    glCanvas.height = viewH * dpr;
    const engine = new BABYLON.Engine(glCanvas, true, { preserveDrawingBuffer: true });
    // Force SYNCHRONOUS shader compilation: otherwise the first render skips
    // the skybox (material not ready yet) and the screenshot comes out black
    engine.getCaps().parallelShaderCompile = undefined;
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(229 / 255, 214 / 255, 184 / 255, 1); // base wash, never black
    // Same pose as 3D mode: camera at skybox center, looking +Z, same FOV
    const cam = new BABYLON.UniversalCamera('shotCam', new BABYLON.Vector3(0, 0, 0), scene);
    cam.setTarget(new BABYLON.Vector3(0, 0, 1));
    cam.fov = 0.45;
    if (!buildSkybox(scene)) {
      engine.dispose();
      return false;
    }
    // Wait until shaders/textures are genuinely ready, THEN capture.
    // (Racing the first render captured only the clear color.)
    scene.executeWhenReady(() => {
      scene.render();
      scene.render();
      targetLayer.drawingContext.drawImage(glCanvas, 0, 0, targetLayer.width, targetLayer.height);
      engine.dispose();
      console.log('2D background updated with skybox screenshot');
      if (typeof onReady === 'function') onReady();
    });
    return true; // caller draws a flat-crop placeholder until the capture lands
  } catch (e) {
    console.warn('Skybox background screenshot failed:', e);
    return false;
  }
}
window.renderSphereBackgroundTo2D = renderSphereBackgroundTo2D;

// ===== Scramble mode =====
// The 2D composition holds every shape parallel to the picture plane, so an
// orbit to the side shows only edges. Scramble tips each Tier-1 shape by
// SCRAMBLE_MIN_DEG..SCRAMBLE_MAX_DEG on X and then on Y (random sign each) -
// recognisably the same composition, with real faces visible from the side. The tilt is stored per NODE and
// composed into the same orientation quaternion the strut/anchor math reads
// (supportDistanceWorld and friends), so rebuilding the scene recomputes
// every strut, wire anchor and the base drop against the TILTED geometry -
// the supports genuinely support the new orientations rather than pointing
// at where the flat shapes used to be.
let scrambleMode = false;
// Per-axis tilt range in degrees. Each axis rolls independently in
// [MIN, MAX] with a random sign, so the combined tilt can reach a bit
// beyond MAX when both axes land high.
const SCRAMBLE_MIN_DEG = 1;
const SCRAMBLE_MAX_DEG = 33;
function rollScrambleQuat() {
  const tilt = () => (SCRAMBLE_MIN_DEG + Math.random() * (SCRAMBLE_MAX_DEG - SCRAMBLE_MIN_DEG))
    * (Math.PI / 180) * (Math.random() < 0.5 ? -1 : 1);
  return BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, tilt())
    .multiply(BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, tilt()));
}
window.getScrambleMode = function () { return scrambleMode; };

// Reads a Tier-1 shape's CURRENT orientation - whichever node actually
// carries it, a contact/scramble tilt's TransformNode if one exists, else
// the mesh's own plain Rz rotation - as a quaternion regardless of which
// form it's in, so captureShapeTransforms/animateShapeTransition never have
// to care which representation a shape happens to be using.
function shapeOrientationQuat(node) {
  return node.rotationQuaternion
    ? node.rotationQuaternion.clone()
    : BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, node.rotation ? node.rotation.z : 0);
}
// Every shape's root node, keyed by index, so a before/after pair from two
// different convertShapesTo3D() builds can be matched up. create3DShape
// wraps EVERY shape it creates (Tier-1 volumes and Tier-2 ornaments alike -
// circle/rect/triangle/semiCircle, concentricCircle/concentricArc, halo,
// squiggle/arc, open variants) in its own `tilt_${index}` TransformNode
// unconditionally, so keying off that node name alone finds every shape
// type's single consistent root - no need to fall back to a `shape_N` mesh
// name, which several shape types (concentricCircle, halo, ...) never had.
function shapeRootNodesByIndex() {
  const out = {};
  if (!babylonScene) return out;
  babylonScene.transformNodes.forEach(n => {
    const match = n.name.match(/^tilt_(\d+)$/);
    if (!match) return;
    out[match[1]] = n;
  });
  return out;
}
// Captures where every Tier-1 shape actually is RIGHT NOW, before a
// scramble rebuild tears it all down - convertShapesTo3D disposes and
// recreates every mesh from scratch, so without this there's nothing left
// to animate FROM once the new (target) meshes exist.
function captureShapeTransforms() {
  const roots = shapeRootNodesByIndex();
  const out = {};
  Object.keys(roots).forEach(idx => {
    const root = roots[idx];
    root.computeWorldMatrix(true);
    out[idx] = { pos: root.position.clone(), quat: shapeOrientationQuat(root) };
  });
  return out;
}
// Slides every shape from its captured OLD pose to wherever the just-
// completed rebuild actually placed it, instead of the rebuild's instant
// cut. The base and struts have no old pose to animate from (brand new
// geometry every rebuild) and are handled as their own later steps - see
// hideBaseAndStrutsImmediately/animateBaseReveal/animateStrutGrowth - kept
// invisible for the whole span here so nothing scaffolding-related pops in
// around the still-moving shapes.
async function animateShapeTransition(oldTransforms, durationMs) {
  if (!babylonScene) return;
  const gen = ++scrambleAnimGen;
  const isActive = () => gen === scrambleAnimGen && !!babylonScene;

  const roots = shapeRootNodesByIndex();
  const jobs = [];
  Object.keys(roots).forEach(idx => {
    const old = oldTransforms[idx];
    if (!old) return; // a shape that didn't exist in the old state - nothing to animate from, leave it as rebuilt
    const root = roots[idx];
    const newQuat = shapeOrientationQuat(root);
    const newPos = root.position.clone();
    root.rotationQuaternion = old.quat.clone(); // drives rendering from here on, in place of .rotation - lets both forms interpolate the same way
    root.position = old.pos.clone();
    jobs.push({ root, oldQuat: old.quat, newQuat, oldPos: old.pos, newPos });
  });
  if (jobs.length === 0) return;

  await tweenRaw(durationMs, isActive, (t) => {
    const e = easeInOutSine(t);
    jobs.forEach(({ root, oldQuat, newQuat, oldPos, newPos }) => {
      BABYLON.Quaternion.SlerpToRef(oldQuat, newQuat, e, root.rotationQuaternion);
      BABYLON.Vector3.LerpToRef(oldPos, newPos, e, root.position);
    });
  });
  if (!isActive()) return;
  jobs.forEach(({ root, newQuat, newPos }) => {
    root.rotationQuaternion = newQuat;
    root.position = newPos;
  });
}

// Every base/connector-dot mesh this rebuild just created, kept together
// since both the immediate hide and the later reveal always act on the
// same set.
function baseRevealMeshes() {
  if (!babylonScene) return [];
  // base_solid_*/base_outline_* only - NOT base_strutsupport_*/
  // base_reinforced_* (the struts, which also happen to start with "base_"
  // since they land ON it, but are their own separate reveal driven by
  // primeStrutGrowth/animateStrutGrowth). Sweeping struts into this fade
  // too meant their tiny primed stubs popped to full opacity right as the
  // base finished, then immediately started growing - reading as an extra,
  // unintended stage of its own right next to the base.
  return babylonScene.meshes.filter(m => /^(base_solid_|base_outline_|conndot_)/.test(m.name) && m.getTotalVertices() > 0);
}

// Called synchronously right after a rebuild, before the shape-transition
// tween even starts - the base is brand new geometry every rebuild (no old
// pose to animate from, like the shapes have), so without this it would
// just sit there fully visible for the whole time the shapes are still
// gliding into place. Zeroing it out here means the ONLY thing on screen
// while shapes move is the shapes themselves; animateBaseReveal (run once
// they've landed) is the first time it's seen as anything but invisible.
function hideBaseImmediately() {
  baseRevealMeshes().forEach(m => { m.visibility = 0; });
}

// Ramps the base in smoothly once the shapes have finished arriving -
// "tasteful, no quick jumping around" - a plain opacity fade rather than
// any position/scale change, since the base doesn't move, it just needs to
// stop being an instant on/off cut.
async function animateBaseReveal(durationMs = 500) {
  if (!babylonScene) return;
  const gen = ++baseRevealGen;
  const isActive = () => gen === baseRevealGen && !!babylonScene;
  const meshes = baseRevealMeshes();
  if (meshes.length === 0) return;
  await tweenRaw(durationMs, isActive, (t) => {
    const e = easeInOutSine(Math.max(0, Math.min(1, t)));
    meshes.forEach(m => { m.visibility = e; });
  });
  if (!isActive()) return;
  meshes.forEach(m => { m.visibility = 1; });
}

// Toggling rebuilds the whole 3D scene (convertShapesTo3D already tears down
// and reconstructs cleanly - it's the same path the 2D->3D toggle uses),
// then animates every shape from where it just was to where the rebuild put
// it, instead of the rebuild's instant cut. Each activation re-rolls the
// tilts: it is a scramble, not a pose.
window.setScrambleMode = function (on) {
  scrambleMode = !!on;
  if (!babylonScene) return;
  const oldTransforms = captureShapeTransforms();
  // preserveCamera: a scramble rebuilds every mesh from scratch, but the
  // user's own orbit/zoom into the composition shouldn't be thrown away
  // along with it - only the very first 2D->3D entry (activate3DMode)
  // wants the auto-fit that recentres and re-frames the camera.
  convertShapesTo3D(true);
  // Three sequential steps, each waiting for the last to actually finish -
  // "calculate the final positions, draw the base in tastefully, then
  // reveal the struts bottom-to-top" - rather than everything new this
  // rebuild made (base + struts, neither of which has an old pose to
  // animate from) just sitting fully built the instant convertShapesTo3D
  // returns. Both are zeroed out synchronously right here, before the
  // shape-transition tween below even starts, so the ONLY thing visible
  // while shapes are still gliding into place is the shapes themselves.
  primeStrutGrowth();
  hideBaseImmediately();
  animateShapeTransition(oldTransforms, 600)
    .then(() => animateBaseReveal(500))
    .then(() => animateStrutGrowth(1500));
};

function convertShapesTo3D(preserveCamera) {
  if (!babylonScene) {
    console.error('Babylon scene not ready');
    return;
  }
  // Recorded here (not at each individual call site) so every real build -
  // activate3DMode's own, setScrambleMode's, or any future caller - keeps
  // this in sync the same way. See lastBuild3DElementCount's own comment.
  if (typeof window.getCompositionProgress === 'function') {
    try { lastBuild3DElementCount = window.getCompositionProgress().created; } catch (e) {}
  }

  console.log('Converting shapes to 3D...');
  console.log('Window object keys:', Object.keys(window).filter(k => k.includes('skeleton') || k.includes('ornament') || k.includes('line')));
  
  // Clear existing meshes (everything except the sky)
  const meshesToRemove = babylonScene.meshes.filter(m =>
    /^(shape_|line_|bezier_|arcline_|spiral_|lattice|open_|outline_|halo|concentric|bridge_|base_|conndot_)/.test(m.name)
  );
  // dispose(false, true): also dispose each mesh's material AND its textures.
  // Every artwork mesh gets its own unlitMat (plus big DynamicTextures for
  // open shapes/halos), and a plain dispose() leaves all of those alive in
  // the scene - so every 2D->3D toggle leaked the whole previous scene's
  // materials/textures, same accumulation class as the tilt nodes below.
  // (Shared materials - e.g. an open shape's front/back planes - are fine:
  // both meshes are in this removal set and disposing twice is a no-op.)
  meshesToRemove.forEach(mesh => mesh.dispose(false, true));
  // Contact-tilt TransformNodes (create3DShape's `tilt_${index}`) are a
  // separate scene collection from meshes - disposing their child meshes
  // above does NOT dispose the parent node, so without this they'd
  // accumulate as orphaned nodes every time this function re-runs.
  const tiltNodesToRemove = babylonScene.transformNodes.filter(n => /^tilt_/.test(n.name));
  tiltNodesToRemove.forEach(node => node.dispose());
  // Every strut this build creates registers itself here (see
  // createSolidTube3D) so animateStrutGrowth can grow them all in from the
  // base afterward - a fresh build discards whatever a previous,
  // never-consumed queue still held (e.g. a rebuild triggered before the
  // last one's growth animation ran).
  strutGrowthQueue = [];
  // Bumped HERE, not just inside the next animateStrutGrowth() call - a
  // PREVIOUS build's growth tween can still be mid-flight (its own 1500ms
  // RAF loop, running off entries captured in a local variable, not this
  // queue) when a rebuild disposes the very tube meshes it's updating each
  // frame. That tween's isActive() check only looks at strutGrowGen, so
  // without bumping it right here - before the dispose() calls below run -
  // there's a window where the stale gen still matches and the tween's
  // next frame calls BABYLON.MeshBuilder.CreateTube(..., {instance: tube})
  // on an already-disposed tube, throwing deep in Babylon's internals
  // ("Cannot set properties of null"). Invalidating it before disposal
  // closes that window instead of just narrowing it.
  strutGrowGen++;
  // The base/strut materials just went with their meshes above - drop the
  // cached handles and the live-swap registries so this build makes new ones.
  resetSculptureMaterialRegistry();
  // Lights must exist before the first render of the materials built below -
  // a lit material with no lights in the scene renders black. Both calls are
  // idempotent, so re-entering 3D mode just re-asserts them.
  buildLightRig();
  syncSpotlightEnvironment();
  
  // Get shapes from P5 sketch - try multiple ways
  let shapes = [];
  let ornaments = [];
  let lines = [];
  let lattices = [];
  
  // Direct global access
  if (typeof window.skeletons !== 'undefined') {
    shapes = window.skeletons;
    console.log('✅ Found skeletons via window.skeletons');
  }
  if (typeof window.ornaments !== 'undefined') {
    ornaments = window.ornaments;
    console.log('✅ Found ornaments via window.ornaments');
  }
  // Lines/lattices: live anim arrays get SPLICED as animations complete,
  // so use the persistent sceneReport record instead (captures every element created)
  const report = window.sceneReport || {};
  lines = report.lines || [];
  const beziers = report.beziers || [];
  const arcLines = report.arcs || [];
  const spirals = report.spirals || [];
  
  // Rebuild lattice cells from persistent report (poly points + colors per cell)
  const latticeReports = report.lattices || [];
  lattices = latticeReports.map(rep => {
    const cells = [];
    const count = rep.cellCount || 0;
    const ptsPer = count > 0 ? rep.cellPolygonData.length / count : 0;
    for (let ci = 0; ci < count; ci++) {
      cells.push({
        poly: rep.cellPolygonData.slice(ci * ptsPer, (ci + 1) * ptsPer),
        col: rep.cellColors[ci]
      });
    }
    return { x: rep.x, y: rep.y, cells };
  });
  console.log('✅ Lines/lattices sourced from persistent sceneReport');
  
  console.log(`📊 Total found: ${shapes.length} skeletons, ${ornaments.length} ornaments, ${lines.length} lines, ${beziers.length} beziers, ${arcLines.length} arcs, ${spirals.length} spirals, ${lattices.length} lattices`);
  
  // Debug: Log first few shapes to see their structure
  if (shapes.length > 0) {
    console.log('🔍 First skeleton shape:', shapes[0]);
  }
  if (ornaments.length > 0) {
    console.log('🔍 First ornament shape:', ornaments[0]);
  }
  if (lines.length > 0) {
    console.log('🔍 First line:', lines[0]);
  }
  
  let totalConverted = 0;
  let conversionStats = {
    skeletons: 0,
    ornaments: 0,
    lines: 0,
    lattices: 0,
    failed: []
  };

  // Size the front/back draw-order split to the ACTUAL Tier-1 shape count
  // (skeletons + ornaments + lattices) specifically - NOT the full element
  // count including connectors. buildElementTree's Z-bias (the thing that
  // actually decides which shapes end up front vs back) only ever runs on
  // Tier-1 nodes, and those always get the LOWEST global indices (connectors
  // are indexed afterward - see the gather loops below). Normalizing against
  // the full total (previous fix) still miscalibrated the split point for
  // Tier-1 placement specifically: with connectors often outnumbering real
  // shapes, most or all Tier-1 indices could fall on the same side of
  // SPAN/2, biasing the whole shape population toward one depth regardless
  // of actual paint order - "still front heavy" even after the last fix.
  ELEMENT_ORDER_SPAN = Math.max(shapes.length + ornaments.length + lattices.length, 10);

  // ===== TIER 1: gather every element with a real bounding volume (both
  // skeletons, filled/open circle/rect/triangle/semiCircle ornaments,
  // concentricCircle, lattices), build the connected non-overlapping tree,
  // then create their meshes from the resolved positions. globalIndex is
  // unique across EVERY element in the whole scene (not per-array) so
  // synthesizedZBias() never collides between e.g. shapes[1] and
  // ornaments[1] - see buildElementTree/computeConnectorAnchor for why.
  let globalIndex = 0;
  const skeletonNodeFor = new Array(shapes.length).fill(null);
  const ornamentNodeFor = new Array(ornaments.length).fill(null);
  const latticeNodeFor = new Array(lattices.length).fill(null);
  const tier1Nodes = [];

  shapes.forEach((shape, i) => {
    const rad = shapeVolumeRadius3D(shape);
    if (!rad) return; // defensive - skeletons are always open rect/tri/semiCircle, always volumed
    const { x, y } = projectXY3D(shape);
    const node = { key: `skeleton ${i}`, globalIndex: globalIndex++, origX: x, origY: y, r: rad.r, zOffset: rad.zOffset, ...tier1ShapeFields(shape, rad) };
    skeletonNodeFor[i] = node;
    tier1Nodes.push(node);
  });
  ornaments.forEach((shape, i) => {
    const rad = shapeVolumeRadius3D(shape);
    if (!rad) return; // squiggle/arc - Tier 2, handled below (halo/concentricArc are real volume now, full Tier-1)
    const { x, y } = projectXY3D(shape);
    const node = { key: `ornament ${i}`, globalIndex: globalIndex++, origX: x, origY: y, r: rad.r, zOffset: rad.zOffset, ...tier1ShapeFields(shape, rad) };
    ornamentNodeFor[i] = node;
    tier1Nodes.push(node);
  });
  lattices.forEach((lattice, i) => {
    const rad = latticeVolumeRadius3D(lattice);
    if (!rad) return;
    const { x, y } = projectXY3D(lattice); // lattice.x/y are the same field names as shapes
    // Reclassified as a rect: a real box profile (4-corner polygon) instead
    // of the old plain-sphere stand-in, so the support-function geometry
    // agrees with what create3DLattice actually renders. zHalf uses HALF
    // the standard rect depth formula - "the entire ensemble should be
    // half as deep as a standard rect" - matching create3DLattice's own
    // per-cell extrusion depth exactly. shapeType stays 'lattice' (not
    // literally 'rect') only so computeContactTilt's fixed-aspect-ratio
    // rect formula (w=s, h=s*0.6) - dead code today since nothing tilts
    // anymore, but a latent footgun if that ever changes - never gets
    // applied to a lattice's real, independent w/h.
    const s = Math.max(rad.w, rad.h);
    const node = {
      key: `lattice ${i}`, globalIndex: globalIndex++, origX: x, origY: y, r: rad.r, zOffset: 0,
      shapeType: 'lattice', s, rotZ: rad.rotZ,
      localProfile: { kind: 'polygon', vertices: rad.corners }, // TRUE bounds relative to the anchor, not assumed-symmetric
      zHalf: Math.max(0.8, s * 0.12) / 4
    };
    latticeNodeFor[i] = node;
    tier1Nodes.push(node);
  });

  // The pedestal base is itself a Tier-1 participant now ("the base can be
  // another shape") - added AFTER every real shape/ornament/lattice is
  // gathered (so its size/position can be derived from them) but BEFORE
  // buildElementTree runs, so it goes through the exact same placement,
  // non-overlap, and contact-marking machinery as everything else.
  const baseNode = createBaseTier1Node(tier1Nodes);
  if (baseNode) tier1Nodes.push(baseNode);

  // Scramble tilts are rolled BEFORE placement so buildElementTree's own
  // overlap/floor checks (which read orientation through
  // supportDistanceWorld) already see the tilted extents. The base never
  // scrambles - it is the one thing that must stay flat on the ground.
  tier1Nodes.forEach(n => { n.scrambleQuat = (scrambleMode && !n.isBase) ? rollScrambleQuat() : null; });
  buildElementTree(tier1Nodes); // mutates every node's resolved x/y/z in place - x/y = origX/origY unchanged, only z is resolved
  console.log(`📐 Placed ${tier1Nodes.length} Tier-1 shape(s) at their exact original 2D positions, depth-only resolved`);

  // "Back the whole sculpture up" - the base's own Z lands wherever
  // buildElementTree happened to resolve it (typically ~0, since it's the
  // largest node and gets placed FIRST with nothing yet to react to), but
  // the shape cluster's real Z range (driven by the front/back draw-order
  // bias plus real occlusion-order constraints) tends to skew toward the
  // front rather than spreading symmetrically around that. The base's
  // circular footprint, centered on wherever its OWN Z landed, then only
  // covers about half the cluster's real depth - the front-most shapes
  // (lattices especially, which get their own extra forward push) stick out
  // past the front rim while the back rim goes mostly unused. Recenter the
  // base's Z on the ACTUAL resolved Z-midpoint of every other Tier-1 shape -
  // Z has no 2D equivalent at all (unlike x/y), so shifting it is never a
  // "rearrange" violation, and the base's own placement never had a real
  // constraint pinning it to Z=0 in the first place.
  if (baseNode) {
    const nonBaseForZ = tier1Nodes.filter(n => !n.isBase);
    if (nonBaseForZ.length > 0) {
      const zs = nonBaseForZ.map(n => tier1WorldCenter(n).z);
      baseNode.z = (Math.min(...zs) + Math.max(...zs)) / 2; // baseNode.zOffset is always 0, so world Z = z directly

      // Real width/depth for the marble slab's RENDERED footprint (see
      // createBaseMesh3D) - a rectangle fitted to the sculpture's actual X
      // and Z extents reads far better than a fixed square. This is purely
      // a rendering size: baseNode.r (the circular footprint every strut/
      // support calculation already reasons about) stays exactly as before,
      // so none of that logic needs to change - the rendered slab is sized
      // to comfortably CONTAIN that same circular footprint either way.
      const xs = nonBaseForZ.map(n => n.x);
      const xRange = Math.max(...xs) - Math.min(...xs);
      const zRange = Math.max(...zs) - Math.min(...zs);
      baseNode.renderW = Math.max(baseNode.r * 2, xRange + baseNode.r * 0.6);
      baseNode.renderD = Math.max(baseNode.r * 2, zRange + baseNode.r * 0.6);
    }
  }

  // Render the base at its final resolved position.
  if (baseNode) createBaseMesh3D(baseNode);

  // ===== Gravitational analysis: every element's real-world position + mass
  // (acrylic shapes/lattices, metal skeleton, heavy wood base), gathered as
  // meshes are created below so the entries always match what's actually
  // rendered - used after everything is placed to check whether the
  // sculpture would genuinely stand freestanding, and add a real support
  // only if it wouldn't (see the COG check after the strut block below).
  const massEntries = [];
  tier1Nodes.forEach(n => {
    const wc = tier1WorldCenter(n);
    massEntries.push({ x: wc.x, y: wc.y, z: wc.z, mass: tier1NodeMass(n) });
  });

  // Tracks which Tier-1 nodes end up with a REAL skeleton (Tier-2)
  // connector reaching them, populated below as ornaments/connectors are
  // realized - the sculpture should be "largely self-supporting given the
  // skeleton of line-based elements passing through," so a base support
  // strut is a LAST RESORT, only for a shape near the base that the
  // skeleton never reached at all, not a default for everything nearby.
  const skeletonConnectedNodes = new Set();

  // A connector's un-anchored FREE end only ever gets a Z-LEAN toward a
  // nearby Tier-1 shape (never a real x/y touch - see secondaryZTilt) -
  // fine on its own, but if several separate connectors share a similar 2D
  // origin (a common "hub" the original artwork radiates several lines
  // from) and each independently leans its own free end toward the SAME
  // nearest shape's Z, their free ends (already close in x/y from that
  // shared origin) end up sitting on top of each other too - wires visibly
  // touching EACH OTHER instead of a real shape, which must never happen.
  // Shared across every connector/ornament realized below so the 2nd (3rd,
  // 4th...) connector reaching for the same nearby shape picks the next-
  // nearest one instead (or no lean at all), the same "each claimed once"
  // pattern computeArcStringTargets already uses for its own breakpoints.
  const claimedSecondaryTargets = new Set();

  // Red dots mark every real touch point, but ONLY once the mesh they
  // belong to actually got created - marking unconditionally (as before)
  // left floating dots with nothing at them whenever create3DShape/createFn
  // failed for that particular element.
  shapes.forEach((shape, i) => {
    const node = skeletonNodeFor[i];
    const success = create3DShape(shape, i, node ? -node.z : 0, node ? node.contactDir : null,
      node ? { x: node.x, y: node.y } : null, node ? node.scrambleQuat : null);
    if (success) {
      totalConverted++;
      conversionStats.skeletons++;
    } else {
      conversionStats.failed.push({type: 'skeleton', index: i, shapeType: shape?.type, style: shape?.style});
    }
  });

  // ===== TIER 2 ornaments (halo/concentricArc/squiggle/shape-type arc): no
  // real volume, pass-through (may freely thread through shapes per the
  // user's rule), single touch-point attachment to whichever Tier-1 member
  // they were nearest to in the original 2D layout. =====
  // Far ends of colored shape-type arcs, queued here and given a thin
  // support rod in the aux-strut block below - an arc fastened at ONE touch
  // point cantilevers its whole sweep off a single weld, which isn't
  // credible support ("colored arcs are not being supported").
  const arcEndSupports = [];
  // Same idea, for line/bezier/spiral/arcline connectors whose anchor point
  // got pushed off its target by raiseDeltaAboveFloor's floor-clearance
  // shift (see FLOOR_RAISE_BREAKS_TOUCH and Pass 8b below) - queued by
  // realizeConnector, given a thin rod of their own alongside arcEndSupports.
  const connectorSupports = [];

  ornaments.forEach((shape, i) => {
    const node = ornamentNodeFor[i];
    let resolvedXY = null, layerZ = 0, contactDir = null, markerPoint = null, anchorTarget = null, skeletonKind = null;
    if (node) {
      resolvedXY = { x: node.x, y: node.y };
      layerZ = -node.z;
      contactDir = node.contactDir;
    } else {
      const kind = shape.style === 'halo' ? 'halo'
        : shape.type === 'concentricArc' ? 'concentricArc'
        : shape.type === 'squiggle' ? 'squiggle'
        : shape.type === 'arc' ? 'arcShape'
        : null;
      skeletonKind = kind;
      const anchor = kind ? computeConnectorAnchor(kind, shape, globalIndex++, tier1Nodes, null, claimedSecondaryTargets) : null;
      if (anchor && anchor.mode === 'resolved') {
        resolvedXY = anchor.resolvedXY;
        layerZ = -anchor.targetWorldZ;
      }
      if (anchor && anchor.primaryAnchorWorld) markerPoint = anchor.primaryAnchorWorld;
      anchorTarget = anchor ? anchor.targetNode : null;
    }
    const success = create3DShape(shape, i + shapes.length, layerZ, contactDir, resolvedXY,
      node ? node.scrambleQuat : null);
    if (success) {
      totalConverted++;
      conversionStats.ornaments++;
      if (markerPoint) markConnectionPoint(`conndot_ornament_${i}`, markerPoint);
      // A halo is "a soft radial glow, no hard edge to bound" (see
      // shapeVolumeRadius3D) - purely decorative, not a real rigid
      // connector, so it must NOT count as structural support for the shape
      // it's anchored to. Crediting it here was letting a shape with only a
      // halo touching it skip every base-strut pass below and render with
      // nothing real actually holding it up ("unsupported bullseye with
      // halo"). squiggle/arcShape ARE real wire elements and still count.
      if (anchorTarget && skeletonKind !== 'halo') skeletonConnectedNodes.add(anchorTarget);
      // Tier-1 ornaments were already weighed with tier1Nodes above (acrylic);
      // Tier-2 (no real volume) is "line based" per the user's framing - weigh
      // it as thin metal at its own anchor point instead.
      if (!node && skeletonKind && markerPoint) {
        massEntries.push({ x: markerPoint.x, y: markerPoint.y, z: markerPoint.z, mass: ornamentSkeletonMass(skeletonKind, shape) });
      }
      // Queue a colored arc's FAR end (whichever curve endpoint sits
      // farther from its single anchor point) for a thin support rod -
      // endpoint positions mirror create3DShape's own arc rendering
      // (arcPathLocal's y-flip, rotated by rotZ, flat at the resolved Z).
      if (skeletonKind === 'arcShape' && resolvedXY && markerPoint) {
        const rotZa = -(shape.rot || 0);
        const ra = ((shape.targetSize || 50) / K3D_SCALE) / 2;
        const aStart = shape.arcStart || 0;
        const aEnd = aStart + (shape.arcSweep || Math.PI);
        const cosA = Math.cos(rotZa), sinA = Math.sin(rotZa);
        const endWorld = (t) => {
          const lx = ra * Math.cos(t), ly = -ra * Math.sin(t);
          return { x: resolvedXY.x + lx * cosA - ly * sinA, y: resolvedXY.y + lx * sinA + ly * cosA, z: -layerZ };
        };
        const e0 = endWorld(aStart), e1 = endWorld(aEnd);
        const d0 = Math.hypot(e0.x - markerPoint.x, e0.y - markerPoint.y);
        const d1 = Math.hypot(e1.x - markerPoint.x, e1.y - markerPoint.y);
        arcEndSupports.push({ point: d0 >= d1 ? e0 : e1 });
      }
    } else {
      conversionStats.failed.push({type: 'ornament', index: i, shapeType: shape?.type, style: shape?.style});
    }
  });

  // Lattices (Tier 1 - real volume, mutual non-overlap already resolved above)
  lattices.forEach((lattice, i) => {
    const node = latticeNodeFor[i];
    const success = create3DLattice(lattice, i, node ? -node.z : 0, node ? { x: node.x, y: node.y } : null,
      node ? node.scrambleQuat : null);
    if (success) {
      totalConverted++;
      conversionStats.lattices++;
    } else {
      conversionStats.failed.push({type: 'lattice', index: i});
    }
  });

  // ===== TIER 2 connectors (line/bezier/arcline/spiral): pass-through,
  // reaching through full x/y/z to genuinely connect Tier-1 shapes rather
  // than just anchoring one end. line/bezier reach BOTH ends toward two
  // different shapes whenever a second one exists (mode:'span' - a direct
  // tube between the two touch points, bowed for bezier); arcline does the
  // same span reach now too; spiral anchors one end (its coiled shape can't
  // freely reach a second arbitrary point) but still traverses its OTHER
  // end's Z toward a real second target when one exists, rather than an
  // arbitrary wiggle - CONNECTOR_FREE_END_TILT is only the fallback for the
  // rare case no second target exists at all (e.g. a single-Tier-1-shape
  // composition).
  // (CONNECTOR_FREE_END_TILT is module-scope now - computeConnectorAnchor
  // must resolve the SAME fallback before its clearance check runs, or the
  // checked tilt and the rendered tilt disagree. See the fallback below.)

  // Every connector picks its OWN nearest Tier-1 target independently, which
  // can leave a shape with nothing pointing at it at all if it never
  // happened to be closest to anything - and now that shapes don't kiss
  // each other anymore (they're the BODY, staying exactly where the 2D
  // layout put them; lines/arcs/beziers are the SKELETON that does the
  // actual connecting), a shape with no connector reaching it has no
  // visible connection to the rest of the sculpture at all - it just
  // floats at its own 2D spot, unsupported. Reserve the nearest available
  // arc for every Tier-1 shape/lattice that needs one (falling back to
  // bezier/line/spiral if there aren't enough arcs) BEFORE the normal
  // per-connector pass runs, so as many as possible are guaranteed a real
  // connection - "likely at the end of an arc." Secondary body shapes -
  // lattices and concentricCircles (with or without a halo) - go first:
  // "place the secondary body shapes and elements... [after] the first 2
  // [primary/trunk] shapes." Lattices don't kiss as convincingly as a real
  // polygon/disc profile even when they DO get a contact (see
  // latticeVolumeRadius3D's plain-sphere approximation), and a
  // concentricCircle's stacked-ring silhouette has the same issue - a
  // visible connector matters most for both. The reserve simply runs out
  // once the connector pool is smaller than the shape count, an honest
  // limit, not a bug.
  const forcedTargetFor = new Map(); // `${kind}_${idx}` -> Tier-1 node
  {
    const pools = { arcline: arcLines, bezier: beziers, line: lines, spiral: spirals };
    const cursor = { arcline: 0, bezier: 0, line: 0, spiral: 0 };
    const isSecondaryBody = t => t === 'lattice' || t === 'concentricCircle';
    const needConnector = tier1Nodes.filter(n => !n.isBase);
    needConnector.sort((a, b) => (isSecondaryBody(a.shapeType) ? 0 : 1) - (isSecondaryBody(b.shapeType) ? 0 : 1));
    needConnector.forEach(shapeNode => {
      for (const kind of ['arcline', 'bezier', 'line', 'spiral']) {
        const pool = pools[kind];
        if (cursor[kind] < pool.length) {
          forcedTargetFor.set(`${kind}_${cursor[kind]}`, shapeNode);
          cursor[kind]++;
          return;
        }
      }
      console.warn(`⚠️ ${shapeNode.key} has no spare connector element to guarantee a Tier-2 link - it stays at its exact 2D position with no connector reaching it`);
    });
  }

  function realizeConnector(kind, el, i, createFn, namePrefix) {
    const forced = forcedTargetFor.get(`${kind}_${i}`) || null;
    const anchor = computeConnectorAnchor(kind, el, globalIndex++, tier1Nodes, forced, claimedSecondaryTargets);

    // No independent base leg here (removed) - a connector's anchor is a
    // point on a Tier-1 shape's surface, and that shape either already has
    // its own leg or reaches one through the connected tree; a separate leg
    // straight down from the connector's own anchor had no guarantee of
    // landing anywhere near the base ring's footprint.

    const layerZ = anchor ? -anchor.targetWorldZ : 0;
    const zTilt = anchor && anchor.zTilt != null ? anchor.zTilt : synthesizedZBias(globalIndex) * CONNECTOR_FREE_END_TILT;
    const anchorT = anchor ? anchor.anchorT : 0.5;
    const deltaPixel = anchor ? anchor.deltaPixel : null;
    const success = createFn(el, i, layerZ, zTilt, anchorT, deltaPixel);
    if (success && anchor && anchor.primaryAnchorWorld) markConnectionPoint(`conndot_${namePrefix}_${i}`, anchor.primaryAnchorWorld);
    if (success && anchor && anchor.targetNode) skeletonConnectedNodes.add(anchor.targetNode);
    // A long arc strung through several shapes (computeArcStringTargets)
    // genuinely touches each of them too, not just the primary target -
    // mark those contact points and count them as real connections, same as
    // the primary anchor.
    if (success && anchor && anchor.stringAnchors) {
      anchor.stringAnchors.forEach((p, si) => markConnectionPoint(`conndot_${namePrefix}_${i}_string${si}`, p));
    }
    if (success && anchor && anchor.stringTargetNodes) {
      anchor.stringTargetNodes.forEach(n => skeletonConnectedNodes.add(n));
    }
    // The floor-clearance raise pushed this connector's anchor off its
    // target's surface (see FLOOR_RAISE_BREAKS_TOUCH) - the target shape
    // still gets real support elsewhere (targetNode was withheld above so
    // Pass 3's closure loop catches it), but the connector itself is now
    // just as stranded as an unsupported arc far end. Queue it for the
    // same thin-rod treatment (Pass 8b, alongside arcEndSupports).
    if (success && anchor && anchor.strandedAnchorWorld) {
      connectorSupports.push({ point: anchor.strandedAnchorWorld });
    }
    if (success) {
      const pos = anchor && anchor.primaryAnchorWorld ? anchor.primaryAnchorWorld : { x: 0, y: 0, z: -layerZ };
      massEntries.push({ x: pos.x, y: pos.y, z: pos.z, mass: connectorMass(kind, el) });
    }
    return success;
  }

  lines.forEach((line, i) => {
    const success = realizeConnector('line', line, i, create3DLine, 'line');
    if (success) { totalConverted++; conversionStats.lines++; }
    else conversionStats.failed.push({type: 'line', index: i});
  });
  beziers.forEach((bz, i) => {
    const success = realizeConnector('bezier', bz, i, create3DBezier, 'bezier');
    if (success) { totalConverted++; conversionStats.lines++; }
    else conversionStats.failed.push({type: 'bezier', index: i});
  });
  arcLines.forEach((arcEl, i) => {
    const success = realizeConnector('arcline', arcEl, i, create3DArcLine, 'arcline');
    if (success) { totalConverted++; conversionStats.lines++; }
    else conversionStats.failed.push({type: 'arcLine', index: i});
  });
  spirals.forEach((sp, i) => {
    const success = realizeConnector('spiral', sp, i, create3DSpiral, 'spiral');
    if (success) { totalConverted++; conversionStats.lines++; }
    else conversionStats.failed.push({type: 'spiral', index: i});
  });

  // Dotted support struts (real, visible cylinders) - a LAST RESORT, not a
  // default: the sculpture should be largely self-supporting through the
  // skeleton of line/arc/bezier elements passing through it. This used to
  // stop at "does every shape near the base have a connector or a strut" -
  // which left large/heavy shapes anywhere ELSE in the piece (nowhere near
  // the base, and never picked as any connector's nearest target) with
  // literally nothing touching them at all: not a connector, not a strut,
  // just floating in isolated space - "in the back one of the larger shapes
  // is just floating." A real object can't have a chunk of itself connected
  // to nothing, so this now runs a full connectivity closure: EVERY Tier-1
  // shape/lattice must end up physically linked (skeleton connector, or a
  // drawn strut) into the one structure that's rooted at the base, however
  // many extra struts that takes. Struts are still only drawn where a real
  // connector didn't already do the job, so a well-connected composition
  // still gets few or none.
  // Does the straight segment pA-pB pass within `other`'s own bounding
  // radius of its center, for any Tier-1 shape other than the ones this
  // particular strut is legitimately connecting? Closest-point-on-segment
  // test, not just endpoint distance - a path can clip straight through a
  // shape's middle without either endpoint being anywhere near it. Defined
  // at function scope (not inside the `if (baseNode)` strut block below) so
  // the separate gravitational-stability outrigger can also route through
  // drawClearStrut - "any aux support" means every strut-drawing site, not
  // just the ones in the main pass.
  const segmentClearOfShapes = (pA, pB, ...exclude) => tier1Nodes.every(other => {
    if (other.isBase || exclude.includes(other)) return true;
    const oc = tier1WorldCenter(other);
    const abx = pB.x - pA.x, aby = pB.y - pA.y, abz = pB.z - pA.z;
    const abLenSq = abx * abx + aby * aby + abz * abz || 1;
    let t = ((oc.x - pA.x) * abx + (oc.y - pA.y) * aby + (oc.z - pA.z) * abz) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = pA.x + abx * t, cy = pA.y + aby * t, cz = pA.z + abz * t;
    return Math.hypot(cx - oc.x, cy - oc.y, cz - oc.z) >= other.r;
  });
  // "These are all solid objects... they can't [pass through each other]...
  // they must be fastened to each other on the surface." EVERY aux support
  // in this file routes through this one function now, not just one pass -
  // always draws pA-pB as a single straight rod. A strut that bends around
  // an obstruction reads as a kinked, mechanical-looking piece of scaffolding
  // rather than a real support - a caller with any real freedom over WHERE
  // it attaches (the reinforced-bracing legs/diagonal below, via
  // pickClearAngle) should pick a genuinely clear straight line instead of
  // ever asking this to bend one. `grounded`: does this strut actually land
  // on the BASE? Only the ones that do are the piece's real metalwork and
  // take the chosen strut material - "only struts coming up from the base
  // should be metallic or clear". Everything else is a shape-to-shape brace
  // and is always black, whatever the material picker says.
  const drawClearStrut = (name, pA, pB, width, radiusCap, grounded) => {
    createSolidTube3D(name, pA, pB, width, radiusCap, grounded);
  };
  // For a strut with real directional freedom (the reinforced tripod legs
  // and back-face diagonal below): try the ideal angle first, then a
  // widening fan of offsets to either side, and draw whichever candidate's
  // straight line is actually clear of every other Tier-1 shape - "pick a
  // better angle to avoid other shapes," not bend the strut once it's
  // already aimed. Falls back to the ideal angle's own line if nothing in
  // the fan clears (still real bracing, just not guaranteed obstruction-free
  // in that rare case, same as any other strut here).
  const ANGLE_FAN_DEG = [0, 20, -20, 40, -40, 60, -60, 90, -90, 120, -120, 150, -150, 180];
  const pickClearAngle = (idealAngle, makePoints, exclude, fanDeg = ANGLE_FAN_DEG) => {
    for (const offDeg of fanDeg) {
      const angle = idealAngle + offDeg * Math.PI / 180;
      const { pA, pB } = makePoints(angle);
      if (segmentClearOfShapes(pA, pB, ...exclude)) return { pA, pB };
    }
    return makePoints(idealAngle);
  };

  if (baseNode) {
    const DOWN = { x: 0, y: -1, z: 0 };
    const baseTopY = baseNode.y + baseNode.zHalf;
    const baseCenterXZ = tier1WorldCenter(baseNode);
    const connected = new Set(skeletonConnectedNodes); // seeded with every node a real skeleton connector already reached (may include the base itself)
    const groundedNodes = new Set(); // nodes with a strut reaching the BASE directly (not just connected to some other shape - see Pass 6)
    let strutCount = 0;

    // A shape's OWN x/z is only a valid base attachment point if that x/z
    // actually lands within the base's real ALLOWED anchor region - not the
    // beveled edge, and not the 1" boundary just inside the flat surface's
    // own edge either ("do not anchor any struts to the beveled edge...
    // create a 1 inch boundary on the outside of the flat surface and do
    // not anchor aux struts to that either"). Clamp to that safe rectangle
    // (baseAnchorHalfExtents) in the true direction toward the shape, so the
    // strut always ends somewhere genuinely safe to touch - a diagonal
    // brace for anything cantilevered out past it, a normal vertical leg
    // for anything already within it.
    const baseAnchor = baseAnchorHalfExtents(baseNode);
    const baseAttachPoint = (x, z) => {
      const localX = Math.max(-baseAnchor.halfW, Math.min(baseAnchor.halfW, x - baseCenterXZ.x));
      const localZ = Math.max(-baseAnchor.halfD, Math.min(baseAnchor.halfD, z - baseCenterXZ.z));
      return { x: baseCenterXZ.x + localX, y: baseTopY, z: baseCenterXZ.z + localZ };
    };
    // A strut with real vertical drop can afford the sideways reach the
    // margin clamp above sometimes needs (see baseAttachPoint) - a LOW
    // shape can't: the same horizontal offset, spread over almost no
    // vertical distance, reads as an extreme, near-horizontal lean rather
    // than a support leg - "it needs to be straight up and down." Past this
    // angle from vertical, going straight down under the shape (ignoring
    // the margin clamp) wins over staying off the margin.
    const MAX_STRUT_ANGLE_FROM_VERTICAL = 30 * Math.PI / 180;

    const drawBaseStrut = (n, name, width = 2) => {
      // Lattices never get a direct-to-base connection, from ANY pass that
      // shares this helper - "lattices are only supported by horizontal
      // braces from other shapes behind them... the idea is that they
      // appear to be floating." See the dedicated lattice-brace pass below
      // for what they get instead.
      if (n.shapeType === 'lattice') return;
      const wz = tier1WorldCenter(n).z;
      const lowestY = n.y - semiCircleAwareDistance(n, DOWN);
      const shapePoint = { x: n.x, y: lowestY, z: wz };
      let basePoint = baseAttachPoint(n.x, wz);
      const drop = shapePoint.y - basePoint.y; // negative/zero is degenerate (shape at or below the base top) - Math.max below guards it
      const horizOffset = Math.hypot(basePoint.x - shapePoint.x, basePoint.z - shapePoint.z);
      if (horizOffset > 1e-6 && Math.atan2(horizOffset, Math.max(drop, 0.01)) > MAX_STRUT_ANGLE_FROM_VERTICAL) {
        basePoint = { x: shapePoint.x, y: basePoint.y, z: shapePoint.z };
      }
      drawClearStrut(`base_strutsupport_${name}`, shapePoint, basePoint, width, strutRadiusCap(n), true);
      markConnectionPoint(`conndot_basesupport_shape_${name}`, shapePoint, AUX_SUPPORT_HEAD_RADIUS);
      markConnectionPoint(`conndot_basesupport_base_${name}`, basePoint, AUX_SUPPORT_HEAD_RADIUS);
      connected.add(n);
      groundedNodes.add(n);
      strutCount++;
    };
    // Approximate real-world gap between two Tier-1 shapes' surfaces (center
    // distance minus both radii) - only used to RANK candidates for the
    // closure pass below, not to place anything, so the isotropic
    // approximation is fine even for polygon profiles.
    const tier1SurfaceGap = (a, b) => {
      const ca = tier1WorldCenter(a), cb = tier1WorldCenter(b);
      return Math.hypot(ca.x - cb.x, ca.y - cb.y, ca.z - cb.z) - a.r - b.r;
    };
    // Shape-to-shape strut: real oriented touch points on each shape's own
    // surface, facing each other - the same supportDistanceWorld machinery
    // buildElementTree itself uses, so the strut always starts/ends exactly
    // on each shape's true boundary, not its bounding sphere.
    const drawShapeStrut = (a, b, name, width = 3) => {
      const ca = tier1WorldCenter(a), cb = tier1WorldCenter(b);
      const dx = cb.x - ca.x, dy = cb.y - ca.y, dz = cb.z - ca.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const dir = { x: dx / len, y: dy / len, z: dz / len };
      const distA = semiCircleAwareDistance(a, dir);
      const distB = semiCircleAwareDistance(b, { x: -dir.x, y: -dir.y, z: -dir.z });
      const pA = { x: ca.x + dir.x * distA, y: ca.y + dir.y * distA, z: ca.z + dir.z * distA };
      const pB = { x: cb.x - dir.x * distB, y: cb.y - dir.y * distB, z: cb.z - dir.z * distB };
      drawClearStrut(`base_strutsupport_${name}`, pA, pB, width, Math.min(strutRadiusCap(a), strutRadiusCap(b)), false);
      markConnectionPoint(`conndot_basesupport_a_${name}`, pA, AUX_SUPPORT_HEAD_RADIUS);
      markConnectionPoint(`conndot_basesupport_b_${name}`, pB, AUX_SUPPORT_HEAD_RADIUS);
      connected.add(a); connected.add(b);
      strutCount++;
    };

    // Large/elevated shapes get their OWN dedicated tripod+diagonal bracing
    // in Pass 5 below, unconditionally - computed here (before every earlier
    // pass runs) so those passes can skip these shapes entirely instead of
    // ALSO landing a redundant extra leg on top of Pass 5's own 4, which was
    // stacking up to 5 struts on a single large shape ("we only need 3 or
    // 4... 2 or 3 straight ones at the bottom and a 3rd diagonal one").
    const nonBaseNodes = tier1Nodes.filter(n => !n.isBase);
    const avgR2 = nonBaseNodes.length ? nonBaseNodes.reduce((s, n) => s + n.r, 0) / nonBaseNodes.length : 0;
    const maxYAbove = Math.max(1, ...nonBaseNodes.map(n => n.y - baseTopY));
    const LARGE_R_THRESHOLD = avgR2 * 1.3;
    const HIGH_Y_THRESHOLD = maxYAbove * 0.4;
    const isReinforcedTarget = n => n.shapeType !== 'lattice' && n.r >= LARGE_R_THRESHOLD && (n.y - baseTopY) >= HIGH_Y_THRESHOLD;
    // Shared heavy/light split for the passes below - this is a MINIATURE
    // ("nobody will be in danger"), so light shapes lean on the skeleton and
    // closure network alone, and only genuinely heavy masses earn extra
    // dedicated struts. Keeps the strut count down so the stand doesn't
    // crowd the actual composition.
    const avgNodeMass = nonBaseNodes.length
      ? nonBaseNodes.reduce((s, n) => s + tier1NodeMass(n), 0) / nonBaseNodes.length
      : 0;

    // Pass 0 (trunk): "the first two large shapes that are drawn must
    // connect directly to the base." skeletonNodeFor[0]/[1] are the
    // composition's two primary body shapes (window.skeletons - always
    // drawn first, always exactly two) - the trunk everything else roots
    // through, per the user's own tree model (base -> trunk -> connector
    // "branches" -> secondary body shapes, with a direct-to-base strut only
    // as the fallback for anything that doesn't reach the tree). Forced
    // unconditionally, same as the cantilever/reinforced passes - not
    // gated on whether a skeleton connector already reaches them. Skipped
    // for a trunk shape that also qualifies as an isReinforcedTarget (a
    // skeleton is often the single largest shape in the piece) - Pass 5's
    // own tripod+diagonal already grounds it more thoroughly than this
    // single leg would, so adding this one too was pure stacking.
    skeletonNodeFor.slice(0, 2).forEach((n, i) => {
      if (!n || isReinforcedTarget(n)) return;
      drawBaseStrut(n, `trunk_${i}`, 5);
    });

    // Pass 1 (opportunistic): shapes with no skeleton connector at all that
    // are already close enough to the base for a strut to read as genuine
    // contact, not a reach across empty space.
    tier1Nodes.forEach((n, ni) => {
      if (n.isBase || connected.has(n) || isReinforcedTarget(n)) return;
      const proximityMargin = Math.max(n.r * 0.5, baseNode.zHalf);
      const lowestY = n.y - semiCircleAwareDistance(n, DOWN);
      if (lowestY - baseTopY <= proximityMargin) drawBaseStrut(n, `near_${ni}`, 2);
    });

    // Pass 2: guarantee the BASE ITSELF has at least one real connection - a
    // single hair-thin thread to whatever happened to be physically nearest
    // reads as an accident, not a support, so if nothing above already
    // reached it (no opportunistic strut, no connector/ornament that
    // targeted it directly), plant a proper multi-leg foot: up to 3 of the
    // closest Tier-1 shapes (never just one - real stands don't balance on
    // a single point), each with a visibly THICKER leg, ignoring whether
    // they already have other skeleton connections elsewhere.
    if (!connected.has(baseNode)) {
      const ranked = tier1Nodes
        .filter(n => !n.isBase && n.shapeType !== 'lattice' && !isReinforcedTarget(n)) // lattices never anchor the base either - see drawBaseStrut's own guard; reinforced targets get Pass 5's own bracing instead
        .map(n => ({ n, gap: (n.y - semiCircleAwareDistance(n, DOWN)) - baseTopY }))
        .sort((a, b) => a.gap - b.gap);
      if (ranked.length > 0) {
        const nearGapBand = ranked[0].gap + Math.max(ranked[0].n.r, 4) * 2;
        // 2 legs, not the old 3 - still never one point of balance, but a
        // miniature's guaranteed foot doesn't need a third
        const legs = ranked.filter(c => c.gap <= nearGapBand).slice(0, 2);
        legs.forEach((c, idx) => drawBaseStrut(c.n, `guaranteed_${idx}`, 5));
      }
      connected.add(baseNode);
    }

    // Pass 3 (connectivity closure): repeatedly bridge whichever
    // (unconnected shape, connected shape) pair is physically closest, until
    // every Tier-1 element is part of the same rigid structure as the base -
    // fixes shapes ANYWHERE in the piece (not just near the base) that never
    // got a skeleton connector and weren't close enough to the base for pass
    // 1 either, which used to leave them rendered with nothing touching them
    // at all. Only falls back to a direct (possibly long) leg straight to
    // the base if no connected shape remains as a nearer option.
    let guard = 0;
    while (guard++ < tier1Nodes.length + 5) {
      let best = null, bestGap = Infinity;
      tier1Nodes.forEach(o => {
        if (o.isBase || connected.has(o) || isReinforcedTarget(o)) return;
        connected.forEach(c => {
          if (c.isBase) return;
          const gap = tier1SurfaceGap(o, c);
          if (gap < bestGap) { bestGap = gap; best = { o, c }; }
        });
      });
      if (best) { drawShapeStrut(best.o, best.c, `closure_${guard}`, 3); continue; }
      const orphan = tier1Nodes.find(o => !o.isBase && !connected.has(o) && !isReinforcedTarget(o));
      if (!orphan) break;
      drawBaseStrut(orphan, `closure_base_${guard}`, 3);
    }

    // Pass 4 (cantilever anchoring): a thin skeleton connector is enough to
    // count as "touched" (Pass 1-3 above), but it's not credible physical
    // support for something hanging entirely outside the base's own
    // footprint - gravity puts a real tipping/cantilever moment on anything
    // out there, and a single flexible wire reaching it doesn't change that.
    // Brace every such shape to the base too (drawBaseStrut's baseAttachPoint
    // clamps to the base's real rim for anything this far out, a genuine
    // diagonal brace rather than a vertical drop into empty air), regardless
    // of whatever else already reaches it - a cantilever needs bracing
    // against solid ground, not just a wire back to the rest of the structure.
    let cantileverCount = 0;
    tier1Nodes.forEach((o, oi) => {
      if (o.isBase || o.shapeType === 'lattice' || isReinforcedTarget(o)) return; // lattices only ever get the horizontal brace pass below, even when cantilevered; reinforced targets get Pass 5's own bracing (its legs already clamp into the base's safe anchor rect, becoming a diagonal brace on their own when cantilevered)
      // Miniature-scale judgment call: a LIGHT shape that's already fastened
      // into the structure doesn't tip anything even hanging outside the
      // footprint - bracing every such shape was a big part of the strut
      // forest crowding the composition. Only heavy cantilevered masses
      // (or ones with no connection at all) still get the brace.
      if (tier1NodeMass(o) < avgNodeMass && connected.has(o)) return;
      const oc = tier1WorldCenter(o);
      const horizDist = Math.hypot(oc.x - baseCenterXZ.x, oc.z - baseCenterXZ.z);
      if (horizDist <= baseNode.r) return; // within the footprint - no cantilever risk
      drawBaseStrut(o, `cantilever_${oi}`, 3);
      cantileverCount++;
    });
    if (cantileverCount > 0) console.log(`🦯 ${cantileverCount} cantilever brace(s) - heavy or unconnected shape(s) outside the base's footprint, given real support to the ground`);

    // Pass 5 (reinforced bracing): "large shapes should have 3 structural
    // supports at the bottom of the shape, and 1 diagonal support from
    // behind to back face." A single leg is fine for most shapes, but a
    // big, elevated mass balanced on ONE point is a real tipping risk in a
    // way a small or low shape isn't. Large (above-average radius) AND
    // meaningfully elevated shapes get a real tripod foot (3 legs, fanned
    // out under the shape, not one centered leg) plus a diagonal brace
    // running from the shape's own BACK face to the base's rim in the
    // shape's own direction - real triangulated bracing, the same technique
    // a museum mount would use for a top-heavy piece, not just another
    // vertical leg.
    const TRIPOD_LEG_COUNT = 2; // + 1 diagonal below = 3 struts total per shape - "we only need 3 or 4... 2 or 3 straight ones at the bottom and a 3rd diagonal one"; on a miniature, 2 straight + 1 diagonal is a sound tripod (three contact points, triangulated)
    let reinforcedCount = 0;
    nonBaseNodes.forEach((n, ni) => {
      if (!isReinforcedTarget(n)) return;
      const wz = tier1WorldCenter(n).z;
      // Tripod: fan 3 rays out from the shape's TRUE CENTER toward 3
      // landing points on the base, but only draw each strut from where its
      // ray actually EXITS the shape's real boundary onward - the center
      // itself is buried inside solid material, so the segment from center
      // to that exit point is deleted, never rendered. These are the
      // "straight" supports ("3 structural supports at the bottom of the
      // shape") - the ONE diagonal support is the separate back-face brace
      // below, so the horizontal spread here is kept to a modest fraction
      // of how far each leg actually drops to the base, keeping the angle
      // off vertical shallow (still 3 visibly distinct feet, just not a
      // second set of diagonal braces).
      const shapeCenter = { x: n.x, y: n.y, z: wz };
      const heightAbove = n.y - baseTopY;
      const legSpread = Math.min(Math.max(n.r * 0.5, 2), Math.max(heightAbove * 0.35, 1.5));
      // Where this leg lands on the base is what has freedom - swing THAT
      // around the shape (fanning legSpread out at a different azimuth)
      // until the resulting straight line actually clears every other
      // Tier-1 shape, rather than accepting the ideal azimuth's line and
      // bending it later.
      const makeLegPoints = (azimuth, spreadFrac = 1) => {
        const spread = legSpread * spreadFrac;
        const aimX = n.x + Math.cos(azimuth) * spread;
        const aimZ = wz + Math.sin(azimuth) * spread;
        let legBasePoint = baseAttachPoint(aimX, aimZ);
        // Same guard as drawBaseStrut's own MAX_STRUT_ANGLE_FROM_VERTICAL
        // check - baseAttachPoint's margin clamp can push the landing point
        // well away from the leg's own (aimX, aimZ) when the shape sits low
        // and near the base's edge, turning a short foot into a near-
        // horizontal lean. Drop the clamped landing and go straight down
        // from the aim point instead once that lean gets too extreme.
        const preClampHoriz = Math.hypot(legBasePoint.x - aimX, legBasePoint.z - aimZ);
        const preClampDrop = shapeCenter.y - legBasePoint.y;
        if (preClampHoriz > 1e-6 && Math.atan2(preClampHoriz, Math.max(preClampDrop, 0.01)) > MAX_STRUT_ANGLE_FROM_VERTICAL) {
          legBasePoint = { x: aimX, y: legBasePoint.y, z: aimZ };
        }
        const dx = legBasePoint.x - shapeCenter.x, dy = legBasePoint.y - shapeCenter.y, dz = legBasePoint.z - shapeCenter.z;
        const dlen = Math.hypot(dx, dy, dz) || 1;
        const dir = { x: dx / dlen, y: dy / dlen, z: dz / dlen };
        const exitDist = semiCircleAwareDistance(n, dir);
        const legTopPoint = { x: shapeCenter.x + dir.x * exitDist, y: shapeCenter.y + dir.y * exitDist, z: shapeCenter.z + dir.z * exitDist };
        return { pA: legTopPoint, pB: legBasePoint };
      };
      // A leg's whole point is to land on ITS OWN side of the shape (left
      // foot to the left, right foot to the right) - swinging its azimuth
      // to dodge a neighbor can end up aiming at a completely unrelated
      // side of the base ("shooting out to the front" instead of staying
      // left), which pickClearAngle's wide-open fan doesn't know to avoid.
      // Try shrinking the SIDEWAYS spread first, at the true ideal azimuth
      // (still the shape's own left/right, just less far out) - a straight
      // drop under the shape's own center is the one direction guaranteed
      // not to require dodging a neighbor, since that's the shape's own
      // footprint. Only if even that's blocked (the shape is genuinely
      // overlapping something else) does the angle fan get to run, same as
      // any other pickClearAngle call.
      const LEG_SPREAD_SHRINK = [1, 0.6, 0.3, 0];
      const pickLegPoints = (idealAzimuth) => {
        for (const frac of LEG_SPREAD_SHRINK) {
          const candidate = makeLegPoints(idealAzimuth, frac);
          if (segmentClearOfShapes(candidate.pA, candidate.pB, n)) return candidate;
        }
        return pickClearAngle(idealAzimuth, makeLegPoints, [n]);
      };
      for (let li = 0; li < TRIPOD_LEG_COUNT; li++) {
        const idealAzimuth = (li / TRIPOD_LEG_COUNT) * Math.PI * 2;
        const { pA: legTopPoint, pB: legBasePoint } = pickLegPoints(idealAzimuth);
        drawClearStrut(`base_reinforced_leg_${ni}_${li}`, legTopPoint, legBasePoint, 3, strutRadiusCap(n), true);
        markConnectionPoint(`conndot_reinforced_leg_shape_${ni}_${li}`, legTopPoint, AUX_SUPPORT_HEAD_RADIUS);
        markConnectionPoint(`conndot_reinforced_leg_base_${ni}_${li}`, legBasePoint, AUX_SUPPORT_HEAD_RADIUS);
      }
      const idealBaseAngle = Math.atan2(wz - baseCenterXZ.z, n.x - baseCenterXZ.x);
      // A straight line from the back face to the base can still cut through
      // some OTHER shape sitting behind/beside this one - "supports from the
      // back diagonally, and doesn't go through any other shape behind it."
      // Where it lands on the base rim is what has freedom (swung around
      // idealBaseAngle by pickClearAngle below) until the line actually
      // clears, rather than accepting the ideal line and bending it later.
      // baseAttachPoint already clamps into the safe anchor rectangle (never
      // the bevel, never its 1" margin), so any rim angle lands somewhere
      // genuinely safe to touch.
      const makeDiagPoints = (baseAngle) => {
        const diagBasePoint = baseAttachPoint(
          baseCenterXZ.x + Math.cos(baseAngle) * baseNode.r,
          baseCenterXZ.z + Math.sin(baseAngle) * baseNode.r
        );
        // Rotates ONLY about the X axis - X stays locked at 0 (never sways
        // to a side face, which read as "pointless" since a side attachment
        // does nothing to resist front/back tipping), while Y and Z vary
        // freely so the brace can angle up or down toward wherever the base
        // attachment actually sits. Z is floored just above 0 so it always
        // stays on the BACK face, never swinging to the front.
        const rawY = diagBasePoint.y - n.y, rawZ = Math.max(0.05, diagBasePoint.z - wz);
        const rawLen = Math.hypot(rawY, rawZ) || 1;
        const faceDir = { x: 0, y: rawY / rawLen, z: rawZ / rawLen };
        const faceDist = semiCircleAwareDistance(n, faceDir);
        const facePoint = { x: n.x, y: n.y + faceDir.y * faceDist, z: wz + faceDir.z * faceDist };
        return { pA: facePoint, pB: diagBasePoint };
      };
      // Capped narrower than the shared ANGLE_FAN_DEG (which runs all the
      // way to 180): the diagonal's whole point is bracing in THIS shape's
      // own outward direction ("a diagonal support from behind to back
      // face... in the shape's own direction") - a swing past ~45 degrees
      // to dodge an obstruction lands on a genuinely different part of the
      // base rim, reading as a strut aimed at nothing in particular rather
      // than a brace for this shape. Past that point, landing back on the
      // unmodified ideal line (even if it isn't perfectly obstruction-free)
      // still looks and behaves like a real brace; a wide swing didn't.
      const DIAG_ANGLE_FAN_DEG = [0, 20, -20, 40, -40];
      const { pA: facePoint, pB: diagBasePoint } = pickClearAngle(idealBaseAngle, makeDiagPoints, [n], DIAG_ANGLE_FAN_DEG);
      drawClearStrut(`base_reinforced_diag_${ni}`, facePoint, diagBasePoint, 3, strutRadiusCap(n), true);
      markConnectionPoint(`conndot_reinforced_diag_shape_${ni}`, facePoint, AUX_SUPPORT_HEAD_RADIUS);
      markConnectionPoint(`conndot_reinforced_diag_base_${ni}`, diagBasePoint, AUX_SUPPORT_HEAD_RADIUS);
      connected.add(n);
      groundedNodes.add(n);
      reinforcedCount++;
    });
    if (reinforcedCount > 0) console.log(`🦯 ${reinforcedCount} large/elevated shape(s) given a 3-leg tripod foot plus a diagonal back brace`);

    // Pass 6 (ground the HEAVY shapes): the passes above guarantee GRAPH
    // connectivity to the base - a chain of skeleton wires and/or
    // shape-to-shape struts - but a heavy shape hanging three hops down a
    // chain of thin wires doesn't credibly read as "supported" even though
    // it's technically connected. This used to ground EVERY body shape,
    // which en masse drew a forest of near-vertical legs under the whole
    // piece - scaffolding, not sculpture, and exactly against the "largely
    // self-supporting through the skeleton, struts as a LAST RESORT" rule.
    // Only shapes with above-average REAL mass (the ones whose weight
    // genuinely demands their own load path) get a dedicated leg now; light
    // shapes stay held by the skeleton/closure network they're already
    // connected through. Skipped as before for anything already grounded,
    // resting flush on a grounded shape, or a lattice (float rule).
    let groundedCount = 0, bridgedCount = 0;
    nonBaseNodes.forEach((n, ni) => {
      if (n.shapeType === 'lattice' || groundedNodes.has(n)) return; // lattices only ever get the horizontal brace pass below
      if (tier1NodeMass(n) < avgNodeMass) return; // light enough for the skeleton/closure network alone
      const restingOnGrounded = nonBaseNodes.some(other =>
        other !== n && groundedNodes.has(other) && tier1SurfaceGap(n, other) < Math.max(n.r, other.r) * 0.08
      );
      if (restingOnGrounded) return;
      // Prefer a SHORT strut into an already-grounded shape over a long leg
      // all the way down to the base. Both are real load paths, but the
      // short one is the structurally better choice (a brief, triangulated
      // transfer into standing structure instead of a long slender column)
      // AND the visually better one - the long near-vertical legs are
      // exactly what was "getting in the way of the actual composition,"
      // since they run the full height of the piece straight through it.
      const dropLen = (n.y - semiCircleAwareDistance(n, DOWN)) - baseTopY;
      let bridge = null, bridgeGap = Infinity;
      nonBaseNodes.forEach(other => {
        if (other === n || !groundedNodes.has(other) || other.shapeType === 'lattice') return;
        const gap = tier1SurfaceGap(n, other);
        if (gap < bridgeGap) { bridgeGap = gap; bridge = other; }
      });
      if (bridge && bridgeGap < dropLen * 0.6) {
        drawShapeStrut(n, bridge, `ground_bridge_${ni}`, 3);
        groundedNodes.add(n); // now riding a grounded shape's own load path
        bridgedCount++;
      } else {
        drawBaseStrut(n, `ground_${ni}`, 3);
        groundedCount++;
      }
    });
    if (groundedCount + bridgedCount > 0) console.log(`🦯 ${groundedCount} heavy shape(s) given a direct leg to the base, ${bridgedCount} bridged into nearer standing structure instead (shorter load path, less crossing the composition) - lighter shapes ride the skeleton/closure network`);

    // Pass 7 (lattice float): lattices never connect to the base directly
    // (drawBaseStrut's own guard, plus the explicit skips in passes 2/4/5/6
    // above) - "lattices are only supported by horizontal braces from other
    // shapes behind them... the idea is that they appear to be floating."
    // Every lattice gets a level (Y unchanged - no vertical component at
    // all) brace to the nearest OTHER Tier-1 shape genuinely BEHIND it
    // (larger world Z, further from camera), reading as a bracket reaching
    // back into the piece rather than a leg down to the ground. Falls back
    // to whatever's nearest in any direction only if nothing at all sits
    // behind it - better than leaving a lattice completely unbraced.
    let latticeBraceCount = 0;
    nonBaseNodes.filter(n => n.shapeType === 'lattice').forEach((n, ni) => {
      const nWc = tier1WorldCenter(n);
      // A LEVEL brace at the lattice's own height can only fasten to a shape
      // whose volume actually SPANS that height. The old pick ranked
      // candidates by horizontal distance alone and then pinned the brace's
      // far endpoint at the lattice's Y anyway - with the contact offset
      // measured from the target's CENTER (a different height entirely), so
      // a nearest-behind shape sitting higher or lower got its "contact"
      // point hanging in empty air beside it: a strut fastened to nothing,
      // the lattice visibly (and physically) unsupported.
      const spansHeight = other => {
        const oWc = tier1WorldCenter(other);
        return pointInsideTier1Volume({ x: oWc.x, y: nWc.y, z: oWc.z }, other);
      };
      let behind = null, behindDist = Infinity, level = null, levelDist = Infinity;
      let anyBehind = null, anyBehindDist = Infinity, any = null, anyDist = Infinity;
      nonBaseNodes.forEach(other => {
        // Never anchor a lattice to ANOTHER lattice - lattices float, so a
        // lattice-to-lattice brace just chains two unsupported masses
        // together with still nothing underneath either of them.
        if (other === n || other.shapeType === 'lattice') return;
        const oWc = tier1WorldCenter(other);
        const d = Math.hypot(nWc.x - oWc.x, oWc.z - nWc.z);
        const isBehind = oWc.z > nWc.z;
        if (d < anyDist) { anyDist = d; any = other; }
        if (isBehind && d < anyBehindDist) { anyBehindDist = d; anyBehind = other; }
        if (!spansHeight(other)) return;
        if (d < levelDist) { levelDist = d; level = other; }
        if (isBehind && d < behindDist) { behindDist = d; behind = other; }
      });
      const target = behind || level; // prefer behind ("braces from shapes behind them"), else any direction that can truly take a level brace
      if (target) {
        const tWc = tier1WorldCenter(target);
        const dx = tWc.x - nWc.x, dz = tWc.z - nWc.z;
        const dLen = Math.hypot(dx, dz) || 1;
        const dir = { x: dx / dLen, y: 0, z: dz / dLen }; // level - no Y component
        const distA = semiCircleAwareDistance(n, dir);
        const pA = { x: nWc.x + dir.x * distA, y: nWc.y, z: nWc.z + dir.z * distA };
        // Ray-march the level line to where it truly ENTERS the target's
        // volume - the target's support distance from its own center is
        // measured at the wrong height for this brace, so probe the real
        // boundary along the actual brace line instead. The march always
        // terminates inside (spansHeight verified the endpoint is interior).
        const end = { x: tWc.x, y: nWc.y, z: tWc.z };
        let pB = end;
        for (let s = 0; s <= 60; s++) {
          const t = s / 60;
          const p = { x: pA.x + (end.x - pA.x) * t, y: nWc.y, z: pA.z + (end.z - pA.z) * t };
          if (pointInsideTier1Volume(p, target)) { pB = p; break; }
        }
        drawClearStrut(`base_strutsupport_latticebrace_${ni}`, pA, pB, 3, Math.min(strutRadiusCap(n), strutRadiusCap(target)), false);
        markConnectionPoint(`conndot_latticebrace_a_${ni}`, pA, AUX_SUPPORT_HEAD_RADIUS);
        markConnectionPoint(`conndot_latticebrace_b_${ni}`, pB, AUX_SUPPORT_HEAD_RADIUS);
        connected.add(n); connected.add(target);
        // The brace transfers the lattice's REAL weight (lattices are among
        // the heaviest bodies in the piece) onto its anchor shape - plus a
        // lever moment when the lattice hangs far out front. That load has
        // to continue DOWN: if the anchor doesn't already have its own
        // route to the base, give it one now regardless of its own mass -
        // a light anchor carrying a heavy lattice is load-bearing whether
        // or not Pass 6's own-mass threshold would have picked it.
        if (!groundedNodes.has(target)) drawBaseStrut(target, `latticeanchor_${ni}`, 3);
        latticeBraceCount++;
      } else if (anyBehind || any) {
        // NOTHING in the piece spans this lattice's height, so a level brace
        // cannot reach real material anywhere - fall back to a genuine
        // surface-to-surface strut to the nearest shape behind it (or
        // nearest anywhere as a last resort). Angled rather than level, but
        // fastened to real material at BOTH ends - and still never the
        // base, preserving the floating look as far as physics allows.
        const fallbackTarget = anyBehind || any;
        drawShapeStrut(n, fallbackTarget, `latticebrace_fallback_${ni}`, 3);
        // Same load-path rule as the level-brace case above: the fallback
        // anchor is carrying this lattice now, so it must reach the ground.
        if (!groundedNodes.has(fallbackTarget)) drawBaseStrut(fallbackTarget, `latticeanchor_${ni}`, 3);
        latticeBraceCount++;
      }
    });
    if (latticeBraceCount > 0) console.log(`🦯 ${latticeBraceCount} horizontal lattice brace(s) - lattices float, held only by a level brace to a shape behind them, never a direct base connection`);

    // Shared by Pass 8 (colored-arc far ends) and Pass 8b (stranded
    // connector anchors, below): give a single stray point a THIN rod to
    // the nearest real material - the closest shape surface, or straight
    // down to the base when that's nearer. No-ops when the point already
    // rests against something. `name` feeds both the strut and its
    // connection-dot mesh names, so callers must pass something unique.
    const supportStrandedPoint = (p, name) => {
      let best = null, bestGap = Infinity, bestTouch = null;
      tier1Nodes.forEach(nd => {
        if (nd.isBase) return;
        const wc = tier1WorldCenter(nd);
        const dx = p.x - wc.x, dy = p.y - wc.y, dz = p.z - wc.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        const dir = { x: dx / len, y: dy / len, z: dz / len };
        const sd = semiCircleAwareDistance(nd, dir);
        const gap = len - sd;
        if (gap < bestGap) {
          bestGap = gap;
          best = nd;
          bestTouch = { x: wc.x + dir.x * sd, y: wc.y + dir.y * sd, z: wc.z + dir.z * sd };
        }
      });
      if (bestGap < 0.5) return false; // already effectively resting on real material
      let basePoint = baseAttachPoint(p.x, p.z);
      // Same "straight up and down, not a shallow lean" rule as
      // drawBaseStrut's identical margin-clamp fix above - only relevant
      // to THIS fallback branch (straight to base); the useShape branch
      // below is deliberately free to reach sideways to a nearby shape.
      {
        const drop = p.y - basePoint.y;
        const horizOffset = Math.hypot(basePoint.x - p.x, basePoint.z - p.z);
        if (horizOffset > 1e-6 && Math.atan2(horizOffset, Math.max(drop, 0.01)) > MAX_STRUT_ANGLE_FROM_VERTICAL) {
          basePoint = { x: p.x, y: basePoint.y, z: p.z };
        }
      }
      const dropLen = Math.hypot(p.x - basePoint.x, p.y - basePoint.y, p.z - basePoint.z);
      // ALWAYS connect. An earlier version only drew this rod when it could
      // be short (to stop struts crossing the composition) and skipped it
      // otherwise - but "otherwise" is exactly the case of an arc/connector
      // sweeping far out from the cluster, which is precisely the one that
      // reads as floating with nothing holding it. A long sweeping arc
      // welded at a single point is the LEAST self-supporting element in
      // the piece, not the most. Length now governs only how the rod is
      // drawn, never whether it exists: the shorter of (nearest shape
      // surface, base) is chosen, drawClearStrut bends it around anything
      // in the way, and the rod stays hair-thin (0.15 cap) so even a long
      // one reads as a fine wire rather than scaffolding.
      const useShape = best && bestGap <= dropLen;
      if (useShape) {
        drawClearStrut(`base_strutsupport_${name}`, p, bestTouch, 1.5, 0.15, false);
        markConnectionPoint(`conndot_${name}`, bestTouch, AUX_SUPPORT_HEAD_RADIUS * 0.6);
      } else {
        drawClearStrut(`base_strutsupport_${name}`, p, basePoint, 1.5, 0.15, true);
        markConnectionPoint(`conndot_${name}`, basePoint, AUX_SUPPORT_HEAD_RADIUS * 0.6);
      }
      return true;
    };

    // Pass 8 (colored-arc far ends): each shape-type arc ornament is
    // fastened to a shape at exactly ONE point - give its queued far end
    // (see arcEndSupports) its own thin rod via supportStrandedPoint above.
    let arcEndCount = 0;
    arcEndSupports.forEach((sup, si) => {
      if (supportStrandedPoint(sup.point, `arcend_${si}`)) arcEndCount++;
    });
    if (arcEndCount > 0) console.log(`🦯 ${arcEndCount} colored-arc far end(s) given a thin support rod - a single-point weld can't credibly hold a full sweep`);

    // Pass 8b (stranded connector anchors): a line/bezier/spiral/arcline's
    // anchor point is normally ON the target shape's surface by
    // construction (computeConnectorAnchor slides the whole curve so one
    // point touches it) - but raiseDeltaAboveFloor can shift that same
    // point away from the surface to keep the connector's far reaches
    // clear of the base (see FLOOR_RAISE_BREAKS_TOUCH), leaving the
    // connector itself dangling even though the TARGET shape it aimed for
    // still gets its own real support elsewhere. Same fix as arcEndSupports
    // above, just for connectors instead of arc ornaments.
    let connectorStrandedCount = 0;
    connectorSupports.forEach((sup, si) => {
      if (supportStrandedPoint(sup.point, `connanchor_${si}`)) connectorStrandedCount++;
    });
    if (connectorStrandedCount > 0) console.log(`🦯 ${connectorStrandedCount} connector(s) (line/bezier/spiral/arcline) whose anchor got pushed off its target by the floor-clearance raise, given their own thin support rod`);

    console.log(`🦯 ${strutCount} support strut(s) drawn - ${connected.size}/${tier1Nodes.length} Tier-1 elements now physically connected into one structure rooted at the base`);
  }

  // ===== Gravitational stability check: this is meant to stand as a real
  // freestanding miniature, so its mass-weighted center of gravity (every
  // acrylic shape/lattice, metal skeleton connector, and the heavy wood base
  // itself, gathered into massEntries above as each was created) needs to
  // fall within the base's own footprint - a tall composition leaning hard
  // to one side would physically tip over otherwise. Runs AFTER the regular
  // last-resort struts (which fix "this shape has no skeleton contact," a
  // different problem) since this checks the WHOLE assembly's balance, not
  // any one shape's support. Only draws anything if the piece would actually
  // tip - never a default addition, same "last resort" spirit as the struts.
  if (baseNode && massEntries.length > 0) {
    const totalMass = massEntries.reduce((s, m) => s + m.mass, 0);
    const cog = massEntries.reduce((acc, m) => ({
      x: acc.x + m.x * m.mass, y: acc.y + m.y * m.mass, z: acc.z + m.z * m.mass
    }), { x: 0, y: 0, z: 0 });
    cog.x /= totalMass; cog.y /= totalMass; cog.z /= totalMass;

    const baseCenter = tier1WorldCenter(baseNode);
    const offX = cog.x - baseCenter.x, offZ = cog.z - baseCenter.z;
    const horizOffset = Math.hypot(offX, offZ);
    // Tipping is judged against the slab's REAL rectangular bottom face (the
    // full-size sharp rectangle actually resting on the desk - see
    // createBaseMesh3D), not the abstract circular placement footprint
    // baseNode.r - per-axis, since a slab tips over an edge, not a rim. For
    // a wide composition renderW comfortably exceeds 2r, so the circular
    // check both flagged genuinely stable pieces as tippy in X (drawing
    // outriggers they didn't need) and judged Z against the wrong number.
    // STABILITY_FOOTPRINT_FACTOR still keeps the safe region well inside
    // the physical edge on each axis.
    const foot = baseTopCapHalfExtents(baseNode);
    const stableHalfW = foot.hw * STABILITY_FOOTPRINT_FACTOR;
    const stableHalfD = foot.hd * STABILITY_FOOTPRINT_FACTOR;
    const stable = Math.abs(offX) <= stableHalfW && Math.abs(offZ) <= stableHalfD;
    // Desk-scale sanity: the base is assumed 12" wide in the real world (the
    // exact assumption baseAnchorHalfExtents' 1" strut margin already makes)
    // - scale world units to cm from that and report the piece's estimated
    // real weight (acrylic shapes, thin metal wires, wood base), which should
    // land in the comfortably-desk-plausible range.
    const cmPerWorld = 30.48 / foot.w;
    const estKg = totalMass * Math.pow(cmPerWorld, 3) / 1000;
    console.log(`⚖️ Center of gravity (${cog.x.toFixed(1)}, ${cog.y.toFixed(1)}, ${cog.z.toFixed(1)}), offset from base center=(${offX.toFixed(1)}, ${offZ.toFixed(1)}) vs stable half-extents (${stableHalfW.toFixed(1)}, ${stableHalfD.toFixed(1)}), est. real weight ~${estKg.toFixed(2)} kg at a 12" base - ${stable ? 'STABLE, no extra support needed' : 'UNSTABLE, adding an outrigger brace'}`);

    if (!stable) {
      // A diagonal buttress from the base's rim, in the direction the COG
      // overhangs, to the real overhanging shape nearest that COG - the
      // real physical fix for a top-heavy/off-center piece (a wider foot
      // under the overhanging mass), rendered the same dotted-strut way as
      // the base and its last-resort legs so it visually reads as "part of
      // the stand," not a shape. The COG itself is just a mass-weighted
      // average position, not a real surface - a structural element must
      // never terminate at a point with no shape actually there, so this
      // targets the nearest ACTUAL Tier-1 shape's real boundary instead of
      // the raw (empty-air) COG point.
      const dirX = offX / horizOffset, dirZ = offZ / horizOffset;
      const baseTopY = baseNode.y + baseNode.zHalf;
      // Clamped into the same safe anchor rectangle as every other base
      // touch point - never the bevel, never its 1" margin.
      const rimAnchor = baseAnchorHalfExtents(baseNode);
      const rimLocalX = Math.max(-rimAnchor.halfW, Math.min(rimAnchor.halfW, dirX * baseNode.r));
      const rimLocalZ = Math.max(-rimAnchor.halfD, Math.min(rimAnchor.halfD, dirZ * baseNode.r));
      const rimPoint = { x: baseCenter.x + rimLocalX, y: baseTopY, z: baseCenter.z + rimLocalZ };
      const nonBaseForCog = tier1Nodes.filter(n => !n.isBase);
      let overhangNode = null, overhangDist = Infinity;
      nonBaseForCog.forEach(n => {
        const wc = tier1WorldCenter(n);
        const d = Math.hypot(wc.x - cog.x, wc.y - cog.y, wc.z - cog.z);
        if (d < overhangDist) { overhangDist = d; overhangNode = n; }
      });
      if (overhangNode) {
        const oc = tier1WorldCenter(overhangNode);
        const rdx = rimPoint.x - oc.x, rdy = rimPoint.y - oc.y, rdz = rimPoint.z - oc.z;
        const rlen = Math.hypot(rdx, rdy, rdz) || 1;
        const towardRim = { x: rdx / rlen, y: rdy / rlen, z: rdz / rlen };
        const surfaceDist = semiCircleAwareDistance(overhangNode, towardRim);
        const cogPoint = { x: oc.x + towardRim.x * surfaceDist, y: oc.y + towardRim.y * surfaceDist, z: oc.z + towardRim.z * surfaceDist };
        drawClearStrut('base_outrigger', rimPoint, cogPoint, 3, strutRadiusCap(overhangNode), true);
        markConnectionPoint('conndot_outrigger_base', rimPoint, AUX_SUPPORT_HEAD_RADIUS);
        markConnectionPoint('conndot_outrigger_cog', cogPoint, AUX_SUPPORT_HEAD_RADIUS);
      }
    }
  }

  // Frame camera around the ACTUAL resolved structure - re-targets the orbit
  // at its true center and picks a distance that guarantees everything fits
  // the FOV, then resets to that standard distance/angle (alpha/beta/radius
  // are what a drag or pinch then moves, so this is also what "reset"
  // returns them to). This replaced an older formula that assumed the
  // sculpture's x/y stayed centered at world (0,0) - not necessarily true
  // for a real 2D composition, and the base can extend well below the
  // lowest shape - a fixed target/distance left real chunks of the
  // structure (in particular, large shapes whose own radius pushed them
  // outside the old fixed frame) outside the visible frustum entirely.
  if (camera3D) {
    const fov = 0.45; // Natural lens

    // Bounding SPHERE (not just a box) of every real point in the scene -
    // each Tier-1 node's center+radius, computed around their own centroid
    // as the camera target. The base is already one of tier1Nodes (see the
    // gather loops above), so it's automatically included here too.
    // tier1WorldCenter IS the world-space truth here - this used to inline
    // `-(n.z - n.zOffset)`, negating the whole depth distribution (the same
    // stale "world Z = -node.z" leftover tier1WorldCenter/overlapsAnyPlaced/
    // touchPointFacing each had to shed), which mirrored the orbit target's
    // Z whenever the composition wasn't depth-symmetric.
    const boundedPoints = tier1Nodes.map(n => { const wc = tier1WorldCenter(n); return { x: wc.x, y: wc.y, z: wc.z, r: n.r }; });
    if (boundedPoints.length === 0) boundedPoints.push({ x: 0, y: 0, z: 0, r: 5 });

    const targetX = boundedPoints.reduce((s, p) => s + p.x, 0) / boundedPoints.length;
    const targetY = boundedPoints.reduce((s, p) => s + p.y, 0) / boundedPoints.length;
    const targetZ = boundedPoints.reduce((s, p) => s + p.z, 0) / boundedPoints.length;

    // Distance needed so a sphere of `boundingRadius` centered at the
    // target fits entirely inside the FOV cone from the camera - the
    // standard "fit a sphere in a cone" relation (sin, not tan, since this
    // bounds points at ANY distance from the camera, not just ones exactly
    // at the target's own depth).
    let boundingRadius = 1;
    boundedPoints.forEach(p => {
      const d = Math.hypot(p.x - targetX, p.y - targetY, p.z - targetZ) + p.r;
      boundingRadius = Math.max(boundingRadius, d);
    });
    const dist = (boundingRadius / Math.sin(fov / 2)) * 1.08; // small margin so nothing touches the frame edge

    // upperRadiusLimit is a HARD ceiling on how far ANY zoom - the auto-fit
    // below, or the user's own manual scroll/pinch - is allowed to push the
    // camera. It used to be a fixed 2000, which was fine back when shapes
    // always got compacted into a tight cluster; now that shapes keep their
    // exact 2D positions (no more rearranging), a real composition's
    // footprint can legitimately need more than that, which was silently
    // clamping the auto-fit distance short AND capping how far the user
    // could manually back away to compensate - "can't zoom out enough to
    // see what's going on." Give it real headroom over whatever THIS
    // composition actually needs, not a one-size-fits-all guess.
    // Always safe to widen the zoom-out ceiling to fit whatever this build
    // actually needs, even when preserving the camera's own position below -
    // raising a limit can't itself move the camera.
    camera3D.upperRadiusLimit = Math.max(2000, dist * 3);
    // The far clip plane must comfortably exceed how far the camera can
    // now actually zoom out to, or the camera could end up sitting beyond
    // its own visible range at the new upperRadiusLimit.
    camera3D.maxZ = Math.max(5000, camera3D.upperRadiusLimit * 1.5);
    camera3D.fov = fov;

    if (!preserveCamera) {
      camera3D.target = new BABYLON.Vector3(targetX, targetY, targetZ);
      camera3D.alpha = -Math.PI / 2;
      camera3D.beta = Math.PI / 2;

      // Split the difference between the two extremes tried so far: matched
      // to the 2D canvas's own zoom (continuous-feeling transition, but
      // often cut off real chunks of the piece - especially the base) and
      // the full bounding-sphere fit (guarantees everything's visible, but
      // starts further out than the 2D view ever was). The midpoint still
      // shows nearly everything on entry while feeling closer to a
      // continuation of the 2D view than a hard zoom-out.
      const canvasMatchDist = window.innerHeight / (2 * K3D_SCALE * Math.tan(fov / 2));
      const startDist = (canvasMatchDist + dist) / 2;
      camera3D.radius = Math.min(Math.max(startDist, camera3D.lowerRadiusLimit || 5), camera3D.upperRadiusLimit);
      console.log(`📷 Camera: radius=${camera3D.radius.toFixed(1)} (2D-matching=${canvasMatchDist.toFixed(1)}, full-fit=${dist.toFixed(1)}), FOV=${fov}, target=(${targetX.toFixed(1)}, ${targetY.toFixed(1)}, ${targetZ.toFixed(1)}), boundingRadius=${boundingRadius.toFixed(1)}, upperRadiusLimit=${camera3D.upperRadiusLimit.toFixed(1)}`);
    }
  }
  
  console.log(`✅ Converted ${totalConverted} elements to 3D!`);
  console.log('📈 Conversion breakdown:', {
    skeletons: `${conversionStats.skeletons}/${shapes.length}`,
    ornaments: `${conversionStats.ornaments}/${ornaments.length}`,
    // conversionStats.lines counts ALL four connector types (line/bezier/
    // arcline/spiral - see the realizeConnector call sites), so the
    // denominator must too, or this prints impossible ratios like "12/3"
    connectors: `${conversionStats.lines}/${lines.length + beziers.length + arcLines.length + spirals.length}`,
    lattices: `${conversionStats.lattices}/${lattices.length}`
  });
  
  if (conversionStats.failed.length > 0) {
    console.warn(`⚠️ Failed to convert ${conversionStats.failed.length} elements:`);
    console.table(conversionStats.failed);
  }
  
  if (totalConverted === 0) {
    console.warn('⚠️ No shapes were converted. The shapes might not be in the expected format.');
    console.log('Trying to inspect first shape:', shapes[0] || ornaments[0]);
  } else {
    console.log(`🎉 Successfully created ${totalConverted} 3D objects! Drag/swipe to orbit, scroll/pinch to zoom.`);
  }
  
  // Sky renders in group 0, artwork in group 1: the background can never
  // occlude the artwork, no matter how far the camera flies (group 0 always
  // renders - and is depth-tested - before group 1, regardless of actual
  // world-space distance)
  babylonScene.meshes.forEach(m => {
    m.renderingGroupId = m.name.startsWith('skyFace_') ? 0 : 1;
  });

  // Every mesh above was just freshly disposed and recreated - re-point the
  // shadow generator (if spotlight mode has one) at the new ones. A no-op
  // when spotlight mode is off.
  refreshShadowCasters();
  // Same reason: every shape body just got a brand new material too, built
  // at its own exact drawn colour (intensityScale 1) regardless of whatever
  // the lighting panel is currently set to - re-applying here is what makes
  // a scramble (or any other rebuild) keep the CURRENT Intensity/Warmth
  // instead of the new shapes silently resetting to the neutral look.
  applySpotlightLighting();
  // Same reason again: the base/struts just got freshly disposed and
  // recreated (all newly isVisible=true by default) - re-apply so a
  // scramble while the structure is hidden doesn't silently bring it back.
  applyStructureVisibility();
}

// ===== Helpers for exact 2D -> 3D conversion =====
const K3D_SCALE = 8;
const K3D_BLACK = { r: 0, g: 0, b: 0, a: 1 };
// Global 3D translucency: multiplier on every colored BODY's own 2D alpha
// (shape fills, concentric rings, halo rings, lattice cells, open-shape
// textures). 3D reads more opaque than the 2D original at the same alpha -
// a real volume stacks its front face, side walls, and back face into the
// same pixel, where the 2D only ever painted one translucent layer - so
// the bodies get a uniform extra dose of translucency here. Deliberately
// NOT applied to black outlines/wires, the marble base, acrylic struts, or
// the red contact dots - the crisp opaque strokes are part of the 2D look.
const BODY_ALPHA_3D = 0.6; // was 0.75 - still read heavier than the 2D wash (front face + walls + back face all stack into one pixel)
// "Bring a little more color into 3D": alpha-blending a 0.6-alpha body over
// the pale paper wash dilutes every hue toward pastel, so the translucency
// fix washed the palette out. Compensate with SATURATION, not alpha - push
// each body color away from its own gray (luminance-preserving), so the
// pigment reads stronger while the watercolor translucency stays.
const BODY_SATURATION_3D = 1.35;
// Halo rings need their own, stronger push - see createHalo3D, which is
// muted twice over (once by the 2D sketch itself, again by its own darken)
// before BODY_SATURATION_3D's shared compensation ever runs.
const HALO_SATURATION_BOOST = 1.3;
function saturate3D(rgba, strength = BODY_SATURATION_3D) {
  const lum = 0.2126 * rgba.r + 0.7152 * rgba.g + 0.0722 * rgba.b;
  const push = v => Math.max(0, Math.min(1, lum + (v - lum) * strength));
  return { r: push(rgba.r), g: push(rgba.g), b: push(rgba.b), a: rgba.a };
}
// The one-stop body color treatment: saturation compensation + the global
// translucency multiplier. Every colored BODY site uses this (or, where
// alpha is handled separately - open-shape textures - saturate3D directly).
function bodyColor3D(rgba) {
  const c = saturate3D(rgba);
  c.a = rgba.a * BODY_ALPHA_3D;
  return c;
}
// Nearly-invisible "cast acrylic" glass look - used for concentricArc's solid
// wedge (see createConcentricArc3D), a real physical body the nested
// stroke-only rings visually sit embedded inside, instead of bare open wire.
// Kept at 95% transparent with no outline (see createConcentricArc3D) - just
// enough presence to read as "there's clear material holding this together"
// without visually competing with the rings it's supporting.
const CLEAR_ACRYLIC_COLOR = { r: 0.93, g: 0.96, b: 0.99, a: 0.05 };

// ===== Volume density gradient (EXPORT ONLY) =====
// On screen a body is 60% translucent, and that is what makes it read as a
// volume: you see through it to its far wall and the layering does the work.
// The AR export can't use that - USDZ_BODY_OPACITY is 1 because translucent
// surfaces in RealityKit pick up environment reflection and washed every
// vivid colour to pastel, and 50+ of them sort badly. With translucency gone
// nothing conveyed volume at all, so shapes exported flat and plasticky.
//
// This replaces it: colour becomes a FUNCTION OF 3D POSITION - dense and
// saturated at the core, lifting toward the rim, like pigment suspended in
// cast acrylic. Because the field is evaluated in the mesh's own local space,
// every face of a shape agrees with every other, so the object reads as one
// carved solid instead of six independently painted faces. That is the whole
// point; a per-face material can't express it.
//
// This is a deliberate divergence from the app's rendering, not drift: the
// two are conveying the same property through different means because one of
// them can afford translucency and the other cannot.
// Gentler and with a much broader dense plateau than the first pass, for the
// same reason as the opacity note below: on a flat face most of the surface
// sits at high `t`, so a strong ramp starting early bleaches the majority of
// every shape and reads as an unfinished fill rather than as depth.
const USDZ_GRADIENT_STRENGTH = 0.35; // 0 = flat (feature off), 1 = full falloff
const USDZ_GRADIENT_CORE = 0.55;     // t at or below this stays fully dense
const USDZ_GRADIENT_LIFT = 0.45;     // how far the rim lifts toward white
// Open shapes' gradient is the WHOLE visual identity - the 2D original pools
// solid at the closed side and fades to nothing at the open side - not a
// barely-there depth hint on top of an otherwise-solid face like the radial
// one above. No dead zone (fading starts immediately past the closed side)
// and a much stronger lift, so the open edge genuinely reads as diffuse
// rather than "still basically the same colour".
const USDZ_OPEN_GRADIENT_LIFT = 0.96; // how far the open side lifts toward white - near-total, reads as transparent since AR bodies can't actually go translucent
const USDZ_OPEN_GRADIENT_POOL_BOOST = 0.45; // extra saturation at t=0, concentrated at the pool and fading out by mid-gradient
const USDZ_RAMP_TEXELS = 256;        // width of the 1-D ramp PNG
// Per-mesh tessellation ceiling, SOFT: once reached, the remaining triangles
// of that pass are emitted unsplit, so the real total can overshoot by the
// tail of one level (measured ~13%). USDA is ASCII, so every added triangle
// costs real bytes and parse time on the phone - this is what stops a dense
// composition producing a file the device won't open.
const USDZ_GRADIENT_MAX_TRIS = 2000;

// Marks a mesh as a solid coloured BODY, i.e. something the density gradient
// should fill. Deliberately NOT applied to: black outlines and wires (crisp
// opaque strokes are part of the 2D look), the struts and base (their own
// materials), or the three CLEAR_ACRYLIC_COLOR volumes, which are meant to be
// nearly invisible and which a gradient would only make noticeable.
// The clear-acrylic volumes (5% alpha) exist to suggest "there is clear material
// holding this together" in a scene where bodies are translucent. In AR bodies
// are OPAQUE, so the acrylic contributes nothing visible - while its surfaces sit
// coplanar with the shape they wrap (the semiCircle ghost is a full disc over a
// half-disc), which is a textbook z-fighting pair and the likeliest cause of
// the shimmer on open semicircles. Dropped from USDZ, kept in OBJ so the Rhino
// output is unchanged.
function tagAcrylicVolume(mesh) {
  if (!mesh) return mesh;
  mesh.metadata = Object.assign({}, mesh.metadata, { skipUsdz: true });
  return mesh;
}

function tagVolumeBody(mesh) {
  if (!mesh) return mesh;
  mesh.metadata = Object.assign({}, mesh.metadata, { volumeGradient: true });
  return mesh;
}

// Local-space centre, plus BOTH the bounding-corner radius (used to size
// tessellation) and the range of distances that actually occur on the
// surface (used to normalise the ramp).
//
// Those two are very different numbers, and using the wrong one flattens the
// effect: a cube's centroid is buried inside the solid, so its nearest
// SURFACE point sits at 0.58 of the corner radius. Normalising against the
// corner radius would confine every visible pixel to the 0.58-1.0 part of
// the ramp - the dense core would exist only inside the material, where
// nobody can see it. Normalising against the observed range instead means
// every shape uses the full ramp whatever its proportions, so a flat disc
// and a chunky prism both read properly.
function densityField(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const R = Math.max(Math.hypot(maxX - cx, maxY - cy, maxZ - cz), 1e-6);
  let dMin = Infinity, dMax = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const d = Math.hypot(positions[i] - cx, positions[i + 1] - cy, positions[i + 2] - cz);
    if (d < dMin) dMin = d;
    if (d > dMax) dMax = d;
  }
  if (!isFinite(dMin)) dMin = 0;
  return { cx, cy, cz, R, dMin, dMax: Math.max(dMax, dMin + 1e-6) };
}

// 0 at the densest point of the surface, 1 at the furthest. Deliberately NOT
// eased here - the easing curve lives in the ramp texture, so `t` only ever
// has to interpolate linearly between vertices, which a GPU does exactly.
function densityAt(field, x, y, z) {
  const d = Math.hypot(x - field.cx, y - field.cy, z - field.cz);
  const t = (d - field.dMin) / (field.dMax - field.dMin);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// Directional counterpart to densityField/densityAt, for open shapes: 0/1
// come from projecting onto a fixed 2D direction (the shape's own
// gradientAngle, via metadata.exportGradientDir) instead of radial distance
// from a centre. Same interface - min/max measured over the FINAL exported
// positions, so added tessellation vertices are included - so it slots into
// the same st-assignment path in collectUsdParts.
function linearGradientField(positions, dirX, dirY) {
  let minT = Infinity, maxT = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const t = positions[i] * dirX + positions[i + 1] * dirY;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  if (!isFinite(minT)) minT = 0;
  return { dirX, dirY, minT, maxT: Math.max(maxT, minT + 1e-6) };
}
function linearGradientAt(field, x, y) {
  const t = (x * field.dirX + y * field.dirY - field.minT) / (field.maxT - field.minT);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// The colour at a given t: full strength through the core, lifting toward
// white past USDZ_GRADIENT_CORE. saturate3D is reused so the dense end keeps
// exactly the saturation compensation every other body colour gets.
function densityColorAt(rgba, t) {
  const span = 1 - USDZ_GRADIENT_CORE;
  const k = span <= 0 ? 0 : Math.max(0, Math.min(1, (t - USDZ_GRADIENT_CORE) / span));
  // smoothstep - a broad dense core with the falloff gathered near the rim,
  // which reads as pigment density rather than as a linear wash.
  const eased = k * k * (3 - 2 * k) * USDZ_GRADIENT_STRENGTH;
  const core = saturate3D(rgba);
  const lift = (v) => v + (1 - v) * USDZ_GRADIENT_LIFT * eased;
  return { r: lift(core.r), g: lift(core.g), b: lift(core.b), a: rgba.a };
}

// Open-shape counterpart to densityColorAt: pools solid AND EXTRA SATURATED
// at t=0 (the closed side, per exportGradientDir - see createOpenShape3D),
// then lifts toward white across the FULL range to t=1 (the open side, near
// enough to white to read as transparent - AR bodies can't actually go
// translucent, so pushing color instead of alpha is the only lever). Smooth
// ease-in-out rather than densityColorAt's core-then-falloff shape, since
// there's no "dense plateau" to preserve here - the whole point is an
// intense pooled-to-diffuse read end to end, matching the live 2D gradient.
function openGradientColorAt(rgba, t) {
  const eased = t * t * (3 - 2 * t);
  const core = saturate3D(rgba);
  // Extra vividness at the pool, spreading each channel further from the
  // grey average - fades out over the same curve as the white lift, so the
  // two handoff smoothly instead of fighting partway through.
  const boost = USDZ_OPEN_GRADIENT_POOL_BOOST * (1 - eased);
  const avg = (core.r + core.g + core.b) / 3;
  const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  const saturated = {
    r: clamp01(avg + (core.r - avg) * (1 + boost)),
    g: clamp01(avg + (core.g - avg) * (1 + boost)),
    b: clamp01(avg + (core.b - avg) * (1 + boost))
  };
  const lift = (v) => v + (1 - v) * USDZ_OPEN_GRADIENT_LIFT * eased;
  return { r: lift(saturated.r), g: lift(saturated.g), b: lift(saturated.b), a: rgba.a };
}

function p5ColToRGBA(c) {
  // Handle p5.Color object
  if (c && c.levels) {
    return {
      r: c.levels[0] / 255,
      g: c.levels[1] / 255,
      b: c.levels[2] / 255,
      a: (c.levels[3] !== undefined ? c.levels[3] : 255) / 255
    };
  }
  // Handle hex string '#rrggbb' or '#rrggbbaa' (sceneReport format)
  if (typeof c === 'string' && c[0] === '#') {
    const hex = c.slice(1);
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      a: hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    };
  }
  // Handle already-converted {r,g,b,a} object
  if (c && c.r !== undefined && c.g !== undefined && c.b !== undefined) {
    return { r: c.r, g: c.g, b: c.b, a: c.a !== undefined ? c.a : 1 };
  }
  // Handle number (0 = black in p5)
  if (typeof c === 'number') {
    const v = c / 255;
    return { r: v, g: v, b: v, a: 1 };
  }
  // Default gray
  return { r: 0.5, g: 0.5, b: 0.5, a: 1 };
}

// Unlit material = EXACT color match with 2D (no light darkening)
function unlitMat(name, rgba) {
  const m = new BABYLON.StandardMaterial(name, babylonScene);
  m.emissiveColor = new BABYLON.Color3(rgba.r, rgba.g, rgba.b);
  m.diffuseColor = new BABYLON.Color3(0, 0, 0);
  m.specularColor = new BABYLON.Color3(0, 0, 0);
  m.disableLighting = true;
  m.alpha = rgba.a;
  m.backFaceCulling = false;
  // Exact flat color for OBJ export, so the exporter never has to guess a
  // material's true color from lighting-affected properties
  m.metadata = { exportColor: { r: rgba.r, g: rgba.g, b: rgba.b, a: rgba.a } };
  return m;
}

// Tube stroke (2D strokeWeight analog). Path points are LOCAL coords around origin.
// `parent` (optional): a TransformNode carrying a contact-tilt orientation -
// when given, x/y/rotZ should already be the shape-local values (0/0/0) since
// the node itself supplies the world position/rotation.
// `lit`: true for the rare stroke tubes that ARE a shape's own body (squiggle/
// arc's drawn stroke, concentricArc's rings - types with no separate fill
// mesh) so they pick up the spotlight highlight like every other shape body.
// Defaults false since most callers are outlines/edges, which stay flat
// black ink regardless of lighting mode.
function makeStrokeTube(name, localPts, radius, rgba, x, y, z, rotZ = 0, parent = null, lit = false) {
  if (!localPts || localPts.length < 2) return null;
  const tube = BABYLON.MeshBuilder.CreateTube(name, {
    path: localPts,
    radius: Math.max(radius, 0.08),
    tessellation: 16, // was 8: visibly faceted/blocky on large or close-up curves
    cap: BABYLON.Mesh.CAP_ALL
  }, babylonScene);
  tube.position = new BABYLON.Vector3(x, y, z);
  tube.rotation.z = rotZ;
  tube.material = lit ? shapeBodyMat(name + '_mat', rgba) : unlitMat(name + '_mat', rgba);
  // Always a closed tube here (unlike shapeBodyMat's other, flat/prism
  // consumers) - seen from outside only, so the far inner wall never needs
  // to render. A per-call material (not cached), so this can't leak onto
  // any other mesh - see strutSurfaceMaterial's identical fix for why it
  // matters: without it, a translucent tube shows its own far wall through
  // the near one, doubling its tessellation seams into a rippled look.
  tube.material.backFaceCulling = true;
  if (lit) shapeBodyMeshes.push(tube);
  if (parent) tube.parent = parent;
  return tube;
}

// Outlines a prism from all sides: matching perimeter tubes on the front and
// back faces, plus a vertical tube at each corner connecting them (the
// Z-axis edges) - without those, the depth walls between corners show as
// bare, unbordered seams from oblique angles. `loopPts` is the front-face
// outline path (local XY, z=0) exactly as passed to makeStrokeTube today.
// `edgeCorners` lists which points get a vertical edge - pass a subset (or
// none) for smooth/curved perimeters that have no true corners. Skip the
// back tube on finely-tessellated curves (circle/arc paths): viewed near
// edge-on, two close, near-parallel many-segment tubes interleave into a
// herringbone/hatch pattern - a straight-edged loop (few points) doesn't
// have enough segments for that to happen, so it's safe to double there.
function addPrismOutline(prefix, loopPts, depth, swr, x, y, z, rotZ, edgeCorners = [], addBack = true, parent = null) {
  // Snapshot the corner coordinates BEFORE building the front/back loop
  // tubes below - edgeCorners is commonly a handful of elements taken
  // straight out of loopPts (e.g. rp.slice(0,4)), so it shares the same
  // Vector3 instances. CreateTube's Path3D can end up normalizing/reusing
  // those instances internally; reading x/y off them afterward risked
  // picking up whatever it left behind instead of the real corner.
  const corners = edgeCorners.map(v => ({ x: v.x, y: v.y }));
  const frontZ = -(depth / 2 + 0.1);
  const backZ = depth / 2 + 0.1;
  makeStrokeTube(`${prefix}_front`, loopPts, swr, K3D_BLACK, x, y, z + frontZ, rotZ, parent);
  if (addBack) makeStrokeTube(`${prefix}_back`, loopPts, swr, K3D_BLACK, x, y, z + backZ, rotZ, parent);
  corners.forEach((v, i) => {
    makeStrokeTube(`${prefix}_edgeZ${i}`, [
      new BABYLON.Vector3(v.x, v.y, frontZ),
      new BABYLON.Vector3(v.x, v.y, backZ)
    ], swr, K3D_BLACK, x, y, z, rotZ, parent);
  });
}

// P5 arc angles (y-down) -> Babylon local points (Y flipped)
function arcPathLocal(r, a0, a1, segments = 48) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = a0 + (a1 - a0) * (i / segments);
    pts.push(new BABYLON.Vector3(r * Math.cos(t), -r * Math.sin(t), 0));
  }
  return pts;
}

// Extrude a closed XY profile into a prism along Z (deterministic orientation,
// unlike cylinder arc/tessellation whose start angle is ambiguous)
function extrudePrism(name, profileXY, depth, rgba, x, y, z, rotZ = 0, parent = null) {
  const closed = profileXY.slice();
  const first = closed[0], last = closed[closed.length - 1];
  if (first.x !== last.x || first.y !== last.y) closed.push(first.clone());
  const mesh = BABYLON.MeshBuilder.ExtrudeShape(name, {
    shape: closed,
    path: [new BABYLON.Vector3(0, 0, -depth / 2), new BABYLON.Vector3(0, 0, depth / 2)],
    cap: BABYLON.Mesh.CAP_ALL,
    sideOrientation: BABYLON.Mesh.DOUBLESIDE
  }, babylonScene);
  mesh.position = new BABYLON.Vector3(x, y, z);
  mesh.rotation.z = rotZ;
  mesh.material = shapeBodyMat(name + '_mat', rgba);
  shapeBodyMeshes.push(mesh);
  if (parent) mesh.parent = parent;
  return mesh;
}

// ===== Body + skeleton layout: shapes stay exactly where the 2D put them =====
// "Do not rearrange at all, this 2D is beautiful" - shapes (both skeleton
// "primary" shapes and every solid ornament/lattice) are the BODY: they keep
// their EXACT original 2D x/y (and rotation) with zero search or drift, only
// gaining a Z position (see buildElementTree()) so real 3D volumes don't
// interpenetrate - the one thing the 2D composition never had to resolve.
// Lines/beziers/arcs/spirals are the SKELETON: they're what actually does
// the connecting between shapes (see computeConnectorAnchor() and the
// connector pass below), reaching genuinely from one shape's surface to
// another's rather than the shapes needing to touch each other directly.
// Two tiers:
//   Tier 1 - anything with a real bounding volume (both skeletons, filled/open
//   circle/rect/triangle/semiCircle, concentricCircle, concentricArc and halo
//   (both wrapped in a clear acrylic wedge/cylinder behind their nested rings,
//   since the rings themselves are stroke-only/decal-like on their own),
//   lattices): mutual non-overlap is a HARD constraint, resolved via
//   buildElementTree() below - by depth (Z) alone, since X/Y is frozen.
//   Tier 2 - pass-through elements with no real volume (squiggle, shape-type
//   arc, and the 4 connector types): no overlap-avoidance needed (matches
//   the user's original "arcs/lines/beziers/spirals may pass through shapes"
//   exemption) - just a real touch point (or two, for a span) via
//   computeConnectorAnchor(), defined near the connector mesh functions
//   below.
//
// IMPORTANT: window.skeletons/window.ornaments are the SAME live objects the
// running 2D p5 draw loop reads every frame (it keeps running while 3D mode is
// active), and window.sceneReport (lines/beziers/arcs/spirals/lattices) is not
// reset between 3D-mode toggles and is what gets saved for gallery/Firebase.
// NOTHING here may write back onto shape.x/y or report point data - every
// resolved position lives in fresh, function-local Maps/objects for the
// duration of a single convertShapesTo3D() call.
const SOLID_CONTACT_PAD = 0.15; // 3D units - small clearance so "touching" doesn't z-fight

function pixelToWorld(px, py) {
  return { x: (px - window.innerWidth / 2) / K3D_SCALE, y: -(py - window.innerHeight / 2) / K3D_SCALE };
}
function worldToPixel(wx, wy) {
  return { x: wx * K3D_SCALE + window.innerWidth / 2, y: -wy * K3D_SCALE + window.innerHeight / 2 };
}
// Same x/y projection create3DShape uses below - factored out so the two can
// never drift apart.
function projectXY3D(shape) {
  return pixelToWorld(shape.x, shape.y);
}

// Bounding-sphere radius for a lattice - no per-type formula exists yet since
// lattices don't have a targetSize like shapes; cells' poly points are
// already offsets from (lattice.x, lattice.y) (see create3DLattice), so the
// farthest point across every cell IS the bounding radius directly. Ignores
// the per-cell perspective tilt create3DLattice infers later - a documented
// approximation, fine for a bounding sphere.
// Reclassified as a rect: bounding box of every cell's polygon (not just a
// max-distance-from-center scalar) so the lattice gets a REAL rectangular
// profile - see the tier1Nodes gather loop in convertShapesTo3D, which
// turns {w,h} here into the same polygon localProfile every rect uses.
// Derives a lattice's TRUE local geometry for the Tier-1 PLACEMENT profile -
// its own rotation angle (from the grid's actual row direction, not
// assumed axis-aligned) and the width/height of its REAL rotated
// footprint. A naive axis-aligned min/max bounding box around a ROTATED
// grid bounds to an oversized axis-aligned box that doesn't match its true
// silhouette; rotating every cell point into the lattice's OWN local
// (unrotated) frame first, THEN bounding that, gives the true w/h. Used by
// latticeVolumeRadius3D for placement, and by create3DLattice only to size
// its overall depth (create3DLattice renders each cell from its own RAW
// points directly instead, which needs no separate rotation at all - see
// its own comment for why).
function latticeLocalGeometry(lattice) {
  const cells = lattice && lattice.cells || [];
  const refCell = cells.find(c => (c.poly || c.points) && (c.poly || c.points).length >= 4);
  if (!refCell) return null;
  const refPoly = refCell.poly || refCell.points;
  // Grid row-direction (a cell's first edge) defines the lattice's own
  // rotation, in p5 pixel space (y-down).
  const angle = Math.atan2(refPoly[1].y - refPoly[0].y, refPoly[1].x - refPoly[0].x);
  const cosA = Math.cos(-angle), sinA = Math.sin(-angle);
  const toLocal = p => ({ x: p.x * cosA - p.y * sinA, y: p.x * sinA + p.y * cosA });

  let minPx = Infinity, maxPx = -Infinity, minPy = Infinity, maxPy = -Infinity;
  cells.forEach(cell => {
    const poly = cell.poly || cell.points;
    if (!poly || poly.length < 4) return;
    poly.map(toLocal).forEach(p => {
      minPx = Math.min(minPx, p.x); maxPx = Math.max(maxPx, p.x);
      minPy = Math.min(minPy, p.y); maxPy = Math.max(maxPy, p.y);
    });
  });
  if (!isFinite(minPx) || maxPx <= minPx || maxPy <= minPy) return null;

  return {
    rotZ: -angle, // matches every other shape's `rotZ = -(p5 rotation)` convention
    w: (maxPx - minPx) / K3D_SCALE, h: (maxPy - minPy) / K3D_SCALE,
    // The cell grid's own points are offsets from the lattice's anchor
    // (lattice.x, lattice.y - see create3DLattice), NOT necessarily
    // centered on it. minX/maxX/minY/maxY (world units, in the lattice's own
    // rotated local frame) are the TRUE bounds relative to that anchor -
    // used instead of assuming a symmetric +-w/2 box, which understated the
    // shape's real reach on whichever side the anchor sits off-center
    // toward (support struts landing short of the actual rendered cells).
    minX: minPx / K3D_SCALE, maxX: maxPx / K3D_SCALE,
    minY: minPy / K3D_SCALE, maxY: maxPy / K3D_SCALE
  };
}

function latticeVolumeRadius3D(lattice) {
  const geo = latticeLocalGeometry(lattice);
  if (!geo) return null;
  const corners = [
    { x: geo.minX, y: geo.minY }, { x: geo.maxX, y: geo.minY },
    { x: geo.maxX, y: geo.maxY }, { x: geo.minX, y: geo.maxY }
  ];
  // Real bounding radius from the ANCHOR (local origin) - the farthest of
  // the box's 4 true corners from (0,0), not half the diagonal of a box
  // wrongly assumed to be centered there.
  const r = Math.max(...corners.map(c => Math.hypot(c.x, c.y)));
  return { r, zOffset: 0, w: geo.w, h: geo.h, rotZ: geo.rotZ, corners };
}

// Deterministic (no RNG), evenly-distributed unit vectors on a sphere - used
// to search for a clear attachment direction around a target when the
// "preferred" direction is blocked by some other already-placed element.
// Z bias derived from an element's position in the 2D DRAW ORDER, not an
// arbitrary shuffled hash - "keep elements in their layered order as they
// appear in 2D." globalIndex is assigned in exactly the 2D paint sequence
// (skeletons, then ornaments, then lattices - see the gather loops in
// convertShapesTo3D, matching draw()'s own `skeletons.forEach` then
// `ornaments.forEach`), so a MONOTONIC function of it - later index =
// smaller (more negative) bias - means whatever was drawn later (sitting
// visually "on top" in the 2D composition) is consistently biased toward
// the camera-facing side in 3D, and whatever was drawn earlier toward the
// back, instead of a pseudo-random spread with no relationship to the
// original layering. A node's real world Z is its resolved node.z directly
// (see tier1WorldCenter) and the camera looks toward +Z (confirmed via its
// alpha/beta setup), so SMALLER world Z is nearer the camera - hence
// "later drawn" needs a bias toward NEGATIVE, not positive. Also still
// gives every element a genuinely different Z lean, so the tree keeps
// gaining real depth instead of collapsing into a flat XY-only card (2D
// data has no Z at all to begin with). ELEMENT_ORDER_SPAN sets where the
// back/front split falls (>=0 back-biased, <0 front-biased at index
// ELEMENT_ORDER_SPAN/2) - used to be a fixed 50 "bigger than any real
// composition gets," but real compositions routinely exceed that now (this
// session's own stress-testing reached 50+ elements on its own), and once
// globalIndex runs past a fixed span, EVERY later element - the whole back
// half of a bigger composition - piles into the same front-biased bucket
// while only the first ~25 stay back-biased, a systemic "front heavy, why
// isn't the back of the base used" skew that gets WORSE the more elements
// there are, exactly backwards from what a fixed normalizer was supposed to
// give. convertShapesTo3D now sets this to the actual element count for
// THIS composition before assigning any globalIndex, so the back/front
// split always falls at the true midpoint regardless of size - still a
// module-level constant (not a parameter) so every call site stays a pure
// function of globalIndex alone.
let ELEMENT_ORDER_SPAN = 50;
function synthesizedZBias(globalIndex) {
  return 0.5 - (Math.max(0, globalIndex) / ELEMENT_ORDER_SPAN);
}

// Real 3D overlap check between a candidate placement for `cur` and every
// already-placed Tier-1 node - checked against the FULL placed set, not
// just whichever node prompted the check, so non-overlap is a global
// invariant, not just a local one. Uses each side's REAL oriented support
// distance (see supportDistanceWorld) toward the other's actual direction,
// not a flat sphere radius - a rect/triangle reaches its full `r` only at
// its corners, so a sphere-based check was both too permissive along the
// diagonals it never fully covered and unnecessarily conservative along
// its flatter sides. `cur`/each `placed` entry needs the full Tier-1 node
// shape (x,y,z,zOffset,r,shapeType,s,rotZ,localProfile,zHalf,contactDir) -
// `contactDir` on `cur` is the TENTATIVE direction being tested (may not
// be committed yet), giving an accurate prediction of the tilt it would
// actually receive if this candidate is chosen.
function overlapsAnyPlaced(cur, placed, pad = SOLID_CONTACT_PAD) {
  // Must match tier1WorldCenter's sign (node.z - node.zOffset) - this was
  // `+ zOffset`, invisible for every shape type except concentricCircle/
  // concentricArc (the only nonzero-zOffset ones). Since BOTH curCenterZ and
  // pCenterZ used the same wrong sign, it silently canceled out whenever
  // neither or both sides had a zOffset - but for a pair where only ONE side
  // does, the resulting ddz (and everything downstream: direction, real
  // touch distance) was off by 2x that shape's zOffset, which is exactly
  // the kind of thing that shows up as "not quite touching" or subtly wrong
  // relative positioning around a concentricCircle/concentricArc.
  const curCenterZ = cur.z - cur.zOffset;
  return placed.some(p => {
    const pCenterZ = p.z - p.zOffset;
    const ddx = p.x - cur.x, ddy = p.y - cur.y, ddz = pCenterZ - curCenterZ;
    const centerDist = Math.hypot(ddx, ddy, ddz);
    if (centerDist < 1e-9) return true; // coincident centers - definitely overlapping
    // dirToP points FROM cur TOWARD p - that's the direction CUR must reach
    // OUT along to face p, so it's cur's own query direction; p's query
    // direction is the opposite (FROM p back TOWARD cur). Swapping these
    // (each shape queried in the direction pointing AWAY from the other)
    // silently gives the same answer for every symmetric profile here
    // (isotropic discs, and rect - centrally symmetric) but a WRONG one for
    // triangle (not centrally symmetric), so keep them paired correctly.
    const dirToP = { x: ddx / centerDist, y: ddy / centerDist, z: ddz / centerDist };
    const dirToCur = { x: -dirToP.x, y: -dirToP.y, z: -dirToP.z };
    const reachP = supportDistanceWorld(p, p.contactDir, dirToCur);
    const reachCur = supportDistanceWorld(cur, cur.contactDir, dirToP);
    // The gap enforced between two shapes needs to SCALE with how big they
    // are, not stay a fixed tiny constant - a technically-real gap of
    // `pad` (0.15 world units) is a fine amount of separation between two
    // small shapes but visually disappears against two large ones (e.g. a
    // big concentricCircle sitting just behind a big triangle can still
    // read as "inside" it, especially through anything semi-transparent),
    // even though nothing is actually overlapping.
    const minGap = Math.max(pad, (cur.r + p.r) * 0.06);
    return centerDist < reachP + reachCur + minGap - 1e-6;
  });
}

// Hard floor: the base is the literal ground of this structure - "nothing
// should live in or below it," not just "nothing should overlap it." Looks
// up the base node fresh from `nodeList` each call (cheap - the list is
// small) rather than threading an extra parameter through every placement
// function; `testNode` needs {y, contactDir, ...profile fields} exactly
// like any supportDistanceWorld caller. The base itself is always seeded
// first (guaranteed largest), so by the time anything else is being
// placed its resolved y/zHalf are already final. The threshold is the
// base's own TOP (y + zHalf), not just its bottom - the base must be
// lower than the lowest shape, so nothing may share ANY of the base's own
// vertical span (attaching to its side/top face is still fine, that's a
// real kissing contact - it's just that the point of contact itself, and
// everything beyond it, has to clear the base's top).
function violatesFloor(testNode, nodeList) {
  if (testNode.isBase) return false;
  const base = nodeList.find(n => n.isBase);
  if (!base || base.y === undefined) return false;
  const floorY = base.y + base.zHalf;
  const lowestY = testNode.y - trueLowestReach(testNode, testNode.contactDir);
  return lowestY < floorY - 1e-6;
}

// REAL occlusion analysis, not just a soft depth-bias preference: for every
// already-placed node whose 2D silhouette actually overlaps `node`'s
// (bounding-circle test on their ORIGINAL 2D positions/radii - if they
// don't overlap in 2D, nothing about their front/back order was ever
// visually decided, so no constraint applies), painter's-algorithm draw
// order (globalIndex - see synthesizedZBias's own comment for why this IS
// the 2D paint sequence) tells us exactly which one occluded the other in
// the 2D composition: whichever was drawn LATER sat on top. Enforces that
// same relationship in 3D - the later-drawn one must end up at a smaller
// (nearer-camera) world Z. A global total order (globalIndex) can never
// produce a contradiction between pairs, so this always has a consistent
// solution to search for.
function violatesOcclusionOrder(node, testZ, placed) {
  return placed.some(p => {
    if (p.isBase) return false;
    // Lattices are a real, unconditional exception to "only shapes that
    // visually overlap in 2D have an enforced order": in the actual 2D
    // sketch every lattice is baked into a foreground layer composited on
    // top, every frame, regardless of creation order or silhouette overlap
    // with anything else - not a soft "usually in front" preference but a
    // hard architectural fact. Enforce it directly rather than relying on
    // the 2D-silhouette-overlap check below to happen to catch every such
    // pair (a lattice reported as ending up BEHIND an ornament it should
    // always be in front of was exactly this gap - the overlap check missed
    // the pair, so nothing forced the correct order).
    const nodeIsLattice = node.shapeType === 'lattice', pIsLattice = p.shapeType === 'lattice';
    if (nodeIsLattice !== pIsLattice) return nodeIsLattice ? testZ >= p.z : testZ <= p.z;
    const d2D = Math.hypot(node.origX - p.origX, node.origY - p.origY);
    if (d2D >= node.r + p.r) return false; // silhouettes don't overlap in 2D - no occlusion relationship to preserve
    const nodeIsFront = node.globalIndex > p.globalIndex; // drawn later = painted on top
    return nodeIsFront ? testZ >= p.z : testZ <= p.z;
  });
}

// How much farther than the bare-minimum clearing offset a node's Z gets
// pushed, once a clear spot is found - "spread the sculpture out a little
// on Z." 1.0 would leave every node packed as tightly as physically
// possible; re-verified against a full clearance check before use, so this
// never introduces a real overlap even when it can't find the extra room.
// Kept deliberately modest - violatesOcclusionOrder already forces real,
// often substantial separation between any pair that actually overlapped
// in the 2D composition, so this only needs to add a LITTLE more on top of
// that for pairs with no such constraint, not compound into a deep stack.
const SPREAD_FACTOR = 1.15;
// Guaranteed minimum forward (step-count) push for lattices specifically -
// "lattices are usually out front in the composition" - see buildElementTree.
const LATTICE_FRONT_STEPS = 3;

// Places every Tier-1 node - X/Y are NEVER searched or moved: "do not
// rearrange at all, this 2D is beautiful." Each shape stays at exactly its
// own original 2D-derived position and rotation (contactDir stays null
// forever, so create3DShape's tilt never activates - no reorienting toward
// a contact partner either, since there IS no contact partner anymore).
// Shapes are the BODY here, not the connective structure; lines/arcs/
// beziers (Tier 2, see the connector pass in convertShapesTo3D) are the
// SKELETON that does the actual connecting between them. So Tier-1 shapes
// no longer need to touch each other at all - the only rules left are
// real physical non-overlap (resolved along Z, the one axis the 2D
// composition never had to begin with), staying above the base ("the base
// must be lower than the lowest shape" - violatesFloor), AND matching real
// 2D occlusion order wherever two shapes' silhouettes actually overlapped
// in the original composition (violatesOcclusionOrder) - not just a global
// "later-drawn things lean toward the camera" bias (synthesizedZBias,
// still used to pick which direction to search FIRST, and to keep non-
// overlapping shapes spread through real depth), but an authoritative,
// pairwise front/back constraint for every pair that actually occluded
// each other in 2D. Mutates every node with x=origX, y=origY, a resolved
// z, contactDir=null, and returns the array sorted biggest-first
// (placement/search order only - position doesn't depend on it beyond who
// gets first pick of a given Z).
function buildElementTree(nodes) {
  if (nodes.length === 0) return [];
  const sorted = nodes.slice().sort((a, b) => b.r - a.r);
  const placed = [];

  sorted.forEach(node => {
    node.x = node.origX;
    node.y = node.origY;
    node.contactDir = null;
    node.contactPointWorld = null;
    node.componentId = 0;

    // Search outward from z=0 in small steps, trying whichever side the
    // element's own draw-order bias prefers first (synthesizedZBias -
    // "keep elements in their layered order as they appear in 2D"), for
    // the smallest |z offset| that clears every already-placed node and
    // stays above the base. X/Y never change, so this is a 1D search, not
    // a directional one - depth is the only freedom left to resolve
    // overlap, which is exactly the point.
    // Lattices are a special case: "lattices are usually out front in the
    // composition" - always bias them toward the camera (more negative world
    // Z, see tier1WorldCenter) rather than leaving it to synthesizedZBias's
    // generic index-based guess, and give them extra guaranteed forward
    // clearance below (LATTICE_FRONT_STEPS) - real separation from whatever
    // ends up behind them, not just the bare minimum offset that clears
    // overlap. That minimum-clearance gap is what was reading as "the
    // lattice and the shape behind it look like they're intersecting from
    // certain angles" - a real but tiny gap is exactly what makes ordinary
    // alpha-blend mesh sorting ambiguous from an oblique angle.
    const isLattice = node.shapeType === 'lattice';
    const zSign = isLattice ? -1 : (synthesizedZBias(node.globalIndex) >= 0 ? 1 : -1);
    const step = Math.max(node.r * 0.6, 0.5);

    // Escalating search across a bounded budget - WITH real occlusion-order
    // enforcement first (the common case), then, only if that finds
    // nothing at all, WITHOUT it. A dense composition where a shape 2D-
    // overlaps several others with conflicting front/back requirements
    // relative to different already-placed neighbors can occasionally have
    // no small-magnitude Z that satisfies every pairwise requirement at
    // once (each pair alone is always resolvable - see
    // violatesOcclusionOrder - but not necessarily all of them together for
    // one shape). Guaranteed non-overlap/above-floor placement always
    // outranks perfect occlusion order for that one shape - this used to
    // fall straight through to an extreme, search-budget-sized safety net
    // instead, which is exactly what was pushing occasional shapes to the
    // far back of the scene and blowing out the camera's framing/zoom range.
    const SEARCH_BUDGET = 200;
    function searchZ(requireOcclusionOrder) {
      for (let n = 0; n <= SEARCH_BUDGET; n++) {
        const offsets = n === 0 ? [0] : [n * step * zSign, -n * step * zSign];
        for (const zOff of offsets) {
          const testZ = zOff - node.zOffset;
          const test = { ...node, z: testZ, contactDir: null };
          if (violatesFloor(test, placed)) continue;
          if (overlapsAnyPlaced(test, placed)) continue;
          if (requireOcclusionOrder && violatesOcclusionOrder(node, testZ, placed)) continue;
          return { z: testZ, n, sign: zOff >= 0 ? 1 : -1 };
        }
      }
      return null;
    }
    let result = searchZ(true) || searchZ(false);

    // An unlucky combination of independently-rolled scramble tilts can
    // occasionally leave no Z-offset within the search budget that clears
    // every already-placed neighbor (each shape's tilt changes how far it
    // reaches in every direction, not just up/down - two large tilts can
    // conspire to need more Z separation than the budget covers). Re-rolling
    // THIS node's own tilt changes its own reach and, empirically, is
    // enough to open up a clear Z - a different but still-real scramble,
    // not a fallback that quietly gives up on the actual rule (nothing
    // should overlap, scrambled or not).
    if (!result && scrambleMode && !node.isBase) {
      const RESCRAMBLE_RETRIES = 8;
      for (let attempt = 0; attempt < RESCRAMBLE_RETRIES && !result; attempt++) {
        node.scrambleQuat = rollScrambleQuat();
        result = searchZ(true) || searchZ(false);
      }
    }

    if (!result) {
      // Should be unreachable (running the SAME search again with no
      // occlusion-order requirement at all, even after re-rolling this
      // node's own tilt several times, still found nothing within a
      // generous budget) - final safety net, bounded modestly rather than
      // at the full search budget, so this can never leave a shape at an
      // absurd distance even in the worst case.
      node.z = 20 * step * zSign - node.zOffset;
    } else {
      // "Spread the sculpture out a little on Z" - the search above finds
      // the bare MINIMUM offset that clears everything, which packs the
      // whole structure into as little depth as possible. Try pushing this
      // node further out along the SAME direction it already resolved
      // (still re-verified, not just assumed clear) for a bit more real
      // depth between elements, falling back to the minimal offset if the
      // wider spot turns out to be blocked by something else. Lattices get
      // a small guaranteed ADDITIVE bonus on top of the normal spread, so
      // they always end up genuinely out front instead of merely on the
      // correct side by a hair even when result.n is 0 (nothing was in the
      // way at all). This used to be `result.n * SPREAD_FACTOR * 2` - a
      // MULTIPLIER on result.n, not an addition - which for a lattice that
      // needed many search steps to clear a crowded/heavily-occluded spot
      // (a large result.n on its own) doubled an already-large value into
      // an extreme Z, flung far off to the side once perspective projected
      // it ("that lattice is wayyy out front").
      const spreadN = isLattice
        ? result.n * SPREAD_FACTOR + LATTICE_FRONT_STEPS
        : result.n * SPREAD_FACTOR;
      const spreadZOff = spreadN * step * result.sign;
      const spreadTestZ = spreadZOff - node.zOffset;
      const spreadTest = { ...node, z: spreadTestZ, contactDir: null };
      node.z = (!violatesFloor(spreadTest, placed) && !overlapsAnyPlaced(spreadTest, placed) && !violatesOcclusionOrder(node, spreadTestZ, placed))
        ? spreadTestZ
        : result.z;
    }
    placed.push(node);
  });

  return placed;
}

// True world-space center of a resolved Tier-1 node. create3DShape/
// create3DLattice are called with `layerZ = -node.z`, then internally set
// `zPos = -layerZ` - the double negation CANCELS, so a node's real world Z
// is simply node.z (confirmed against create3DShape's own trueCenterZ =
// zPos - zOffset formula for concentricCircle's true center - this used to
// read `-(node.z + zOffset)` here, the opposite sign on both terms, a
// stale leftover from before the call sites gained their own `-node.z`;
// nothing that reasoned about front/back ordering from this function -
// camera framing, the base's Y/Z, "keep elements in their layered order" -
// was using the right sign).
function tier1WorldCenter(node) {
  return { x: node.x, y: node.y, z: node.z - node.zOffset };
}

// Clear acrylic, same material language as CLEAR_ACRYLIC_COLOR (concentricArc's
// wedge). This was the only strut look there was; it's now the 'acrylic' entry
// in STRUT_MATERIAL_OPTIONS below, kept because it's the one non-solid
// choice. A slightly more visible alpha than the acrylic wedge's 0.05, since
// struts are real structural load-bearing members meant to be seen - just
// not as a heavy black mass.
const BASE_COLOR = { r: 0.93, g: 0.96, b: 0.99, a: 0.14 };
const BASE_HEIGHT = 6; // real vertical extent (top rim to bottom rim) - a flat single ring read as 2D/edge-on from most angles
// World units of clear air between the base's top and the lowest shape's
// real reach. Was 1.5 - a technically-real gap, but the base is now an
// OPAQUE marble slab (used to be translucent clear acrylic, which stayed
// visible even through a near-tangent shape), so a shape sitting right at
// that thin margin - especially a thin, tall OPEN shape whose gradient
// already fades toward transparent near its own open edge - can visually
// read as sinking into/getting swallowed by the now-solid surface even
// though it never actually violates the floor. More headroom makes that
// gap unambiguous from any angle.
const BASE_MARGIN = 4;

// ===== Selectable pedestal + strut materials =====
// The base and the support struts are the only parts of the piece whose look
// ISN'T dictated by the 2D composition's own palette, so they're the two
// things worth offering as a real material choice. Nothing in this scene is
// lit (there are no lights in it at all - see unlitMat), so material identity
// has to come from the surface itself, two different ways:
//
// - Stone and wood get a procedurally drawn DynamicTexture (veining, grain,
//   knots). A slab is big and flat-on, so a pattern is what sells it.
// - The metals get an emissive FRESNEL ramp instead of a texture: bright
//   where a rod's surface faces the camera, dark at its silhouette, which is
//   exactly a cylinder's shading and reads correctly from every angle. That
//   avoids depending on CreateTube's UV orientation, and costs no texture
//   memory across the 50+ struts a dense composition generates. The ramp
//   MULTIPLIES the material's own emissive tone, so if a Babylon build ever
//   skips the Fresnel block the strut still renders its correct flat metal
//   colour - just without the sheen.
// Bump this whenever the exporter changes. It is reported ON SCREEN when the
// AR model is built (not just to the console, which is unreachable from a
// phone without Web Inspector), so "am I actually running the new code?" is
// answerable in one tap. A stale stamp means cached JS, not a failed fix.
const USDZ_EXPORTER_BUILD = 'both-windings-blended';

const SCULPTURE_MATERIAL_STORAGE_KEY = 'kandinsky3d.materials';

const BASE_MATERIAL_OPTIONS = [
  {
    id: 'whiteMarble', label: 'White marble', kind: 'marble',
    swatch: 'linear-gradient(135deg,#f3efe9,#e5ded3 55%,#faf7f2)',
    body: { r: 0.93, g: 0.90, b: 0.86 },      // the original BASE_MARBLE_COLOR - this option is the unchanged look
    vein: 'rgba(112,114,126,0.34)',
    mottle: 'rgba(158,150,138,0.20)',
    spec: 0.32, specPower: 48,   // polished stone (spotlight mode only)
    outline: K3D_BLACK
  },
  {
    id: 'blackMarble', label: 'Black marble', kind: 'marble',
    swatch: 'linear-gradient(135deg,#26262b,#131316 55%,#2f2f37)',
    body: { r: 0.105, g: 0.105, b: 0.12 },    // near-black, not black: pure black loses the bevel entirely
    vein: 'rgba(232,234,242,0.42)',
    mottle: 'rgba(126,130,146,0.16)',
    spec: 0.42, specPower: 64,   // black marble takes the highest polish of the three
    // Black-on-black would erase the slab's silhouette AND its bevel - the
    // one place the file's otherwise-universal black outline has to give way.
    outline: { r: 0.78, g: 0.79, b: 0.83, a: 1 }
  },
  {
    id: 'wood', label: 'Wood', kind: 'wood',
    swatch: 'repeating-linear-gradient(100deg,#8b5a2f 0 3px,#7a4d27 3px 5px,#97643b 5px 9px)',
    body: { r: 0.55, g: 0.355, b: 0.185 },
    spec: 0.10, specPower: 16,   // satin, not lacquered
    outline: K3D_BLACK
  },
  {
    // Same clear-acrylic material language as the strut option above (and
    // CLEAR_ACRYLIC_COLOR elsewhere) - a genuinely translucent pedestal
    // instead of an opaque stone/wood slab. Higher alpha than either of
    // those (0.14/0.05): this is the single largest surface in the whole
    // piece, and at their translucency it read as barely there at all -
    // enough to still see it as a real, solid platform everything visibly
    // stands ON, just a clear one. No grain/veining (see
    // sculptureBaseTexture's kind check) - a flat tinted fill under real
    // specular is what reads as cast acrylic, texture would read as stone.
    id: 'acrylic', label: 'Clear acrylic', kind: 'acrylic',
    swatch: 'linear-gradient(180deg,rgba(236,246,255,0.9),rgba(186,212,234,0.35))',
    body: { r: 0.93, g: 0.96, b: 0.99 },
    spec: 0.55, specPower: 80,   // glossy cast plastic - the highest polish of the four
    alpha: 0.16,   // more translucent than the original 0.28, per direct feedback
    outline: K3D_BLACK
  }
];

// `tone` is the rod's own emissive colour; `hi`/`lo` are per-channel
// MULTIPLIERS on it at facing/grazing angles. Highlights run warmer and
// paler than a flat scale of the base tone would (real brass peaks toward
// pale yellow-white, steel toward blue-white), which is why these are
// three-channel rather than a single brightness factor.
const STRUT_MATERIAL_OPTIONS = [
  {
    id: 'black', label: 'Black',
    swatch: 'linear-gradient(180deg,#3c3c42,#151517 55%,#0c0c0e)',
    tone: { r: 0.135, g: 0.135, b: 0.145 },
    hi: { r: 2.30, g: 2.30, b: 2.40 }, lo: { r: 0.30, g: 0.30, b: 0.32 }
  },
  {
    id: 'brass', label: 'Brass',
    swatch: 'linear-gradient(180deg,#eccd72,#b0842f 45%,#6b4a13)',
    tone: { r: 0.615, g: 0.465, b: 0.19 },
    hi: { r: 1.58, g: 1.50, b: 1.32 }, lo: { r: 0.42, g: 0.38, b: 0.30 }
  },
  {
    id: 'steel', label: 'Steel',
    swatch: 'linear-gradient(180deg,#e4e9ee,#98a0a8 45%,#585f67)',
    tone: { r: 0.545, g: 0.565, b: 0.60 },
    hi: { r: 1.55, g: 1.56, b: 1.58 }, lo: { r: 0.40, g: 0.41, b: 0.43 }
  },
  {
    // The look every strut had before this menu existed - kept as a real
    // choice rather than dropped, since it's the only genuinely translucent
    // option (BASE_COLOR's alpha 0.14) rather than an opaque metal finish.
    // A single solid tube like every other strut option - see
    // createSolidTube3D - so "clear" reads as actually clear, nothing
    // else visible through it.
    id: 'acrylic', label: 'Clear acrylic', kind: 'acrylic',
    swatch: 'linear-gradient(180deg,rgba(236,246,255,0.9),rgba(186,212,234,0.35))',
    tone: BASE_COLOR
  }
];

let sculptureMaterials = { base: 'whiteMarble', strut: 'black' };

function baseMaterialOption() {
  return BASE_MATERIAL_OPTIONS.find(o => o.id === sculptureMaterials.base) || BASE_MATERIAL_OPTIONS[0];
}
function strutMaterialOption() {
  return STRUT_MATERIAL_OPTIONS.find(o => o.id === sculptureMaterials.strut) || STRUT_MATERIAL_OPTIONS[0];
}

// One shared material per surface class, not one per mesh: a dense
// composition draws 50+ strut segments, and the base is 3 meshes, so sharing
// is both cheaper and better for OBJ export (the exporter dedupes by colour,
// and one material means one `newmtl` entry). The registries below let a
// material swap re-point every existing mesh without rebuilding the scene.
let sculptureMatCache = { base: null, baseTex: null, strut: null, strutBlack: null };
let baseSurfaceMeshes = [];
let baseOutlineMeshes = [];
let strutShellMeshes = [];      // grounded: the chosen strut material
let strutBlackMeshes = [];      // shape-to-shape braces: always black
let shapeBodyMeshes = [];       // every mesh whose material came from shapeBodyMat - for instant spotlight-toggle refresh

// Called from convertShapesTo3D's teardown. The meshes themselves are
// disposed there with dispose(false, true), which takes their shared
// material and its texture down with them - this just drops the now-dangling
// references so the next build makes fresh ones.
function resetSculptureMaterialRegistry() {
  sculptureMatCache = { base: null, baseTex: null, strut: null, strutBlack: null };
  baseSurfaceMeshes = [];
  baseOutlineMeshes = [];
  strutShellMeshes = [];
  strutBlackMeshes = [];
  shapeBodyMeshes = [];
  blackWireMats = new Map();
  blackWireMeshes = [];
}

// Procedural stone/wood surface for the pedestal. Deterministic per material
// (a seeded LCG, not Math.random) so the slab looks like the SAME physical
// object every time the scene rebuilds - re-veining itself on every 2D->3D
// toggle would read as swapping the base out for a different one.
function sculptureBaseTexture(opt) {
  const S = 512;
  const tex = new BABYLON.DynamicTexture(`baseTex_${opt.id}`, { width: S, height: S }, babylonScene, true);
  tex.hasAlpha = false;
  const ctx = tex.getContext();

  let seed = 0;
  for (let i = 0; i < opt.id.length; i++) seed = (seed * 31 + opt.id.charCodeAt(i)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  const css = (c, a = 1) =>
    `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
  // Base tone scaled by `k` and clamped - grain lines go both darker (k<1)
  // and lighter (k>1) than the body colour, and 255*1.2 would otherwise wrap
  // into a nonsense channel value.
  const shade = (k, a) => css({
    r: Math.min(1, opt.body.r * k), g: Math.min(1, opt.body.g * k), b: Math.min(1, opt.body.b * k)
  }, a);

  ctx.fillStyle = css(opt.body);
  ctx.fillRect(0, 0, S, S);

  if (opt.kind === 'marble') {
    // Soft tonal clouding first, so the veins sit ON TOP of it the way they
    // do in real stone rather than being washed out by it.
    for (let i = 0; i < 24; i++) {
      const x = rnd() * S, y = rnd() * S, r = S * (0.08 + rnd() * 0.24);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, opt.mottle);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Veins as random walks that occasionally spawn a thinner branch. The
    // branches go into the same queue rather than being drawn recursively -
    // a nested beginPath/stroke mid-walk would break the parent's own path.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = opt.vein;
    const veins = [];
    for (let i = 0; i < 7; i++) {
      veins.push({ x: rnd() * S, y: rnd() * S, a: rnd() * Math.PI * 2, len: 40 + rnd() * 40, w: 1.1 + rnd() * 2, gen: 0 });
    }
    for (let vi = 0; vi < veins.length && vi < 60; vi++) {
      const v = veins[vi];
      let x = v.x, y = v.y, a = v.a;
      ctx.lineWidth = v.w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < v.len; s++) {
        a += (rnd() - 0.5) * 0.5;
        x += Math.cos(a) * 9;
        y += Math.sin(a) * 9;
        ctx.lineTo(x, y);
        if (v.gen < 2 && rnd() < 0.05) {
          veins.push({
            x, y, a: a + (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * 0.5),
            len: v.len * 0.4, w: Math.max(0.5, v.w * 0.5), gen: v.gen + 1
          });
        }
      }
      ctx.stroke();
    }
  } else if (opt.kind === 'wood') {
    // Wood: near-parallel wavy grain lines, each with its own wavelength and
    // phase so they drift together and apart the way real grain does, plus a
    // couple of knots for the eye to land on.
    ctx.lineCap = 'round';
    for (let y = -30; y < S + 30; y += 2 + rnd() * 6) {
      const amp = 5 + rnd() * 14, ph = rnd() * Math.PI * 2;
      const freq = (0.7 + rnd() * 1.5) * Math.PI * 2 / S;
      ctx.strokeStyle = shade(rnd() < 0.55 ? 0.6 + rnd() * 0.24 : 1.1 + rnd() * 0.22, 0.55);
      ctx.lineWidth = 0.7 + rnd() * 2.4;
      ctx.beginPath();
      for (let x = 0; x <= S; x += 8) {
        const yy = y + Math.sin(x * freq + ph) * amp;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    for (let k = 0; k < 2; k++) {
      const kx = S * (0.2 + rnd() * 0.6), ky = S * (0.2 + rnd() * 0.6), tilt = rnd() * Math.PI;
      for (let r = 2; r < 26; r += 2.5) {
        ctx.strokeStyle = shade(0.52 + rnd() * 0.16, 0.6);
        ctx.lineWidth = 1 + rnd();
        ctx.beginPath();
        ctx.ellipse(kx, ky, r, r * 0.55, tilt, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  // Acrylic: neither branch above runs - the flat fill already laid down
  // stays as-is, no grain/veining. A textured clear base would read as
  // stone or plastic laminate, not cast acrylic; the material's own alpha
  // + specular (see baseSurfaceMaterial) carry that look instead.

  tex.update();
  return tex;
}

function baseSurfaceMaterial() {
  if (sculptureMatCache.base) return sculptureMatCache.base;
  const opt = baseMaterialOption();
  const tex = sculptureBaseTexture(opt);
  const m = new BABYLON.StandardMaterial(`base_solid_mat_${opt.id}`, babylonScene);
  m.diffuseTexture = tex;
  m.backFaceCulling = false;
  // 1 for every opaque stone/wood option; the acrylic option is the one
  // exception (see its own `alpha` in BASE_MATERIAL_OPTIONS).
  m.alpha = opt.alpha !== undefined ? opt.alpha : 1;
  // Always LIT now - normal and spotlight modes share the same real lighting
  // rig (see buildLightRig). The emissive slot has to be given up here:
  // leaving the texture in it would add the slab's full brightness back on
  // top of the shading and flatten the very modelling the rig exists to
  // produce. A small flat emissiveColor stands in as an ambient floor so the
  // shadow side reads as dark stone rather than a hole.
  m.disableLighting = false;
  m.emissiveColor = new BABYLON.Color3(0.13, 0.13, 0.135);
  m.specularColor = new BABYLON.Color3(opt.spec, opt.spec, opt.spec);
  m.specularPower = opt.specPower;
  // The slab's sides are a DOUBLESIDE ribbon, so which way its normals
  // face depends on the ring winding - without this, the most visible
  // surface on the whole pedestal could light as if it faced inward.
  // Flips the normal per back-face instead of trusting the winding.
  m.twoSidedLighting = true;
  // Flat stand-in colour for OBJ export - plain MTL can't carry the veining.
  // `usd` drives the AR/USDZ export: real stone and wood are lit, not
  // self-lit, so emission stays low (see meshUsdSurface) - alpha carries
  // through the same exportColor.a the acrylic strut/shape bodies already
  // use, so a translucent base exports as genuinely translucent in AR too.
  m.metadata = {
    exportColor: { r: opt.body.r, g: opt.body.g, b: opt.body.b, a: opt.alpha !== undefined ? opt.alpha : 1 },
    usd: { metallic: 0, roughness: opt.kind === 'wood' ? 0.55 : opt.kind === 'acrylic' ? 0.15 : 0.3, emissive: 0 }
  };
  sculptureMatCache.base = m;
  sculptureMatCache.baseTex = tex;
  return m;
}

// `grounded` struts (the ones actually standing on the base) get the chosen
// material; every shape-to-shape brace is hard-wired to black. Two separate
// material instances even when the choice IS black - sharing one would mean a
// single dispose during a refresh invalidated both registries at once.
function strutSurfaceMaterial(grounded) {
  const key = grounded ? 'strut' : 'strutBlack';
  if (sculptureMatCache[key]) return sculptureMatCache[key];
  const opt = grounded ? strutMaterialOption() : STRUT_MATERIAL_OPTIONS.find(o => o.id === 'black');
  const m = unlitMat(`strut_mat_${key}_${opt.id}`, opt.kind === 'acrylic' ? opt.tone : { ...opt.tone, a: 1 });
  // A strut/brace is always a closed tube, only ever seen from outside -
  // unlike unlitMat's other consumers (flat discs/prisms that DO need their
  // back face to stay visible), there's no reason to render its own far
  // inner wall. Left off (unlitMat's default), a translucent tube shows that
  // far wall THROUGH the near one - doubling up its own tessellation seams
  // into a rippled/segmented look, worst on the clear-acrylic option but
  // visible on any alpha < 1.
  m.backFaceCulling = true;
  if (opt.kind !== 'acrylic') {
    applyMetalFinish(m, opt);
    // Real metal in AR: fully metallic, and NOT emissive - it should catch
    // the room's light rather than glow, which is the whole point of seeing
    // brass or steel on an actual desk.
    m.metadata.usd = { metallic: 1, roughness: 0.25, emissive: 0 };
  }
  sculptureMatCache[key] = m;
  return m;
}

// The metal look, shared by every metal thing in the piece so they read as
// one family: the struts, and the black skeleton wires below.
//  - Fresnel ramp: leftColor where the surface faces the camera, rightColor
//    at grazing angles (the shader mixes on abs(dot(view, normal)), so
//    backFaceCulling being off elsewhere in this file doesn't invert it).
//  - Real light (normal and spotlight modes share the same rig now) replaces
//    the faked cylinder shading with the genuine article, and adds what the
//    fake never could: a specular hotspot that travels along the rod as you
//    orbit. The ramp stays on, but now only modulates the dimmed emissive
//    FLOOR - keeping the silhouette dark and the facing side lifted
//    UNDERNEATH the real lighting rather than competing with it.
function applyMetalFinish(m, spec) {
  const fr = new BABYLON.FresnelParameters();
  fr.bias = 0.06;
  fr.power = 1.35;
  fr.leftColor = new BABYLON.Color3(spec.hi.r, spec.hi.g, spec.hi.b);
  fr.rightColor = new BABYLON.Color3(spec.lo.r, spec.lo.g, spec.lo.b);
  m.emissiveFresnelParameters = fr;
  m.disableLighting = false;
  m.diffuseColor = new BABYLON.Color3(spec.tone.r, spec.tone.g, spec.tone.b);
  m.emissiveColor = new BABYLON.Color3(spec.tone.r * 0.22, spec.tone.g * 0.22, spec.tone.b * 0.22);
  m.specularColor = new BABYLON.Color3(spec.hi.r * 0.55, spec.hi.g * 0.55, spec.hi.b * 0.55);
  m.specularPower = 64; // tight hotspot - polished metal, not satin
  return m;
}

// ===== Shape-body lit highlight =====
// unlitMat's exact-color guarantee must survive untouched for FILL bodies
// too - the difference from base/struts is that base/struts dim
// emissiveColor and lean on real diffuse (Lambert) shading, which would
// shift a shape's drawn hue by facing angle. Shape bodies keep diffuseColor
// BLACK and emissiveColor at the exact drawn rgba (both unchanged from
// unlitMat) and add ONLY a specular term on top - a pure additive highlight
// with zero risk to the underlying colour.
//
// Tuned softer/broader than the struts (specularPower 64, tight polished
// metal): these are translucent cast-acrylic bodies (see BODY_ALPHA_3D/
// CLEAR_ACRYLIC_COLOR), not polished metal, so a tight bright-white glint
// would read as the wrong material. StandardMaterial's specular term stays
// visible on translucent/alpha-blended surfaces by default (same reason a
// glass window still shows a bright reflection despite being see-through).
const SHAPE_SPEC_COLOR = { r: 0.68, g: 0.68, b: 0.72 }; // brighter, slightly cool neutral - a real glossy catch-light, still short of a metal hotspot
const SHAPE_SPEC_POWER = 20; // broad soft highlight (struts use 64 for a tight polished-metal glint)
function shapeBodyMat(name, rgba) {
  const m = unlitMat(name, rgba);
  m.disableLighting = false;
  m.specularColor = new BABYLON.Color3(SHAPE_SPEC_COLOR.r, SHAPE_SPEC_COLOR.g, SHAPE_SPEC_COLOR.b);
  m.specularPower = SHAPE_SPEC_POWER;
  // Same insurance as base/struts: backFaceCulling is off (unlitMat), so
  // without this the visible side of a shape whose normal winding faces
  // "inward" would light as if it faced away from every light.
  m.twoSidedLighting = true;
  // diffuseColor (black) and emissiveColor (rgba) are untouched from
  // unlitMat above - only the specular term picks up the rig.
  //
  // Original emissive (the shape's exact drawn colour), read back by
  // applySpotlightLighting's intensity scaling below - diffuseColor being
  // black means a shape's own body brightness never responds to a light's
  // intensity at all (only its thin specular highlight does), so without
  // this the lighting panel's Intensity slider would visibly brighten
  // struts/base (real diffuse response) while every shape fill just sat
  // there unchanged - "Intensity doesn't affect the shapes."
  m.metadata.baseEmissive = { r: m.emissiveColor.r, g: m.emissiveColor.g, b: m.emissiveColor.b };
  return m;
}

// ===== Black skeleton wires as blackened metal =====
// The sketch draws most connectors (lines/beziers/arcs/spirals) in a neutral
// near-black - HSL(0, 0, 15) at 0.6-0.8 alpha - and until now those rendered
// as flat unlit colour, the only structural-looking thing in the piece with
// no material identity at all. They're blackened steel now, matching the
// black struts and braces.
//
// The ramp is deliberately GENTLER than the struts' black. A thin wire shows
// the camera almost nothing but facing normals - the grazing silhouette that
// keeps a fat rod dark is only a pixel or two wide - so the strut's own
// hi of 2.30 would light the full visible width and turn every black line
// mid-grey, washing out the drawing. 1.70 keeps them reading black with a
// sheen along them.
const BLACK_WIRE_METAL = {
  tone: { r: 0.135, g: 0.135, b: 0.145 },
  hi: { r: 1.70, g: 1.70, b: 1.78 },
  lo: { r: 0.30, g: 0.30, b: 0.32 }
};
// Neutral AND dark: catches the sketch's default connector colour without
// touching a dark but saturated palette colour (a deep navy line is a drawn
// colour, not metalwork). Channel spread guards the neutrality.
function isBlackWireColor(rgba) {
  const mx = Math.max(rgba.r, rgba.g, rgba.b);
  const mn = Math.min(rgba.r, rgba.g, rgba.b);
  return mx <= 0.30 && (mx - mn) <= 0.06;
}
// Cached per ALPHA - the sketch uses 0.8 for most connectors and 0.6 for
// others, and that translucency is part of the drawing's weight, so it's
// preserved rather than forced opaque. In practice this Map holds 1-2 entries.
let blackWireMats = new Map();
let blackWireMeshes = [];   // { mesh, alpha } - alpha needed to rebuild on a lighting change
function blackWireMaterial(alpha) {
  const key = alpha.toFixed(2);
  if (blackWireMats.has(key)) return blackWireMats.get(key);
  const m = unlitMat(`blackwire_mat_${key}`, { ...BLACK_WIRE_METAL.tone, a: alpha });
  m.backFaceCulling = true; // closed tube, seen from outside only - see strutSurfaceMaterial's identical fix for why
  applyMetalFinish(m, BLACK_WIRE_METAL);
  m.metadata.usd = { metallic: 1, roughness: 0.38, emissive: 0 }; // blackened steel, same family as the struts

  blackWireMats.set(key, m);
  return m;
}
function refreshBlackWires() {
  if (!blackWireMats.size) return;
  blackWireMats.forEach(m => m.dispose());
  blackWireMats = new Map();
  blackWireMeshes.forEach(e => {
    if (e.mesh && !e.mesh.isDisposed()) e.mesh.material = blackWireMaterial(e.alpha);
  });
}

// ===== Spotlight mode =====
// "A spotlight mode that brings the sculpture out from the background and
// increases contrast a little." Four things happen together, and it's the
// combination that produces the separation - no one of them does it alone:
//
//  1. A real three-point gallery rig (key/fill/rim) is added to the scene.
//  2. The base and struts become LIT materials, so they're the only things
//     that rig touches. Every artwork mesh already sets disableLighting on
//     its own material, so the shapes ignore the lights entirely and their
//     exact 2D colours survive untouched - that existing flag is what makes
//     a real light rig safe to drop into this scene at all.
//  3. The skybox is dimmed. This is the single biggest lever: the piece is
//     translucent mid-tone against a bright paper wash, and dropping the
//     background is what actually makes it step forward.
//  4. A global contrast lift plus a vignette, via the scene's own image
//     processing - the "little more contrast", and the vignette pulls the
//     eye to the centre the way a real spotlight's falloff does.
//
// Everything here is reversible in place; nothing rebuilds the scene.
//
// TUNING NOTE: three separate things darken the background and they COMPOUND,
// which is how the first pass ended up far too dark. For a sky pixel:
//   paper wash (0.90, 0.84, 0.72)  ->  x SKY_DIM  ->  x EXPOSURE
//   ->  contrast, which pivots around 0.5: (v - 0.5) * CONTRAST + 0.5
//   ->  x vignette (multiplicative, strongest in the corners)
// The contrast pivot is the trap - once SKY_DIM pushes the background under
// 0.5, the contrast lift starts driving it DOWN as well, so lowering the dim
// darkens the frame roughly twice as fast as the number suggests. Keeping the
// background above ~0.5 after dim+exposure means contrast lifts it instead,
// and the separation then comes from the lit base and the shapes' own
// emissive colour rather than from crushing everything around them.
const SPOTLIGHT_SKY_DIM = 0.60;      // multiplier on the skybox texture level (was 0.34 - far too dark)
const SPOTLIGHT_CONTRAST = 1.35;     // 1.0 = untouched
const SPOTLIGHT_EXPOSURE = 1.06;
const SPOTLIGHT_VIGNETTE_WEIGHT = 1.1; // was 2.4 - a gentle corner falloff, not a black frame

// User-facing lighting panel (spotlight mode only - see applySpotlightLighting).
// Deliberately session-only like spotlightMode itself: every fresh page load
// resets to these defaults rather than persisting a prior tuning session.
const SPOTLIGHT_LIGHTING_DEFAULTS = { skyDim: SPOTLIGHT_SKY_DIM, lightCount: 4, intensityScale: 1, warmth: 0 };
let spotlightLightingSettings = { ...SPOTLIGHT_LIGHTING_DEFAULTS };

// Normal and spotlight modes share the SAME real lighting, shadows, and
// shape/base/strut highlight now - both are lit; spotlight's only remaining
// job is the environmental "pop" (dimmed sky, contrast, vignette - see
// syncSpotlightEnvironment). Deliberately session-only, never persisted:
// always starts normal, spotlight is an explicit per-visit enhancement, not
// a sticky default someone can get stuck in without realising it.
let spotlightMode = false;
let sceneLights = [];
let sceneShadowGenerator = null;

// "Turn off the struts and base so they can just look at the composition" -
// a pure display toggle, session-only like spotlightMode above (always
// starts visible; nobody should come back to a hidden base without asking
// again). Every base/strut mesh shares one of these 4 name prefixes - see
// baseRevealMeshes' own identical split between base_solid_/base_outline_
// (the base) and base_strutsupport_/base_reinforced_ (the struts, which
// also happen to start with "base_" since they land ON it).
let structureVisible = true;
const STRUCTURE_MESH_PREFIX = /^(base_solid_|base_outline_|base_strutsupport_|base_reinforced_)/;
function applyStructureVisibility() {
  if (!babylonScene) return;
  babylonScene.meshes.forEach(m => {
    if (STRUCTURE_MESH_PREFIX.test(m.name)) m.isVisible = structureVisible;
  });
}
// Exposed for #structure-toggle-btn (index3D.html).
window.setStructureVisible = function (visible) {
  structureVisible = !!visible;
  applyStructureVisibility();
};
window.isStructureVisible = function () { return structureVisible; };

// One restore for every stored preference - deliberately down here rather
// than beside `sculptureMaterials`, since it has to run after BOTH `let`s
// are initialised (a `let` read before its declaration throws).
(function restoreSculpturePreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(SCULPTURE_MATERIAL_STORAGE_KEY) || 'null');
    if (!saved) return;
    if (BASE_MATERIAL_OPTIONS.some(o => o.id === saved.base)) sculptureMaterials.base = saved.base;
    if (STRUT_MATERIAL_OPTIONS.some(o => o.id === saved.strut)) sculptureMaterials.strut = saved.strut;
  } catch (e) { /* storage disabled/private mode - the defaults are fine */ }
})();

// Built once and never disposed - babylonScene itself lives for the whole
// page session (activate/deactivate 3D just toggles visibility, never
// tears the scene down), so a plain "already built" guard is enough; no
// dispose path is needed since these never go away once created.
function buildLightRig() {
  if (!babylonScene || sceneLights.length) return;
  // Directions point FROM the light INTO the scene. The rig is fixed in
  // world space, not welded to the camera, so orbiting genuinely walks you
  // around a lit object - the highlight travels, the shadow side turns
  // toward you. That's the whole point of lighting a sculpture.
  const key = new BABYLON.DirectionalLight('spot_key', new BABYLON.Vector3(0.75, -1, 0.85), babylonScene);
  key.diffuse = new BABYLON.Color3(1, 0.965, 0.9);   // warm gallery key, high and front-left
  key.specular = new BABYLON.Color3(1, 0.98, 0.94);
  key.intensity = 1.25;

  // Ambient wrap so nothing ever goes to pure black as you orbit past the
  // key - sky-cool from above, warm bounce off the floor below.
  const fill = new BABYLON.HemisphericLight('spot_fill', new BABYLON.Vector3(0, 1, 0), babylonScene);
  fill.diffuse = new BABYLON.Color3(0.74, 0.79, 0.9);
  fill.groundColor = new BABYLON.Color3(0.3, 0.27, 0.24);
  fill.specular = new BABYLON.Color3(0.25, 0.26, 0.28);
  fill.intensity = 0.5;

  // Cool rim from behind (+Z is behind the sculpture at the default camera
  // angle) - this is what actually separates a dark base from a dark
  // background, by drawing a bright edge along its silhouette.
  const rim = new BABYLON.DirectionalLight('spot_rim', new BABYLON.Vector3(-0.35, -0.25, -1), babylonScene);
  rim.diffuse = new BABYLON.Color3(0.72, 0.82, 1);
  rim.specular = new BABYLON.Color3(0.8, 0.88, 1);
  rim.intensity = 0.85;

  // Side accent, roughly horizontal from the right - deliberately a very
  // different angle from key (high, front-left, mostly downward) and rim
  // (from behind). A tilted/scrambled shape's own facets face all sorts of
  // directions, so specular highlights are very angle-sensitive - this is
  // what catches a second glint on a face the key light misses entirely,
  // instead of leaving one whole side of the piece with no highlight at
  // all. Neutral/cool so it reads as a second real light source rather
  // than a second copy of the key's own warm glow.
  const accent = new BABYLON.DirectionalLight('spot_accent', new BABYLON.Vector3(-1, -0.2, -0.3), babylonScene);
  accent.diffuse = new BABYLON.Color3(0.85, 0.9, 1);
  accent.specular = new BABYLON.Color3(0.9, 0.94, 1);
  accent.intensity = 0.7;

  sceneLights = [key, fill, rim, accent];
  // Each light's own ORIGINAL intensity/diffuse, so applySpotlightLighting
  // (the lighting panel) always recomputes from this fixed baseline rather
  // than compounding onto whatever the last slider move already changed -
  // and so normal mode (which never applies the panel's settings) can
  // always show the exact same rig this function just built.
  sceneLights.forEach(light => { light.metadata = { intensity: light.intensity, diffuse: light.diffuse.clone() }; });
  applySpotlightLighting();

  // Real cast shadows from the key light only (a shadow map per light would
  // be needless cost, and a single consistent shadow direction reads better
  // than three overlapping ones anyway) - onto the base, from the shapes and
  // struts sitting on it. autoUpdateExtends (Babylon's default, left alone
  // here) refits the light's orthographic frustum to the shadow casters'
  // actual bounds every frame, so this doesn't need hand-tuned bounds that
  // would drift wrong for a bigger/smaller composition or after a scramble.
  sceneShadowGenerator = new BABYLON.ShadowGenerator(1024, key);
  sceneShadowGenerator.useBlurExponentialShadowMap = true;
  // blurKernel is measured in shadow-map TEXELS, not world units - the
  // light's orthographic frustum auto-fits to the whole composition
  // (autoUpdateExtends), which can easily span 100+ world units across a
  // 1024-texel map. 32 texels there was several world units of blur radius,
  // enough to round every shape's silhouette down to a soft blob regardless
  // of its real outline (a triangle read as a circle). Small enough now to
  // soften jagged edges without erasing the caster's actual shape.
  sceneShadowGenerator.blurKernel = 4;
  sceneShadowGenerator.transparencyShadow = true; // shapes/struts are alpha-blended (acrylic) - without this Babylon skips them as shadow casters entirely
  // Struts are thin, curved, and often run nearly PARALLEL to the key
  // light's own direction (a support leg rising toward it) - exactly the
  // worst case for shadow-map depth precision, where a curved caster
  // incorrectly self-shadows its own surface in a rippled/banded pattern
  // ("shadow acne") because the map can't distinguish which points on a
  // near-grazing surface are actually in front of which. Babylon's default
  // bias (0.00005) is tuned for ordinary flat/faceted geometry and is far
  // too tight here. Both biases push the comparison depth out far enough
  // to stop a strut from shadowing itself; normalBias (offsets along the
  // surface normal, before the depth check) is the more effective one for
  // a curved surface specifically, bias is the usual flat safety margin.
  sceneShadowGenerator.bias = 0.004;
  sceneShadowGenerator.normalBias = 0.06;
  refreshShadowCasters();
}

// Every mesh that can cast a shadow (shape bodies, struts) and the one that
// receives them (the base) are already tracked in their own arrays for the
// live material-refresh system above - reused here rather than re-walking
// the scene graph. Called once when the rig is first built, and again at
// the end of every convertShapesTo3D rebuild (scramble, or entering 3D)
// since that disposes and recreates every one of those meshes.
function refreshShadowCasters() {
  if (!sceneShadowGenerator) return;
  const casters = [...shapeBodyMeshes, ...strutShellMeshes, ...strutBlackMeshes]
    .filter(m => m && !m.isDisposed());
  sceneShadowGenerator.getShadowMap().renderList = casters;
  baseSurfaceMeshes.forEach(m => { if (m && !m.isDisposed()) m.receiveShadows = true; });
}

// Blends a light's own base colour toward a warm (orange) or cool (blue)
// tint - capped well short of a full override so each light keeps enough of
// its own identity (the rim stays coolER than the key even at max warmth,
// not identically orange) rather than every light flattening to one hue.
function warmthTint(color, warmth) {
  if (!warmth) return color.clone();
  const warm = new BABYLON.Color3(1, 0.72, 0.45);
  const cool = new BABYLON.Color3(0.7, 0.82, 1);
  const target = warmth > 0 ? warm : cool;
  return BABYLON.Color3.Lerp(color, target, Math.min(1, Math.abs(warmth)) * 0.6);
}

// Applies the lighting panel's settings to the rig - light count (how many
// of the 4 are enabled, key first since it's also the shadow caster),
// overall intensity scale, and colour warmth. Deliberately a no-op on the
// LIGHTS whenever spotlight mode is off: normal mode always shows the
// plain, unmodified rig regardless of what the panel is set to, since the
// panel is explicitly a spotlight-only enhancement (see index3D.html - only
// reachable from the lightbulb while spotlight is on). Recomputes every
// light fully from its own metadata.intensity/diffuse baseline (set once in
// buildLightRig) each time, so repeated calls while dragging a slider never
// compound onto a previous call's result.
function applySpotlightLighting() {
  if (!sceneLights.length) return;
  const s = spotlightLightingSettings;
  sceneLights.forEach((light, i) => {
    const base = light.metadata;
    if (!spotlightMode) {
      light.setEnabled(true);
      light.intensity = base.intensity;
      light.diffuse = base.diffuse.clone();
      return;
    }
    light.setEnabled(i < s.lightCount);
    light.intensity = base.intensity * s.intensityScale;
    light.diffuse = warmthTint(base.diffuse, s.warmth);
  });

  // Shape bodies are diffuseColor-black by design (see shapeBodyMat) - their
  // own brightness is carried entirely by emissiveColor, which a light's
  // intensity never touches at all (only their thin specular highlight
  // does). Without this, the Intensity slider visibly brightened the
  // diffuse-lit metal (struts/base) while every shape fill just sat there
  // unchanged. Scaled directly here instead, from each material's own
  // ORIGINAL emissive (metadata.baseEmissive, set once at creation) so
  // repeated slider drags recompute fresh rather than compounding.
  shapeBodyMeshes.forEach(mesh => {
    if (!mesh || mesh.isDisposed() || !mesh.material || !mesh.material.metadata) return;
    const base = mesh.material.metadata.baseEmissive;
    if (!base) return;
    const scale = spotlightMode ? s.intensityScale : 1;
    mesh.material.emissiveColor = new BABYLON.Color3(base.r * scale, base.g * scale, base.b * scale);
  });
}

// Skybox dimming + global grade. Idempotent, and safe to call whenever -
// re-applied after each rebuild so a future skybox refresh can't come back
// at full brightness while spotlight mode is on.
function syncSpotlightEnvironment() {
  if (!babylonScene) return;
  const dim = spotlightMode ? spotlightLightingSettings.skyDim : 1;
  babylonScene.meshes.forEach(m => {
    if (!m.name.startsWith('skyFace_') || !m.material) return;
    // diffuseTexture and emissiveTexture are the SAME texture object on a
    // sky face, so one `level` covers both slots.
    const tex = m.material.diffuseTexture;
    if (tex) tex.level = dim;
  });
  // The clear colour shows through any hairline gap between faces and past
  // the box entirely - it has to travel with them or the seams light up.
  const wash = [229 / 255, 214 / 255, 184 / 255];
  babylonScene.clearColor = new BABYLON.Color4(wash[0] * dim, wash[1] * dim, wash[2] * dim, 1);

  const ip = babylonScene.imageProcessingConfiguration;
  if (spotlightMode) {
    ip.contrast = SPOTLIGHT_CONTRAST;
    ip.exposure = SPOTLIGHT_EXPOSURE;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = SPOTLIGHT_VIGNETTE_WEIGHT;
    ip.vignetteColor = new BABYLON.Color4(0, 0, 0, 0);
    ip.vignetteBlendMode = BABYLON.ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    ip.isEnabled = true;
  } else {
    ip.contrast = 1;
    ip.exposure = 1;
    ip.vignetteEnabled = false;
    ip.isEnabled = false;
  }
}

// Rebuilds the base and/or strut material and re-points every mesh already
// using it. Shared by the material picker and the spotlight toggle, since
// both change what those two materials should be without changing a single
// vertex - see setSculptureMaterials for why nothing has to rebuild.
function refreshSculptureSurfaces(doBase, doStrut, doStrutBlack) {
  if (!babylonScene) return;
  if (doBase && sculptureMatCache.base) {
    const oldMat = sculptureMatCache.base, oldTex = sculptureMatCache.baseTex;
    sculptureMatCache.base = null;
    sculptureMatCache.baseTex = null;
    const next = baseSurfaceMaterial();
    baseSurfaceMeshes.forEach(mesh => { if (mesh && !mesh.isDisposed()) mesh.material = next; });
    const oc = baseMaterialOption().outline;
    baseOutlineMeshes.forEach(mesh => {
      if (!mesh || mesh.isDisposed() || !mesh.material) return;
      mesh.material.emissiveColor = new BABYLON.Color3(oc.r, oc.g, oc.b);
      mesh.material.metadata = { exportColor: { r: oc.r, g: oc.g, b: oc.b, a: 1 } };
    });
    if (oldTex) oldTex.dispose();
    if (oldMat) oldMat.dispose();
  }
  // The black braces only ever need rebuilding when LIGHTING changes - a
  // strut-material pick can't alter them, which is the whole point of them.
  const swapStruts = (key, meshes, grounded) => {
    const oldMat = sculptureMatCache[key];
    if (!oldMat) return;
    sculptureMatCache[key] = null;
    const next = strutSurfaceMaterial(grounded);
    meshes.forEach(mesh => { if (mesh && !mesh.isDisposed()) mesh.material = next; });
    oldMat.dispose();
  };
  if (doStrut) swapStruts('strut', strutShellMeshes, true);
  if (doStrutBlack) {
    swapStruts('strutBlack', strutBlackMeshes, false);
    refreshBlackWires(); // same black metalwork family, same lighting response
  }
}

// Deliberately session-only, never persisted - every fresh page load starts
// in normal mode, and spotlight is an explicit per-visit enhancement. Normal
// and spotlight now share the SAME real lighting/shadows/highlights (see
// buildLightRig, called unconditionally from convertShapesTo3D); toggling
// this only changes the environmental "pop" (see syncSpotlightEnvironment).
window.getSpotlightMode = function () { return spotlightMode; };
window.setSpotlightMode = function (on) {
  const next = !!on;
  if (next === spotlightMode) return;
  spotlightMode = next;
  // Session-only, same as spotlightMode itself - turning spotlight OFF
  // clears any tuning so the NEXT time it's switched on starts from the
  // same defaults, rather than a stale look from three toggles ago.
  if (!spotlightMode) spotlightLightingSettings = { ...SPOTLIGHT_LIGHTING_DEFAULTS };
  if (!babylonScene) return;
  applySpotlightLighting();
  syncSpotlightEnvironment();
};

// ——— public API for the spotlight lighting panel in index3D.html ———
// All session-only (see SPOTLIGHT_LIGHTING_DEFAULTS) and inert while
// spotlight mode is off - the panel itself is only reachable while it's on.
window.getSpotlightLightingSettings = function () { return { ...spotlightLightingSettings }; };
window.getSpotlightLightingDefaults = function () { return { ...SPOTLIGHT_LIGHTING_DEFAULTS }; };
window.setSpotlightLighting = function (opts = {}) {
  const s = spotlightLightingSettings;
  if (typeof opts.skyDim === 'number') s.skyDim = Math.max(0.15, Math.min(1.3, opts.skyDim));
  if (typeof opts.lightCount === 'number') s.lightCount = Math.max(1, Math.min(4, Math.round(opts.lightCount)));
  // Babylon's lighting model has no hard ceiling at 1.0 ("100%") - intensity
  // is just a multiplier a shader term gets scaled by, same as the base
  // rig's own key light already sitting above 1 (1.25) before this panel
  // existed. 4x (400%) is a soft UI cap for a sane slider range, not a real
  // engine limit - raise it further here if that's ever not enough headroom.
  if (typeof opts.intensityScale === 'number') s.intensityScale = Math.max(0.3, Math.min(4, opts.intensityScale));
  if (typeof opts.warmth === 'number') s.warmth = Math.max(-1, Math.min(1, opts.warmth));
  if (!babylonScene) return;
  applySpotlightLighting();
  syncSpotlightEnvironment();
};
window.resetSpotlightLighting = function () {
  spotlightLightingSettings = { ...SPOTLIGHT_LIGHTING_DEFAULTS };
  if (!babylonScene) return;
  applySpotlightLighting();
  syncSpotlightEnvironment();
};

// ——— public API for the materials picker in index3D.html ———
window.getMaterialOptions = function () {
  const pub = o => ({ id: o.id, label: o.label, swatch: o.swatch });
  return { base: BASE_MATERIAL_OPTIONS.map(pub), strut: STRUT_MATERIAL_OPTIONS.map(pub) };
};
window.getSculptureMaterials = function () {
  return { base: sculptureMaterials.base, strut: sculptureMaterials.strut };
};
// Swaps materials LIVE - no scene rebuild. Only material assignments change;
// every strut and base mesh keeps the geometry it already has, so picking a
// material while the 3D view is open updates it on the spot. Unknown ids are
// ignored rather than throwing, so a stale saved value can't break startup.
window.setSculptureMaterials = function (opts = {}) {
  const wantBase = BASE_MATERIAL_OPTIONS.some(o => o.id === opts.base) ? opts.base : null;
  const wantStrut = STRUT_MATERIAL_OPTIONS.some(o => o.id === opts.strut) ? opts.strut : null;
  const baseChanged = !!wantBase && wantBase !== sculptureMaterials.base;
  const strutChanged = !!wantStrut && wantStrut !== sculptureMaterials.strut;
  if (wantBase) sculptureMaterials.base = wantBase;
  if (wantStrut) sculptureMaterials.strut = wantStrut;
  try {
    localStorage.setItem(SCULPTURE_MATERIAL_STORAGE_KEY, JSON.stringify(sculptureMaterials));
  } catch (e) { /* storage disabled - the choice still applies this session */ }
  refreshSculptureSurfaces(baseChanged, strutChanged, false);
};

// ===== Gravitational analysis: every element gets a REAL material density,
// used to compute the sculpture's true center of gravity (mass-weighted, not
// just a geometric centroid) so it reads as a plausible standing physical
// object - "give each shape and element a weight as if they were made of
// acrylic, line based elements (skeleton) are made of metal, base is a heavy
// wood base." Relative magnitudes matter more than real-world accuracy here:
// metal is much denser than acrylic, but the skeleton's thin wire cross-section
// still nets a tiny mass next to a solid acrylic shape; the base is bigger AND
// denser than everything else combined, which is what should normally keep
// the COG low and inside its footprint without any extra support at all.
const DENSITY_ACRYLIC = 1.15;  // g/cm^3-ish, applied to every Tier-1 shape/lattice's solid volume
const DENSITY_METAL = 8.0;   // steel/bronze-ish, applied to every thin skeleton connector's volume
const DENSITY_WOOD = 1.3;    // "heavy" hardwood, applied to the base's solid cylinder volume
const STABILITY_FOOTPRINT_FACTOR = 0.8; // COG must land within this fraction of the base radius, not just barely inside it, to count as genuinely freestanding

// Shoelace formula - signed polygon area from a `localProfile.vertices` ring
// (any Tier-1 polygon profile: rect/triangle/lattice), used to turn a 2D
// cross-section into a real volume (area * full depth) for mass purposes.
function polygonArea(vertices) {
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

// Real solid volume (world units^3) of a Tier-1 node from its own support-
// function profile - polygon cross-section * full depth, or a cylinder for
// isotropic profiles (semiCircle gets half the disc's cross-section, matching
// its own half-disc silhouette).
function tier1NodeVolume(n) {
  const depth = n.zHalf * 2;
  // The base RENDERS as a rectangular slab (renderW x renderD - see
  // createBaseMesh3D), not the circular-footprint stand-in its placement
  // profile uses - weigh the real slab, since the base is the heaviest
  // single element and understating it (pi*r^2 vs w*d can differ by a lot
  // for a wide composition) skews the whole COG/stability analysis.
  // renderW/renderD are set before massEntries is gathered; the r*2 square
  // fallback covers the degenerate single-shape case.
  if (n.isBase) return (n.renderW || n.r * 2) * (n.renderD || n.r * 2) * depth;
  if (n.localProfile.kind === 'polygon') return polygonArea(n.localProfile.vertices) * depth;
  const areaFrac = (n.shapeType === 'semiCircle' || n.shapeType === 'concentricArc') ? 0.5 : 1;
  return Math.PI * n.localProfile.R * n.localProfile.R * areaFrac * depth;
}

function tier1NodeMass(n) {
  return tier1NodeVolume(n) * (n.isBase ? DENSITY_WOOD : DENSITY_ACRYLIC);
}

// Approximate world-space length of a Tier-2 connector's own curve, straight
// from its generating parameters (mirrors each create3D*'s own point
// generation, but only enough of it to get a length - no need to duplicate
// the full sampled path here). Used for the thin metal skeleton's mass -
// length * cross-section area, not a volume from a profile (these have none).
function connectorLengthPixel(kind, el) {
  switch (kind) {
    case 'line': {
      const p0 = el.points ? el.points[0] : { x: el.x0 || 0, y: el.y0 || 0 };
      const p1 = el.points ? el.points[1] : { x: el.x1 || 0, y: el.y1 || 0 };
      return Math.hypot(p1.x - p0.x, p1.y - p0.y);
    }
    case 'bezier': {
      const cps = el.points || el.pts;
      if (!cps || cps.length < 4) return 0;
      let len = 0, prev = cps[0];
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, mt = 1 - t;
        const p = {
          x: mt*mt*mt*cps[0].x + 3*mt*mt*t*cps[1].x + 3*mt*t*t*cps[2].x + t*t*t*cps[3].x,
          y: mt*mt*mt*cps[0].y + 3*mt*mt*t*cps[1].y + 3*mt*t*t*cps[2].y + t*t*t*cps[3].y
        };
        len += Math.hypot(p.x - prev.x, p.y - prev.y);
        prev = p;
      }
      return len;
    }
    case 'arcline':
      return Math.abs(el.sweep || Math.PI) * (el.r || 0);
    case 'spiral': {
      if (el.sv && el.sv.length >= 2) {
        let len = 0;
        for (let i = 1; i < el.sv.length; i++) len += Math.hypot(el.sv[i].x - el.sv[i-1].x, el.sv[i].y - el.sv[i-1].y);
        return len;
      }
      const coils = el.coils || 3;
      return coils * 2 * Math.PI * ((el.maxRadius || 0) / 2);
    }
    default:
      return 0;
  }
}

function connectorMass(kind, el) {
  const lengthWorld = connectorLengthPixel(kind, el) / K3D_SCALE;
  const strokeWeight = el.strokeWeight || el.w || el.sw || 2;
  const crossSectionArea = Math.PI * Math.pow(strokeWeight / K3D_SCALE / 2, 2);
  return lengthWorld * crossSectionArea * DENSITY_METAL;
}

// Tier-2 ornaments (halo/concentricArc/squiggle/shape-type arc) have no real
// volume, but they ARE stroke-drawn "line based" elements per the user's own
// framing, so they get the same metal density as the true skeleton connectors
// - just estimated from their own generating parameters (mirrors the exact
// radius/sweep formulas computeConnectorAnchor already uses for these kinds)
// rather than a sampled path, since only a rough length is needed for mass.
function ornamentSkeletonMass(kind, shape) {
  const strokeWeight = shape.strokeWeight || shape.sw || 2;
  const crossSectionArea = Math.PI * Math.pow(strokeWeight / K3D_SCALE / 2, 2);
  let lengthWorld = 0;
  if (kind === 'halo') {
    const r = (shape.targetSize || 50) / K3D_SCALE / 2;
    lengthWorld = 2 * Math.PI * r;
  } else if (kind === 'concentricArc' || kind === 'arcShape') {
    const s = (shape.targetSize || 50) / K3D_SCALE;
    const r = kind === 'arcShape' ? s / 2 : (shape.rings || 4) * ((shape.diff || 10) / K3D_SCALE);
    lengthWorld = Math.abs(shape.arcSweep || Math.PI) * r;
  } else if (kind === 'squiggle' && shape.sv && shape.sv.length >= 2) {
    let len = 0;
    for (let i = 1; i < shape.sv.length; i++) len += Math.hypot(shape.sv[i].x - shape.sv[i-1].x, shape.sv[i].y - shape.sv[i-1].y);
    lengthWorld = len / K3D_SCALE;
  }
  return lengthWorld * crossSectionArea * DENSITY_METAL;
}

// The base is a real Tier-1 participant, not a post-hoc ring computed AFTER
// everything else is placed - it's inserted into tier1Nodes and goes
// through buildElementTree exactly like any shape, seeded FIRST (it's
// deliberately the largest node, and buildElementTree always seeds
// biggest-first). Since shapes no longer move at all in X/Y and Y can only
// be resolved by the base's OWN position (not searched per-shape - see
// buildElementTree/violatesFloor), the base's Y here MUST guarantee its own
// top clears the lowest real shape's frozen Y by construction, not just by
// a heuristic margin - there is no search left that could fix a violation
// afterward.
//
// It never gets a contactDir (nothing attaches IT to a neighbor anymore -
// there's no more attaching at all), so it's permanently untitled - render
// orientation and support-function geometry both need a FIXED custom frame
// instead of the usual "untitled = identity" default, since a disc lying
// flat (thin top-to-bottom, wide sideways) is the opposite of this app's
// normal camera-facing shape convention (thin front-to-back).
// `fixedOrientation` carries that one-time 90 degree swap; supportDistance
// World and createBaseMesh3D both honor it.
function baseFixedOrientation() {
  const q = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, Math.PI / 2);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

// Sized and positioned from the REAL Tier-1 shapes already gathered (before
// buildElementTree runs) - wide enough to span under the composition's
// original 2D footprint, and its Y set from BASE_HEIGHT/BASE_MARGIN
// directly (not the shapes' own radii) so "base top < lowest shape" holds
// unconditionally regardless of how small or large the shapes are.
function createBaseTier1Node(realTier1Nodes) {
  if (realTier1Nodes.length === 0) return null;
  // Mass-weighted, not a plain geometric average - "if there's a balance
  // issue, you can move the base to the best location." A heavy acrylic shape
  // should pull the base's center toward it more than a small one would, the
  // same way a real pedestal gets centered under a sculpture's actual weight
  // rather than the midpoint of its outline. Every shape's mass (from its own
  // zHalf/localProfile - real volume x density) is already known here,
  // before buildElementTree runs, so this needs no second pass - it's a
  // strictly better upfront position, not a reaction after the fact. The
  // gravitational stability check (COG vs footprint) and its outrigger brace
  // still run afterward as a backstop for whatever this can't fully correct
  // (metal skeleton connector mass isn't known yet at this point).
  const totalMassForCenter = realTier1Nodes.reduce((s, n) => s + tier1NodeMass(n), 0);
  const avgOrigX = totalMassForCenter > 0
    ? realTier1Nodes.reduce((s, n) => s + n.origX * tier1NodeMass(n), 0) / totalMassForCenter
    : realTier1Nodes.reduce((s, n) => s + n.origX, 0) / realTier1Nodes.length;
  // The REAL lowest point of the lowest shape - center Y minus that shape's
  // OWN downward reach (its radius, roughly), not just center Y. Shapes
  // never tilt anymore (contactDir is always null), so every shape's
  // downward reach is fixed/exact here, not a search-dependent estimate -
  // getting this wrong (a previous version used bare center Y with a small
  // fixed margin) meant the floor check below could fail for EVERY shape
  // whose own radius exceeded that margin, with no Z offset able to fix a
  // Y-only violation - every shape got shoved to an extreme fallback Z and
  // vanished from view.
  // trueLowestReach, not a plain straight-down ray-cast - a rotated rect's
  // true lowest point is a CORNER that the exact-vertical ray from center
  // usually misses entirely (it hits an edge instead, underestimating the
  // real drop), which was letting a rotated shape's actual lowest corner
  // clip through the base even though this check looked satisfied.
  const minLowestY = Math.min(...realTier1Nodes.map(n => n.origY - trueLowestReach(n, null)));
  const maxR = Math.max(...realTier1Nodes.map(n => n.r));
  const avgR = realTier1Nodes.reduce((s, n) => s + n.r, 0) / realTier1Nodes.length;
  const baseR = Math.max(maxR * 1.1, avgR * 1.75, 3); // skinnier base - reverted the earlier 1.5x footprint boost (was maxR*1.65, avgR*2.625, 4.5)
  return {
    key: 'base', globalIndex: -1,
    origX: avgOrigX, origY: minLowestY - BASE_HEIGHT / 2 - BASE_MARGIN,
    r: baseR, zOffset: 0,
    shapeType: 'base', s: baseR * 2, rotZ: 0,
    localProfile: { kind: 'isotropic', R: baseR },
    zHalf: BASE_HEIGHT / 2,
    fixedOrientation: baseFixedOrientation(),
    isBase: true
  };
}

// Renders the base at its final resolved position as a real solid marble
// slab - a rectangular extrude (fitted to the sculpture's actual footprint,
// see renderW/renderD) with a beveled TOP edge only (bottom stays a sharp,
// flat edge), not the earlier circular acrylic drum. Built entirely from
// EXPLICIT world-space point rings (no path-tangent-derived auto-orientation
// involved anywhere) to avoid a real bug hit here once already:
// ExtrudeShapeCustom's Frenet frame is ambiguous along a perfectly straight
// path, and it rendered the whole slab as a tall vertical wall instead of a
// flat horizontal one. A CreateRibbon connecting 3 explicit height-rings
// (sharp bottom -> top shoulder, both full-size, then tapering to the
// smaller top cap) gives the chamfered top with no orientation guessing,
// plus two flat CreateGround caps for the true top/bottom faces.
// The flat top cap's own half-extents (excluding the beveled band entirely)
// - shared by createBaseMesh3D (what actually gets rendered) and
// baseAnchorHalfExtents below (what aux struts are allowed to touch), so the
// two can never drift apart.
function baseTopCapHalfExtents(node) {
  const w = node.renderW || node.r * 2;
  const d = node.renderD || node.r * 2;
  const h = node.zHalf * 2;
  const hw = w / 2, hd = d / 2;
  // A true 45-degree bevel needs the horizontal inset to exactly match the
  // vertical drop (rise = run) - clamped well under half the slab's
  // shortest side/height so the inset can never invert into a negative
  // width, however small the slab ends up.
  const bevel = Math.min(h * 0.4, 3, hw * 0.45, hd * 0.45); // longer bevel - starts further in, finishes lower (was h*0.22/1)
  return { w, d, hw, hd, bevel, bw: hw - bevel, bd: hd - bevel };
}

// The real allowed anchor region for aux struts on the base - "do not
// anchor any struts to the beveled edge... create a 1 inch boundary on the
// outside of the flat surface and do not anchor aux struts to that either."
// Excludes the bevel band entirely (only the flat top cap counts at all),
// then insets another 1" past that. Assuming the base is 12"x12" real-world
// size, 1" is w/12 (or d/12) of the base's own actual rendered footprint -
// scales correctly regardless of how big any particular base ends up.
function baseAnchorHalfExtents(node) {
  const { w, d, bw, bd } = baseTopCapHalfExtents(node);
  const marginX = w / 12, marginZ = d / 12;
  return { halfW: Math.max(bw - marginX, 0.1), halfD: Math.max(bd - marginZ, 0.1) };
}

function createBaseMesh3D(node) {
  const wc = tier1WorldCenter(node);
  const { w, d, hw, hd, bevel, bw, bd } = baseTopCapHalfExtents(node);
  const topY = node.y + node.zHalf, botY = node.y - node.zHalf;

  const ring = (y, rw, rd) => [
    new BABYLON.Vector3(wc.x - rw, y, wc.z - rd), new BABYLON.Vector3(wc.x + rw, y, wc.z - rd),
    new BABYLON.Vector3(wc.x + rw, y, wc.z + rd), new BABYLON.Vector3(wc.x - rw, y, wc.z + rd),
    new BABYLON.Vector3(wc.x - rw, y, wc.z - rd)
  ];
  // Bottom is sharp (full size, no taper) - only the top edge bevels.
  const rings = [
    ring(botY, hw, hd),
    ring(topY - bevel, hw, hd),
    ring(topY, bw, bd)
  ];
  // One shared material across all three slab meshes - see baseSurfaceMaterial.
  const slabMat = baseSurfaceMaterial();
  const sides = BABYLON.MeshBuilder.CreateRibbon('base_solid_sides', {
    pathArray: rings, sideOrientation: BABYLON.Mesh.DOUBLESIDE
  }, babylonScene);
  sides.material = slabMat;
  const topCap = BABYLON.MeshBuilder.CreateGround('base_solid_capTop', { width: bw * 2, height: bd * 2 }, babylonScene);
  topCap.position = new BABYLON.Vector3(wc.x, topY, wc.z);
  topCap.material = slabMat;
  const botCap = BABYLON.MeshBuilder.CreateGround('base_solid_capBot', { width: w, height: d }, babylonScene);
  botCap.position = new BABYLON.Vector3(wc.x, botY, wc.z);
  botCap.material = slabMat;
  // The one texture worth carrying into AR: it sits on real solid geometry
  // with no alpha cutout, so none of the padded-rectangle failure modes that
  // forced open shapes back to flat colour apply here.
  [sides, topCap, botCap].forEach(m => { m.metadata = { usdTexture: true }; });
  // `sides` is a DOUBLESIDE ribbon - both windings are already baked into its
  // geometry, same as extrudePrism bodies. topCap/botCap are plain CreateGround
  // planes (single winding, front face up), so on a TRANSLUCENT base (the
  // clear acrylic option) they hit the exact same RealityKit transparent-pass
  // bug as any other single-winding body: only one side of the mesh draws,
  // and it isn't reliably the one facing the camera. That's why the acrylic
  // base's underside disappeared when viewed from below in AR while the
  // (already-doubled) sides stayed visible. See the `usdForceDoubleWinding`
  // check in buildUsda for the actual fix - shipping a reversed twin of every
  // triangle, exactly like volumeGradient bodies already do.
  topCap.metadata.usdForceDoubleWinding = true;
  botCap.metadata.usdForceDoubleWinding = true;
  baseSurfaceMeshes.push(sides, topCap, botCap);

  // Black outline on EVERY real edge, not just the outermost ones - each
  // ring's own rectangle (sharp bottom, top shoulder, top cap) plus every
  // connecting edge between consecutive rings (the straight vertical sides
  // AND the diagonal bevel faces), matching how every other solid shape in
  // this file gets its full boundary wrapped, not just a couple of rims.
  // Black on every base except the black-marble one, which would swallow it
  // whole (see the option's own `outline`).
  const outlineCol = baseMaterialOption().outline;
  rings.forEach((r, ri) => {
    baseOutlineMeshes.push(makeStrokeTube(`base_outline_ring_${ri}`, r, 0.1, outlineCol, 0, 0, 0));
  });
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let i = 0; i < 4; i++) {
      baseOutlineMeshes.push(
        makeStrokeTube(`base_outline_edge_${ri}_${i}`, [rings[ri][i], rings[ri + 1][i]], 0.1, outlineCol, 0, 0, 0)
      );
    }
  }
  console.log(`🏛️ Base placed at (${wc.x.toFixed(1)}, ${node.y.toFixed(1)}, ${wc.z.toFixed(1)}), w=${w.toFixed(1)}, d=${d.toFixed(1)}`);
}

// A real, continuous solid tube (single mesh, no dashing) - used for every
// support/aux strut (base legs, the connectivity-closure struts, the
// stability outrigger). Used to be dashed ("conceptual stand, not a real
// connecting element"), but the base itself is now a real solid pedestal
// too, so a strut genuinely bearing load on it should read as a real solid
// support member, not a schematic hint. A thin black CORE runs inside the
// clear acrylic shell (not a bigger black tube wrapped around it - an opaque
// tube larger than the acrylic one would just fully hide the acrylic tube
// inside it, not outline it) - same "cast inside clear acrylic" look as
// concentricArc's rings, visible through the acrylic shell's own translucency.
// A support rod's thickness should be proportional to what it actually
// holds - a tiny bullseye propped up by the same fat standard rod as a
// giant rect read as "a little ridiculous." Cap at ~8% of the supported
// shape's own bounding radius, within [0.1, 0.35]: the standard rod stays
// the ceiling for normal/large shapes, and nothing goes thinner than
// sturdy wire.
function strutRadiusCap(node) {
  return Math.max(0.1, Math.min(0.35, (node && node.r ? node.r : 4.5) * 0.08));
}

function createSolidTube3D(name, pA, pB, w2D, radiusCap = null, grounded = true) {
  const dist = Math.hypot(pB.x - pA.x, pB.y - pA.y, pB.z - pA.z);
  if (dist < 1e-6) return null;
  // Aux supports read as real cylindrical rods, not thin wire - "imagine the
  // piece is sitting on a desk and the skeletal structures are rigid wires
  // perhaps 1/24" in diameter" (matching lineTubeAbsolute's own thin 0.1
  // minimum for actual connectors) - aux supports are a structurally
  // heavier, distinctly thicker class of object than that, never this
  // minimum's old 0.08 (thinner than even the wires). `radiusCap` (see
  // strutRadiusCap) scales that down for small supported shapes.
  let radius = Math.max((w2D || 2) / K3D_SCALE / 2, 0.35);
  if (radiusCap) radius = Math.min(radius, radiusCap);
  // Every strut is built bottom -> top (base/lower end first, shape/upper
  // end last), like a real support post going up off the base - and since
  // these are mounted fasteners, not just touching points, each end
  // continues a little PAST the real surface it lands on: the lower end
  // sinks further down into the base plate (only for struts that actually
  // land on the base - a shape-to-shape brace has no base end), and the
  // upper end continues a little further along the same line into the
  // shape's own volume, so both read as physically socketed rather than
  // just resting on top. Capped relative to the strut's own length so a
  // short brace can't have its embedded ends cross over each other.
  const lo = pA.y <= pB.y ? pA : pB;
  const hi = pA.y <= pB.y ? pB : pA;
  const dirX = (hi.x - lo.x) / dist, dirY = (hi.y - lo.y) / dist, dirZ = (hi.z - lo.z) / dist;
  const loEmbed = Math.min(grounded ? 0.6 : 0.35, dist * 0.3);
  const hiEmbed = Math.min(0.35, dist * 0.3);
  const start = { x: lo.x - dirX * loEmbed, y: lo.y - dirY * loEmbed, z: lo.z - dirZ * loEmbed };
  const end = { x: hi.x + dirX * hiEmbed, y: hi.y + dirY * hiEmbed, z: hi.z + dirZ * hiEmbed };
  const path = [new BABYLON.Vector3(start.x, start.y, start.z), new BABYLON.Vector3(end.x, end.y, end.z)];
  // updatable: true - without it, the vertex buffer Babylon allocates at
  // creation is static; animateStrutGrowth's later CreateTube(...,
  // {instance}) calls DO update the CPU-side vertex array (so reading it
  // back looks correct), but silently never re-upload to the GPU, so the
  // strut visibly stays at whatever length it had at creation - full,
  // since createSolidTube3D always builds the real final path first -
  // instead of the growth ever actually being seen on screen.
  const tube = BABYLON.MeshBuilder.CreateTube(name, {
    path, radius, tessellation: 16, cap: BABYLON.Mesh.CAP_ALL, updatable: true
  }, babylonScene);
  // Shared material - the chosen one if this strut stands on the base, plain
  // black if it's a shape-to-shape brace. See strutSurfaceMaterial. A single
  // solid tube, always - no separate core mesh inside it (the clear-acrylic
  // option used to hide a black one behind its translucent shell; removed
  // so "clear" genuinely means clear, nothing visible through it).
  tube.material = strutSurfaceMaterial(grounded);
  (grounded ? strutShellMeshes : strutBlackMeshes).push(tube);
  // Register with animateStrutGrowth - built at full length by default (so
  // anything that never calls it just sees a normal finished strut), but
  // whoever orchestrates the current rebuild (initial 2D->3D entry, or a
  // scramble transition once its shapes have settled) can grow every strut
  // in this list from its base end up to its shape end instead.
  strutGrowthQueue.push({ tube, start, end, radius });
  return tube;
}

// Shared by primeStrutGrowth and animateStrutGrowth so both ever move a
// strut's visible endpoint the same way.
function growStrutEntryTo(entry, t) {
  const { tube, start, end, radius } = entry;
  const cur = {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: start.z + (end.z - start.z) * t,
  };
  const path = [new BABYLON.Vector3(start.x, start.y, start.z), new BABYLON.Vector3(cur.x, cur.y, cur.z)];
  BABYLON.MeshBuilder.CreateTube(null, { path, radius, instance: tube });
}

// Shrinks every strut this build just created down to a short stub RIGHT
// NOW, synchronously, without consuming/starting anything - createSolidTube3D
// always builds each strut at its real full length first (so a caller that
// never animates anything still gets a normal finished strut), which is
// exactly what would otherwise sit fully built and visible for the whole
// 600ms a scramble's shapes take to glide into place, since animateStrutGrowth
// itself isn't called until after that finishes. Call this immediately after
// convertShapesTo3D, before any shape-transition tween starts, so the struts
// are already invisible-short for the entire time the shapes are still
// moving - then animateStrutGrowth (called once they've landed) is the FIRST
// time the user ever sees them at anything but a stub, instead of a full
// strut quietly shrinking then regrowing after already having been seen.
function primeStrutGrowth() {
  strutGrowthQueue.forEach(entry => growStrutEntryTo(entry, 0.02));
}

// Grows every strut this build just created from its base (or brace) end up
// to its shape end, instead of them just appearing full-length - "drawn"
// bottom to top, matching how they're already embedded/oriented (see
// createSolidTube3D). Snaps each strut down to a short stub at its start
// point, then lerps the visible end point out to the real one, updating the
// existing tube mesh in place (CreateTube's `instance` option) rather than
// rebuilding it every frame.
async function animateStrutGrowth(durationMs = 1500) {
  if (!babylonScene) return;
  const entries = strutGrowthQueue;
  strutGrowthQueue = [];
  if (entries.length === 0) return;
  const gen = ++strutGrowGen;
  const isActive = () => gen === strutGrowGen && !!babylonScene;

  // No-op if primeStrutGrowth already did this (the normal path) - still
  // needed as the starting point for any caller that skipped priming.
  entries.forEach(entry => growStrutEntryTo(entry, 0.02));

  await tweenRaw(durationMs, isActive, (t) => {
    const e = easeInOutSine(Math.max(0, Math.min(1, t)));
    entries.forEach(entry => growStrutEntryTo(entry, Math.max(0.02, e)));
  });
  if (!isActive()) return;
  entries.forEach(entry => growStrutEntryTo(entry, 1));
}

// Small red sphere marking a real connection/contact point in world space -
// every Tier-2 connector/ornament's anchor point, where the "skeleton"
// (lines/arcs/beziers) actually touches a shape's real surface. Visual
// verification of the connectivity system, per the user's explicit request.
const CONNECTION_DOT_COLOR = { r: 1, g: 0, b: 0, a: 1 };
// A real "lollipop head" for aux-support endpoints specifically - bigger
// than the default dot (used for thin skeletal connector touch points),
// matching a substantial cylindrical rod rather than a thin wire.
const AUX_SUPPORT_HEAD_RADIUS = 0.6;
// Debug toggle for the red dots - they served their purpose (verifying every
// anchor lands on real material) but 40+ of them add a red speckle the 2D
// composition never had. Flip to true in the console
// (window.SHOW_CONNECTION_DOTS = true) and re-enter 3D mode to re-verify.
window.SHOW_CONNECTION_DOTS = false;
function markConnectionPoint(name, pointWorld, radius = 0.35) {
  if (!window.SHOW_CONNECTION_DOTS) return null;
  const dot = BABYLON.MeshBuilder.CreateSphere(name, { diameter: radius * 2, segments: 8 }, babylonScene);
  dot.position = new BABYLON.Vector3(pointWorld.x, pointWorld.y, pointWorld.z);
  dot.material = unlitMat(name + '_mat', CONNECTION_DOT_COLOR);
  return dot;
}

// Bounding-sphere radius (+ z offset from the anchor point to the mesh's true
// geometric center) for any shape type that has a real, hard-edged volume -
// matching create3DShape's/createOpenShape3D's/createConcentricCircle3D's real
// mesh math exactly. Returns null for types with no real volume to bound
// (squiggle/arc-shape - stroke-only, no fill at all; concentricArc and halo
// both DO have real volume - a solid clear-acrylic shell/wedge wrapped around
// their rings, see createConcentricArc3D/createHalo3D - and are full Tier-1
// participants too).
// Deliberately NOT gated on style==='filled': open-style rect/triangle/
// semiCircle (openRect/openTriangle/openSemiCircle - this is what BOTH
// skeleton shapes always are, per createShapeElement) use the exact same
// size/depth math as their filled counterparts (createOpenShape3D's Z VOLUME
// section builds a real front/back-separated volume, not a flat sprite) - the
// user's rule only exempts arcs/lines/beziers/spirals, not translucent
// gradient-edged shapes, so these are full Tier-1 tree participants too (see
// buildElementTree), not just fixed obstacles - open-style shapes get moved
// and touch-tested exactly like their filled counterparts.
function shapeVolumeRadius3D(shape) {
  if (!shape) return null;
  const s = (shape.targetSize || 50) / K3D_SCALE;
  if (shape.type === 'concentricCircle') {
    // createConcentricCircle3D stacks `rings` thin discs at z-(rings-i)*0.6 -
    // the stack is asymmetric around the anchor z, so zOffset centers it (see
    // sign derivation below). r is the OUTER RING RADIUS ONLY, deliberately
    // NOT padded by the stack's small Z half-span (was `+ (rings-1)*0.3 +
    // 0.25`) - see the circle/rect/triangle comment below for why: that
    // extra padding is exactly the gap computeContactTilt can never actually
    // close, since its tilt only ever aligns the in-plane rim, never a Z pad
    // on top of it.
    const rings = shape.rings || 4;
    const diff3 = (shape.diff || 10) / K3D_SCALE;
    const outerR = rings * diff3;
    // Sign check: createConcentricCircle3D places ring i at world Z =
    // zPos - (rings-i)*0.6 (zPos = -layerZ). The true center (midpoint of the
    // front face at zPos+0.25 and the back face at zPos-(rings-1)*0.6-0.25) is
    // zPos-(rings-1)*0.3 in world space, which converts back to
    // layerZ-space (anchorZ + zOffset, since world = -layerZ-space) as
    // anchorZ + (rings-1)*0.3 - i.e. zOffset is POSITIVE here, not negative.
    return { r: outerR, zOffset: (rings - 1) * 0.3 };
  }
  if (shape.type === 'concentricArc') {
    // Reclassified as Tier-1 (real volume) - the nested stroke-only rings
    // now get a solid clear-acrylic wedge behind them (see createConcentricArc3D)
    // so they read as a real physical object instead of bare floating wire.
    // r is the outer ring radius, same formula as concentricCircle above.
    const rings = shape.rings || 4;
    const diff3 = (shape.diff || 10) / K3D_SCALE;
    return { r: rings * diff3, zOffset: 0 };
  }
  if (shape.style === 'halo') {
    // Reclassified as Tier-1 (real volume), the same reasoning that already
    // moved concentricArc: createHalo3D wraps the whole ring stack in a
    // solid clear-acrylic shell (haloAcrylic_) sized to the halo's own outer
    // radius - a real physical object that needs real support, not a decal.
    // Was `return null` (Tier-2, single-anchor touch only) from when a halo
    // really was just flat alpha-blended discs with nothing solid around
    // them; the shell addition made that stale, and left every halo
    // ("bullseye encased in clear") without the connectivity-closure
    // guarantee every other Tier-1 shape gets - it could end up touching
    // just one other shape at a single point with no real strut of its own.
    // zOffset must match the shell's own true center: createHalo3D centers
    // it at world Z = zPos - haloRingSpan(rings)/2 (see tier1WorldCenter,
    // world = zPos - zOffset).
    const rings = shape.rings || 3;
    return { r: s / 2, zOffset: haloRingSpan(rings) / 2 };
  }
  // Deliberately just the in-plane corner/rim distance, NOT padded by the
  // shape's Z-thickness (was `+ depth/2` here) - that padding was a real bug,
  // not just extra safety margin: computeContactTilt reorients a tilted
  // shape so this exact in-plane point faces its contact partner, so the
  // partner's center gets placed `r_A + r_B + pad` away assuming this point
  // is what's touching. Any extra padding beyond it is a gap the tilt can
  // never close (a tilt only ever aligns direction, not magnitude) - it
  // showed up as every tilted contact visibly NOT quite kissing. The
  // Z-thickness itself is small relative to the in-plane dimension (depth
  // maxes out around 12% of size) and is still covered by SOLID_CONTACT_PAD
  // for the rare untilted/other-direction overlap check.
  switch (shape.type) {
    case 'circle':
    case 'semiCircle':
      // Farthest arc/edge point is exactly s/2 from local origin (both types)
      return { r: s / 2, zOffset: 0 };
    case 'rect':
      // Box's in-plane corner distance (w=s, h=s*0.6) - rotation-invariant
      return { r: (s / 2) * Math.sqrt(1 + 0.6 * 0.6), zOffset: 0 };
    case 'triangle':
      // Circumradius of the equilateral profile used in create3DShape
      return { r: s / Math.sqrt(3), zOffset: 0 };
    default:
      return null; // squiggle, arc (shape-type) - stroke-only, still Tier-2 pass-through
  }
}

// Real per-shape 2D profile + Z half-thickness, used by supportDistanceWorld
// (below) to find the shape's ACTUAL boundary point in an arbitrary
// direction - as opposed to shapeVolumeRadius3D's single scalar `r`, which
// is only ever exact in the ONE direction a shape gets tilted to face (see
// computeContactTilt). A shape touched from any OTHER direction (a "hub"
// with more than one thing attached) needs its real silhouette, not the
// bounding sphere, or the touch point lands past the real edge in empty
// air. `rad` is the already-computed shapeVolumeRadius3D(shape) result,
// passed in so the two never compute a different `r` for the same shape.
// Mirrors create3DShape's exact geometry (w/h/vertex formulas, `depth`)
// so a support query always matches what's actually rendered.
function computeShapeProfile3D(shape, rad) {
  if (!shape || !rad) return null;
  const s = (shape.targetSize || 50) / K3D_SCALE;
  if (shape.type === 'concentricCircle') {
    const rings = shape.rings || 4;
    return { localProfile: { kind: 'isotropic', R: rad.r }, zHalf: 0.25 + (rings - 1) * 0.3 };
  }
  if (shape.type === 'concentricArc') {
    // rad.r (outer ring radius) drives the acrylic wedge's size, NOT `s`
    // (targetSize-based - unrelated to a concentricArc's real footprint) -
    // matches the depth createConcentricArc3D's acrylic wedge actually uses.
    const acrylicDepth = Math.max(0.8, rad.r * 2 * 0.12);
    return { localProfile: { kind: 'isotropic', R: rad.r }, zHalf: acrylicDepth / 2 };
  }
  if (shape.style === 'halo') {
    // Checked before the switch below since a halo's shape.type is 'circle'
    // (see sketchdesktopreset.js) - it needs its OWN real depth here, not
    // the generic circle case's, since its true volume is createHalo3D's
    // clear-acrylic shell (haloAcrylic_), not a flat disc: shellDepth must match
    // that function's own front/shellMargin math exactly, or a support query
    // here disagrees with what's actually rendered.
    const rings = shape.rings || 3;
    const front = haloRingSpan(rings);
    const shellMargin = Math.max(0.4, rad.r * 0.06);
    const shellDepth = front + shellMargin * 2;
    return { localProfile: { kind: 'isotropic', R: rad.r }, zHalf: shellDepth / 2 };
  }
  const zHalf = Math.max(0.8, s * 0.12) / 2; // matches create3DShape's `depth` / 2
  switch (shape.type) {
    case 'circle':
      return { localProfile: { kind: 'isotropic', R: s / 2 }, zHalf };
    case 'semiCircle':
      // Really should be a true rotation-aware half-disc boundary instead of
      // this full-circle isotropic approximation (a rotated open semiCircle's
      // real reach depends heavily on direction, which isotropic ignores -
      // struts can land short of the true edge). Two attempts at a real
      // polygon profile here (25 vertices, then 8) each broke 3D mode
      // outright - first a page hang, then a blank canvas as soon as any
      // open semiCircle was in the composition - so this is reverted back to
      // the simple, proven isotropic version until the actual cause is
      // isolated with proper diagnostics rather than guessed at again.
      return { localProfile: { kind: 'isotropic', R: s / 2 }, zHalf };
    case 'rect': {
      const w = s, h = s * 0.6;
      return {
        localProfile: { kind: 'polygon', vertices: [
          { x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }
        ] },
        zHalf
      };
    }
    case 'triangle': {
      const h = s * Math.sqrt(3) / 2;
      return {
        localProfile: { kind: 'polygon', vertices: [
          { x: -s / 2, y: -h / 3 }, { x: s / 2, y: -h / 3 }, { x: 0, y: 2 * h / 3 }
        ] },
        zHalf
      };
    }
    default:
      return null;
  }
}

// Bundles a shape's static geometry fields (never change once the shape's
// size/rotation are known, independent of where it ends up placed) onto a
// Tier-1 node - shared by the shapes/ornaments gather loops below so a
// skeleton and an ornament of the same type/size get identical support
// behavior. Falls back to a plain sphere (localProfile: null) for types
// computeShapeProfile3D doesn't recognize (shouldn't happen for anything
// shapeVolumeRadius3D already accepted, kept only as a safety net).
function tier1ShapeFields(shape, rad) {
  const profile = computeShapeProfile3D(shape, rad);
  return {
    shapeType: shape.type,
    s: (shape.targetSize || 50) / K3D_SCALE,
    rotZ: -(shape.rot || 0),
    localProfile: profile ? profile.localProfile : null,
    zHalf: profile ? profile.zHalf : rad.r,
    // Only meaningful for concentricArc - see semiCircleAwareDistance,
    // which needs the wedge's real angular sweep to know when a query
    // direction points into its empty (uncovered) side rather than
    // treating it as a full isotropic ring like localProfile does.
    arcStart: shape.type === 'concentricArc' ? (shape.arcStart || 0) : undefined,
    arcSweep: shape.type === 'concentricArc' ? (shape.arcSweep || Math.PI) : undefined,
    // Only meaningful for semiCircle - see semiCircleAwareDistance. An
    // "open" semiCircle's flat/missing half isn't actually empty: it's
    // completed by a real (if faint, ~10% alpha) translucent ghost disc at
    // the EXACT SAME radius as the drawn half (create3DShape's
    // shape_${index}_ghost) - a strut can legitimately reach the shape
    // through that half, at its true full radius, not just near its core.
    // Only the solid/filled style genuinely has nothing there.
    semiCircleOpen: shape.type === 'semiCircle' ? (shape.style === 'open') : undefined
  };
}

// Corner/rim-aware tilt: buildElementTree's contact math assumes each
// solid can reach its FULL bounding radius in the exact direction of its
// contact partner - true for a sphere, but these shapes are thin extruded
// discs/prisms whose real reach is anisotropic (full radius sideways within
// their own profile, only half their thin depth straight through their
// face). Without ever actually turning to face the contact direction, two
// flat, camera-facing shapes stacked mostly along Z would be reported as
// "touching" while their real thin faces left a visible gap. This computes
// the extra tilt (on top of the shape's existing 2D-derived rotZ) that turns
// the profile's nearest corner/rim point to face `dirWorld` exactly, so the
// bounding-sphere assumption becomes geometrically true instead of merely
// optimistic - corner-to-corner, corner-to-side, or corner-to-face contact,
// whichever the geometry naturally produces.
function computeContactTilt(type, s, rotZ, dirWorld) {
  let localCandidates;
  switch (type) {
    case 'circle':
    case 'semiCircle':
    case 'concentricCircle':
      // Isotropic in-plane profile (disc/wedge/ring) - any in-plane direction
      // sits exactly at the bounding radius, so a single arbitrary reference
      // is enough; the tilt below still correctly aims it at dirWorld.
      localCandidates = [new BABYLON.Vector3(1, 0, 0)];
      break;
    case 'rect': {
      const w = s, h = s * 0.6;
      localCandidates = [
        new BABYLON.Vector3(w / 2, h / 2, 0), new BABYLON.Vector3(-w / 2, h / 2, 0),
        new BABYLON.Vector3(w / 2, -h / 2, 0), new BABYLON.Vector3(-w / 2, -h / 2, 0)
      ];
      break;
    }
    case 'triangle': {
      const h = s * Math.sqrt(3) / 2;
      localCandidates = [
        new BABYLON.Vector3(-s / 2, -h / 3, 0), new BABYLON.Vector3(s / 2, -h / 3, 0),
        new BABYLON.Vector3(0, 2 * h / 3, 0)
      ];
      break;
    }
    default:
      return null;
  }

  const dir = new BABYLON.Vector3(dirWorld.x, dirWorld.y, dirWorld.z).normalize();

  // Rotate each local candidate by the shape's existing rotZ first (matching
  // its current on-screen orientation), then pick whichever ends up closest
  // to dirWorld already - so the tilt computed below is the SMALLEST extra
  // rotation needed on top of the shape's original 2D-derived look, not a
  // full from-scratch reorientation.
  const cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);
  let best = null, bestDot = -Infinity;
  for (const c of localCandidates) {
    const rotated = new BABYLON.Vector3(c.x * cosZ - c.y * sinZ, c.x * sinZ + c.y * cosZ, c.z).normalize();
    const dot = BABYLON.Vector3.Dot(rotated, dir);
    if (dot > bestDot) { bestDot = dot; best = rotated; }
  }

  // Minimal rotation mapping `best` (the shape's current nearest reach point,
  // post-rotZ) onto `dir`.
  const axis = BABYLON.Vector3.Cross(best, dir);
  const axisLen = axis.length();
  const dotClamped = Math.max(-1, Math.min(1, BABYLON.Vector3.Dot(best, dir)));
  const angle = Math.acos(dotClamped);
  let qTilt;
  if (axisLen < 1e-6) {
    // best and dir are already (anti)parallel - cross product gives no usable
    // axis. Angle ~0: no tilt needed. Angle ~PI (contact is exactly opposite
    // the nearest reach point, rare): pick any perpendicular axis to flip it.
    qTilt = angle < 1e-3
      ? BABYLON.Quaternion.Identity()
      : BABYLON.Quaternion.RotationAxis(Math.abs(best.x) < 0.9 ? BABYLON.Axis.X : BABYLON.Axis.Y, Math.PI);
  } else {
    qTilt = BABYLON.Quaternion.RotationAxis(axis.normalize(), angle);
  }

  // Compose: apply the shape's existing rotZ first, then the extra tilt on top.
  const qRotZ = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, rotZ);
  return qTilt.multiply(qRotZ);
}

// ===== Real-geometry support distance =====
// A shape only ever gets ONE tilt (toward whichever direction determined
// its own placement, see computeContactTilt) - anything ELSE that touches
// the same shape from a different direction (a "hub") was, until now,
// still assumed to reach the shape's full scalar radius `r` in that new
// direction too. For a sphere that's true; for a flat plate, box, or
// triangle it's usually false - between two corners a polygon's real edge
// sits closer to center than `r`, so the old assumption placed those
// touch points (and the red dots marking them) past the real mesh, in
// empty air. These functions instead ray-cast the shape's REAL, correctly
// oriented silhouette (an extruded 2D profile capped by `zHalf`) to find
// exactly where its boundary is in ANY given world direction.

// Rotates vector `v` by quaternion `q` (v' = q*v*q^-1, optimized form) -
// plain math on {x,y,z}/{x,y,z,w} objects, no BABYLON Vector3 instance
// dependency, so it works the same whether the caller built its objects
// via `new BABYLON.Vector3(...)` or plain literals.
function rotateVecByQuat(v, q) {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx)
  };
}
// World -> local direction: rotate by the CONJUGATE (= inverse, for a unit
// quaternion) of the shape's orientation.
function worldToLocalDir(worldDir, quat) {
  return rotateVecByQuat(worldDir, { x: -quat.x, y: -quat.y, z: -quat.z, w: quat.w });
}

// Ray-from-origin vs. convex-polygon-boundary intersection (standard 2D
// cross-product form): returns the smallest positive `t` such that
// `t*(dx,dy)` lies exactly on the polygon's boundary, or Infinity if the
// ray direction is ~zero (pure-Z case, handled by the caller). `vertices`
// must wind around the origin (true for every profile in
// computeShapeProfile3D - all centered on the shape's own anchor).
function polygonRayExitT(dx, dy, vertices) {
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return Infinity;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const A = vertices[i], B = vertices[(i + 1) % n];
    const ex = B.x - A.x, ey = B.y - A.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const t = (A.x * ey - A.y * ex) / denom;
    const s = (A.x * dy - A.y * dx) / denom;
    if (t > 1e-9 && s >= -1e-6 && s <= 1 + 1e-6) return t;
  }
  return Infinity; // unreachable for a convex polygon that contains the origin
}

// Distance from center to the extruded profile's real boundary along a
// LOCAL-space direction - the profile's in-plane silhouette (isotropic
// disc or polygon) capped by the extrusion's flat top/bottom face at
// `zHalf`, whichever the ray hits first (exactly how a real thin
// disc/box/prism behaves: reach the full in-plane edge sideways, only
// `zHalf` straight through the face).
function profileSupportDistance(profile, localDir, zHalf) {
  const inPlaneLen = Math.hypot(localDir.x, localDir.y);
  const tZ = Math.abs(localDir.z) > 1e-9 ? zHalf / Math.abs(localDir.z) : Infinity;
  const tXY = inPlaneLen > 1e-9
    ? (profile.kind === 'isotropic' ? profile.R / inPlaneLen : polygonRayExitT(localDir.x, localDir.y, profile.vertices))
    : Infinity;
  return Math.min(tXY, tZ);
}

// The real, orientation-aware version of "how far does this shape reach in
// world direction `worldDir`". `nodeInfo` needs {shapeType, s, rotZ,
// localProfile, zHalf, r} (every Tier-1 node carries these once built -
// see the tier1Nodes gather loops in convertShapesTo3D). `tiltDir` is
// always null now (shapes never tilt/rearrange - see buildElementTree),
// which renders as plain Rz(rotZ) - matching create3DShape's own
// `contactQuat = contactDir ? ... : null` fallback exactly, so this always
// agrees with what actually gets drawn. Shapes with no real profile
// (lattices) fall back to the old sphere approximation - create3DLattice
// never tilts them anyway.
function supportDistanceWorld(nodeInfo, tiltDir, worldDir) {
  const profile = nodeInfo.localProfile || { kind: 'isotropic', R: nodeInfo.r };
  const zHalf = nodeInfo.zHalf != null ? nodeInfo.zHalf : nodeInfo.r;
  const quat = (tiltDir && nodeInfo.localProfile)
    ? computeContactTilt(nodeInfo.shapeType, nodeInfo.s, nodeInfo.rotZ, tiltDir)
    : null;
  let q = quat || nodeInfo.fixedOrientation || BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, nodeInfo.rotZ || 0);
  if (nodeInfo.scrambleQuat) q = nodeInfo.scrambleQuat.multiply(q); // scramble composes on top, matching create3DShape
  const localDir = worldToLocalDir(worldDir, q);
  return profileSupportDistance(profile, localDir, zHalf);
}

// supportDistanceWorld(..., DOWN) is a single ray-cast from center - exactly
// right for an isotropic (circular) profile, since a circle's lowest point
// is always straight down. For a rotated POLYGON profile that ray usually
// hits an EDGE, not the shape's true lowest CORNER, which can sit further
// down and off to one side - a rotated rect's real lowest reach was being
// underestimated, letting a rotated shape's actual lowest corner clip
// through the base even though the (wrong) straight-down distance looked
// clear. Checks every real vertex, rotated the same way the shape actually
// renders, and takes the true maximum drop - used anywhere a shape's lowest
// reach must be a hard guarantee (violatesFloor, the base's own Y
// placement), not just an aesthetic strut touch point.
function trueLowestReach(nodeInfo, tiltDir) {
  const rayDist = supportDistanceWorld(nodeInfo, tiltDir, { x: 0, y: -1, z: 0 });
  const profile = nodeInfo.localProfile;
  if (!profile || profile.kind !== 'polygon') return rayDist;
  const quat = (tiltDir && nodeInfo.localProfile)
    ? computeContactTilt(nodeInfo.shapeType, nodeInfo.s, nodeInfo.rotZ, tiltDir)
    : null;
  let q = quat || nodeInfo.fixedOrientation || BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, nodeInfo.rotZ || 0);
  if (nodeInfo.scrambleQuat) q = nodeInfo.scrambleQuat.multiply(q); // scramble composes on top, matching create3DShape
  let maxDrop = 0;
  profile.vertices.forEach(v => {
    const world = rotateVecByQuat({ x: v.x, y: v.y, z: 0 }, q);
    if (-world.y > maxDrop) maxDrop = -world.y;
  });
  return Math.max(rayDist, maxDrop);
}

// Is `worldPoint` inside `node`'s real solid volume? Distance from the
// node's true world center, compared against how far the node's own
// profile actually reaches in that exact direction (supportDistanceWorld) -
// works for isotropic or polygon profiles alike, the same boundary math
// every strut/placement check already relies on.
function pointInsideTier1Volume(worldPoint, node) {
  const wc = tier1WorldCenter(node);
  const dx = worldPoint.x - wc.x, dy = worldPoint.y - wc.y, dz = worldPoint.z - wc.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  const boundary = supportDistanceWorld(node, null, { x: dx / dist, y: dy / dist, z: dz / dist });
  return dist < boundary;
}

// "These are all solid objects... they can't [pass through each other]...
// they must be fastened to each other on the surface." Shared depth-clearance
// for every rigid wire connector (line/bezier/arcline/spiral) - originally
// only the bezier had this, leaving plain lines (often the THICKEST strokes
// in the piece) free to spear straight through shapes' volumes. A wire's 2D
// path is frozen (never reshaped), but its DEPTH is free: sample the same
// points the create3D* function actually renders, at the wire's real final
// position, and if any land inside a Tier-1 shape's volume, search alternate
// Z-leans for one that clears everything. The wire's own TARGET is only
// exempt within a small parameter neighborhood of the anchor - "fastened at
// the surface" means ONE touch point, not license for the rest of the wire
// to lie inside the target. (Excluding the whole target - the original
// behavior - let a spiral's coil, which hugs its target's face, slide whole
// loops through the target's volume the moment its free-end lean tilted it
// inward, with nothing checking it.) Falls back to the original lean if
// nothing clear turns up (same honest fallback as drawClearStrut).
// `samplePixelPts` must use the same parametrization the rendered tube's own
// Z-ramp uses (uniform index over the drawn points), so the checked curve
// always matches the drawn one.
const WIRE_ANCHOR_EPS = 0.05; // parameter-distance around the anchor that's allowed to touch the target
// The free-end lean used when a connector has no genuine second target to
// reach toward. Module scope (was local to convertShapesTo3D) so
// computeConnectorAnchor resolves the EXACT same fallback before running its
// clearance check - previously the check could return null here, whereupon
// realizeConnector quietly substituted this value UNCHECKED, so the tilt
// actually rendered was never the tilt that was verified. That is what kept
// driving spiral coils through shapes even after the check existed.
const CONNECTOR_FREE_END_TILT = 6;
// Returns a tilt that is always a real number, and always the one that was
// actually verified. If nothing is fully clear, returns the BEST-EFFORT
// candidate (fewest intersecting samples) rather than the original - a wire
// grazing one shape is strictly better than one buried through three.
function clearWireZTilt(samplePixelPts, deltaPixel, touchZ, anchorT, zTilt, tier1Placed, target) {
  const n = samplePixelPts.length - 1 || 1;
  const violations = (tilt) => {
    let count = 0;
    samplePixelPts.forEach((p, idx) => {
      const t = idx / n;
      const w = pixelToWorld(p.x + deltaPixel.dx, p.y + deltaPixel.dy);
      const pt = { x: w.x, y: w.y, z: touchZ + (t - anchorT) * tilt };
      tier1Placed.forEach(node => {
        if (node.isBase) return;
        if (node === target && Math.abs(t - anchorT) <= WIRE_ANCHOR_EPS) return;
        if (pointInsideTier1Volume(pt, node)) count++;
      });
    });
    return count;
  };
  const start = zTilt == null ? 0 : zTilt;
  if (violations(start) === 0) return start;
  const candidates = [0, MAX_REACH_ZTILT, -MAX_REACH_ZTILT, MAX_REACH_ZTILT * 0.5, -MAX_REACH_ZTILT * 0.5,
    MAX_REACH_ZTILT * 0.25, -MAX_REACH_ZTILT * 0.25, MAX_REACH_ZTILT * 0.75, -MAX_REACH_ZTILT * 0.75];
  let best = start, bestCount = violations(start);
  for (const cand of candidates) {
    const c = violations(cand);
    if (c < bestCount) { bestCount = c; best = cand; }
    if (c === 0) return cand;
  }
  return best;
}

// semiCircle's real shape is a half-disc (bulge at local y<0, flat edge at
// y=0 - see arcPathLocal), but its shared localProfile stays isotropic
// (matches a full circle in every direction) for safety - two attempts at a
// real polygon profile there each broke 3D mode outright in different ways
// once fed into buildElementTree's placement machinery (a page hang, then a
// blank canvas). This is a narrow, SEPARATE correction used only where
// struts pick a touch point - never in placement/collision, which stays on
// the safe isotropic path. If the query direction points into the flat
// half's side and there's genuinely nothing built there (the SOLID/filled
// style - see the semiCircleOpen check just below, which skips this
// entirely for the OPEN style: that one has a real, if faint, ghost disc
// completing that exact half - see tier1ShapeFields), cap the reach down
// near the shape's own thickness instead of the full isotropic radius, so a
// strut aimed at a filled semiCircle's missing material doesn't reach as
// far as where a full circle's edge would be.
//
// concentricArc gets the same treatment for the same reason: its
// localProfile is isotropic (a full ring at the outer radius), but the
// actual rendered wedge (see createConcentricArc3D) only covers
// [arcStart, arcStart+arcSweep] - typically a half-sweep, same idea as
// semiCircle. A query direction outside that sweep has no real material out
// at the ring radius at all, just the thin pie-slice edge back toward the
// center - without this, a strut approaching from the wedge's empty side
// (e.g. straight down, if the sweep doesn't cover "down") lands at the full
// isotropic radius, far past where the shape actually is.
function semiCircleAwareDistance(nodeInfo, worldDir) {
  const baseDist = supportDistanceWorld(nodeInfo, nodeInfo.contactDir, worldDir);
  if (nodeInfo.shapeType === 'concentricArc') {
    let q = nodeInfo.fixedOrientation || BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, nodeInfo.rotZ || 0);
    if (nodeInfo.scrambleQuat) q = nodeInfo.scrambleQuat.multiply(q);
    const localDir = worldToLocalDir(worldDir, q);
    // Matches arcPathLocal's own (R*cos(t), -R*sin(t)) parametrization, so
    // this angle lands in the exact same frame arcStart/arcSweep are
    // defined in.
    let angle = Math.atan2(-localDir.y, localDir.x);
    const a0 = nodeInfo.arcStart || 0;
    const a1 = a0 + (nodeInfo.arcSweep != null ? nodeInfo.arcSweep : Math.PI);
    while (angle < a0) angle += Math.PI * 2;
    while (angle >= a0 + Math.PI * 2) angle -= Math.PI * 2;
    if (angle > a1) {
      const zHalf = nodeInfo.zHalf != null ? nodeInfo.zHalf : nodeInfo.r;
      return Math.min(baseDist, zHalf * 1.5);
    }
    return baseDist;
  }
  if (nodeInfo.shapeType !== 'semiCircle') return baseDist;
  // The ghost disc completes an open semiCircle's missing half at the exact
  // same radius the isotropic profile already assumes (see
  // tier1ShapeFields) - baseDist is already correct as-is, uncapped, same
  // as a real full circle. Only a SOLID/filled semiCircle (no ghost) still
  // needs the cap below.
  if (nodeInfo.semiCircleOpen) return baseDist;
  let q = nodeInfo.fixedOrientation || BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, nodeInfo.rotZ || 0);
  if (nodeInfo.scrambleQuat) q = nodeInfo.scrambleQuat.multiply(q);
  const localDir = worldToLocalDir(worldDir, q);
  const inPlaneLen = Math.hypot(localDir.x, localDir.y);
  if (inPlaneLen > 1e-6 && localDir.y / inPlaneLen > 0.05) {
    const zHalf = nodeInfo.zHalf != null ? nodeInfo.zHalf : nodeInfo.r;
    return Math.min(baseDist, zHalf * 1.5);
  }
  return baseDist;
}

function create3DShape(shape, index, layerZ = 0, contactDir = null, resolvedXY = null, scrambleQuat = null) {
  if (!shape || !babylonScene) {
    console.warn('Cannot create shape - missing shape or scene');
    return false;
  }

  const S2 = shape.targetSize || 50;             // 2D pixel size
  const s = S2 / K3D_SCALE;                      // 3D size
  const sw3 = Math.max((shape.sw || 2) / K3D_SCALE, 0.16); // stroke thickness (3D units)
  const swr = sw3 / 2;                           // tube radius
  const depth = Math.max(0.8, s * 0.12);         // Z thickness: real 3D volume per shape
  const zPos = -layerZ;
  // resolvedXY (world units) comes from buildElementTree (Tier 1) or
  // computeConnectorAnchor (Tier 2 halo/arc-type ornaments) - NEVER read
  // shape.x/y directly here once a resolved position exists, since shape.x/y
  // is the live 2D object the running p5 draw loop also reads every frame.
  // The raw-shape.x/y fallback below only matters if this is ever called
  // without a resolved position (shouldn't happen post-rewrite, kept as a
  // safe default rather than a silent crash).
  const xPos = resolvedXY ? resolvedXY.x : (shape.x - window.innerWidth / 2) / K3D_SCALE;
  const yPos = resolvedXY ? resolvedXY.y : -(shape.y - window.innerHeight / 2) / K3D_SCALE;
  const rotZ = -(shape.rot || 0);                // P5 rotation -> Babylon (Y flipped)
  const fill = bodyColor3D(p5ColToRGBA(shape.c)); // global 3D translucency + saturation compensation

  // CONTACT TILT: when buildElementTree found a real touching neighbor for
  // this shape, wrap it in a TransformNode carrying the combined
  // rotZ+tilt orientation so its nearest corner/rim actually faces that
  // neighbor (see computeContactTilt) - the mesh(es) below are then built at
  // the node's local origin with zero rotation of their own and parented to
  // it, so the node's transform does all the positioning/orienting. Shapes
  // with no contactDir (not solid, or no contact found) are completely
  // unaffected - meshX/Y/Z/RotZ just fall back to the plain xPos/yPos/zPos/rotZ
  // used everywhere today.
  const contactQuat = contactDir ? computeContactTilt(shape.type, s, rotZ, contactDir) : null;
  // Scramble composes ON TOP of whatever base orientation the shape has -
  // the contact tilt when there is one (contactQuat already includes rotZ),
  // plain Rz otherwise - using the same expression the support math uses,
  // so struts and meshes can never disagree about where a face points.
  let orientQuat = contactQuat;
  if (scrambleQuat) {
    orientQuat = scrambleQuat.multiply(
      contactQuat || BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, rotZ));
  }
  // ALWAYS wrap every shape in its own tilt_${index} node - even with no
  // real tilt (orientQuat null, plain Rz used instead) - so every shape
  // type (including concentricCircle/concentricArc/halo/squiggle, which
  // never get a "shape_${index}" mesh of their own) has ONE consistent,
  // predictably-named root that scramble-transition animation (see
  // shapeRootNodesByIndex in the scramble-animation section below) can
  // always find and move as a unit, regardless of shape type or naming.
  const vol = shapeVolumeRadius3D(shape);
  const trueCenterZ = zPos - (vol ? vol.zOffset : 0);
  const tiltNode = new BABYLON.TransformNode(`tilt_${index}`, babylonScene);
  tiltNode.position = new BABYLON.Vector3(xPos, yPos, trueCenterZ);
  tiltNode.rotationQuaternion = orientQuat || BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, rotZ);
  const meshX = 0;
  const meshY = 0;
  const meshZ = 0;
  const meshRotZ = 0;

  try {
    // ---- circle / halo ----
    if (shape.type === 'circle') {
      if (shape.style === 'halo') {
        return createHalo3D(shape, index, xPos, yPos, zPos, s, swr, tiltNode);
      }
      const disc = tagVolumeBody(BABYLON.MeshBuilder.CreateCylinder(`shape_${index}`, {
        diameter: s, height: depth, tessellation: 64
      }, babylonScene));
      disc.rotation.x = Math.PI / 2;
      disc.position = new BABYLON.Vector3(meshX, meshY, meshZ);
      disc.material = shapeBodyMat(`mat_${index}`, fill);
      shapeBodyMeshes.push(disc);
      if (tiltNode) disc.parent = tiltNode;
      addPrismOutline(`outline_${index}`, arcPathLocal(s / 2, 0, Math.PI * 2, 64), depth, swr, meshX, meshY, meshZ, 0, [], false, tiltNode);
      return true;
    }

    // ---- rect (2D is s wide x 0.6s tall!) ----
    if (shape.type === 'rect') {
      if (shape.style === 'open') return createOpenShape3D(shape, index, meshX, meshY, meshZ, s, meshRotZ, tiltNode);
      const w = s, h = s * 0.6;
      const box = tagVolumeBody(BABYLON.MeshBuilder.CreateBox(`shape_${index}`, { width: w, height: h, depth: depth }, babylonScene));
      box.position = new BABYLON.Vector3(meshX, meshY, meshZ);
      box.rotation.z = meshRotZ;
      box.material = shapeBodyMat(`mat_${index}`, fill);
      shapeBodyMeshes.push(box);
      if (tiltNode) box.parent = tiltNode;
      const rp = [
        new BABYLON.Vector3(-w / 2, -h / 2, 0), new BABYLON.Vector3(w / 2, -h / 2, 0),
        new BABYLON.Vector3(w / 2, h / 2, 0), new BABYLON.Vector3(-w / 2, h / 2, 0),
        new BABYLON.Vector3(-w / 2, -h / 2, 0)
      ];
      addPrismOutline(`outline_${index}`, rp, depth, swr, meshX, meshY, meshZ, meshRotZ, rp.slice(0, 4), true, tiltNode);
      return true;
    }

    // ---- triangle (apex UP like 2D, equilateral centered on centroid) ----
    if (shape.type === 'triangle') {
      if (shape.style === 'open') return createOpenShape3D(shape, index, meshX, meshY, meshZ, s, meshRotZ, tiltNode);
      const h = s * Math.sqrt(3) / 2;
      // Triangular PRISM (real 3D volume) - exact same profile as the 2D triangle
      tagVolumeBody(extrudePrism(`shape_${index}`, [
        new BABYLON.Vector3(-s / 2, -h / 3, 0),
        new BABYLON.Vector3(s / 2, -h / 3, 0),
        new BABYLON.Vector3(0, 2 * h / 3, 0)
      ], depth, fill, meshX, meshY, meshZ, meshRotZ, tiltNode));
      const v = [
        new BABYLON.Vector3(-s / 2, -h / 3, 0),
        new BABYLON.Vector3(s / 2, -h / 3, 0),
        new BABYLON.Vector3(0, 2 * h / 3, 0),
        new BABYLON.Vector3(-s / 2, -h / 3, 0)
      ];
      addPrismOutline(`outline_${index}`, v, depth, swr, meshX, meshY, meshZ, meshRotZ, v.slice(0, 3), true, tiltNode);
      return true;
    }

    // ---- semiCircle (2D arc(0,0,s,s,0,PI) = bottom half on screen) ----
    if (shape.type === 'semiCircle') {
      if (shape.style === 'open') {
        const success = createOpenShape3D(shape, index, meshX, meshY, meshZ, s, meshRotZ, tiltNode);
        // "Complete the circle with 90% translucency" - createOpenShape3D's
        // own gradient already fades to fully transparent right at the
        // flat/open edge, so a strut or connector landing near there reads
        // as touching nothing. A faint (10% opacity) disc over just the
        // MISSING half - not the other tagAcrylicVolume() call sites' full
        // duplicate-footprint ghosts - suggests the whole circle's real
        // presence without competing with the actual rendered half. No
        // outline (matches the earlier "no black line" call); the earlier
        // flat-cap attempt at this was reverted on suspicion of causing a
        // blank-canvas crash, but that was actually a separate bug (the
        // semiCircle support-profile change) - this is new rendering-only
        // geometry, not a repeat of that.
        // Deliberately NOT tagAcrylicVolume() (skipUsdz): that tag exists
        // because the OTHER acrylic ghosts sit exactly coplanar with a real
        // shape's own surface, which z-fights and shimmers in AR. This one
        // covers only the half the real shape ISN'T already drawing, so
        // there's nothing to fight - it's the one piece of "integrity"
        // structure AR was missing that 2D/3D already show. Its ~10% alpha
        // is well under USDZ_GLASS_BELOW, so meshUsdSurface exports it
        // as-is rather than forcing it toward opaque.
        if (success) {
          const ghostFill = CLEAR_ACRYLIC_COLOR; // colorless (not tinted with the shape's own hue) - same neutral clear-acrylic material used elsewhere in the piece
          extrudePrism(`shape_${index}_ghost`, arcPathLocal(s / 2, Math.PI, Math.PI * 2, 48), depth, ghostFill, meshX, meshY, meshZ, meshRotZ, tiltNode);
        }
        return success;
      }
      // Half-disc WEDGE (real 3D volume) - profile matches the 2D bottom-half arc exactly
      tagVolumeBody(extrudePrism(`shape_${index}`, arcPathLocal(s / 2, 0, Math.PI, 48), depth, fill, meshX, meshY, meshZ, meshRotZ, tiltNode));
      // 2D stroke follows the curved edge only (the flat diameter edge stays unstroked)
      const semiArc = arcPathLocal(s / 2, 0, Math.PI, 48);
      addPrismOutline(`outline_${index}`, semiArc, depth, swr, meshX, meshY, meshZ, meshRotZ,
        [semiArc[0], semiArc[semiArc.length - 1]], true, tiltNode);
      return true;
    }

    if (shape.type === 'concentricCircle') {
      return createConcentricCircle3D(shape, index, xPos, yPos, zPos, tiltNode);
    }
    if (shape.type === 'concentricArc') {
      return createConcentricArc3D(shape, index, xPos, yPos, zPos, swr, rotZ, tiltNode);
    }

    // ---- squiggle: STROKED wavy line with shape color (like 2D) ----
    if (shape.type === 'squiggle') {
      if (!shape.sv || shape.sv.length < 2) return false;
      const pts = shape.sv.map(p => new BABYLON.Vector3(p.x / K3D_SCALE, -p.y / K3D_SCALE, 0));
      makeStrokeTube(`shape_${index}`, pts, swr, fill, meshX, meshY, meshZ, meshRotZ, tiltNode, true);
      return true;
    }

    // ---- arc: STROKED arc (noFill in 2D!) with shape color ----
    if (shape.type === 'arc') {
      const a0 = shape.arcStart || 0;
      const a1 = a0 + (shape.arcSweep || Math.PI);
      makeStrokeTube(`shape_${index}`, arcPathLocal(s / 2, a0, a1, 48), swr, fill, meshX, meshY, meshZ, meshRotZ, tiltNode, true);
      return true;
    }

    // ---- fallback: plain disc ----
    const disc = tagVolumeBody(BABYLON.MeshBuilder.CreateCylinder(`shape_${index}`, {
      diameter: s, height: 0.3, tessellation: 64
    }, babylonScene));
    disc.rotation.x = Math.PI / 2;
    disc.position = new BABYLON.Vector3(meshX, meshY, meshZ);
    disc.material = shapeBodyMat(`mat_${index}`, fill);
    shapeBodyMeshes.push(disc);
    if (tiltNode) disc.parent = tiltNode;
    return true;
  } catch (e) {
    console.error(`Failed to create shape ${index} (${shape.type}/${shape.style}):`, e);
    return false;
  }
}

// Total Z depth a halo's own ring stack actually spans - 8 gradient layers
// (each += 0.03) plus (rings-1) solid rings (each += 0.5), exactly matching
// createHalo3D's own `front` stepping below. Shared with
// computeConnectorAnchor's 'halo' case so the acrylic shell's real extent and
// the touch-point math computed against it can never drift apart.
function haloRingSpan(rings) {
  return 8 * 0.03 + Math.max(0, rings - 1) * 0.5;
}

function createHalo3D(shape, index, x, y, z, s, swr, tiltNode = null) {
  // 2D: maxRadius = s/2; radius_i = maxR*(rings-i)/rings
  // i=0: radial gradient (solid core -> transparent rim), no stroke
  // i>0: solid muted color + black stroke (sw * 0.5)
  const rings = shape.rings || 3;
  const maxR = s / 2;
  let front = 0; // each later element drawn slightly in front (like 2D painter order)
  const mx = tiltNode ? 0 : x;
  const my = tiltNode ? 0 : y;
  const mz = tiltNode ? 0 : z;

  for (let i = 0; i < rings; i++) {
    const radius = maxR * (rings - i) / rings;
    const raw = p5ColToRGBA(shape.haloColors && shape.haloColors[i] ? shape.haloColors[i] : shape.c);
    // A halo's ring color gets muted TWICE before bodyColor3D's own
    // saturation compensation ever sees it - the 2D sketch's own "*0.7
    // saturation, *0.8 lightness" pass, then the *0.85 darken just below -
    // so by the time BODY_SATURATION_3D's shared push runs, there's less
    // real color range left to push against, and halos read flatter than
    // every other body at the identical multiplier. A dedicated extra push
    // on the still-vivid raw color, before any of that muting touches it,
    // brings them back in line with the rest of the piece.
    const vivid = saturate3D(raw, HALO_SATURATION_BOOST);
    // 2D mutes: saturation*0.7, lightness*0.8, alpha 0.8 (approximated in RGB)
    // - then the global 3D body treatment (translucency + saturation
    // compensation) on top; the gradient ring's stops already derive from
    // muted's r/g/b/a, so this covers both the solid rings and the glow
    const muted = bodyColor3D({ r: vivid.r * 0.85, g: vivid.g * 0.85, b: vivid.b * 0.85, a: 0.8 });

    if (i === 0) {
      // Real smooth radial gradient (canvas-drawn onto a DynamicTexture),
      // not a stack of discrete alpha-blended discs - the old approach
      // (8 layered circles, each a hard-edged step in opacity) read as
      // visibly "steppy"/banded up close since it only had 8 discrete
      // opacity levels. A true canvas gradient has no such steps - same
      // texture technique createOpenShape3D already uses for its own fade.
      const TEX = 512;
      const tex = new BABYLON.DynamicTexture(`haloGradTex_${index}`, { width: TEX, height: TEX }, babylonScene, true);
      tex.hasAlpha = true;
      const gctx = tex.getContext();
      gctx.clearRect(0, 0, TEX, TEX);
      const cx = TEX / 2, cy = TEX / 2, rPix = TEX / 2;
      const rr = Math.round(muted.r * 255), gg = Math.round(muted.g * 255), bb = Math.round(muted.b * 255);
      const grad = gctx.createRadialGradient(cx, cy, 0, cx, cy, rPix);
      grad.addColorStop(0, `rgba(${rr},${gg},${bb},${muted.a * 0.9})`);
      grad.addColorStop(0.6, `rgba(${rr},${gg},${bb},${muted.a * 0.35})`);
      grad.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
      gctx.fillStyle = grad;
      gctx.beginPath();
      gctx.arc(cx, cy, rPix, 0, Math.PI * 2);
      gctx.fill();
      tex.update();

      const disc = BABYLON.MeshBuilder.CreateDisc(`halo_${index}_glow`, {
        radius, tessellation: 64, sideOrientation: BABYLON.Mesh.DOUBLESIDE
      }, babylonScene);
      disc.position = new BABYLON.Vector3(mx, my, mz - front);
      const gradMat = new BABYLON.StandardMaterial(`haloGradMat_${index}`, babylonScene);
      gradMat.diffuseTexture = tex;
      gradMat.emissiveTexture = tex;
      gradMat.useAlphaFromDiffuseTexture = true;
      gradMat.disableLighting = true;
      gradMat.specularColor = new BABYLON.Color3(0, 0, 0);
      gradMat.backFaceCulling = false;
      disc.material = gradMat;
      if (tiltNode) disc.parent = tiltNode;
      front += 8 * 0.03; // same total depth budget the old 8-layer stack used - keeps haloRingSpan's formula (and the shell/anchor math built on it) unchanged
    } else {
      // Thin solid cylinder per ring = real 3D volume
      const disc = tagVolumeBody(BABYLON.MeshBuilder.CreateCylinder(`halo_${index}_${i}`, {
        diameter: radius * 2, height: 0.4, tessellation: 64
      }, babylonScene));
      disc.rotation.x = Math.PI / 2;
      disc.position = new BABYLON.Vector3(mx, my, mz - front);
      disc.material = shapeBodyMat(`haloMat_${index}_${i}`, muted);
      shapeBodyMeshes.push(disc);
      if (tiltNode) disc.parent = tiltNode;
      makeStrokeTube(`haloOutline_${index}_${i}`, arcPathLocal(radius, 0, Math.PI * 2, 64), swr * 0.5, K3D_BLACK, mx, my, mz - front - 0.25, 0, tiltNode);
      front += 0.5;
    }
  }

  // A halo is otherwise just a stack of flat, camera-facing discs - real
  // color but no actual volume around it, floating like a decal. Same
  // treatment concentricArc's bare stroke rings got: a solid, mostly-
  // transparent clear-acrylic shell sized to the halo's own outer radius -
  // but spanning (and centered on) the FULL depth of the ring stack
  // (z - front to z), not just parked behind the backmost ring, so every
  // ring actually sits INSIDE the shell's volume instead of the shell
  // reading as a flat plate trailing behind them.
  const shellMargin = Math.max(0.4, maxR * 0.06);
  const shellDepth = front + shellMargin * 2;
  tagAcrylicVolume(extrudePrism(`haloAcrylic_${index}`, arcPathLocal(maxR, 0, Math.PI * 2, 64), shellDepth, CLEAR_ACRYLIC_COLOR, mx, my, mz - front / 2, 0, tiltNode));

  return true;
}

function createConcentricCircle3D(shape, index, x, y, z, tiltNode = null) {
  // 2D: noStroke! Drawn largest -> smallest, diameter = i * diff * 2
  const rings = shape.rings || 4;
  const diff3 = (shape.diff || 10) / K3D_SCALE;
  // Must exactly match shapeVolumeRadius3D's concentricCircle zOffset - when
  // tilted, tiltNode is pivoted at the TRUE center (anchor's world Z minus
  // this), not the anchor itself, so each ring's local offset needs the same
  // correction to land in exactly the same place a non-tilted stack would.
  const zOffset = (rings - 1) * 0.3;
  const outerR = rings * diff3;

  for (let i = rings; i > 0; i--) {
    const radius = i * diff3;
    if (radius <= 0) continue;
    // Thin solid cylinder per ring = real 3D volume
    const disc = tagVolumeBody(BABYLON.MeshBuilder.CreateCylinder(`concentric_${index}_${i}`, {
      diameter: radius * 2, height: 0.5, tessellation: 64
    }, babylonScene));
    disc.rotation.x = Math.PI / 2;
    // Smaller rings drawn later in 2D = slightly in front here. When tilted
    // (contact placement gave this shape a real touching neighbor), the ring
    // stack's position/orientation is entirely carried by tiltNode - each
    // ring only needs its own local stacking offset (relative to the TRUE
    // center pivot, hence + zOffset) at the node origin.
    const localZ = -(rings - i) * 0.6;
    disc.position = tiltNode
      ? new BABYLON.Vector3(0, 0, localZ + zOffset)
      : new BABYLON.Vector3(x, y, z + localZ);
    if (tiltNode) disc.parent = tiltNode;
    const col = bodyColor3D(p5ColToRGBA(shape.concentricColors && shape.concentricColors[i - 1] ? shape.concentricColors[i - 1] : shape.c));
    disc.material = shapeBodyMat(`concentricMat_${index}_${i}`, col);
    shapeBodyMeshes.push(disc);
  }

  // Enclose the whole tapering ring stack in a solid, mostly-transparent
  // clear-acrylic cylinder - the "cast in real material, not floating discs"
  // treatment concentricArc/halo already got, and for a sharper reason
  // here: a strut/contact touch point is computed against this shape's
  // ISOTROPIC profile (see computeShapeProfile3D - a uniform-radius
  // cylinder spanning the full depth, not the true tapering silhouette
  // above), so without a real surface matching that same radius/depth, a
  // touch point could land past the actual (smaller, further-back) ring at
  // that depth, in empty air - exactly why a concentricCircle could read as
  // unsupported despite already being guaranteed a real strut. Deliberately
  // a plain cylinder at the outer radius, not a literal tapered cone
  // hugging each ring's true size, so the physical mesh and the analytic
  // profile everything else (buildElementTree, computeContactTilt) already
  // assumes can never disagree about where the surface actually is.
  const shellMargin = Math.max(0.4, outerR * 0.06);
  const shellDepth = (rings - 1) * 0.6 + shellMargin * 2;
  const shellX = tiltNode ? 0 : x;
  const shellY = tiltNode ? 0 : y;
  const shellZ = tiltNode ? 0 : z - (rings - 1) * 0.3; // true center - matches zOffset above
  tagAcrylicVolume(extrudePrism(`concentricAcrylic_${index}`, arcPathLocal(outerR, 0, Math.PI * 2, 64), shellDepth, CLEAR_ACRYLIC_COLOR, shellX, shellY, shellZ, 0, tiltNode));

  return true;
}

function createConcentricArc3D(shape, index, x, y, z, swr, rotZ, tiltNode = null) {
  // 2D: noFill! STROKED arcs with concentric colors, diameter = i * diff * 2.
  // On their own these are bare open wire (stroke tubes, no fill) - reclassified
  // as Tier-1 with a real volume: a solid, mostly-transparent "clear acrylic"
  // wedge sized to the ring stack's own outer radius/sweep, so the nested
  // rings read as cast/embedded inside a real physical block, the way a
  // wireframe or metal armature gets held in a clear acrylic casting, rather
  // than floating as unsupported open curves.
  const rings = shape.rings || 4;
  const diff3 = (shape.diff || 10) / K3D_SCALE;
  const a0 = shape.arcStart || 0;
  const a1 = a0 + (shape.arcSweep || Math.PI);
  const outerR = rings * diff3;

  const meshX = tiltNode ? 0 : x;
  const meshY = tiltNode ? 0 : y;
  const meshZ = tiltNode ? 0 : z;
  const meshRotZ = tiltNode ? 0 : rotZ;

  const acrylicDepth = Math.max(0.8, outerR * 2 * 0.12); // must match computeShapeProfile3D's concentricArc zHalf*2
  const arcPts = arcPathLocal(outerR, a0, a1, 48);
  const wedgeProfile = [new BABYLON.Vector3(0, 0, 0), ...arcPts];
  // Deliberately NOT tagAcrylicVolume() (skipUsdz): unlike the OTHER acrylic
  // ghosts (semiCircle's old full-disc completion, the halo shell), this
  // wedge doesn't sit coplanar with any other shape's own fill - the rings
  // it holds are bare stroke tubes with no flat face to z-fight against, and
  // this IS the shape's only real volume (without it there'd be nothing
  // here at all in AR, just floating wire). shapeVolumeRadius3D/
  // computeShapeProfile3D already size a strut's attachment point to this
  // same outerR, so once this mesh is actually present in AR a strut lands
  // right on its real outer surface rather than reaching into empty space
  // where an invisible casing used to be. Its ~alpha is well under
  // USDZ_GLASS_BELOW, so meshUsdSurface exports it translucent as-is.
  extrudePrism(`concentricArcAcrylic_${index}`, wedgeProfile, acrylicDepth, CLEAR_ACRYLIC_COLOR, meshX, meshY, meshZ, meshRotZ, tiltNode);
  // No outline - a real black edge read as too heavy/solid for something meant
  // to look like clear acrylic. The near-invisible fill plus the rings it holds
  // is enough to convey "there's material here," per the user's call.

  for (let i = rings; i > 0; i--) {
    const radius = i * diff3;
    if (radius <= 0) continue;
    const col = bodyColor3D(p5ColToRGBA(shape.concentricColors && shape.concentricColors[i - 1] ? shape.concentricColors[i - 1] : shape.c));
    makeStrokeTube(`concentricArc_${index}_${i}`, arcPathLocal(radius, a0, a1, 48), swr, col, meshX, meshY, meshZ - (rings - i) * 0.05, meshRotZ, tiltNode, true);
  }
  return true;
}

// Open shapes: EXACT port of the 2D canvas code (linear gradient along
// gradientAngle, open edge stays open, outline only on closed edges).
// Rendered into a DynamicTexture on a plane = pixel-perfect 2D analog in 3D.
function createOpenShape3D(shape, index, x, y, z, s, rotZ, tiltNode = null) {
  const meshX = tiltNode ? 0 : x;
  const meshY = tiltNode ? 0 : y;
  const meshZ = tiltNode ? 0 : z;
  const meshRotZ = tiltNode ? 0 : rotZ;
  const S2 = shape.targetSize || 50; // 2D pixel size
  const PAD = 1.5;
  const TEX = 1536; // was 512: looked fuzzy up close in 3D (fixed texture res upscaled/magnified)
  const tex = new BABYLON.DynamicTexture(`openTex_${index}`, { width: TEX, height: TEX }, babylonScene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, TEX, TEX);
  ctx.save();
  ctx.translate(TEX / 2, TEX / 2);
  const k = TEX / (S2 * PAD);
  ctx.scale(k, k);
  ctx.lineWidth = shape.sw || 2;
  ctx.lineCap = 'round';

  // Saturation-compensated body color (see saturate3D) baked into the
  // texture's gradient stops; translucency is NOT baked in here - the
  // material's own alpha (BODY_ALPHA_3D, set below) multiplies the
  // texture's per-pixel alpha, so baking it too would double-apply it.
  const openFill = saturate3D(p5ColToRGBA(shape.c));
  const openCSS = a => `rgba(${Math.round(openFill.r * 255)},${Math.round(openFill.g * 255)},${Math.round(openFill.b * 255)},${a})`;
  const solid = openCSS(openFill.a);
  const transparent = openCSS(0);
  const theta = shape.gradientAngle || 0;
  const dx = Math.cos(theta), dy = Math.sin(theta);
  // Gradient direction in Babylon local coords, hoisted up from where the
  // fade walls compute it below (search gx/gy) so the USDZ export metadata
  // can tag the SAME direction - without this, AR fell back to a generic
  // radial "denser at the centre" fake-volume gradient that has nothing to
  // do with the shape's actual 2D gradientAngle, which is why open shapes'
  // colours read as flat/uniform in AR instead of a real linear gradient.
  const gx = shape.type === 'semiCircle' ? 0 : dx;
  const gy = shape.type === 'semiCircle' ? 1 : -dy;

  if (shape.type === 'rect') {
    const w = S2, h = S2 * 0.6;
    const verts = [[-w/2, -h/2], [w/2, -h/2], [w/2, h/2], [-w/2, h/2]];
    const edges = [
      { v: [verts[0], verts[1]], dir: [0, -1] }, { v: [verts[1], verts[2]], dir: [1, 0] },
      { v: [verts[2], verts[3]], dir: [0, 1] }, { v: [verts[3], verts[0]], dir: [-1, 0] }
    ];
    let maxDot = -Infinity, openIdx = 0;
    for (let i = 0; i < 4; i++) {
      const dot = edges[i].dir[0] * dx + edges[i].dir[1] * dy;
      if (dot > maxDot) { maxDot = dot; openIdx = i; }
    }
    const opp = (openIdx + 2) % 4;
    const sE = edges[opp].v, eE = edges[openIdx].v;
    const lg = ctx.createLinearGradient(
      (sE[0][0] + sE[1][0]) / 2, (sE[0][1] + sE[1][1]) / 2,
      (eE[0][0] + eE[1][0]) / 2, (eE[0][1] + eE[1][1]) / 2
    );
    lg.addColorStop(0, solid);
    lg.addColorStop(0.9, transparent);
    lg.addColorStop(1, transparent);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(verts[0][0], verts[0][1]);
    ctx.lineTo(verts[1][0], verts[1][1]);
    ctx.lineTo(verts[2][0], verts[2][1]);
    ctx.lineTo(verts[3][0], verts[3][1]);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = lg;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
    // Outline ONLY on non-open edges - the open side stays open
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    for (let i = 0; i < 4; i++) {
      if (i !== openIdx) {
        ctx.beginPath();
        ctx.moveTo(edges[i].v[0][0], edges[i].v[0][1]);
        ctx.lineTo(edges[i].v[1][0], edges[i].v[1][1]);
        ctx.stroke();
      }
    }
  } else if (shape.type === 'triangle') {
    const hgt = S2 * Math.sqrt(3) / 2;
    const v = [[-S2/2, hgt/3], [S2/2, hgt/3], [0, -2*hgt/3]];
    let maxDot = -Infinity, openIdx = 0;
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const mx = (v[i][0] + v[j][0]) / 2, my = (v[i][1] + v[j][1]) / 2;
      if ((mx * dx + my * dy) > maxDot) { maxDot = mx * dx + my * dy; openIdx = i; }
    }
    const sv = v[(openIdx + 2) % 3];
    const eA = v[openIdx], eB = v[(openIdx + 1) % 3];
    const lg = ctx.createLinearGradient(sv[0], sv[1], (eA[0] + eB[0]) / 2, (eA[1] + eB[1]) / 2);
    lg.addColorStop(0, solid);
    lg.addColorStop(0.9, transparent);
    lg.addColorStop(1, transparent);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(v[0][0], v[0][1]);
    ctx.lineTo(v[1][0], v[1][1]);
    ctx.lineTo(v[2][0], v[2][1]);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = lg;
    ctx.fillRect(-S2, -S2, 2 * S2, 2 * S2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    for (let i = 0; i < 3; i++) {
      if (i !== openIdx) {
        const j = (i + 1) % 3;
        ctx.beginPath();
        ctx.moveTo(v[i][0], v[i][1]);
        ctx.lineTo(v[j][0], v[j][1]);
        ctx.stroke();
      }
    }
  } else if (shape.type === 'semiCircle') {
    // Gradient from peak (y=r) to base (y=0), arc stroke only - flat side open
    const r = S2 / 2;
    const lg = ctx.createLinearGradient(0, r, 0, 0);
    lg.addColorStop(0, solid);
    lg.addColorStop(0.9, transparent);
    lg.addColorStop(1, transparent);
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI);
    ctx.stroke();
  }

  ctx.restore();
  tex.update();

  const m = new BABYLON.StandardMaterial(`openMat_${index}`, babylonScene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.useAlphaFromDiffuseTexture = true;
  // Always zeroed: diffuseColor defaults to white and StandardMaterial
  // multiplies it into the diffuseTexture for the LIT term, so left alone it
  // would tint the shape's real drawn pixels by whatever the light rig
  // contributes below. emissiveTexture (unaffected by lighting) is what
  // actually carries the shape's exact colour.
  m.diffuseColor = new BABYLON.Color3(0, 0, 0);
  m.backFaceCulling = true; // single-sided faces so front+back don't double the alpha
  m.alpha = BODY_ALPHA_3D; // multiplies the texture's own alpha - global 3D translucency, see BODY_ALPHA_3D
  m.disableLighting = false;
  m.specularColor = new BABYLON.Color3(SHAPE_SPEC_COLOR.r, SHAPE_SPEC_COLOR.g, SHAPE_SPEC_COLOR.b);
  m.specularPower = SHAPE_SPEC_POWER;

  // Z VOLUME: textured front + back faces separated by depth
  const depth = Math.max(0.8, s * 0.12);
  const front = BABYLON.MeshBuilder.CreatePlane(`open_${index}_f`, {
    size: s * PAD, sideOrientation: BABYLON.Mesh.FRONTSIDE
  }, babylonScene);
  front.position = new BABYLON.Vector3(meshX, meshY, meshZ - depth / 2);
  front.rotation.z = meshRotZ;
  front.material = m;
  if (tiltNode) front.parent = tiltNode;
  const back = BABYLON.MeshBuilder.CreatePlane(`open_${index}_b`, {
    size: s * PAD, sideOrientation: BABYLON.Mesh.BACKSIDE
  }, babylonScene);
  back.position = new BABYLON.Vector3(meshX, meshY, meshZ + depth / 2);
  back.rotation.z = meshRotZ;
  back.material = m;
  if (tiltNode) back.parent = tiltNode;
  shapeBodyMeshes.push(front, back);

  // Side wall matching the shape silhouette, with alpha FADING along the same
  // gradient as the 2D fill (no solid boundary - the open edge stays open)
  let profile = null;
  if (shape.type === 'rect') {
    const w = s, h2 = s * 0.6;
    profile = [
      new BABYLON.Vector3(-w / 2, -h2 / 2, 0), new BABYLON.Vector3(w / 2, -h2 / 2, 0),
      new BABYLON.Vector3(w / 2, h2 / 2, 0), new BABYLON.Vector3(-w / 2, h2 / 2, 0)
    ];
  } else if (shape.type === 'triangle') {
    const hgt = s * Math.sqrt(3) / 2;
    profile = [
      new BABYLON.Vector3(-s / 2, -hgt / 3, 0), new BABYLON.Vector3(s / 2, -hgt / 3, 0),
      new BABYLON.Vector3(0, 2 * hgt / 3, 0)
    ];
  } else if (shape.type === 'semiCircle') {
    profile = arcPathLocal(s / 2, 0, Math.PI, 48); // bottom half, matches texture art
  }

  // OBJ EXPORT: the front/back planes are a full padded RECTANGLE with the
  // real silhouette only visible via texture alpha, which plain OBJ/MTL can't
  // carry - every "open" shape would export as a plain rectangle with a grey
  // fallback color. Tag the front plane with the true polygon footprint,
  // real depth (so it's an actual solid prism, not a flat 0-thickness face),
  // and a translucent flat color as a stand-in for the 2D open-edge gradient
  // (OBJ/MTL has no per-pixel alpha); skip the back plane and fade-walls.
  if (profile) {
    const exportFillRGBA = saturate3D(p5ColToRGBA(shape.c)); // match the on-screen (saturation-compensated) color in the OBJ export
    front.metadata = {
      exportColor: { r: exportFillRGBA.r, g: exportFillRGBA.g, b: exportFillRGBA.b, a: 0.5 },
      exportPolygon: profile.map(p => ({ x: p.x, y: p.y })),
      exportDepth: depth,
      // Treated as a solid BODY on export, exactly like every closed shape.
      // exportPolygon already substitutes a real closed prism here, so there
      // is nothing about an open shape that needs different handling - and
      // without this tag it was the only artwork left on the PBR-lit path
      // while everything else went unlit, so it alone still shaded by face
      // orientation and its front face went dark. It now gets the same unlit
      // material, the same density ramp and the same tessellation.
      volumeGradient: true,
      // The substituted prism is built centred on local zero, but this plane
      // is parked at meshZ - depth/2 (it's the FRONT face, not the middle),
      // so transforming by its matrix would land the fill half a depth
      // behind its own outline - the outline tubes are placed at meshZ.
      // Shift local Z by +depth/2 to put the prism back on the true centre.
      exportZOffset: depth / 2,
      // The shape's REAL 2D gradient direction (same gx/gy the fade walls
      // use just below), so collectUsdParts can build a linear gradient
      // along it instead of falling back to volumeGradient's generic radial
      // "denser at the centre" field - which has no relationship to
      // gradientAngle and is why these read as flat/uniform in AR otherwise.
      exportGradientDir: { x: gx, y: gy }
    };
  }
  // Skipped by BOTH exporters: the front plane's polygon substitution
  // already produces a real solid prism covering front, back and walls.
  back.metadata = { skipExport: true };

  if (profile) {
    profile.push(profile[0].clone()); // close the loop
    // Gradient direction in Babylon local coords. arcPathLocal's bulge sits at
    // NEGATIVE local y (down to -r at the arc's midpoint), flat diameter edge
    // at y=0 - so gy=+1 makes raw t=p.y smallest (minDot) at the bulge tip and
    // largest (maxDot, =0, the unique max since every curve point has y<0) at
    // the flat edge: solid at the bulge, fading to fully open at the flat
    // edge, exactly like the 2D gradient. (gy=-1 inverts this - solid at the
    // flat edge, fading at the bulge - which also breaks openEdgeIdx below:
    // it hunts for the edge closest to fully-open, so with the sign flipped
    // it grabs an arc segment near the bulge instead of the true flat edge,
    // leaving a gap mid-arc while still stroking straight across the real
    // open side.) gx/gy themselves are computed once, up near dx/dy, and
    // reused here and in the export metadata below.
    let minDot = Infinity, maxDot = -Infinity;
    profile.forEach(p => {
      const t = p.x * gx + p.y * gy;
      if (t < minDot) minDot = t;
      if (t > maxDot) maxDot = t;
    });
    const span = Math.max(maxDot - minDot, 1e-6);
    const fillRGBA = saturate3D(p5ColToRGBA(shape.c)); // fade walls match the texture's saturation-compensated color (alpha handled by alphaAt below)
    // Same falloff as the 2D gradient: solid at t=0, fully transparent at
    // t=0.9 - times the global 3D translucency, so the fade walls stay in
    // step with the front/back faces' own scaled texture alpha
    const alphaAt = (p) => {
      const t = ((p.x * gx + p.y * gy) - minDot) / span;
      return fillRGBA.a * 0.5 * BODY_ALPHA_3D * Math.max(0, 1 - t / 0.9);
    };
    // Subdivide edges so alpha fades smoothly ALONG each wall, reaching 100%
    // transparency at the open side. On large shapes these walls can face the
    // camera almost head-on from oblique angles, so a coarse subdivision
    // (each with one flat averaged alpha) shows as visible banded stripes -
    // subdivide finely enough that it reads as a smooth gradient instead.
    const SUB = Math.max(1, Math.ceil(120 / (profile.length - 1)));
    // Pulled slightly inside +/-depth/2 (instead of exactly matching it) so
    // this wall never shares a coplanar Z with the front/back faces - at
    // depth/2 exactly, z-fighting flickered over the outline baked into
    // the front face's texture, making it look interrupted/broken up
    const wz = depth / 2 * 0.96;
    let wallIdx = 0;
    for (let i = 0; i < profile.length - 1; i++) {
      const p1 = profile[i], p2 = profile[i + 1];
      for (let j = 0; j < SUB; j++) {
        const t1 = j / SUB, t2 = (j + 1) / SUB;
        const q1 = new BABYLON.Vector3(p1.x + (p2.x - p1.x) * t1, p1.y + (p2.y - p1.y) * t1, 0);
        const q2 = new BABYLON.Vector3(p1.x + (p2.x - p1.x) * t2, p1.y + (p2.y - p1.y) * t2, 0);
        const a = (alphaAt(q1) + alphaAt(q2)) / 2;
        if (a < 0.02) continue; // fully dissolved: the open side stays open
        const seg = BABYLON.MeshBuilder.CreateRibbon(`open_${index}_w${wallIdx}`, {
          pathArray: [
            [new BABYLON.Vector3(q1.x, q1.y, -wz), new BABYLON.Vector3(q2.x, q2.y, -wz)],
            [new BABYLON.Vector3(q1.x, q1.y, wz), new BABYLON.Vector3(q2.x, q2.y, wz)]
          ],
          sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, babylonScene);
        seg.position = new BABYLON.Vector3(meshX, meshY, meshZ);
        seg.rotation.z = meshRotZ;
        seg.material = shapeBodyMat(`open_${index}_w${wallIdx}_mat`, {
          r: fillRGBA.r, g: fillRGBA.g, b: fillRGBA.b, a: a
        });
        shapeBodyMeshes.push(seg);
        seg.metadata = { skipExport: true }; // fade decoration only; front polygon covers export
        if (tiltNode) seg.parent = tiltNode;
        wallIdx++;
      }
    }

    const edgeSwr = Math.max((shape.sw || 2) / K3D_SCALE / 2, 0.16);
    // WRAP THE OUTLINE AROUND THE DEPTH like real 3D piping, not a flat line
    // stuck to the front face: trace the non-open perimeter with tubes at
    // BOTH the front and back, plus a connecting tube at each real corner,
    // so the boundary reads correctly wrapped all the way around from any
    // viewing angle - same treatment as every other (non-open) shape.
    const n = profile.length - 1; // profile is closed-loop (last point = dup of first)
    // Pick by raw (unclamped) t, not alphaAt's clamped alpha: on a many-
    // segment curve (the semiCircle arc), several edges near the base already
    // sit past the alpha=0 cutoff, so multiple edges clamp to an identical
    // 0 - the true flat/open edge plus a couple of curve segments right next
    // to it. Comparing clamped alpha with strict `<` then keeps whichever
    // zero-alpha edge is hit FIRST in the loop, which is usually one of
    // those curve segments, not the real open edge - leaving an invisible
    // gap in the curve while stroking straight across the actual open side.
    // Raw t keeps a unique max even when the clamped alpha ties at zero.
    let openEdgeIdx = 0, maxEdgeT = -Infinity;
    for (let i = 0; i < n; i++) {
      const p1 = profile[i], p2 = profile[i + 1];
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const midT = (mx * gx + my * gy - minDot) / span;
      if (midT > maxEdgeT) { maxEdgeT = midT; openEdgeIdx = i; }
    }
    const outlinePath = [];
    for (let k = 1; k <= n; k++) outlinePath.push(profile[(openEdgeIdx + k) % n].clone());
    const frontPath = outlinePath.map(p => new BABYLON.Vector3(p.x, p.y, -wz));
    const backPath = outlinePath.map(p => new BABYLON.Vector3(p.x, p.y, wz));
    makeStrokeTube(`open_${index}_edgeFront`, frontPath, edgeSwr, K3D_BLACK, meshX, meshY, meshZ, meshRotZ, tiltNode);
    makeStrokeTube(`open_${index}_edgeBack`, backPath, edgeSwr, K3D_BLACK, meshX, meshY, meshZ, meshRotZ, tiltNode);
    // Z-AXIS EDGES: front/back loops only outline the perimeter as seen
    // face-on; without a tube connecting each corner's front point to its
    // back point, the depth walls between corners still show as bare,
    // unbordered seams when viewed from an oblique angle. Only at true
    // corners though - the semiCircle's curved edge is ~48 points, and a
    // radial tube at every one of those (crossed with the tangential
    // front/back loops) reads as a grid of little bordered cells instead of
    // a clean curved rim.
    const zEdgePts = shape.type === 'semiCircle'
      ? [outlinePath[0], outlinePath[outlinePath.length - 1]]
      : outlinePath;
    zEdgePts.forEach((p, k) => {
      makeStrokeTube(`open_${index}_edgeZ${k}`, [
        new BABYLON.Vector3(p.x, p.y, -wz),
        new BABYLON.Vector3(p.x, p.y, wz)
      ], edgeSwr, K3D_BLACK, meshX, meshY, meshZ, meshRotZ, tiltNode);
    });
  }
  return true;
}

// Tube along absolute 2D pixel coordinates (for lines/beziers/arcs/spirals).
// zTilt makes the tube TRAVEL through depth: it starts zTilt/2 behind its
// layer and ends zTilt/2 in front, instead of living on a flat plane
// anchorT: where along the path (0=first point, 1=last, 0.5=middle - the old
// default, unchanged for any caller that omits it) the Z ramp is centered -
// an anchored connector passes anchorT=0 or 1 so ITS anchor point lands
// exactly at layerZ's target depth while the other, unanchored end still
// drifts naturally via zTilt instead of the whole tube flattening to one Z.
// deltaPixel: rigid 2D translation (pixel space) applied to every point
// before projecting - how Tier-2 connectors get moved to touch a shape's
// surface without ever mutating the caller's stored point data.
// Piecewise-linear Z lookup across a sorted `{t, worldZ}` breakpoint list
// (t in [0,1] along the curve's own parametrization) - lets a single
// connector lean toward several different real depths along its length
// instead of just one linear ramp between two ends. Holds the nearest
// breakpoint's value outside the covered range rather than extrapolating
// (a curve's own untouched ends shouldn't go chasing a slope past the last
// real target).
function interpolateZTilt(breakpoints, t) {
  if (breakpoints.length === 1) return breakpoints[0].worldZ;
  if (t <= breakpoints[0].t) return breakpoints[0].worldZ;
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const a = breakpoints[i], b = breakpoints[i + 1];
    if (t >= a.t && t <= b.t) {
      const frac = (t - a.t) / ((b.t - a.t) || 1e-6);
      return a.worldZ + (b.worldZ - a.worldZ) * frac;
    }
  }
  return breakpoints[breakpoints.length - 1].worldZ;
}

// `tValues` (optional): each point's ORIGINAL curve parameter in [0,1]. A
// caller that TRIMS its point list (see create3DArcLine's frame clipping)
// must pass this - otherwise the surviving points get re-parametrized
// across 0..1, which silently rescales the zTilt ramp (anchored at anchorT)
// and misaligns the arc-string breakpoints, both of which are keyed to the
// FULL curve's parametrization and were verified against it.
function lineTubeAbsolute(name, pts2D, w2D, col, layerZ, zTilt = 0, anchorT = 0.5, deltaPixel = null, tValues = null) {
  const dx0 = deltaPixel ? deltaPixel.dx : 0;
  const dy0 = deltaPixel ? deltaPixel.dy : 0;
  const n = Math.max(pts2D.length - 1, 1);
  // zTilt is normally a scalar (single lean toward one far-end target) - but
  // a long sweeping arc's computeConnectorAnchor can instead pass an ARRAY
  // of {t, worldZ} breakpoints (see computeArcStringTargets) to bend toward
  // several real shapes' depths along its own length, stringing them
  // together rather than just leaning at one end.
  const useBreakpoints = Array.isArray(zTilt);
  const path = pts2D.map((p, idx) => {
    const t = tValues ? tValues[idx] : idx / n;
    return new BABYLON.Vector3(
      (p.x + dx0 - window.innerWidth / 2) / K3D_SCALE,
      -(p.y + dy0 - window.innerHeight / 2) / K3D_SCALE,
      useBreakpoints ? interpolateZTilt(zTilt, t) : -layerZ + (t - anchorT) * zTilt
    );
  });
  // Match 2D strokeWeight exactly: tube diameter = w / SCALE
  const radius = Math.max((w2D || 2) / K3D_SCALE / 2, 0.1);
  const tube = BABYLON.MeshBuilder.CreateTube(name, {
    path: path,
    radius: radius,
    tessellation: 16, // was 8: visibly faceted/blocky on large or close-up curves
    cap: BABYLON.Mesh.CAP_ALL
  }, babylonScene);
  const rgba = p5ColToRGBA(col);
  if (isBlackWireColor(rgba)) {
    // Blackened metal, shared per alpha - see blackWireMaterial.
    tube.material = blackWireMaterial(rgba.a);
    blackWireMeshes.push({ mesh: tube, alpha: rgba.a });
  } else {
    tube.material = unlitMat(name + '_mat', rgba);
    // Per-call material (not cached, so this can't leak onto any other
    // mesh) - always a closed tube, seen from outside only. See
    // strutSurfaceMaterial's identical fix for why: without it, a
    // translucent tube shows its own far wall through the near one.
    tube.material.backFaceCulling = true;
  }
  return tube;
}

function create3DLine(line, index, layerZ = 0, zTilt = 0, anchorT = 0.5, deltaPixel = null) {
  if (!line || !babylonScene) return false;
  // Report format: { points: [{x,y},{x,y}], color, strokeWeight } | live: x0/y0/x1/y1, col, w
  const p0 = line.points ? line.points[0] : { x: line.x0 || 0, y: line.y0 || 0 };
  const p1 = line.points ? line.points[1] : { x: line.x1 || 0, y: line.y1 || 0 };
  if (!p0 || !p1) return false;
  if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1) return false;
  // Subdivide the straight line so the Z tilt is smooth along its length
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
  }
  lineTubeAbsolute(`line_${index}`, pts, line.strokeWeight || line.w || line.sw, line.color || line.col, layerZ, zTilt, anchorT, deltaPixel);
  return true;
}

function create3DBezier(bz, index, layerZ = 0, zTilt = 0, anchorT = 0.5, deltaPixel = null) {
  if (!bz || !babylonScene) return false;
  const cps = bz.points || bz.pts;
  if (!cps || cps.length < 4) return false;
  const [p0, p1, p2, p3] = cps;
  if ([p0, p1, p2, p3].some(p => !p || p.x === undefined || p.y === undefined)) return false;
  const pts = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32, mt = 1 - t;
    pts.push({
      x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
      y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y
    });
  }
  lineTubeAbsolute(`bezier_${index}`, pts, bz.strokeWeight || bz.w, bz.color || bz.col, layerZ, zTilt, anchorT, deltaPixel);
  return true;
}

// How far past the 2D canvas edge a trimmed arc may still extend, as a
// fraction of the viewport's smaller dimension - a little slack so the cut
// doesn't land exactly on the frame line (which would read as a hard
// rectangular boundary in 3D).
const ARC_FRAME_MARGIN = 0.1;
function create3DArcLine(a, index, layerZ = 0, zTilt = 0, anchorT = 0.5, deltaPixel = null) {
  if (!a || a.cx === undefined || !babylonScene) return false;
  const steps = 128; // finer than the old 64 so the frame trim below lands precisely
  const sweep = a.sweep || Math.PI;
  const pts = [], ts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (a.start || 0) + sweep * (i / steps);
    pts.push({ x: a.cx + Math.cos(t) * a.r, y: a.cy + Math.sin(t) * a.r });
    ts.push(i / steps);
  }

  // TRIM TO THE 2D FRAME: the 2D sketch builds these with a radius of
  // dist(anchor -> canvas center) * up to 1.44, centered ON the anchor, so a
  // large part of every arc's circle falls outside the canvas and is simply
  // clipped away by the 2D frame - you never see it. 3D has no frame, so the
  // full hoop rendered: giant sweeping arcs looping high above and far out
  // past the sculpture that "are not really part of the 2D version." Keep
  // only the stretch that the 2D actually shows. Trimming (not rescaling)
  // preserves the arc's true radius and curvature exactly as drawn - the
  // rule is never to reshape a connector, only to show the real visible part.
  const dx0 = deltaPixel ? deltaPixel.dx : 0;
  const dy0 = deltaPixel ? deltaPixel.dy : 0;
  const margin = Math.min(window.innerWidth, window.innerHeight) * ARC_FRAME_MARGIN;
  const visible = pts.map(p => {
    const x = p.x + dx0, y = p.y + dy0;
    return x >= -margin && x <= window.innerWidth + margin &&
           y >= -margin && y <= window.innerHeight + margin;
  });
  // Keep the contiguous visible run containing the ANCHOR (the point
  // genuinely fastened to a shape, so it must survive the trim); if the
  // anchor itself somehow sits off-frame, fall back to the longest visible
  // run, and if nothing is visible at all keep the arc whole rather than
  // dropping an element the composition contains.
  let lo = 0, hi = steps;
  const anchorIdx = Math.max(0, Math.min(steps, Math.round((anchorT || 0) * steps)));
  if (visible[anchorIdx]) {
    lo = hi = anchorIdx;
    while (lo > 0 && visible[lo - 1]) lo--;
    while (hi < steps && visible[hi + 1]) hi++;
  } else {
    let bestLo = -1, bestLen = 0, curLo = -1;
    for (let i = 0; i <= steps; i++) {
      if (visible[i]) {
        if (curLo < 0) curLo = i;
        if (i - curLo + 1 > bestLen) { bestLen = i - curLo + 1; bestLo = curLo; }
      } else curLo = -1;
    }
    if (bestLen >= 2) { lo = bestLo; hi = bestLo + bestLen - 1; }
  }
  const keptPts = pts.slice(lo, hi + 1);
  const keptTs = ts.slice(lo, hi + 1);
  const usePts = keptPts.length >= 2 ? keptPts : pts;
  const useTs = keptPts.length >= 2 ? keptTs : ts;

  lineTubeAbsolute(`arcline_${index}`, usePts, a.strokeWeight || a.w, a.color || a.col, layerZ, zTilt, anchorT, deltaPixel, useTs);
  return true;
}

function create3DSpiral(sp, index, layerZ = 0, zTilt = 0, anchorT = 0.5, deltaPixel = null) {
  if (!sp || !babylonScene) return false;
  let pts;
  if (sp.sv && sp.sv.length >= 2) {
    // Live SpiralAnim: precomputed offsets
    pts = sp.sv.map(p => ({ x: sp.x + p.x, y: sp.y + p.y }));
  } else if (sp.maxRadius) {
    // Report format: regenerate the spiral exactly like the 2D constructor
    const steps = sp.steps || 200;
    const coils = sp.coils || 3;
    pts = [];
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2 * coils;
      const radius = (i / steps) * sp.maxRadius;
      pts.push({ x: sp.x + Math.cos(angle) * radius, y: sp.y + Math.sin(angle) * radius });
    }
  } else {
    return false;
  }
  lineTubeAbsolute(`spiral_${index}`, pts, sp.strokeWeight || sp.w, sp.color || sp.col, layerZ, zTilt, anchorT, deltaPixel);
  return true;
}

// ===== Tier 2: pass-through elements, single touch-point attachment =====
// Finds this element's nearest Tier-1 tree member and computes how to
// reposition it (rigid translation only, no reshaping) so a REAL point on
// its own rendered geometry touches that member's surface. No overlap
// checking against anything - Tier 2 stays pass-through by design (arcs/
// lines/beziers/spirals/halo/concentricArc/squiggle may freely thread
// through/between shapes, per the user's original rule).
//
// Several of these types' own reference field is NOT a point on their
// rendered curve (verified against each type's actual point-generation
// math): a fixed-radius arc's center is always `r` units away from every
// rendered point, never on it; a squiggle's local origin sits off the
// curve too (its peak is offset, not centered). For those, the anchor is
// found by sampling the type's own point formula and picking whichever
// sample is most aligned (dot product) with the direction toward the
// target - reusing the exact formula each create3DX function already uses,
// so the anchor is guaranteed to be a real rendered point.
//
// The point on `target`'s surface facing `originWorld` - full 3D (x, y, AND
// z). Front/behind is decided as a real, binary fact - "if a skeletal
// element is in front of a body shape, it connects to the front face; if
// behind, the back face" - by comparing draw order directly against THIS
// target (salt > target.globalIndex means drawn later, i.e. in front, per
// synthesizedZBias's own front/back sign convention), the exact same
// pairwise comparison violatesOcclusionOrder already uses for shape-vs-shape
// pairs. Used to blend a soft synthesizedZBias magnitude into the direction
// vector instead of a clean sign - close enough for a rough lean, but for a
// shape whose in-plane offset from the target was large relative to that
// bias, the blended direction could end up shallow enough to land on a side
// edge instead of cleanly on the front or back cap. Z_DOMINANCE keeps the
// direction steep enough to hit the flat cap every time, while the in-plane
// component still picks WHERE on that face, biased toward the element's
// real approach angle.
const TOUCH_Z_DOMINANCE = 3;
function touchPointFacing(target, originWorld, salt) {
  // A LATTICE target always gets the BACK face, whatever the draw order
  // says. In the 2D sketch every lattice is composited into a foreground
  // layer drawn on top of everything, every frame - the same unconditional
  // fact violatesOcclusionOrder already enforces between Tier-1 shapes.
  // That check only runs inside buildElementTree though, so Tier-2 elements
  // (halo/squiggle/arc ornaments and every connector) never saw it: a halo
  // drawn later than a lattice would weld onto the lattice's FRONT face and
  // render on top of it, which the 2D can never show.
  const isFront = target.shapeType === 'lattice' ? false : salt > target.globalIndex;
  const dx = originWorld.x - target.x, dy = originWorld.y - target.y;
  const inPlaneLen = Math.hypot(dx, dy) || 1;
  const raw = {
    x: dx / inPlaneLen, y: dy / inPlaneLen,
    z: (isFront ? -1 : 1) * TOUCH_Z_DOMINANCE // smaller/more-negative world Z = front, per this app's established convention
  };
  const len = Math.hypot(raw.x, raw.y, raw.z);
  const dir = { x: raw.x / len, y: raw.y / len, z: raw.z / len };
  // target's REAL boundary in this direction, not its full scalar radius -
  // shapes no longer tilt at all (they keep their plain 2D rotation), but a
  // rect/triangle's true edge in an arbitrary direction still isn't its
  // full corner-to-corner radius, so this still has to be measured for real.
  const touchDist = supportDistanceWorld(target, target.contactDir, dir) + SOLID_CONTACT_PAD;
  // Must match tier1WorldCenter's sign exactly (node.z - node.zOffset) - this
  // used to be `+ target.zOffset`, invisible for every shape type except
  // concentricCircle/concentricArc (the only ones with a nonzero zOffset),
  // where it put the touch point roughly 2x zOffset away from the shape's
  // true center - enough to visibly disrupt front/back order for anything
  // anchored there (a halo, say) even from the exact matched viewpoint.
  const targetCenterZ = target.z - target.zOffset;
  return {
    x: target.x + dir.x * touchDist,
    y: target.y + dir.y * touchDist,
    z: targetCenterZ + dir.z * touchDist
  };
}

// The raw Z difference toward a genuine second target is otherwise
// unbounded, and now that Tier-1 shapes can end up meaningfully spread
// through depth (SPREAD_FACTOR, violatesOcclusionOrder), that difference
// can occasionally be large enough to visibly kink a connector's whole
// depth-bend far more than its own size would suggest - a sharp, "rearranged
// weird" looking V instead of a gentle lean. Clamps it to a fixed maximum
// so the lean stays a lean.
const MAX_REACH_ZTILT = 18;
function secondaryZTilt(secondary, originPoint, saltIndex, touchWorld) {
  if (!secondary) return null;
  // Only lean toward a secondary target that's genuinely CLOSE to this end -
  // findSecondaryTarget always returns whatever Tier-1 shape is NEAREST,
  // with no distance cutoff, so a connector's unanchored far end used to
  // lean toward that shape's Z however far away it actually was. That's
  // exactly what could drag one connector's loose end into coincidental
  // contact with a completely unrelated connector's own loose end -
  // "skeletal shapes should not attach to each other in a chain... that's
  // not how it is in 2D." A far-away "nearest" shape isn't a real
  // relationship worth leaning toward at all - stay flat (no lean) instead.
  const dist2D = Math.hypot(originPoint.x - secondary.origX, originPoint.y - secondary.origY);
  if (dist2D > secondary.r * 3) return null;
  const raw = touchPointFacing(secondary, originPoint, saltIndex).z - touchWorld.z;
  return Math.max(-MAX_REACH_ZTILT, Math.min(MAX_REACH_ZTILT, raw));
}

// Nearest Tier-1 member OTHER than `exclude` (and other than anything
// already `claimed` by an earlier connector's own free-end lean this pass -
// see claimedSecondaryTargets) - lets a connector's far end reach toward a
// genuinely different shape (full x/y/z), the same nearest-by-original-2D-
// distance preference used everywhere else.
function findSecondaryTarget(originWorld, exclude, tier1Placed, claimed) {
  let target = null, bestDist = Infinity;
  tier1Placed.forEach(t => {
    if (t === exclude) return;
    if (claimed && claimed.has(t)) return;
    const d = Math.hypot(originWorld.x - t.origX, originWorld.y - t.origY);
    if (d < bestDist) { bestDist = d; target = t; }
  });
  return target;
}

// A sweep at or beyond this counts as "long" for the arc-string treatment
// below - a short arc barely spans one shape's own width, nowhere near
// enough curve to genuinely thread through a sequence of others.
const LONG_ARC_SWEEP = Math.PI * 0.9;

// Samples several points along a long arc's own curve (besides its primary
// anchor) and, for each, finds a REAL Tier-1 shape (the base included -
// "possibly an anchor point to the base") that's genuinely close to the
// curve at that specific point - not just globally nearest, which would
// just re-pick the same shape or something irrelevant. Each shape can only
// be claimed once, so a string of DIFFERENT shapes results, not one shape
// hit repeatedly.
function computeArcStringTargets(raw, anchorT, primaryTarget, tier1Placed) {
  const sweep = raw.sweep || Math.PI;
  const SAMPLE_COUNT = 6;
  const claimed = new Set([primaryTarget]);
  const points = [];
  for (let i = 1; i <= SAMPLE_COUNT; i++) {
    const t = i / (SAMPLE_COUNT + 1);
    if (Math.abs(t - anchorT) < 0.06) continue; // too close to the primary anchor to be a distinct point
    const angle = (raw.start || 0) + sweep * t;
    const sampleWorld = pixelToWorld(raw.cx + Math.cos(angle) * raw.r, raw.cy + Math.sin(angle) * raw.r);
    let best = null, bestDist = Infinity;
    tier1Placed.forEach(cand => {
      if (claimed.has(cand)) return;
      const d = Math.hypot(sampleWorld.x - cand.origX, sampleWorld.y - cand.origY);
      if (d < cand.r * 1.4 && d < bestDist) { bestDist = d; best = cand; }
    });
    if (best) { claimed.add(best); points.push({ t, node: best }); }
  }
  return points;
}

// `kind`: 'line'|'bezier'|'arcline'|'spiral' (connectors, PIXEL-space,
// rendered via lineTubeAbsolute) or 'squiggle'|'halo'|'concentricArc'|
// 'arcShape' (ornaments, WORLD-space, rendered via create3DShape/
// createConcentricArc3D). `raw`: the connector's report object for the
// first group, or the shape object itself for the second. Returns one of:
// - {mode:'delta', deltaPixel:{dx,dy}, targetWorldZ, anchorT, zTilt} - add
//   deltaPixel to every 2D field the type stores, pass anchorT/targetWorldZ
//   (as -layerZ) through to the matching create3DX; zTilt is a real second-
//   target Z traversal when available (null falls back to a small
//   deterministic wiggle, see convertShapesTo3D). Every connector type
//   (line/bezier/arcline/spiral) uses this mode exclusively now - a
//   connector is NEVER truncated or resized to fit between two points, it
//   always keeps its full original length/shape and just slides (in x/y,
//   plus a Z position) so one real point along its own curve touches the
//   target's surface. anchorT can land anywhere in [0,1], not just at an
//   end - see the line/bezier/arcline cases below, which search the whole
//   curve for the nearest point, not just its two ends.
// - {mode:'resolved', resolvedXY, targetWorldZ} - pass resolvedXY straight
//   into create3DShape/createConcentricArc3D and -targetWorldZ as layerZ.
// Returns null if there's no Tier-1 member to attach to (e.g. every
// skeleton/solid ornament failed to convert - degenerate edge case).

// A connector keeps its full original shape/length (never truncated - see
// the delta-mode cases below), but that means the shift needed to anchor
// it onto a target could still push part of its UNCHANGED curve below the
// base - "the base... must be the lowest shape" applies to the whole
// structure, not just Tier-1 volumes. Nudges deltaPixel.dy upward (screen-
// up = world-Y-up) just enough that every one of `samplePixelPoints`
// clears the base's top face, if any would otherwise dip below it -
// returns deltaPixel completely untouched when nothing needs it.
function raiseDeltaAboveFloor(deltaPixel, samplePixelPoints, tier1Placed) {
  const base = tier1Placed.find(n => n.isBase);
  if (!base) return deltaPixel;
  // +1 world unit of clear air: the sample points are the tube's CENTERLINE
  // - the rendered tube has a real radius below that, so a centerline raised
  // to exactly the base's top still leaves the tube's lower half embedded
  // in the slab.
  const floorY = base.y + base.zHalf + 1;
  let worstBelow = 0;
  samplePixelPoints.forEach(p => {
    const wy = -((p.y + deltaPixel.dy) - window.innerHeight / 2) / K3D_SCALE;
    const below = floorY - wy;
    if (below > worstBelow) worstBelow = below;
  });
  if (worstBelow <= 0) return deltaPixel;
  // worstBelow (world units) rides along on the result - the anchor point
  // this delta was built to land exactly on a target's surface gets pushed
  // up by the SAME uniform shift as every other sample point, since dy
  // moves once for the whole curve. A shape whose only connector needed a
  // big raise (a spiral/arc with far coils dipping well below the floor)
  // can end up with its "connected" wire no longer actually touching it at
  // all - see FLOOR_RAISE_BREAKS_TOUCH below, which uses this to decide
  // whether that credit is still earned.
  return { dx: deltaPixel.dx, dy: deltaPixel.dy - worstBelow * K3D_SCALE, raisedBy: worstBelow };
}
// How far raiseDeltaAboveFloor is allowed to push a connector's anchor off
// a target's actual surface before its "real touch" credit (skeletonConnectedNodes)
// is revoked - a small raise (the function's own deliberate +1 unit of
// clear air, or a couple more) still reads as touching; several world
// units reads as a visible gap ("this shape has no support"), so the
// shape falls back to the base-strut passes' own safety net instead of
// silently counting on a connector that no longer reaches it.
const FLOOR_RAISE_BREAKS_TOUCH = 4;
function computeConnectorAnchor(kind, raw, globalIndex, tier1Placed, forcedTarget = null, claimedSecondary = null) {
  if (!tier1Placed || tier1Placed.length === 0) return null;

  let originWorld;
  switch (kind) {
    case 'line': {
      const p0 = raw.points ? raw.points[0] : { x: raw.x0 || 0, y: raw.y0 || 0 };
      const p1 = raw.points ? raw.points[1] : { x: raw.x1 || 0, y: raw.y1 || 0 };
      originWorld = pixelToWorld((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
      break;
    }
    case 'bezier': {
      const cps = raw.points || raw.pts;
      originWorld = pixelToWorld((cps[0].x + cps[3].x) / 2, (cps[0].y + cps[3].y) / 2);
      break;
    }
    case 'arcline':
      originWorld = pixelToWorld(raw.cx, raw.cy);
      break;
    case 'spiral':
      originWorld = pixelToWorld(raw.x, raw.y);
      break;
    case 'squiggle': case 'halo': case 'concentricArc': case 'arcShape':
      originWorld = projectXY3D(raw); // raw IS the shape object for these
      break;
    default:
      return null;
  }

  // Nearest Tier-1 member by ORIGINAL 2D distance - matches how Tier-1 nodes
  // pick their own neighbors, preserving a loose "who was near whom" from
  // the 2D collage even though absolute positions have since compacted.
  // `forcedTarget` overrides this search entirely - used to guarantee a
  // specific Tier-1 node (currently: a lattice with no natural nearest
  // connector) gets a real connector reaching it instead of being left
  // with only its Tier-1 kissing contact.
  let target = forcedTarget, bestDist = Infinity;
  if (!target) {
    tier1Placed.forEach(t => {
      const d = Math.hypot(originWorld.x - t.origX, originWorld.y - t.origY);
      if (d < bestDist) { bestDist = d; target = t; }
    });
  }
  if (!target) return null;

  const touchWorld = touchPointFacing(target, originWorld, globalIndex);

  // Backstop for the same 2D rule: even when a Tier-2 element anchors to
  // some OTHER shape, its resolved depth must never end up in front of a
  // lattice. Pushes only when it would otherwise render on top of one
  // (Math.max), so anything already behind is untouched.
  let latticeBackZ = -Infinity;
  tier1Placed.forEach(n => {
    if (n.shapeType !== 'lattice') return;
    latticeBackZ = Math.max(latticeBackZ, tier1WorldCenter(n).z + n.zHalf);
  });
  const behindLattices = wz => (latticeBackZ > -Infinity ? Math.max(wz, latticeBackZ + SOLID_CONTACT_PAD) : wz);
  // Push the touch point outward by the wire's own tube RADIUS: the anchor
  // point is the tube's CENTERLINE, and SOLID_CONTACT_PAD (0.15) alone is
  // thinner than many wires' radius, so a wire "touching" a face had its
  // tube surface physically sunk inside the shape ("this spiral is clearly
  // injecting itself into this semi circle"). Centerline one radius off the
  // surface = tube surface exactly kissing it.
  {
    const wireR = Math.max((raw.strokeWeight || raw.w || raw.sw || 2) / K3D_SCALE / 2, 0.1);
    const tcz = target.z - target.zOffset;
    const tdx = touchWorld.x - target.x, tdy = touchWorld.y - target.y, tdz = touchWorld.z - tcz;
    const tlen = Math.hypot(tdx, tdy, tdz) || 1;
    touchWorld.x += (tdx / tlen) * wireR;
    touchWorld.y += (tdy / tlen) * wireR;
    touchWorld.z += (tdz / tlen) * wireR;
  }

  // A connector's free end only ever gets a Z-lean toward a nearby Tier-1
  // shape, never a real touch - if a second, unrelated connector's free end
  // also leans toward that SAME shape while sharing a similar 2D origin
  // (a common "hub" both were drawn from), the two free ends can end up
  // sitting on top of each other, wires visibly touching EACH OTHER rather
  // than a real shape. Skip anything already claimed by an earlier
  // connector this pass (findSecondaryTarget), and claim whichever target
  // actually gets used here so the next connector reaching for the same
  // shape picks a different one instead (or no lean at all).
  const leanToSecondary = (leanOrigin, saltIndex) => {
    const secondary = findSecondaryTarget(leanOrigin, target, tier1Placed, claimedSecondary);
    const tilt = secondaryZTilt(secondary, leanOrigin, saltIndex, touchWorld);
    if (tilt != null && secondary && claimedSecondary) claimedSecondary.add(secondary);
    // NEVER return null: a null propagates out to realizeConnector, which
    // then substitutes its own unchecked fallback tilt - discarding whatever
    // clearWireZTilt just verified. Resolve the same fallback HERE instead,
    // so the clearance check operates on the value that actually renders.
    return tilt != null ? tilt : synthesizedZBias(globalIndex) * CONNECTOR_FREE_END_TILT;
  };

  switch (kind) {
    case 'line': case 'bezier': {
      // Never truncate or resize a line/bezier to fit between two points -
      // it keeps its full original length and shape exactly as drawn.
      // Instead, find whichever point ALONG ITS OWN CURVE (not just an
      // endpoint - the true nearest point on the segment/curve, which can
      // land anywhere in the middle) is closest to the target, and slide
      // the whole, unmodified curve so that one point touches the
      // target's surface. anchorT (0..1, where along the curve this
      // landed) feeds lineTubeAbsolute's Z-ramp, which is already built to
      // pivot around any point, not just an end.
      const targetPixel = worldToPixel(target.x, target.y);
      let anchorPixel, anchorT;
      const cps = raw.points || raw.pts;
      if (kind === 'line') {
        const p0 = raw.points ? raw.points[0] : { x: raw.x0 || 0, y: raw.y0 || 0 };
        const p1 = raw.points ? raw.points[1] : { x: raw.x1 || 0, y: raw.y1 || 0 };
        const ex = p1.x - p0.x, ey = p1.y - p0.y;
        const lenSq = ex * ex + ey * ey || 1;
        anchorT = Math.max(0, Math.min(1, ((targetPixel.x - p0.x) * ex + (targetPixel.y - p0.y) * ey) / lenSq));
        anchorPixel = { x: p0.x + ex * anchorT, y: p0.y + ey * anchorT };
      } else {
        const steps = 32;
        let bestDist = Infinity;
        anchorT = 0; anchorPixel = { x: cps[0].x, y: cps[0].y };
        for (let i = 0; i <= steps; i++) {
          const t = i / steps, mt = 1 - t;
          const px = mt * mt * mt * cps[0].x + 3 * mt * mt * t * cps[1].x + 3 * mt * t * t * cps[2].x + t * t * t * cps[3].x;
          const py = mt * mt * mt * cps[0].y + 3 * mt * mt * t * cps[1].y + 3 * mt * t * t * cps[2].y + t * t * t * cps[3].y;
          const d = Math.hypot(px - targetPixel.x, py - targetPixel.y);
          if (d < bestDist) { bestDist = d; anchorT = t; anchorPixel = { x: px, y: py }; }
        }
      }

      // The FAR end (whichever original endpoint the anchor point ISN'T
      // close to) still reaches toward a second target's Z when one
      // exists - real depth traversal, not an arbitrary wiggle - but this
      // only tilts the curve through depth, never touches its x/y shape
      // or length.
      const cps2 = kind === 'line'
        ? [raw.points ? raw.points[0] : { x: raw.x0 || 0, y: raw.y0 || 0 },
           raw.points ? raw.points[1] : { x: raw.x1 || 0, y: raw.y1 || 0 }]
        : [(raw.points || raw.pts)[0], (raw.points || raw.pts)[3]];
      const farEndPixel = anchorT < 0.5 ? cps2[1] : cps2[0];
      const farEndWorld = pixelToWorld(farEndPixel.x, farEndPixel.y);

      const touchPixel = worldToPixel(touchWorld.x, touchWorld.y);
      const rawPts = kind === 'line' ? cps2 : (raw.points || raw.pts); // bezier: all 4 control points bound the curve's convex hull, a safe conservative check
      const deltaPixel = raiseDeltaAboveFloor(
        { dx: touchPixel.x - anchorPixel.x, dy: touchPixel.y - anchorPixel.y }, rawPts, tier1Placed
      );
      let zTilt = leanToSecondary(farEndWorld, globalIndex + 1);
      // Both lines AND beziers are solid rigid wires - "solid objects can't
      // pass through each other" - so both get the shared depth-clearance
      // search (clearWireZTilt). This used to be a bezier-only block, which
      // left plain lines (the thickest strokes in the piece) spearing
      // straight through shapes' volumes.
      const wireSamplePts = [];
      for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        if (kind === 'line') {
          wireSamplePts.push({ x: cps2[0].x + (cps2[1].x - cps2[0].x) * t, y: cps2[0].y + (cps2[1].y - cps2[0].y) * t });
        } else {
          const mt = 1 - t;
          wireSamplePts.push({
            x: mt * mt * mt * cps[0].x + 3 * mt * mt * t * cps[1].x + 3 * mt * t * t * cps[2].x + t * t * t * cps[3].x,
            y: mt * mt * mt * cps[0].y + 3 * mt * mt * t * cps[1].y + 3 * mt * t * t * cps[2].y + t * t * t * cps[3].y
          });
        }
      }
      zTilt = clearWireZTilt(wireSamplePts, deltaPixel, touchWorld.z, anchorT, zTilt, tier1Placed, target);
      // Same uniform dy shift as the target-credit check above, expressed
      // as a world point - the anchor's TRUE final position (see
      // raiseDeltaAboveFloor: only dy moves, so x/z stay exactly touchWorld's).
      const lineTouchBroken = (deltaPixel.raisedBy || 0) > FLOOR_RAISE_BREAKS_TOUCH;
      return {
        mode: 'delta',
        deltaPixel,
        targetWorldZ: touchWorld.z,
        anchorT,
        zTilt,
        primaryAnchorWorld: touchWorld,
        targetNode: lineTouchBroken ? null : target,
        strandedAnchorWorld: lineTouchBroken ? { x: touchWorld.x, y: touchWorld.y + deltaPixel.raisedBy, z: touchWorld.z } : null
      };
    }
    case 'spiral': {
      const touchPixel = worldToPixel(touchWorld.x, touchWorld.y);
      // Sample the spiral's own rendered points (same formulas create3DSpiral
      // uses, live sv or regenerated) - used for the anchor search and the
      // floor/clearance checks below.
      let spiralPts;
      if (raw.sv && raw.sv.length >= 2) {
        spiralPts = raw.sv.map(p => ({ x: raw.x + p.x, y: raw.y + p.y }));
      } else {
        const steps = raw.steps || 200, coils = raw.coils || 3;
        spiralPts = [];
        for (let i = 0; i <= steps; i++) {
          const angle = (i / steps) * Math.PI * 2 * coils;
          const radius = (i / steps) * (raw.maxRadius || 0);
          spiralPts.push({ x: raw.x + Math.cos(angle) * radius, y: raw.y + Math.sin(angle) * radius });
        }
      }
      // Anchor at whichever point ALONG ITS OWN CURVE is nearest the target -
      // the same treatment line/bezier/arcline get. The old center-point
      // anchor ("radius 0 at i=0 is on-curve") was convenient but wrong for
      // placement: the anchor slide moves the anchor point onto the target's
      // SURFACE, so anchoring by the center teleported the whole spiral from
      // wherever the 2D actually drew it. Nearest-point anchoring keeps the
      // slide minimal - the spiral stays essentially at its 2D spot.
      const targetPixel = worldToPixel(target.x, target.y);
      let anchorIdx = 0, bestAnchorDist = Infinity;
      spiralPts.forEach((p, i) => {
        const d = Math.hypot(p.x - targetPixel.x, p.y - targetPixel.y);
        if (d < bestAnchorDist) { bestAnchorDist = d; anchorIdx = i; }
      });
      const anchorPixel = spiralPts[anchorIdx];
      const anchorT = anchorIdx / (spiralPts.length - 1 || 1);
      // "The base must be the lowest shape" applies to every connector -
      // line/bezier/arcline already route through raiseDeltaAboveFloor; the
      // spiral was the one connector type that skipped it, so its coils
      // could dip below the base's top when anchored low on a target.
      const deltaPixel = raiseDeltaAboveFloor(
        { dx: touchPixel.x - anchorPixel.x, dy: touchPixel.y - anchorPixel.y }, spiralPts, tier1Placed
      );
      // The far end (center or outer tip, whichever the anchor ISN'T near)
      // still reaches toward a second target's Z when one exists.
      const farEndPixel = anchorT < 0.5 ? spiralPts[spiralPts.length - 1] : spiralPts[0];
      const farEndWorld = pixelToWorld(farEndPixel.x, farEndPixel.y);
      // A spiral wire is solid too - same depth-clearance as line/bezier/arc.
      let zTilt = leanToSecondary(farEndWorld, globalIndex + 1);
      zTilt = clearWireZTilt(spiralPts, deltaPixel, touchWorld.z, anchorT, zTilt, tier1Placed, target);
      const spiralTouchBroken = (deltaPixel.raisedBy || 0) > FLOOR_RAISE_BREAKS_TOUCH;
      return {
        mode: 'delta',
        deltaPixel,
        targetWorldZ: touchWorld.z,
        anchorT,
        zTilt,
        primaryAnchorWorld: touchWorld,
        targetNode: spiralTouchBroken ? null : target,
        strandedAnchorWorld: spiralTouchBroken ? { x: touchWorld.x, y: touchWorld.y + deltaPixel.raisedBy, z: touchWorld.z } : null
      };
    }
    case 'arcline': {
      // Never truncate or resize an arc to fit between two points - it
      // keeps its full original sweep and radius exactly as drawn.
      // Find whichever point ALONG ITS OWN CURVE is nearest the target
      // (sampled the same way create3DArcLine builds it - the center is
      // never on the curve, so it can't be used directly) and slide the
      // whole, unmodified arc so that point touches the target's surface.
      const steps = 64;
      const sweep = raw.sweep || Math.PI;
      const targetPixel = worldToPixel(target.x, target.y);
      let bestIdx = 0, bestDist = Infinity;
      for (let i = 0; i <= steps; i++) {
        const t = (raw.start || 0) + sweep * (i / steps);
        const ox = raw.cx + Math.cos(t) * raw.r, oy = raw.cy + Math.sin(t) * raw.r;
        const d = Math.hypot(ox - targetPixel.x, oy - targetPixel.y);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      const tBest = (raw.start || 0) + sweep * (bestIdx / steps);
      const anchorPixel = { x: raw.cx + Math.cos(tBest) * raw.r, y: raw.cy + Math.sin(tBest) * raw.r };
      const anchorT = bestIdx / steps;

      // The FAR end of the arc (whichever curve endpoint the anchor point
      // ISN'T close to) still reaches toward a second target's Z when one
      // exists - real depth traversal, never touching the arc's own x/y
      // shape or sweep.
      const startPixel = { x: raw.cx + Math.cos(raw.start || 0) * raw.r, y: raw.cy + Math.sin(raw.start || 0) * raw.r };
      const endPixel = { x: raw.cx + Math.cos((raw.start || 0) + sweep) * raw.r, y: raw.cy + Math.sin((raw.start || 0) + sweep) * raw.r };
      const farEndPixel = anchorT < 0.5 ? endPixel : startPixel;
      const farEndWorld = pixelToWorld(farEndPixel.x, farEndPixel.y);

      const touchPixel = worldToPixel(touchWorld.x, touchWorld.y);
      // 33 samples, not the old 9: on a big arc (r runs to hundreds of px)
      // the true low point sags below the nearest of 9 samples by the chord
      // error - several world units - so the floor-raise stopped short and
      // the arc's belly passed through the base slab.
      const arcSamplePts = [];
      for (let i = 0; i <= 32; i++) {
        const t = (raw.start || 0) + sweep * (i / 32);
        arcSamplePts.push({ x: raw.cx + Math.cos(t) * raw.r, y: raw.cy + Math.sin(t) * raw.r });
      }
      const deltaPixel = raiseDeltaAboveFloor(
        { dx: touchPixel.x - anchorPixel.x, dy: touchPixel.y - anchorPixel.y }, arcSamplePts, tier1Placed
      );

      // A long, sweeping arc reads as connective tissue for the whole
      // sculpture, not just a single touch point - "use the long sweeping
      // arcs to connect a string of shapes together, adding stability and
      // possibly an anchor to the base." Sample several points along its
      // own curve (besides the primary anchor) and bend toward whichever
      // real Tier-1 shape (base included) sits genuinely close to the curve
      // at each one, stringing the arc through a whole sequence of shapes
      // instead of leaning at just one far end.
      // Try the string treatment for any long arc regardless of whether a
      // "secondary" (nearest-to-far-end) target was also found - secondary
      // almost always finds SOMETHING once there's more than one Tier-1
      // shape in the scene, so gating on its absence would make this rarely
      // fire at all. Only falls back to the plain single-lean behavior below
      // when the string search comes back genuinely empty (nothing close
      // enough to the curve at any sample point).
      const stringTargets = Math.abs(sweep) >= LONG_ARC_SWEEP
        ? computeArcStringTargets(raw, anchorT, target, tier1Placed)
        : [];
      let zTilt, stringAnchors, stringTargetNodes;
      if (stringTargets.length > 0) {
        // Clamp each breakpoint's pull the same way secondaryZTilt already
        // clamps a plain far-end lean (MAX_REACH_ZTILT) - without this, one
        // string target sitting at an extreme Z (nothing stops a shape
        // elsewhere in the piece from having been pushed far out) could yank
        // the WHOLE curve out to reach it, a real "fly-away arc" instead of
        // a gentle bend through a sequence of shapes.
        const breakpoints = [{ t: anchorT, worldZ: touchWorld.z }, ...stringTargets.map(s => {
          const rawDiff = tier1WorldCenter(s.node).z - touchWorld.z;
          const clamped = Math.max(-MAX_REACH_ZTILT, Math.min(MAX_REACH_ZTILT, rawDiff));
          return { t: s.t, worldZ: touchWorld.z + clamped };
        })].sort((a, b) => a.t - b.t);
        zTilt = breakpoints;
        stringAnchors = stringTargets.map(s => {
          const angle = (raw.start || 0) + sweep * s.t;
          const p = pixelToWorld(raw.cx + Math.cos(angle) * raw.r, raw.cy + Math.sin(angle) * raw.r);
          return { x: p.x + deltaPixel.dx / K3D_SCALE, y: p.y - deltaPixel.dy / K3D_SCALE, z: interpolateZTilt(breakpoints, s.t) };
        });
        stringTargetNodes = stringTargets.map(s => s.node);
        // These shapes are now genuinely, visibly threaded by this arc's own
        // curve - claim them so a separate, unrelated connector doesn't also
        // lean its own free end toward the same one and create the same
        // "wires touching each other" pile-up the claim set exists to avoid.
        if (claimedSecondary) stringTargetNodes.forEach(n => claimedSecondary.add(n));
      } else {
        zTilt = leanToSecondary(farEndWorld, globalIndex + 1);
        // An arc wire is solid too - same depth-clearance as line/bezier.
        // (String mode above is different: it deliberately bends to TOUCH a
        // sequence of shapes at their real surfaces, which is fastening, not
        // passing through.)
        const arcWirePts = [];
        for (let i = 0; i <= 32; i++) {
          const t = (raw.start || 0) + sweep * (i / 32);
          arcWirePts.push({ x: raw.cx + Math.cos(t) * raw.r, y: raw.cy + Math.sin(t) * raw.r });
        }
        zTilt = clearWireZTilt(arcWirePts, deltaPixel, touchWorld.z, anchorT, zTilt, tier1Placed, target);
      }
      // The same uniform dy shift applies to every point on the curve,
      // string-target breakpoints included - if it broke the primary
      // anchor's touch it broke theirs too.
      const arcTouchBroken = (deltaPixel.raisedBy || 0) > FLOOR_RAISE_BREAKS_TOUCH;
      return {
        mode: 'delta',
        deltaPixel,
        targetWorldZ: touchWorld.z,
        anchorT,
        zTilt,
        stringTargetNodes: arcTouchBroken ? undefined : stringTargetNodes,
        primaryAnchorWorld: touchWorld,
        stringAnchors,
        targetNode: arcTouchBroken ? null : target,
        strandedAnchorWorld: arcTouchBroken ? { x: touchWorld.x, y: touchWorld.y + deltaPixel.raisedBy, z: touchWorld.z } : null
      };
    }
    case 'squiggle': {
      const sv = raw.sv;
      if (!sv || sv.length < 2) return null;
      const ends = [
        { x: raw.x + sv[0].x, y: raw.y + sv[0].y },
        { x: raw.x + sv[sv.length - 1].x, y: raw.y + sv[sv.length - 1].y }
      ];
      const targetPixel = worldToPixel(target.x, target.y);
      const d0 = Math.hypot(ends[0].x - targetPixel.x, ends[0].y - targetPixel.y);
      const d1 = Math.hypot(ends[1].x - targetPixel.x, ends[1].y - targetPixel.y);
      const anchorPixel = d1 < d0 ? ends[1] : ends[0];
      const anchorWorld = pixelToWorld(anchorPixel.x, anchorPixel.y);
      return {
        mode: 'resolved',
        resolvedXY: { x: originWorld.x + (touchWorld.x - anchorWorld.x), y: originWorld.y + (touchWorld.y - anchorWorld.y) },
        targetWorldZ: behindLattices(touchWorld.z),
        primaryAnchorWorld: touchWorld,
        targetNode: target
      };
    }
    case 'halo': {
      // Unlike squiggle/concentricArc/arcShape (anchored at an actual END
      // point on their own curve, so the REST of the shape naturally
      // extends away from the target), a halo has no "end" - it's a
      // radially symmetric glow, so its own CENTER is the only anchor it
      // has. Placing that center directly on the target's surface (the
      // touch point) buried roughly half the halo's radius inside the
      // target's volume - visually indistinguishable from a real overlap
      // even though nothing here is subject to the Tier-1 collision rule.
      // Push the halo's center further out, along the same direction its
      // touch point already faces, so its real SHELL's boundary lands on
      // the target's surface instead of its bare center. The shell
      // (createHalo3D's clear-acrylic container, sized to span/contain the
      // WHOLE ring stack - see haloRingSpan) is a real oriented profile -
      // wide in-plane (haloR) but thin straight through, NOT a uniform
      // sphere - pushing by a flat haloR in every direction used to
      // overshoot badly for any touch that's mostly in-depth (a barely-
      // thick shell doesn't need to travel a full radius to clear a target
      // sitting mostly behind/in front of it).
      const haloR = (raw.targetSize || 50) / K3D_SCALE / 2;
      const rings = raw.rings || 3;
      const shellMargin = Math.max(0.4, haloR * 0.06); // must match createHalo3D's own shell margin
      const shellHalf = (haloRingSpan(rings) + shellMargin * 2) / 2; // must match createHalo3D's own shell depth
      const targetCenterZ = target.z - target.zOffset; // must match tier1WorldCenter's sign - see touchPointFacing's own fix for why
      const dx = touchWorld.x - target.x, dy = touchWorld.y - target.y, dz = touchWorld.z - targetCenterZ;
      const len = Math.hypot(dx, dy, dz) || 1;
      const dir = { x: dx / len, y: dy / len, z: dz / len };
      const pushDist = profileSupportDistance({ kind: 'isotropic', R: haloR }, dir, shellHalf);
      let haloY = touchWorld.y + dir.y * pushDist;
      // Unlike every Tier-1 shape (violatesFloor, enforced during
      // placement), a halo's position is worked out here directly with no
      // floor check at all - if it happens to anchor near the bottom of its
      // target, pushing its center outward (the step above) can send it
      // further down than the target ever reached, dipping its rendered
      // disc below the base even though the target itself never violated
      // the floor ("the base must be the lowest shape" - this is exactly
      // the gap that let one through).
      const base = tier1Placed.find(n => n.isBase);
      if (base) {
        const floorY = base.y + base.zHalf;
        if (haloY - haloR < floorY) haloY = floorY + haloR;
      }
      return {
        mode: 'resolved',
        resolvedXY: { x: touchWorld.x + dir.x * pushDist, y: haloY },
        targetWorldZ: behindLattices(touchWorld.z + dir.z * pushDist),
        primaryAnchorWorld: touchWorld,
        targetNode: target
      };
    }
    case 'concentricArc': case 'arcShape': {
      // Sample the ring's own rendered points (same local formula
      // arcPathLocal/createConcentricArc3D use, rotated by rotZ) and pick
      // whichever is most aligned with the target direction - same
      // reasoning as 'arcline': the shape's origin is never on the ring.
      const rotZ = -(raw.rot || 0);
      const s = (raw.targetSize || 50) / K3D_SCALE;
      const r = kind === 'arcShape' ? s / 2 : (raw.rings || 4) * ((raw.diff || 10) / K3D_SCALE);
      const a0 = raw.arcStart || 0;
      const a1 = a0 + (raw.arcSweep || Math.PI);
      const cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);
      const towardX = target.x - originWorld.x, towardY = target.y - originWorld.y;
      const steps = 48;
      let bestOffset = { x: 0, y: 0 }, bestDot = -Infinity;
      for (let i = 0; i <= steps; i++) {
        const t = a0 + (a1 - a0) * (i / steps);
        const lx = r * Math.cos(t), ly = -r * Math.sin(t); // arcPathLocal's y-flipped convention
        const wx = lx * cosZ - ly * sinZ, wy = lx * sinZ + ly * cosZ; // rotate by rotZ
        const dot = wx * towardX + wy * towardY;
        if (dot > bestDot) { bestDot = dot; bestOffset = { x: wx, y: wy }; }
      }
      return {
        mode: 'resolved',
        resolvedXY: { x: touchWorld.x - bestOffset.x, y: touchWorld.y - bestOffset.y },
        targetWorldZ: behindLattices(touchWorld.z),
        primaryAnchorWorld: touchWorld,
        targetNode: target
      };
    }
    default:
      return null;
  }
}

// Lattices are reclassified as rects for PLACEMENT purposes (real box
// profile/support-function - see tier1ShapeFields/computeShapeProfile3D and
// latticeVolumeRadius3D/latticeLocalGeometry) rather than the old plain-
// sphere stand-in. For RENDERING, each cell is its own solid, uniformly-
// colored extruded prism (real depth, not a texture decal only on the
// outer faces) - "colors must be consistent, and each cell's color should
// go from front to back of each cell." Every cell uses its own RAW pixel-
// space polygon directly (matching the proven pixel->Babylon-vertex
// convention every other per-point mesh in this file uses: divide by
// K3D_SCALE, negate Y) - simpler and safer than re-deriving a shared
// rotation, since each cell's own points already encode the lattice's true
// orientation exactly, whatever it is.
function create3DLattice(lattice, index, layerZ = 0, resolvedXY = null, scrambleQuat = null) {
  if (!lattice || !babylonScene) {
    console.warn('Cannot create lattice - missing lattice or scene');
    return false;
  }
  const cells = lattice.cells || [];
  if (cells.length === 0) {
    console.warn(`Lattice ${index} has no cells`);
    return false;
  }

  // resolvedXY (world units) comes from buildElementTree - lattices are now a
  // full Tier-1 tree participant, not read from lattice.x/y directly.
  const x = resolvedXY ? resolvedXY.x : (lattice.x - window.innerWidth / 2) / K3D_SCALE;
  const y = resolvedXY ? resolvedXY.y : -(lattice.y - window.innerHeight / 2) / K3D_SCALE;

  // Scramble: one pivot at the lattice centre carries the tilt for every
  // cell and frame ribbon; the geometry below is then built at the local
  // origin instead of at (x, y, z). Named tilt_* so convertShapesTo3D's
  // teardown disposes it with the other tilt nodes.
  const latticeParent = scrambleQuat ? new BABYLON.TransformNode(`tilt_lattice_${index}`, babylonScene) : null;
  const lx = latticeParent ? 0 : x, ly = latticeParent ? 0 : y;
  const z = -layerZ;
  if (latticeParent) {
    latticeParent.position = new BABYLON.Vector3(x, y, z);
    latticeParent.rotationQuaternion = scrambleQuat;
  }
  const lz = latticeParent ? 0 : z;

  // "The entire ensemble should be half as deep as a standard rect" - same
  // size basis (latticeLocalGeometry's rotated-frame bounding box) the
  // Tier-1 placement profile itself uses, so this always matches whatever
  // size buildElementTree actually reasoned about.
  const geo = latticeLocalGeometry(lattice);
  const s = geo ? Math.max(geo.w, geo.h) : 1;
  const depth = Math.max(0.8, s * 0.12) / 2;

  // Each cell is shrunk inward from its own centroid before being extruded -
  // a real gap between adjacent cells, not just a thin line drawn on top,
  // which is what actually fixes the original bug (two grid-adjacent cells'
  // side walls occupying the exact same position and z-fighting/shaking
  // while orbiting). The gap is then filled with a black CreateRibbon frame
  // below - see that comment for the (unrelated) reasons it was pulled and
  // restored once already.
  const CELL_SHRINK = 0.85; // 15% inset toward each cell's own centroid - real, visible gap width
  let built = 0;
  cells.forEach((cell, ci) => {
    const poly = cell.poly || cell.points;
    const col = cell.col || cell.color;
    if (!poly || poly.length < 4) return;

    const pts = poly.map(p => new BABYLON.Vector3(p.x / K3D_SCALE, -p.y / K3D_SCALE, 0));
    const centroid = pts.reduce((acc, p) => ({ x: acc.x + p.x / pts.length, y: acc.y + p.y / pts.length }), { x: 0, y: 0 });
    const shrunkPts = pts.map(p => new BABYLON.Vector3(
      centroid.x + (p.x - centroid.x) * CELL_SHRINK,
      centroid.y + (p.y - centroid.y) * CELL_SHRINK, 0
    ));
    // Was made fully opaque specifically to cut order-independent
    // transparency's per-pass GPU cost (depth peeling redraws every
    // translucent mesh once per pass) - that reasoning no longer applies
    // since OIT was reverted entirely (caused worse problems than it
    // solved). Restoring real translucency here for the 2D piece's own
    // layered, softly-blended look ("the beauty of the 2D representation") -
    // now the shared global body treatment instead of a lattice-only 0.85.
    const rgba = bodyColor3D(p5ColToRGBA(col));
    tagVolumeBody(extrudePrism(`lattice_${index}_${ci}`, shrunkPts, depth, rgba, lx, ly, lz, 0, latticeParent));

    // Black ring frame filling the shrink gap - a CreateRibbon surface
    // stretched between the cell's full-size outer boundary and its shrunk
    // inner boundary, on both the front and back cap planes. Pulled once
    // before on suspicion of causing a page freeze - that freeze turned out
    // to be an unrelated bug (a semiCircle support-distance profile that
    // could return Infinity, since fixed/reverted separately) - and this was
    // last tested while order-independent transparency was still active,
    // which was independently breaking OTHER shapes' outlines too (reverted
    // since). Restoring it now that both of those are gone.
    const outerLoop = p => [...pts.map(v => new BABYLON.Vector3(v.x, v.y, p)), new BABYLON.Vector3(pts[0].x, pts[0].y, p)];
    const innerLoop = p => [...shrunkPts.map(v => new BABYLON.Vector3(v.x, v.y, p)), new BABYLON.Vector3(shrunkPts[0].x, shrunkPts[0].y, p)];
    const FRAME_Z_PAD = 0.02;
    [lz - depth / 2 - FRAME_Z_PAD, lz + depth / 2 + FRAME_Z_PAD].forEach((pz, side) => {
      const ribbon = BABYLON.MeshBuilder.CreateRibbon(`latticeFrame_${index}_${ci}_${side}`, {
        pathArray: [outerLoop(pz), innerLoop(pz)],
        sideOrientation: BABYLON.Mesh.DOUBLESIDE
      }, babylonScene);
      ribbon.position = new BABYLON.Vector3(lx, ly, 0);
      ribbon.material = unlitMat(`latticeFrame_${index}_${ci}_${side}_mat`, K3D_BLACK);
      if (latticeParent) ribbon.parent = latticeParent;
    });
    built++;
  });

  console.log(`✅ Lattice ${index}: rebuilt as ${built}/${cells.length} solid-colored cell prisms, depth=${depth.toFixed(2)}`);
  return built > 0;
}

// —————————————————————————————————————
// EXPORT 3D MODEL (.OBJ + .MTL) - for Rhino / other rendering software
// —————————————————————————————————————

window.isBabylonSceneReady = function () {
  return !!(babylonScene && babylonScene.meshes.some(m => !m.name.startsWith('skyFace_')));
};

// Best representative flat color for a mesh (checks the exact color tagged
// by unlitMat()/createOpenShape3D() first, then falls back to material
// properties/texture sampling for anything untagged)
function meshExportColor(mesh) {
  if (mesh.metadata && mesh.metadata.exportColor) {
    const ec = mesh.metadata.exportColor;
    return { c: new BABYLON.Color3(ec.r, ec.g, ec.b), a: ec.a !== undefined ? ec.a : 1 };
  }
  const mat = mesh.material;
  if (mat && mat.metadata && mat.metadata.exportColor) {
    const ec = mat.metadata.exportColor;
    return { c: new BABYLON.Color3(ec.r, ec.g, ec.b), a: ec.a !== undefined ? ec.a : 1 };
  }
  if (mat && mat.emissiveColor && (mat.emissiveColor.r + mat.emissiveColor.g + mat.emissiveColor.b) > 0.004) {
    return { c: mat.emissiveColor, a: mat.alpha !== undefined ? mat.alpha : 1 };
  }
  if (mat && mat.diffuseColor && (mat.diffuseColor.r + mat.diffuseColor.g + mat.diffuseColor.b) > 0.004) {
    return { c: mat.diffuseColor, a: mat.alpha !== undefined ? mat.alpha : 1 };
  }
  // Texture-only material (e.g. some open shapes): sample the average pixel
  // color of its DynamicTexture canvas as a flat stand-in color
  const tex = mat && (mat.emissiveTexture || mat.diffuseTexture);
  if (tex && typeof tex.getContext === 'function') {
    try {
      const ctx = tex.getContext();
      const w = ctx.canvas.width, h = ctx.canvas.height;
      const step = Math.max(1, Math.floor(Math.min(w, h) / 24)); // sparse sample, stays fast
      const data = ctx.getImageData(0, 0, w, h).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = (y * w + x) * 4;
          if (data[i + 3] < 8) continue; // skip transparent pixels
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      if (n > 0) {
        return { c: new BABYLON.Color3(r / n / 255, g / n / 255, b / n / 255), a: mat.alpha !== undefined ? mat.alpha : 1 };
      }
    } catch (e) { /* canvas may be tainted or empty - fall through to default */ }
  }
  return { c: new BABYLON.Color3(0.7, 0.7, 0.7), a: 1 };
}

// Minimal dependency-free ZIP writer (STORE method, i.e. uncompressed - the
// files are small text, so compression isn't worth the code). Needed because
// browsers silently block a page's second auto-triggered download in the
// same action: exporting .obj + .mtl separately meant the .mtl (color data)
// never actually landed on disk, so Rhino always saw flat grey.
function crc32(bytes) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// `alignDataTo`: USDZ requires every file's DATA to begin on a 64-byte
// boundary, and the only legal place to insert that slack is the local
// header's extra field - so it's padded with zero bytes to suit. 0 disables
// it (the .obj/.mtl zip has no such requirement).
function buildZip(files, alignDataTo = 0, mime = 'application/zip') {
  // files: [{ name, data: Uint8Array }]
  const encoder = new TextEncoder();
  const localParts = [], centralParts = [];
  let offset = 0;

  files.forEach(f => {
    const nameBytes = encoder.encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, 0x04034b50, true);   // local file header signature
    localHeader.setUint16(4, 20, true);            // version needed
    localHeader.setUint16(6, 0, true);             // flags
    localHeader.setUint16(8, 0, true);             // method: 0 = store
    localHeader.setUint16(10, 0, true);            // mod time
    localHeader.setUint16(12, 0, true);            // mod date
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, data.length, true);  // compressed size
    localHeader.setUint32(22, data.length, true);  // uncompressed size
    let extraLen = 0;
    if (alignDataTo > 0) {
      const dataStart = offset + 30 + nameBytes.length;
      extraLen = (alignDataTo - (dataStart % alignDataTo)) % alignDataTo;
    }
    localHeader.setUint16(26, nameBytes.length, true);
    localHeader.setUint16(28, extraLen, true);      // extra field = alignment padding

    localParts.push(new Uint8Array(localHeader.buffer), nameBytes, new Uint8Array(extraLen), data);

    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true);  // central directory signature
    centralHeader.setUint16(4, 20, true);
    centralHeader.setUint16(6, 20, true);
    centralHeader.setUint16(8, 0, true);
    centralHeader.setUint16(10, 0, true);
    centralHeader.setUint16(12, 0, true);
    centralHeader.setUint16(14, 0, true);
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, data.length, true);
    centralHeader.setUint32(24, data.length, true);
    centralHeader.setUint16(28, nameBytes.length, true);
    centralHeader.setUint16(30, 0, true);
    centralHeader.setUint16(32, 0, true);
    centralHeader.setUint16(34, 0, true);
    centralHeader.setUint16(36, 0, true);
    centralHeader.setUint32(38, 0, true);
    centralHeader.setUint32(42, offset, true);     // offset of local header

    centralParts.push(new Uint8Array(centralHeader.buffer), nameBytes);

    offset += 30 + nameBytes.length + extraLen + data.length;
  });

  const centralStart = offset;
  let centralSize = 0;
  centralParts.forEach(p => centralSize += p.length);

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);
  eocd.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, new Uint8Array(eocd.buffer)], { type: mime });
}

// The geometry an exporter should actually write for a mesh, in the mesh's
// LOCAL space - shared by OBJ and USDZ. For "open" shapes the live mesh is a
// texture-alpha cutout plane, so its real polygon footprint is substituted
// and re-centred (see exportZOffset).
function exportGeometryFor(mesh) {
  let geom;
  if (mesh.metadata && mesh.metadata.exportPolygon) {
    const built = polygonPrismGeometry(mesh.metadata.exportPolygon, mesh.metadata.exportDepth || 0);
    const dz = mesh.metadata.exportZOffset || 0;
    if (dz) for (let i = 2; i < built.positions.length; i += 3) built.positions[i] += dz;
    geom = built;
  } else {
    geom = {
      positions: mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind),
      indices: mesh.getIndices()
    };
  }
  // Runs AFTER the polygon substitution, so an open shape tessellates its
  // true prism rather than the padded plane it is on screen.
  if (mesh.metadata && mesh.metadata.volumeGradient) geom = tessellateForGradient(geom);
  return geom;
}

// Splits triangles 1->4 until no edge is longer than R/6, so a radial density
// field has vertices to interpolate between.
//
// Why this is needed at all: a box's four face corners are all EQUIDISTANT
// from its centroid, so a radial field evaluated only at the corners
// interpolates to a perfectly flat face - the gradient would simply vanish on
// exactly the shapes it matters most for. (A purely LINEAR ramp needs no
// subdivision, since barycentric interpolation of a position-linear function
// is exact. A radial one does.)
//
// Export-only, so it costs the running app nothing - which is what makes it
// affordable to add vertices this freely.
function tessellateForGradient(geom) {
  const { positions, indices } = geom;
  if (!positions || !indices || indices.length < 3) return geom;
  const field = densityField(positions);
  const maxEdge = field.R / 6;

  let pos = Array.from(positions);
  let idx = Array.from(indices);
  // Dedupe split points by midpoint key so neighbouring triangles share the
  // new vertex - without this the mesh cracks apart along every split edge.
  const midCache = new Map();
  const midpoint = (a, b) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const hit = midCache.get(key);
    if (hit !== undefined) return hit;
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const m = pos.length / 3;
    pos.push((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    midCache.set(key, m);
    return m;
  };
  const edgeLen = (a, b) => Math.hypot(
    pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]
  );

  // Breadth-first: one full pass per level, bailing the moment the budget is
  // reached so a pathological mesh can't blow the file up.
  for (let level = 0; level < 4; level++) {
    if (idx.length / 3 >= USDZ_GRADIENT_MAX_TRIS) break;
    let split = false;
    const next = [];
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const longest = Math.max(edgeLen(a, b), edgeLen(b, c), edgeLen(c, a));
      if (longest <= maxEdge || next.length / 3 >= USDZ_GRADIENT_MAX_TRIS) {
        next.push(a, b, c);
        continue;
      }
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      // Winding preserved on all four children - the export relies on
      // winding alone for face direction (it writes no normals).
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      split = true;
    }
    idx = next;
    if (!split) break;
  }
  return { positions: pos, indices: idx };
}

// Every artwork mesh, skybox excluded - shared by the OBJ and USDZ exporters
// so the two can never disagree about what "the sculpture" is.
// The identical mesh set for OBJ and USDZ - the two exporters should be
// looking at the same sculpture, and divergence here is what let the USDZ
// path drift into failure modes OBJ had never had.
function collectExportMeshes() {
  return babylonScene.meshes.filter(m =>
    !m.name.startsWith('skyFace_') && m.isEnabled() && m.getTotalVertices() > 0 &&
    !(m.metadata && m.metadata.skipExport) &&
    // isEnabled() alone doesn't cover this - it's Babylon's scene-graph
    // enable/disable, a different flag from isVisible (what
    // window.setStructureVisible actually toggles for "Hide base &
    // struts"). Without this, turning that off only hid the base/struts
    // from the live viewport - they'd still silently reappear in every
    // OBJ/AR export regardless of what's showing on screen.
    m.isVisible !== false
  );
}

// ===== USDZ export / iOS AR Quick Look =====
// iOS Safari has NO WebXR, so there is no in-page AR on iPhone at all. The
// only route is Apple's AR Quick Look: hand it a .usdz and the system viewer
// handles surface detection, placement and scaling natively. A .usdz is just
// an UNCOMPRESSED zip (see buildZip's alignDataTo) holding an ASCII .usda.
//
// The piece is unlit and emissive on screen; AR Quick Look is fully lit PBR.
// A flat colour dropped into a real room's lighting goes muddy, so each
// material carries a share of its colour as EMISSION to keep the self-lit
// look - see meshUsdSurface and the `metadata.usd` hints on the base, strut
// and wire materials.
const USDZ_TARGET_SIZE_M = 0.32;  // longest dimension in metres - desk-sized

// PBR stand-in for a mesh's flat colour. `metadata.usd` on a material
// overrides the defaults (metals set metallic/roughness and drop emission,
// since they SHOULD react to the room's light rather than glow).
// On screen the shape bodies are 60% opaque so you can read the layering
// through them. In AR that same stack of 50+ translucent meshes has to be
// depth-sorted by a real-time renderer, and the result is mush - washed-out
// colour and faces winking through each other. A physical acrylic sculpture on
// a desk also simply reads more solid than the screen version. So anything
// meant to be a BODY is pushed close to opaque, while genuinely near-
// invisible things (the clear-acrylic strut option at 0.14, concentricArc's
// wedge at 0.05) keep their transparency - they'd become ugly solids
// otherwise. Tune with these two.
// Bodies are translucent again, but only because the thing that ruined it the
// first time is now suppressed at the source.
//
// The wash was NOT the background showing through - in the dark Object-mode
// view the shapes were still pastel. It was the SPECULAR lobe: a dielectric
// in UsdPreviewSurface carries an F0 reflection derived from `ior`, and
// RealityKit lights it with environment IBL. On an opaque surface that reads
// as a sheen; on a translucent one it lands on top of whatever shows through,
// adding white to every body. Killing that lobe (see the specular-workflow
// block in buildUsda) removes the cause rather than the symptom, so
// translucency costs colour fidelity no more.
// Body translucency - BLENDED, matching the app's BODY_ALPHA_3D (0.6), so a
// shape's full volume reads exactly as it does on screen: front, back and
// side walls all visible through each other.
//
// Why plain blending is safe HERE, when it burned us before: alpha blending
// is only order-dependent when the stacked layers have DIFFERENT colours,
// and a renderer never sorts the triangles inside one mesh. But a body
// blending with ITSELF - front wall over back wall, same unlit colour, same
// alpha - composites to the identical result in either order. The app relies
// on exactly this (Babylon doesn't sort intra-mesh triangles either). Every
// earlier "translucency looks broken" had a different, since-fixed cause
// that made the two walls DIFFERENT: PBR lit them by orientation, specular
// IBL whitened whatever faced the room, inverted winding removed one of
// them, and an opacity wired to a texture stopped depth writes entirely.
// With bodies unlit, specular dead and winding fixed, the commutativity
// argument holds and blending is the right tool again.
//
// Where two DIFFERENT-coloured bodies overlap, per-mesh sort order can still
// pick wrong at oblique angles - the app has the same ambiguity (see the
// alpha-blend comment near the top of this file) and it reads fine there.
const USDZ_BODY_OPACITY = 0.6;
// The dither cutout is kept as a fallback (flip to true) but OFF: at phone
// viewing distance the mask read as grain/noise, not glass.
const USDZ_DITHER = false;
// Cutout cells per metre of real-world size. Too coarse and the pattern reads
// as visible grain; too fine and the phone's texture filtering averages the
// mask away to a flat value, at which point the threshold test turns the
// whole surface uniformly solid or invisible. ~700 puts a cell near 1.4mm,
// small enough to read as glass at arm's length and large enough to survive
// mip filtering.
const USDZ_DITHER_CELLS_PER_M = 700;
const USDZ_DITHER_TILE = 8; // dither matrix is TILE x TILE
// Opacity across the density ramp. This is what stops the shapes reading as
// EMPTY, and it is doing the job real volumetric absorption would.
//
// A translucent shell is visibly hollow: you see through the near wall to the
// far one and the shape reads as an empty box, whatever colour its surfaces
// are. Genuine Beer-Lambert absorption - thicker parts blocking more light -
// isn't expressible in USDZ for a mesh. But thickness correlates with the
// density field we already have: a shape is thick through its core and thin
// at its edges. So the core is driven fully OPAQUE, which hides the far wall
// exactly where you'd be looking through the most material, and the rim stays
// see-through. The result reads as a solid piece of cast acrylic with soft
// edges rather than a hollow shell - and unlike slicing or nested shells it
// costs no extra geometry and cannot sort badly, because it changes only a
// single alpha channel in the ramp.
// UNIFORM by default, and that is the correction to a mistake worth recording:
// fading alpha with distance-from-centre HOLLOWS OUT FLAT SHAPES. A thin slab
// is mostly "far from centre" - only a small disc around its middle is near -
// so a radial falloff eats nearly the whole face, leaving a complete black
// outline around a fill that stops short of it. Open shapes, being the
// flattest things in the piece, vanished almost entirely: "shape faces are
// not complete, open shapes are empty".
//
// Radial distance is a fine proxy for thickness on a CHUNKY body and a bad
// one on a flat plate, and this piece is mostly flat plates. So opacity is
// left uniform and the volume cue is carried by COLOUR alone. Set RIM below
// CORE only if you want deliberately vignetted edges.
const USDZ_CORE_OPACITY = 1;
const USDZ_RIM_OPACITY = 1;
const USDZ_GLASS_BELOW = 0.25;   // at or under this it was meant to be barely-there - left alone
const USDZ_OPAQUE_ABOVE = 0.995; // outlines, struts, the base: solid on screen, solid in AR
// Emission fights the whole point of AR. Quick Look estimates the REAL light
// direction and intensity in your room and lights the model with it - but an
// emissive surface is self-lit and simply ignores that, so a high emissive
// left the piece looking like a flat sticker floating on the desk instead of
// an object sitting in the room. A whisper is kept so the darkest colours
// don't go dead in a dim room; the room does the rest.
const USDZ_EMISSIVE = 0.05;

// Artwork bodies are exported UNLIT, exactly as unlitMat draws them on screen
// - see the long note in buildUsda's material block for why every earlier
// attempt to imitate that through PBR shading failed. Set false to hand the
// bodies back to physical lighting (they will then shade by orientation, and
// colour will depend on which way each face points).
const USDZ_UNLIT_BODIES = true;

function meshUsdSurface(mesh) {
  const { c, a } = meshExportColor(mesh);
  const hint = (mesh.material && mesh.material.metadata && mesh.material.metadata.usd) || {};
  const opacity = a <= USDZ_GLASS_BELOW ? a
    : a >= USDZ_OPAQUE_ABOVE ? 1
      : USDZ_BODY_OPACITY;
  return {
    r: c.r, g: c.g, b: c.b, a: opacity,
    metallic: hint.metallic !== undefined ? hint.metallic : 0,
    roughness: hint.roughness !== undefined ? hint.roughness : 0.55,
    emissive: hint.emissive !== undefined ? hint.emissive : USDZ_EMISSIVE
  };
}

function usdVec(x, y, z, dp) { return `(${x.toFixed(dp)}, ${y.toFixed(dp)}, ${z.toFixed(dp)})`; }

// Does this mesh's winding face OUTWARD? Decided per mesh from its own signed
// volume rather than by assuming a convention - which is the point, because
// the file mixes two conventions and guessing has cost several rounds:
//
//   - extrudePrism builds DOUBLESIDE, i.e. both windings in one mesh. Its
//     halves cancel to ~zero volume, and it renders correctly either way.
//   - CreateBox / CreateCylinder default to FRONTSIDE, a single winding, so
//     they are the only bodies that can expose a mistake - and they did:
//     inverted, a closed prism shows you its far interior wall through a
//     missing near face, which reads as an open bowl and changes as you move.
//
// V = 1/6 sum(p0 . (p1 x p2)) is positive for outward-facing triangles in a
// right-handed space. Near-zero means flat or double-sided - ambiguous, so
// leave those alone and let `doubleSided` carry them.
function windingIsOutward(pts, indices) {
  let v = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    if (pts[i] < minX) minX = pts[i]; if (pts[i] > maxX) maxX = pts[i];
    if (pts[i + 1] < minY) minY = pts[i + 1]; if (pts[i + 1] > maxY) maxY = pts[i + 1];
    if (pts[i + 2] < minZ) minZ = pts[i + 2]; if (pts[i + 2] > maxZ) maxZ = pts[i + 2];
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  // Measured about the mesh's OWN centre, which is not optional: the formula
  // sums tetrahedra from the origin, so a FLAT sheet sitting away from the
  // origin returns the volume of the pyramid under it - a confident,
  // meaningless sign. Centred, a flat sheet lies in a plane through the
  // origin and correctly returns zero, while a closed body still returns its
  // true volume. Without this the base's flat ground caps would be "corrected"
  // and the slab would break open again.
  const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2, oz = (minZ + maxZ) / 2;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ax = pts[a] - ox, ay = pts[a + 1] - oy, az = pts[a + 2] - oz;
    const bx = pts[b] - ox, by = pts[b + 1] - oy, bz = pts[b + 2] - oz;
    const cx = pts[c] - ox, cy = pts[c + 1] - oy, cz = pts[c + 2] - oz;
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  v /= 6;
  // 0.5% of the bounding cube - well above float noise, well below any real
  // closed volume.
  if (Math.abs(v) < diag * diag * diag * 0.005) return null; // ambiguous
  return v > 0;
}

// The canvas behind a DynamicTexture, or null for anything else.
function usdTextureCanvas(mesh) {
  const mat = mesh.material;
  const tex = mat && (mat.diffuseTexture || mat.emissiveTexture);
  if (!tex || typeof tex.getContext !== 'function') return null;
  try {
    const ctx = tex.getContext();
    return (ctx && ctx.canvas) ? ctx.canvas : null;
  } catch (e) { return null; }
}

// A 1-D image of the density ramp: dense core at u=0, lifted rim at u=1.
// The gradient is a single scalar along an axis, which this represents
// exactly - and it means the EASING CURVE lives in the image, so the
// per-vertex `t` only ever has to interpolate linearly between vertices
// (which a GPU does exactly, needing no extra subdivision to look smooth).
// It also reuses the stReader -> UsdUVTexture network the base already
// proved, instead of opening a UsdPrimvarReader_float3 path whose Quick Look
// support is inconsistent.
// premultiplyAt(t) is an optional override for the constant `opacity`
// premultiply below - see openGradientColorAt's call site (the only current
// user) for why: that ramp already lifts colour toward white as t -> 1 to
// FAKE fading to transparent (this renderer's opacity is one flat scalar
// per mesh, it can't actually vary across a surface - see the PREMULTIPLIED
// note below). Premultiplying that near-white tip by the SAME flat body
// opacity as the solid end (0.6 typically) dims it right back down to a flat
// mid-grey - "near white" times "0.6" is grey, not pale - which is exactly
// backwards: the illusion needs the open end to render AS BRIGHT as it
// looks, not dimmed to match the solid end's real translucency. Density
// gradients (the default, unset here) don't have this problem - they're a
// pigment-density hint, never meant to read as fading to transparent - so
// they keep the original flat premultiply, unchanged.
function buildRampCanvas(rgba, opacity, colorAt, premultiplyAt) {
  colorAt = colorAt || densityColorAt;
  premultiplyAt = premultiplyAt || (() => opacity);
  const cv = document.createElement('canvas');
  cv.width = USDZ_RAMP_TEXELS;
  cv.height = 1;
  const ctx = cv.getContext('2d');
  for (let i = 0; i < USDZ_RAMP_TEXELS; i++) {
    const t = i / (USDZ_RAMP_TEXELS - 1);
    const c = colorAt(rgba, t);
    // PREMULTIPLIED by the body alpha. The ghost-plane episode proved this
    // renderer composites emission WITHOUT scaling it by opacity (a fully
    // transparent texel still painted). So for a translucent emissive body,
    // correct "over" compositing has to be built into the colour itself:
    // emit C*a here and let the material's scalar opacity fade the
    // background underneath. If bodies come out too dim on device, raise
    // this factor toward 1 - do not touch the opacity, which controls how
    // much of the room shows through.
    const pre = premultiplyAt(t);
    ctx.clearRect(i, 0, 1, 1);
    ctx.fillStyle = `rgba(${Math.round(c.r * pre * 255)},${Math.round(c.g * pre * 255)},${Math.round(c.b * pre * 255)},1)`;
    ctx.fillRect(i, 0, 1, 1);
  }
  return cv;
}

// An ordered (Bayer) dither tile whose ALPHA is the cutout mask: `coverage`
// of the cells survive, the rest are discarded by opacityThreshold. Ordered
// rather than random so the surviving pixels spread evenly instead of
// clumping into visible blotches.
function buildDitherCanvas(coverage) {
  const N = USDZ_DITHER_TILE;
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  const ctx = cv.getContext('2d');
  // Standard recursive Bayer construction:
  //   M(2n) = [ 4M    4M+2 ]
  //           [ 4M+3  4M+1 ]
  // Getting this wrong is not subtle - a botched matrix produced alternating
  // full rows, which would have read as horizontal STRIPES across every
  // shape rather than as even grain.
  let m = [[0]];
  for (let size = 1; size < N; size *= 2) {
    const next = [];
    for (let y = 0; y < size * 2; y++) next[y] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + size] = v + 2;
        next[y + size][x] = v + 3;
        next[y + size][x + size] = v + 1;
      }
    }
    m = next;
  }
  const bayer = m.map(row => row.map(v => v / (N * N)));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // White RGB - only the alpha channel is read, as the cutout mask.
      ctx.fillStyle = `rgba(255,255,255,${bayer[y][x] < coverage ? 1 : 0})`;
      ctx.clearRect(x, y, 1, 1);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return cv;
}

function canvasToPngBytes(canvas) {
  const dataUrl = canvas.toDataURL('image/png');
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Pulls every exportable mesh into USD space and normalises the whole piece
// to a desk-sized object standing on the origin plane.
function collectUsdParts() {
  const meshes = collectExportMeshes().filter(m => !(m.metadata && m.metadata.skipUsdz));
  const parts = [];
  const textures = new Map(); // canvas -> { name, data }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  meshes.forEach(mesh => {
    mesh.computeWorldMatrix(true);
    const world = mesh.getWorldMatrix();
    // GEOMETRY MATCHES THE OBJ EXPORT by default, and that is deliberate.
    // Texturing an "open" shape does carry its alpha gradient, but it also
    // means exporting the mesh's real geometry - which is a PADDED RECTANGLE
    // with the silhouette cut out by alpha. Anything that then fails to
    // respect that alpha (emission, a renderer's blend mode, a UV
    // orientation guess) leaves the whole rectangle visible as a clear plane
    // slicing through the piece. The OBJ path never had that failure mode
    // because it substitutes the true polygon prism and never emits a padded
    // rectangle at all.
    //
    // So: the proven path is the default, and texturing is opt-in via
    // `metadata.usdTexture` - currently only the base, whose texture sits on
    // real solid geometry with no cutout involved and so carries none of
    // that risk. The cost is that open shapes export as uniform prisms
    // rather than fading out.
    const wantsTexture = !!(mesh.metadata && mesh.metadata.usdTexture);
    const canvas = wantsTexture ? usdTextureCanvas(mesh) : null;
    const uvs = canvas ? mesh.getVerticesData(BABYLON.VertexBuffer.UVKind) : null;
    const textured = !!(canvas && uvs && uvs.length);

    let positions, indices;
    if (textured) {
      positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      indices = mesh.getIndices();
    } else {
      ({ positions, indices } = exportGeometryFor(mesh));
    }
    if (!positions || !indices || indices.length < 3) return;

    let texName = null;
    if (textured) {
      if (!textures.has(canvas)) {
        try {
          textures.set(canvas, {
            name: `textures/tex_${textures.size}.png`,
            data: canvasToPngBytes(canvas)
          });
        } catch (e) {
          console.warn('USDZ: texture encode failed, falling back to flat colour', e);
        }
      }
      const entry = textures.get(canvas);
      if (entry) texName = entry.name;
    }

    // Density gradient. Note this deliberately does NOT go through the
    // `textured` branch above: that branch bypasses exportGeometryFor and
    // would resurrect the padded-rectangle ghost planes. A gradient mesh
    // takes the normal geometry path and gains only `st`.
    let gradField = null;
    let gradFieldIsLinear = false; // true for open shapes - see exportGradientDir below
    let selfLit = false;
    let ditherName = null;
    if (!textured && mesh.metadata && mesh.metadata.volumeGradient) {
      // Open shapes carry their real 2D gradient direction (exportGradientDir,
      // set in createOpenShape3D) and get a LINEAR ramp along it, pooling
      // solid at the closed side and lifting toward white at the open side -
      // their gradient IS the whole visual identity. Everything else (closed
      // bodies via tagVolumeBody) keeps the original radial "denser at the
      // centre" ramp, unchanged - that one is a barely-there depth hint, not
      // the main event, and stays deliberately subtle.
      const dir = mesh.metadata.exportGradientDir;
      gradFieldIsLinear = !!dir;
      const colorAt = gradFieldIsLinear ? openGradientColorAt : densityColorAt;

      const base = meshExportColor(mesh);
      const rgba = { r: base.c.r, g: base.c.g, b: base.c.b, a: base.a };
      const bodyAlpha = meshUsdSurface(mesh).a;
      // Open shapes fake their fade-to-transparent edge by lifting colour
      // toward white (openGradientColorAt) rather than actually varying
      // opacity (this renderer's opacity is one flat scalar per mesh - see
      // buildRampCanvas). Premultiplying that near-white tip by the body's
      // real (translucent) opacity would dim it right back down to a flat
      // grey, undoing the illusion entirely - ramp the premultiply up
      // toward 1 over the SAME eased curve the colour lift itself uses, so
      // the open end renders as bright as it's drawn instead of grey.
      // Density gradients keep the original flat premultiply (undefined
      // here falls back to it in buildRampCanvas) - that ramp is a pigment-
      // density hint, never meant to read as fading to transparent.
      const premultiplyAt = gradFieldIsLinear
        ? (t) => { const eased = t * t * (3 - 2 * t); return bodyAlpha + (1 - bodyAlpha) * eased; }
        : undefined;
      // Key on colour, opacity AND which ramp shape - open and closed meshes
      // that happen to share a colour must NOT share a ramp texture, since
      // they now use different curves.
      const key = 'ramp_' + (gradFieldIsLinear ? 'open' : 'radial') + '_'
        + [rgba.r, rgba.g, rgba.b, bodyAlpha].map(v => v.toFixed(3)).join('_');
      if (!textures.has(key)) {
        try {
          textures.set(key, {
            name: `textures/ramp_${textures.size}.png`,
            data: canvasToPngBytes(buildRampCanvas(rgba, bodyAlpha, colorAt, premultiplyAt))
          });
        } catch (e) {
          console.warn('USDZ: ramp encode failed, falling back to flat colour', e);
        }
      }
      const entry = textures.get(key);
      if (entry) {
        texName = entry.name;
        selfLit = USDZ_UNLIT_BODIES;
        // One cutout mask shared by the whole model.
        if (USDZ_DITHER && USDZ_BODY_OPACITY < 0.999) {
          if (!textures.has('dither')) {
            try {
              textures.set('dither', {
                name: 'textures/dither.png',
                data: canvasToPngBytes(buildDitherCanvas(USDZ_BODY_OPACITY))
              });
            } catch (e) { console.warn('USDZ: dither encode failed', e); }
          }
          if (textures.has('dither')) ditherName = textures.get('dither').name;
        }
        // Field from the FINAL (tessellated) local positions, so the added
        // vertices are included in the observed distance range.
        gradField = gradFieldIsLinear
          ? linearGradientField(positions, dir.x, dir.y)
          : densityField(positions);
      }
    }

    const pts = [];
    for (let i = 0; i < positions.length; i += 3) {
      const v = BABYLON.Vector3.TransformCoordinates(
        new BABYLON.Vector3(positions[i], positions[i + 1], positions[i + 2]), world);
      // Babylon's scene is LEFT-handed; USD is right-handed, Y up. Negating Z
      // converts between them, and the triangle winding is reversed below to
      // match - without that flip every face would point inward.
      const x = v.x, y = v.y, z = -v.z;
      pts.push(x, y, z);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    // NO explicit normals. The Z negation above mirrors the geometry, so
    // both the winding AND the normals have to be flipped to stay in
    // agreement - and if they disagree even slightly, faces light as though
    // they point the wrong way: a lid reads as an open hole, and a single
    // shape shades patchily face to face. Letting USD derive normals from
    // the winding makes the winding the ONE source of truth, which is also
    // exactly what the proven OBJ path does (it writes no `vn` either).
    // Flat/faceted shading is the cost, and it's the right cost here: every
    // material in this scene is unlit and flat on screen anyway.
    // USD samples st with (0,0) at the image's LOWER-left; a canvas is drawn
    // from its top-left, so v is flipped. If a texture ever appears upside
    // down, this is the line.
    let st = null;
    if (gradField) {
      // (t, 0.5) - a 1-D lookup, so no v flip applies here.
      st = [];
      for (let i = 0; i < positions.length; i += 3) {
        const t = gradFieldIsLinear
          ? linearGradientAt(gradField, positions[i], positions[i + 1])
          : densityAt(gradField, positions[i], positions[i + 1], positions[i + 2]);
        st.push(t, 0.5);
      }
    } else if (texName && uvs) {
      st = [];
      for (let i = 0; i < uvs.length; i += 2) st.push(uvs[i], 1 - uvs[i + 1]);
    }
    // false = this mesh's triangles face inward and must be reversed on the
    // way out; null = flat or double-sided, leave the winding untouched.
    const outward = windingIsOutward(pts, indices);
    const surf = meshUsdSurface(mesh);
    // TRANSLUCENT bodies ship BOTH windings, exactly like the extrudePrism
    // bodies (which are DOUBLESIDE in Babylon and arrive here pre-doubled).
    // The evidence that forced this: opaque single-winding meshes - the
    // black outline tubes - render correctly from every angle, so winding
    // and culling are right for the opaque pass. But on the BLENDED pass,
    // single-winding faces showed only from the far side ("I can only see
    // the front from the back, and the back from the front") - RealityKit's
    // transparent pass draws one side of each surface, and not the one the
    // opaque rules predict, `doubleSided = true` notwithstanding. Rather
    // than fight which side that is, give every triangle a reversed twin:
    // whichever side the pass culls, each face keeps a drawable copy from
    // every viewpoint. Meshes where windingIsOutward returns null are
    // either flat or ALREADY doubled - skipped, no re-doubling, UNLESS
    // `usdForceDoubleWinding` says otherwise (see below).
    //
    // Flat single-sided planes (the base's topCap/botCap - see
    // createBaseMesh3D) are a separate case windingIsOutward can't speak to
    // at all: a flat quad has zero signed volume regardless of which way it
    // winds, so `outward` is always null for them, same as a genuinely
    // pre-doubled closed body - but a flat plane isn't pre-doubled, it only
    // ever has ONE real face. Confirmed by direct AR test to go invisible
    // from the wrong side on an OPAQUE base too (wood), not just a
    // translucent one - the "opaque single-winding meshes render correctly
    // from every angle" evidence above came from closed TUBES, where the
    // far wall visually substitutes for a culled near face; a flat plane has
    // no such far wall to fall back on, so it just disappears. Doubling a
    // flat plane's winding is always safe and nearly free (same point array,
    // a few extra index entries), so `usdForceDoubleWinding`-tagged meshes
    // double unconditionally, regardless of opacity.
    const forceDouble = !!(mesh.metadata && mesh.metadata.usdForceDoubleWinding);
    let outIdx = indices;
    if (forceDouble || (surf.a < 0.999 && outward !== null && mesh.metadata && mesh.metadata.volumeGradient)) {
      outIdx = Array.from(indices);
      for (let t = 0; t + 2 < indices.length; t += 3) {
        outIdx.push(indices[t], indices[t + 2], indices[t + 1]);
      }
    }
    parts.push({
      pts, indices: outIdx, st, texName, selfLit, ditherName,
      flipWinding: outward === false,
      texCutout: !!(textured && mesh.metadata && mesh.metadata.usdTextureCutout),
      surf
    });
  });

  if (!parts.length) return null;

  // Scale the longest dimension to USDZ_TARGET_SIZE_M, centre it on X/Z and
  // drop its lowest point to y=0 so AR Quick Look seats it on the surface
  // rather than burying or floating it.
  const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
  const scale = USDZ_TARGET_SIZE_M / Math.max(spanX, spanY, spanZ, 1e-6);
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  parts.forEach(part => {
    const lo = { x: Infinity, y: Infinity, z: Infinity };
    const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let i = 0; i < part.pts.length; i += 3) {
      const x = part.pts[i] = (part.pts[i] - cx) * scale;
      const y = part.pts[i + 1] = (part.pts[i + 1] - minY) * scale;
      const z = part.pts[i + 2] = (part.pts[i + 2] - cz) * scale;
      if (x < lo.x) lo.x = x; if (x > hi.x) hi.x = x;
      if (y < lo.y) lo.y = y; if (y > hi.y) hi.y = y;
      if (z < lo.z) lo.z = z; if (z > hi.z) hi.z = z;
    }
    // Each mesh needs its OWN bounds - handing every prim the whole model's
    // extent is wrong and makes a renderer's culling and bounds maths lie.
    part.min = lo;
    part.max = hi;

    // Cutout-mask UVs, in metres, so cell size is a real-world quantity and
    // every shape gets the same visual grain regardless of its size. All
    // three axes contribute with different weights: a straight XY projection
    // would collapse to a constant on any face perpendicular to it, leaving
    // that face either fully solid or fully cut away.
    if (part.ditherName) {
      const k = USDZ_DITHER_CELLS_PER_M / USDZ_DITHER_TILE;
      part.st1 = [];
      for (let i = 0; i < part.pts.length; i += 3) {
        const x = part.pts[i], y = part.pts[i + 1], z = part.pts[i + 2];
        part.st1.push((x + z * 0.5) * k, (y + z * 0.37) * k);
      }
    }
  });
  return {
    parts,
    textures: Array.from(textures.values()),
    extent: [
      { x: -spanX * scale / 2, y: 0, z: -spanZ * scale / 2 },
      { x: spanX * scale / 2, y: spanY * scale, z: spanZ * scale / 2 }
    ]
  };
}

// ASCII USD (.usda). AR Quick Look accepts it inside a .usdz, which avoids
// having to write the binary crate format.
function buildUsda() {
  const collected = collectUsdParts();
  if (!collected) return null;
  const { parts, extent, textures } = collected;

  // One material per distinct surface - the exporter's own dedupe, matching
  // how the OBJ side collapses identical colours into one `newmtl`.
  const matIds = new Map();
  parts.forEach(p => {
    const s = p.surf;
    const key = [s.r, s.g, s.b, s.a, s.metallic, s.roughness, s.emissive]
      .map(v => v.toFixed(3)).join('_') + '|' + (p.texName || '') + '|' + (p.selfLit ? 's' : '')
      + '|' + (p.ditherName || '');
    if (!matIds.has(key)) matIds.set(key, { name: `mat_${matIds.size}`, surf: s, tex: p.texName, cutout: p.texCutout, selfLit: p.selfLit, dither: p.ditherName });
    p.matName = matIds.get(key).name;
  });

  // AR Quick Look's default placement behaviour is "find a real horizontal
  // surface and sit the model on it" - exactly right for the full piece
  // (base included), wrong for a base/struts-free export: with nothing at
  // the bottom acting as a literal pedestal, the piece should be a small
  // floating object placeable anywhere in view (on a table, against a
  // wall, hovering in mid-air), not locked to hunting for a surface to
  // rest on. Preliminary_AnchoringAPI's `type` token is Apple's own hook
  // for this - "plane" keeps today's surface-seeking behaviour, "none"
  // drops the surface requirement entirely. Reflects whichever the CURRENT
  // export actually contains (collectExportMeshes already excludes hidden
  // base/strut meshes - see window.isStructureVisible - so this always
  // matches what's really in the file, not just the live viewport toggle).
  const includesStructure = typeof window.isStructureVisible !== 'function' || window.isStructureVisible();
  const anchoringType = includesStructure ? 'plane' : 'none';

  const L = [];
  L.push('#usda 1.0');
  L.push('(');
  L.push('    defaultPrim = "Sculpture"');
  L.push('    metersPerUnit = 1');
  L.push('    upAxis = "Y"');
  L.push(')');
  L.push('');
  L.push('def Xform "Sculpture" (');
  L.push('    prepend apiSchemas = ["Preliminary_AnchoringAPI"]');
  L.push(')');
  L.push('{');
  L.push(`    uniform token preliminary:anchoring:type = "${anchoringType}"`);
  L.push('    def Scope "Materials"');
  L.push('    {');
  matIds.forEach(({ name, surf, tex, cutout, selfLit, dither }) => {
    const e = surf.emissive;
    const base = `</Sculpture/Materials/${name}`;
    L.push(`        def Material "${name}"`);
    L.push('        {');
    L.push(`            token outputs:surface.connect = ${base}/Shader.outputs:surface>`);
    if (tex) {
      // st reader -> texture -> surface. The texture's ALPHA channel is what
      // carries an open shape's fade, so it drives opacity as well as colour.
      L.push('            def Shader "stReader"');
      L.push('            {');
      L.push('                uniform token info:id = "UsdPrimvarReader_float2"');
      L.push('                token inputs:varname = "st"');
      L.push('                float2 outputs:result');
      L.push('            }');
      L.push('            def Shader "tex"');
      L.push('            {');
      L.push('                uniform token info:id = "UsdUVTexture"');
      L.push(`                asset inputs:file = @${tex}@`);
      L.push(`                float2 inputs:st.connect = ${base}/stReader.outputs:result>`);
      L.push('                token inputs:wrapS = "clamp"');
      L.push('                token inputs:wrapT = "clamp"');
      L.push('                float3 outputs:rgb');
      L.push('                float outputs:a');
      L.push('            }');
    }
    if (dither) {
      // Reads primvars:st1, NOT st - the mask tiles in world space while the
      // colour ramp is a 1-D lookup along the density axis.
      L.push('            def Shader "stReaderMask"');
      L.push('            {');
      L.push('                uniform token info:id = "UsdPrimvarReader_float2"');
      L.push('                token inputs:varname = "st1"');
      L.push('                float2 outputs:result');
      L.push('            }');
      L.push('            def Shader "mask"');
      L.push('            {');
      L.push('                uniform token info:id = "UsdUVTexture"');
      L.push(`                asset inputs:file = @${dither}@`);
      L.push(`                float2 inputs:st.connect = ${base}/stReaderMask.outputs:result>`);
      L.push('                token inputs:wrapS = "repeat"');
      L.push('                token inputs:wrapT = "repeat"');
      L.push('                float outputs:a');
      L.push('            }');
    }
    L.push('            def Shader "Shader"');
    L.push('            {');
    L.push('                uniform token info:id = "UsdPreviewSurface"');

    // ===== UNLIT bodies =====
    // The artwork is drawn UNLIT on screen (see unlitMat: emissiveColor set,
    // diffuseColor black, disableLighting true), so a surface shows its exact
    // colour from every angle. UsdPreviewSurface is PBR, and every problem in
    // this export came from that one mismatch: colour washing to pastel,
    // colour appearing only on faces turned toward a window, shapes reading as
    // hollow. Each of those was PBR shading doing its job on something that
    // was never meant to be shaded.
    //
    // The answer is not to tune PBR into an imitation of unlit - it is to ask
    // USD for unlit directly, which it can express exactly:
    //   diffuseColor = black   -> no lit contribution at all
    //   emissiveColor = colour -> the surface simply IS its colour
    //   specular workflow, black specular, ior 1 -> no environment sheen
    // That is the same recipe as unlitMat, so the sculpture in AR now matches
    // the sculpture on screen by construction rather than by approximation.
    //
    // Applied ONLY to the artwork. The marble base and the brass/steel struts
    // stay physically lit: they are meant to read as real materials sitting in
    // your room, catching your actual light, and neither has ever been the
    // thing that looked wrong.
    if (selfLit) {
      L.push('                color3f inputs:diffuseColor = (0, 0, 0)');
      if (tex) {
        L.push(`                color3f inputs:emissiveColor.connect = ${base}/tex.outputs:rgb>`);
        // CONNECTING opacity to a texture marks the material TRANSPARENT, and
        // that classification is made from the wiring, not from the values -
        // so a ramp whose every texel is alpha 1.0 still lands in the blended
        // queue, where it stops writing depth. Nothing then occludes anything,
        // and you see straight through a solid shape to its own far wall:
        // "we only see the colour of the right side from the right, the
        // backside from the front". Fully opaque bodies must therefore state
        // a scalar opacity and leave the texture's alpha channel unwired.
        if (dither) {
          // Fallback mode (USDZ_DITHER): alpha-MASKED reads as opaque and
          // writes depth while discarding a pixel pattern. Rejected as the
          // default - the pattern read as grain at phone distance.
          L.push(`                float inputs:opacity.connect = ${base}/mask.outputs:a>`);
          L.push('                float inputs:opacityThreshold = 0.5');
        } else {
          // Scalar (value-based) opacity: 1 stays truly opaque and writes
          // depth; a body's 0.6 goes to the blended queue - intended, that
          // IS the translucency, the same number as the app's BODY_ALPHA_3D.
          L.push(`                float inputs:opacity = ${surf.a.toFixed(3)}`);
        }
      } else {
        L.push(`                color3f inputs:emissiveColor = ${usdVec(surf.r * surf.a, surf.g * surf.a, surf.b * surf.a, 4)}`); // premultiplied, same as the ramp
        L.push(`                float inputs:opacity = ${surf.a.toFixed(3)}`);
      }
      L.push('                float inputs:metallic = 0');
      L.push('                float inputs:roughness = 1');
      // Without this the room still lays a specular sheen over the emission,
      // which is the whitening that started this whole hunt.
      L.push('                int inputs:useSpecularWorkflow = 1');
      L.push('                color3f inputs:specularColor = (0, 0, 0)');
      L.push('                float inputs:ior = 1');
    } else {
      // Physically lit: the base and the metals.
      if (tex) {
        L.push(`                color3f inputs:diffuseColor.connect = ${base}/tex.outputs:rgb>`);
        // Same trap as above - the opaque marble base must not be wired to an
        // alpha channel, or it joins the blended queue and stops occluding.
        if (surf.a >= 0.999) {
          L.push('                float inputs:opacity = 1');
        } else {
          L.push(`                float inputs:opacity.connect = ${base}/tex.outputs:a>`);
        }
      } else {
        L.push(`                color3f inputs:diffuseColor = ${usdVec(surf.r, surf.g, surf.b, 4)}`);
        L.push(`                float inputs:opacity = ${surf.a.toFixed(3)}`);
      }
      // emissiveColor is NOT multiplied by opacity. On an alpha-CUTOUT texture
      // the geometry is a padded rectangle whose silhouette exists only in the
      // alpha channel, so a flat emissive term paints the whole rectangle -
      // transparent parts included - and drags a ghost plane through the piece.
      L.push(`                color3f inputs:emissiveColor = ${cutout ? '(0, 0, 0)' : usdVec(surf.r * e, surf.g * e, surf.b * e, 4)}`);
      L.push(`                float inputs:metallic = ${surf.metallic.toFixed(3)}`);
      L.push(`                float inputs:roughness = ${surf.roughness.toFixed(3)}`);
    }
    L.push('                token outputs:surface');
    L.push('            }');
    L.push('        }');
  });
  L.push('    }');

  parts.forEach((part, i) => {
    const counts = [];
    const idx = [];
    // Winding is decided PER MESH by its own signed volume (see
    // windingIsOutward) rather than by a single global rule. The file mixes
    // DOUBLESIDE and FRONTSIDE builders, so no one rule is right for all of
    // them - which is exactly why guessing kept fixing one set of shapes and
    // breaking another.
    for (let t = 0; t + 2 < part.indices.length; t += 3) {
      counts.push(3);
      if (part.flipWinding) idx.push(part.indices[t], part.indices[t + 2], part.indices[t + 1]);
      else idx.push(part.indices[t], part.indices[t + 1], part.indices[t + 2]);
    }
    const pts = [];
    for (let k = 0; k < part.pts.length; k += 3) {
      pts.push(usdVec(part.pts[k], part.pts[k + 1], part.pts[k + 2], 4));
    }
    // `prepend apiSchemas = ["MaterialBindingAPI"]` is NOT optional: without
    // it a strict consumer ignores `rel material:binding` outright and
    // renders the whole model in default grey.
    L.push(`    def Mesh "mesh_${i}" (`);
    L.push('        prepend apiSchemas = ["MaterialBindingAPI"]');
    L.push('    )');
    L.push('    {');
    L.push(`        uniform token subdivisionScheme = "none"`); // otherwise Quick Look smooths every hard edge away
    L.push('        uniform bool doubleSided = true'); // `1` is int-typed in strict USDA parsers
    L.push(`        float3[] extent = [${usdVec(part.min.x, part.min.y, part.min.z, 4)}, ${usdVec(part.max.x, part.max.y, part.max.z, 4)}]`);
    L.push(`        int[] faceVertexCounts = [${counts.join(', ')}]`);
    L.push(`        int[] faceVertexIndices = [${idx.join(', ')}]`);
    L.push(`        point3f[] points = [${pts.join(', ')}]`);
    if (part.st) {
      const uv = [];
      for (let k = 0; k < part.st.length; k += 2) {
        uv.push(`(${part.st[k].toFixed(4)}, ${part.st[k + 1].toFixed(4)})`);
      }
      L.push(`        texCoord2f[] primvars:st = [${uv.join(', ')}] (`);
      L.push('            interpolation = "vertex"');
      L.push('        )');
    }
    // Second UV set, read only by the cutout mask - it tiles at a real world
    // scale and has nothing to do with the colour ramp's 1-D lookup.
    if (part.st1) {
      const uv = [];
      for (let k = 0; k < part.st1.length; k += 2) {
        uv.push(`(${part.st1[k].toFixed(3)}, ${part.st1[k + 1].toFixed(3)})`);
      }
      L.push(`        texCoord2f[] primvars:st1 = [${uv.join(', ')}] (`);
      L.push('            interpolation = "vertex"');
      L.push('        )');
    }
    L.push(`        rel material:binding = </Sculpture/Materials/${part.matName}>`);
    L.push('    }');
  });

  L.push('}');
  L.push('');
  return { usda: L.join('\n'), textures };
}

// ===== AR diagnostic grid =====
// Nine identical green cubes, each built with ONE different material or
// geometry recipe, on an opaque slab. Exists because remote diagnosis from
// photos kept failing: several recipes produce superficially similar
// symptoms, and only seeing them SIDE BY SIDE in one frame, one lighting,
// one angle, separates them. The cube that looks like the app's translucency
// (every face visible, evenly tinted) names the recipe the real exporter
// should use.
//
// Layout: 3 columns x 3 rows on a slab. The tall corner POST marks the
// front-left corner; rows are told apart by cube HEIGHT (front row shortest,
// back row tallest), columns run left-to-right away from the post.
//
//   front (short):  A opaque control | B current recipe, flat | C current recipe, ramp tex
//   mid (medium):   D lit diffuse    | E emissive, no premult | F diffuse + weak emissive
//   back (tall):    G open-shape prism geom | H doubled winding | I tessellated
//   (G, H, I all use B's material - they vary GEOMETRY only.)
function buildDiagnosticUsda() {
  const C = { r: 0.15, g: 0.65, b: 0.35, a: 1 };
  const A = 0.6; // the body alpha under test
  // Outward-wound unit cube in USD space (verified by windingIsOutward).
  const P = [-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1, -1,-1,1, 1,-1,1, 1,1,1, -1,1,1];
  const OUT = [0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7];

  const L = [];
  L.push('#usda 1.0');
  L.push('(');
  L.push('    defaultPrim = "Diag"');
  L.push('    metersPerUnit = 1');
  L.push('    upAxis = "Y"');
  L.push(')');
  L.push('');
  L.push('def Xform "Diag"');
  L.push('{');
  L.push('    def Scope "Materials"');
  L.push('    {');

  const unlitTail = [
    'float inputs:metallic = 0',
    'float inputs:roughness = 1',
    'int inputs:useSpecularWorkflow = 1',
    'color3f inputs:specularColor = (0, 0, 0)',
    'float inputs:ior = 1'
  ];
  const vec = (c, k) => `(${(c.r * k).toFixed(4)}, ${(c.g * k).toFixed(4)}, ${(c.b * k).toFixed(4)})`;
  const mat = (name, lines, texture) => {
    L.push(`        def Material "${name}"`);
    L.push('        {');
    L.push(`            token outputs:surface.connect = </Diag/Materials/${name}/S.outputs:surface>`);
    if (texture) {
      L.push('            def Shader "st"');
      L.push('            {');
      L.push('                uniform token info:id = "UsdPrimvarReader_float2"');
      L.push('                token inputs:varname = "st"');
      L.push('                float2 outputs:result');
      L.push('            }');
      L.push('            def Shader "tex"');
      L.push('            {');
      L.push('                uniform token info:id = "UsdUVTexture"');
      L.push(`                asset inputs:file = @${texture}@`);
      L.push(`                float2 inputs:st.connect = </Diag/Materials/${name}/st.outputs:result>`);
      L.push('                token inputs:wrapS = "clamp"');
      L.push('                token inputs:wrapT = "clamp"');
      L.push('                float3 outputs:rgb');
      L.push('            }');
    }
    L.push('            def Shader "S"');
    L.push('            {');
    L.push('                uniform token info:id = "UsdPreviewSurface"');
    lines.forEach(l => L.push('                ' + l));
    L.push('                token outputs:surface');
    L.push('            }');
    L.push('        }');
  };

  // A: opaque unlit control - the "solid looked GOOD" recipe.
  mat('mA', ['color3f inputs:diffuseColor = (0, 0, 0)',
    `color3f inputs:emissiveColor = ${vec(C, 1)}`,
    'float inputs:opacity = 1'].concat(unlitTail));
  // B: the CURRENT body recipe, flat: blended 0.6, emissive premultiplied.
  mat('mB', ['color3f inputs:diffuseColor = (0, 0, 0)',
    `color3f inputs:emissiveColor = ${vec(C, A)}`,
    `float inputs:opacity = ${A}`].concat(unlitTail));
  // C: current recipe but emissive CONNECTED to the ramp texture (exact).
  mat('mC', ['color3f inputs:diffuseColor = (0, 0, 0)',
    'color3f inputs:emissiveColor.connect = </Diag/Materials/mC/tex.outputs:rgb>',
    `float inputs:opacity = ${A}`].concat(unlitTail), 'textures/ramp_diag.png');
  // D: lit translucent - diffuse carries the colour, no emission.
  mat('mD', [`color3f inputs:diffuseColor = ${vec(C, 1)}`,
    'color3f inputs:emissiveColor = (0, 0, 0)',
    `float inputs:opacity = ${A}`].concat(unlitTail));
  // E: emissive WITHOUT premultiply - tests whether alpha scales emission.
  mat('mE', ['color3f inputs:diffuseColor = (0, 0, 0)',
    `color3f inputs:emissiveColor = ${vec(C, 1)}`,
    `float inputs:opacity = ${A}`].concat(unlitTail));
  // F: hybrid - lit diffuse plus a weak emissive floor.
  mat('mF', [`color3f inputs:diffuseColor = ${vec(C, 1)}`,
    `color3f inputs:emissiveColor = ${vec(C, 0.25)}`,
    `float inputs:opacity = ${A}`].concat(unlitTail));
  // slab/post: opaque lit grey.
  mat('mSlab', ['color3f inputs:diffuseColor = (0.75, 0.74, 0.72)',
    'color3f inputs:emissiveColor = (0, 0, 0)',
    'float inputs:opacity = 1',
    'float inputs:metallic = 0',
    'float inputs:roughness = 0.6']);
  L.push('    }');

  // st runs bottom->top of each cube so the ramp shows as a gradient.
  const stFor = (pos) => {
    const st = [];
    for (let i = 0; i < pos.length; i += 3) st.push((pos[i + 1] + 1) / 2, 0.5);
    return st;
  };
  let meshId = 0;
  const emit = (matName, pos, idx, cx, cy, cz, sx, sy, sz, withSt) => {
    const pts = [], n = pos.length / 3;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const x = cx + pos[i * 3] * sx, y = cy + pos[i * 3 + 1] * sy, z = cz + pos[i * 3 + 2] * sz;
      pts.push(`(${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)})`);
      [x, y, z].forEach((v, k) => { if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; });
    }
    const counts = [], fi = [];
    for (let t = 0; t + 2 < idx.length; t += 3) { counts.push(3); fi.push(idx[t], idx[t + 1], idx[t + 2]); }
    L.push(`    def Mesh "m${meshId++}" (`);
    L.push('        prepend apiSchemas = ["MaterialBindingAPI"]');
    L.push('    )');
    L.push('    {');
    L.push('        uniform token subdivisionScheme = "none"');
    L.push('        uniform bool doubleSided = true');
    L.push(`        float3[] extent = [(${mn.map(v => v.toFixed(4)).join(', ')}), (${mx.map(v => v.toFixed(4)).join(', ')})]`);
    L.push(`        int[] faceVertexCounts = [${counts.join(', ')}]`);
    L.push(`        int[] faceVertexIndices = [${fi.join(', ')}]`);
    L.push(`        point3f[] points = [${pts.join(', ')}]`);
    if (withSt) {
      const st = stFor(pos), uv = [];
      for (let k = 0; k < st.length; k += 2) uv.push(`(${st[k].toFixed(3)}, ${st[k + 1].toFixed(3)})`);
      L.push(`        texCoord2f[] primvars:st = [${uv.join(', ')}] (`);
      L.push('            interpolation = "vertex"');
      L.push('        )');
    }
    L.push(`        rel material:binding = </Diag/Materials/${matName}>`);
    L.push('    }');
  };

  // Geometry variants for the back row - same material as B.
  // G: the open-shape pipeline's prism (polygonPrismGeometry + winding fix,
  // the same two functions the real exporter applies).
  const prism = polygonPrismGeometry([{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }], 2);
  if (windingIsOutward(prism.positions, prism.indices) === false) {
    const fixed = [];
    for (let t = 0; t + 2 < prism.indices.length; t += 3) {
      fixed.push(prism.indices[t], prism.indices[t + 2], prism.indices[t + 1]);
    }
    prism.indices = fixed;
  }
  // H: the closed-shape DOUBLESIDE case - both windings in one mesh.
  const doubled = OUT.slice();
  for (let t = 0; t + 2 < OUT.length; t += 3) doubled.push(OUT[t], OUT[t + 2], OUT[t + 1]);
  // I: the tessellation pass over the plain cube.
  const tess = tessellateForGradient({ positions: P, indices: OUT });

  const slabTop = 0.01;
  emit('mSlab', P, OUT, 0, slabTop / 2, 0, 0.19, slabTop / 2, 0.19);   // slab
  emit('mSlab', P, OUT, -0.17, 0.085, 0.17, 0.006, 0.075, 0.006);     // corner post, front-left
  const rows = [
    { z: 0.1, h: 0.03, cubes: [['mA', null], ['mB', null], ['mC', 'st']] },
    { z: 0.0, h: 0.045, cubes: [['mD', null], ['mE', null], ['mF', null]] },
    { z: -0.1, h: 0.06, cubes: [['mB', 'G'], ['mB', 'H'], ['mB', 'I']] }
  ];
  rows.forEach(row => {
    row.cubes.forEach((cube, col) => {
      const x = -0.1 + col * 0.1, y = slabTop + row.h;
      if (cube[1] === 'G') emit(cube[0], prism.positions, prism.indices, x, y, row.z, 0.03, row.h, 0.03);
      else if (cube[1] === 'H') emit(cube[0], P, doubled, x, y, row.z, 0.03, row.h, 0.03);
      else if (cube[1] === 'I') emit(cube[0], tess.positions, tess.indices, x, y, row.z, 0.03, row.h, 0.03);
      else emit(cube[0], P, OUT, x, y, row.z, 0.03, row.h, 0.03, cube[1] === 'st');
    });
  });
  L.push('}');
  L.push('');
  return L.join('\n');
}

window.launchARDiagnostic = function () {
  try {
    const usda = buildDiagnosticUsda();
    const files = [{ name: 'diag.usda', data: new TextEncoder().encode(usda) }];
    try {
      files.push({
        name: 'textures/ramp_diag.png',
        data: canvasToPngBytes(buildRampCanvas({ r: 0.15, g: 0.65, b: 0.35, a: 1 }, 0.6))
      });
    } catch (e) { console.warn('diag ramp failed', e); }
    const blob = buildZip(files, 64, 'model/vnd.usdz+zip');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.rel = 'ar';
    a.href = url;
    const img = document.createElement('img');
    img.style.display = 'none';
    a.appendChild(img);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 15000);
    if (typeof window.showArStatus === 'function') window.showArStatus('diagnostic grid · post marks front-left');
    return true;
  } catch (e) {
    console.warn('AR diagnostic failed:', e);
    return false;
  }
};

// Is this an iOS device at all? Every browser on iPhone/iPad is WKWebView
// underneath - Apple allows no other engine - so AR Quick Look is reachable
// from all of them even though only Safari advertises it. iPadOS 13+ lies
// and reports itself as "MacIntel", hence the touch-point check.
function isIOSDevice() {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

// Can this browser open a .usdz into AR? Capability check FIRST - that's the
// honest signal, and it's true in Safari on iOS. But Chrome/Edge/Firefox on
// iPhone don't report rel="ar" support despite being able to use it, so the
// capability check alone hides the button from every non-Safari browser on
// the one platform this feature exists for. The platform fallback covers
// them. Non-Safari iOS browsers hand off less reliably than Safari does;
// that's a real caveat, not a reason to hide the button from them.
window.isARQuickLookSupported = function () {
  const a = document.createElement('a');
  if (a.relList && a.relList.supports && a.relList.supports('ar')) return true;
  return isIOSDevice();
};

// Distinguishes the reliable path from the best-effort one, so the UI can
// say something useful if the handoff doesn't take.
window.isARNativeSafari = function () {
  const a = document.createElement('a');
  return !!(a.relList && a.relList.supports && a.relList.supports('ar'));
};

// Hands the sculpture to iOS's system AR viewer.
window.launchAR = function () {
  const blob = window.buildSculptureUSDZ();
  if (!blob) {
    console.warn('AR: nothing to export - enter 3D mode first');
    return false;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.rel = 'ar';
  a.href = url;
  // Quick Look REQUIRES the anchor to contain an <img>; without a child
  // image Safari navigates to the file instead of opening the AR viewer.
  const img = document.createElement('img');
  img.style.display = 'none';
  a.appendChild(img);
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 15000); // Quick Look reads the blob asynchronously - revoking early kills it
  return true;
};

// Returns a .usdz Blob of the current sculpture, or null if there's nothing
// to export.
window.buildSculptureUSDZ = function () {
  if (!babylonScene) return null;
  // Census before export: if something is missing in AR, this says whether
  // it was dropped on the way out or is present-but-not-rendering. Grouped
  // by name prefix, which is how every mesh in this file is categorised.
  const census = {};
  const bump = (bucket, key) => {
    census[key] = census[key] || { exported: 0, skipped: 0 };
    census[key][bucket]++;
  };
  babylonScene.meshes.forEach(m => {
    if (m.name.startsWith('skyFace_')) return;
    const key = (m.name.match(/^[a-zA-Z]+/) || ['other'])[0];
    const dropped = !m.isEnabled() || m.getTotalVertices() === 0 ||
      !!(m.metadata && m.metadata.skipExport);
    bump(dropped ? 'skipped' : 'exported', key);
  });
  console.log('USDZ mesh census (exported / skipped):',
    Object.entries(census).map(([k, v]) => `${k} ${v.exported}/${v.skipped}`).join('  '));

  const built = buildUsda();
  if (!built) return null;
  // Version stamp: makes it unambiguous from the phone whether the page that
  // built this model actually has the current fixes, rather than a cached one.
  console.log('USDZ exporter build: ' + USDZ_EXPORTER_BUILD);
  const data = new TextEncoder().encode(built.usda);
  const texBytes = built.textures.reduce((n, t) => n + t.data.length, 0);
  const mb = ((data.length + texBytes) / 1048576).toFixed(2);
  console.log(`USDZ: ${(data.length / 1048576).toFixed(2)} MB of USDA + ` +
    `${built.textures.length} textures (${(texBytes / 1048576).toFixed(2)} MB)`);
  if (typeof window.showArStatus === 'function') {
    window.showArStatus(`${USDZ_EXPORTER_BUILD} · ${mb} MB · ${built.textures.length} tex`);
  }
  // The .usda must be the FIRST entry - Quick Look opens the archive's first
  // file as the stage.
  return buildZip(
    [{ name: 'sculpture.usda', data }].concat(built.textures),
    64, 'model/vnd.usdz+zip'
  );
};
// Builds a solid prism (top cap + bottom cap + side walls) from a flat 2D
// polygon (local XY, closed loop not required) extruded +/- depth/2 along Z.
// Used to give "open" shapes real volume in the OBJ export, matching how
// every other shape has actual depth rather than a flat 0-thickness face.
function polygonPrismGeometry(poly2D, depth) {
  const n = poly2D.length;
  const half = depth / 2;
  const positions = [];
  const indices = [];
  // Top cap (z = +half), bottom cap (z = -half): fan triangulated
  for (let i = 0; i < n; i++) positions.push(poly2D[i].x, poly2D[i].y, half);
  for (let i = 0; i < n; i++) positions.push(poly2D[i].x, poly2D[i].y, -half);
  for (let i = 1; i + 1 < n; i++) indices.push(0, i, i + 1);               // top cap
  for (let i = 1; i + 1 < n; i++) indices.push(n, n + i + 1, n + i);       // bottom cap (reversed)
  // Side walls: one quad (2 triangles) per polygon edge
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const t0 = i, t1 = j, b0 = n + i, b1 = n + j;
    indices.push(t0, t1, b1, t0, b1, b0);
  }
  return { positions, indices };
}

function downloadZip(filename, files) {
  const blob = buildZip(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Exports every artwork mesh (skybox excluded) as a single OBJ + companion
// MTL, one material per mesh so each shape keeps its flat 2D color in Rhino.
// Axes are remapped so the piece opens standing upright facing the viewer in
// Rhino's FRONT view, not lying flat in Top view: Babylon's Y (2D "up") becomes
// Rhino Z (up), and Babylon's Z (camera depth/layering) becomes Rhino Y (the
// axis Front view looks along). This remap has the same net handedness flip
// as a straight left-handed -> right-handed conversion, so the same triangle
// winding reversal below keeps faces/normals correct.
// Colour bands per shape in the OBJ export - MTL's stand-in for the density
// gradient. Set to 1 to turn banding off and go back to one flat colour per
// shape, which some Rhino workflows prefer.
const OBJ_GRADIENT_BANDS = 6;

const EXPORT_OBJ_PASSWORD = '12345';

window.exportSceneToOBJ = function () {
  const entered = window.prompt('Enter password to export the 3D model:');
  if (entered === null) return; // cancelled
  if (entered !== EXPORT_OBJ_PASSWORD) {
    alert('Incorrect password.');
    return;
  }

  if (!babylonScene) {
    console.warn('No 3D scene to export yet - enter 3D mode first');
    return;
  }
  const meshes = collectExportMeshes();
  if (meshes.length === 0) {
    console.warn('Nothing to export - no artwork meshes found');
    return;
  }

  // Unique, matching filenames every export - if the .obj always said
  // "mtllib scene.mtl" but you'd already downloaded one before, the browser
  // saves the new one as "scene (1).mtl" and the .obj silently points at a
  // file that no longer matches, so Rhino can't find it and every shape
  // falls back to flat grey. A timestamp keeps every pair self-consistent.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const objFilename = `genex-3d-${stamp}.obj`;
  const mtlFilename = `genex-3d-${stamp}.mtl`;

  const objLines = ['# GenEx 3D export', `mtllib ${mtlFilename}`, ''];
  const mtlLines = [];
  let vertexOffset = 0;
  const seenColors = new Map(); // dedupe identical colors into one material

  meshes.forEach((mesh, mi) => {
    mesh.computeWorldMatrix(true);
    const world = mesh.getWorldMatrix();

    // "Open" shapes (openRect/openTriangle/openSemiCircle) tag their front
    // plane with the true polygon footprint - plain OBJ/MTL can't carry the
    // texture-alpha silhouette, so use the real shape outline (extruded into
    // an actual solid prism, matching the real depth every other shape has)
    // instead of the full padded rectangle the plane mesh actually is
    const { positions, indices } = exportGeometryFor(mesh);
    if (!positions || !indices || indices.length < 3) return;

    const { c, a } = meshExportColor(mesh);
    const colorKey = `${c.r.toFixed(3)}_${c.g.toFixed(3)}_${c.b.toFixed(3)}_${a.toFixed(2)}`;
    let matName = seenColors.get(colorKey);
    if (!matName) {
      matName = `mat_${seenColors.size}`;
      seenColors.set(colorKey, matName);
      mtlLines.push(
        `newmtl ${matName}`,
        `Kd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}`,
        `Ka 0 0 0`,
        `Ks 0 0 0`,
        `d ${a.toFixed(3)}`,
        `illum 1`,
        ''
      );
    }

    // Both "o" (object) and "g" (group) tags: Rhino's OBJ import dialog can
    // optionally split objects into separate layers by object/group/material,
    // so each shape stays independently selectable/colorable either way
    const objName = `${mesh.name.replace(/\s+/g, '_')}_${mi}`;
    objLines.push(`o ${objName}`, `g ${objName}`, `usemtl ${matName}`);

    const vertCount = positions.length / 3;
    for (let i = 0; i < vertCount; i++) {
      const p = BABYLON.Vector3.TransformCoordinates(
        new BABYLON.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]),
        world
      );
      // Stand the piece up for Rhino's Front view: Rhino Y = Babylon Z (depth),
      // Rhino Z = Babylon Y (up)
      objLines.push(`v ${p.x.toFixed(5)} ${p.z.toFixed(5)} ${p.y.toFixed(5)}`);
    }

    // MTL has no per-vertex colour, so the density gradient is approximated by
    // binning each TRIANGLE by the `t` of its centroid into a few bands and
    // switching material between them. The seenColors map dedupes across the
    // whole scene, so this costs ~OBJ_GRADIENT_BANDS materials per distinct
    // colour, not per mesh - and Rhino's "split by material" import then
    // gives real, separately selectable colour bands on a physical piece.
    const bandField = (OBJ_GRADIENT_BANDS > 1 && mesh.metadata && mesh.metadata.volumeGradient
      && indices.length / 3 >= 24) ? densityField(positions) : null;
    const bandMat = (t) => {
      const band = Math.min(OBJ_GRADIENT_BANDS - 1, Math.floor(t * OBJ_GRADIENT_BANDS));
      const bc = densityColorAt({ r: c.r, g: c.g, b: c.b, a },
        (band + 0.5) / OBJ_GRADIENT_BANDS);
      const key = `${bc.r.toFixed(3)}_${bc.g.toFixed(3)}_${bc.b.toFixed(3)}_${a.toFixed(2)}`;
      let nm = seenColors.get(key);
      if (!nm) {
        nm = `mat_${seenColors.size}`;
        seenColors.set(key, nm);
        mtlLines.push(
          `newmtl ${nm}`,
          `Kd ${bc.r.toFixed(4)} ${bc.g.toFixed(4)} ${bc.b.toFixed(4)}`,
          `Ka 0 0 0`, `Ks 0 0 0`, `d ${a.toFixed(3)}`, `illum 1`, ''
        );
      }
      return nm;
    };

    let currentMat = matName;
    for (let i = 0; i + 2 < indices.length; i += 3) {
      // Reverse winding to match the Z negation above (keeps faces/normals correct)
      const a1 = indices[i] + 1 + vertexOffset;
      const b1 = indices[i + 1] + 1 + vertexOffset;
      const c1 = indices[i + 2] + 1 + vertexOffset;
      if (bandField) {
        let t = 0;
        for (let k = 0; k < 3; k++) {
          const vi = indices[i + k] * 3;
          t += densityAt(bandField, positions[vi], positions[vi + 1], positions[vi + 2]);
        }
        const want = bandMat(t / 3);
        if (want !== currentMat) { objLines.push(`usemtl ${want}`); currentMat = want; }
      }
      objLines.push(`f ${a1} ${c1} ${b1}`);
    }

    vertexOffset += vertCount;
  });

  // ONE zip download (not two separate file downloads) - browsers silently
  // block a page's second auto-triggered download, which meant the .mtl
  // (all the color data) was never actually reaching disk before
  const encoder = new TextEncoder();
  downloadZip(`genex-3d-${stamp}.zip`, [
    { name: objFilename, data: encoder.encode(objLines.join('\n') + '\n') },
    { name: mtlFilename, data: encoder.encode(mtlLines.join('\n') + '\n') }
  ]);
  console.log(`Exported ${meshes.length} meshes to genex-3d-${stamp}.zip (unzip, then import the .obj into Rhino)`);
};

console.log('✅ babylon3D.js loaded!');
