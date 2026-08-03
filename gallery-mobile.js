// Mobile Gallery JavaScript
// Optimized for touch interactions and mobile performance

console.log('🎨 Mobile Gallery loading...');

// Firebase and gallery state
let db, storage;
let p5Instance = null;
let currentReport = null;

// Mobile-specific settings for Pinterest-style masonry
const MOBILE_COLUMN_WIDTH = 160; // Base column width for mobile
const MOBILE_GAP = 12;
const MOBILE_MODAL_MAX_WIDTH = '95vw';
const MOBILE_MODAL_MAX_HEIGHT = '90vh';

// DOM elements
const galleryGrid = document.getElementById('gallery-grid');
const modal = document.getElementById('redraw-modal');
const modalContent = document.getElementById('redraw-content');
const closeButton = document.querySelector('.close-button');
const downloadStandardBtn = document.getElementById('download-standard');
const downloadHiResBtn = document.getElementById('download-hires');

// Initialize Firebase and load gallery
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Initialize Firebase
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();
    storage = firebase.storage();
    
    console.log('🔥 Firebase initialized for mobile gallery');
    await loadGallery();
  } catch (error) {
    console.error('❌ Error initializing mobile gallery:', error);
    galleryGrid.innerHTML = '<div class="error">Failed to load gallery. Please try again.</div>';
  }
});

// Load and display gallery compositions
async function loadGallery() {
  try {
    
    const collectionNames = ['sceneReports', 'scene_reports'];
    const orderFields = ['createdAt', 'timestamp'];
    
    for (const collectionName of collectionNames) {
      console.log(`📱 Trying real-time listener for collection: ${collectionName}`);
      
      for (const orderField of orderFields) {
        try {
          // Set up real-time listener
          galleryListener = db.collection(collectionName)
            .orderBy(orderField, 'desc')
            .limit(20)
            .onSnapshot((querySnapshot) => {
              console.log('🔄 Firebase data changed - reorganizing gallery...');
              
              // Clear existing content
              galleryGrid.innerHTML = '';
              
              if (querySnapshot.empty) {
                showSampleThumbnails();
                return;
              }
              
              console.log(`✅ Real-time sync active for collection: ${collectionName}`);
              renderGalleryItems(querySnapshot);
            }, (error) => {
              console.log(`⚠️ Real-time listener failed for ${collectionName} with ${orderField}:`, error.message);
              throw error;
            });
          
          // If we get here, the listener was set up successfully
          return;
          
        } catch (error) {
          console.log(`⚠️ Failed to set up listener for ${collectionName} with ${orderField}:`, error.message);
          continue;
        }
      }
    }
    
    // Fallback to sample thumbnails if no real-time listener could be set up
    console.log('📱 No Firebase connection, showing sample thumbnails');
    showSampleThumbnails();
    
  } catch (error) {
    console.error('❌ Error setting up real-time gallery sync:', error);
    showSampleThumbnails();
  }
}

// Render mobile gallery with Pinterest-style masonry layout
async function renderGalleryItems(querySnapshot) {
  console.log('📱 Rendering mobile masonry gallery...');
  
  if (isLoading) {
    console.log('⚠️ Mobile gallery is already loading, skipping duplicate render');
    return;
  }
  
  isLoading = true;
  
  try {
    // Clear existing gallery
    galleryGrid.innerHTML = '';
    
    // Calculate column width based on screen size
    const screenWidth = window.innerWidth;
    let columnWidth = MOBILE_COLUMN_WIDTH;
    
    if (screenWidth < 480) {
      columnWidth = screenWidth - 32; // Single column on very small screens
    } else if (screenWidth >= 600) {
      columnWidth = (screenWidth - 64) / 3; // Three columns on larger mobile screens
    } else {
      columnWidth = (screenWidth - 40) / 2; // Two columns on standard mobile
    }
    
    // Process each document
    const promises = querySnapshot.docs.map(async (doc, index) => {
      const data = doc.data();
      const docId = doc.id;
      
      console.log(`🎨 Processing mobile composition ${index + 1}/${querySnapshot.docs.length}:`, docId);
      
      // Create gallery item
      const item = document.createElement('div');
      item.className = 'gallery-item';
      item.setAttribute('data-report', JSON.stringify(data));
      
      // Create canvas for thumbnail - maintain aspect ratio
      const canvas = document.createElement('canvas');
      
      // Determine canvas size based on original dimensions or default
      let canvasWidth = data.canvasWidth || 1200;
      let canvasHeight = data.canvasHeight || 900;
      
      // Scale to fit column width while maintaining aspect ratio
      const aspectRatio = canvasHeight / canvasWidth;
      const thumbnailWidth = Math.floor(columnWidth);
      const thumbnailHeight = Math.round(thumbnailWidth * aspectRatio);
      
      canvas.width = thumbnailWidth;
      canvas.height = thumbnailHeight;
      
      try {
        // Load thumbnail based on data type
        if (data.pixelBitmap && Array.isArray(data.pixelBitmap)) {
          console.log(`🖼️ Loading pixel bitmap thumbnail for ${docId}`);
          await loadMobilePixelBitmapThumbnail(canvas, data.pixelBitmap, data.pixelBitmapSize);
        } else if (data.pixelBitmapUrl) {
          console.log(`🔗 Loading pixel bitmap from URL for ${docId}`);
          await loadPixelBitmapThumbnailMobile(canvas, data.pixelBitmapUrl, data.pixelBitmapSize);
        } else {
          console.log(`🎨 Loading legacy thumbnail for ${docId}`);
          await loadLegacyThumbnailMobile(canvas, data);
        }
        
        item.appendChild(canvas);
        console.log(`✅ Successfully loaded mobile thumbnail for ${docId} (${thumbnailWidth}x${thumbnailHeight})`);
        
      } catch (error) {
        console.error(`❌ Error loading mobile thumbnail for ${docId}:`, error);
        // Create error placeholder with proper dimensions
        const errorDiv = document.createElement('div');
        errorDiv.className = 'loading-placeholder';
        errorDiv.textContent = 'Failed to load';
        errorDiv.style.width = `${thumbnailWidth}px`;
        errorDiv.style.height = `${thumbnailHeight}px`;
        item.appendChild(errorDiv);
      }
      
      return item;
    });
    
    // Wait for all thumbnails to load, then add to gallery
    const items = await Promise.all(promises);
    items.forEach(item => galleryGrid.appendChild(item));
    
    console.log(`✅ Mobile masonry gallery rendered with ${items.length} compositions`);
    
  } catch (error) {
    console.error('❌ Error rendering mobile gallery:', error);
    galleryGrid.innerHTML = '<div class="error-item">Error loading gallery. Please refresh the page.</div>';
  } finally {
    isLoading = false;
  }
}

// Load pixel bitmap thumbnail optimized for mobile masonry
async function loadMobilePixelBitmapThumbnail(canvas, pixelBitmap, pixelBitmapSize) {
  try {
    const ctx = canvas.getContext('2d');
    
    // Get original dimensions
    const originalWidth = pixelBitmapSize?.width || Math.sqrt(pixelBitmap.length * (4/3));
    const originalHeight = pixelBitmapSize?.height || (pixelBitmap.length / originalWidth);
    
    // Calculate scale factors
    const scaleX = canvas.width / originalWidth;
    const scaleY = canvas.height / originalHeight;
    
    // Create ImageData for the scaled canvas
    const imageData = ctx.createImageData(canvas.width, canvas.height);
    
    // Scale and copy pixel data
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        // Map back to original coordinates
        const origX = Math.floor(x / scaleX);
        const origY = Math.floor(y / scaleY);
        const origIndex = origY * originalWidth + origX;
        
        if (origIndex < pixelBitmap.length) {
          const hex = pixelBitmap[origIndex];
          const rgba = hexToRgba(hex);
          
          const canvasIndex = (y * canvas.width + x) * 4;
          imageData.data[canvasIndex] = rgba.r;
          imageData.data[canvasIndex + 1] = rgba.g;
          imageData.data[canvasIndex + 2] = rgba.b;
          imageData.data[canvasIndex + 3] = rgba.a;
        }
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
    
  } catch (error) {
    console.error('❌ Error loading mobile pixel bitmap thumbnail:', error);
    throw error;
  }
}

// Load direct pixel bitmap thumbnail for mobile (backward compatibility)
async function loadDirectPixelBitmapThumbnailMobile(canvas, pixelBitmap) {
  // Use the main mobile function with estimated size
  const estimatedSize = {
    width: Math.sqrt(pixelBitmap.length * (4/3)),
    height: pixelBitmap.length / Math.sqrt(pixelBitmap.length * (4/3))
  };
  return loadMobilePixelBitmapThumbnail(canvas, pixelBitmap, estimatedSize);
}

// Load thumbnail optimized for mobile
async function loadMobileThumbnail(canvas, report) {
  const ctx = canvas.getContext('2d');
  
  try {
    // Check for pixel bitmap data (version 2.0+)
    if (report.pixelBitmap && Array.isArray(report.pixelBitmap)) {
      // Direct pixel bitmap data available (new compositions)
      console.log(`🖼️ Loading direct mobile pixel bitmap thumbnail: ${report.pixelBitmap.length}`);
      await loadMobilePixelBitmapThumbnail(canvas, report.pixelBitmap, report.pixelBitmapSize);
    } else if (report.pixelBitmapUrl) {
      // Only Storage URL available (existing compositions) - fetch the data
      console.log(`🖼️ Loading mobile pixel bitmap from Storage URL`);
      await loadPixelBitmapThumbnailMobile(canvas, report.pixelBitmapUrl, report.pixelBitmapSize);
    } else {
      // Fallback for truly legacy compositions (no pixel bitmap at all)
      console.log('🎨 Loading legacy mobile thumbnail');
      await loadLegacyThumbnailMobile(canvas, report);
    }
    
  } catch (error) {
    console.error('❌ Error loading mobile thumbnail:', error);
    // Show error placeholder with better styling
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Add border
    ctx.strokeStyle = '#dee2e6';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
    
    // Add error text
    ctx.fillStyle = '#6c757d';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Loading...', canvas.width/2, canvas.height/2);
  }
}

// Legacy thumbnail loading for mobile
async function loadLegacyThumbnailMobile(canvas, report) {
  // Simplified legacy rendering for mobile performance
  const ctx = canvas.getContext('2d');
  
  // Fill with background color or gradient
  if (report.bgColor) {
    ctx.fillStyle = `rgb(${report.bgColor.levels[0]}, ${report.bgColor.levels[1]}, ${report.bgColor.levels[2]})`;
  } else {
    ctx.fillStyle = '#f0f0f0';
  }
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Add placeholder text
  ctx.fillStyle = '#666';
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Legacy', canvas.width/2, canvas.height/2);
}

// Mobile-optimized modal preview
function redrawArtworkMobile(report, targetElement) {
  console.log('📱 Opening mobile modal preview...');
  
  currentReport = report; // Store for downloads
  
  // Show modal
  modal.classList.add('show');
  
  // Clear previous content
  targetElement.innerHTML = '';
  
  // Create canvas for modal
  const canvas = document.createElement('canvas');
  
  // Set canvas size based on mobile modal constraints
  const maxWidth = window.innerWidth * 0.85;
  const maxHeight = window.innerHeight * 0.5;
  
  let canvasWidth = report.canvasWidth || 1200;
  let canvasHeight = report.canvasHeight || 900;
  
  // Scale to fit mobile modal while maintaining aspect ratio
  const scale = Math.min(maxWidth / canvasWidth, maxHeight / canvasHeight);
  canvas.width = Math.floor(canvasWidth * scale);
  canvas.height = Math.floor(canvasHeight * scale);
  
  targetElement.appendChild(canvas);
  
  // Load full-size preview
  if (report.pixelBitmap && Array.isArray(report.pixelBitmap)) {
    loadMobilePixelBitmapThumbnail(canvas, report.pixelBitmap, report.pixelBitmapSize);
  } else {
    loadLegacyThumbnailMobile(canvas, report);
  }
}

// Event listeners
galleryGrid.addEventListener('click', (e) => {
  const item = e.target.closest('.gallery-item');
  if (item) {
    const reportString = item.getAttribute('data-report');
    const report = JSON.parse(reportString);
    currentReport = report;
    
    console.log('📱 Opening mobile modal for:', report);
    modal.classList.add('show');
    redrawArtworkMobile(report, modalContent);
  }
});

closeButton.addEventListener('click', () => {
  if (p5Instance) {
    p5Instance.remove();
    p5Instance = null;
  }
  modal.classList.remove('show');
});

// Close modal on background click
modal.addEventListener('click', (e) => {
  if (e.target === modal) {
    closeButton.click();
  }
});

// Download functionality
downloadStandardBtn.addEventListener('click', () => {
  if (currentReport) {
    generateMobileDownload(currentReport, '1:1');
  }
});

downloadHiResBtn.addEventListener('click', () => {
  if (currentReport) {
    generateMobileDownload(currentReport, '4:1');
  }
});

// Mobile download generation
function generateMobileDownload(report, scale) {
  if (!report.pixelBitmap) {
    alert('Download not available for legacy compositions');
    return;
  }
  
  console.log(`📱 Generating mobile download at ${scale} scale`);
  
  const pixelBitmap = report.pixelBitmap;
  const originalWidth = pixelBitmap.length / Math.sqrt(pixelBitmap.length * (4/3));
  const originalHeight = pixelBitmap.length / originalWidth;
  
  let canvasWidth, canvasHeight;
  
  if (scale === '4:1') {
    canvasWidth = originalWidth * 4;
    canvasHeight = originalHeight * 4;
  } else {
    canvasWidth = originalWidth;
    canvasHeight = originalHeight;
  }
  
  // Create download canvas
  const downloadCanvas = document.createElement('canvas');
  downloadCanvas.width = canvasWidth;
  downloadCanvas.height = canvasHeight;
  const ctx = downloadCanvas.getContext('2d');
  
  // Render pixels
  const imageData = ctx.createImageData(canvasWidth, canvasHeight);
  const data = imageData.data;
  
  for (let y = 0; y < originalHeight; y++) {
    for (let x = 0; x < originalWidth; x++) {
      const sourceIndex = y * originalWidth + x;
      const hexColor = pixelBitmap[sourceIndex];
      
      if (!hexColor) continue;
      
      const rgba = hexToRgba(hexColor);
      
      if (scale === '4:1') {
        // 4x4 pixel blocks
        for (let dy = 0; dy < 4; dy++) {
          for (let dx = 0; dx < 4; dx++) {
            const targetX = x * 4 + dx;
            const targetY = y * 4 + dy;
            const targetIndex = (targetY * canvasWidth + targetX) * 4;
            
            data[targetIndex] = rgba.r;
            data[targetIndex + 1] = rgba.g;
            data[targetIndex + 2] = rgba.b;
            data[targetIndex + 3] = rgba.a;
          }
        }
      } else {
        // 1:1 scale
        const targetIndex = (y * canvasWidth + x) * 4;
        data[targetIndex] = rgba.r;
        data[targetIndex + 1] = rgba.g;
        data[targetIndex + 2] = rgba.b;
        data[targetIndex + 3] = rgba.a;
      }
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  // Download
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
  const filename = `kandinsky-mobile-${scale === '4:1' ? 'hi-res' : 'standard'}-${canvasWidth}x${canvasHeight}-${timestamp}.png`;
  
  downloadCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log(`✅ Mobile download complete: ${filename}`);
  });
}

// Utility function
function hexToRgba(hex) {
  if (!hex || !hex.startsWith('#')) {
    return { r: 255, g: 255, b: 255, a: 255 };
  }
  
  const cleanHex = hex.slice(1);
  
  if (cleanHex.length === 8) {
    return {
      r: parseInt(cleanHex.slice(0, 2), 16),
      g: parseInt(cleanHex.slice(2, 4), 16),
      b: parseInt(cleanHex.slice(4, 6), 16),
      a: parseInt(cleanHex.slice(6, 8), 16)
    };
  } else if (cleanHex.length === 6) {
    return {
      r: parseInt(cleanHex.slice(0, 2), 16),
      g: parseInt(cleanHex.slice(2, 4), 16),
      b: parseInt(cleanHex.slice(4, 6), 16),
      a: 255
    };
  }
  
  return { r: 255, g: 255, b: 255, a: 255 };
}

// Create sample thumbnails for testing when Firebase is not available
function createSampleThumbnails() {
  console.log('📱 Creating sample mobile thumbnails for testing');
  galleryGrid.innerHTML = '';
  
  // Create 6 sample thumbnails in 2x3 grid
  for (let i = 0; i < 6; i++) {
    const item = document.createElement('div');
    item.className = 'gallery-item';
    
    // Create sample report data
    const sampleReport = {
      timestamp: Date.now() - (i * 1000 * 60 * 60), // Different times
      canvasWidth: 1920,
      canvasHeight: 1080,
      bgColor: { levels: [200 + i * 10, 220 + i * 5, 240 + i * 3] }
    };
    
    item.setAttribute('data-report', JSON.stringify(sampleReport));
    
    // Create thumbnail canvas
    const canvas = document.createElement('canvas');
    canvas.width = MOBILE_THUMBNAIL_SIZE;
    canvas.height = Math.round(MOBILE_THUMBNAIL_SIZE * 9/16);
    
    // Draw sample content
    const ctx = canvas.getContext('2d');
    
    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, `hsl(${i * 60}, 70%, 80%)`);
    gradient.addColorStop(1, `hsl(${(i * 60 + 120) % 360}, 70%, 60%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Add some sample shapes
    ctx.fillStyle = `hsla(${(i * 60 + 180) % 360}, 80%, 50%, 0.7)`;
    ctx.beginPath();
    ctx.arc(canvas.width * 0.3, canvas.height * 0.4, 15, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = `hsla(${(i * 60 + 240) % 360}, 80%, 50%, 0.6)`;
    ctx.fillRect(canvas.width * 0.5, canvas.height * 0.3, 20, 25);
    
    // Add sample text
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Sample ${i + 1}`, canvas.width/2, canvas.height - 10);
    
    item.appendChild(canvas);
    galleryGrid.appendChild(item);
  }
  
  console.log('✅ Sample mobile thumbnails created');
}

console.log('✅ Mobile gallery JavaScript loaded');
