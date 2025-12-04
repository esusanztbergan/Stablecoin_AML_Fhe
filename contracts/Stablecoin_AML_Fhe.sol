pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";


contract StablecoinAMLFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error InvalidBatchId();
    error InvalidCooldown();
    error ReplayDetected();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event CooldownSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event TransactionSubmitted(address indexed provider, uint256 indexed batchId, uint256 transactionId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 suspiciousCount);

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    struct Batch {
        bool isOpen;
        uint256 transactionCount;
    }

    mapping(address => bool) public providers;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    mapping(uint256 => Batch) public batches;
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    address public owner;
    bool public paused;
    uint256 public cooldownSeconds;
    uint256 public currentBatchId = 0;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!providers[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        cooldownSeconds = 10; // Default cooldown of 10 seconds
    }

    function addProvider(address provider) external onlyOwner {
        providers[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        providers[provider] = false;
        emit ProviderRemoved(provider);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        if (newCooldownSeconds == 0) revert InvalidCooldown();
        emit CooldownSet(cooldownSeconds, newCooldownSeconds);
        cooldownSeconds = newCooldownSeconds;
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batches[currentBatchId] = Batch({ isOpen: true, transactionCount: 0 });
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batches[currentBatchId].isOpen) revert InvalidBatchId();
        batches[currentBatchId].isOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitTransaction(
        euint32 encryptedAmount,
        euint32 encryptedSender,
        euint32 encryptedReceiver
    ) external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (!batches[currentBatchId].isOpen) revert BatchNotOpen();

        _initIfNeeded(encryptedAmount);
        _initIfNeeded(encryptedSender);
        _initIfNeeded(encryptedReceiver);

        // Store encrypted transaction data (example storage, adapt as needed)
        // For this example, we'll just count transactions.
        // In a real scenario, you'd store the encrypted data in a mapping or array.
        batches[currentBatchId].transactionCount++;

        lastSubmissionTime[msg.sender] = block.timestamp;
        emit TransactionSubmitted(msg.sender, currentBatchId, batches[currentBatchId].transactionCount);
    }

    function requestAMLCheck(uint256 batchIdToCheck) external onlyOwner whenNotPaused checkDecryptionCooldown {
        if (batchIdToCheck == 0 || batchIdToCheck > currentBatchId || batches[batchIdToCheck].isOpen) {
            revert InvalidBatchId();
        }

        // For this example, we'll create a dummy encrypted result.
        // A real AML check would involve complex FHE computations on the stored encrypted data.
        euint32 suspiciousCountEnc = FHE.asEuint32(0); // Placeholder for actual FHE computation
        _initIfNeeded(suspiciousCountEnc);

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(suspiciousCountEnc);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchIdToCheck,
            stateHash: stateHash,
            processed: false
        });

        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, batchIdToCheck);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayDetected();

        // Rebuild ciphertexts array in the exact same order as in requestAMLCheck
        // For this example, it's a single euint32.
        // The actual ciphertexts would be fetched from storage based on decryptionContexts[requestId].batchId
        // For simplicity, we'll assume the ciphertext is still available or reconstructible.
        // In a real scenario, you'd need to store the ciphertexts that were submitted for decryption
        // or be able to regenerate them from the batch data.
        // Here, we'll just use a placeholder ciphertext for the hash check.
        euint32 dummyEnc = FHE.asEuint32(0); // Placeholder
        _initIfNeeded(dummyEnc);
        bytes32[] memory currentCts = new bytes32[](1);
        currentCts[0] = FHE.toBytes32(dummyEnc);

        bytes32 currentStateHash = _hashCiphertexts(currentCts);
        if (currentStateHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        // @dev: Proof verification ensures the decryption was performed correctly by the FHE provider.
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decode cleartexts
        // The cleartexts are expected to be `uint256[]` values, one for each ciphertext.
        // For this example, we expect one uint256.
        uint256 suspiciousCount = abi.decode(cleartexts, (uint256));

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, suspiciousCount);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 x) internal {
        if (!FHE.isInitialized(x)) revert NotInitialized();
    }

    function _initIfNeeded(ebool x) internal {
        if (!FHE.isInitialized(x)) revert NotInitialized();
    }
}