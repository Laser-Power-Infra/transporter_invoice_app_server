import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

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

// Cache variables
let dataCache = null;
let dataCacheTime = 0;
const CACHE_TTL = 300000; // 5 minutes in milliseconds

// GET /api/data — proxy to Google Apps Script (no CORS server-to-server)
app.get('/api/data', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true' || req.query.forceRefresh === 'true';
    const now = Date.now();
    
    if (dataCache && (now - dataCacheTime < CACHE_TTL) && !forceRefresh) {
      console.log('Serving data from memory cache');
      return res.json(dataCache);
    }

    console.log('Cache expired or forceRefresh requested, fetching fresh data from Apps Script...');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(APPS_SCRIPT_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Apps Script returned ${response.status}`);
    }

    const data = await response.json();
    
    if (data && data.success) {
      dataCache = data;
      dataCacheTime = now;
      console.log('Successfully saved fresh data to memory cache');
    }
    
    res.json(data);
  } catch (err) {
    console.error('Data proxy error:', err.message);
    if (dataCache) {
      console.log('Serving stale cache due to fetch error');
      return res.json(dataCache);
    }
    res.status(502).json({ success: false, error: err.message });
  }
});

// POST /api/update-record — proxy record updates back to Google Sheets database
app.post('/api/update-record', async (req, res) => {
  try {
    const UPDATE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyfkvGhPuaVPFe62kyDhCSbKm4UwJ-Rbmr6KQfHfJjtE_Dp9E5dGdB1Bq1NS1r15U4e/exec';
    
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
    
    if (result && (result.success || result.status === 'success')) {
      console.log('Clearing data cache due to update-record success');
      dataCache = null;
    }
    
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

// ---------- Drive File Re-Sharing ----------
// POST /api/share/:fileId — re-share a single Drive file as "Anyone with the link"
app.post('/api/share/:fileId', async (req, res) => {
  try {
    const fileId = req.params.fileId;
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const perms = await drive.permissions.list({ fileId, fields: 'permissions(id,type,role)' });
    const existing = perms.data.permissions.find(p => p.type === 'anyone');
    if (existing) {
      return res.json({ success: true, alreadyPublic: true, fileId });
    }

    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    res.json({ success: true, fileId });
  } catch (err) {
    console.error('Share file error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/share-folder — bulk re-share every PDF in the Drive folder
app.post('/api/share-folder', async (req, res) => {
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const files = [];
    let pageToken = null;
    do {
      const resp = await drive.files.list({
        q: `'${DRIVE_FOLDER_ID}' in parents`,
        fields: 'nextPageToken, files(id, name, mimeType)',
        pageSize: 100,
        pageToken
      });
      files.push(...(resp.data.files || []));
      pageToken = resp.data.nextPageToken;
    } while (pageToken);

    const pdfs = files.filter(f => f.mimeType === 'application/pdf' || String(f.name || '').toLowerCase().endsWith('.pdf'));

    const results = [];
    for (const f of pdfs) {
      try {
        const perms = await drive.permissions.list({ fileId: f.id, fields: 'permissions(type,role)' });
        const existing = perms.data.permissions.find(p => p.type === 'anyone');
        if (existing) {
          results.push({ id: f.id, name: f.name, status: 'already_public' });
        } else {
          await drive.permissions.create({ fileId: f.id, requestBody: { role: 'reader', type: 'anyone' } });
          results.push({ id: f.id, name: f.name, status: 'shared' });
        }
      } catch (e) {
        results.push({ id: f.id, name: f.name, status: 'error', error: e.message });
      }
    }

    res.json({
      success: true,
      total: pdfs.length,
      shared: results.filter(r => r.status === 'shared').length,
      alreadyPublic: results.filter(r => r.status === 'already_public').length,
      errors: results.filter(r => r.status === 'error').length,
      results
    });
  } catch (err) {
    console.error('Share folder error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/reupload - duplicate a Google Drive PDF to trigger n8n processing again
app.post('/api/reupload', async (req, res) => {
  try {
    const { fileUrl, invoiceNumber, billType } = req.body;
    if (!fileUrl) {
      return res.status(400).json({ success: false, error: 'No fileUrl provided' });
    }

    const extractFileId = (url) => {
      const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      return match ? match[1] : null;
    };

    const fileId = extractFileId(fileUrl);
    if (!fileId) {
      return res.status(400).json({ success: false, error: 'Invalid Google Drive URL' });
    }

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    console.log(`Reprocessing Drive file ID: ${fileId}`);
    const metadata = await drive.files.get({ fileId, fields: 'name' });
    const originalName = metadata.data.name;

    const copyRes = await drive.files.copy({
      fileId: fileId,
      requestBody: {
        name: originalName,
        parents: [DRIVE_FOLDER_ID]
      },
      fields: 'id, name, webViewLink'
    });

    await drive.permissions.create({
      fileId: copyRes.data.id,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    console.log(`Re-upload copy completed: ${copyRes.data.name} (${copyRes.data.id})`);
    
    res.json({
      success: true,
      fileId: copyRes.data.id,
      fileUrl: copyRes.data.webViewLink,
      filename: copyRes.data.name,
      invoiceNumber
    });
  } catch (err) {
    console.error('Re-upload error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ---------- Google Sheets Write-Back Row Deletion ----------
async function deleteRowsFromSheet(sheetName, conditions) {
  try {
    console.log(`Sending delete request to Google Apps Script for ${sheetName}:`, conditions);
    const response = await fetch(DELETE_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sheet: sheetName, conditions })
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

app.post('/api/delete-invoice', async (req, res) => {
  try {
    const { invoice_number, lorry_vehicle_no, bill_freight_val } = req.body;
    console.log(`\nDeleting specific invoice record: ${invoice_number} | ${lorry_vehicle_no} | ${bill_freight_val}`);
    
    // 1. Delete matching shipment row in Invoice_Items
    const deletedInvoices = await deleteRowsFromSheet('Invoice_Items', {
      party_inv_no: invoice_number,
      lorry_vehicle_no: lorry_vehicle_no || '',
      bill_freight_val: bill_freight_val ? String(bill_freight_val) : ''
    });
    
    // 2. Delete matching purchase row in Purchase_data
    const deletedPurchases = await deleteRowsFromSheet('Purchase_data', {
      party_inv_no: invoice_number,
      bill_freight_val: bill_freight_val ? String(bill_freight_val) : ''
    });
    
    if (deletedInvoices || deletedPurchases) {
      console.log('Clearing data cache due to delete-invoice success');
      dataCache = null;
      res.json({
        success: true,
        message: `Deleted matching rows from Google Sheets.`,
        deletedInvoices,
        deletedPurchases
      });
    } else {
      res.status(400).json({
        success: false,
        error: `Google Sheets deletion failed (No matching row found in sheet).`,
        deletedInvoices,
        deletedPurchases
      });
    }
  } catch (err) {
    console.error('Delete error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- N8N Webhook Alerts / Notifications ----------
let latestNotification = null;

// POST /agentError
app.post('/agentError', (req, res) => {
  latestNotification = {
    id: Date.now() + Math.random().toString(36).substr(2, 5),
    type: 'error',
    message: 'Please Connect to the Developer API Key not Working',
    timestamp: Date.now()
  };
  console.log('Received agentError hook:', latestNotification);
  res.json({ success: true, notification: latestNotification });
});

// POST /excutedSucess
app.post('/excutedSucess', (req, res) => {
  latestNotification = {
    id: Date.now() + Math.random().toString(36).substr(2, 5),
    type: 'success',
    message: 'Check the Bill, booking is complete.',
    timestamp: Date.now()
  };
  console.log('Received excutedSucess hook:', latestNotification);
  res.json({ success: true, notification: latestNotification });
});

// POST /executedSuccess (spelling fallback)
app.post('/executedSuccess', (req, res) => {
  latestNotification = {
    id: Date.now() + Math.random().toString(36).substr(2, 5),
    type: 'success',
    message: 'Check the Bill, booking is complete.',
    timestamp: Date.now()
  };
  console.log('Received executedSuccess hook:', latestNotification);
  res.json({ success: true, notification: latestNotification });
});

// GET /api/agent-notification
app.get('/api/agent-notification', (req, res) => {
  res.json({ success: true, notification: latestNotification });
});


if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n  Invoice Dashboard Server`);
    console.log(`  ─────────────────────`);
    console.log(`  Data API:   http://localhost:${PORT}/api/data`);
    console.log(`  Upload API: http://localhost:${PORT}/upload`);
    console.log(`  Port:       ${PORT}`);
    console.log(`  Apps Script URL:   ${APPS_SCRIPT_URL}`);
    console.log(`  Delete Script URL: ${DELETE_SCRIPT_URL}\n`);
  });
}

export default app;
