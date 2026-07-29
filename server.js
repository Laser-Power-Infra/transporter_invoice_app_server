import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || '1gTwzZ76i7saaiEiM_cd09LSL1IiAospQ';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.googleusercontent.com/a/macros/laserpowerinfra.com/echo?user_content_key=AUkAhnRbaozyyNWL9eu7_fIHDNLWMJWVPXGbo7VaSiXO5wYxvm8LyfJkvU5Kot7MhIFNQKvWm-A61v0hr5OJfR-WxqiAZyyzeyQmr-hV0_XE1-Mpfj_TqEoYT12KNBOnmPS8z_F2n7i5pommqswcxOcHccelol2Rb7yot5lPlTd3qfB-BGsHZNba9EqvOPqfxquHwnhLj4vJsqjEACTVmIHfxHgeD8Ty_lUS3wM4G_BkV8OirgS3UKeTVBIwU4Qt9H9qpjOTbPfnfYdnXvmHdY12ElqV_iF8sITaLhhRaOjXg-ii2ro0SKw&lib=MFM2aVIbH7o_Nh-tZ9ZBLaYEDlfBAFrHw';
const DELETE_SCRIPT_URL = process.env.DELETE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbxwEK3DeHneW-aPSLBijXkuGziaH3iW_pJ12itbxoMzydyOquuXbfxfa_viNoeCFbc9/exec';

// ---------- Google OAuth2 ----------
let credentials;
if (process.env.GOOGLE_CREDENTIALS) {
  try {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  } catch (err) {
    console.error('Failed to parse GOOGLE_CREDENTIALS from environment:', err.message);
  }
}

if (!credentials) {
  const credentialsPath = path.join(__dirname, 'credentials.json');
  if (fs.existsSync(credentialsPath)) {
    credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  } else {
    console.error('ERROR: Google credentials not found in env (GOOGLE_CREDENTIALS) or file (credentials.json).');
    process.exit(1);
  }
}

const oauth2Client = new google.auth.OAuth2(
  credentials.installed.client_id,
  credentials.installed.client_secret,
  credentials.installed.redirect_uris[0]
);

let token;
if (process.env.GOOGLE_TOKEN) {
  try {
    token = JSON.parse(process.env.GOOGLE_TOKEN);
  } catch (err) {
    console.error('Failed to parse GOOGLE_TOKEN from environment:', err.message);
  }
}

if (!token) {
  const tokenPath = path.join(__dirname, 'token.json');
  if (fs.existsSync(tokenPath)) {
    token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  } else {
    console.error('ERROR: Google token not found in env (GOOGLE_TOKEN) or file (token.json).');
    process.exit(1);
  }
}

oauth2Client.setCredentials(token);

// Auto-refresh and persist token
oauth2Client.on('tokens', (newTokens) => {
  if (newTokens.refresh_token) {
    console.log('New Google OAuth2 refresh token received:', newTokens.refresh_token);
  }
  const tokenPath = path.join(__dirname, 'token.json');
  try {
    let existing = {};
    if (fs.existsSync(tokenPath)) {
      existing = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    }
    fs.writeFileSync(tokenPath, JSON.stringify({ ...existing, ...newTokens }, null, 2));
    console.log('Saved updated tokens to token.json');
  } catch (err) {
    console.warn('Could not save refreshed token to token.json:', err.message);
  }
});

// ---------- Express app ----------
const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /api/data — proxy to Google Apps Script (no CORS server-to-server)
app.get('/api/data', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(APPS_SCRIPT_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Apps Script returned ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Data proxy error:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// POST /api/update-record — proxy record updates back to Google Sheets database
app.post('/api/update-record', async (req, res) => {
  try {
    const UPDATE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz7nbrvyjN39_D4eTDDB9A9nKS4hhLkcMXFoYT6WUxCDt9NGn1fBGBsavi6Sku1Ze3G/exec';
    
    console.log('\nSending update request to Google Sheets:', JSON.stringify(req.body, null, 2));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(UPDATE_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body),
      signal: controller.signal
    });
    
    clearTimeout(timeout);

    const result = await response.json();
    console.log('Apps Script update response:', result);
    
    res.json(result);
  } catch (err) {
    console.error('Update proxy error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /upload — upload PDF to Google Drive
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.pdf')) {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  }
});

app.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file provided' });
    }

    const invoiceNumber = req.body.invoiceNumber || 'UNKNOWN';
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const folderId = DRIVE_FOLDER_ID;

    // Upload file
    const fileMetadata = {
      name: req.file.originalname,
      parents: [folderId]
    };
    const media = {
      mimeType: req.file.mimetype,
      body: Readable.from(req.file.buffer)
    };

    const driveRes = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink, mimeType'
    });

    // Set sharing to Anyone with link (view)
    await drive.permissions.create({
      fileId: driveRes.data.id,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    console.log(`Uploaded: ${req.file.originalname} (${driveRes.data.id})`);

    res.json({
      success: true,
      fileUrl: driveRes.data.webViewLink,
      fileId: driveRes.data.id,
      filename: req.file.originalname,
      invoiceNumber: invoiceNumber
    });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- Google Sheets Write-Back Row Deletion ----------
async function deleteRowsFromSheet(sheetName, keyField, keyValue) {
  try {
    console.log(`Sending delete request to Google Apps Script: ${sheetName} | ${keyField} = ${keyValue}`);
    const response = await fetch(DELETE_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sheet: sheetName, keyField, keyValue })
    });
    
    const result = await response.json();
    console.log(`Apps Script response for ${sheetName}:`, result);
    
    if (result.success || result.status === 'success') {
      return true;
    }
    return false;
  } catch (e) {
    console.error('Delete request error:', e.message);
    return false;
  }
}

app.delete('/api/delete-invoice/:id', async (req, res) => {
  try {
    const invoiceNumber = req.params.id;
    console.log(`\nDeleting invoice ${invoiceNumber} from Google Sheets...`);
    
    // 1. Delete all matching shipment rows in Invoice_Items
    const deletedInvoices = await deleteRowsFromSheet('Invoice_Items', 'party_inv_no', invoiceNumber);
    
    // 2. Delete all matching purchase book records in Purchase_data
    const deletedPurchases = await deleteRowsFromSheet('Purchase_data', 'party_inv_no', invoiceNumber);
    
    res.json({
      success: true,
      message: `Deleted invoice "${invoiceNumber}" from Google Sheets.`,
      deletedInvoices,
      deletedPurchases
    });
  } catch (err) {
    console.error('Delete error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n  Invoice Dashboard Server`);
    console.log(`  ─────────────────────`);
    console.log(`  Data API:   http://localhost:${PORT}/api/data`);
    console.log(`  Upload API: http://localhost:${PORT}/upload`);
    console.log(`  Port:       ${PORT}\n`);
  });
}

export default app;
