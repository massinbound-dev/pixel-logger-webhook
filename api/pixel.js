// This is a Vercel Serverless Function that acts as a webhook endpoint for a tracking pixel.
// It captures ALL incoming data from GET or POST requests and logs it to a Google Sheet.

// File: /api/pixel.js

const express = require('express');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');

const app = express();

// --- CONFIGURATION ---
// Set these as Environment Variables in your Vercel project.

// Google Sheets Configuration
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SHEETS_CREDENTIALS = process.env.GOOGLE_SHEETS_CREDENTIALS;


// --- MIDDLEWARE ---
// Use Express's built-in middleware to parse JSON and URL-encoded request bodies.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// --- HELPER FUNCTION FOR GOOGLE SHEETS ---
async function appendToSheet(logData) {
    if (!GOOGLE_SHEET_ID || !GOOGLE_SHEETS_CREDENTIALS) {
        console.log('Google Sheets credentials not configured. Skipping log.');
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
                values: [logData],
            },
        });
        console.log('Successfully logged to Google Sheet.');
    } catch (error) {
        console.error('--- FAILED TO LOG TO GOOGLE SHEET ---');
        console.error(error.message);
    }
}


// --- THE MAIN WEBHOOK ROUTE ---
// This function will handle both GET and POST requests to /api/pixel
const handleRequest = async (req, res) => {
    console.log('Pixel webhook received a request.');
    
    // Combine all data from URL query parameters (for GET) and request body (for POST)
    const allData = { ...req.query, ...req.body };
    
    console.log('Received data:', allData);

    const timestamp = new Date().toISOString();
    
    // NEW LOGIC: Dynamically capture all data without predefined fields.
    
    // Use an 'event' field if it exists, otherwise provide a default.
    const eventName = allData.event || 'PixelEvent';
    
    // Convert the entire data object into a JSON string to store in a single cell.
    const fullDataString = JSON.stringify(allData);

    // Prepare the row to be logged to the Google Sheet.
    // The order here should match the new columns in your sheet: Timestamp, EventName, FullData
    const logRow = [
        timestamp,
        eventName,
        fullDataString
    ];

    await appendToSheet(logRow);

    // For a pixel, it's common to send back a 204 No Content response,
    // as the browser doesn't need to do anything with the response.
    res.status(204).send();
};

// Route requests for both GET and POST to the same handler
app.get('/api/pixel', handleRequest);
app.post('/api/pixel', handleRequest);


// Export the app for Vercel
module.exports = app;
