import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

import { extractTextFromFile, splitIntoClauses, countClauses } from './extractor.js';
import { analyzeClause } from './analyzer.js';
import db, { createSession, saveClauseResult, markClausePaid, getClauseResult, getSessionResults, getSession } from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configurable constants
const pricePerClause = process.env.PRICE_PER_CLAUSE || "0.001";
const payToAddress = process.env.PAY_TO_ADDRESS || "";
const facilitatorUrl = process.env.FACILITATOR_URL || "";

app.use(express.json());

// Set up Multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Ensure uploads directory exists
if (!fs.existsSync('uploads/')) {
    fs.mkdirSync('uploads/');
}

// Memory cache for active sessions' clauses to avoid re-reading the file
// In a full production app, this might be Redis or stored differently.
const sessionClausesCache = new Map();

//=============================================================================
// Payment Middleware SETUP
//=============================================================================
let paymentMiddleware = null;

try {
    // Attempt to load facinet-sdk
    const { facinetExpress } = await import('facinet-sdk');
    console.log("Using facinet-sdk for x402 payments.");
    paymentMiddleware = facinetExpress({
        price: pricePerClause,
        currency: "USDC",
        payTo: payToAddress,
        facilitatorUrl: facilitatorUrl
    });
} catch (e) {
    console.log("facinet-sdk not found, falling back to x402-express.");
    try {
        const { x402Express } = await import('x402-express');
        paymentMiddleware = x402Express({
            price: pricePerClause,
            currency: "USDC",
            payTo: payToAddress,
            facilitatorUrl: facilitatorUrl
        });
    } catch (fallbackError) {
        console.warn("WARNING: Neither facinet-sdk nor x402-express could be loaded. Payment gateway is simulated/bypassed.");
        paymentMiddleware = (req, res, next) => {
            // Mock payment for development/testing if middleware is totally missing
            req.x402Payment = { transactionHash: "mock-tx-hash-12345" };
            next();
        };
    }
}

//=============================================================================
// ENDPOINTS
//=============================================================================

app.get('/health', (req, res) => {
    res.json({
        status: "ok",
        pricePerClause,
        payToAddress
    });
});

app.get('/info', (req, res) => {
    res.json({
        name: "LexPay",
        description: "A legal contract risk analyzer charging per-clause analysis using x402 payments.",
        pricing: {
            unit: "per clause",
            price: pricePerClause,
            currency: "USDC"
        }
    });
});

app.post('/upload', upload.single('contract'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No contract file uploaded." });
        }

        const filePath = req.file.path;
        const mimetype = req.file.mimetype;
        const originalName = req.file.originalname;

        // Extract and process text
        const text = await extractTextFromFile(filePath, mimetype);
        const clauses = splitIntoClauses(text);
        const total = clauses.length;

        // Cleanup the uploaded file immediately to save disk-space since we cache clauses in memory
        fs.unlinkSync(filePath);

        if (total === 0) {
            return res.status(400).json({ error: "No parsable clauses found in document." });
        }

        const sessionId = uuidv4();
        
        // Save session
        createSession(sessionId, originalName, total);

        // Cache the parsed clauses for this session
        sessionClausesCache.set(sessionId, clauses);

        // Estimated total cost (price * number of clauses)
        const estimatedTotal = (parseFloat(pricePerClause) * total).toFixed(4);

        res.json({
            sessionId,
            filename: originalName,
            totalClauses: total,
            pricePerClause,
            estimatedTotal: estimatedTotal.toString()
        });

    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ error: "Failed to process upload." });
    }
});

app.post('/analyze/:sessionId/:clauseIndex', paymentMiddleware, async (req, res) => {
    try {
        const { sessionId, clauseIndex } = req.params;
        const index = parseInt(clauseIndex, 10);

        // Transaction hash from middleware
        const txHash = req.x402Payment?.transactionHash || req.facinetPayment?.transactionHash || "unknown-tx";

        // Check DB to see if we already analyzed this clause
        const existingResult = getClauseResult(sessionId, index);
        
        if (existingResult && existingResult.paid === 1) {
            // Already analyzed and paid for
            return res.json({
                clauseIndex: index,
                clause: existingResult.clause_text,
                severity: existingResult.severity,
                risk_type: existingResult.risk_type,
                explanation: existingResult.explanation,
                recommendation: existingResult.recommendation,
                txHash: existingResult.tx_hash,
                cached: true
            });
        }

        // Get clauses from cache (or gracefully fail if session is lost)
        const clauses = sessionClausesCache.get(sessionId);
        
        if (!clauses) {
             // In a perfect system, we'd reload the file from disk here if not cached. 
             // We deleted it in /upload for simplicity, so error out if cache hit fails.
             return res.status(404).json({ error: "Session expired or not found in memory." });
        }

        if (index < 0 || index >= clauses.length) {
            return res.status(400).json({ error: "Invalid clause index." });
        }

        const clauseText = clauses[index];

        // Call the AI analyzer
        const aiResult = await analyzeClause(clauseText, index);

        // Save to Database
        saveClauseResult(sessionId, aiResult);
        markClausePaid(sessionId, index, txHash);

        return res.json({
            clauseIndex: index,
            clause: clauseText,
            severity: aiResult.severity,
            risk_type: aiResult.risk_type,
            explanation: aiResult.explanation,
            recommendation: aiResult.recommendation,
            txHash: txHash,
            cached: false
        });

    } catch (error) {
        console.error("Analyze Error:", error);
        res.status(500).json({ error: "Failed to analyze clause." });
    }
});

app.get('/results/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        
        const session = getSession(sessionId);
        if (!session) {
            return res.status(404).json({ error: "Session not found." });
        }

        const results = getSessionResults(sessionId);
        
        let criticalCount = 0;
        let highCount = 0;

        const formattedResults = results.map(r => {
            if (r.severity === "CRITICAL") criticalCount++;
            if (r.severity === "HIGH") highCount++;
            
            return {
                clauseIndex: r.clause_index,
                clause: r.clause_text,
                severity: r.severity,
                risk_type: r.risk_type,
                explanation: r.explanation,
                recommendation: r.recommendation,
                txHash: r.tx_hash
            };
        });

        res.json({
            sessionId,
            filename: session.filename,
            summary: {
                totalClauses: session.total_clauses,
                analyzedCount: formattedResults.length,
                criticalCount,
                highCount
            },
            results: formattedResults
        });

    } catch (error) {
        console.error("Results Error:", error);
        res.status(500).json({ error: "Failed to fetch results." });
    }
});

//=============================================================================
// START SERVER
//=============================================================================
app.listen(PORT, () => {
    console.log(`\nLexPay Server listening on port ${PORT}`);
    console.log(`Endpoints:`);
    console.log(`  GET  /health`);
    console.log(`  GET  /info`);
    console.log(`  POST /upload (multipart/form-data 'contract')`);
    console.log(`  POST /analyze/:sessionId/:clauseIndex (Requires x402 payment)`);
    console.log(`  GET  /results/:sessionId\n`);
    console.log(`Using AI Model: ${process.env.AI_MODEL || "llama-3.3-70b-versatile"}`);
});
