# Tesseract OCR Microservice

Free cloud-based OCR service using Tesseract.js

## Deployment Options

### Option 1: Render.app (Recommended)

1. Create account at https://render.com
2. Create new "Web Service"
3. Connect GitHub repo containing this folder
4. Set:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Deploy!

Your service URL will be: `https://your-service-name.onrender.com`

### Option 2: Railway.app

1. Create account at https://railway.app
2. Create new project from GitHub
3. Set environment:
   - Build: `npm install`
   - Start: `npm start`
4. Deploy!

### Option 3: Fly.io

1. Create account at https://fly.io
2. Install flyctl CLI
3. Run: `flyctl launch` in this directory
4. Deploy with: `flyctl deploy`

## API Usage

### Health Check

```bash
GET /health
```

Response:
```json
{
  "status": "healthy",
  "service": "tesseract-ocr"
}
```

### OCR Processing

```bash
POST /ocr
Content-Type: multipart/form-data

file: <binary PDF/JPG/PNG>
```

Response (Success):
```json
{
  "success": true,
  "text": "Extracted text from document...",
  "length": 1234,
  "confidence": 85
}
```

Response (Error):
```json
{
  "success": false,
  "error": "Error message"
}
```

## Integration with Laravel

Update your `ApplicationFormOcrService.php` to call this service:

```php
$response = Http::timeout(120)->post(
    config('services.tesseract.url') . '/ocr',
    ['file' => fopen($filePath, 'r')]
);

$data = $response->json();
$text = $data['text'] ?? '';
```

## Cost

- Render: **FREE** (750 hours/month)
- Railway: **FREE** ($5 credit/month)
- Fly.io: **FREE** (3 shared CPUs, 3GB RAM)

All within free tier limits!
