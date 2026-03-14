import fs from 'fs';
import pdfParse from 'pdf-parse';

export async function extractTextFromFile(filePath, mimetype) {
    const isPDF = mimetype === 'application/pdf' || filePath.toLowerCase().endsWith('.pdf');
    
    if (isPDF) {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        return data.text;
    }
    
    // Fallback and text/plain
    return fs.readFileSync(filePath, 'utf-8');
}

export function splitIntoClauses(text) {
    if (!text) return [];
    
    // Split by two or more newlines first
    const blocks = text.split(/\n{2,}/);
    const clauses = [];
    
    // Regex to match clause beginnings
    const pattern = /^(?:[0-9a-zA-Z]+\.\s|WHEREAS|NOW THEREFORE|The parties|Party|Contractor|Client|In the event|Notwithstanding|Subject to)/i;
    
    for (const block of blocks) {
        // Split block into sentences roughly
        const sentences = block.split(/(?<=\.)\s+/);
        let currentClause = "";
        
        for (const sent of sentences) {
            const trimmedSent = sent.trim();
            if (pattern.test(trimmedSent) && currentClause) {
                clauses.push(currentClause.trim());
                currentClause = sent;
            } else {
                currentClause += (currentClause ? " " : "") + sent;
            }
        }
        
        if (currentClause) {
            clauses.push(currentClause.trim());
        }
    }
    
    return clauses
        .filter(c => c.length >= 30) // Minimum 30 characters
        .slice(0, 50); // Maximum 50 clauses
}

export function countClauses(text) {
    return splitIntoClauses(text).length;
}
