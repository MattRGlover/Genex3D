// —————————————————————————————————————
// SHAPE RECONSTRUCTION FROM SCENE REPORTS
// —————————————————————————————————————

/**
 * Renders a shape from scene report data for high-res image generation
 * This ensures consistency between Firebase reports and generated images
 */
function renderShapeFromReport(graphics, shapeReport, scaleFactor) {
  try {
    graphics.push();
    
    // Apply transformations
    graphics.translate(shapeReport.x * scaleFactor, shapeReport.y * scaleFactor);
    graphics.rotate(shapeReport.rot || 0);
    
    // Parse colors from hex strings
    const fillColor = parseColorFromHex(shapeReport.c);
    const strokeColor = parseColorFromHex(shapeReport.c2 || shapeReport.c);
    
    // Set basic properties
    graphics.fill(fillColor);
    graphics.stroke(0); // Always black stroke like original
    graphics.strokeWeight((shapeReport.sw || 2) * scaleFactor);
    
    const size = (shapeReport.targetSize || 50) * scaleFactor;
    
    // Render based on shape type and style
    if (shapeReport.type === 'concentricCircle') {
      renderConcentricCircleFromReport(graphics, shapeReport, size, scaleFactor);
    } else if (shapeReport.type === 'concentricArc') {
      renderConcentricArcFromReport(graphics, shapeReport, size, scaleFactor);
    } else if (shapeReport.style === 'halo') {
      renderHaloShapeFromReport(graphics, shapeReport, size, scaleFactor);
    } else if (shapeReport.style === 'open') {
      renderOpenShapeFromReport(graphics, shapeReport, size, scaleFactor);
    } else if (shapeReport.type === 'squiggle') {
      renderSquiggleFromReport(graphics, shapeReport, size, scaleFactor);
    } else if (shapeReport.type === 'arc') {
      renderArcFromReport(graphics, shapeReport, size);
    } else {
      // Default shape rendering (circle, rect, triangle, semiCircle)
      renderBasicShapeFromReport(graphics, shapeReport, size);
    }
    
    graphics.pop();
    
  } catch (error) {
    console.error('Error rendering shape from report:', error, shapeReport);
  }
}

/**
 * Parse color from hex string to p5.js color
 */
function parseColorFromHex(hexString) {
  if (!hexString || typeof hexString !== 'string') {
    return color(0, 0, 15, 0.8); // Default color
  }
  
  // Handle both #rrggbb and #rrggbbaa formats
  if (hexString.startsWith('#')) {
    const hex = hexString.slice(1);
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return color(r, g, b);
    } else if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16) / 255;
      return color(r, g, b, a);
    }
  }
  
  return color(0, 0, 15, 0.8); // Fallback
}

/**
 * Render basic shapes (circle, rect, triangle, semiCircle)
 */
function renderBasicShapeFromReport(graphics, shapeReport, size) {
  const fillColor = parseColorFromHex(shapeReport.c);
  graphics.fill(fillColor);
  
  switch (shapeReport.type) {
    case 'circle':
      graphics.circle(0, 0, size);
      break;
    case 'rect':
      graphics.rect(-size / 2, -size * 0.3, size, size * 0.6);
      break;
    case 'triangle':
      const hgt = size * sqrt(3) / 2;
      graphics.triangle(-size / 2, hgt / 3, size / 2, hgt / 3, 0, -2 * hgt / 3);
      break;
    case 'semiCircle':
      graphics.arc(0, 0, size, size, 0, PI);
      break;
    default:
      graphics.circle(0, 0, size); // Default to circle
  }
}

/**
 * Render open shapes with gradients
 */
function renderOpenShapeFromReport(graphics, shapeReport, size, scaleFactor) {
  const fillColor = parseColorFromHex(shapeReport.c);
  const transparentColor = color(hue(fillColor), saturation(fillColor), lightness(fillColor), 0);
  
  // Create gradient based on shape type
  let ctx = graphics.drawingContext;
  let lg;
  
  if (shapeReport.type === 'rect') {
    const w = size, h = size * 0.6;
    const gradientAngle = shapeReport.gradientAngle || 0;
    const dx = cos(gradientAngle), dy = sin(gradientAngle);
    
    lg = ctx.createLinearGradient(-w/4 * dx, -h/4 * dy, w/4 * dx, h/4 * dy);
    lg.addColorStop(0, fillColor.toString());
    lg.addColorStop(0.9, transparentColor.toString());
    lg.addColorStop(1, transparentColor.toString());
    
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w/2, -h/2, w, h);
    ctx.clip();
    ctx.fillStyle = lg;
    ctx.fillRect(-w/2, -h/2, w, h);
    ctx.restore();
    
    // Draw stroke (3 sides, leaving one open)
    graphics.noFill();
    graphics.stroke(0);
    graphics.strokeWeight(shapeReport.sw * scaleFactor);
    // Draw 3 sides of rectangle (simplified)
    graphics.line(-w/2, -h/2, w/2, -h/2); // top
    graphics.line(w/2, -h/2, w/2, h/2);   // right
    graphics.line(-w/2, -h/2, -w/2, h/2); // left
    
  } else if (shapeReport.type === 'triangle') {
    const hgt = size * sqrt(3) / 2;
    const vertices = [[-size/2, hgt/3], [size/2, hgt/3], [0, -2*hgt/3]];
    
    lg = ctx.createLinearGradient(0, -hgt/3, 0, hgt/3);
    lg.addColorStop(0, fillColor.toString());
    lg.addColorStop(0.9, transparentColor.toString());
    lg.addColorStop(1, transparentColor.toString());
    
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(vertices[0][0], vertices[0][1]);
    ctx.lineTo(vertices[1][0], vertices[1][1]);
    ctx.lineTo(vertices[2][0], vertices[2][1]);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = lg;
    ctx.fillRect(-size, -size, 2*size, 2*size);
    ctx.restore();
    
    // Draw stroke (2 sides, leaving one open)
    graphics.noFill();
    graphics.stroke(0);
    graphics.strokeWeight(shapeReport.sw * scaleFactor);
    graphics.line(vertices[0][0], vertices[0][1], vertices[2][0], vertices[2][1]);
    graphics.line(vertices[1][0], vertices[1][1], vertices[2][0], vertices[2][1]);
    
  } else if (shapeReport.type === 'semiCircle') {
    const r = size / 2;
    lg = ctx.createLinearGradient(0, r, 0, 0);
    lg.addColorStop(0, fillColor.toString());
    lg.addColorStop(0.9, transparentColor.toString());
    lg.addColorStop(1, transparentColor.toString());
    
    ctx.fillStyle = lg;
    graphics.noStroke();
    graphics.arc(0, 0, size, size, 0, PI);
    
    // Draw stroke outline
    graphics.stroke(0);
    graphics.strokeWeight(shapeReport.sw * scaleFactor);
    graphics.noFill();
    graphics.arc(0, 0, size, size, 0, PI);
  }
}

/**
 * Render concentric circles
 */
function renderConcentricCircleFromReport(graphics, shapeReport, size, scaleFactor) {
  graphics.noStroke();
  const scale = size / shapeReport.targetSize;
  
  for (let i = shapeReport.rings; i > 0; i--) {
    const d = i * shapeReport.diff * 2 * scale;
    const colorHex = shapeReport.concentricColors[i - 1];
    const ringColor = parseColorFromHex(colorHex);
    graphics.fill(ringColor);
    graphics.ellipse(0, 0, d, d);
  }
}

/**
 * Render concentric arcs
 */
function renderConcentricArcFromReport(graphics, shapeReport, size, scaleFactor) {
  graphics.noFill();
  graphics.strokeWeight(shapeReport.sw * scaleFactor);
  const scale = size / shapeReport.targetSize;
  
  for (let i = shapeReport.rings; i > 0; i--) {
    const d = i * shapeReport.diff * 2 * scale;
    const colorHex = shapeReport.concentricColors[i - 1];
    const ringColor = parseColorFromHex(colorHex);
    graphics.stroke(ringColor);
    graphics.arc(0, 0, d, d, shapeReport.arcStart, shapeReport.arcStart + shapeReport.arcSweep);
  }
}

/**
 * Render halo shapes
 */
function renderHaloShapeFromReport(graphics, shapeReport, size, scaleFactor) {
  const numCircles = shapeReport.rings;
  const maxRadius = size * 0.5;
  let ctx = graphics.drawingContext;
  
  for (let i = 0; i < numCircles; i++) {
    const radius = maxRadius * ((numCircles - i) / numCircles);
    const colorHex = shapeReport.haloColors[i];
    const circleColor = parseColorFromHex(colorHex);
    
    // Muted colors for both solid and gradient
    const finalColor = color(
      hue(circleColor), 
      saturation(circleColor) * 0.7, 
      lightness(circleColor) * 0.8, 
      0.8
    );
    
    if (i === 0) {
      // Outermost circle gets gradient surround
      const transparentColor = color(hue(finalColor), saturation(finalColor), lightness(finalColor), 0);
      let grad = ctx.createRadialGradient(0, 0, radius * 0.6, 0, 0, radius);
      grad.addColorStop(0, finalColor.toString());
      grad.addColorStop(1, transparentColor.toString());
      ctx.fillStyle = grad;
      graphics.noStroke();
      graphics.circle(0, 0, radius * 2);
    } else {
      // Inner circles are solid
      graphics.fill(finalColor);
      graphics.stroke(0);
      graphics.strokeWeight(shapeReport.sw * scaleFactor * 0.5);
      graphics.circle(0, 0, radius * 2);
    }
  }
}

/**
 * Render squiggle shapes
 */
function renderSquiggleFromReport(graphics, shapeReport, size, scaleFactor) {
  if (!shapeReport.sv || !Array.isArray(shapeReport.sv)) return;
  
  const fillColor = parseColorFromHex(shapeReport.c);
  graphics.noFill();
  graphics.stroke(fillColor);
  graphics.strokeWeight(shapeReport.sw * scaleFactor);
  
  graphics.beginShape();
  shapeReport.sv.forEach(p => {
    graphics.vertex(p.x * (size / shapeReport.targetSize), p.y * (size / shapeReport.targetSize));
  });
  graphics.endShape();
}

/**
 * Render arc shapes
 */
function renderArcFromReport(graphics, shapeReport, size) {
  const fillColor = parseColorFromHex(shapeReport.c);
  graphics.noFill();
  graphics.stroke(fillColor);
  graphics.strokeWeight(shapeReport.sw);
  graphics.arc(0, 0, size, size, shapeReport.arcStart, shapeReport.arcStart + shapeReport.arcSweep);
}
