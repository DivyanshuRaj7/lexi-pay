import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const openai = new OpenAI({
    baseURL: process.env.AI_BASE_URL,
    apiKey: process.env.AI_API_KEY
});

const model = process.env.AI_MODEL || "llama-3.3-70b-versatile";

const systemPrompt = `You are an expert legal contract reviewer. Analyze the given contract clause and identify risks.
Respond ONLY with valid JSON in this exact format:
{
  "severity": "LOW|MEDIUM|HIGH|CRITICAL",
  "risk_type": "LIABILITY|PAYMENT|TERMINATION|IP_OWNERSHIP|CONFIDENTIALITY|INDEMNITY|GOVERNING_LAW|OTHER",
  "explanation": "1-2 sentence explanation of the risk",
  "recommendation": "One sentence recommendation"
}
Be strict. Err on the side of flagging risks rather than missing them.`;

export async function analyzeClause(clauseText, clauseIndex) {
    try {
        const response = await openai.chat.completions.create({
            model: model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Analyze this clause:\n\n${clauseText}` }
            ],
            temperature: 0.1
        });

        const content = response.choices[0].message.content.trim();
        
        let parsedResult;
        try {
            // Strip markdown formatting if the model wraps the response in ```json ... ```
            const cleanContent = content.replace(/^```(json)?|```$/gi, "").trim();
            parsedResult = JSON.parse(cleanContent);
        } catch (parseError) {
            console.error(`Failed to parse JSON for clause ${clauseIndex}:`, parseError.message);
            console.error("Raw response:", content);
            return {
                index: clauseIndex,
                clause: clauseText,
                severity: "LOW",
                risk_type: "OTHER",
                explanation: "Could not analyze",
                recommendation: "Review manually."
            };
        }

        return {
            index: clauseIndex,
            clause: clauseText,
            severity: parsedResult.severity || "LOW",
            risk_type: parsedResult.risk_type || "OTHER",
            explanation: parsedResult.explanation || "Could not analyze",
            recommendation: parsedResult.recommendation || "Review manually."
        };

    } catch (error) {
        console.error(`API Error for clause ${clauseIndex}:`, error.message);
        return {
            index: clauseIndex,
            clause: clauseText,
            severity: "LOW",
            risk_type: "OTHER",
            explanation: "Could not analyze",
            recommendation: "Review manually."
        };
    }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function analyzeAllClauses(clauses) {
    const results = [];
    
    for (let i = 0; i < clauses.length; i++) {
        const clause = clauses[i];
        
        // Analyze the current clause
        const result = await analyzeClause(clause, i);
        results.push(result);
        
        // Wait 300ms before next request, unless it's the last item
        if (i < clauses.length - 1) {
            await delay(300);
        }
    }
    
    return results;
}
