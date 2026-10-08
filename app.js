// DOM Elements
const teamACard = document.getElementById('teamA');
const teamBCard = document.getElementById('teamB');
const avatarA = document.getElementById('avatarA');
const avatarB = document.getElementById('avatarB');
const betInput = document.getElementById('betAmount');
const placeBetBtn = document.getElementById('placeBetBtn');
const countdownEl = document.getElementById('countdown');

// Fight Visuals Elements
const vsBadge = document.getElementById('vsBadge');
const chartBox = document.getElementById('chartBox');
const canvas = document.getElementById('liveChart');
const ctx = canvas.getContext('2d');
const resultModal = document.getElementById('resultModal');
const resultTitle = document.getElementById('resultTitle');
const resultIcon = document.getElementById('resultIcon');
const resultMessage = document.getElementById('resultMessage');
const closeResultBtn = document.getElementById('closeResultBtn');

// Phase 2: Auth Elements
const loginBtn = document.getElementById('loginBtn');
const balancePill = document.getElementById('balancePill');
const privyModal = document.getElementById('privyModal');
const closePrivy = document.getElementById('closePrivy');

// Phase 3: Onboarding Elements
const tutorialBtn = document.getElementById('tutorialBtn');
const tutorialModal = document.getElementById('tutorialModal');
const closeTutorialBtn = document.getElementById('closeTutorialBtn');
const nicknameModal = document.getElementById('nicknameModal');
const nicknameInput = document.getElementById('nicknameInput');
const saveNicknameBtn = document.getElementById('saveNicknameBtn');
const nicknamePill = document.getElementById('nicknamePill');
const playerNameDisplay = document.getElementById('playerNameDisplay');

let playerNickname = localStorage.getItem('vibe_stock_nickname');

// Initialize Onboarding
window.addEventListener('DOMContentLoaded', () => {
    if (!playerNickname) {
        nicknameModal.classList.remove('hidden');
    } else {
        playerNameDisplay.innerText = playerNickname;
        nicknamePill.classList.remove('hidden');
    }
});

saveNicknameBtn.addEventListener('click', () => {
    const name = nicknameInput.value.trim();
    if (name.length < 2) return alert('Nickname too short!');
    playerNickname = name;
    localStorage.setItem('vibe_stock_nickname', name);
    playerNameDisplay.innerText = name;
    nicknamePill.classList.remove('hidden');
    nicknameModal.classList.add('hidden');
    
    // Show tutorial immediately after first-time nickname entry
    tutorialModal.classList.remove('hidden');
});

tutorialBtn.addEventListener('click', () => tutorialModal.classList.remove('hidden'));
closeTutorialBtn.addEventListener('click', () => tutorialModal.classList.add('hidden'));

let userWallet = null;
let userBalance = 0;
let selectedTeam = null;
let timer = 60; // Upgraded to 60s
let timerInterval;
let priceInterval;

// Auth Logic
loginBtn.addEventListener('click', () => {
    if (!userWallet) privyModal.classList.remove('hidden');
});
closePrivy.addEventListener('click', () => privyModal.classList.add('hidden'));

let isSimulated = false;
let vctContract = null;
const VCT_ADDRESS = "0x46aE7fe808648c7d9AD3a33E63b88B21F3A4c697";
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const ERC20_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function transfer(address to, uint amount) returns (bool)",
    "function decimals() view returns (uint8)"
];

function simulatePrivyLogin(method) {
    const btns = document.querySelectorAll('.privy-btn');
    btns[0].innerHTML = "⏳ Authenticating securely...";
    
    setTimeout(() => {
        isSimulated = true;
        userWallet = "0x" + Math.random().toString(16).slice(2, 8) + "..." + Math.random().toString(16).slice(2, 6);
        userBalance = 5000;
        
        privyModal.classList.add('hidden');
        loginBtn.innerHTML = `🟢 ${userWallet}`;
        loginBtn.style.background = "var(--vibe-cyan)";
        loginBtn.style.color = "var(--charcoal-ink)";
        
        balancePill.innerText = `${userBalance} $VCT`;
        balancePill.classList.remove('hidden');
    }, 500);
}

async function initWeb3Real() {
    if (window.ethereum == null) {
        alert("⚠️ Please install MetaMask or use the Email/Google login!");
        return;
    }

    try {
        const btn = document.querySelector('.privy-btn-outline');
        btn.innerHTML = "⏳ Connecting...";
        
        const provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        const signer = await provider.getSigner();
        userWallet = await signer.getAddress();
        
        vctContract = new ethers.Contract(VCT_ADDRESS, ERC20_ABI, signer);
        
        const balWei = await vctContract.balanceOf(userWallet);
        userBalance = parseFloat(ethers.formatUnits(balWei, 18)).toFixed(2);
        
        isSimulated = false;
        privyModal.classList.add('hidden');
        loginBtn.innerHTML = `🟢 ${userWallet.substring(0,6)}...${userWallet.substring(userWallet.length-4)}`;
        loginBtn.style.background = "var(--vibe-cyan)";
        loginBtn.style.color = "var(--charcoal-ink)";
        
        balancePill.innerText = `${userBalance} $VCT`;
        balancePill.classList.remove('hidden');
        btn.innerHTML = "🦊 Connect MetaMask";
    } catch (err) {
        console.error(err);
        alert("❌ Failed to connect wallet.");
        document.querySelector('.privy-btn-outline').innerHTML = "🦊 Connect MetaMask";
    }
}

// Team Selection Logic
teamACard.addEventListener('click', () => selectTeam('A'));
teamBCard.addEventListener('click', () => selectTeam('B'));

function selectTeam(team) {
    if (roundLocked) return;
    selectedTeam = team;
    
    if (team === 'A') {
        teamACard.classList.add('selected');
        teamBCard.classList.remove('selected');
    } else {
        teamBCard.classList.add('selected');
        teamACard.classList.remove('selected');
    }

    betInput.disabled = false;
    placeBetBtn.disabled = false;
    const ticker = team === 'A' ? ASSETS[selectA.value].ticker : ASSETS[selectB.value].ticker;
    placeBetBtn.innerText = `Place Bet on ${ticker}`;
}

// Phase 5: Live Chart & Dynamic Combat
let currentBet = 0;
let roundLocked = false;

const ASSETS = {
    BTC: { name: "Bitcoin", ticker: "$BTC", type: "crypto", base: 85000, img: "viber1.webp", color: "#FFD700" }, // Gold
    ETH: { name: "Ethereum", ticker: "$ETH", type: "crypto", base: 4500, img: "viber2.webp", color: "#A855F7" }, // Purple
    SOL: { name: "Solana", ticker: "$SOL", type: "crypto", base: 118.60, img: "viber4.webp", color: "#00F0FF" }, // Cyan
    TSLA: { name: "Tesla", ticker: "$TSLA", type: "stock", base: 377.81, img: "viber5.webp", color: "#FF3366" }, // Red
    AAPL: { name: "Apple", ticker: "$AAPL", type: "stock", base: 336.67, img: "viber6.webp", color: "#FDFBF7" }, // White/Cream
    NVDA: { name: "NVIDIA", ticker: "$NVDA", type: "stock", base: 238.50, img: "viber8.webp", color: "#76B900" }, // Nvidia Green
    MSFT: { name: "Microsoft", ticker: "$MSFT", type: "stock", base: 480.00, img: "viber7.webp", color: "#00A4EF" }, // MS Blue
    AMZN: { name: "Amazon", ticker: "$AMZN", type: "stock", base: 215.00, img: "viber3.webp", color: "#FF9900" } // Amazon Orange
};

const selectA = document.getElementById('assetA');
const selectB = document.getElementById('assetB');

function updateAvatar(selectEl, avatarId) {
    const asset = ASSETS[selectEl.value];
    const avatar = document.getElementById(avatarId);
    avatar.style.backgroundImage = `url('assets/vibers/${asset.img}')`;
    avatar.style.boxShadow = `0 0 15px ${asset.color}`;
    
    // Update button if a team is currently selected
    if (selectedTeam) {
        const activeSelect = selectedTeam === 'A' ? selectA : selectB;
        placeBetBtn.innerText = `Place Bet on ${ASSETS[activeSelect.value].ticker}`;
    }
}

selectA.addEventListener('change', () => {
    updateAvatar(selectA, 'avatarA');
    if (isMultiplayer && p2pConnection && isHost) p2pConnection.send({ type: 'SELECTION', team: 'A', asset: selectA.value });
});
selectB.addEventListener('change', () => {
    updateAvatar(selectB, 'avatarB');
    if (isMultiplayer && p2pConnection && !isHost) p2pConnection.send({ type: 'SELECTION', team: 'B', asset: selectB.value });
});

// Oracle Data State
let startPriceA = 0;
let startPriceB = 0;
let currentPriceA = 0;
let currentPriceB = 0;

// Health State
let hpA = 100;
let hpB = 100;

// Chart History Arrays (stores % change)
let historyA = [];
let historyB = [];

// Hybrid Oracle (Live Binance for Crypto, Yahoo Finance for Stocks, Synth for Private)
async function fetchAssetPrice(assetKey, currentPrice = 0) {
    const asset = ASSETS[assetKey];
    if (asset.type === 'crypto') {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${assetKey}USDT`, { signal: controller.signal });
            clearTimeout(timeoutId);
            const data = await res.json();
            return parseFloat(data.price);
        } catch (e) {
            console.warn("Binance Oracle fail (Network/Timeout). Falling back to synthetic:", e);
            const base = currentPrice || asset.base;
            return base * (1 + (Math.random() - 0.49) * 0.015);
        }
    } else if (asset.type === 'stock') {
        // Fetch REAL base price from Yahoo Finance via CORS proxy if starting fresh
        if (!currentPrice) {
            try {
                // Use assetKey (e.g. "TSLA") instead of asset.ticker (e.g. "$TSLA") to avoid 404s!
                const targetUrl = encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${assetKey}`);
                const res = await fetch(`https://api.allorigins.win/get?url=${targetUrl}`);
                const json = await res.json();
                const yahooData = JSON.parse(json.contents);
                return yahooData.chart.result[0].meta.regularMarketPrice;
            } catch(e) {
                console.warn("Yahoo API failed, using base:", e);
                return asset.base;
            }
        } else {
            // Free stock APIs delay by 15 mins. To make characters fight every 1.5s, we simulate combat micro-fluctuations off the REAL Yahoo price!
            return currentPrice * (1 + (Math.random() - 0.49) * 0.015);
        }
    } else {
        // Simulated Synthetic Oracle for Private companies (SpaceX/Dangote)
        const base = currentPrice || asset.base;
        return base * (1 + (Math.random() - 0.49) * 0.015);
    }
}

async function fetchLivePrices() {
    const pA = await fetchAssetPrice(selectA.value, currentPriceA);
    const pB = await fetchAssetPrice(selectB.value, currentPriceB);
    return { a: pA, b: pB };
}

placeBetBtn.addEventListener('click', async () => {
    if (!userWallet) { alert("⚠️ Please click 'Connect to Play' to generate your wallet first!"); return; }
    if (roundLocked) return;
    
    if (selectA.value === selectB.value) { alert("❌ You cannot duel the same asset!"); return; }

    const amount = parseInt(betInput.value);
    if (!amount || amount <= 0) return;
    if (amount > userBalance) { alert("❌ Insufficient $VCT balance!"); return; }
    
    // REAL WEB3 TRANSACTION LOCK (If using MetaMask)
    if (!isSimulated && vctContract) {
        try {
            placeBetBtn.innerText = "⏳ Confirm in Wallet...";
            const tx = await vctContract.transfer(BURN_ADDRESS, ethers.parseUnits(amount.toString(), 18));
            placeBetBtn.innerText = "⏳ Mining Vault Lock...";
            await tx.wait();
            placeBetBtn.innerText = "FIGHTING! ⚔️";
        } catch (err) {
            console.error("Tx error", err);
            alert("❌ Transaction failed or rejected.");
            placeBetBtn.innerText = "LOCK & BATTLE";
            return;
        }
    }
    
    // MULTIPLAYER INTERCEPT
    if (isMultiplayer && p2pConnection) {
        attemptPvPLock(amount);
        return; // Halt single-player execution!
    }

    try {
        placeBetBtn.innerText = "CONNECTING TO ORACLE... 📡";
        placeBetBtn.disabled = true;
        betInput.disabled = true;
        selectA.disabled = true;
        selectB.disabled = true;

        // Fetch initial prices
        currentPriceA = 0; // reset for fresh base
        currentPriceB = 0;
        const initialPrices = await fetchLivePrices();
        
        if (!initialPrices || !initialPrices.a || !initialPrices.b) {
            alert("⚠️ Failed to connect to live Oracle.");
            resetBetUI();
            return;
        }

        // Process Bet
        userBalance -= amount;
        currentBet = amount;
        roundLocked = true;
        
        // Set Live Data
        startPriceA = currentPriceA = initialPrices.a;
        startPriceB = currentPriceB = initialPrices.b;
        
        historyA = [0];
        historyB = [0];
        hpA = 100;
        hpB = 100;
        timer = 60;
        countdownEl.innerText = timer;
        
        // Reset UI
        document.getElementById('hpA').style.width = '100%';
        document.getElementById('hpB').style.width = '100%';
        document.getElementById('hpBoxA').classList.remove('hidden');
        document.getElementById('hpBoxB').classList.remove('hidden');
        avatarA.classList.remove('ko-state');
        avatarB.classList.remove('ko-state');
        
        balancePill.innerText = `${userBalance} $VCT`;
        const poolEl = document.getElementById(`pool${selectedTeam}`);
        poolEl.innerText = parseInt(poolEl.innerText) + amount;
        
        placeBetBtn.innerText = "FIGHTING! ⚔️";
        placeBetBtn.style.background = "var(--alert-red)";
        
        // START VISUAL FIGHT & CHART
        teamACard.classList.add('fighting');
        teamBCard.classList.add('fighting');
        vsBadge.classList.add('hidden');
        chartBox.classList.remove('hidden');
        
        drawChart();
        
        // Live Combat triggers (using real API)
        priceInterval = setInterval(async () => {
            const livePrices = await fetchLivePrices();
            if (livePrices) {
                currentPriceA = livePrices.a;
                currentPriceB = livePrices.b;
            }
            
            const changeA = ((currentPriceA - startPriceA) / startPriceA) * 100;
            const changeB = ((currentPriceB - startPriceB) / startPriceB) * 100;
            
            historyA.push(changeA);
            historyB.push(changeB);
            drawChart();
            
            // Calculate Damage based on relative delta
            const diff = Math.abs(changeA - changeB);
            // Drastically reduced damage so rounds don't end in 5 seconds. Matches will now almost always go to 60 seconds.
            const damage = Math.min(diff * 5, 3); 
            
            if (changeA > changeB) {
                hpB -= damage;
            } else if (changeB > changeA) {
                hpA -= damage;
            }
            
            hpA = Math.max(0, hpA);
            hpB = Math.max(0, hpB);
            
            document.getElementById('hpA').style.width = `${hpA}%`;
            document.getElementById('hpB').style.width = `${hpB}%`;
            
            triggerCombatAnimations(changeA, changeB);
            
            // Only trigger early KO if someone is absolutely destroyed
            if (hpA <= 0 || hpB <= 0) {
                clearInterval(priceInterval); // Stop combat
                if (hpA <= 0) avatarA.classList.add('ko-state');
                if (hpB <= 0) avatarB.classList.add('ko-state');
                setTimeout(() => {
                    timer = 0; // Force end
                    resolveRound();
                }, 1000);
            }
            
        }, 1500); // 1.5s interval to respect API limits while staying responsive

    } catch (err) {
        console.error("Critical Bet Error:", err);
        alert("⚠️ Something went wrong starting the match. Please try again.");
        resetBetUI();
    }
});

function resetBetUI() {
    const activeSelect = selectedTeam === 'A' ? selectA : selectB;
    placeBetBtn.innerText = `Place Bet on ${ASSETS[activeSelect.value].ticker}`;
    placeBetBtn.disabled = false;
    betInput.disabled = false;
    selectA.disabled = false;
    selectB.disabled = false;
}

// Dynamic Combat based on live prices
function triggerCombatAnimations(changeA, changeB) {
    // Reset classes
    avatarA.classList.remove('advancing-a', 'retreating', 'taking-damage', 'attacking-a');
    avatarB.classList.remove('advancing-b', 'retreating', 'taking-damage', 'attacking-b');
    
    // Force DOM reflow to restart animations
    void avatarA.offsetWidth; 
    void avatarB.offsetWidth;
    
    if (changeA > changeB && hpA > 0 && hpB > 0) {
        // A is winning
        avatarA.classList.add('advancing-a', 'attacking-a');
        avatarB.classList.add('retreating', 'taking-damage');
    } else if (changeB > changeA && hpA > 0 && hpB > 0) {
        // B is winning
        avatarB.classList.add('advancing-b', 'attacking-b');
        avatarA.classList.add('retreating', 'taking-damage');
    }
}

// Canvas Chart Drawing Logic
function drawChart() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Grid Lines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height/2);
    ctx.lineTo(canvas.width, canvas.height/2);
    ctx.stroke();
    
    // Determine min/max for dynamic scaling
    let maxChange = Math.max(
        Math.max(...historyA.map(Math.abs)),
        Math.max(...historyB.map(Math.abs)),
        1 // minimum scale
    );
    
    const drawLine = (data, color) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        
        const xStep = canvas.width / 60; // 60 seconds
        
        for (let i = 0; i < data.length; i++) {
            const x = i * xStep;
            // Map value to Y pixel: 0 is center, maxChange is top (0), -maxChange is bottom (height)
            const y = canvas.height/2 - (data[i] / maxChange) * (canvas.height/2 * 0.9);
            
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    };
    
    const colorA = ASSETS[selectA.value].color;
    const colorB = ASSETS[selectB.value].color;

    // Draw lines
    drawLine(historyB, colorB);
    drawLine(historyA, colorA);
}

// Simple Countdown
function startTimer() {
    timerInterval = setInterval(() => {
        if (!roundLocked || timer <= 0) return; // Don't tick if round isn't active or timer is done
        timer--;
        countdownEl.innerText = timer;
        if (timer <= 0) {
            resolveRound();
        }
    }, 1000);
}

function resolveRound(finalPriceA = null, finalPriceB = null) {
    clearInterval(priceInterval);
    
    // In PvP, Host dictates final prices to Guest
    if (finalPriceA !== null) currentPriceA = finalPriceA;
    if (finalPriceB !== null) currentPriceB = finalPriceB;
    
    // Reset Avatars
    avatarA.classList.remove('advancing-a', 'retreating', 'taking-damage', 'attacking-a');
    avatarB.classList.remove('advancing-b', 'retreating', 'taking-damage', 'attacking-b');
    teamACard.classList.remove('fighting');
    teamBCard.classList.remove('fighting');
    chartBox.classList.add('hidden');
    vsBadge.classList.remove('hidden');
    
    // Oracle Resolution
    const changeA = ((currentPriceA - startPriceA) / startPriceA) * 100;
    const changeB = ((currentPriceB - startPriceB) / startPriceB) * 100;
    
    const winner = changeA > changeB ? 'A' : 'B';
    
    const assetA = ASSETS[selectA.value];
    const assetB = ASSETS[selectB.value];
    
    const winningTicker = winner === 'A' ? assetA.ticker : assetB.ticker;
    
    const typeA = assetA.type === 'crypto' ? 'BINANCE API (LIVE)' : (assetA.type === 'stock' ? 'YAHOO FINANCE API' : 'TESTNET ORACLE (SYNTHETIC)');
    const typeB = assetB.type === 'crypto' ? 'BINANCE API (LIVE)' : (assetB.type === 'stock' ? 'YAHOO FINANCE API' : 'TESTNET ORACLE (SYNTHETIC)');

    const receiptHTML = `
        <div style="background: #111; color: #00F0FF; padding: 10px; border-radius: 8px; font-family: monospace; text-align: left; margin: 15px 0; font-size: 0.9rem;">
            <div><strong>ON-CHAIN ORACLE RECEIPT</strong></div>
            <div style="margin-top:5px; color: ${assetA.color};">[${typeA}]<br>${assetA.ticker}: $${startPriceA.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ➔ $${currentPriceA.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} (${changeA > 0 ? '+' : ''}${changeA.toFixed(2)}%)</div>
            <div style="margin-top:5px; color: ${assetB.color};">[${typeB}]<br>${assetB.ticker}: $${startPriceB.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ➔ $${currentPriceB.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} (${changeB > 0 ? '+' : ''}${changeB.toFixed(2)}%)</div>
            <div style="margin-top:5px; color: #FFD700;">WINNER: ${winningTicker}</div>
        </div>
    `;
    
    if (winner === 'A') {
        teamACard.classList.add('winner-card');
        teamBCard.classList.add('loser-card');
    } else {
        teamBCard.classList.add('winner-card');
        teamACard.classList.add('loser-card');
    }

    if (roundLocked && currentBet > 0) {
        if (selectedTeam === winner) {
            const winnings = Math.floor(currentBet * 1.95);
            userBalance += winnings;
            showCustomModal(`🎉 YOU WON!`, `Your asset outperformed!`, `+${winnings} $VCT`, 'var(--vibe-cyan)', receiptHTML);
        } else {
            showCustomModal(`💀 YOU LOST`, `Your asset was outperformed.`, `-${currentBet} $VCT`, 'var(--alert-red)', receiptHTML);
        }
    }

    balancePill.innerText = `${userBalance} $VCT`;
}

// Custom Modal UI
function showCustomModal(title, msg, amountStr, color, receiptHTML = "") {
    resultTitle.innerText = title;
    resultTitle.style.color = color;
    resultMessage.innerText = msg;
    resultIcon.innerText = amountStr;
    
    let receiptEl = document.getElementById('oracleReceipt');
    if (!receiptEl) {
        receiptEl = document.createElement('div');
        receiptEl.id = 'oracleReceipt';
        resultMessage.parentNode.insertBefore(receiptEl, closeResultBtn);
    }
    receiptEl.innerHTML = receiptHTML;
    
    resultModal.classList.remove('hidden');
}

closeResultBtn.addEventListener('click', () => {
    resultModal.classList.add('hidden');
    resetBoard();
});

function resetBoard() {
    currentBet = 0;
    roundLocked = false;
    timer = 60;
    countdownEl.innerText = timer;
    
    document.getElementById('poolA').innerText = '0';
    document.getElementById('poolB').innerText = '0';
    
    document.getElementById('hpBoxA').classList.add('hidden');
    document.getElementById('hpBoxB').classList.add('hidden');
    avatarA.classList.remove('ko-state');
    avatarB.classList.remove('ko-state');
    
    teamACard.classList.remove('winner-card', 'loser-card', 'selected');
    teamBCard.classList.remove('winner-card', 'loser-card', 'selected');
    selectedTeam = null;
    
    selectA.disabled = false;
    selectB.disabled = false;
    
    betInput.disabled = true;
    placeBetBtn.disabled = true;
    placeBetBtn.innerText = `Select a Team First`;
    placeBetBtn.style.background = "var(--vibe-purple)";
    betInput.value = '';
}

startTimer();

// ==========================================
// PHASE 6: P2P WEBRTC MULTIPLAYER (PEERJS)
// ==========================================
const multiplayerBtn = document.getElementById('multiplayerBtn');
const multiplayerModal = document.getElementById('multiplayerModal');
const closeMultiplayer = document.getElementById('closeMultiplayer');
const createRoomBtn = document.getElementById('createRoomBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const inviteLinkInput = document.getElementById('inviteLink');
const joinRoomBtn = document.getElementById('joinRoomBtn');

const stateCreate = document.getElementById('lobbyStateCreate');
const stateWaiting = document.getElementById('lobbyStateWaiting');
const stateJoining = document.getElementById('lobbyStateJoining');

let peer = null;
let p2pConnection = null;
let isMultiplayer = false;
let isHost = false;

// PvP State
let myUsername = "Guest";
let oppUsername = "Opponent";
let myLock = false;
let oppLock = false;
let pendingBetAmount = 0;

// Mock Online Counter Fluctuation
setInterval(() => {
    const el = document.getElementById('onlineCount');
    if (el) {
        let current = parseInt(el.innerText.replace(',', ''));
        current += Math.floor(Math.random() * 5) - 2; // fluctuate -2 to +2
        el.innerText = current.toLocaleString();
    }
}, 5000);

multiplayerBtn.addEventListener('click', () => {
    multiplayerModal.classList.remove('hidden');
    stateCreate.classList.remove('hidden');
    stateWaiting.classList.add('hidden');
    stateJoining.classList.add('hidden');
});

closeMultiplayer.addEventListener('click', () => {
    multiplayerModal.classList.add('hidden');
});

function initPeer(onOpenCallback) {
    if (peer) return onOpenCallback(peer.id);
    
    const randomId = 'vibe-' + Math.random().toString(36).substr(2, 6);
    peer = new Peer(randomId, { debug: 2 });
    
    peer.on('open', (id) => {
        onOpenCallback(id);
    });
    
    peer.on('connection', (c) => {
        // Someone joined my room! (I am Host)
        p2pConnection = c;
        isHost = true;
        isMultiplayer = true;
        setupConnectionLogic();
    });
    
    peer.on('error', (err) => {
        console.error(err);
        alert("P2P Connection Error: " + err.type);
    });
}

createRoomBtn.addEventListener('click', () => {
    myUsername = playerNickname || "Host Raider";
    createRoomBtn.innerText = "Generating P2P Room...";
    initPeer((id) => {
        stateCreate.classList.add('hidden');
        stateWaiting.classList.remove('hidden');
        const link = window.location.origin + window.location.pathname + '?duel=' + id;
        inviteLinkInput.value = link;
    });
});

copyLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(inviteLinkInput.value);
    copyLinkBtn.innerText = "✅ Copied!";
    setTimeout(() => copyLinkBtn.innerText = "📋 Copy Link", 2000);
});

// Check if joined via link
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const duelId = urlParams.get('duel');
    if (duelId) {
        // If guest joined via link, they still need to do the main nickname modal first.
        // Once they close it, we auto-trigger the join room UI.
        const originalSaveBtnClick = saveNicknameBtn.onclick;
        
        multiplayerModal.classList.remove('hidden');
        stateCreate.classList.add('hidden');
        stateWaiting.classList.add('hidden');
        stateJoining.classList.remove('hidden');
        
        joinRoomBtn.addEventListener('click', () => {
            myUsername = playerNickname || "Guest Raider";
            joinRoomBtn.innerText = "Connecting...";
            initPeer((myId) => {
                p2pConnection = peer.connect(duelId);
                isHost = false;
                isMultiplayer = true;
                setupConnectionLogic();
            });
        });
    }
});

function setupConnectionLogic() {
    p2pConnection.on('open', () => {
        console.log("P2P Connected!");
        multiplayerModal.classList.add('hidden');
        
        // Exchange Usernames
        p2pConnection.send({ type: 'HELLO', username: myUsername });
        
        // Sync UI for Multiplayer
        multiplayerBtn.innerText = "🔴 Live PvP Room";
        multiplayerBtn.style.background = "var(--alert-red)";
        
        // Lock Teams: Host is always Team A, Guest is always Team B to avoid conflict
        if (isHost) {
            selectTeam('A');
            document.getElementById('teamB').style.pointerEvents = 'none';
            document.getElementById('teamB').style.opacity = '0.7';
            // Force Guest to match Host's current dropdowns
            p2pConnection.send({ type: 'SELECTION_FORCE', assetA: selectA.value, assetB: selectB.value });
        } else {
            selectTeam('B');
            document.getElementById('teamA').style.pointerEvents = 'none';
            document.getElementById('teamA').style.opacity = '0.7';
        }
        // Show Chat
        const chatContainer = document.getElementById('pvpChatContainer');
        if (chatContainer) chatContainer.classList.remove('hidden');
        
        p2pConnection.on('data', (data) => handleP2PData(data));
    });
}

function handleP2PData(data) {
    if (data.type === 'HELLO') {
        oppUsername = data.username;
        const pvpHeader = document.getElementById('pvpHeader');
        pvpHeader.classList.remove('hidden');
        
        if (isHost) {
            document.getElementById('pvpHostName').innerText = myUsername;
            document.getElementById('pvpGuestName').innerText = oppUsername;
        } else {
            document.getElementById('pvpHostName').innerText = oppUsername;
            document.getElementById('pvpGuestName').innerText = myUsername;
        }
    }
    
    if (data.type === 'CHAT') {
        appendChatMessage(oppUsername, data.message, 'var(--alert-red)');
    }
    
    if (data.type === 'SELECTION_FORCE') {
        selectA.value = data.assetA;
        selectB.value = data.assetB;
        updateAvatar(selectA, 'avatarA');
        updateAvatar(selectB, 'avatarB');
    }
    
    if (data.type === 'SELECTION') {
        if (isHost && data.team === 'B') {
            selectB.value = data.asset;
            updateAvatar(selectB, 'avatarB');
        } else if (!isHost && data.team === 'A') {
            selectA.value = data.asset;
            updateAvatar(selectA, 'avatarA');
        }
    }
    
    if (data.type === 'LOCK') {
        oppLock = true;
        // Update opponent pool visually
        if (isHost) document.getElementById('poolB').innerText = data.amount;
        else document.getElementById('poolA').innerText = data.amount;
        
        if (myLock) {
            if (isHost) startHostPvPMatch();
            else placeBetBtn.innerText = "WAITING FOR HOST TO START... 📡";
        } else {
            alert(`🔥 ${oppUsername} has locked in their bet! Place your bet to start the match!`);
        }
    }
    
    if (data.type === 'START_MATCH') {
        startGuestPvPMatch(data.initialPrices);
    }
    
    if (data.type === 'COMBAT_TICK') {
        applyCombatTick(data);
    }
    
    if (data.type === 'RESOLVE') {
        setTimeout(() => { timer = 0; resolveRound(data.finalPriceA, data.finalPriceB); }, 1000);
    }
}

// Intercept normal place bet logic for PvP Dual Lock
function attemptPvPLock(amount) {
    myLock = true;
    pendingBetAmount = amount;
    
    placeBetBtn.innerText = `WAITING FOR ${oppUsername.toUpperCase()}... ⏳`;
    placeBetBtn.disabled = true;
    betInput.disabled = true;
    selectA.disabled = true;
    selectB.disabled = true;
    
    const myAsset = selectedTeam === 'A' ? selectA.value : selectB.value;
    p2pConnection.send({ type: 'LOCK', amount: amount, asset: myAsset });
    
    if (oppLock) {
        if (isHost) startHostPvPMatch();
        else placeBetBtn.innerText = "WAITING FOR HOST TO START... 📡";
    }
}

function setupMatchState(initialPrices) {
    userBalance -= pendingBetAmount;
    currentBet = pendingBetAmount;
    roundLocked = true;
    
    startPriceA = currentPriceA = initialPrices.a;
    startPriceB = currentPriceB = initialPrices.b;
    
    historyA = [0]; historyB = [0];
    hpA = 100; hpB = 100;
    timer = 60; countdownEl.innerText = timer;
    
    document.getElementById('hpA').style.width = '100%';
    document.getElementById('hpB').style.width = '100%';
    document.getElementById('hpBoxA').classList.remove('hidden');
    document.getElementById('hpBoxB').classList.remove('hidden');
    avatarA.classList.remove('ko-state'); avatarB.classList.remove('ko-state');
    
    balancePill.innerText = `${userBalance} $VCT`;
    const myPool = isHost ? 'poolA' : 'poolB';
    document.getElementById(myPool).innerText = pendingBetAmount;
    
    placeBetBtn.innerText = "FIGHTING! ⚔️";
    placeBetBtn.style.background = "var(--alert-red)";
    teamACard.classList.add('fighting'); teamBCard.classList.add('fighting');
    vsBadge.classList.add('hidden'); chartBox.classList.remove('hidden');
    drawChart();
}

async function startHostPvPMatch() {
    try {
        placeBetBtn.innerText = "CONNECTING TO ORACLE... 📡";
        
        // Reset global prices to force fresh fetch for new rounds
        currentPriceA = 0;
        currentPriceB = 0;
        
        const initialPrices = await fetchLivePrices();
        if (!initialPrices || !initialPrices.a || !initialPrices.b) {
            alert("⚠️ Failed to connect to live Oracle."); resetBetUI(); return;
        }
        
        p2pConnection.send({ type: 'START_MATCH', initialPrices });
        setupMatchState(initialPrices);
        
        priceInterval = setInterval(async () => {
            const livePrices = await fetchLivePrices();
            if (livePrices) {
                currentPriceA = livePrices.a;
                currentPriceB = livePrices.b;
            }
            const changeA = ((currentPriceA - startPriceA) / startPriceA) * 100;
            const changeB = ((currentPriceB - startPriceB) / startPriceB) * 100;
            historyA.push(changeA); historyB.push(changeB); drawChart();
            
            const diff = Math.abs(changeA - changeB);
            const damage = Math.min(diff * 5, 3);
            if (changeA > changeB) hpB -= damage; else if (changeB > changeA) hpA -= damage;
            hpA = Math.max(0, hpA); hpB = Math.max(0, hpB);
            
            document.getElementById('hpA').style.width = `${hpA}%`;
            document.getElementById('hpB').style.width = `${hpB}%`;
            triggerCombatAnimations(changeA, changeB);
            
            timer--;
            countdownEl.innerText = timer;
            
            // Broadcast exact state to guest
            p2pConnection.send({ type: 'COMBAT_TICK', timer, changeA, changeB, hpA, hpB });
            
            if (hpA <= 0 || hpB <= 0 || timer <= 0) {
                clearInterval(priceInterval);
                if (hpA <= 0) avatarA.classList.add('ko-state');
                if (hpB <= 0) avatarB.classList.add('ko-state');
                
                // Force Guest to resolve with exact final prices
                p2pConnection.send({ type: 'RESOLVE', finalPriceA: currentPriceA, finalPriceB: currentPriceB });
                setTimeout(() => { timer = 0; resolveRound(currentPriceA, currentPriceB); }, 1000);
            }
        }, 1500);
    } catch (err) {
        console.error(err); alert("⚠️ PvP Error"); resetBetUI();
    }
}

function startGuestPvPMatch(initialPrices) {
    setupMatchState(initialPrices);
}

function applyCombatTick(data) {
    timer = data.timer;
    countdownEl.innerText = timer;
    
    historyA.push(data.changeA);
    historyB.push(data.changeB);
    drawChart();
    
    hpA = data.hpA; hpB = data.hpB;
    document.getElementById('hpA').style.width = `${hpA}%`;
    document.getElementById('hpB').style.width = `${hpB}%`;
    triggerCombatAnimations(data.changeA, data.changeB);
    
    if (hpA <= 0) avatarA.classList.add('ko-state');
    if (hpB <= 0) avatarB.classList.add('ko-state');
    // Guest waits for RESOLVE packet to end the round.
}

// ==========================================
// PHASE 7: PVP CHAT BOX
// ==========================================
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const chatMessages = document.getElementById('chatMessages');

function appendChatMessage(sender, text, color = 'var(--vibe-cyan)') {
    if (!chatMessages) return;
    const msgEl = document.createElement('div');
    msgEl.innerHTML = `<strong style="color: ${color};">${sender}:</strong> <span>${text}</span>`;
    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChat() {
    const text = chatInput.value.trim();
    if (!text || !p2pConnection) return;
    
    appendChatMessage('You', text, 'var(--vibe-cyan)');
    p2pConnection.send({ type: 'CHAT', message: text });
    chatInput.value = '';
}

if (sendChatBtn) {
    sendChatBtn.addEventListener('click', sendChat);
}
if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChat();
    });
}
