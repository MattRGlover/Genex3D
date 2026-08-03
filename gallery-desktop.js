// Desktop Gallery JavaScript - Pinterest-style Masonry Layout
// Optimized for desktop viewing with responsive columns

console.log('🖥️ Desktop Gallery loading...');

// Firebase and gallery state
let db, storage;
let p5Instance = null;
let currentReport = null;
let galleryListener = null;
let isLoading = false;

// Desktop-specific settings
const DESKTOP_COLUMN_WIDTH = 300;
const DESKTOP_GAP = 20;
const DESKTOP_MODAL_MAX_WIDTH = '90vw';
const DESKTOP_MODAL_MAX_HEIGHT = '90vh';

// DOM elements
const galleryGrid = document.getElementById('gallery-grid');
const modal = document.getElementById('redraw-modal');
const modalContent = document.getElementById('redraw-canvas');
const closeButton = document.querySelector('.close-button');
const downloadStandardBtn = document.getElementById('download-hd');
const downloadHiResBtn = document.getElementById('download-4k');

// Initialize Firebase and load gallery
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Initialize Firebase
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();
    storage = firebase.storage();
    
    console.log('🔥 Firebase initialized for desktop gallery');
    setupRealtimeDesktopGallery();
  } catch (error) {
    console.error('❌ Error initializing desktop gallery:', error);
    galleryGrid.innerHTML = '<div class="error-item">Failed to load gallery. Please try again.</div>';
  }
});

// Set up real-time Firebase listener for desktop gallery
function setupRealtimeDesktopGallery() {
  console.log('🖥️ Setting up real-time desktop gallery sync...');
  
  try {
    // Try multiple collection names for compatibility
    const collectionNames = ['sceneReports', 'scene_reports'];
    const orderFields = ['createdAt', 'timestamp'];
    
    for (const collectionName of collectionNames) {
      console.log(`🖥️ Trying real-time listener for collection: ${collectionName}`);
      
      for (const orderField of orderFields) {
        try {
          galleryListener = db.collection(collectionName)
            .orderBy(orderField, 'desc')
            .limit(100) // More items for desktop masonry
            .onSnapshot((querySnapshot) => {
              console.log('🔄 Desktop gallery data changed - reorganizing masonry...');
              console.log(`📊 Query snapshot details:`, {
                empty: querySnapshot.empty,
                size: querySnapshot.size,
                docs: querySnapshot.docs.length
              });
              
              // Debug: Log each document
              querySnapshot.docs.forEach((doc, index) => {
                const data = doc.data();
                console.log(`📄 Document ${index + 1} (${doc.id}):`, {
                  hasPixelBitmap: !!data.pixelBitmap,
                  pixelBitmapType: Array.isArray(data.pixelBitmap) ? 'array' : typeof data.pixelBitmap,
                  hasPixelBitmapUrl: !!data.pixelBitmapUrl,
                  createdAt: data.createdAt,
                  canvasWidth: data.canvasWidth,
                  canvasHeight: data.canvasHeight,
                  keys: Object.keys(data).slice(0, 10) // First 10 keys
                });
              });
              
              if (querySnapshot.empty) {
                console.log('⚠️ No documents found in Firebase query');
                galleryGrid.innerHTML = '<div class="error-item">No artwork found in the gallery yet. Go create some!</div>';
                return;
              }
              
              console.log(`✅ Desktop masonry sync active - processing ${querySnapshot.docs.length} compositions`);
              renderDesktopMasonryGallery(querySnapshot);
            }, (error) => {
              console.error('⚠️ Real-time listener failed:', error);
              throw error;
            });
          
          console.log(`✅ Successfully connected to ${collectionName} with ${orderField}`);
          return; // Success, exit loops
          
        } catch (orderError) {
          console.log(`⚠️ Failed to order by ${orderField}:`, orderError.message);
          continue;
        }
      }
    }
    
    throw new Error('All collection and order field combinations failed');
    
  } catch (error) {
    console.error('❌ Error setting up real-time desktop gallery sync:', error);
    // Fallback to sample data
    createSampleDesktopThumbnails();
  }
}

// Render desktop gallery with Pinterest-style masonry layout
async function renderDesktopMasonryGallery(querySnapshot) {
  console.log('🖥️ Rendering desktop masonry gallery with real-time data...');
  
  if (isLoading) {
    console.log('⚠️ Gallery is already loading, skipping duplicate render');
    return;
  }
  
  isLoading = true;
  
  try {
    // Clear existing gallery
    galleryGrid.innerHTML = '';
    
    // Process each document
    const promises = querySnapshot.docs.map(async (doc, index) => {
      const data = doc.data();
      const docId = doc.id;
      
      console.log(`🎨 Processing composition ${index + 1}/${querySnapshot.docs.length}:`, docId);
      
      // Create gallery item
      const item = document.createElement('div');
      item.className = 'gallery-item';
      item.setAttribute('data-report', JSON.stringify(data));
      
      // Create canvas for thumbnail - maintain aspect ratio
      const canvas = document.createElement('canvas');
      
      // Determine canvas size based on original dimensions or default
      let canvasWidth = data.canvasWidth || 1200;
      let canvasHeight = data.canvasHeight || 900;
      
      // Scale to fit masonry column width while maintaining aspect ratio
      const aspectRatio = canvasHeight / canvasWidth;
      const thumbnailWidth = DESKTOP_COLUMN_WIDTH;
      const thumbnailHeight = Math.round(thumbnailWidth * aspectRatio);
      
      canvas.width = thumbnailWidth;
      canvas.height = thumbnailHeight;
      
      try {
        // Load thumbnail based on data type
        if (data.pixelBitmap && Array.isArray(data.pixelBitmap)) {
          console.log(`🖼️ Loading pixel bitmap thumbnail for ${docId}`);
          await loadDesktopPixelBitmapThumbnail(canvas, data.pixelBitmap, data.pixelBitmapSize);
        } else if (data.pixelBitmapUrl) {
          console.log(`🔗 Loading pixel bitmap from URL for ${docId}`);
          await loadDesktopPixelBitmapFromUrl(canvas, data.pixelBitmapUrl, data.pixelBitmapSize);
        } else {
          console.log(`🎨 Loading legacy thumbnail for ${docId}`);
          await loadLegacyDesktopThumbnail(canvas, data);
        }
        
        item.appendChild(canvas);
        console.log(`✅ Successfully loaded thumbnail for ${docId} (${thumbnailWidth}x${thumbnailHeight})`);
        
      } catch (error) {
        console.error(`❌ Error loading thumbnail for ${docId}:`, error);
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
    
    console.log(`✅ Desktop masonry gallery rendered with ${items.length} compositions`);
    
  } catch (error) {
    console.error('❌ Error rendering desktop masonry gallery:', error);
    galleryGrid.innerHTML = '<div class="error-item">Error loading gallery. Please refresh the page.</div>';
  } finally {
    isLoading = false;
  }
}

// Load pixel bitmap thumbnail optimized for desktop
async function loadDesktopPixelBitmapThumbnail(canvas, pixelBitmap, pixelBitmapSize) {
  try {
    const ctx = canvas.getContext('2d');
    
    // Debug pixel bitmap dimensions
    console.log('🔍 Pixel bitmap debug:', {
      pixelBitmapSize,
      pixelArrayLength: pixelBitmap.length,
      canvasSize: { width: canvas.width, height: canvas.height }
    });
    
    // Get original dimensions with better fallback handling
    let originalWidth, originalHeight;
    
    if (pixelBitmapSize && pixelBitmapSize.width && pixelBitmapSize.height) {
      originalWidth = pixelBitmapSize.width;
      originalHeight = pixelBitmapSize.height;
      console.log('✅ Using provided dimensions:', originalWidth, 'x', originalHeight);
    } else {
      // Calculate dimensions from pixel array length (assuming square-ish)
      const totalPixels = pixelBitmap.length;
      originalWidth = Math.sqrt(totalPixels);
      originalHeight = Math.sqrt(totalPixels);
      console.log('⚠️ Estimating dimensions from pixel count:', originalWidth, 'x', originalHeight);
    }
    
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
    console.error('❌ Error loading desktop pixel bitmap thumbnail:', error);
    throw error;
  }
}

// Load pixel bitmap thumbnail from Firebase Storage URL for desktop
async function loadDesktopPixelBitmapFromUrl(canvas, pixelBitmapUrl, pixelBitmapSize) {
  try {
    console.log(`📥 Fetching pixel bitmap from URL: ${pixelBitmapUrl}`);
    
    // Fetch the pixel bitmap JSON from Firebase Storage
    const response = await fetch(pixelBitmapUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch pixel bitmap: ${response.status} ${response.statusText}`);
    }
    
    const pixelBitmapData = await response.json();
    console.log(`✅ Pixel bitmap fetched from URL:`, {
      width: pixelBitmapData.width,
      height: pixelBitmapData.height,
      pixelCount: pixelBitmapData.pixels?.length,
      captureMethod: pixelBitmapData.captureMethod
    });
    
    // Use the existing pixel bitmap rendering function
    await loadDesktopPixelBitmapThumbnail(canvas, pixelBitmapData.pixels, {
      width: pixelBitmapData.width,
      height: pixelBitmapData.height
    });
    
  } catch (error) {
    console.error('❌ Error loading pixel bitmap from URL:', error);
    throw error;
  }
}

// Load legacy thumbnail for desktop
async function loadLegacyDesktopThumbnail(canvas, report) {
  try {
    const ctx = canvas.getContext('2d');
    
    // Create placeholder with composition info
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Add border
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    
    // Add text
    ctx.fillStyle = '#64748b';
    ctx.font = '14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Legacy Composition', canvas.width / 2, canvas.height / 2 - 10);
    
    if (report.createdAt) {
      const date = new Date(report.createdAt.toDate ? report.createdAt.toDate() : report.createdAt);
      ctx.font = '12px Inter, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(date.toLocaleDateString(), canvas.width / 2, canvas.height / 2 + 15);
    }
    
  } catch (error) {
    console.error('❌ Error loading legacy desktop thumbnail:', error);
    throw error;
  }
}

// Modal and interaction handlers
function redrawDesktopArtwork(report, targetElement) {
  console.log('🖥️ Opening desktop modal preview...');
  
  currentReport = report; // Store for downloads
  
  // Show modal
  modal.classList.add('show');
  
  // Clear previous content
  modalContent.innerHTML = '';
  
  // Create canvas for modal
  const canvas = document.createElement('canvas');
  
  // Set canvas size based on modal constraints
  const maxWidth = window.innerWidth * 0.8;
  const maxHeight = window.innerHeight * 0.7;
  
  let canvasWidth = report.canvasWidth || 1200;
  let canvasHeight = report.canvasHeight || 900;
  
  // Scale to fit modal
  const scale = Math.min(maxWidth / canvasWidth, maxHeight / canvasHeight);
  canvas.width = canvasWidth * scale;
  canvas.height = canvasHeight * scale;
  
  modalContent.appendChild(canvas);
  
  // Load full-size preview
  if (report.pixelBitmap && Array.isArray(report.pixelBitmap)) {
    console.log('🖼️ Loading pixel bitmap array for modal');
    loadDesktopPixelBitmapThumbnail(canvas, report.pixelBitmap, report.pixelBitmapSize);
  } else if (report.pixelBitmapUrl) {
    console.log('🔗 Loading pixel bitmap from URL for modal');
    loadDesktopPixelBitmapFromUrl(canvas, report.pixelBitmapUrl, report.pixelBitmapSize);
  } else {
    console.log('🎨 Loading legacy composition for modal');
    loadLegacyDesktopThumbnail(canvas, report);
  }
}

// Event listeners
galleryGrid.addEventListener('click', (e) => {
  const item = e.target.closest('.gallery-item');
  if (item) {
    const reportString = item.getAttribute('data-report');
    if (reportString) {
      try {
        const report = JSON.parse(reportString);
        redrawDesktopArtwork(report, modalContent);
      } catch (error) {
        console.error('❌ Error parsing report data:', error);
      }
    }
  }
});

// Modal close handlers
closeButton.addEventListener('click', () => {
  modal.classList.remove('show');
});

modal.addEventListener('click', (e) => {
  if (e.target === modal) {
    modal.classList.remove('show');
  }
});

// Download handlers
downloadStandardBtn.addEventListener('click', () => {
  if (currentReport) {
    generateDesktopDownload(currentReport, 1, 'Standard');
  }
});

downloadHiResBtn.addEventListener('click', () => {
  if (currentReport) {
    generateDesktopDownload(currentReport, 4, 'Hi-Res');
  }
});

// Generate download for desktop
function generateDesktopDownload(report, scale, quality) {
  console.log(`🖥️ Generating ${quality} desktop download (${scale}x scale)...`);
  
  if (!report.pixelBitmap || !Array.isArray(report.pixelBitmap)) {
    alert('Download only available for pixel bitmap compositions');
    return;
  }
  
  // Create download canvas
  const canvas = document.createElement('canvas');
  const originalWidth = report.pixelBitmapSize?.width || 1200;
  const originalHeight = report.pixelBitmapSize?.height || 900;
  
  canvas.width = originalWidth * scale;
  canvas.height = originalHeight * scale;
  
  const ctx = canvas.getContext('2d');
  
  // Scale pixel bitmap
  const imageData = ctx.createImageData(canvas.width, canvas.height);
  
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const origX = Math.floor(x / scale);
      const origY = Math.floor(y / scale);
      const origIndex = origY * originalWidth + origX;
      
      if (origIndex < report.pixelBitmap.length) {
        const hex = report.pixelBitmap[origIndex];
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
  
  // Download
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kandinsky-${quality.toLowerCase()}-${canvas.width}x${canvas.height}-${Date.now()}.png`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
    console.log(`✅ ${quality} desktop download complete`);
  }, 'image/png', 1.0);
}

// Utility function to convert hex to RGBA
function hexToRgba(hex) {
  if (!hex || typeof hex !== 'string') {
    return { r: 0, g: 0, b: 0, a: 255 };
  }
  
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Handle 3-digit hex
  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('');
  }
  
  // Handle 6-digit hex
  if (hex.length === 6) {
    return {
      r: parseInt(hex.substr(0, 2), 16),
      g: parseInt(hex.substr(2, 2), 16),
      b: parseInt(hex.substr(4, 2), 16),
      a: 255
    };
  }
  
  // Handle 8-digit hex (with alpha)
  if (hex.length === 8) {
    return {
      r: parseInt(hex.substr(0, 2), 16),
      g: parseInt(hex.substr(2, 2), 16),
      b: parseInt(hex.substr(4, 2), 16),
      a: parseInt(hex.substr(6, 2), 16)
    };
  }
  
  // Default fallback
  return { r: 0, g: 0, b: 0, a: 255 };
}

// Create sample thumbnails for testing
function createSampleDesktopThumbnails() {
  console.log('🖥️ Creating sample desktop thumbnails...');
  
  for (let i = 0; i < 12; i++) {
    const item = document.createElement('div');
    item.className = 'gallery-item';
    
    const canvas = document.createElement('canvas');
    const aspectRatio = 0.6 + Math.random() * 0.8; // Random aspect ratios
    canvas.width = DESKTOP_COLUMN_WIDTH;
    canvas.height = Math.round(DESKTOP_COLUMN_WIDTH * aspectRatio);
    
    const ctx = canvas.getContext('2d');
    
    // Create colorful sample
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, `hsl(${Math.random() * 360}, 70%, 60%)`);
    gradient.addColorStop(1, `hsl(${Math.random() * 360}, 70%, 40%)`);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Add sample text
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Sample ${i + 1}`, canvas.width / 2, canvas.height / 2);
    
    item.appendChild(canvas);
    galleryGrid.appendChild(item);
  }
  
  console.log('✅ Sample desktop thumbnails created');
}

// Clean up Firebase listener when page unloads
window.addEventListener('beforeunload', () => {
  if (galleryListener) {
    console.log('🧹 Cleaning up desktop gallery Firebase listener');
    galleryListener();
  }
});

console.log('✅ Desktop gallery JavaScript loaded');
