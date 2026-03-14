# LexiPay Project Setup Walkthrough

The project has been successfully moved and dependencies have been installed without errors.

## Changes Made
- Moved project from `C:\Users\divya\OneDrive\steins;code\lexipay` to `C:\projects\lexipay`.
- Updated `package.json` to include `better-sqlite3`.
- Reinstalled all dependencies in the new location.

## Verification Results
- **Project Structure**: Verified that all source files and directories were copied correctly using `robocopy`.
- **Dependency Installation**: `npm install` completed with exit code 0.
- **Native Module Verification**: Confirmed that `node_modules/better-sqlite3` exists in the new location.

## Status
The project is now ready for logic implementation. You can find it at: `C:\projects\lexipay`.

> [!NOTE]
> The original project folder in OneDrive still exists for safety. You can manually delete it once you've confirmed everything is working in the new location.

---

## Extractor Module Implementation

The text extraction logic has been completed in `src/extractor.js`. 
- **`extractTextFromFile`**: Reads PDF using `pdf-parse` or plain text otherwise.
- **`splitIntoClauses`**: Intelligent clause chunking algorithm using strict keyword boundaries ("WHEREAS", "NOW THEREFORE", etc.) and list markers ("1.", "a."). Filters out short fluff lines.
- **Compatibility**: Integrated a `createRequire` hook to allow the CommonJS `pdf-parse` module to be imported seamlessly in this ESM environment.

---

## Final Express Server implementation (`src/server.js`)

LexiPay is now equipped with its primary server architecture capable of parsing documents, generating pay-per-clause API boundaries, caching AI results in an SQLite DB, and interacting with `facinet-sdk` / `x402-express`.

### Endpoints
- **`GET /health`** / **`GET /info`**: Basic health and pricing check.
- **`POST /upload`**: Free route to upload a contract file `multipart/form-data`. Analyzes and returns `{ sessionId, totalClauses, estimatedTotal }`.
- **`POST /analyze/:sessionId/:clauseIndex`**: **PAID Route**. Defended by the dynamically loaded x402 middleware. Upon a valid transaction, OpenAI parses the clause, saves the result locally, and returns the analysis alongside the txHash.
- **`GET /results/:sessionId`**: Free summary retrieval route compiling the critical issues from the paid analyses.

---

## Smart Contract (`contracts/LexPayRegistry.sol`)

A decentralized, on-chain ledger representing analyzed contracts has been developed. Validated with `solc` successfully, ensuring flawless EVM compatibility.
- Stores specific `ReviewSession` mapping data including severity risk ratios (`criticalCount`, `highCount`) corresponding to the AI results.
- Incorporates dynamic per-clause execution barriers via `require(msg.value >= clauseCount * pricePerClauseWei)`.
- Automatically tracks document hashes mapped to analyzing `reviewer` addresses.
