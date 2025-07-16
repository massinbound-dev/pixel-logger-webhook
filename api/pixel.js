// This is a Vercel Serverless Function that acts as a webhook endpoint for a tracking pixel.
// It parses incoming JSON data and logs it to a Google Sheet with a structured column format.

// File: /api/pixel.js

const express = require('express');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');

const app = express();

// --- CONFIGURATION ---
// Set these as Environment Variables in your Vercel project.
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SHEETS_CREDENTIALS = process.env.GOOGLE_SHEETS_CREDENTIALS;

// NEW: Define the headers for your Google Sheet.
// The order here MUST EXACTLY MATCH the order of columns in your sheet.
const SHEET_HEADERS = [
    'pixel_id', 'hem_sha256', 'event_timestamp', 'event_type', 'ip_address', 
    'activity_start_date', 'activity_end_date', 'page_referrer', 'page_title', 'page_url',
    'element_tag', 'element_text', 'element_href', 'first_name', 'last_name', 'gender',
    'age_range', 'homeowner', 'married', 'children', 'income_range', 'net_worth',
    'personal_address', 'personal_city', 'personal_state', 'personal_zip', 'personal_emails',
    'mobile_phone', 'direct_number', 'company_name', 'company_domain', 'company_industry',
    'job_title', 'linkedin_url', 'skiptrace_ip', 'skiptrace_exact_age', 'uuid'
];


// --- MIDDLEWARE ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// --- HELPER FUNCTION FOR GOOGLE SHEETS ---
async function appendToSheet(rows) {
    if (!GOOGLE_SHEET_ID || !GOOGLE_SHEETS_CREDENTIALS) {
        console.log('Google Sheets credentials not configured. Skipping log.');
        return;
    }
    if (rows.length === 0) {
        console.log('No data to log. Skipping sheet append.');
        return;
    }

    try {
        const auth = new GoogleAuth({
            credentials: JSON.parse(GOOGLE_SHEETS_CREDENTIALS),
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });

        const sheets = google.sheets({ version: 'v4', auth });
        
        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: 'Sheet1!A1', // Assumes you're writing to a sheet named "Sheet1"
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: rows, // Append all rows at once
            },
        });
        console.log(`Successfully logged ${rows.length} row(s) to Google Sheet.`);
    } catch (error) {
        console.error('--- FAILED TO LOG TO GOOGLE SHEET ---');
        console.error(error.message);
    }
}


// --- THE MAIN WEBHOOK ROUTE ---
const handleRequest = async (req, res) => {
    console.log('Pixel webhook received a request.');
    
    const payload = req.body;
    console.log('Received payload:', JSON.stringify(payload, null, 2));

    const events = payload.events || [];
    if (events.length === 0) {
        console.log('Payload contained no events. Nothing to log.');
        return res.status(204).send();
    }

    const get = (obj, path, defaultValue = '') => {
        const keys = path.split('.');
        let result = obj;
        for (const key of keys) {
            if (result === null || result === undefined) return defaultValue;
            result = result[key];
        }
        return result === undefined ? defaultValue : result;
    };

    const rowsToLog = [];

    for (const event of events) {
        const logData = {
            // Top-level event data
            pixel_id: get(event, 'pixel_id'),
            hem_sha256: get(event, 'hem_sha256'),
            event_timestamp: get(event, 'event_timestamp'),
            event_type: get(event, 'event_type'),
            ip_address: get(event, 'ip_address'),
            activity_start_date: get(event, 'activity_start_date'),
            activity_end_date: get(event, 'activity_end_date'),
            
            // Event Data
            page_referrer: get(event, 'event_data.referrer'),
            page_title: get(event, 'event_data.title'),
            page_url: get(event, 'event_data.url'),

            // Element Data
            element_tag: get(event, 'event_data.element.tag'),
            element_text: get(event, 'event_data.element.text'),
            element_href: get(event, 'event_data.element.attributes.href'),

            // Resolution Data (Personal)
            first_name: get(event, 'resolution.FIRST_NAME'),
            last_name: get(event, 'resolution.LAST_NAME'),
            gender: get(event, 'resolution.GENDER'),
            age_range: get(event, 'resolution.AGE_RANGE'),
            homeowner: get(event, 'resolution.HOMEOWNER'),
            married: get(event, 'resolution.MARRIED'),
            children: get(event, 'resolution.CHILDREN'),
            income_range: get(event, 'resolution.INCOME_RANGE'),
            net_worth: get(event, 'resolution.NET_WORTH'),
            personal_address: get(event, 'resolution.PERSONAL_ADDRESS'),
            personal_city: get(event, 'resolution.PERSONAL_CITY'),
            personal_state: get(event, 'resolution.PERSONAL_STATE'),
            personal_zip: get(event, 'resolution.PERSONAL_ZIP'),
            personal_emails: get(event, 'resolution.PERSONAL_EMAILS'),
            mobile_phone: get(event, 'resolution.MOBILE_PHONE'),
            direct_number: get(event, 'resolution.DIRECT_NUMBER'),

            // Resolution Data (Company)
            company_name: get(event, 'resolution.COMPANY_NAME'),
            company_domain: get(event,- 'resolution.COMPANY_DOMAIN'),
            company_industry: get(event, 'resolution.COMPANY_INDUSTRY'),
            job_title: get(event, 'resolution.JOB_TITLE'),
            linkedin_url: get(event, 'resolution.LINKEDIN_URL'),
            
            // Resolution Data (Skiptrace & Other)
            skiptrace_ip: get(event, 'resolution.SKIPTRACE_IP'),
            skiptrace_exact_age: get(event, 'resolution.SKIPTRACE_EXACT_AGE'),
            uuid: get(event, 'resolution.UUID')
        };
        
        const newRow = SHEET_HEADERS.map(header => logData[header] || '');
        rowsToLog.push(newRow);
    }

    await appendToSheet(rowsToLog);

    res.status(204).send();
};

app.get('/api/pixel', handleRequest);
app.post('/api/pixel', handleRequest);

module.exports = app;