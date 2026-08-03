// audio.js
// Contains all synthesizer and audio-related logic for the Kandinsky project.

let synth;
let audioInitialized = false;

// List of notes in a musical scale (e.g., C Major pentatonic)
const scale = ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5'];

// This function must be called by a user gesture (e.g., a click)
function initializeAudio() {
  if (audioInitialized) return;
  
  // Create a new PolySynth
  synth = new p5.PolySynth();
  
  // Basic synth settings
  synth.setADSR(0.05, 0.1, 0.5, 0.2);
  
  audioInitialized = true;
  console.log("Audio context initialized.");
}

// Plays a random note from the scale
function playSynthNote() {
  if (!audioInitialized || !synth) return;

  // Select a random note from the scale
  let note = random(scale);
  
  // Play the note with a random velocity and for a short duration
  synth.play(note, random(0.5, 1), 0, 0.2);
}

// This function can be called from the main sketch during drawing events
function triggerSound() {
  // Ensure audio is initialized before playing a note
  if (!audioInitialized) {
    initializeAudio();
  }
  playSynthNote();
}
