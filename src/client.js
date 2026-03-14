import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import FormData from 'form-data';
import fetch from 'node-fetch';
import chalk from 'chalk';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

dotenv.config();

// ─── Severity helpers ────────────────────────────────────────────────────────

const severityDot = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢' };

function coloredSeverity(severity) {
    switch (severity) {
        case 'CRITICAL': return chalk.red.bold('CRITICAL');
        case 'HIGH':     return chalk.redBright.bold('HIGH');
        case 'MEDIUM':   return chalk.yellow.bold('MEDIUM');
        case 'LOW':      return chalk.green.bold('LOW');
        default:         return chalk.white.bold(severity ?? 'UNKNOWN');
    }
}

function dot(severity) { return severityDot[severity] ?? '⚪'; }

// ─── Box renderer ────────────────────────────────────────────────────────────

function renderClauseBox(result) {
    const { clauseIndex, severity, risk_type, explanation, recommendation, txHash } = result;
    const BOX_WIDTH = 57;
    const inner = BOX_WIDTH - 2;

    const wrap = (text, maxLen) => {
        const words = (text ?? '').split(' ');
        const lines = [];
        let current = '';
        for (const word of words) {
            if ((current + word).length > maxLen) {
                if (current) lines.push(current.trimEnd());
                current = word + ' ';
            } else {
                current += word + ' ';
            }
        }
        if (current.trim()) lines.push(current.trimEnd());
        return lines.length ? lines : [''];
    };

    const padLine = (text) => {
        const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
        const pad = inner - stripped.length;
        return `│ ${text}${' '.repeat(Math.max(0, pad))} │`;
    };

    const top    = `┌${'─'.repeat(BOX_WIDTH - 2)}┐`;
    const div    = `├${'─'.repeat(BOX_WIDTH - 2)}┤`;
    const bottom = `└${'─'.repeat(BOX_WIDTH - 2)}┘`;

    const titleStr = `Clause ${clauseIndex + 1} — ${dot(severity)} ${coloredSeverity(severity)} (${risk_type ?? 'OTHER'})`;
    const explainLines = wrap(explanation, inner);
    const recLines = wrap(`Rec: ${recommendation}`, inner);
    const txStr = txHash ? `Tx: ${txHash.length > 44 ? txHash.slice(0, 44) + '…' : txHash}` : '';

    console.log([
        top,
        padLine(titleStr),
        div,
        ...explainLines.map(padLine),
        ...recLines.map(l => padLine(chalk.cyan(l))),
        ...(txStr ? [padLine(chalk.gray(txStr))] : []),
        bottom,
    ].join('\n'));
}

function renderUploadInfo({ filename, totalClauses, pricePerClause, estimatedTotal }) {
    console.log('\n' + chalk.bold.green('✔  Contract uploaded successfully'));
    console.log(chalk.white(`   File           : ${filename}`));
    console.log(chalk.white(`   Clauses found  : ${totalClauses}`));
    console.log(chalk.white(`   Price / clause : ${pricePerClause} USDC`));
    console.log(chalk.yellow(`   Estimated total: ${estimatedTotal} USDC`));
}

function renderSummary(summary, filename, pricePerClause) {
    const { totalClauses, analyzedCount, criticalCount, highCount, results } = summary;

    const mediumCount = results?.filter(r => r.severity === 'MEDIUM').length ?? 0;
    const lowCount    = results?.filter(r => r.severity === 'LOW').length ?? 0;
    const spent       = (parseFloat(pricePerClause) * analyzedCount).toFixed(4);

    console.log('\n' + chalk.bold.underline(`📄  ${filename} — Final Summary`));
    console.log(chalk.white(`   Total clauses : ${totalClauses}`));
    console.log(chalk.white(`   Analyzed      : ${analyzedCount}`));
    console.log(`   ${dot('CRITICAL')} Critical   : ${criticalCount > 0 ? chalk.red.bold(criticalCount)      : chalk.green(criticalCount)}`);
    console.log(`   ${dot('HIGH')}     High       : ${highCount > 0    ? chalk.redBright.bold(highCount)     : chalk.green(highCount)}`);
    console.log(`   ${dot('MEDIUM')}   Medium     : ${mediumCount > 0  ? chalk.yellow.bold(mediumCount)      : chalk.green(mediumCount)}`);
    console.log(`   ${dot('LOW')}      Low        : ${chalk.green(lowCount)}`);
    console.log(chalk.bold.yellow(`\n   💸  Total USDC spent: ${spent}`));
    console.log();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function ask(question) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, answer => { rl.close(); resolve(answer.trim().toLowerCase()); });
    });
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    // 1. Validate CLI args
    const filePath = process.argv[2];
    if (!filePath) {
        console.error(chalk.red('Usage: node src/client.js <path-to-contract.pdf|.txt>'));
        process.exit(1);
    }

    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
        console.error(chalk.red(`File not found: ${resolvedPath}`));
        process.exit(1);
    }

    // 2. Viem account
    const privateKey = process.env.EVM_PRIVATE_KEY;
    if (!privateKey) {
        console.error(chalk.red('EVM_PRIVATE_KEY is not set in .env'));
        process.exit(1);
    }

    const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
    console.log(chalk.gray(`Using wallet: ${account.address}`));

    const serverBase = `http://127.0.0.1:${process.env.PORT || 3001}`;

    // 3. Upload file
    console.log(chalk.bold(`\n📤  Uploading ${path.basename(resolvedPath)}...`));

    const form = new FormData();
    form.append('contract', fs.createReadStream(resolvedPath));

    const uploadRes = await fetch(`${serverBase}/upload`, { method: 'POST', body: form, headers: form.getHeaders() });
    if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        console.error(chalk.red('Upload failed:'), err.error ?? uploadRes.statusText);
        process.exit(1);
    }

    const uploadData = await uploadRes.json();
    const { sessionId, filename, totalClauses, pricePerClause, estimatedTotal } = uploadData;

    renderUploadInfo({ filename, totalClauses, pricePerClause, estimatedTotal });

    const confirm = await ask('\nProceed with analysis? (y/n): ');
    if (confirm !== 'y') {
        console.log(chalk.gray('Aborted.'));
        process.exit(0);
    }

    // 4. Set up payment-aware fetch
    let fetchWithPay;

    try {
        const { wrapFetchWithPayment } = await import('facinet-sdk');
        fetchWithPay = wrapFetchWithPayment(fetch, account);
        console.log(chalk.gray('\nUsing facinet-sdk for payments.'));
    } catch {
        try {
            const { wrapFetchWithPayment } = await import('x402-fetch');
            const walletClient = createWalletClient({
                account,
                chain: baseSepolia,
                transport: http()
            });
            fetchWithPay = wrapFetchWithPayment(fetch, walletClient);
            console.log(chalk.gray('\nUsing x402-fetch for payments.'));
        } catch {
            console.warn(chalk.yellow('\nWarning: no payment SDK found. Falling back to plain fetch (dev mode).'));
            fetchWithPay = fetch;
        }
    }

    // 5. Analyze each clause
    console.log(chalk.bold(`\n🔍  Analyzing ${totalClauses} clause(s)...\n`));

    for (let i = 0; i < totalClauses; i++) {
        console.log(chalk.gray(`Analyzing clause ${i + 1}/${totalClauses}...`));

        const analyzeRes = await fetchWithPay(`${serverBase}/analyze/${sessionId}/${i}`, { method: 'POST' });

        if (!analyzeRes.ok) {
            const err = await analyzeRes.json().catch(() => ({}));
            console.error(chalk.red(`  Clause ${i + 1} failed:`), err.error ?? analyzeRes.statusText);
        } else {
            const result = await analyzeRes.json();
            renderClauseBox(result);
        }

        if (i < totalClauses - 1) await delay(500);
    }

    // 6. Final summary
    const resultsRes = await fetch(`${serverBase}/results/${sessionId}`);
    if (!resultsRes.ok) {
        console.error(chalk.red('Failed to fetch session results.'));
        process.exit(1);
    }

    const resultsData = await resultsRes.json();
    renderSummary(resultsData.summary ? { ...resultsData.summary, results: resultsData.results } : { totalClauses, analyzedCount: totalClauses, criticalCount: 0, highCount: 0, results: [] }, filename, pricePerClause);
}

main().catch(err => {
    console.error(chalk.red('Fatal error:'), err.message);
    process.exit(1);
});
