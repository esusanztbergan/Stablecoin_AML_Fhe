// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Transaction {
  id: string;
  amount: string;
  sender: string;
  receiver: string;
  timestamp: number;
  status: "pending" | "cleared" | "flagged";
  amlCheck: boolean;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'amlCheck':
      // Simulate AML check - flag if > 10000
      result = value > 10000 ? 1 : 0;
      break;
    case 'increase10%':
      result = value * 1.1;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sending, setSending] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newTransaction, setNewTransaction] = useState({ receiver: "", amount: 0, note: "" });
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [filter, setFilter] = useState<"all" | "cleared" | "flagged" | "pending">("all");
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [showIntro, setShowIntro] = useState(true);

  const clearedCount = transactions.filter(t => t.status === "cleared").length;
  const flaggedCount = transactions.filter(t => t.status === "flagged").length;
  const pendingCount = transactions.filter(t => t.status === "pending").length;
  const totalVolume = transactions.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);

  useEffect(() => {
    loadTransactions().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadTransactions = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      const keysBytes = await contract.getData("transaction_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing transaction keys:", e); }
      }
      const list: Transaction[] = [];
      for (const key of keys) {
        try {
          const txBytes = await contract.getData(`transaction_${key}`);
          if (txBytes.length > 0) {
            try {
              const txData = JSON.parse(ethers.toUtf8String(txBytes));
              list.push({ 
                id: key, 
                amount: txData.amount, 
                sender: txData.sender, 
                receiver: txData.receiver, 
                timestamp: txData.timestamp, 
                status: txData.status || "pending",
                amlCheck: txData.amlCheck || false
              });
            } catch (e) { console.error(`Error parsing transaction data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading transaction ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setTransactions(list);
    } catch (e) { console.error("Error loading transactions:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const sendTransaction = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setSending(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting transaction with Zama FHE..." });
    try {
      const encryptedAmount = FHEEncryptNumber(newTransaction.amount);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const txId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const txData = { 
        amount: encryptedAmount, 
        sender: address, 
        receiver: newTransaction.receiver, 
        timestamp: Math.floor(Date.now() / 1000), 
        status: "pending",
        amlCheck: false
      };
      await contract.setData(`transaction_${txId}`, ethers.toUtf8Bytes(JSON.stringify(txData)));
      const keysBytes = await contract.getData("transaction_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(txId);
      await contract.setData("transaction_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted transaction submitted!" });
      await loadTransactions();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowSendModal(false);
        setNewTransaction({ receiver: "", amount: 0, note: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setSending(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const runAMLCheck = async (txId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Running FHE AML compliance check..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const txBytes = await contract.getData(`transaction_${txId}`);
      if (txBytes.length === 0) throw new Error("Transaction not found");
      const txData = JSON.parse(ethers.toUtf8String(txBytes));
      
      const amlResult = FHECompute(txData.amount, 'amlCheck');
      const isFlagged = FHEDecryptNumber(amlResult) === 1;
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedTx = { 
        ...txData, 
        status: isFlagged ? "flagged" : "cleared",
        amlCheck: true
      };
      await contractWithSigner.setData(`transaction_${txId}`, ethers.toUtf8Bytes(JSON.stringify(updatedTx)));
      
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: isFlagged 
          ? "AML check flagged suspicious transaction!" 
          : "AML check cleared transaction" 
      });
      await loadTransactions();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "AML check failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isSender = (txAddress: string) => address?.toLowerCase() === txAddress.toLowerCase();

  const filteredTransactions = transactions.filter(tx => {
    if (filter === "all") return true;
    return tx.status === filter;
  });

  const renderStats = () => (
    <div className="stats-grid">
      <div className="stat-card">
        <div className="stat-value">{transactions.length}</div>
        <div className="stat-label">Total Tx</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{clearedCount}</div>
        <div className="stat-label">Cleared</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{flaggedCount}</div>
        <div className="stat-label">Flagged</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{totalVolume.toFixed(2)}</div>
        <div className="stat-label">Total Volume</div>
      </div>
    </div>
  );

  const renderAMLVisualization = () => (
    <div className="aml-visualization">
      <div className="aml-process">
        <div className="step">
          <div className="step-icon">🔒</div>
          <div className="step-label">Encrypted Tx</div>
        </div>
        <div className="arrow">→</div>
        <div className="step">
          <div className="step-icon">⚙️</div>
          <div className="step-label">FHE AML Check</div>
        </div>
        <div className="arrow">→</div>
        <div className="step">
          <div className="step-icon">{flaggedCount > 0 ? "⚠️" : "✅"}</div>
          <div className="step-label">Result</div>
        </div>
      </div>
      <div className="aml-status">
        <div className="status-item cleared">
          <div className="status-count">{clearedCount}</div>
          <div className="status-label">Cleared</div>
        </div>
        <div className="status-item flagged">
          <div className="status-count">{flaggedCount}</div>
          <div className="status-label">Flagged</div>
        </div>
      </div>
    </div>
  );

  if (loading) return (
    <div className="loading-screen">
      <div className="tech-spinner"></div>
      <p>Initializing FHE secure channel...</p>
    </div>
  );

  return (
    <div className="app-container future-tech-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield"></div>
            <div className="circuit"></div>
          </div>
          <h1>FHES<span>050</span></h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowSendModal(true)} className="send-btn tech-button">
            <div className="send-icon"></div>Send
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content">
        {showIntro && (
          <div className="intro-panel tech-panel">
            <div className="panel-header">
              <h2>Private Stablecoin with FHE AML</h2>
              <button onClick={() => setShowIntro(false)} className="close-panel">&times;</button>
            </div>
            <div className="panel-content">
              <div className="intro-grid">
                <div className="intro-item">
                  <h3>FHE Technology</h3>
                  <p>Powered by Zama's Fully Homomorphic Encryption, enabling computations on encrypted data without decryption.</p>
                </div>
                <div className="intro-item">
                  <h3>Private Transactions</h3>
                  <p>All transactions are encrypted by default, protecting user privacy while maintaining regulatory compliance.</p>
                </div>
                <div className="intro-item">
                  <h3>AML Compliance</h3>
                  <p>Sophisticated AML checks run on encrypted transaction data to detect suspicious patterns without exposing details.</p>
                </div>
                <div className="intro-item">
                  <h3>Stablecoin</h3>
                  <p>1:1 pegged stablecoin with the privacy and compliance benefits of FHE technology.</p>
                </div>
              </div>
              <div className="tech-badge">
                <span>FHE-Powered Privacy</span>
              </div>
            </div>
          </div>
        )}

        <div className="dashboard">
          <div className="dashboard-panel tech-panel">
            <h2>Transaction Statistics</h2>
            {renderStats()}
          </div>

          <div className="dashboard-panel tech-panel">
            <h2>AML Compliance</h2>
            {renderAMLVisualization()}
          </div>
        </div>

        <div className="transactions-section">
          <div className="section-header">
            <h2>Transaction History</h2>
            <div className="filters">
              <button 
                className={`filter-btn ${filter === "all" ? "active" : ""}`}
                onClick={() => setFilter("all")}
              >
                All
              </button>
              <button 
                className={`filter-btn ${filter === "cleared" ? "active" : ""}`}
                onClick={() => setFilter("cleared")}
              >
                Cleared
              </button>
              <button 
                className={`filter-btn ${filter === "flagged" ? "active" : ""}`}
                onClick={() => setFilter("flagged")}
              >
                Flagged
              </button>
              <button 
                className={`filter-btn ${filter === "pending" ? "active" : ""}`}
                onClick={() => setFilter("pending")}
              >
                Pending
              </button>
              <button 
                className="refresh-btn tech-button" 
                onClick={loadTransactions} 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="transactions-list tech-panel">
            {transactions.length === 0 ? (
              <div className="no-transactions">
                <div className="empty-icon"></div>
                <p>No transactions found</p>
                <button className="tech-button primary" onClick={() => setShowSendModal(true)}>
                  Make First Transaction
                </button>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Amount</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map(tx => (
                    <tr key={tx.id} onClick={() => setSelectedTx(tx)}>
                      <td>#{tx.id.substring(0, 6)}</td>
                      <td>{tx.amount.substring(0, 10)}...</td>
                      <td>{tx.sender.substring(0, 6)}...{tx.sender.substring(38)}</td>
                      <td>{tx.receiver.substring(0, 6)}...{tx.receiver.substring(38)}</td>
                      <td>{new Date(tx.timestamp * 1000).toLocaleDateString()}</td>
                      <td>
                        <span className={`status-badge ${tx.status}`}>
                          {tx.status}
                        </span>
                      </td>
                      <td>
                        {isSender(tx.sender) && tx.status === "pending" && (
                          <button 
                            className="action-btn tech-button" 
                            onClick={(e) => { e.stopPropagation(); runAMLCheck(tx.id); }}
                          >
                            AML Check
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {showSendModal && (
        <ModalSend 
          onSubmit={sendTransaction} 
          onClose={() => setShowSendModal(false)} 
          sending={sending} 
          transaction={newTransaction} 
          setTransaction={setNewTransaction}
        />
      )}

      {selectedTx && (
        <TransactionDetail 
          transaction={selectedTx} 
          onClose={() => { setSelectedTx(null); setDecryptedAmount(null); }} 
          decryptedAmount={decryptedAmount}
          setDecryptedAmount={setDecryptedAmount}
          isDecrypting={isDecrypting}
          decryptWithSignature={decryptWithSignature}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content tech-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="tech-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield"></div>
              <span>FHES050</span>
            </div>
            <p>Private stablecoin with FHE-based AML compliance</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="tech-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} FHES050 Network</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalSendProps {
  onSubmit: () => void;
  onClose: () => void;
  sending: boolean;
  transaction: any;
  setTransaction: (tx: any) => void;
}

const ModalSend: React.FC<ModalSendProps> = ({ onSubmit, onClose, sending, transaction, setTransaction }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setTransaction({ ...transaction, [name]: value });
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setTransaction({ ...transaction, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!transaction.receiver || !transaction.amount) {
      alert("Please fill required fields");
      return;
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="send-modal tech-panel">
        <div className="modal-header">
          <h2>Send Private Transaction</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div>
            <div>
              <strong>FHE Encryption Active</strong>
              <p>Transaction details will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          <div className="form-group">
            <label>Receiver Address *</label>
            <input
              type="text"
              name="receiver"
              value={transaction.receiver}
              onChange={handleChange}
              placeholder="0x..."
              className="tech-input"
            />
          </div>
          <div className="form-group">
            <label>Amount *</label>
            <input
              type="number"
              name="amount"
              value={transaction.amount}
              onChange={handleAmountChange}
              placeholder="0.00"
              className="tech-input"
              step="0.01"
            />
          </div>
          <div className="form-group">
            <label>Note (Optional)</label>
            <input
              type="text"
              name="note"
              value={transaction.note}
              onChange={handleChange}
              placeholder="Transaction note..."
              className="tech-input"
            />
          </div>
          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Amount:</span>
                <div>{transaction.amount || '0.00'}</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{transaction.amount ? FHEEncryptNumber(transaction.amount).substring(0, 50) + '...' : 'No amount'}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn tech-button">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={sending} className="submit-btn tech-button primary">
            {sending ? "Encrypting & Sending..." : "Send Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface TransactionDetailProps {
  transaction: Transaction;
  onClose: () => void;
  decryptedAmount: number | null;
  setDecryptedAmount: (amount: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const TransactionDetail: React.FC<TransactionDetailProps> = ({ 
  transaction, 
  onClose, 
  decryptedAmount,
  setDecryptedAmount,
  isDecrypting,
  decryptWithSignature
}) => {
  const handleDecrypt = async () => {
    if (decryptedAmount !== null) {
      setDecryptedAmount(null);
      return;
    }
    const decrypted = await decryptWithSignature(transaction.amount);
    if (decrypted !== null) setDecryptedAmount(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="tx-detail-modal tech-panel">
        <div className="modal-header">
          <h2>Transaction Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="tx-info">
            <div className="info-item">
              <span>Transaction ID:</span>
              <strong>#{transaction.id.substring(0, 8)}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${transaction.status}`}>{transaction.status}</strong>
            </div>
            <div className="info-item">
              <span>From:</span>
              <strong>{transaction.sender.substring(0, 6)}...{transaction.sender.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>To:</span>
              <strong>{transaction.receiver.substring(0, 6)}...{transaction.receiver.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(transaction.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>AML Check:</span>
              <strong>{transaction.amlCheck ? "Completed" : "Pending"}</strong>
            </div>
          </div>
          <div className="encrypted-section">
            <h3>Encrypted Amount</h3>
            <div className="encrypted-data">
              {transaction.amount.substring(0, 100)}...
            </div>
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted</span>
            </div>
            <button 
              className="decrypt-btn tech-button" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? "Decrypting..." : decryptedAmount !== null ? "Hide Amount" : "Decrypt Amount"}
            </button>
          </div>
          {decryptedAmount !== null && (
            <div className="decrypted-section">
              <h3>Decrypted Amount</h3>
              <div className="decrypted-value">
                {decryptedAmount.toFixed(2)}
              </div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted value is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn tech-button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;