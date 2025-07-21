// This is a Vercel Serverless Function that acts as a webhook endpoint for a tracking pixel.
// It parses incoming JSON data, logs it to a Google Sheet, and creates/updates contacts in a GoHighLevel CRM.

// File: /api/pixel.js

const express = require('express');
const axios = require('axios'); // Add axios for making API requests
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');

const app = express();

// --- CONFIGURATION ---
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SHEETS_CREDENTIALS = process.env.GOOGLE_SHEETS_CREDENTIALS;

// GoHighLevel (Inbound Suite) Configuration
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_API_BASE_URL = 'https://rest.gohighlevel.com/v1';

// The exact headers for your Google Sheet.
const SHEET_HEADERS = [
    'PixelID', 'HemSha256', 'EventTimestamp', 'EventType', 'IPAddress', 'ActivityStartDate', 'ActivityEndDate', 'ReferrerURL', 'UUID',
    'FIRST_NAME', 'LAST_NAME', 'PERSONAL_ADDRESS', 'PERSONAL_CITY', 'PERSONAL_STATE', 'PERSONAL_ZIP', 'PERSONAL_ZIP4', 'AGE_RANGE', 'CHILDREN',
    'GENDER', 'HOMEOWNER', 'MARRIED', 'NET_WORTH', 'INCOME_RANGE', 'DIRECT_NUMBER', 'DIRECT_NUMBER_DNC', 'MOBILE_PHONE', 'MOBILE_PHONE_DNC',
    'PERSONAL_PHONE', 'PERSONAL_PHONE_DNC', 'BUSINESS_EMAIL', 'PERSONAL_EMAILS', 'DEEP_VERIFIED_EMAILS', 'SHA256_PERSONAL_EMAIL',
    'SHA256_BUSINESS_EMAIL', 'JOB_TITLE', 'HEADLINE', 'DEPARTMENT', 'SENIORITY_LEVEL', 'INFERRED_YEARS_EXPERIENCE', 'COMPANY_NAME_HISTORY',
    'JOB_TITLE_HISTORY', 'EDUCATION_HISTORY', 'COMPANY_ADDRESS', 'COMPANY_DESCRIPTION', 'COMPANY_DOMAIN', 'COMPANY_EMPLOYEE_COUNT',
    'COMPANY_LINKEDIN_URL', 'COMPANY_NAME', 'COMPANY_PHONE', 'COMPANY_REVENUE', 'COMPANY_SIC', 'COMPANY_NAICS', 'COMPANY_CITY', 'COMPANY_STATE',
    'COMPANY_ZIP', 'COMPANY_INDUSTRY', 'LINKEDIN_URL', 'TWITTER_URL', 'FACEBOOK_URL', 'SOCIAL_CONNECTIONS', 'SKILLS', 'INTERESTS',
    'SKIPTRACE_MATCH_SCORE', 'SKIPTRACE_NAME', 'SKIPTRACE_ADDRESS', 'SKIPTRACE_CITY', 'SKIPTRACE_STATE', 'SKIPTRACE_ZIP',
    'SKIPTRACE_LANDLINE_NUMBERS', 'SKIPTRACE_WIRELESS_NUMBERS', 'SKIPTRACE_CREDIT_RATING', 'SKIPTRACE_DNC', 'SKIPTRACE_EXACT_AGE',
    'SKIPTRACE_ETHNIC_CODE', 'SKIPTRACE_LANGUAGE_CODE', 'SKIPTRACE_IP', 'SKIPTRACE_B2B_ADDRESS', 'SKIPTRACE_B2B_PHONE',
    'SKIPTRACE_B2B_SOURCE', 'SKIPTRACE_B2B_WEBSITE'
];


// --- MIDDLEWARE ---
app.use(express.json());


// --- HELPER FUNCTIONS (Google Sheets & GHL) ---

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
            range: 'Sheet1!A1',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: rows },
        });
        console.log(`Successfully logged ${rows.length} row(s) to Google Sheet.`);
    } catch (error) {
        console.error('--- FAILED TO LOG TO GOOGLE SHEET ---');
        console.error(error.message);
    }
}

// Function to search for a contact in GoHighLevel
async function findGHLContact(email, phone) {
    if (!GHL_API_KEY) return null;
    if (!email && !phone) return null;

    try {
        // Use URLSearchParams to handle encoding of parameters correctly
        const params = new URLSearchParams();
        if (email) params.append('email', email);
        if (phone) params.append('phone', phone);

        const response = await axios.get(`${GHL_API_BASE_URL}/contacts/lookup?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}` }
        });
        return response.data.contacts.length > 0 ? response.data.contacts[0] : null;
    } catch (error) {
        if (error.response && error.response.status !== 404) {
            console.error('Error searching for GHL contact:', error.message);
        }
        return null;
    }
}

// Function to create a contact in GoHighLevel
async function createGHLContact(contactData) {
    if (!GHL_API_KEY) return;
    try {
        const response = await axios.post(`${GHL_API_BASE_URL}/contacts/`, contactData, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}` }
        });
        console.log(`Successfully created GHL contact for ${contactData.email || contactData.phone}`);
        return response.data.contact;
    } catch (error) {
        console.error('Error creating GHL contact:', error.message);
        return null;
    }
}

// Function to add a note to an existing GHL contact
async function addGHLNote(contactId, note) {
    if (!GHL_API_KEY) return;
    try {
        await axios.post(`${GHL_API_BASE_URL}/contacts/${contactId}/notes`, { body: note }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}` }
        });
        console.log(`Successfully added note to GHL contact ${contactId}`);
    } catch (error) {
        console.error('Error adding note to GHL contact:', error.message);
    }
}


// --- THE MAIN WEBHOOK ROUTE ---
const handleRequest = async (req, res) => {
    console.log('Pixel webhook received a request.');
    const payload = req.body;
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

    const formatSheetCell = (value) => {
        if (typeof value === 'string' && value.trim().startsWith('+')) {
            return "'" + value;
        }
        return value;
    };

    const rowsToLog = [];

    for (const event of events) {
        const resolution = event.resolution || {};
        
        const logData = {
            PixelID: get(event, 'pixel_id'),
            HemSha256: get(event, 'hem_sha256'),
            EventTimestamp: get(event, 'event_timestamp'),
            EventType: get(event, 'event_type'),
            IPAddress: get(event, 'ip_address'),
            ActivityStartDate: get(event, 'activity_start_date'),
            ActivityEndDate: get(event, 'activity_end_date'),
            ReferrerURL: get(event, 'referrer_url'),
            UUID: get(resolution, 'UUID'),
            FIRST_NAME: get(resolution, 'FIRST_NAME'),
            LAST_NAME: get(resolution, 'LAST_NAME'),
            PERSONAL_ADDRESS: get(resolution, 'PERSONAL_ADDRESS'),
            PERSONAL_CITY: get(resolution, 'PERSONAL_CITY'),
            PERSONAL_STATE: get(resolution, 'PERSONAL_STATE'),
            PERSONAL_ZIP: get(resolution, 'PERSONAL_ZIP'),
            PERSONAL_ZIP4: get(resolution, 'PERSONAL_ZIP4'),
            AGE_RANGE: get(resolution, 'AGE_RANGE'),
            CHILDREN: get(resolution, 'CHILDREN'),
            GENDER: get(resolution, 'GENDER'),
            HOMEOWNER: get(resolution, 'HOMEOWNER'),
            MARRIED: get(resolution, 'MARRIED'),
            NET_WORTH: get(resolution, 'NET_WORTH'),
            INCOME_RANGE: get(resolution, 'INCOME_RANGE'),
            DIRECT_NUMBER: formatSheetCell(get(resolution, 'DIRECT_NUMBER')),
            DIRECT_NUMBER_DNC: get(resolution, 'DIRECT_NUMBER_DNC'),
            MOBILE_PHONE: formatSheetCell(get(resolution, 'MOBILE_PHONE')),
            MOBILE_PHONE_DNC: get(resolution, 'MOBILE_PHONE_DNC'),
            PERSONAL_PHONE: formatSheetCell(get(resolution, 'PERSONAL_PHONE')),
            PERSONAL_PHONE_DNC: get(resolution, 'PERSONAL_PHONE_DNC'),
            BUSINESS_EMAIL: get(resolution, 'BUSINESS_EMAIL'),
            PERSONAL_EMAILS: get(resolution, 'PERSONAL_EMAILS'),
            DEEP_VERIFIED_EMAILS: get(resolution, 'DEEP_VERIFIED_EMAILS'),
            SHA256_PERSONAL_EMAIL: get(resolution, 'SHA256_PERSONAL_EMAIL'),
            SHA256_BUSINESS_EMAIL: get(resolution, 'SHA256_BUSINESS_EMAIL'),
            JOB_TITLE: get(resolution, 'JOB_TITLE'),
            HEADLINE: get(resolution, 'HEADLINE'),
            DEPARTMENT: get(resolution, 'DEPARTMENT'),
            SENIORITY_LEVEL: get(resolution, 'SENIORITY_LEVEL'),
            INFERRED_YEARS_EXPERIENCE: get(resolution, 'INFERRED_YEARS_EXPERIENCE'),
            COMPANY_NAME_HISTORY: get(resolution, 'COMPANY_NAME_HISTORY'),
            JOB_TITLE_HISTORY: get(resolution, 'JOB_TITLE_HISTORY'),
            EDUCATION_HISTORY: get(resolution, 'EDUCATION_HISTORY'),
            COMPANY_ADDRESS: get(resolution, 'COMPANY_ADDRESS'),
            COMPANY_DESCRIPTION: get(resolution, 'COMPANY_DESCRIPTION'),
            COMPANY_DOMAIN: get(resolution, 'COMPANY_DOMAIN'),
            COMPANY_EMPLOYEE_COUNT: get(resolution, 'COMPANY_EMPLOYEE_COUNT'),
            COMPANY_LINKEDIN_URL: get(resolution, 'COMPANY_LINKEDIN_URL'),
            COMPANY_NAME: get(resolution, 'COMPANY_NAME'),
            COMPANY_PHONE: get(resolution, 'COMPANY_PHONE'),
            COMPANY_REVENUE: get(resolution, 'COMPANY_REVENUE'),
            COMPANY_SIC: get(resolution, 'COMPANY_SIC'),
            COMPANY_NAICS: get(resolution, 'COMPANY_NAICS'),
            COMPANY_CITY: get(resolution, 'COMPANY_CITY'),
            COMPANY_STATE: get(resolution, 'COMPANY_STATE'),
            COMPANY_ZIP: get(resolution, 'COMPANY_ZIP'),
            COMPANY_INDUSTRY: get(resolution, 'COMPANY_INDUSTRY'),
            LINKEDIN_URL: get(resolution, 'LINKEDIN_URL'),
            TWITTER_URL: get(resolution, 'TWITTER_URL'),
            FACEBOOK_URL: get(resolution, 'FACEBOOK_URL'),
            SOCIAL_CONNECTIONS: get(resolution, 'SOCIAL_CONNECTIONS'),
            SKILLS: get(resolution, 'SKILLS'),
            INTERESTS: get(resolution, 'INTERESTS'),
            SKIPTRACE_MATCH_SCORE: get(resolution, 'SKIPTRACE_MATCH_SCORE'),
            SKIPTRACE_NAME: get(resolution, 'SKIPTRACE_NAME'),
            SKIPTRACE_ADDRESS: get(resolution, 'SKIPTRACE_ADDRESS'),
            SKIPTRACE_CITY: get(resolution, 'SKIPTRACE_CITY'),
            SKIPTRACE_STATE: get(resolution, 'SKIPTRACE_STATE'),
            SKIPTRACE_ZIP: get(resolution, 'SKIPTRACE_ZIP'),
            SKIPTRACE_LANDLINE_NUMBERS: get(resolution, 'SKIPTRACE_LANDLINE_NUMBERS'),
            SKIPTRACE_WIRELESS_NUMBERS: get(resolution, 'SKIPTRACE_WIRELESS_NUMBERS'),
            SKIPTRACE_CREDIT_RATING: get(resolution, 'SKIPTRACE_CREDIT_RATING'),
            SKIPTRACE_DNC: get(resolution, 'SKIPTRACE_DNC'),
            SKIPTRACE_EXACT_AGE: get(resolution, 'SKIPTRACE_EXACT_AGE'),
            SKIPTRACE_ETHNIC_CODE: get(resolution, 'SKIPTRACE_ETHNIC_CODE'),
            SKIPTRACE_LANGUAGE_CODE: get(resolution, 'SKIPTRACE_LANGUAGE_CODE'),
            SKIPTRACE_IP: get(resolution, 'SKIPTRACE_IP'),
            SKIPTRACE_B2B_ADDRESS: get(resolution, 'SKIPTRACE_B2B_ADDRESS'),
            SKIPTRACE_B2B_PHONE: get(resolution, 'SKIPTRACE_B2B_PHONE'),
            SKIPTRACE_B2B_SOURCE: get(resolution, 'SKIPTRACE_B2B_SOURCE'),
            SKIPTRACE_B2B_WEBSITE: get(resolution, 'SKIPTRACE_B2B_WEBSITE')
        };
        
        const newRow = SHEET_HEADERS.map(header => logData[header] || '');
        rowsToLog.push(newRow);

        // --- GOHIGHLEVEL INTEGRATION LOGIC ---
        const firstName = get(resolution, 'FIRST_NAME');
        const lastName = get(resolution, 'LAST_NAME');
        const email = get(resolution, 'PERSONAL_EMAILS', '').split(',')[0].trim();
        
        // UPDATED: Sanitize the phone number before using it in the API calls
        const rawPhone = get(resolution, 'MOBILE_PHONE', '').split(',')[0].trim();
        const sanitizedPhone = rawPhone.replace(/\D/g, '');


        if (firstName && lastName && (email || sanitizedPhone)) {
            console.log(`Qualified lead found: ${firstName} ${lastName}`);
            const existingContact = await findGHLContact(email, sanitizedPhone);

            if (existingContact) {
                console.log(`Contact already exists (ID: ${existingContact.id}). Adding a note.`);
                const note = `Website activity detected. Event: ${get(event, 'event_type')}. URL: ${get(event, 'event_data.url', 'N/A')}. Timestamp: ${get(event, 'event_timestamp')}`;
                await addGHLNote(existingContact.id, note);
            } else {
                console.log('Contact does not exist. Creating new contact.');
                const newContactData = {
                    firstName: firstName,
                    lastName: lastName,
                    email: email,
                    phone: sanitizedPhone,
                    source: 'Pixel Tracker Webhook',
                    customField: {
                        // Example: 'net_worth_key_from_ghl': get(resolution, 'NET_WORTH'),
                    }
                };
                await createGHLContact(newContactData);
            }
        } else {
            console.log('Event did not meet criteria for CRM entry (missing name, email, or phone).');
        }
    }

    await appendToSheet(rowsToLog);
    res.status(204).send();
};

app.get('/api/pixel', handleRequest);
app.post('/api/pixel', handleRequest);

module.exports = app;