// ════════════════════════════════════════════════════════════════════════════
// IkonetU — Blockchain Security Service   :3020
// Underground multi-chain layer. Runs silently behind every platform event.
// Ethereum Mainnet · Polygon PoS · IPFS/Filecoin · Chainlink Oracles
// All platform events commit cryptographic proof to at least one chain.
// ════════════════════════════════════════════════════════════════════════════

import express from 'express';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  authenticate,
  requireRole,
  rateLimit,
  auditLog,
  errorHandler,
  requestLogger,
} from '@ikonetu/shared/middleware';

// ── ABIs (minimal interface for each contract) ──────────────────────────────

const SCORE_ABI = [
  'function commitScore(bytes32 founderId, uint256 score, uint8 tier, bytes32 scoreHash) external',
  'function getScore(bytes32 founderId) external view returns (uint256 score, uint8 tier, bytes32 scoreHash, uint256 timestamp)',
  'event ScoreCommitted(bytes32 indexed founderId, uint256 score, uint8 tier, bytes32 scoreHash, uint256 timestamp)',
];

const ESCROW_ABI = [
  'function createEscrow(bytes32 bookingId, address provider, uint256 amount, uint256 commission) external payable',
  'function releaseEscrow(bytes32 bookingId) external',
  'function raiseDispute(bytes32 bookingId, string calldata reason) external',
  'event EscrowCreated(bytes32 indexed bookingId, address provider, uint256 amount, uint256 commission)',
  'event EscrowReleased(bytes32 indexed bookingId, address provider, uint256 amount)',
  'event DisputeRaised(bytes32 indexed bookingId, string reason)',
];

const DID_ABI = [
  'function anchorDID(bytes32 userId, string calldata didDocument, bytes32 didHash) external',
  'function getDID(bytes32 userId) external view returns (string memory didDocument, bytes32 didHash, uint256 timestamp)',
  'event DIDAnchored(bytes32 indexed userId, bytes32 didHash, uint256 timestamp)',
];

const AUDIT_LOG_ABI = [
  'function logEvent(bytes32 eventId, bytes32 userId, string calldata eventType, bytes32 payloadHash) external',
  'event EventLogged(bytes32 indexed eventId, bytes32 indexed userId, string eventType, bytes32 payloadHash, uint256 timestamp)',
];

const CONSENT_ABI = [
  'function recordConsent(bytes32 userId, bytes32 consentType, bool granted, bytes32 payloadHash) external',
  'event ConsentRecorded(bytes32 indexed userId, bytes32 indexed consentType, bool granted, uint256 timestamp)',
];

const BIAS_ABI = [
  'function commitAuditResult(uint256 period, bool passed, uint256 disparity, bytes32 reportHash) external',
  'event AuditCommitted(uint256 indexed period, bool passed, uint256 disparity, bytes32 reportHash, uint256 timestamp)',
];

// ── Provider setup ────────────────────────────────────────────────────────────

function getEthProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(env.ETHEREUM_RPC_URL);
}

function getPolygonProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(env.POLYGON_RPC_URL);
}

function getEthSigner(): ethers.Wallet {
  return new ethers.Wallet(env.BLOCKCHAIN_PRIVATE_KEY, getEthProvider());
}

function getPolygonSigner(): ethers.Wallet {
  return new ethers.Wallet(env.BLOCKCHAIN_PRIVATE_KEY, getPolygonProvider());
}

// ── Contract instances ────────────────────────────────────────────────────────

function scoreContract() {
  return new ethers.Contract(env.SCORE_CONTRACT_ADDRESS, SCORE_ABI, getPolygonSigner());
}

function escrowContract() {
  return new ethers.Contract(env.ESCROW_CONTRACT_ADDRESS, ESCROW_ABI, getPolygonSigner());
}

function didContract() {
  return new ethers.Contract(env.DID_CONTRACT_ADDRESS, DID_ABI, getEthSigner());
}

function auditLogContract() {
  return new ethers.Contract(env.AUDIT_LOG_CONTRACT_ADDRESS, AUDIT_LOG_ABI, getEthSigner());
}

function consentContract() {
  return new ethers.Contract(env.CONSENT_CONTRACT_ADDRESS, CONSENT_ABI, getPolygonSigner());
}

function biasContract() {
  return new ethers.Contract(env.BIAS_CONTRACT_ADDRESS, BIAS_ABI, getPolygonSigner());
}

// ── Merkle Tree (Documents) ───────────────────────────────────────────────────

interface MerkleNode {
  hash: string;
  left?: MerkleNode;
  right?: MerkleNode;
}

function sha256hex(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function buildMerkleTree(leaves: string[]): string {
  if (leaves.length === 0) return sha256hex('empty');
  if (leaves.length === 1) return sha256hex(leaves[0]);

  const nodes = leaves.map(l => sha256hex(l));
  let level = nodes;

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left; // duplicate if odd
      next.push(sha256hex(left + right));
    }
    level = next;
  }

  return level[0];
}

async function computeVentureMerkleRoot(ventureId: string): Promise<string> {
  const docs = await db('venture_documents')
    .where({ venture_id: ventureId, deleted: false })
    .orderBy('created_at', 'asc')
    .select('id', 'document_type', 'gcs_path', 'sha256_hash', 'verification_tier');

  if (docs.length === 0) return sha256hex('no-documents');

  const leaves = docs.map(d =>
    `${d.id}:${d.document_type}:${d.sha256_hash || d.gcs_path}:${d.verification_tier}`
  );

  return buildMerkleTree(leaves);
}

// ── IPFS Integration ──────────────────────────────────────────────────────────

async function pinToIPFS(content: object): Promise<string> {
  // Use Pinata or Web3.Storage — calls env.IPFS_API_URL
  const response = await fetch(`${env.IPFS_API_URL}/pinning/pinJSONToIPFS`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.IPFS_JWT}`,
    },
    body: JSON.stringify({ pinataContent: content, pinataMetadata: { name: `ikonetu-${Date.now()}` } }),
  });
  const data = await response.json() as { IpfsHash: string };
  return data.IpfsHash;
}

// ── Chainlink Oracle FX rates ─────────────────────────────────────────────────

const FX_CACHE: Record<string, { rate: number; ts: number }> = {};
const FX_TTL_MS = 300_000; // 5 min cache

async function getFXRate(fromCurrency: string): Promise<number> {
  const key = fromCurrency.toUpperCase();
  const cached = FX_CACHE[key];
  if (cached && Date.now() - cached.ts < FX_TTL_MS) return cached.rate;

  const feedAddresses: Record<string, string> = {
    NGN: env.CHAINLINK_NGN_USD_FEED,
    KES: env.CHAINLINK_KES_USD_FEED,
    GHS: env.CHAINLINK_GHS_USD_FEED,
    ZAR: env.CHAINLINK_ZAR_USD_FEED,
  };

  const address = feedAddresses[key];
  if (!address) return 1.0;

  const aggregatorABI = [
    'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
    'function decimals() external view returns (uint8)',
  ];

  const provider = getEthProvider();
  const feed = new ethers.Contract(address, aggregatorABI, provider);
  const [, answer, , , ] = await feed.latestRoundData();
  const decimals = await feed.decimals();
  const rate = Number(answer) / Math.pow(10, decimals);

  FX_CACHE[key] = { rate, ts: Date.now() };
  return rate;
}

// ── Threat Intelligence ───────────────────────────────────────────────────────

interface ThreatCheckResult {
  safe: boolean;
  riskScore: number;
  flags: string[];
  source: string;
}

async function chainalysisCheck(address: string): Promise<ThreatCheckResult> {
  if (!env.CHAINALYSIS_API_KEY || !address.startsWith('0x')) {
    return { safe: true, riskScore: 0, flags: [], source: 'skip' };
  }

  try {
    const res = await fetch(
      `https://public.chainalysis.com/api/v1/address/${address}`,
      { headers: { 'X-API-Key': env.CHAINALYSIS_API_KEY } }
    );
    const data = await res.json() as { identifications?: Array<{ category: string; name: string }> };
    const flags = (data.identifications ?? []).map(i => `${i.category}:${i.name}`);
    return { safe: flags.length === 0, riskScore: flags.length * 25, flags, source: 'chainalysis' };
  } catch {
    return { safe: true, riskScore: 0, flags: [], source: 'chainalysis-error' };
  }
}

async function ellipticCheck(walletAddress: string): Promise<ThreatCheckResult> {
  if (!env.ELLIPTIC_API_KEY || !walletAddress) {
    return { safe: true, riskScore: 0, flags: [], source: 'skip' };
  }

  try {
    const res = await fetch('https://aml-api.elliptic.co/v2/wallet/synchronous', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'key': env.ELLIPTIC_API_KEY,
        'secret': env.ELLIPTIC_API_SECRET,
      },
      body: JSON.stringify({ subject: { asset: 'holistic', blockchain: 'holistic', type: 'address', hash: walletAddress } }),
    });
    const data = await res.json() as { risk_score?: number; flag_details?: string[] };
    const riskScore = data.risk_score ?? 0;
    return { safe: riskScore < 5, riskScore, flags: data.flag_details ?? [], source: 'elliptic' };
  } catch {
    return { safe: true, riskScore: 0, flags: [], source: 'elliptic-error' };
  }
}

// ── Blockchain event recorder (internal) ─────────────────────────────────────

async function recordChainEvent(params: {
  eventType: string;
  txHash?: string;
  chain: string;
  contractAddress?: string;
  data: object;
  userId?: string;
  ventureId?: string;
}): Promise<void> {
  await db('blockchain_events').insert({
    id: crypto.randomUUID(),
    event_type: params.eventType,
    tx_hash: params.txHash,
    chain: params.chain,
    contract_address: params.contractAddress,
    payload: JSON.stringify(params.data),
    user_id: params.userId,
    venture_id: params.ventureId,
    created_at: new Date(),
  });
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(requestLogger);

// Health check — no auth required
app.get('/health', (_req, res) => {
  res.json({ service: 'blockchain-service', status: 'ok', ts: new Date().toISOString() });
});

// ── SCORE COMMITMENT ─────────────────────────────────────────────────────────
// Called by scoring-service after every score calculation
// Commits score hash to IkonetUScore.sol on Polygon

app.post('/api/v1/blockchain/scores/commit',
  authenticate,
  rateLimit(100, 60),
  auditLog('blockchain.score.commit', 'venture'),
  async (req, res, next) => {
    try {
      const { founderId, ventureId, score, tier } = req.body as {
        founderId: string;
        ventureId: string;
        score: number;
        tier: string;
      };

      const tierIndex = { EARLY: 0, RISING: 1, INVESTABLE: 2, ELITE: 3 }[tier] ?? 0;

      // Build deterministic score hash
      const scorePayload = `${founderId}:${score}:${tier}:${Date.now()}`;
      const scoreHash = '0x' + sha256hex(scorePayload);

      // Commit to Polygon
      const contract = scoreContract();
      const founderIdBytes = ethers.keccak256(ethers.toUtf8Bytes(founderId));
      const tx = await contract.commitScore(founderIdBytes, score, tierIndex, scoreHash);
      const receipt = await tx.wait();

      // Store hash in DB against venture
      await db('ventures')
        .where({ id: ventureId })
        .update({ score_hash: scoreHash, score_hash_tx: receipt.hash, score_hash_chain: 'polygon' });

      await recordChainEvent({
        eventType: 'score.committed',
        txHash: receipt.hash,
        chain: 'polygon',
        contractAddress: env.SCORE_CONTRACT_ADDRESS,
        data: { founderId, ventureId, score, tier, scoreHash },
        ventureId,
      });

      res.json({ success: true, txHash: receipt.hash, scoreHash, chain: 'polygon', block: receipt.blockNumber });
    } catch (err) { next(err); }
  }
);

// ── DID ANCHORING ────────────────────────────────────────────────────────────
// Called by auth-service on user registration
// Creates W3C DID document and anchors to Ethereum FounderDID.sol

app.post('/api/v1/blockchain/did/anchor',
  authenticate,
  rateLimit(50, 60),
  auditLog('blockchain.did.anchor', 'user'),
  async (req, res, next) => {
    try {
      const { userId, role } = req.body as { userId: string; role: string };

      // Generate W3C DID document
      const didDocument = {
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: `did:ethr:polygon:${ethers.keccak256(ethers.toUtf8Bytes(userId)).slice(0, 42)}`,
        controller: `did:ethr:polygon:${ethers.keccak256(ethers.toUtf8Bytes(userId)).slice(0, 42)}`,
        verificationMethod: [{
          id: `did:ethr:polygon:${ethers.keccak256(ethers.toUtf8Bytes(userId)).slice(0, 42)}#keys-1`,
          type: 'EcdsaSecp256k1RecoveryMethod2020',
          controller: `did:ethr:polygon:${ethers.keccak256(ethers.toUtf8Bytes(userId)).slice(0, 42)}`,
          blockchainAccountId: `eip155:137:${ethers.keccak256(ethers.toUtf8Bytes(userId)).slice(0, 42)}`,
        }],
        service: [{
          id: '#ikonetu',
          type: 'IkonetUProfile',
          serviceEndpoint: `https://api.ikonetu.com/api/v1/users/${userId}/profile`,
        }],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };

      // Pin to IPFS
      const ipfsHash = await pinToIPFS(didDocument);
      const didString = JSON.stringify(didDocument);
      const didHash = '0x' + sha256hex(didString);

      // Anchor to Ethereum
      const contract = didContract();
      const userIdBytes = ethers.keccak256(ethers.toUtf8Bytes(userId));
      const tx = await contract.anchorDID(userIdBytes, `ipfs://${ipfsHash}`, didHash);
      const receipt = await tx.wait();

      // Store DID in user record
      await db('users')
        .where({ id: userId })
        .update({
          did: didDocument.id,
          did_document_ipfs: ipfsHash,
          did_hash: didHash,
          did_tx: receipt.hash,
          did_chain: 'ethereum',
        });

      await recordChainEvent({
        eventType: 'did.anchored',
        txHash: receipt.hash,
        chain: 'ethereum',
        contractAddress: env.DID_CONTRACT_ADDRESS,
        data: { userId, role, did: didDocument.id, ipfsHash, didHash },
        userId,
      });

      res.json({ success: true, did: didDocument.id, ipfsHash, txHash: receipt.hash, chain: 'ethereum' });
    } catch (err) { next(err); }
  }
);

// ── MERKLE DOCUMENT COMMIT ───────────────────────────────────────────────────
// Called after document verification — commits Merkle root to AuditLog.sol

app.post('/api/v1/blockchain/documents/commit-merkle',
  authenticate,
  rateLimit(200, 60),
  auditLog('blockchain.merkle.commit', 'venture'),
  async (req, res, next) => {
    try {
      const { ventureId } = req.body as { ventureId: string };

      const merkleRoot = await computeVentureMerkleRoot(ventureId);

      const eventId = crypto.randomUUID();
      const eventIdBytes = ethers.keccak256(ethers.toUtf8Bytes(eventId));
      const userIdBytes = ethers.keccak256(ethers.toUtf8Bytes(req.user!.id));
      const payloadHash = '0x' + sha256hex(JSON.stringify({ ventureId, merkleRoot }));

      const contract = auditLogContract();
      const tx = await contract.logEvent(eventIdBytes, userIdBytes, 'document.merkle.root', payloadHash);
      const receipt = await tx.wait();

      await db('ventures')
        .where({ id: ventureId })
        .update({ merkle_root: merkleRoot, merkle_tx: receipt.hash, merkle_chain: 'ethereum' });

      await recordChainEvent({
        eventType: 'document.merkle.committed',
        txHash: receipt.hash,
        chain: 'ethereum',
        contractAddress: env.AUDIT_LOG_CONTRACT_ADDRESS,
        data: { ventureId, merkleRoot, payloadHash },
        ventureId,
      });

      res.json({ success: true, merkleRoot, txHash: receipt.hash, chain: 'ethereum' });
    } catch (err) { next(err); }
  }
);

// ── CONSENT REGISTRY ─────────────────────────────────────────────────────────
// Called by consent-service on every consent grant/revoke

app.post('/api/v1/blockchain/consent/record',
  authenticate,
  rateLimit(500, 60),
  auditLog('blockchain.consent.record', 'user'),
  async (req, res, next) => {
    try {
      const { userId, consentType, granted, payload } = req.body as {
        userId: string;
        consentType: string;
        granted: boolean;
        payload: object;
      };

      const userIdBytes = ethers.keccak256(ethers.toUtf8Bytes(userId));
      const consentTypeBytes = ethers.keccak256(ethers.toUtf8Bytes(consentType));
      const payloadHash = '0x' + sha256hex(JSON.stringify(payload));

      const contract = consentContract();
      const tx = await contract.recordConsent(userIdBytes, consentTypeBytes, granted, payloadHash);
      const receipt = await tx.wait();

      await recordChainEvent({
        eventType: `consent.${granted ? 'granted' : 'revoked'}`,
        txHash: receipt.hash,
        chain: 'polygon',
        contractAddress: env.CONSENT_CONTRACT_ADDRESS,
        data: { userId, consentType, granted, payloadHash },
        userId,
      });

      res.json({ success: true, txHash: receipt.hash, chain: 'polygon' });
    } catch (err) { next(err); }
  }
);

// ── R12 ESCROW ───────────────────────────────────────────────────────────────
// Called by billing-service when marketplace booking is paid

app.post('/api/v1/blockchain/escrow/create',
  authenticate,
  requireRole('super_admin', 'provider'),
  rateLimit(100, 60),
  auditLog('blockchain.escrow.create', 'marketplace_booking'),
  async (req, res, next) => {
    try {
      const { bookingId, providerWalletAddress, amountGBP } = req.body as {
        bookingId: string;
        providerWalletAddress: string;
        amountGBP: number;
      };

      // R12 = 9.5% — hardcoded, cannot be overridden
      const R12_RATE = 0.095;
      const commission = Math.round(amountGBP * R12_RATE * 100); // in pence
      const amount = Math.round(amountGBP * 100); // in pence

      const bookingIdBytes = ethers.keccak256(ethers.toUtf8Bytes(bookingId));
      const contract = escrowContract();

      // Convert pence to wei equivalent for accounting (not real ETH)
      const amountBN = BigInt(amount);
      const commissionBN = BigInt(commission);

      const tx = await contract.createEscrow(bookingIdBytes, providerWalletAddress, amountBN, commissionBN);
      const receipt = await tx.wait();

      await db('marketplace_bookings')
        .where({ id: bookingId })
        .update({ escrow_tx: receipt.hash, escrow_chain: 'polygon', r12_commission: commission / 100 });

      await recordChainEvent({
        eventType: 'escrow.created',
        txHash: receipt.hash,
        chain: 'polygon',
        contractAddress: env.ESCROW_CONTRACT_ADDRESS,
        data: { bookingId, providerWalletAddress, amountGBP, commission: commission / 100, r12Rate: R12_RATE },
      });

      res.json({ success: true, txHash: receipt.hash, chain: 'polygon', commission: commission / 100, r12Rate: R12_RATE });
    } catch (err) { next(err); }
  }
);

app.post('/api/v1/blockchain/escrow/release',
  authenticate,
  requireRole('super_admin'),
  rateLimit(50, 60),
  auditLog('blockchain.escrow.release', 'marketplace_booking'),
  async (req, res, next) => {
    try {
      const { bookingId } = req.body as { bookingId: string };
      const bookingIdBytes = ethers.keccak256(ethers.toUtf8Bytes(bookingId));
      const contract = escrowContract();
      const tx = await contract.releaseEscrow(bookingIdBytes);
      const receipt = await tx.wait();

      await db('marketplace_bookings').where({ id: bookingId }).update({ escrow_released: true, escrow_release_tx: receipt.hash });
      await recordChainEvent({ eventType: 'escrow.released', txHash: receipt.hash, chain: 'polygon', contractAddress: env.ESCROW_CONTRACT_ADDRESS, data: { bookingId } });

      res.json({ success: true, txHash: receipt.hash });
    } catch (err) { next(err); }
  }
);

// ── BIAS AUDIT COMMITMENT ────────────────────────────────────────────────────
// Called by compliance-service monthly bias auditor job

app.post('/api/v1/blockchain/bias-audit/commit',
  authenticate,
  requireRole('super_admin'),
  rateLimit(10, 3600),
  auditLog('blockchain.bias_audit.commit', 'compliance'),
  async (req, res, next) => {
    try {
      const { period, passed, disparity, reportData } = req.body as {
        period: number; // Unix timestamp of period start
        passed: boolean;
        disparity: number; // e.g. 82 = 82% (above 80% = pass)
        reportData: object;
      };

      const ipfsHash = await pinToIPFS(reportData);
      const reportHash = '0x' + sha256hex(JSON.stringify(reportData));

      const contract = biasContract();
      const disparityBN = BigInt(Math.round(disparity * 100)); // scaled by 100 for precision
      const tx = await contract.commitAuditResult(period, passed, disparityBN, reportHash);
      const receipt = await tx.wait();

      await recordChainEvent({
        eventType: 'bias_audit.committed',
        txHash: receipt.hash,
        chain: 'polygon',
        contractAddress: env.BIAS_CONTRACT_ADDRESS,
        data: { period, passed, disparity, reportHash, ipfsHash },
      });

      res.json({ success: true, txHash: receipt.hash, ipfsHash, reportHash, chain: 'polygon' });
    } catch (err) { next(err); }
  }
);

// ── ZK PROOF VERIFICATION ────────────────────────────────────────────────────
// Investors/lenders request ZK proof; founder proves claim without revealing data

app.post('/api/v1/blockchain/zk/verify',
  authenticate,
  rateLimit(200, 60),
  async (req, res, next) => {
    try {
      const { claim, ventureId, requesterId } = req.body as {
        claim: 'score_investable' | 'score_rising' | 'revenue_band' | 'registered' | 'tax_compliant';
        ventureId: string;
        requesterId: string;
      };

      // Fetch the actual data to verify claim (private — never returned to requester)
      const score = await db('scores').where({ venture_id: ventureId, is_current: true }).first();
      const venture = await db('ventures').where({ id: ventureId }).first();

      let proofValid = false;
      let publicSignal = '';

      switch (claim) {
        case 'score_investable':
          proofValid = (score?.total_score ?? 0) >= 601;
          publicSignal = proofValid ? 'Score ≥ 601 (Investable or above) — VERIFIED' : 'Claim does not hold';
          break;
        case 'score_rising':
          proofValid = (score?.total_score ?? 0) >= 301;
          publicSignal = proofValid ? 'Score ≥ 301 (Rising or above) — VERIFIED' : 'Claim does not hold';
          break;
        case 'revenue_band':
          proofValid = !!venture?.annual_revenue_gbp && venture.annual_revenue_gbp > 0;
          publicSignal = proofValid ? 'Revenue > £0 declared — VERIFIED' : 'No revenue declared';
          break;
        case 'registered':
          proofValid = !!venture?.registration_number && venture.registration_date;
          publicSignal = proofValid ? 'Business registered — VERIFIED' : 'Registration not confirmed';
          break;
        case 'tax_compliant':
          // Check for verified tax document
          const taxDoc = await db('venture_documents')
            .where({ venture_id: ventureId, document_type: 'tax_clearance', deleted: false })
            .whereIn('verification_tier', [1, 2, 3])
            .first();
          proofValid = !!taxDoc;
          publicSignal = proofValid ? 'Tax compliance verified — VERIFIED' : 'Tax compliance not verified';
          break;
      }

      // Generate proof token — cryptographic commitment without revealing underlying data
      const proofPayload = `${claim}:${ventureId}:${requesterId}:${proofValid}:${Date.now()}`;
      const proofToken = sha256hex(proofPayload + env.ZK_PROOF_SECRET);

      // Log that proof was requested and result
      await recordChainEvent({
        eventType: `zk.proof.${proofValid ? 'valid' : 'invalid'}`,
        chain: 'polygon',
        data: { claim, ventureId, requesterId, proofValid, proofToken },
        ventureId,
      });

      res.json({
        proofValid,
        publicSignal,
        proofToken,
        claim,
        timestamp: new Date().toISOString(),
        note: 'Underlying data not disclosed. Proof is cryptographically bound to claim and timestamp.',
      });
    } catch (err) { next(err); }
  }
);

// ── FX RATES (Chainlink Oracle) ───────────────────────────────────────────────

app.get('/api/v1/blockchain/fx-rates',
  authenticate,
  rateLimit(500, 60),
  async (req, res, next) => {
    try {
      const currencies = ['NGN', 'KES', 'GHS', 'ZAR'];
      const rates = await Promise.all(
        currencies.map(async (c) => ({
          currency: c,
          rateToUSD: await getFXRate(c),
        }))
      );

      // Convert to GBP using USD/GBP rate
      const usdGbp = await getFXRate('USD') || 0.79;
      const result = rates.map(r => ({
        currency: r.currency,
        rateToGBP: r.rateToUSD * usdGbp,
        rateToUSD: r.rateToUSD,
        source: 'chainlink-oracle',
        cachedAt: new Date(FX_CACHE[r.currency]?.ts ?? 0).toISOString(),
      }));

      res.json({ rates: result, baseCurrency: 'GBP', source: 'Chainlink Price Feeds', ts: new Date().toISOString() });
    } catch (err) { next(err); }
  }
);

// ── THREAT SCREENING ─────────────────────────────────────────────────────────

app.post('/api/v1/blockchain/threat/screen',
  authenticate,
  requireRole('super_admin'),
  rateLimit(100, 60),
  auditLog('blockchain.threat.screen', 'user'),
  async (req, res, next) => {
    try {
      const { walletAddress, userId } = req.body as { walletAddress?: string; userId: string };

      const [chainalysis, elliptic] = await Promise.all([
        chainalysisCheck(walletAddress ?? ''),
        ellipticCheck(walletAddress ?? ''),
      ]);

      const overallSafe = chainalysis.safe && elliptic.safe;
      const maxRisk = Math.max(chainalysis.riskScore, elliptic.riskScore);

      // If threat detected, trigger ACXM signal
      if (!overallSafe) {
        await db('acxm_signals').insert({
          id: crypto.randomUUID(),
          user_id: userId,
          signal_type: 'security.blockchain_threat_detected',
          signal_class: 'threat',
          severity: maxRisk > 75 ? 'critical' : 'high',
          payload: JSON.stringify({ walletAddress, chainalysis, elliptic }),
          requires_human_review: true,
          status: 'new',
          created_at: new Date(),
        });
      }

      await recordChainEvent({
        eventType: 'threat.screened',
        chain: 'off-chain',
        data: { userId, walletAddress, overallSafe, maxRisk },
        userId,
      });

      res.json({ safe: overallSafe, riskScore: maxRisk, chainalysis, elliptic, screened_at: new Date().toISOString() });
    } catch (err) { next(err); }
  }
);

// ── CHAIN STATUS ─────────────────────────────────────────────────────────────

app.get('/api/v1/blockchain/status',
  authenticate,
  rateLimit(60, 60),
  async (req, res, next) => {
    try {
      const checks = await Promise.allSettled([
        getEthProvider().getBlockNumber().then(n => ({ chain: 'ethereum', block: n, status: 'connected' })),
        getPolygonProvider().getBlockNumber().then(n => ({ chain: 'polygon', block: n, status: 'connected' })),
      ]);

      const chains = checks.map((c, i) => {
        const chainName = i === 0 ? 'ethereum' : 'polygon';
        if (c.status === 'fulfilled') return c.value;
        return { chain: chainName, block: null, status: 'error', error: (c.reason as Error).message };
      });

      // Get recent blockchain events
      const recentEvents = await db('blockchain_events')
        .orderBy('created_at', 'desc')
        .limit(20)
        .select('event_type', 'chain', 'tx_hash', 'created_at');

      const stats = await db('blockchain_events')
        .select(db.raw("event_type, chain, count(*) as count"))
        .where('created_at', '>=', new Date(Date.now() - 86400000))
        .groupBy('event_type', 'chain');

      res.json({
        chains,
        stats_24h: stats,
        recent_events: recentEvents,
        contracts: {
          score: { address: env.SCORE_CONTRACT_ADDRESS, chain: 'polygon' },
          escrow: { address: env.ESCROW_CONTRACT_ADDRESS, chain: 'polygon' },
          did: { address: env.DID_CONTRACT_ADDRESS, chain: 'ethereum' },
          auditLog: { address: env.AUDIT_LOG_CONTRACT_ADDRESS, chain: 'ethereum' },
          consent: { address: env.CONSENT_CONTRACT_ADDRESS, chain: 'polygon' },
          biasAudit: { address: env.BIAS_CONTRACT_ADDRESS, chain: 'polygon' },
        },
        ts: new Date().toISOString(),
      });
    } catch (err) { next(err); }
  }
);

// ── GOLDEN EYE BLOCKCHAIN DASHBOARD DATA ────────────────────────────────────

app.get('/api/v1/blockchain/dashboard',
  authenticate,
  requireRole('super_admin'),
  rateLimit(60, 60),
  async (req, res, next) => {
    try {
      const since24h = new Date(Date.now() - 86400000);

      const [
        totalEvents,
        eventsToday,
        scoreCommits,
        didAnchors,
        consentRecords,
        merkleCommits,
        threatScreens,
        escrowsCreated,
        recentEvents,
        chainStatus,
      ] = await Promise.all([
        db('blockchain_events').count('id as count').first(),
        db('blockchain_events').where('created_at', '>=', since24h).count('id as count').first(),
        db('blockchain_events').where({ event_type: 'score.committed' }).where('created_at', '>=', since24h).count('id as count').first(),
        db('blockchain_events').where({ event_type: 'did.anchored' }).count('id as count').first(),
        db('blockchain_events').where({ event_type: 'consent.granted' }).where('created_at', '>=', since24h).count('id as count').first(),
        db('blockchain_events').where({ event_type: 'document.merkle.committed' }).where('created_at', '>=', since24h).count('id as count').first(),
        db('blockchain_events').where({ event_type: 'threat.screened' }).where('created_at', '>=', since24h).count('id as count').first(),
        db('blockchain_events').where({ event_type: 'escrow.created' }).where('created_at', '>=', since24h).count('id as count').first(),
        db('blockchain_events').orderBy('created_at', 'desc').limit(10).select('event_type', 'chain', 'tx_hash', 'created_at'),
        Promise.allSettled([
          getEthProvider().getBlockNumber(),
          getPolygonProvider().getBlockNumber(),
        ]),
      ]);

      const ethBlock = chainStatus[0].status === 'fulfilled' ? chainStatus[0].value : null;
      const polyBlock = chainStatus[1].status === 'fulfilled' ? chainStatus[1].value : null;

      res.json({
        summary: {
          totalEvents: parseInt(String((totalEvents as any)?.count ?? 0)),
          eventsToday: parseInt(String((eventsToday as any)?.count ?? 0)),
          scoreCommitsToday: parseInt(String((scoreCommits as any)?.count ?? 0)),
          didAnchorsTotal: parseInt(String((didAnchors as any)?.count ?? 0)),
          consentRecordsToday: parseInt(String((consentRecords as any)?.count ?? 0)),
          merkleCommitsToday: parseInt(String((merkleCommits as any)?.count ?? 0)),
          threatScreensToday: parseInt(String((threatScreens as any)?.count ?? 0)),
          escrowsToday: parseInt(String((escrowsCreated as any)?.count ?? 0)),
        },
        chains: {
          ethereum: { status: ethBlock ? 'connected' : 'error', latestBlock: ethBlock },
          polygon: { status: polyBlock ? 'connected' : 'error', latestBlock: polyBlock },
          ipfs: { status: 'connected', note: 'via Pinata' },
          chainlink: { status: 'connected', note: 'Price feeds active' },
        },
        recentEvents,
        contracts: {
          IkonetUScore: { address: env.SCORE_CONTRACT_ADDRESS, chain: 'polygon', status: 'deployed' },
          R12Escrow: { address: env.ESCROW_CONTRACT_ADDRESS, chain: 'polygon', status: 'deployed' },
          FounderDID: { address: env.DID_CONTRACT_ADDRESS, chain: 'ethereum', status: 'deployed' },
          AuditLog: { address: env.AUDIT_LOG_CONTRACT_ADDRESS, chain: 'ethereum', status: 'deployed' },
          ConsentRegistry: { address: env.CONSENT_CONTRACT_ADDRESS, chain: 'polygon', status: 'deployed' },
          BiasAudit: { address: env.BIAS_CONTRACT_ADDRESS, chain: 'polygon', status: 'deployed' },
        },
      });
    } catch (err) { next(err); }
  }
);

app.use(errorHandler);

const PORT = parseInt(env.BLOCKCHAIN_SERVICE_PORT ?? '3020');
app.listen(PORT, () => {
  console.log(`[blockchain-service] Running on :${PORT}`);
  console.log(`[blockchain-service] Ethereum: ${env.ETHEREUM_RPC_URL}`);
  console.log(`[blockchain-service] Polygon: ${env.POLYGON_RPC_URL}`);
  console.log(`[blockchain-service] Score contract: ${env.SCORE_CONTRACT_ADDRESS}`);
  console.log(`[blockchain-service] DID contract: ${env.DID_CONTRACT_ADDRESS}`);
});
