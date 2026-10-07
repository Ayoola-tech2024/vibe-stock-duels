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

function simulatePrivyLogin(method) {
    const btns = document.querySelectorAll('.privy-btn');
    btns[0].innerHTML = "⏳ Authenticating securely...";
    
    setTimeout(() => {
        userWallet = "0x" + Math.random().toString(16).slice(2, 8) + "..." + Math.random().toString(16).slice(2, 6);
        userBalance = 5000;
        
        privyModal.classList.add('hidden');
        loginBtn.innerHTML = `🟢 ${userWallet}`;
        loginBtn.style.background = "var(--vibe-cyan)";
        loginBtn.style.color = "var(--charcoal-ink)";
        
        balancePill.innerText = `${userBalance} $VCT`;
        balancePill.classList.remove('hidden');
    }, 1500);
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
    placeBetBtn.innerText = `Place Bet on ${team === 'A' ? '$HOOD' : '$NVDA'}`;
}

// Phase 5: Live Chart & Dynamic Combat
let currentBet = 0;
let roundLocked = false;

// Oracle Data State
let startPriceA = 22.45;
let startPriceB = 114.20;
let currentPriceA = startPriceA;
let currentPriceB = startPriceB;

// Health State
let hpA = 100;
let hpB = 100;

// Chart History Arrays (stores % change)
let historyA = [];
let historyB = [];

placeBetBtn.addEventListener('click', () => {
    if (!userWallet) { alert("⚠️ Please click 'Connect to Play' to generate your wallet first!"); return; }
    if (roundLocked) return;

    const amount = parseInt(betInput.value);
    if (!amount || amount <= 0) return;
    if (amount > userBalance) { alert("❌ Insufficient $VCT balance!"); return; }
    
    // Process Bet
    userBalance -= amount;
    currentBet = amount;
    roundLocked = true;
    
    // Reset Data
    currentPriceA = startPriceA = 22.45 + (Math.random()*5); // slight variation every round
    currentPriceB = startPriceB = 114.20 + (Math.random()*15);
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
    
    betInput.disabled = true;
    placeBetBtn.disabled = true;
    placeBetBtn.innerText = "FIGHTING! ⚔️";
    placeBetBtn.style.background = "var(--alert-red)";
    
    // START VISUAL FIGHT & CHART
    teamACard.classList.add('fighting');
    teamBCard.classList.add('fighting');
    vsBadge.classList.add('hidden');
    chartBox.classList.remove('hidden');
    
    drawChart();
    
    // Simulate live stock price & Combat triggers
    priceInterval = setInterval(() => {
        // Price Random Walk (Drift + Volatility)
        currentPriceA *= (1 + (Math.random() - 0.49) * 0.015);
        currentPriceB *= (1 + (Math.random() - 0.49) * 0.015);
        
        const changeA = ((currentPriceA - startPriceA) / startPriceA) * 100;
        const changeB = ((currentPriceB - startPriceB) / startPriceB) * 100;
        
        historyA.push(changeA);
        historyB.push(changeB);
        drawChart();
        
        // Calculate Damage
        const diff = Math.abs(changeA - changeB);
        const damage = Math.min(diff * 4, 15); // Scale diff to HP damage
        
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
        
        if (hpA <= 0 || hpB <= 0) {
            clearInterval(priceInterval); // Stop combat
            if (hpA <= 0) avatarA.classList.add('ko-state');
            if (hpB <= 0) avatarB.classList.add('ko-state');
            setTimeout(() => {
                timer = 0; // Force end
                resolveRound();
            }, 1000);
        }
        
    }, 1000);
});

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
    
    // Draw NVDA (Ruby/Red)
    drawLine(historyB, '#FF3366');
    // Draw HOOD (Mint/Cyan)
    drawLine(historyA, '#00F0FF');
}

// Simple Countdown
function startTimer() {
    timerInterval = setInterval(() => {
        if (!roundLocked) return; // Don't tick if round isn't active
        timer--;
        if (timer <= 0) {
            resolveRound();
        }
        countdownEl.innerText = timer;
    }, 1000);
}

function resolveRound() {
    clearInterval(priceInterval);
    
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
    const winningStock = winner === 'A' ? '$HOOD' : '$NVDA';
    
    const receiptHTML = `
        <div style="background: #111; color: #00F0FF; padding: 10px; border-radius: 8px; font-family: monospace; text-align: left; margin: 15px 0; font-size: 0.9rem;">
            <div><strong>ON-CHAIN ORACLE RECEIPT</strong></div>
            <div style="margin-top:5px; color: #00F0FF;">$HOOD: $${startPriceA.toFixed(2)} ➔ $${currentPriceA.toFixed(2)} (${changeA > 0 ? '+' : ''}${changeA.toFixed(2)}%)</div>
            <div style="color: #FF3366;">$NVDA: $${startPriceB.toFixed(2)} ➔ $${currentPriceB.toFixed(2)} (${changeB > 0 ? '+' : ''}${changeB.toFixed(2)}%)</div>
            <div style="margin-top:5px; color: #FFD700;">WINNER: ${winningStock}</div>
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
            showCustomModal(`🎉 YOU WON!`, `Your stock outperformed!`, `+${winnings} $VCT`, 'var(--vibe-cyan)', receiptHTML);
        } else {
            showCustomModal(`💀 YOU LOST`, `Your stock was outperformed.`, `-${currentBet} $VCT`, 'var(--alert-red)', receiptHTML);
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
    
    betInput.disabled = true;
    placeBetBtn.disabled = true;
    placeBetBtn.innerText = `Select a Team First`;
    placeBetBtn.style.background = "var(--vibe-purple)";
    betInput.value = '';
}

startTimer();
