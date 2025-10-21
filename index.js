const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Tesseract = require('tesseract.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Multer setup for file uploads
const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPG, PNG allowed.'));
    }
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'tesseract-ocr' });
});

/**
 * Main OCR endpoint
 * POST /ocr
 * Body: { file: <binary> }
 */
app.post('/ocr', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    console.log(`[OCR] Processing file: ${req.file.originalname} (${req.file.mimetype})`);

    const filePath = req.file.path;

    // Check if file is PDF - Tesseract.js cannot handle PDFs
    if (req.file.mimetype === 'application/pdf') {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        error: 'PDF files not supported. Please send JPG or PNG instead.'
      });
    }

    // Run Tesseract.js
    const { data: { text } } = await Tesseract.recognize(
      filePath,
      'eng',
      {
        logger: (m) => console.log('[Tesseract]', m.progress || m.status)
      }
    );

    // Clean up uploaded file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    if (!text || text.trim().length === 0) {
      return res.json({
        success: true,
        text: '',
        warning: 'No text detected in document'
      });
    }

    console.log(`[OCR] Successfully extracted ${text.length} characters`);

    res.json({
      success: true,
      text: text,
      length: text.length,
      confidence: calculateConfidence(text)
    });

  } catch (error) {
    console.error('[OCR Error]', error.message);

    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        console.error('[Cleanup Error]', e.message);
      }
    }

    res.status(500).json({
      success: false,
      error: error.message || 'OCR processing failed'
    });
  }
});

/**
 * Quick confidence estimation based on text quality
 */
function calculateConfidence(text) {
  if (!text) return 0;

  // Simple heuristics:
  // - More text = higher confidence
  // - Fewer special chars = better
  // - Presence of common words = better

  let score = Math.min(100, (text.length / 100) * 10); // Base on length

  // Adjust for special characters (OCR errors often produce many symbols)
  const specialCharRatio = (text.match(/[^a-zA-Z0-9\s@.,-]/g) || []).length / text.length;
  score -= specialCharRatio * 20;

  // Bonus if common words detected
  const commonWords = ['the', 'and', 'member', 'application', 'name', 'email', 'address'];
  const foundWords = commonWords.filter(word => text.toLowerCase().includes(word)).length;
  score += (foundWords * 5);

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Error handler
 */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Tesseract OCR Service running on port ${PORT}`);
  console.log(`📝 POST /ocr - Upload file for OCR processing`);
  console.log(`💚 GET /health - Health check`);
});
