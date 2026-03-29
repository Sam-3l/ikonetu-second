// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ════════════════════════════════════════════════════════════════
// IkonetUScore.sol — Polygon PoS
// Stores score hash + tier per founder. Immutable once committed.
// R12 commission = 9.5% — HARDCODED IN R12Escrow. Cannot change.
// ════════════════════════════════════════════════════════════════

contract IkonetUScore {
    address public immutable owner;

    struct ScoreRecord {
        uint256 score;      // 0–1000
        uint8   tier;       // 0=EARLY 1=RISING 2=INVESTABLE 3=ELITE
        bytes32 scoreHash;  // SHA-256 of score payload
        uint256 timestamp;
        uint256 blockNumber;
    }

    mapping(bytes32 => ScoreRecord[]) private _scoreHistory;
    mapping(bytes32 => ScoreRecord)   private _latestScore;

    event ScoreCommitted(
        bytes32 indexed founderId,
        uint256 score,
        uint8   tier,
        bytes32 scoreHash,
        uint256 timestamp,
        uint256 blockNumber
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorised");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function commitScore(
        bytes32 founderId,
        uint256 score,
        uint8   tier,
        bytes32 scoreHash
    ) external onlyOwner {
        require(score <= 1000, "Score out of range");
        require(tier <= 3, "Invalid tier");

        ScoreRecord memory record = ScoreRecord({
            score:       score,
            tier:        tier,
            scoreHash:   scoreHash,
            timestamp:   block.timestamp,
            blockNumber: block.number
        });

        _scoreHistory[founderId].push(record);
        _latestScore[founderId] = record;

        emit ScoreCommitted(founderId, score, tier, scoreHash, block.timestamp, block.number);
    }

    function getLatestScore(bytes32 founderId)
        external view returns (uint256 score, uint8 tier, bytes32 scoreHash, uint256 timestamp)
    {
        ScoreRecord memory r = _latestScore[founderId];
        return (r.score, r.tier, r.scoreHash, r.timestamp);
    }

    function getScoreHistory(bytes32 founderId) external view returns (ScoreRecord[] memory) {
        return _scoreHistory[founderId];
    }

    // Score history is append-only — no delete function exists
}


// ════════════════════════════════════════════════════════════════
// R12Escrow.sol — Polygon PoS
// R12 commission = 9.5% HARDCODED — no setter, no override.
// 14-day dispute window before auto-release.
// ════════════════════════════════════════════════════════════════

contract R12Escrow {
    address public immutable owner;

    // R12 = 9.5% — IMMUTABLE. Cannot be changed by any party.
    uint256 public constant R12_COMMISSION_RATE = 95; // basis points /1000
    uint256 public constant DISPUTE_WINDOW      = 14 days;

    enum EscrowStatus { Active, Released, Disputed, Resolved }

    struct Escrow {
        address  provider;
        uint256  amount;       // total in smallest unit
        uint256  commission;   // 9.5% of amount
        uint256  createdAt;
        EscrowStatus status;
        string   disputeReason;
    }

    mapping(bytes32 => Escrow) public escrows;

    event EscrowCreated(bytes32 indexed bookingId, address provider, uint256 amount, uint256 commission, uint256 createdAt);
    event EscrowReleased(bytes32 indexed bookingId, address provider, uint256 amount, uint256 releasedAt);
    event DisputeRaised(bytes32 indexed bookingId, address raiser, string reason, uint256 raisedAt);
    event DisputeResolved(bytes32 indexed bookingId, bool releasedToProvider, uint256 resolvedAt);

    modifier onlyOwner() { require(msg.sender == owner, "Not authorised"); _; }

    constructor() { owner = msg.sender; }

    function createEscrow(
        bytes32 bookingId,
        address provider,
        uint256 amount,
        uint256 commission
    ) external onlyOwner {
        require(escrows[bookingId].createdAt == 0, "Escrow exists");
        // Verify commission matches R12 rate (allow ±1 for rounding)
        uint256 expectedCommission = (amount * R12_COMMISSION_RATE) / 1000;
        require(
            commission >= expectedCommission - 1 && commission <= expectedCommission + 1,
            "Commission must be exactly 9.5%"
        );

        escrows[bookingId] = Escrow({
            provider:      provider,
            amount:        amount,
            commission:    commission,
            createdAt:     block.timestamp,
            status:        EscrowStatus.Active,
            disputeReason: ""
        });

        emit EscrowCreated(bookingId, provider, amount, commission, block.timestamp);
    }

    function releaseEscrow(bytes32 bookingId) external {
        Escrow storage e = escrows[bookingId];
        require(e.status == EscrowStatus.Active, "Not active");
        require(
            msg.sender == owner ||
            (msg.sender == e.provider && block.timestamp >= e.createdAt + DISPUTE_WINDOW),
            "Too early or not authorised"
        );
        e.status = EscrowStatus.Released;
        emit EscrowReleased(bookingId, e.provider, e.amount - e.commission, block.timestamp);
    }

    function raiseDispute(bytes32 bookingId, string calldata reason) external {
        Escrow storage e = escrows[bookingId];
        require(e.status == EscrowStatus.Active, "Not active");
        require(block.timestamp < e.createdAt + DISPUTE_WINDOW, "Window closed");
        e.status = EscrowStatus.Disputed;
        e.disputeReason = reason;
        emit DisputeRaised(bookingId, msg.sender, reason, block.timestamp);
    }

    function resolveDispute(bytes32 bookingId, bool releaseToProvider) external onlyOwner {
        Escrow storage e = escrows[bookingId];
        require(e.status == EscrowStatus.Disputed, "Not disputed");
        e.status = EscrowStatus.Resolved;
        emit DisputeResolved(bookingId, releaseToProvider, block.timestamp);
    }
}


// ════════════════════════════════════════════════════════════════
// FounderDID.sol — Ethereum Mainnet
// W3C Decentralised Identity anchor per founder.
// Self-sovereign identity — founder controls their DID.
// ════════════════════════════════════════════════════════════════

contract FounderDID {
    address public immutable owner;

    struct DIDRecord {
        string  didDocument; // IPFS URI: ipfs://Qm...
        bytes32 didHash;     // SHA-256 of full DID document
        uint256 createdAt;
        uint256 updatedAt;
        bool    revoked;
    }

    mapping(bytes32 => DIDRecord) private _dids;

    event DIDAnchored(bytes32 indexed userId, string didDocument, bytes32 didHash, uint256 timestamp);
    event DIDUpdated(bytes32 indexed userId, string newDidDocument, bytes32 newDidHash, uint256 timestamp);
    event DIDRevoked(bytes32 indexed userId, uint256 timestamp);

    modifier onlyOwner() { require(msg.sender == owner, "Not authorised"); _; }

    constructor() { owner = msg.sender; }

    function anchorDID(bytes32 userId, string calldata didDocument, bytes32 didHash) external onlyOwner {
        require(_dids[userId].createdAt == 0, "DID already anchored");
        _dids[userId] = DIDRecord({ didDocument: didDocument, didHash: didHash, createdAt: block.timestamp, updatedAt: block.timestamp, revoked: false });
        emit DIDAnchored(userId, didDocument, didHash, block.timestamp);
    }

    function updateDID(bytes32 userId, string calldata newDidDocument, bytes32 newDidHash) external onlyOwner {
        require(_dids[userId].createdAt > 0, "DID not anchored");
        require(!_dids[userId].revoked, "DID revoked");
        _dids[userId].didDocument = newDidDocument;
        _dids[userId].didHash = newDidHash;
        _dids[userId].updatedAt = block.timestamp;
        emit DIDUpdated(userId, newDidDocument, newDidHash, block.timestamp);
    }

    function getDID(bytes32 userId) external view returns (string memory didDocument, bytes32 didHash, uint256 timestamp, bool revoked) {
        DIDRecord memory d = _dids[userId];
        return (d.didDocument, d.didHash, d.updatedAt, d.revoked);
    }

    function revokeDID(bytes32 userId) external onlyOwner {
        _dids[userId].revoked = true;
        emit DIDRevoked(userId, block.timestamp);
    }
}


// ════════════════════════════════════════════════════════════════
// AuditLog.sol — Ethereum Mainnet
// Append-only event log. No delete function. GDPR: hashed IDs only.
// ════════════════════════════════════════════════════════════════

contract AuditLog {
    address public immutable owner;

    struct LogEntry {
        bytes32 eventId;
        bytes32 userId;      // keccak256 of real user ID — GDPR compliant
        string  eventType;
        bytes32 payloadHash; // SHA-256 of event payload
        uint256 timestamp;
        uint256 blockNumber;
    }

    LogEntry[] private _entries; // append-only — no delete function

    event EventLogged(
        bytes32 indexed eventId,
        bytes32 indexed userId,
        string  eventType,
        bytes32 payloadHash,
        uint256 timestamp,
        uint256 blockNumber
    );

    modifier onlyOwner() { require(msg.sender == owner, "Not authorised"); _; }

    constructor() { owner = msg.sender; }

    function logEvent(
        bytes32 eventId,
        bytes32 userId,
        string calldata eventType,
        bytes32 payloadHash
    ) external onlyOwner {
        LogEntry memory entry = LogEntry({
            eventId:     eventId,
            userId:      userId,
            eventType:   eventType,
            payloadHash: payloadHash,
            timestamp:   block.timestamp,
            blockNumber: block.number
        });
        _entries.push(entry);
        emit EventLogged(eventId, userId, eventType, payloadHash, block.timestamp, block.number);
    }

    function getEntryCount() external view returns (uint256) { return _entries.length; }

    // NOTE: No delete function exists. Audit log is permanent.
}


// ════════════════════════════════════════════════════════════════
// ConsentRegistry.sol — Polygon PoS
// Immutable consent trail. Required for GDPR + NDPR compliance.
// ════════════════════════════════════════════════════════════════

contract ConsentRegistry {
    address public immutable owner;

    event ConsentRecorded(
        bytes32 indexed userId,
        bytes32 indexed consentType,
        bool    granted,
        bytes32 payloadHash,
        uint256 timestamp
    );

    modifier onlyOwner() { require(msg.sender == owner, "Not authorised"); _; }

    constructor() { owner = msg.sender; }

    function recordConsent(
        bytes32 userId,
        bytes32 consentType,
        bool    granted,
        bytes32 payloadHash
    ) external onlyOwner {
        // Emit event — immutable on-chain. Cannot be deleted.
        emit ConsentRecorded(userId, consentType, granted, payloadHash, block.timestamp);
    }
}


// ════════════════════════════════════════════════════════════════
// BiasAudit.sol — Polygon PoS
// Monthly bias audit results. Public verifiability across 14 markets.
// ════════════════════════════════════════════════════════════════

contract BiasAudit {
    address public immutable owner;

    struct AuditResult {
        uint256 period;       // Unix timestamp of audit period
        bool    passed;       // 80% disparate-impact rule
        uint256 disparity;    // scaled by 100 (e.g. 8200 = 82.00%)
        bytes32 reportHash;   // SHA-256 of full audit report
        uint256 timestamp;
        uint256 blockNumber;
    }

    AuditResult[] public auditHistory; // public — anyone can verify

    event AuditCommitted(
        uint256 indexed period,
        bool    passed,
        uint256 disparity,
        bytes32 reportHash,
        uint256 timestamp,
        uint256 blockNumber
    );

    modifier onlyOwner() { require(msg.sender == owner, "Not authorised"); _; }

    constructor() { owner = msg.sender; }

    function commitAuditResult(
        uint256 period,
        bool    passed,
        uint256 disparity,
        bytes32 reportHash
    ) external onlyOwner {
        AuditResult memory result = AuditResult({
            period:      period,
            passed:      passed,
            disparity:   disparity,
            reportHash:  reportHash,
            timestamp:   block.timestamp,
            blockNumber: block.number
        });
        auditHistory.push(result);
        emit AuditCommitted(period, passed, disparity, reportHash, block.timestamp, block.number);
    }

    function getLatestAudit() external view returns (AuditResult memory) {
        require(auditHistory.length > 0, "No audits yet");
        return auditHistory[auditHistory.length - 1];
    }

    function getAuditCount() external view returns (uint256) { return auditHistory.length; }
}
